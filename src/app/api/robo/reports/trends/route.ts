import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { delayProductionDateOf, productionDateOf } from "@/lib/robo/productionDate";
import { dailySlabsPerHour, lineMinutesByDate } from "@/lib/robo/dailyRate";
import { roboGate } from "@/lib/rbac";

// Live aggregation, never cached — always computed fresh per request.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function pad(n: number): string { return String(n).padStart(2, "0"); }

/**
 * GET /api/robo/reports/trends?days=7|15|30
 * One row per calendar day (including days with no production) so gaps stay visible.
 *
 * Bucketed by PRODUCTION DATE — the slab's own per-slab date if it has one (a
 * batch past midnight), else the date on the batch setup, else the shift's own
 * — the same precedence every other Robo screen uses. See
 * lib/robo/productionDate.ts. It used to group by the shift's date, which put a
 * run entered three days late on the day it was typed, so this chart and the
 * KPI cards above it on the same page could show one slab under two days.
 *
 * All three series are DATE-based — no batch enters:
 *   slabs         — slabs whose production date is that date (Daily Production
 *                   Trend): exactly the rows Slab Records lists for the date;
 *   delayMins     — delay minutes on that date (Day-wise Delay Analysis);
 *   slabsPerHour  — that date's slabs ÷ the hours the Robo line ran that date
 *                   (Daily Slabs / Hour Trend), with those minutes as
 *                   `lineMinutes`. See lib/robo/dailyRate.ts.
 *
 * slabsPerHour used to divide by the open time of the date's RoboShift rows —
 * tablet plumbing, not production time, and an open one measured to the wall
 * clock — which read 19/09 as 279.3 slabs/hour. The hours now come from the
 * slabs' own In and Out times.
 */
export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 7, 1), 90);

  const now = new Date();

  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  // The day before the window: its overnight slabs come out after midnight, on
  // the window's first date, and that running time belongs to that date. Its
  // slabs are read for the line's hours only — no series counts them.
  const eve = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const dayBefore = `${eve.getFullYear()}-${pad(eve.getMonth() + 1)}-${pad(eve.getDate())}`;

  const window = { in: dates };
  const slabWindow = { in: [dayBefore, ...dates] };
  /* Every slab and delay whose production date falls in the window (the slabs
     from the day before too — read for the line's hours only), by the
     same precedence the rest of the module uses. The `in` form of each branch
     is the multi-date version of productionDateWhere — kept here rather than in
     that module because only this route asks about a set of days — and it leads
     with the slab's OWN per-slab date so a batch past midnight lands on the
     right day, with the fallback branches pinned to `productionDate: null`. */
  const [records, delays] = await Promise.all([
    prisma.roboProductionRecord.findMany({
      where: {
        OR: [
          { productionDate: slabWindow },
          { productionDate: null, batchRecipe: { productionDate: slabWindow } },
          { productionDate: null, batchRecipe: { productionDate: null }, shift: { date: slabWindow } },
          { productionDate: null, batchRecipe: { productionDate: "" }, shift: { date: slabWindow } },
          { productionDate: null, batchRecipe: null, shift: { date: slabWindow } },
        ],
      },
      select: {
        inTime: true,
        outTime: true,
        productionDate: true,
        batchRecipe: { select: { productionDate: true } },
        shift: { select: { date: true } },
      },
    }),
    prisma.roboDelayLog.findMany({
      where: {
        OR: [
          { productionRecord: { productionDate: window } },
          { productionRecord: { productionDate: null, batchRecipe: { productionDate: window } } },
          { productionRecord: { productionDate: null, batchRecipe: { productionDate: null } }, shift: { date: window } },
          { productionRecord: { productionDate: null, batchRecipe: { productionDate: "" } }, shift: { date: window } },
          { productionRecord: { productionDate: null, batchRecipe: null }, shift: { date: window } },
          { productionRecord: null, shift: { date: window } },
        ],
      },
      select: {
        durationMinutes: true,
        productionRecord: { select: { productionDate: true, batchRecipe: { select: { productionDate: true } }, shift: { select: { date: true } } } },
        shift: { select: { date: true } },
      },
    }),
  ]);

  const buckets: Record<string, { slabs: number; delayMins: number }> = {};
  for (const d of dates) buckets[d] = { slabs: 0, delayMins: 0 };

  for (const r of records) {
    const b = buckets[productionDateOf(r)];
    if (b) b.slabs += 1;
  }
  for (const d of delays) {
    const b = buckets[delayProductionDateOf(d)];
    if (b) b.delayMins += d.durationMinutes;
  }

  // The hours the Robo line ran on each date, from every slab's In and Out.
  const lineMinutes = lineMinutesByDate(
    records.map((r) => ({ productionDate: productionDateOf(r), inTime: r.inTime, outTime: r.outTime })),
  );

  const series = dates.map(d => {
    const b = buckets[d];
    const [, month, day] = d.split("-");
    const minutes = lineMinutes.get(d) ?? 0;
    return {
      date: d,
      label: `${day}/${month}`,
      slabs: b.slabs,
      delayMins: b.delayMins,
      slabsPerHour: dailySlabsPerHour(b.slabs, minutes),
      lineMinutes: minutes,
    };
  });

  return NextResponse.json({ days, series });
}
