// Production downtime tracker, built from the MIS hourly log, plus output
// (slabs/designs made) from the real station data.
//   - Downtime minutes by type (process/cleaning/breakdown/power-out) and reason.
//   - "Achievable" & "Target" come from MIS (its own computed numbers).
//   - "Actual" slabs made + designs come from PRESS (reliable; MIS's own
//     numberOfSlabsProduced has bad rollup data, so we don't trust it).
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
export const DELAY_LABEL: Record<string, string> = Object.fromEntries(DELAY_FIELDS.map((d) => [d.key, d.label]));

export interface DelayType { key: string; label: string; minutes: number; incidents: number; }
export interface ReasonRow { reason: string; incidents: number; minutes: number; }
export interface TrendPoint { day: string; minutes: number; }
export interface HourRow { hour: string; minutes: number; incidents: number; }
export interface DesignRow { design: string; slabs: number; }
export interface IncidentRow {
  date: string | null; hour: string | null; batch: string | null;
  minutes: number; typeKeys: string[]; types: string[]; reasons: string[];
  details: string | null; rca: string | null; action: string | null; spares: string | null;
  over: boolean; // total delay > 60 min in a single hour = impossible (entry error)
}
export interface DowntimeReport {
  from: string; to: string; batch: string | null; typeFilter: string | null;
  rows: number; hoursLogged: number; totalMinutes: number; overCap: number;
  byType: DelayType[];
  byReason: ReasonRow[];
  trend: TrendPoint[];
  byHour: HourRow[];     // downtime by hour-of-day slot (e.g. "13 - 14")
  incidents: IncidentRow[];
  // production output
  actualSlabs: number;   // distinct slabs pressed in scope (reliable)
  achievable: number;    // MIS achievableSlabOutput (sum)
  target: number;        // MIS targetProduction (sum)
  lost: number;          // target - achievable = output lost to downtime, floored at 0
  designs: DesignRow[];  // designs made (from press) with slab counts
}

const r0 = (n: number) => Math.round(n);
/** Coerce a MIS JSON cell (number or numeric string like "22") to a number. */
function jnum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = parseFloat(v.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; }
  return 0;
}

export async function getDowntimeReport(opts: { from?: string; to?: string; batch?: string; type?: string }): Promise<DowntimeReport> {
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from ? new Date(opts.from) : new Date(Date.now() - 30 * 864e5);
  const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
  const batch = opts.batch && opts.batch.trim() ? normalizeBatch(opts.batch) : null;
  const typeFilter = DELAY_FIELDS.some((d) => d.key === opts.type) ? opts.type! : null;

  const misWhere: any = batch ? { batchKey: batch } : { date: { gte: from, lte: toEnd } };
  const sel: any = { date: true, hour: true, batch: true, batchKey: true, reasonForDeviation: true, details: true, rcaNo: true, actionTaken: true, sparesUsed: true, anyBreakdownYesNo: true, achievableSlabOutput: true, targetProduction: true };
  for (const d of DELAY_FIELDS) sel[d.col] = true;

  // press supplies the reliable "actual" output + designs
  const pressWhere: any = batch ? { batchKey: batch } : { date: { gte: from, lte: toEnd } };

  const [rows, press]: [any[], any[]] = await Promise.all([
    db.mis.findMany({ where: misWhere, select: sel }).catch(() => [] as any[]),
    db.press.findMany({ where: pressWhere, select: { slabNumber: true, designName: true } }).catch(() => [] as any[]),
  ]);

  const byType: DelayType[] = DELAY_FIELDS.map((d) => ({ key: d.key, label: d.label, minutes: 0, incidents: 0 }));
  const reasonMap = new Map<string, ReasonRow>();
  const trendMap = new Map<string, number>();
  const hourMap = new Map<string, { minutes: number; incidents: number }>();
  const incidents: IncidentRow[] = [];
  let totalMinutes = 0, hoursLogged = 0, achievable = 0, target = 0, overCap = 0;

  for (const r of rows) {
    achievable += jnum(r.achievableSlabOutput);
    target += jnum(r.targetProduction);

    let rowMin = 0; const typeKeys: string[] = []; const types: string[] = [];
    DELAY_FIELDS.forEach((d, i) => {
      const v = Number(r[d.col] ?? 0);
      if (v > 0) { byType[i].minutes += v; byType[i].incidents++; rowMin += v; typeKeys.push(d.key); types.push(d.label); }
    });
    if (rowMin > 0) { totalMinutes += rowMin; hoursLogged++; }
    if (rowMin > 60) overCap++;

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
    if (rowMin > 0 && r.hour) {
      const h = String(r.hour); const e = hourMap.get(h) ?? { minutes: 0, incidents: 0 };
      e.minutes += rowMin; e.incidents++; hourMap.set(h, e);
    }
    const isBreakdown = String(r.anyBreakdownYesNo ?? "").toLowerCase().startsWith("y");
    if (rowMin > 0 || isBreakdown || r.rcaNo || r.details) {
      incidents.push({
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        hour: r.hour ?? null, batch: r.batch ?? r.batchKey ?? null,
        minutes: r0(rowMin), over: rowMin > 60, typeKeys, types, reasons,
        details: r.details ?? null, rca: r.rcaNo ?? null, action: r.actionTaken ?? null, spares: r.sparesUsed ?? null,
      });
    }
  }

  // actual output + designs from press (distinct slab numbers)
  const slabSet = new Set<number>();
  const designMap = new Map<string, Set<number>>();
  for (const p of press) {
    const n = p.slabNumber;
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    slabSet.add(n);
    const dn = (p.designName ?? "").toString().trim() || "—";
    if (!designMap.has(dn)) designMap.set(dn, new Set());
    designMap.get(dn)!.add(n);
  }
  const actualSlabs = slabSet.size;
  const designs = [...designMap.entries()].map(([design, set]) => ({ design, slabs: set.size })).sort((a, b) => b.slabs - a.slabs);

  byType.forEach((t) => (t.minutes = r0(t.minutes)));
  const byReason = [...reasonMap.values()].map((x) => ({ ...x, minutes: r0(x.minutes) })).sort((a, b) => b.minutes - a.minutes || b.incidents - a.incidents);
  const trend = [...trendMap.entries()].map(([day, m]) => ({ day, minutes: r0(m) })).sort((a, b) => a.day.localeCompare(b.day));
  const hourNum = (h: string) => { const m = h.match(/\d+/); return m ? parseInt(m[0], 10) : 99; };
  const byHour = [...hourMap.entries()].map(([hour, v]) => ({ hour, minutes: r0(v.minutes), incidents: v.incidents })).sort((a, b) => hourNum(a.hour) - hourNum(b.hour));

  const shown = (typeFilter ? incidents.filter((i) => i.typeKeys.includes(typeFilter)) : incidents).sort((a, b) => b.minutes - a.minutes);

  return {
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), batch, typeFilter,
    rows: rows.length, hoursLogged, totalMinutes: r0(totalMinutes), overCap,
    byType, byReason, trend, byHour, incidents: shown.slice(0, 300),
    actualSlabs, achievable: r0(achievable), target: r0(target), lost: Math.max(0, r0(target - achievable)), designs,
  };
}

/** "750 min" -> "12h 30m" */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
