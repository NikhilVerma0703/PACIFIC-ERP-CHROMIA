// Phase 4 — Polishing Tables Deduplication (faithful port).
// Dedupes Polish Entry by (Slab Number | Batch Number) keeping the linked-or-
// newest row; dedupes Polish QC by linked Polish Entry, merging empty fields
// into the kept row; removes unlinked QC rows THAT CARRY NOTHING. DESTRUCTIVE
// — dryRun defaults true (parallel-run safe); pass { dryRun:false } to apply.
//
// NOTHING CALLS THIS TODAY. Repo-wide there is no route, cron, script or button
// that invokes it, and no caller passes dryRun:false (checked 2026-09-04). It is
// kept for the post-cutover run its name describes. Both of its destructive
// steps have since been narrowed so that IF it is ever wired up it cannot
// destroy a verdict or its evidence: the merge will not copy a reject grade
// onto a row that had none (lib/dedupMerge), and the unlinked sweep deletes
// only rows carrying no grade, no issue, no remark, no R&W status and no
// photograph. Whoever wires this up should still read both notes first and run
// it with the default dryRun to see the counts before passing false.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { mergeFromOlder } from "@/lib/dedupMerge";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

type FM = Record<string, { model: string; fields: Record<string, { prismaField: string; airtableType: string; kind: string }> }>;
let _fm: FM | null = null;
const fm = (): FM => (_fm ||= JSON.parse(readFileSync(join(process.cwd(), "scripts", "fieldmap.json"), "utf8")));
/** How this plant spells "nobody has judged this yet" — far commoner than NULL
 *  (3,654 rows against 194, live 2026-09-04), so a row carrying it is ungraded
 *  and NOT something worth keeping a row alive for. */
const NOT_GRADED = "Not graded yet";

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
  // Rows with no polish-entry link are collected here. What happens to them is
  // decided further down, AFTER the merge — see the note above unlinkedEmpty.
  // It used to be "delete them all", which on this database meant 14,647 rows
  // of real inspection data; it is now "delete the ones carrying nothing", which
  // on this database means none.
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

  // ─────────── AN UNLINKED ROW IS NOT AUTOMATICALLY A JUNK ROW ──────────────
  // This step was ported as "removes unlinked QC rows", on the Airtable-era
  // assumption that a QC row with no polish-entry link is a stray. That
  // assumption is false on this database, and not marginally so. Measured on
  // live Neon 2026-09-04, of 14,647 unlinked rows:
  //
  //     13,252  carry a real verdict (A / A2 / B / C)
  //        491  are graded 'C (Reject)'
  //      4,913  carry quality issues
  //     14,562  carry an R&W or repolish status
  //        251  of the database's 256 QC photographs hang off them
  //          0  are actually empty
  //
  // Not one of them is junk. entry_photo has no foreign key to polish_qc (a
  // loose model/recordId pair), so the photographs would not even be cascaded —
  // they would be orphaned, unreachable and undeletable through the app.
  //
  // So the step keeps its intent and loses its blast radius: an unlinked row is
  // deleted ONLY if it carries nothing anyone would miss — no verdict, no
  // quality issue, no remark, no R&W or repolish status, and no photograph.
  // Everything else is KEPT and counted, so a run says what it declined to
  // destroy instead of doing it silently. On today's data that means it deletes
  // none of them, which is the correct answer: there is nothing here to tidy.
  const unlinkedPhotoIds = new Set<string>();
  if (unlinked.length) {
    for (let i = 0; i < unlinked.length; i += 5000) {
      const rows: any[] = await db.$queryRaw`
        SELECT DISTINCT record_id FROM entry_photo
         WHERE model = 'PolishQc' AND record_id = ANY(${unlinked.slice(i, i + 5000)}::text[])`;
      for (const r of rows) unlinkedPhotoIds.add(String(r.record_id));
    }
  }
  const byId = new Map<string, any>(qc.map((r) => [r.id, r]));
  const carriesSomething = (r: any): boolean =>
    (r.qualityGrade != null && String(r.qualityGrade).trim() !== "" && String(r.qualityGrade).trim() !== NOT_GRADED)
    || ((r.qualityIssue ?? []).length > 0)
    || (r.remarks != null && String(r.remarks).trim() !== "")
    || r.rwStatus != null
    || r.repolishStatus != null;
  const unlinkedEmpty = unlinked.filter((id) => {
    const r = byId.get(id);
    return r ? !carriesSomething(r) && !unlinkedPhotoIds.has(id) : false;
  });
  const unlinkedKept = unlinked.length - unlinkedEmpty.length;

  if (!dryRun) {
    for (const m of qcMerge) await db.polishQc.update({ where: { id: m.id }, data: m.data });
    if (peDelete.length) await db.polishEntry.deleteMany({ where: { id: { in: peDelete } } });
    const allQc = [...qcDelete, ...unlinkedEmpty];
    if (allQc.length) await db.polishQc.deleteMany({ where: { id: { in: allQc } } });
  }
  return { dryRun, polishEntryDuplicates: peDelete.length, qcDuplicates: qcDelete.length, qcUnlinked: unlinked.length, qcUnlinkedDeleted: unlinkedEmpty.length, qcUnlinkedKept: unlinkedKept,
    qcMerges: qcMerge.length, rejectGradesNotMerged };
}
