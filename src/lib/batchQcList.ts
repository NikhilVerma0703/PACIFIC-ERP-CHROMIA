// Per-slab QC list for the Office-side (Commercial) batch view.
//
// This is a deliberately narrow reader, and it exists rather than reusing an
// existing one for two concrete reasons:
//
//  1. getBatch() cannot supply it. Its polish_qc query selects `qualityGrade`
//     ALONE and folds the rows into grade counts, so no slab number ever reaches
//     BatchData. The per-slab list is genuinely absent upstream, not merely
//     unprojected.
//  2. getStationSlabs(key, "polishQc") is the wrong tool. Its STATION_SPEC
//     columns include `qualityIssue` (defect text) and `inspector` (a named
//     person) -- precisely the class of detail the batch-lookup allowlist exists
//     to keep away from Commercial -- and it returns `rows: any[]`, which cannot
//     be checked at the type level. Feeding an `any[]` into that page would
//     dissolve the property the whole page is built on.
//
// So this returns a closed, typed shape. Widen it deliberately, never by
// spreading a row.
import { prisma } from "@/lib/prisma";
import { batchFamily, type BatchScope } from "@/lib/erp";
import { thicknessBySlab } from "@/lib/slabThickness";

// finished-goods models follow the repo convention of `prisma as any` (see
// lib/inventory/finishedSlab.ts) so this compiles regardless of client
// regeneration timing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface BatchQcSlab {
  slab: number;
  grade: string | null;
  /** Canonical thickness from the shared resolver -- NOT polish_qc.slab_thickness.
   *  The raw column holds unnormalised strings ("3cm" vs "3 cm"), so reading it here
   *  would print LABELS that disagree with the Thickness Mix chart above the list.
   *  Note the totals still will not tie out and are not meant to: the chart counts a
   *  batch's PRESS slabs, this list counts its polish_qc rows -- different slab sets. */
  thickness: string | null;
  /** Live finished-goods status (AVAILABLE / RESERVED / PACKED / DISPATCHED /
   *  RETURNED), or null when the slab has no finished-goods record yet.
   *
   *  Deliberately NOT polish_qc.dispatch_status: that column is Airtable-synced
   *  legacy data and goes stale. fg_finished_slab.status is what /inventory reads
   *  and what POST /api/inventory/dispatch writes, so it is the only source that
   *  cannot contradict the Inventory screen. */
  status: string | null;
}

/** Per-slab QC rows for a batch, ordered by slab number.
 *
 *  Read-only. Dispatching is not done from here: POST /api/inventory/dispatch
 *  requires a PI number, a customer and (for COMMERCIAL specifically) an invoice
 *  file, and it checks the approval list -- so a one-click action on this list
 *  could not satisfy it. The status column reports; /inventory acts.
 */
export async function getBatchQcSlabs(input: string, scope?: BatchScope): Promise<BatchQcSlab[]> {
  // Family-scoped exactly like getBatch(), so this list and the "Polish QC" count card
  // on the same page cover the same SCOPE. Not the same row set: the filter at the end
  // of this function drops rows with no slab number, so the list is a subset of that
  // count -- the caller words the caption accordingly. A solo-scoped list under a
  // family-rolled-up count is the drill-down bug that made a duplicate click report
  // "none" while the number that linked there said otherwise.
  const { key, isSub, keys: famKeys } = await batchFamily(input);
  const keys = scope?.solo && !isSub ? [key] : famKeys;
  if (!keys.length) return [];

  const rows = await prisma.polishQc.findMany({
    where: { batchKey: { in: keys } },
    select: { slabNumber: true, qualityGrade: true },
    orderBy: { slabNumber: "asc" },
  });
  if (!rows.length) return [];

  // Rows are kept 1:1 with polish_qc -- a slab QC'd twice appears twice. Batch 1376
  // has a live case (slab 147583, two rows with CONFLICTING grades); collapsing it
  // would hide a real data conflict and make the list disagree with the Polish QC
  // count. The lookups below are keyed by slab number, so they dedupe on their own.
  const nums = [...new Set(rows.map((r) => r.slabNumber).filter((n): n is number => typeof n === "number" && Number.isFinite(n)))];

  const [thickness, fgRows] = await Promise.all([
    thicknessBySlab({ keys }),
    nums.length
      ? db.finishedSlab.findMany({ where: { slabNumber: { in: nums } }, select: { slabNumber: true, status: true } })
      : Promise.resolve([] as { slabNumber: number; status: string }[]),
  ]);

  const statusBySlab = new Map<number, string>();
  for (const r of fgRows as { slabNumber: number; status: string }[]) {
    if (typeof r.slabNumber === "number") statusBySlab.set(r.slabNumber, String(r.status));
  }

  return rows
    .filter((r): r is { slabNumber: number; qualityGrade: string | null } =>
      typeof r.slabNumber === "number" && Number.isFinite(r.slabNumber))
    .map((r) => ({
      slab: r.slabNumber,
      grade: r.qualityGrade?.trim() || null,
      thickness: thickness.get(r.slabNumber) ?? null,
      status: statusBySlab.get(r.slabNumber) ?? null,
    }));
}
