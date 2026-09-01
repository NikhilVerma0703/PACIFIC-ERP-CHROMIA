// Production downtime tracker from the MIS hourly log, plus real output and a
// capacity-based target.
//   - Downtime by type (process/cleaning/breakdown/power-out), reason, day, hour;
//     incident/RCA log; impossible (>60 min/hr) flag.
//   - Target = rate x 21 productive hrs/day (24h - 3h planned cleaning) x days, where the
//     rate for a day is the mean "Slabs/hr Std" operators entered THAT DAY. A day with no
//     Std falls back to the older blend of robo hours @ 12/hr, else 24/hr.
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

// Constants/formatters live in downtimeShared (client-importable); re-exported here
// so the existing server-side importers keep their import path.
export { DELAY_FIELDS, DELAY_LABEL, fmtDur } from "@/lib/downtimeShared";
import { DELAY_FIELDS } from "@/lib/downtimeShared";

export interface DelayType { key: string; label: string; minutes: number; incidents: number; }
export interface ReasonRow { reason: string; incidents: number; minutes: number; }
export interface TrendPoint { day: string; minutes: number; }
export interface HourRow { hour: string; minutes: number; incidents: number; }
export interface DesignRow { design: string; slabs: number; }
export interface IncidentRow {
  id: string; date: string | null; hour: string | null; batch: string | null;
  minutes: number; over: boolean; typeKeys: string[]; types: string[]; reasons: string[];
  details: string | null; rca: string | null; action: string | null; spares: string | null;
  elecIncharge: string | null; mechIncharge: string | null;
  minutesByType: Record<string, number>; reasonsByType: Record<string, string[]>;
}
export interface DowntimeReport {
  from: string; to: string; batch: string | null; typeFilter: string | null;
  rows: number; hoursLogged: number; totalMinutes: number; overCap: number;
  /** Incident rows the range holds, UNFILTERED. `incidents` is capped for the page
   *  payload, so a caller showing an unfiltered count must use this rather than
   *  incidents.length. Under a type filter it is the wrong denominator — the true
   *  per-type count is byType[i].incidents, which is aggregated over every row. */
  incidentsTotal: number;
  /** Slabs/hr the target was built from: the mean Std operators entered, or null when the
   *  range carries none (then the old robo/normal blend was used). Shown on the page so
   *  the figure can always be traced to a number somebody typed. */
  stdRate: number | null;
  stdHours: number;   // hours in the range that carried a Std
  ratedHours: number; // hours in the range at all (stdHours/ratedHours = coverage)
  byType: DelayType[]; byReason: ReasonRow[]; trend: TrendPoint[]; byHour: HourRow[]; incidents: IncidentRow[];
  actualSlabs: number; target: number; achievable: number; lost: number; designs: DesignRow[];
  misFallbackSlabs: number; misFallbackDays: number; // days with MIS hours but no press rows yet (entry lag)
  daysCounted: number; productiveHours: number; roboHours: number; normalHours: number;
  pressBatches: number; misBatches: number; unloggedBatches: number; unloggedBatchList: string[];
}

const r0 = (n: number) => Math.round(n);
/** The `date` column's own label. It is the IST day stored at UTC midnight, so
 *  reading it back with toISOString is exact — this is a LABEL, not an instant. */
const dayKey = (d: any) => new Date(d).toISOString().slice(0, 10);
/** n days from a day label. UTC arithmetic: a label has no 23- or 25-hour variant. */
const addDays = (key: string, n: number) =>
  new Date(Date.parse(`${key}T00:00:00.000Z`) + n * 864e5).toISOString().slice(0, 10);
/**
 * THE PRODUCTION DAY A LOGGED HOUR BELONGS TO, 06:00→06:00 IST.
 *
 * The MIS sheet files an hour under its `date` column plus its hour label, and
 * stores the 00–05 slots against the NEXT date — so a night that began on the
 * 18th carries date = 19th for its last six hours. Keying on the date column
 * alone therefore split every night in half and charged the small hours to a
 * day whose shift never worked them. This is the same rule the entry sheet
 * itself uses (wantDay in app/entry/mis/page.tsx) and the same day the CEO
 * report means.
 */
