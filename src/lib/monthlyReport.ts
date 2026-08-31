// Every figure the CEO monthly report prints, derived from the database.
//
// THE INVARIANT THIS FILE EXISTS TO KEEP: a day row here equals that day's own
// daily report. Both run the SAME assembly — assembleHours/assembleDay from
// lib/dailyReport — so the monthly is the sum of the dailies by construction,
// not by hope. The month is fetched in one window and grouped per 06:00→06:00
// report day, rather than fetching thirty-one days one at a time.
//
// WHAT THE MONTH ADDS over the dailies (the reason this report exists):
// week rollups, best and worst day, the month's downtime causes with how many
// DAYS each cause touched, the production mix across designs, MIS discipline
// (hours logged of possible, days with nothing filed), the month's quality
// figures, and the same month's numbers set beside the previous month.
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";
import {
  MIS_SELECT, ENTRY_SELECT, QC_SELECT, IST_OFFSET_MIN,
  assembleHours, assembleDay, getQuality, reportWindow,
  type HourRow,
} from "@/lib/dailyReport";

/** The current report day: 06:00→06:00 IST, so before 06:00 IST the plant is
 *  still on yesterday's sheet — identical to the daily report's clock. */
export function currentReportDay(): string {
  const t = new Date(Date.now() + (IST_OFFSET_MIN - 360) * 60000);
  return t.toISOString().slice(0, 10);
}

const dayKeyOf = (dt: Date): string =>
  new Date(dt.getTime() + (IST_OFFSET_MIN - 360) * 60000).toISOString().slice(0, 10);

const daysInMonth = (month: string): string[] => {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};

export const prevMonthOf = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export type DayRow = {
  date: string;
  made: number; target: number; pct: number | null; lost: number;
  hoursRun: number; hoursLogged: number; onTarget: number;
  cause: { cleaning: number; power: number; process: number; breakdown: number };
  /** "D1430, Carrara Cloud" strings, in the order the line ran them. */
  lines: string[];
  /** Area with the most lost minutes that day, for the narrative. */
  topArea: string | null;
};

/** The per-day and total figures for one month — mis only, shared by the
 *  headline month and the previous-month comparison column. */
async function monthCore(month: string, capDay: string | null) {
  const all = daysInMonth(month);
  const dates = capDay ? all.filter((d) => d <= capDay) : all;
  if (!dates.length) return null;
  const { from } = reportWindow(dates[0]);
  const { to } = reportWindow(dates[dates.length - 1]);

  const mis = await prisma.mis.findMany({
    where: { dateAndTime: { gte: from, lt: to } },
    orderBy: { dateAndTime: "asc" },
    select: { ...MIS_SELECT, dateAndTime: true },
  });

  const byDay = new Map<string, typeof mis>();
  for (const r of mis) {
    if (!r.dateAndTime) continue;
    const k = dayKeyOf(r.dateAndTime);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }

  // The production mix accumulates off the SAME hour rows the day figures
  // count, at the hour grain — a changeover day splits its made between two
  // designs — so the mix sums to the month's made by construction.
  const mix = new Map<string, { design: string; made: number; batches: Set<string>; days: Set<string> }>();

  const days: DayRow[] = dates.map((date) => {
    const rows = byDay.get(date) ?? [];
    const hours: HourRow[] = assembleHours(rows);
    const { day, cause } = assembleDay(hours);
    // Deduped by CANONICAL batch and case-folded design, shown in the first
    // spelling the day used — operators type "D1399" and "1399" for the same
    // batch within one shift, and both spellings listed reads as two runs.
    const lineKeys = new Map<string, string>();
    for (const x of hours) {
      const label = x.batch && x.design ? `${x.batch}, ${x.design}` : x.design ?? x.batch;
      if (!label) continue;
      const key = `${normalizeBatch(x.batch)}|${(x.design ?? "").trim().toLowerCase()}`;
      if (!lineKeys.has(key)) lineKeys.set(key, label);
    }
    const lines = [...lineKeys.values()];
    const areas = new Map<string, number>();
    for (const x of hours) for (const a of x.area) areas.set(a, (areas.get(a) ?? 0) + x.lost);
    const topArea = [...areas].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    for (const x of hours) {
      // Only rows that reach a shift — the SAME set day.made counts. A row
      // with no hour label carries made the day figure excludes, and counting
      // it here broke the mix-sums-to-made invariant on real months (June
      // 2026: 104 phantom slabs; July: 19).
      if (x.shift == null) continue;
      // Case-folded design key, canonical batch: "Tiffiny"/"TIFFINY" are one
      // design and "D1399"/"1399" one batch — counting spellings told the
      // owner three Carrara Cloud batches ran in August when two did.
      const k = (x.design ?? "").trim().toLowerCase() || "(not named)";
      if (!mix.has(k)) mix.set(k, { design: x.design?.trim() || "(not named)", made: 0, batches: new Set(), days: new Set() });
      const e = mix.get(k)!;
      e.made += x.made ?? 0;
      if (x.batch) e.batches.add(normalizeBatch(x.batch));
      e.days.add(date);
    }
    return {
      date,
      made: day.made, target: day.target, pct: day.pct, lost: day.lost,
      hoursRun: day.hoursRun, hoursLogged: day.hoursTotal, onTarget: day.onTarget,
      cause, lines, topArea,
    };
  });

  const made = days.reduce((a, d) => a + d.made, 0);
  const target = days.reduce((a, d) => a + d.target, 0);
  const lost = days.reduce((a, d) => a + d.lost, 0);
  return {
    month, dates, days, made, target, lost,
    pct: target ? (100 * made) / target : null,
    daysRun: days.filter((d) => d.made > 0).length,
    daysLogged: days.filter((d) => d.hoursLogged > 0).length,
    hoursLogged: days.reduce((a, d) => a + d.hoursLogged, 0),
    mix: [...mix.values()]
      .map((m) => ({ design: m.design, made: m.made, batches: m.batches.size, days: m.days.size }))
      .filter((m) => m.made > 0)
      .sort((a, b) => b.made - a.made),
    window: { from, to },
  };
}

