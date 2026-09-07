import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { delayProductionDateSelectWhere, productionDateOf, productionDateSelectWhere } from "@/lib/robo/productionDate";
import { productionSpanMinutes, avgSlabsPerHour } from "@/lib/robo/productionSpan";
import { delayTypesByCode } from "@/lib/robo/delayTypes";
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
  // A null is "no batch filter"; an array (even empty) narrows — the delay
  // form nests through the slab the delay held up.
  const batchRecord: Prisma.RoboProductionRecordWhereInput =
    batchIds !== null ? { batchRecipeId: { in: batchIds } } : {};
  const batchDelay: Prisma.RoboDelayLogWhereInput =
    batchIds !== null ? { productionRecord: { batchRecipeId: { in: batchIds } } } : {};

  const recordWhere: Prisma.RoboProductionRecordWhereInput = {
    ...(productionDateSelectWhere({ date, from, to }) ?? {}),
    ...batchRecord,
  };
  const delayWhere: Prisma.RoboDelayLogWhereInput = {
    ...(delayProductionDateSelectWhere({ date, from, to }) ?? {}),
    ...batchDelay,
  };

  const totalSlabs = await prisma.roboProductionRecord.count({ where: recordWhere });

  const delays = await prisma.roboDelayLog.findMany({
    where: delayWhere,
    select: {
      durationMinutes: true,
      delayCode: { select: { code: true, description: true, category: true } },
    },
  });

  const totalDelayMins = delays.reduce((s, d) => s + d.durationMinutes, 0);

  /* Total Production Time — the last completed slab's Out Time minus the first
     slab's In Time, over EXACTLY the filtered slabs (recordWhere, the same set
     Total Slabs counts). This one span drives two KPIs: the Total Production Time
     card, and the Avg Slabs/hour below it.

     Each slab's In/Out is paired with its production date (productionDateOf, the
     per-slab-then-setup-then-shift rule the whole module shows) so a run past
     midnight or a multi-day filter measures a real distance, not a min/max over
     bare clock strings. It is built ONLY from recorded times — no wall clock —
     so both KPIs are deterministic: the same filtered data always gives the same
     numbers. productionSpanMinutes returns null when nothing has completed or no
     In Time exists, and both KPIs then read "—". */
  const spanRecords = await prisma.roboProductionRecord.findMany({
    where: recordWhere,
    select: {
      inTime: true,
      outTime: true,
      productionDate: true,
      batchRecipe: { select: { productionDate: true } },
      shift: { select: { date: true } },
    },
  });
  const productionTimeMinutes = productionSpanMinutes(
    spanRecords.map((r) => ({ productionDate: productionDateOf(r), inTime: r.inTime, outTime: r.outTime })),
  );

  /* Avg Slabs/hour — Total Slabs ÷ that elapsed batch duration in hours, DELAYS
     LEFT IN (not subtracted): the operator's own definition. 46 slabs across a
     14:10 → 21:50 run (7h 40m) is 46 ÷ 7.6667 ≈ 6.0. It replaces the old figure
     that divided by shift open-time measured up to the current clock, which
     drifted while a shift stayed open and diluted a batch filter with the whole
     shift's hours; this divides the SAME filtered slabs by their OWN span, so it
     is stable and filter-correct. "—" when there is no completed span. */
  const avg = avgSlabsPerHour(totalSlabs, productionTimeMinutes);

  // EVERY delay type by total duration, highest first — the Delay Analysis bar
  // chart and its table show the whole list, not a Top 5. The grouping is a pure,
  // tested helper (delayTypesByCode) so the chart provably matches the Delay Log
  // rows: one row = one event even for a multi-Robo delay, no clock, no drift.
  // Percentages are the client's job (against totalDelayMins).
  const delayTypes = delayTypesByCode(delays);

  return NextResponse.json({
    date: date || null,
    totalSlabs,
    productionTimeMinutes,
    avgSlabsPerHour: avg,
    totalDelayMins,
    delayEvents: delays.length,
    delayTypes,
  });
}
