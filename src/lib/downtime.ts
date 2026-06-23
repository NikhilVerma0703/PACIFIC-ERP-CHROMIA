// Production downtime tracker from the MIS hourly log, plus real output and a
// capacity-based target.
//   - Downtime by type (process/cleaning/breakdown/power-out), reason, day, hour;
//     incident/RCA log; impossible (>60 min/hr) flag.
//   - Target = 24 slabs/hr x 21 productive hrs/day (24h - 3h planned cleaning) x days.
//     The rate blends PER HOUR by what ran (robo hours @ 12/hr, else 24/hr).
//   - Achievable = Target - lost output, where "lost" = unplanned downtime
//     (process+breakdown+power-out) PLUS cleaning beyond the 3 h/day baseline
//     (multiple SKU changes => extra cleaning => fewer productive hours).
//   - Actual = slabs pressed (reliable). MIS's own produced count is bad data.
//   - Flags batches PRESSED but with NO MIS entry (logging gap).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";

const db = prisma as any;

export const NORMAL_RATE = 24;       // slabs/hr (non-robo)
export const ROBO_RATE = 12;         // slabs/hr (robo)
export const HOURS_PER_DAY = 21;     // 24h - 3h planned cleaning
export const CLEAN_BASELINE_MIN = (24 - HOURS_PER_DAY) * 60; // 180 min/day "free" cleaning

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
  minutes: number; over: boolean; typeKeys: string[]; types: string[]; reasons: string[];
  details: string | null; rca: string | null; action: string | null; spares: string | null;
}
export interface DowntimeReport {
  from: string; to: string; batch: string | null; typeFilter: string | null;
  rows: number; hoursLogged: number; totalMinutes: number; overCap: number;
  byType: DelayType[]; byReason: ReasonRow[]; trend: TrendPoint[]; byHour: HourRow[]; incidents: IncidentRow[];
  actualSlabs: number; target: number; achievable: number; lost: number; designs: DesignRow[];
  daysCounted: number; roboHours: number; normalHours: number;
  pressBatches: number; misBatches: number; unloggedBatches: number; unloggedBatchList: string[];
}

const r0 = (n: number) => Math.round(n);
const dayKey = (d: any) => new Date(d).toISOString().slice(0, 10);
const isRobo = (t: unknown) => String(t ?? "").trim().toLowerCase() === "robo";

