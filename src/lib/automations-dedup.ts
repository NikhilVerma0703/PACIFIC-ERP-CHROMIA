// Phase 4 — Polishing Tables Deduplication (faithful port).
// Dedupes Polish Entry by (Slab Number | Batch Number) keeping the linked-or-
// newest row; dedupes Polish QC by linked Polish Entry, merging empty fields
// into the kept row; removes unlinked QC rows. DESTRUCTIVE — dryRun defaults
// true (parallel-run safe); pass { dryRun:false } post-cutover to apply.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { REJECT_GRADE_FIELD, isRejectGrade } from "@/lib/photoSlots";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

type FM = Record<string, { model: string; fields: Record<string, { prismaField: string; airtableType: string; kind: string }> }>;
let _fm: FM | null = null;
const fm = (): FM => (_fm ||= JSON.parse(readFileSync(join(process.cwd(), "scripts", "fieldmap.json"), "utf8")));
const t = (n: number | Date | null | undefined) => (n instanceof Date ? n.getTime() : n ? new Date(n).getTime() : 0);

export async function deduplicatePolishing(opts: { dryRun?: boolean } = {}) {
  const dryRun = opts.dryRun ?? true;
  const RO = new Set(["formula", "rollup", "multipleLookupValues", "count", "autoNumber", "createdTime", "lastModifiedTime", "button", "externalSyncSource"]);
  const qcMeta = Object.values(fm()).find((x) => x.model === "PolishQc")!;
  const writable = Object.values(qcMeta.fields).filter((f) => !RO.has(f.airtableType) && ["scalar", "number", "int", "bool", "date", "multiselect"].includes(f.kind) && f.prismaField !== "printed").map((f) => f.prismaField);

  // --- Polish Entry dedupe ---
  const pe: any[] = await db.polishEntry.findMany({ select: { id: true, slabNumber: true, batchNumber: true, created: true, polishQcIds: true } });
  const groups = new Map<string, any[]>();
  for (const r of pe) {
    if (r.slabNumber == null || !r.batchNumber) continue;
    const k = `${String(r.slabNumber).trim().toLowerCase()}|${String(r.batchNumber).trim().toLowerCase()}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const peDelete: string[] = [];
  for (const g of groups.values()) {
    if (g.length <= 1) continue;
    g.sort((a, b) => t(b.created) - t(a.created));
    const keep = g.find((r) => (r.polishQcIds ?? []).length > 0) ?? g[0];
    for (const r of g) if (r.id !== keep.id) peDelete.push(r.id);
  }

  // --- Polish QC dedupe + merge ---
  const qc: any[] = await db.polishQc.findMany({ select: { id: true, linkIds: true, createdTime: true, ...Object.fromEntries(writable.map((f) => [f, true])) } });
  const linkGroups = new Map<string, any[]>();
  const unlinked: string[] = [];
  for (const r of qc) {
    const link = (r.linkIds ?? []) as string[];
    if (!link.length) { unlinked.push(r.id); continue; }
    (linkGroups.get(link[0]) ?? linkGroups.set(link[0], []).get(link[0])!).push(r);
  }
  const qcDelete: string[] = [];
  const qcMerge: { id: string; data: Record<string, unknown> }[] = [];
  /** Reject grades this merge REFUSED to copy onto a row that had no verdict.
   *  Non-zero means a run met the case the guard exists for. */
  let rejectGradesNotMerged = 0;
  for (const g of linkGroups.values()) {
    if (g.length <= 1) continue;
    g.sort((a, b) => t(b.createdTime) - t(a.createdTime));
    const keep = g[0], older = g.slice(1);
    const data: Record<string, unknown> = {};
    for (const f of writable) {
      if (keep[f] !== null && keep[f] !== undefined) continue;
      for (const o of older) {
        if (o[f] === null || o[f] === undefined) continue;
        // ─────── A REJECT IS NOT A FIELD THIS MERGE MAY FILL IN ────────────
        // Every other empty field on the kept row is worth recovering from the
        // duplicate about to be deleted. The GRADE is different, and only when
        // the value is C (Reject): copying it MANUFACTURES A VERDICT on a row
        // that had none, and it does it with no photographs — the older row's
        // entry_photo rows are keyed to ITS id, which this same pass deletes,
        // so the evidence does not come across even when it existed.
        //
        // That would be the one way left to get a reject into polish_qc without
        // the two photographs the owner's rule demands (2026-09-04), after the
        // three human paths were closed: the QC form, the tables editor, and
        // Add & verify. This is not a person making a verdict — it is a tidy-up
        // job — and a tidy-up job must not decide that a slab was rejected.
        //
        // SO THE FIELD STAYS NULL, which is the honest answer: nobody graded
        // this row. It shows as ungraded, a human grades it on the QC form, and
        // the photographs are taken then. Nothing is lost that was ever really
        // there. The count comes back in the result so a run that hits this is
        // visible rather than silent.
        if (f === REJECT_GRADE_FIELD && isRejectGrade(o[f] as string)) { rejectGradesNotMerged++; break; }
        data[f] = o[f];
        break;
      }
    }
    if (Object.keys(data).length) qcMerge.push({ id: keep.id, data });
    for (const o of older) qcDelete.push(o.id);
  }

  if (!dryRun) {
    for (const m of qcMerge) await db.polishQc.update({ where: { id: m.id }, data: m.data });
    if (peDelete.length) await db.polishEntry.deleteMany({ where: { id: { in: peDelete } } });
    const allQc = [...qcDelete, ...unlinked];
    if (allQc.length) await db.polishQc.deleteMany({ where: { id: { in: allQc } } });
  }
  return { dryRun, polishEntryDuplicates: peDelete.length, qcDuplicates: qcDelete.length, qcUnlinked: unlinked.length, qcMerges: qcMerge.length, rejectGradesNotMerged };
}
