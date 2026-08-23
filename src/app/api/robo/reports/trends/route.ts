import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { delayProductionDateOf, productionDateOf } from "@/lib/robo/productionDate";
import { roboGate } from "@/lib/rbac";

function pad(n: number): string { return String(n).padStart(2, "0"); }

function toMins(t: string): number {
  const [h, m] = (t || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

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
 * GET /api/robo/reports/trends?days=7|15|30
 * One row per calendar day (including days with no production) so gaps stay visible.
 *
 * Bucketed by PRODUCTION DATE — the date on the batch setup, falling back to
 * the shift's own — the same rule every other Robo screen uses. See
 * lib/robo/productionDate.ts. It used to group by the shift's date, which put a
 * run entered three days late on the day it was typed, so this chart and the
 * KPI cards above it on the same page could show one slab under two days.
 *
 * Line minutes still come off the shift, because that is what a shift records.
 * A shift is attributed to the production date MOST of its slabs carry: one
 * shift, one day, so no day's minutes are counted twice. In the ordinary case —
 * a run logged on the day it ran — that date is the shift's own and this is
 * exactly what it always was.
 */
export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 7, 1), 90);

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  const window = { in: dates };
  /* Every slab and delay whose production date falls in the window, by the
     same fallback the rest of the module uses. The `in` form of each branch is
     the multi-date version of productionDateWhere — kept here rather than in
     that module because only this route asks about a range. */
  const [records, delays] = await Promise.all([
    prisma.roboProductionRecord.findMany({
      where: {
        OR: [
          { batchRecipe: { productionDate: window } },
          { batchRecipe: { productionDate: null }, shift: { date: window } },
          { batchRecipe: { productionDate: "" }, shift: { date: window } },
          { batchRecipe: null, shift: { date: window } },
        ],
      },
      select: { shiftId: true, batchRecipe: { select: { productionDate: true } }, shift: { select: { date: true } } },
    }),
    prisma.roboDelayLog.findMany({
      where: {
        OR: [
          { productionRecord: { batchRecipe: { productionDate: window } } },
          { productionRecord: { batchRecipe: { productionDate: null } }, shift: { date: window } },
          { productionRecord: { batchRecipe: { productionDate: "" } }, shift: { date: window } },
          { productionRecord: { batchRecipe: null }, shift: { date: window } },
          { productionRecord: null, shift: { date: window } },
        ],
      },
      select: {
        durationMinutes: true,
        productionRecord: { select: { batchRecipe: { select: { productionDate: true } }, shift: { select: { date: true } } } },
        shift: { select: { date: true } },
      },
    }),
  ]);

  const buckets: Record<string, { slabs: number; delayMins: number; minutes: number }> = {};
  for (const d of dates) buckets[d] = { slabs: 0, delayMins: 0, minutes: 0 };

  // Which production date each shift's slabs mostly belong to, so its minutes
  // land on one day and only one.
  const shiftDayVotes = new Map<string, Map<string, number>>();
  for (const r of records) {
    const day = productionDateOf(r);
    const b = buckets[day];
    if (b) b.slabs += 1;
    const votes = shiftDayVotes.get(r.shiftId) ?? new Map<string, number>();
    votes.set(day, (votes.get(day) ?? 0) + 1);
    shiftDayVotes.set(r.shiftId, votes);
  }
  for (const d of delays) {
    const b = buckets[delayProductionDateOf(d)];
    if (b) b.delayMins += d.durationMinutes;
  }

  const shifts = shiftDayVotes.size > 0
    ? await prisma.roboShift.findMany({
        where: { id: { in: [...shiftDayVotes.keys()] } },
        select: { id: true, startTime: true, endTime: true, status: true },
      })
    : [];
  for (const s of shifts) {
    const votes = shiftDayVotes.get(s.id);
    if (!votes) continue;
    let day = "", best = -1;
    for (const [d, n] of votes) if (n > best || (n === best && d < day)) { day = d; best = n; }
    const b = buckets[day];
    if (b) b.minutes += shiftMinutes(s.startTime, s.endTime, s.status, nowMins);
  }

  const series = dates.map(d => {
    const b = buckets[d];
    const [, month, day] = d.split("-");
    return {
      date: d,
      label: `${day}/${month}`,
      slabs: b.slabs,
      delayMins: b.delayMins,
      slabsPerHour: b.minutes > 0 ? Math.round((b.slabs / (b.minutes / 60)) * 10) / 10 : 0,
    };
  });

  return NextResponse.json({ days, series });
}
