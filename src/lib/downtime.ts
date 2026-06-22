// Production downtime tracker, built from the MIS hourly log.
// Each MIS row is one hour of a batch with delay-type minutes (process / cleaning
// / breakdown / power-out) and reason(s) for deviation. This aggregates downtime
// over a date range (or one batch) for the /mis dashboard.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";

const db = prisma as any;

export const DELAY_FIELDS = [
  { key: "process", label: "Process delay", col: "processDelayDurationMinutes" },
  { key: "cleaning", label: "Cleaning", col: "cleaningDelayDurationMinutes" },
  { key: "breakdown", label: "Breakdown (mech/elec)", col: "breakdownDelayDurationMechanicalOrElectricalMinutes" },
  { key: "powerout", label: "Power-out", col: "poweroutDelayDurationMinutes" },
] as const;

export interface DelayType { key: string; label: string; minutes: number; incidents: number; }
export interface ReasonRow { reason: string; incidents: number; minutes: number; }
export interface TrendPoint { day: string; minutes: number; }
export interface IncidentRow {
  date: string | null; hour: string | null; batch: string | null;
  minutes: number; types: string[]; reasons: string[];
  details: string | null; rca: string | null; action: string | null; spares: string | null;
}
export interface DowntimeReport {
  from: string; to: string; batch: string | null;
  rows: number;            // MIS hourly rows in scope
  hoursLogged: number;     // rows that carry ANY downtime
  totalMinutes: number;
  byType: DelayType[];
  byReason: ReasonRow[];   // sorted by minutes desc (minutes = cited-minutes, may overlap when an hour lists 2 reasons)
  trend: TrendPoint[];     // downtime minutes per day
  incidents: IncidentRow[];
}

const r0 = (n: number) => Math.round(n);

export async function getDowntimeReport(opts: { from?: string; to?: string; batch?: string }): Promise<DowntimeReport> {
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from ? new Date(opts.from) : new Date(Date.now() - 30 * 864e5);
  const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
  const batch = opts.batch && opts.batch.trim() ? normalizeBatch(opts.batch) : null;

  const where: any = batch ? { batchKey: batch } : { date: { gte: from, lte: toEnd } };
  const sel: any = { date: true, hour: true, batch: true, batchKey: true, reasonForDeviation: true, details: true, rcaNo: true, actionTaken: true, sparesUsed: true, anyBreakdownYesNo: true };
  for (const d of DELAY_FIELDS) sel[d.col] = true;
  const rows: any[] = await db.mis.findMany({ where, select: sel }).catch(() => [] as any[]);

  const byType: DelayType[] = DELAY_FIELDS.map((d) => ({ key: d.key, label: d.label, minutes: 0, incidents: 0 }));
  const reasonMap = new Map<string, ReasonRow>();
  const trendMap = new Map<string, number>();
  const incidents: IncidentRow[] = [];
  let totalMinutes = 0, hoursLogged = 0;

  for (const r of rows) {
    let rowMin = 0; const types: string[] = [];
    DELAY_FIELDS.forEach((d, i) => {
      const v = Number(r[d.col] ?? 0);
      if (v > 0) { byType[i].minutes += v; byType[i].incidents++; rowMin += v; types.push(d.label); }
    });
    if (rowMin > 0) { totalMinutes += rowMin; hoursLogged++; }

    const reasons: string[] = Array.isArray(r.reasonForDeviation)
      ? r.reasonForDeviation.filter((x: any) => x && String(x).toUpperCase() !== "NO DEVIATION")
      : [];
    for (const reason of reasons) {
      const e = reasonMap.get(reason) ?? { reason, incidents: 0, minutes: 0 };
      e.incidents++; e.minutes += rowMin; reasonMap.set(reason, e);
    }

    if (rowMin > 0 && r.date) {
      const day = new Date(r.date).toISOString().slice(0, 10);
      trendMap.set(day, (trendMap.get(day) ?? 0) + rowMin);
    }

    const isBreakdown = String(r.anyBreakdownYesNo ?? "").toLowerCase().startsWith("y");
    if (rowMin > 0 || isBreakdown || r.rcaNo || r.details) {
      incidents.push({
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        hour: r.hour ?? null, batch: r.batch ?? r.batchKey ?? null,
        minutes: r0(rowMin), types, reasons,
        details: r.details ?? null, rca: r.rcaNo ?? null, action: r.actionTaken ?? null, spares: r.sparesUsed ?? null,
      });
    }
  }

  byType.forEach((t) => (t.minutes = r0(t.minutes)));
  const byReason = [...reasonMap.values()].map((x) => ({ ...x, minutes: r0(x.minutes) }))
    .sort((a, b) => b.minutes - a.minutes || b.incidents - a.incidents);
  const trend = [...trendMap.entries()].map(([day, m]) => ({ day, minutes: r0(m) })).sort((a, b) => a.day.localeCompare(b.day));
  incidents.sort((a, b) => b.minutes - a.minutes);

  return {
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), batch,
    rows: rows.length, hoursLogged, totalMinutes: r0(totalMinutes),
    byType, byReason, trend, incidents: incidents.slice(0, 200),
  };
}

/** "750 min" -> "12h 30m" */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
