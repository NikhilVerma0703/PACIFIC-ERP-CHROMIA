import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { delayProductionDateWhere, productionDateWhere } from "@/lib/robo/productionDate";

/** The four robots on the line, in physical order. */
const ROBOTS = [
  { db: "Roycut-1", label: "Robo1", short: "R1" },
  { db: "Roymix",   label: "Robo2", short: "R2" },
  { db: "Roycut-2", label: "Robo3", short: "R3" },
  { db: "Roycut-3", label: "Robo4", short: "R4" },
];

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
 * GET /api/robo/reports/summary?date=YYYY-MM-DD
 * No date  → every production record to date.
 * With date → only what was PRODUCED on that date.
 *
 * "That date" is the production date the operator entered on the batch setup,
 * falling back to the shift's own date — the same rule Slabs Records, Complete
 * Details and both Excel downloads use. See lib/robo/productionDate.ts.
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
  const date = req.nextUrl.searchParams.get("date")?.trim() || "";
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const recordWhere: Prisma.RoboProductionRecordWhereInput = productionDateWhere(date) ?? {};
  const delayWhere: Prisma.RoboDelayLogWhereInput = delayProductionDateWhere(date) ?? {};

  const totalSlabs = await prisma.roboProductionRecord.count({ where: recordWhere });

  /* Line minutes still come from the shift rows, because that is what a shift
     genuinely records: when the tablet opened and closed. What changed is
     WHICH shifts — the ones the matched slabs were logged in, rather than the
     ones whose own date happens to equal the filter. Otherwise slabs/hour
     would divide this date's slab count by another date's minutes.

     A shift is counted once however many of its slabs matched; a distinct
     select over the matched records gives exactly that set. */
  const shiftIds = date
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
      machineName: true,
      machine: { select: { name: true } },
      delayCode: { select: { code: true, description: true, category: true } },
    },
  });

  const totalDelayMins = delays.reduce((s, d) => s + d.durationMinutes, 0);

  // Downtime attributed to each robot
  const byMachine: Record<string, number> = {};
  for (const d of delays) {
    const name = d.machineName || d.machine?.name;
    if (!name) continue;
    byMachine[name] = (byMachine[name] || 0) + d.durationMinutes;
  }
  const machinePerformance = ROBOTS.map(r => ({
    name: r.label,
    short: r.short,
    minutes: byMachine[r.db] || 0,
  }));

  // Top 5 delay types by total duration
  const byCode: Record<string, { code: string; description: string; category: string; minutes: number; events: number }> = {};
  for (const d of delays) {
    const key = d.delayCode.code;
    if (!byCode[key]) {
      byCode[key] = { code: key, description: d.delayCode.description, category: d.delayCode.category, minutes: 0, events: 0 };
    }
    byCode[key].minutes += d.durationMinutes;
    byCode[key].events += 1;
  }
  const topDelayTypes = Object.values(byCode).sort((a, b) => b.minutes - a.minutes).slice(0, 5);

  return NextResponse.json({
    date: date || null,
    totalSlabs,
    productionMinutes,
    slabsPerHour: productionMinutes > 0 ? Math.round((totalSlabs / (productionMinutes / 60)) * 10) / 10 : null,
    totalDelayMins,
    delayEvents: delays.length,
    machinePerformance,
    topDelayTypes,
  });
}
