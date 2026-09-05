import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { delayProductionDateSelectWhere, productionDateOf, productionDateSelectWhere } from "@/lib/robo/productionDate";
import { productionSpanMinutes } from "@/lib/robo/productionSpan";

function toMins(t: string): number {
  const [h, m] = (t || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutes a shift ran; open shifts count up to now, and midnight roll-over is handled. */
function shiftMinutes(startTime: string, endTime: string | null, status: string, nowMins: number): number {
  if (!startTime) return 0;
  const start = toMins(startTime);
  const end = endTime ? toMins(endTime) : status === "ACTIVE" ? nowMins : null;
  if (end === null) return 0;
  let diff = end - start;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

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
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date")?.trim() || "";
  const from = sp.get("from")?.trim() || "";
  const to = sp.get("to")?.trim() || "";
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

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

  /* Line minutes still come from the shift rows, because that is what a shift
     genuinely records: when the tablet opened and closed. What changed is
     WHICH shifts — the ones the matched slabs were logged in, rather than the
     ones whose own date happens to equal the filter. Otherwise slabs/hour
     would divide this date's slab count by another date's minutes.

     A shift is counted once however many of its slabs matched; a distinct
     select over the matched records gives exactly that set. Restricted whenever
     ANY filter is applied — a date, a range, or a batch — so the minutes always
     match the slabs they are divided into. */
  const anyFilter = Boolean(date || from || to || batchIds !== null);
  const shiftIds = anyFilter
    ? (await prisma.roboProductionRecord.findMany({
        where: recordWhere,
        select: { shiftId: true },
        distinct: ["shiftId"],
      })).map((r) => r.shiftId)
    : null;

  const shifts = await prisma.roboShift.findMany({
    where: shiftIds ? { id: { in: shiftIds } } : {},
    select: { startTime: true, endTime: true, status: true },
  });
  const productionMinutes = shifts.reduce(
    (s, sh) => s + shiftMinutes(sh.startTime, sh.endTime, sh.status, nowMins), 0
  );

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
     Total Slabs counts). Its own fetch, kept apart from the slabs/hour minutes
     above: that figure is shift open-to-close time, this is when the slabs
     themselves started and finished, and the two must not be conflated.

     Each slab's In/Out is paired with its production date (productionDateOf, the
     per-slab-then-setup-then-shift rule the whole module shows) so a run past
     midnight or a multi-day filter measures a real distance, not a min/max over
     bare clock strings. productionSpanMinutes returns null when nothing has
     completed or no In Time exists, and the KPI then reads "—". */
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

  // EVERY delay type by total duration, highest first — the Delay Analysis bar
  // chart and its table show the whole list, not a Top 5. Percentages are the
  // client's job (against totalDelayMins), so the shape carries only the totals.
  const byCode: Record<string, { code: string; description: string; category: string; minutes: number; events: number }> = {};
  for (const d of delays) {
    const key = d.delayCode.code;
    if (!byCode[key]) {
      byCode[key] = { code: key, description: d.delayCode.description, category: d.delayCode.category, minutes: 0, events: 0 };
    }
    byCode[key].minutes += d.durationMinutes;
    byCode[key].events += 1;
  }
  const delayTypes = Object.values(byCode).sort((a, b) => b.minutes - a.minutes);

  return NextResponse.json({
    date: date || null,
    totalSlabs,
    productionMinutes,
    productionTimeMinutes,
    slabsPerHour: productionMinutes > 0 ? Math.round((totalSlabs / (productionMinutes / 60)) * 10) / 10 : null,
    totalDelayMins,
    delayEvents: delays.length,
    delayTypes,
  });
}