export async function getMonthlyReport(month: string) {
  const today = currentReportDay();
  const monthToDate = month === today.slice(0, 7);
  // The in-progress day is included, exactly as the daily report shows it live.
  const cap = monthToDate ? today : null;

  const [core, prevCore] = await Promise.all([
    monthCore(month, cap),
    // The previous month is always compared COMPLETE — a month-to-date figure
    // against a full month would read as a collapse every day before the 28th.
    monthCore(prevMonthOf(month), null),
  ]);
  if (!core) throw new Error(`No days in month ${month}`);

  // Quality across the same window, on the same importedAt key the daily uses.
  const win = { importedAt: { gte: core.window.from, lt: core.window.to } };
  const [entries, qc] = await Promise.all([
    prisma.polishEntry.findMany({ where: win, select: ENTRY_SELECT }),
    prisma.polishQc.findMany({ where: win, select: QC_SELECT }),
  ]);

  // Causes: the month's minutes, and how many DAYS each cause touched — a
  // hundred minutes across twenty days is a different problem from a hundred
  // minutes in one afternoon, and only the day count tells them apart.
  const causeKeys = ["cleaning", "power", "process", "breakdown"] as const;
  const causes = causeKeys.map((k) => ({
    key: k,
    minutes: core.days.reduce((a, d) => a + d.cause[k], 0),
    daysAffected: core.days.filter((d) => d.cause[k] > 0).length,
  }));

  // Weeks, Monday-led, clipped to the month — the rollup between day and month.
  const weekStartOf = (date: string) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const weekMap = new Map<string, DayRow[]>();
  for (const d of core.days) {
    const w = weekStartOf(d.date);
    if (!weekMap.has(w)) weekMap.set(w, []);
    weekMap.get(w)!.push(d);
  }
  const weeks = [...weekMap.values()].map((ds) => {
    const made = ds.reduce((a, x) => a + x.made, 0);
    const target = ds.reduce((a, x) => a + x.target, 0);
    return {
      // The CLIPPED first day, not the Monday grouping key — for a month that
      // starts mid-week the key lies in the previous month, and "27–2 Aug"
      // would present July 27 as part of a week whose figures cover Aug 1–2.
      start: ds[0].date, end: ds[ds.length - 1].date,
      made, target, pct: target ? (100 * made) / target : null,
      lost: ds.reduce((a, x) => a + x.lost, 0),
      daysRun: ds.filter((x) => x.made > 0).length, days: ds.length,
    };
  });

  const ranked = core.days.filter((d) => d.target > 0 && d.pct != null).sort((a, b) => b.pct! - a.pct!);
  const byMade = [...core.days].sort((a, b) => b.made - a.made);

  return {
    month, monthToDate,
    daysElapsed: core.dates.length,
    daysInMonth: daysInMonth(month).length,
    days: core.days, weeks,
    made: core.made, target: core.target, pct: core.pct, lost: core.lost,
    daysRun: core.daysRun, daysLogged: core.daysLogged,
    // Discipline: of the hours the elapsed days could hold, how many were filed
    // at all — and which days hold nothing. A silent day is a fact the month
    // must show; the daily report cannot, because nobody opens it for that day.
    // The in-progress day contributes only its ELAPSED hours — the same
    // exemption zeroDays makes, applied to the denominator: charging today all
    // 24 at breakfast means a perfectly-filed plant can never read 100%.
    hoursLogged: core.hoursLogged,
    hoursPossible: (core.dates.length - (monthToDate ? 1 : 0)) * 24
      + (monthToDate
        ? Math.min(24, Math.max(0, Math.floor((Date.now() - reportWindow(today).from.getTime()) / 3_600_000) + 1))
        : 0),
    // The in-progress day is exempt: at 07:00 its sheet legitimately holds one
    // row, and calling today "unfiled" at breakfast is noise, not discipline.
    zeroDays: core.days.filter((d) => d.hoursLogged === 0 && !(monthToDate && d.date === today)).map((d) => d.date),
    bestDay: ranked[0] ?? null, worstDay: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    topDay: byMade[0]?.made ? byMade[0] : null,
    causes,
    mix: core.mix,
    quality: getQuality(entries, qc),
    prev: prevCore ? {
      month: prevCore.month, made: prevCore.made, target: prevCore.target,
      pct: prevCore.pct, lost: prevCore.lost, daysRun: prevCore.daysRun,
    } : null,
  };
}

export type MonthlyReport = Awaited<ReturnType<typeof getMonthlyReport>>;
