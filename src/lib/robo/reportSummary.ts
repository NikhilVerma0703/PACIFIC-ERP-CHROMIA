/**
 * The Reports summary figures — ONE implementation, shared.
 *
 * Total Slabs Produced, Total Production Time, Total Delays and Avg Slabs/hour
 * are computed HERE and nowhere else:
 *
 *   · the Reports summary route (/api/robo/reports/summary) returns them as-is;
 *   · the Downloads Reference Sheet (lib/robo/referenceData.ts) calls this same
 *     function for a design's latest batch.
 *
 * So the two screens cannot show different numbers for the same batch — the
 * owner's requirement (2026-09-25): the Reference Sheet "should take these values
 * directly from the same Reports calculation … not calculate them
 * independently". Before this, the Reference Sheet carried its own copy of the
 * arithmetic over a narrower set of slabs and a different Avg formula, and read
 * 322 slabs for batch D-1445 where Reports read 359.
 *
 * The body is the Reports route's, moved here verbatim — same queries, same
 * helpers, same rounding — so Reports' own output is unchanged. Change a figure
 * here and both screens move together; that is the point.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { delayProductionDateSelectWhere, productionDateOf, productionDateSelectWhere } from "@/lib/robo/productionDate";
import { productionSpanMinutes, avgSlabsPerHour } from "@/lib/robo/productionSpan";
import { delayTypesByCode } from "@/lib/robo/delayTypes";
import { canonBatchNo } from "@/lib/robo/batchNo";

export interface ReportSummaryFilter {
  /** One production day ("Date Wise"). */
  date?: string;
  /** An inclusive production-date window ("Date Range"); beats `date`. */
  from?: string;
  to?: string;
  /** resolveBatchRecipeIds' answer: null = no batch filter; an array (even
   *  empty) narrows to those setups. */
  batchIds: string[] | null;
}

export async function computeReportSummary({ date = "", from = "", to = "", batchIds }: ReportSummaryFilter) {
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
     In Time exists, and both KPIs then read "—".

     Each slab is placed exactly as the hourly chart places it (placeSlabs in
     hourlyProduction.ts): its stored date, except a slab whose date slipped by
     one day, or whose Out the midnight rule pushed a day on, is placed where the
     slabs made around it show — which is why each slab's production order (slab
     number, entry time, id) and its batch come along. */
  const spanRecords = await prisma.roboProductionRecord.findMany({
    where: recordWhere,
    select: {
      id: true,
      slabNumber: true,
      inTime: true,
      outTime: true,
      createdAt: true,
      batchRecipeId: true,
      shiftId: true,
      productionDate: true,
      batchRecipe: { select: { productionDate: true, batchNo: true } },
      shift: { select: { date: true } },
    },
  });
  const productionTimeMinutes = productionSpanMinutes(
    spanRecords.map((r) => ({
      productionDate: productionDateOf(r),
      inTime: r.inTime,
      outTime: r.outTime,
      slabNumber: r.slabNumber,
      createdAtMs: r.createdAt.getTime(),
      id: r.id,
      // The run a slab is checked within. Filtered to a batch, the batch is ONE
      // run — every setup of it together, exactly the set the hourly chart
      // draws, so the KPI and the chart agree. Otherwise each batch number is
      // its own run (canonBatchNo, so "D1448" and "D-1448" are one), a setup
      // with no batch number its own, and a slab with no setup its shift's.
      runKey: batchIds !== null
        ? "batch"
        : canonBatchNo(r.batchRecipe?.batchNo) || (r.batchRecipeId ? `setup:${r.batchRecipeId}` : `shift:${r.shiftId}`),
    })),
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

  return {
    totalSlabs,
    productionTimeMinutes,
    avgSlabsPerHour: avg,
    totalDelayMins,
    delayEvents: delays.length,
    delayTypes,
  };
}
