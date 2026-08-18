import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
 */
export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 7, 1), 90);

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  const shifts = await prisma.roboShift.findMany({
    where: { date: { in: dates } },
    select: {
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      _count: { select: { productionRecords: true } },
      delayLogs: { select: { durationMinutes: true } },
    },
  });

  const buckets: Record<string, { slabs: number; delayMins: number; minutes: number }> = {};
  for (const d of dates) buckets[d] = { slabs: 0, delayMins: 0, minutes: 0 };

  for (const s of shifts) {
    const b = buckets[s.date];
    if (!b) continue;
    b.slabs += s._count.productionRecords;
    b.delayMins += s.delayLogs.reduce((sum, d) => sum + d.durationMinutes, 0);
    b.minutes += shiftMinutes(s.startTime, s.endTime, s.status, nowMins);
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