const reportDayOf = (dateCol: any, hour: unknown): string | null => {
  if (!dateCol) return null;
  const key = dayKey(dateCol);
  const h = hour ? Number(String(hour).slice(0, 2)) : NaN;
  return Number.isFinite(h) && h < 6 ? addDays(key, -1) : key;
};
// Reasons are one multiselect, not tagged to a delay type — classify by keyword so a
// type-filtered row can show only ITS reasons (e.g. breakdown: the machine failures,
// not MATERIAL DELAY). Unmatched reasons fall to "process".
export const classifyReason = (r: string): string => {
  const u = r.toUpperCase();
  if (u.includes("CLEANING")) return "cleaning";
  if (u.includes("POWER SHUTDOWN") || u.includes("POWER OUT")) return "powerout";
  if (u.includes("ELECTRICAL") || u.includes("MECHANICAL") || u.includes("FAULT ALARM") || u.includes("HMI") || u.includes("BELT DAMAGE")) return "breakdown";
  return "process";
};
/** The production day a PRESS instant falls on. press.date holds IST wall
 *  clock, so shifting back six hours and taking the date part puts 00:00-05:59
 *  on the night that began the day before — the same day reportDayOf gives the
 *  MIS row for those hours. Both sides of this report must answer "which day"
 *  the same way or the fallback below compares two different calendars. */
const pressDayOf = (d: any) => new Date(new Date(d).getTime() - 6 * 3600e3).toISOString().slice(0, 10);

const isRobo = (t: unknown) => String(t ?? "").trim().toLowerCase() === "robo";