export async function getDowntimeReport(opts: { from?: string; to?: string; batch?: string; type?: string }): Promise<DowntimeReport> {
  // DB dates are naive IST (IST wall-clock stored as UTC). Build the window in IST
  // and cap the upper bound at "now", so "Today" runs 12am IST -> now (not the whole
  // calendar day, and never future-logged hours).
  const IST_MS = 330 * 60000;
  const istNow = new Date(Date.now() + IST_MS);
  const fromStr = (opts.from && opts.from.trim()) || istNow.toISOString().slice(0, 10);
  const toStr = (opts.to && opts.to.trim()) || istNow.toISOString().slice(0, 10);
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  let toEnd = new Date(`${toStr}T23:59:59.999Z`);
  if (toEnd > istNow) toEnd = istNow;
  const batch = opts.batch && opts.batch.trim() ? normalizeBatch(opts.batch) : null;
  const typeFilter = DELAY_FIELDS.some((d) => d.key === opts.type) ? opts.type! : null;

  const misWhere: any = batch ? { batchKey: batch } : { date: { gte: from, lte: toEnd } };
  const sel: any = { date: true, hour: true, batch: true, batchKey: true, productionType: true, reasonForDeviation: true, details: true, rcaNo: true, actionTaken: true, sparesUsed: true, anyBreakdownYesNo: true };
  for (const d of DELAY_FIELDS) sel[d.col] = true;
  const pressWhere: any = batch ? { batchKey: batch } : { date: { gte: from, lte: toEnd } };

  const [rows, press]: [any[], any[]] = await Promise.all([
    db.mis.findMany({ where: misWhere, select: sel }).catch(() => [] as any[]),
    db.press.findMany({ where: pressWhere, select: { slabNumber: true, designName: true, batchKey: true, date: true } }).catch(() => [] as any[]),
  ]);

  const byType: DelayType[] = DELAY_FIELDS.map((d) => ({ key: d.key, label: d.label, minutes: 0, incidents: 0 }));
  const reasonMap = new Map<string, ReasonRow>();
  const trendMap = new Map<string, number>();         // total stoppage minutes per day
  const cleanByDay = new Map<string, number>();        // cleaning minutes per day
  const otherByDay = new Map<string, number>();        // process+breakdown+power-out per day
  const hourMap = new Map<string, { minutes: number; incidents: number }>();
  const dayRobo = new Map<string, { robo: number; other: number }>();
  const incidents: IncidentRow[] = [];
  let totalMinutes = 0, hoursLogged = 0, overCap = 0, cleanTotal = 0, otherTotal = 0;

  for (const r of rows) {
    const day = r.date ? dayKey(r.date) : null;
    if (day) { const e = dayRobo.get(day) ?? { robo: 0, other: 0 }; if (isRobo(r.productionType)) e.robo++; else e.other++; dayRobo.set(day, e); }

    let rowMin = 0; const typeKeys: string[] = []; const types: string[] = [];
    DELAY_FIELDS.forEach((d, i) => {
      const v = Number(r[d.col] ?? 0);
      if (v > 0) { byType[i].minutes += v; byType[i].incidents++; rowMin += v; typeKeys.push(d.key); types.push(d.label); }
    });
    const cleanMin = Number(r.cleaningDelayDurationMinutes ?? 0) || 0;
    const otherMin = Math.max(0, rowMin - cleanMin);
    if (rowMin > 0) { totalMinutes += rowMin; hoursLogged++; cleanTotal += cleanMin; otherTotal += otherMin; }
    if (rowMin > 60) overCap++;
    if (day) {
      if (cleanMin > 0) cleanByDay.set(day, (cleanByDay.get(day) ?? 0) + cleanMin);
      if (otherMin > 0) otherByDay.set(day, (otherByDay.get(day) ?? 0) + otherMin);
    }

    const reasons: string[] = Array.isArray(r.reasonForDeviation)
      ? r.reasonForDeviation.filter((x: any) => x && String(x).toUpperCase() !== "NO DEVIATION")
      : [];
    for (const reason of reasons) {
      const e = reasonMap.get(reason) ?? { reason, incidents: 0, minutes: 0 };
      e.incidents++; e.minutes += rowMin; reasonMap.set(reason, e);
    }
    if (rowMin > 0 && day) trendMap.set(day, (trendMap.get(day) ?? 0) + rowMin);
    if (rowMin > 0 && r.hour) { const h = String(r.hour); const e = hourMap.get(h) ?? { minutes: 0, incidents: 0 }; e.minutes += rowMin; e.incidents++; hourMap.set(h, e); }

    const isBreakdown = String(r.anyBreakdownYesNo ?? "").toLowerCase().startsWith("y");
    if (rowMin > 0 || isBreakdown || r.rcaNo || r.details) {
      incidents.push({
        date: day, hour: r.hour ?? null, batch: r.batch ?? r.batchKey ?? null,
        minutes: r0(rowMin), over: rowMin > 60, typeKeys, types, reasons,
        details: r.details ?? null, rca: r.rcaNo ?? null, action: r.actionTaken ?? null, spares: r.sparesUsed ?? null,
      });
    }
  }

  // ---- output (actual) + designs from press ----
  const slabSet = new Set<number>();
  const designMap = new Map<string, Set<number>>();
  const pressBatchSet = new Set<string>();
  const pressDaySet = new Set<string>();
  for (const p of press) {
    if (p.batchKey) pressBatchSet.add(String(p.batchKey));
    if (p.date) pressDaySet.add(dayKey(p.date));
    const n = p.slabNumber;
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    slabSet.add(n);
    const dn = (p.designName ?? "").toString().trim() || "—";
    if (!designMap.has(dn)) designMap.set(dn, new Set());
    designMap.get(dn)!.add(n);
  }
  const actualSlabs = slabSet.size;
  const designs = [...designMap.entries()].map(([design, set]) => ({ design, slabs: set.size })).sort((a, b) => b.slabs - a.slabs);

  // ---- capacity target + achievable ----
  // Rate is PER HOUR by what ran (robo 12/hr, else 24/hr), so a day that switches
  // SKU/design blends; applied to 21 productive hrs/day. downtimeCost (slabs) =
  // unplanned downtime + cleaning beyond the 3 h/day baseline, at that day's rate.
  // Achievable = target - downtimeCost; reported Lost = Achievable - Actual.
  const blendRate = (robo: number, other: number) => (robo + other > 0 ? (robo * ROBO_RATE + other * NORMAL_RATE) / (robo + other) : NORMAL_RATE);
  let target = 0, downtimeCost = 0, roboHours = 0, normalHours = 0, daysCounted = 0;
  if (batch) {
    const roboR = rows.filter((r) => isRobo(r.productionType)).length;
    const normR = rows.length - roboR;
    const rate = blendRate(roboR, normR);
    daysCounted = pressDaySet.size || 1;
    target = rate * HOURS_PER_DAY * daysCounted;
    const lostMin = otherTotal + Math.max(0, cleanTotal - CLEAN_BASELINE_MIN * daysCounted);
    downtimeCost = rate * (lostMin / 60);
    roboHours = roboR; normalHours = normR;
  } else {
    for (let d = new Date(from); d <= toEnd; d = new Date(d.getTime() + 864e5)) {
      const day = dayKey(d);
      const e = dayRobo.get(day);
      const robo = e?.robo ?? 0, other = e?.other ?? 0;
      const rate = blendRate(robo, other);
      roboHours += robo; normalHours += other;
      daysCounted++;
      target += rate * HOURS_PER_DAY;
      const dayLostMin = (otherByDay.get(day) ?? 0) + Math.max(0, (cleanByDay.get(day) ?? 0) - CLEAN_BASELINE_MIN);
      downtimeCost += rate * (dayLostMin / 60);
    }
  }
  target = r0(target);
  const achievable = Math.max(0, target - r0(downtimeCost));
  const lost = Math.max(0, achievable - actualSlabs);

  // ---- MIS logging completeness: batches pressed but never logged in MIS ----
  const misBatchSet = new Set<string>();
  for (const r of rows) if (r.batchKey) misBatchSet.add(String(r.batchKey));
  const unloggedBatchList = [...pressBatchSet].filter((b) => !misBatchSet.has(b)).sort();

  // ---- finalize ----
  byType.forEach((t) => (t.minutes = r0(t.minutes)));
  const byReason = [...reasonMap.values()].map((x) => ({ ...x, minutes: r0(x.minutes) })).sort((a, b) => b.minutes - a.minutes || b.incidents - a.incidents);
  const trend = [...trendMap.entries()].map(([day, m]) => ({ day, minutes: r0(m) })).sort((a, b) => a.day.localeCompare(b.day));
  const hourNum = (h: string) => { const m = h.match(/\d+/); return m ? parseInt(m[0], 10) : 99; };
  const byHour = [...hourMap.entries()].map(([hour, v]) => ({ hour, minutes: r0(v.minutes), incidents: v.incidents })).sort((a, b) => hourNum(a.hour) - hourNum(b.hour));
  const shown = (typeFilter ? incidents.filter((i) => i.typeKeys.includes(typeFilter)) : incidents).sort((a, b) => b.minutes - a.minutes);

  return {
    from: fromStr, to: toStr, batch, typeFilter,
    rows: rows.length, hoursLogged, totalMinutes: r0(totalMinutes), overCap,
    byType, byReason, trend, byHour, incidents: shown.slice(0, 300),
    actualSlabs, target, achievable, lost, designs, daysCounted, roboHours, normalHours,
    pressBatches: pressBatchSet.size, misBatches: misBatchSet.size, unloggedBatches: unloggedBatchList.length, unloggedBatchList: unloggedBatchList.slice(0, 60),
  };
}

/** "750 min" -> "12h 30m" */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
