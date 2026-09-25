import { NextRequest, NextResponse } from "next/server";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { computeReportSummary } from "@/lib/robo/reportSummary";
import { roboGate } from "@/lib/rbac";

// Never served from a cache: this is a live aggregation of production data, and
// a stale response is exactly how "the same report shows different numbers later"
// happens. Always computed fresh, per request, from the current rows.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/robo/reports/summary?date=&from=&to=&batch=
 * All optional and combinable:
 *   date         → one production day ("Date Wise")
 *   from, to     → an inclusive production-date window ("Date Range")
 *   batch        → a Batch Number, matched loosely (see batchFilter.ts)
 * A range beats a single date; with none of the three, every record to date.
 *
 * "Production date" is the date the operator entered on the batch setup, falling
 * back to the shift's own date — the same rule Slabs Records, Complete Details
 * and both Excel downloads use. See lib/robo/productionDate.ts.
 *
 * It used to be `where: { shift: { date } }`, and that is not a small
 * difference: a shift row is created silently with the day the tablet was
 * open, so a run entered late counted under the day it was typed. This
 * endpoint also fills the preview tiles on the Downloads screen AND decides
 * whether its two buttons are enabled, so while it disagreed with the exports
 * it sat underneath, picking the real production date turned both downloads
 * off and picking the typing date offered an empty workbook.
 *
 * The figures themselves are computed in lib/robo/reportSummary.ts — the ONE
 * implementation the Downloads Reference Sheet also calls, so the two screens
 * always agree for a batch.
 */
export async function GET(req: NextRequest) {
  // THE GATE STAYS — see the note in the delays export.
  const refused = await roboGate();
  if (refused) return refused;

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date")?.trim() || "";
  const from = sp.get("from")?.trim() || "";
  const to = sp.get("to")?.trim() || "";

  const batchIds = await resolveBatchRecipeIds(sp.get("batch"));
  const summary = await computeReportSummary({ date, from, to, batchIds });

  return NextResponse.json({ date: date || null, ...summary });
}