export async function getDowntimeReport(opts: { from?: string; to?: string; batch?: string; type?: string; allIncidents?: boolean }): Promise<DowntimeReport> {
  // DB dates are naive IST (IST wall-clock stored as UTC). Build the window in IST
  // and cap the upper bound at "now", so "Today" runs 12am IST -> now (not the whole
  // calendar day, and never future-logged hours).
  const IST_MS = 330 * 60000;
  const istNow = new Date(Date.now() + IST_MS);
  // The PRODUCTION day, 06:00→06:00 IST — the day the CEO report means, and the
  // day the plant means. Before 06:00 the running night still belongs to
  // yesterday's sheet, so "today" is yesterday's date until the shift ends.
  const todayKey = new Date(Date.now() + (330 - 360) * 60000).toISOString().slice(0, 10);
  const fromStrRaw = (opts.from && opts.from.trim()) || todayKey;
  const toStrRaw = (opts.to && opts.to.trim()) || todayKey;
  // A production day that has not begun cannot be reported on.
  const toStr = toStrRaw > todayKey ? todayKey : toStrRaw;
  // `from` is NOT clamped. It was briefly, to stop a caller on the IST calendar
  // day passing a `from` past the clamped `to`; all three callers compute
  // production days now, so the only thing that clamp could still do was
  // silently rewrite a range somebody typed — a mistyped 2026-10-01 came back
  // as today's incidents, targets and downtime printed under October's dates,
  // which is worse than the visibly-empty report an impossible range gives.
  const fromStr = fromStrRaw;
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  // The FETCH runs one day past the range: an hour of the last night carries
  // the next date in its `date` column (the 00–05 slots), and dropping it
  // would silently shorten the very night the range asked for. Rows are then
  // placed by reportDayOf and anything outside [fromStr, toStr] is discarded —
  // including the small hours of the night BEFORE the range, which carry
  // fromStr in their date column but belong to the day before it.
  const fetchTo = new Date(`${addDays(toStr, 1)}T23:59:59.999Z`);
  const batch = opts.batch && opts.batch.trim() ? normalizeBatch(opts.batch) : null;
  const typeFilter = DELAY_FIELDS.some((d) => d.key === opts.type) ? opts.type! : null;

  const misWhere: any = batch ? { batchKey: batch } : { date: { gte: from, lte: fetchTo } };
  const sel: any = { id: true, date: true, hour: true, batch: true, batchKey: true, productionType: true, slabsPerHourActual: true, slabsPerHourStd: true, design: true, reasonForDeviation: true, details: true, rcaNo: true, actionTaken: true, sparesUsed: true, anyBreakdownYesNo: true, electricalInchargeName: true, mechanicalInchargeName: true };
  for (const d of DELAY_FIELDS) sel[d.col] = true;
  // PRESS IS WINDOWED ON THE PRODUCTION DAY TOO. press.date is not a day label
  // — it is a real instant (only 22 of 32,307 rows sit at midnight; mis.date by
  // contrast is a label, 6,525 of 7,064 at midnight), stored as IST wall clock.
  // Leaving it on calendar days while the MIS rows moved to 06:00→06:00 split
  // the report down the middle: the target and downtime covered one window and
  // the output another, and the entry-lag fallback below — which is armed by
  // comparing press days against row days — fired on days that already had
  // press rows and added them a second time. August read 6,991 slabs where the
  // line pressed 6,082.
  const pressWhere: any = batch ? { batchKey: batch }
    : { date: { gte: new Date(`${fromStr}T06:00:00.000Z`), lt: new Date(`${addDays(toStr, 1)}T06:00:00.000Z`) } };

  const [rowsRaw, press]: [any[], any[]] = await Promise.all([
    db.mis.findMany({ where: misWhere, select: sel }).catch(() => [] as any[]),
    db.press.findMany({ where: pressWhere, select: { slabNumber: true, designName: true, batchKey: true, date: true } }).catch(() => [] as any[]),
  ]);

  // Each row placed on the production day it was worked, then clipped to the
  // range asked for. `reportDay` rides on the row so nothing downstream has to
  // re-derive it (and cannot re-derive it differently). Batch mode is not
  // clipped — a batch runs across whatever days it runs across, which is the
  // same reason its query ignores the date range.
  const rows: any[] = rowsRaw
    .map((r) => ({ ...r, reportDay: reportDayOf(r.date, r.hour) }))
    .filter((r) => batch || (r.reportDay != null && r.reportDay >= fromStr && r.reportDay <= toStr));

  const byType: DelayType[] = DELAY_FIELDS.map((d) => ({ key: d.key, label: d.label, minutes: 0, incidents: 0 }));
  const reasonMap = new Map<string, ReasonRow>();
  const trendMap = new Map<string, number>();         // total stoppage minutes per day
  const cleanByDay = new Map<string, number>();        // cleaning minutes per day
  const otherByDay = new Map<string, number>();        // process+breakdown+power-out per day
  const hourMap = new Map<string, { minutes: number; incidents: number }>();
  const dayRobo = new Map<string, { robo: number; other: number }>();
  // Std entered on the MIS form, per day and overall. Nobody entered one before
  // 2026-07-09; since then it is filled on roughly half the hours. The per-day mean rates
  // that day (capacity block below); the overall mean is used only by batch mode and to
  // report coverage on the page.
  const dayStd = new Map<string, { sum: number; n: number }>();
  let stdSum = 0, stdN = 0;
  const incidents: IncidentRow[] = [];
  let totalMinutes = 0, hoursLogged = 0, overCap = 0, cleanTotal = 0, otherTotal = 0;

  for (const r of rows) {
    const day: string | null = r.reportDay ?? null;
    if (day) { const e = dayRobo.get(day) ?? { robo: 0, other: 0 }; if (isRobo(r.productionType)) e.robo++; else e.other++; dayRobo.set(day, e); }
    const std = Number(r.slabsPerHourStd ?? 0);
    if (Number.isFinite(std) && std > 0) {
      stdSum += std; stdN++;
      if (day) { const e = dayStd.get(day) ?? { sum: 0, n: 0 }; e.sum += std; e.n++; dayStd.set(day, e); }
    }

    let rowMin = 0; const typeKeys: string[] = []; const types: string[] = [];
    const minutesByType: Record<string, number> = {};
    DELAY_FIELDS.forEach((d, i) => {
      const v = Number(r[d.col] ?? 0);
      if (v > 0) { byType[i].minutes += v; byType[i].incidents++; rowMin += v; typeKeys.push(d.key); types.push(d.label); minutesByType[d.key] = r0(v); }
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
    const reasonsByType: Record<string, string[]> = {};
    for (const reason of reasons) (reasonsByType[classifyReason(reason)] ??= []).push(reason);
    for (const reason of reasons) {
      const e = reasonMap.get(reason) ?? { reason, incidents: 0, minutes: 0 };
      e.incidents++; e.minutes += rowMin; reasonMap.set(reason, e);
    }
    if (rowMin > 0 && day) trendMap.set(day, (trendMap.get(day) ?? 0) + rowMin);
    if (rowMin > 0 && r.hour) { const h = String(r.hour); const e = hourMap.get(h) ?? { minutes: 0, incidents: 0 }; e.minutes += rowMin; e.incidents++; hourMap.set(h, e); }

    const isBreakdown = String(r.anyBreakdownYesNo ?? "").toLowerCase().startsWith("y");
    if (rowMin > 0 || isBreakdown || r.rcaNo || r.details) {
      incidents.push({
        id: r.id, date: day, hour: r.hour ?? null, batch: r.batch ?? r.batchKey ?? null,
        minutes: r0(rowMin), over: rowMin > 60, typeKeys, types, reasons,
        details: r.details ?? null, rca: r.rcaNo ?? null, action: r.actionTaken ?? null, spares: r.sparesUsed ?? null,
        elecIncharge: r.electricalInchargeName ?? null, mechIncharge: r.mechanicalInchargeName ?? null,
        minutesByType, reasonsByType,
      });
    }
  }

  // ---- output (actual) + designs from press ----
  const slabSet = new Set<number>();
  const designMap = new Map<string, Set<number>>();
  const pressBatchSet = new Set<string>();
  const pressDaySet = new Set<string>();
  // The CALENDAR dates press rows carry, kept beside the production days above.
  // Two questions here were always asked of the calendar and still must be:
  // "has this day's press been entered at all yet" (the entry-lag fallback) and
  // "how many days did this batch run" (the batch target's multiplier). A
  // production day is not interchangeable with a calendar date for either —
  // see the two comments below.
  const pressCalendarDays = new Set<string>();
  /** Which production day each pressed slab was recorded on. */
  const pressDayBySlab = new Map<number, string>();
  for (const p of press) {
    if (p.batchKey) pressBatchSet.add(String(p.batchKey));
    if (p.date) { pressDaySet.add(pressDayOf(p.date)); pressCalendarDays.add(dayKey(p.date)); }
    const n = p.slabNumber;
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    slabSet.add(n);
    if (p.date) pressDayBySlab.set(n, pressDayOf(p.date));
    const dn = (p.designName ?? "").toString().trim() || "—";
    if (!designMap.has(dn)) designMap.set(dn, new Set());
    designMap.get(dn)!.add(n);
  }
  // ---- MIS fallback for days press hasn't been entered yet ----
  // Press entry lags production by ~a day (measured avg ~8h, max ~4 days), so an
  // in-progress "Today" has NO press rows dated in-range: actual reads 0 and "lost"
  // claims the whole day. For days that have MIS hours but no press rows, use the
  // operator-typed MIS hourly actuals as a provisional figure — the card says so —
  // and the day switches to the press count automatically once entries land.
  // Skipped in batch-filter mode, where MIS spans days press legitimately lacks.
  //
  // ENTRY LAG IS A CALENDAR FACT, AND THE FALLBACK REPLACES RATHER THAN ADDS.
  // Two things went wrong when the day key moved. First the question: "has this
  // day's press been entered yet" is answered by whether press carries rows
  // DATED that day, which is a calendar question — on the production key, the
  // handful of rows a late bulk entry stamps between 00:00 and 06:00 count as
  // that day's press and disarm the net. 18 August is the case: nothing was
  // dated the 18th, 47 rows were typed after midnight on the 19th, and the day
  // scored 47 against the 241 its own report shows. Second the arithmetic: the
  // fallback was ADDED to the press count, so a day that had both leaked rows
  // and a fallback counted them twice — that was the 887 slabs August gained.
  // A day is now scored EITHER by its press rows OR, when press has not landed,
  // by the shift's own hourly actuals; never by both.
  let misFallbackSlabs = 0;
  const misFallbackDaySet = new Set<string>();
  const misDesign = new Map<string, number>();
  const laggingDays = new Set<string>();
  if (!batch) {
    for (const r of rows) {
      if (!r.reportDay) continue;
      // The day's press is "not in yet" only when NOTHING carries its date.
      if (pressCalendarDays.has(r.reportDay)) continue;
      laggingDays.add(r.reportDay);
    }
    for (const r of rows) {
      if (!r.reportDay || !laggingDays.has(r.reportDay)) continue;
      const n = Number(r.slabsPerHourActual ?? 0) || 0;
      if (n <= 0) continue;
      misFallbackSlabs += n;
      misFallbackDaySet.add(r.reportDay);
      const dn = (r.design ?? "").toString().trim() || "—";
      misDesign.set(dn, (misDesign.get(dn) ?? 0) + n);
    }
  }
  misFallbackSlabs = r0(misFallbackSlabs);
  // Press slabs from the lagging days are dropped, not added to: those days are
  // reported from the MIS figure instead, so nothing is counted twice.
  const pressSlabsCounted = laggingDays.size
    ? [...slabSet].filter((n) => { const d = pressDayBySlab.get(n); return !d || !laggingDays.has(d); }).length
    : slabSet.size;
  const actualSlabs = pressSlabsCounted + misFallbackSlabs;
  const designs = [...designMap.entries()].map(([design, set]) => ({ design, slabs: set.size }));
  for (const [design, slabs] of misDesign) {
    const e = designs.find((d) => d.design === design);
    if (e) e.slabs += r0(slabs); else designs.push({ design, slabs: r0(slabs) });
  }
  designs.sort((a, b) => b.slabs - a.slabs);

  // ---- capacity target + achievable ----
  // The rate is the "Slabs/hr Std" operators enter on the MIS form. It used to be
  // hardcoded (24/hr normal, 12/hr robo) and ignored the entered Std entirely. Measured
  // on 2026-07-01..25: the old blend came out at 20.5/hr against a recorded mean of
  // 14.1/hr, so target fell 10,673 -> 7,713 (1.38x) when this changed. "Lost to downtime"
  // moves far more, because it is a RESIDUAL (achievable - actual): 3,845 -> 1,537 on
  // that range, and 2,568 -> 259 over the Std era alone. Expect that figure to look very
  // different, and do not compare it across 9 July.
  //
  // A day is rated by the mean of ITS OWN filled hours; the blank ones ride along on it.
  // A day with no Std at all falls back to the old robo/normal blend -- deliberately NOT
  // to the range mean. Nobody entered a Std before 2026-07-09, and borrowing July's
  // average to rate March would both invent a standard for months nobody measured and
  // make a month's target shift depending on what else the selected range happened to
  // include. So in the DATE-RANGE view a given day rates the same in every view, and a
  // range spanning 9 July openly mixes the two bases.
  //
  // BATCH mode is different and knowingly so: it has no per-day loop, so it applies one
  // batch-wide mean to every hour of the batch, including days that recorded no Std. A
  // batch straddling 9 July will therefore rate its pre-Std days differently here than
  // the date-range view does. Splitting batch mode by day would be the fix if that ever
  // matters.
  //
  // Everything else is unchanged: 21 productive hrs/day, cleaning beyond the 3 h/day
  // baseline charged as downtime, Achievable = target - downtimeCost, Lost = Achievable
  // - Actual.
  const fallbackRate = (robo: number, other: number) => (robo + other > 0 ? (robo * ROBO_RATE + other * NORMAL_RATE) / (robo + other) : NORMAL_RATE);
  const rangeStd = stdN > 0 ? stdSum / stdN : null;
  /** Rate for a day: the mean Std entered ON THAT DAY, else the old robo/normal blend. */
  const rateFor = (day: string | null, robo: number, other: number) => {
    if (day) { const e = dayStd.get(day); if (e && e.n > 0) return e.sum / e.n; }
    return fallbackRate(robo, other);
  };
  let target = 0, downtimeCost = 0, roboHours = 0, normalHours = 0, daysCounted = 0, productiveHours = 0;
  // For an in-progress "Today", prorate productive hours + cleaning baseline to the
  // part of the day elapsed (IST), so a full-day target isn't set against a part-day actual.
  //
  // WHOLE COMPLETED HOURS, not the raw clock fraction. MIS is one row per FINISHED
  // hour, so `actual` can only ever cover completed hours. Accruing target across
  // the hour currently in progress charged up to a full hour of target against
  // production that cannot have been reported yet, so the same shift read worse at
  // :55 than at :05 and the number moved with the clock rather than the line.
  // Elapsed since the production day BEGAN — 06:00 IST, not midnight. On the
  // midnight clock the night shift's first eight hours counted as yesterday's
  // tail and today read as barely started at 06:00, so a full night's output
  // was measured against a couple of hours of target.
  const elapsedHours = Math.floor(
    (istNow.getTime() - IST_MS - (Date.parse(`${todayKey}T00:00:00.000Z`) - IST_MS + 6 * 3600e3)) / 3600e3);
  const elapsedFrac = Math.min(1, Math.max(0, elapsedHours / 24));
  if (batch) {
    const roboR = rows.filter((r) => isRobo(r.productionType)).length;
    const normR = rows.length - roboR;
    // Batch mode has no per-day loop: use the Std entered on this batch's own hours.
    const rate = rangeStd ?? fallbackRate(roboR, normR);
    // CALENDAR dates, not production days. This is the multiplier on a target
    // of "rate x 21 productive hours x days", and a batch that runs one date
    // start to finish touches ONE date but TWO production days, because it
    // straddles 06:00 — so the production key doubled the target for the
    // plant's commonest pattern. Batch 1429 ran 00:02 to 23:57 on 28 August and
    // was charged 42 productive hours and a 177-slab shortfall it had actually
    // beaten. 79 of 227 batches since January gained a day this way.
    daysCounted = pressCalendarDays.size || 1;
    target = rate * HOURS_PER_DAY * daysCounted;
    const lostMin = otherTotal + Math.max(0, cleanTotal - CLEAN_BASELINE_MIN * daysCounted);
    downtimeCost = rate * (lostMin / 60);
    roboHours = roboR; normalHours = normR; productiveHours = HOURS_PER_DAY * daysCounted;
  } else {
    // One iteration per PRODUCTION day in the range, by label — the same days
    // the rows above were placed on.
    for (let day = fromStr; day <= toStr; day = addDays(day, 1)) {
      const e = dayRobo.get(day);
      const robo = e?.robo ?? 0, other = e?.other ?? 0;
      const rate = rateFor(day, robo, other);
      const frac = day === todayKey ? elapsedFrac : 1; // prorate the in-progress day
      roboHours += robo; normalHours += other;
      daysCounted++;
      const dayHours = HOURS_PER_DAY * frac;
      productiveHours += dayHours;
      target += rate * dayHours;
      const dayLostMin = (otherByDay.get(day) ?? 0) + Math.max(0, (cleanByDay.get(day) ?? 0) - CLEAN_BASELINE_MIN * frac);
      downtimeCost += rate * (dayLostMin / 60);
    }
  }
  target = r0(target);
  productiveHours = Math.round(productiveHours * 10) / 10;
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
  // Same clock as the incident log above: the hour chart runs 06 -> 05, the
  // order the production day is worked, not 00 -> 23.
  // hourNum returns 99 for a label with no digits, precisely so an unlabelled
  // row sorts last. Rotating it would fold 99 onto rank 21 — the same rank as
  // "03 - 04" — and bury the row in the middle of the night shift. It is ranked
  // past the end of the day instead, which is where it was before the rotation.
  const dayRank = (h: string) => { const n = hourNum(h); return n > 23 ? 24 : (n + 18) % 24; };
  const byHour = [...hourMap.entries()].map(([hour, v]) => ({ hour, minutes: r0(v.minutes), incidents: v.incidents })).sort((a, b) => dayRank(a.hour) - dayRank(b.hour));
  // Incidents are returned UNFILTERED by type: the log card filters client-side (a chip
  // click must not navigate — a searchParams change re-keys the page segment, the root
  // loading skeleton swaps in and the collapse throws the scroll to the top). The Excel
  // export applies typeFilter itself, server-side, to match whatever view requested it.
  // ROTATED SO 06:00 LEADS THE DAY. `date` is the production day now, which
  // runs 06:00 to 06:00 — so within one day the hours run 06,07…23,00…05, and
  // the raw hour number puts that last stretch (the small hours of the night
  // shift) at the FRONT of the day it belongs to the end of.
  const shown = incidents.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || dayRank(a.hour ?? "") - dayRank(b.hour ?? ""));

  return {
    from: fromStr, to: toStr, batch, typeFilter,
    rows: rows.length, hoursLogged, totalMinutes: r0(totalMinutes), overCap,
    byType, byReason, trend, byHour,
    // The page caps the list to keep its payload sane; the export asks for all of them,
    // because a downloaded file that silently stops at 300 rows is worse than a big one.
    incidents: opts.allIncidents ? shown : shown.slice(0, 300),
    incidentsTotal: shown.length,
    stdRate: rangeStd != null ? Math.round(rangeStd * 10) / 10 : null,
    stdHours: stdN, ratedHours: rows.length,
    actualSlabs, target, achievable, lost, designs, daysCounted, productiveHours, roboHours, normalHours,
    misFallbackSlabs, misFallbackDays: misFallbackDaySet.size,
    pressBatches: pressBatchSet.size, misBatches: misBatchSet.size, unloggedBatches: unloggedBatchList.length, unloggedBatchList: unloggedBatchList.slice(0, 60),
  };
}
