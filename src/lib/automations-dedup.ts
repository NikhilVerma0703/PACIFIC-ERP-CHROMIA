// Phase 4 — Polishing Tables Deduplication (faithful port).
// Dedupes Polish Entry by (Slab Number | Batch Number) keeping the linked-or-
// newest row; dedupes Polish QC by linked Polish Entry, merging empty fields
// into the kept row; removes unlinked QC rows. DESTRUCTIVE — dryRun defaults
// true (parallel-run safe); pass { dryRun:false } post-cutover to apply.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { mergeFromOlder } from "@/lib/dedupMerge";
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
  // ─────────── THIS BRANCH IS UNREVIEWED, AND IT IS THE DANGEROUS ONE ───────
  // Every QC row with an empty link array is collected here and DELETED below
  // (with dryRun:false). The reject-merge guard a few lines down was reviewed
  // hard; this was not, and it is the larger hazard by three orders of
  // magnitude. Measured on live Neon 2026-09-04:
  //
  //   * 14,551 rows carry an empty link — 30% of polish_qc;
  //   * 491 of them are graded 'C (Reject)' — real verdicts, not phantoms;
  //   * entry_photo has NO foreign key to polish_qc (a loose model/recordId
  //     pair), so their photographs are NOT cascade-deleted, they are ORPHANED:
  //     251 of the 256 PolishQc photographs on the database, 159 of them on
  //     rejects.
  //
  // Nothing calls deduplicatePolishing today and dryRun defaults true, so this
  // cannot fire — which is the only reason it is a comment and not a fix.
  // BEFORE ANYONE WIRES THIS UP OR PASSES dryRun:false, this branch needs its
  // own decision, and at minimum it must refuse to delete a row that carries a
  // reject grade or has entry_photo rows keyed to it.
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
    const merged = mergeFromOlder(keep, older, writable);
    const data = merged.data;
    rejectGradesNotMerged += merged.rejectGradesRefused;
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
