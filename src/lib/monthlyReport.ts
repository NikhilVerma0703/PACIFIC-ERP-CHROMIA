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
import { SHIFT_HOURS } from "@/lib/misShiftHours";
import {
  MIS_SELECT, ENTRY_SELECT, QC_SELECT, IST_OFFSET_MIN,
  assembleHours, assembleDay, getQuality, getMaintenance, reportWindow,
  type HourRow,
} from "@/lib/dailyReport";

export type ShiftKey = "A" | "B" | "C";

/** The twenty-four hour slots of a report day, in the order the plant runs
 *  them: 06:00 through 05:00, A then B then C. The same labels the MIS sheet
 *  uses (lib/misShiftHours), so a gap here names a slot the entry form has. */
const DAY_SLOTS: { h: number; label: string; shift: ShiftKey }[] =
  (["A", "B", "C"] as const).flatMap((shift) =>
    SHIFT_HOURS[shift].map((label) => ({ h: Number(label.slice(0, 2)), label, shift })));

/** The slots of `date` that have fully ELAPSED by `now` — the only ones a
 *  shift could already have filed. A finished day has all twenty-four; the
 *  in-progress day has as many as have ENDED, because the hour running right
 *  now is not late, it is now. Both the discipline denominator and the
 *  missing-hours list read this one function, so they can never disagree. */
function elapsedSlots(date: string, now: number): typeof DAY_SLOTS {
  const ended = Math.floor((now - reportWindow(date).from.getTime()) / 3_600_000);
  return DAY_SLOTS.slice(0, Math.max(0, Math.min(24, ended)));
}

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

/** n days from a 'YYYY-MM-DD' key. UTC arithmetic: a key is a label. */
const addDaysTo = (key: string, n: number): string =>
  new Date(Date.parse(`${key}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const prevMonthOf = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export type DayRow = {
  date: string;
  made: number; target: number; pct: number | null; lost: number;
  hoursRun: number; hoursLogged: number; onTarget: number;
  /** Hours set aside for an impossible slab range — see slabsOf. */
  wideHours: number;
  cause: { cleaning: number; power: number; process: number; breakdown: number };
  /** "D1430, Carrara Cloud" strings, in the order the line ran them. */
  lines: string[];
  /** Area with the most lost minutes that day, for the narrative. */
  topArea: string | null;
  /** Hour slots that had elapsed and were never filed, per shift — what the
   *  MIS-discipline section expands into, and what its Fill buttons open. */
  gaps: { shift: ShiftKey; hours: string[]; filed: number; possible: number }[];
  /** Slots that had elapsed by the time this report ran: 24 on a finished day. */
  slotsPossible: number;
};

/** The per-day and total figures for one month — mis only, shared by the
 *  headline month and the previous-month comparison column. */
async function monthCore(month: string, capDay: string | null, now: number = Date.now()) {
  const all = daysInMonth(month);
  const dates = capDay ? all.filter((d) => d <= capDay) : all;
  if (!dates.length) return null;
  const { from } = reportWindow(dates[0]);
  const { to } = reportWindow(dates[dates.length - 1]);

  const mis = await prisma.mis.findMany({
    where: { dateAndTime: { gte: from, lt: to } },
    orderBy: { dateAndTime: "asc" },
    select: { ...MIS_SELECT, dateAndTime: true, date: true },
  });

  const byDay = new Map<string, typeof mis>();
  for (const r of mis) {
    if (!r.dateAndTime) continue;
    const k = dayKeyOf(r.dateAndTime);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }

  // WHICH DAY'S SHEET AN HOUR WAS FILED ON — a different question from which
  // day its minutes belong to, and it must be answered the entry sheet's way.
  //
  // The figures above bucket a row by its TIMESTAMP (dayKeyOf), exactly as the
  // daily report windows MIS, which is what keeps the two reports equal. But
  // the MIS sheet files an hour under its `date` column plus its hour LABEL,
  // with 00–05 stored against the next date. A C shift that types its
  // after-midnight hours late — after 06:00 — stamps them into the next report
  // day, and the timestamp rule then reports the night that filed them as
  // silent. That is a false accusation against a shift, and the Fill button
  // beside it would open a sheet where the hour is already logged and invite a
  // duplicate row. So the filed-set is keyed the sheet's way.
  const filedByDay = new Map<string, Set<number>>();
  for (const r of mis) {
    const h = r.hour ? Number(String(r.hour).slice(0, 2)) : null;
    if (h == null || !Number.isFinite(h)) continue;
    // The `date` column is the IST day stored at UTC midnight; fall back to
    // the timestamp's own report day when a legacy row carries no date.
    const base = r.date
      ? r.date.toISOString().slice(0, 10)
      : r.dateAndTime ? dayKeyOf(r.dateAndTime) : null;
    if (!base) continue;
    // hours 00–05 are the tail of the night that began the day before
    const key = h < 6 ? addDaysTo(base, -1) : base;
    if (!filedByDay.has(key)) filedByDay.set(key, new Set());
    filedByDay.get(key)!.add(h);
  }

  // The production mix accumulates off the SAME hour rows the day figures
  // count, at the hour grain — a changeover day splits its made between two
  // designs — so the mix sums to the month's made by construction.
  const mix = new Map<string, { design: string; made: number; batches: Set<string>; days: Set<string> }>();

  // Maintenance, summed from each day's OWN maintenance assembly — the same
  // getMaintenance the daily's page three runs, so the month's breakdown
  // figures are the sum of the daily pages by construction (power hours
  // reclassified out, exactly as there).
  const maint = {
    events: 0, minutes: 0, daysAffected: 0, withRca: 0, sparesHours: 0,
    power: { minutes: 0, hours: 0, days: 0 },
    byArea: new Map<string, { area: string; events: number; minutes: number; days: Set<string> }>(),
    byShift: new Map<string, { shift: string; events: number; minutes: number }>(),
  };

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
    const m = getMaintenance(hours);
    if (m.events.length) {
      maint.daysAffected++;
      maint.events += m.events.length;
      maint.minutes += m.minutes;
      maint.withRca += m.withRca;
      maint.sparesHours += m.spares.length;
      for (const a of m.byArea) {
        const e = maint.byArea.get(a.area) ?? { area: a.area, events: 0, minutes: 0, days: new Set<string>() };
        e.events += a.events; e.minutes += a.minutes; e.days.add(date);
        maint.byArea.set(a.area, e);
      }
      for (const s of m.byShift) {
        const e = maint.byShift.get(s.shift) ?? { shift: s.shift, events: 0, minutes: 0 };
        e.events += s.events; e.minutes += s.minutes;
        maint.byShift.set(s.shift, e);
      }
    }
    // Gated on ROWS, not minutes — the daily page prints its power section on
    // rows too. A power hour with no minutes typed (the reasons name the grid
    // and the breakdown flag is set) is still an hour the grid went down: on
    // the minutes gate such a day vanished from the month's hour and day
    // counts while appearing on its own daily page.
    if (m.powerCuts.rows.length > 0) {
      maint.power.days++;
      maint.power.minutes += m.powerCuts.minutes;
      maint.power.hours += m.powerCuts.rows.length;
    }
    // WHICH SHIFT DID NOT FILE. Read from filedByDay — the entry sheet's own
    // (date column + hour label) rule, not the timestamp bucket — and matched
    // on the slot's START HOUR, so a row typed "6 - 7" still counts as filed.
    const filed = filedByDay.get(date) ?? new Set<number>();
    const slots = elapsedSlots(date, now);
    const gaps = (["A", "B", "C"] as const).map((shift) => {
      const mine = slots.filter((s) => s.shift === shift);
      return {
        shift,
        hours: mine.filter((s) => !filed.has(s.h)).map((s) => s.label),
        filed: mine.filter((s) => filed.has(s.h)).length,
        possible: mine.length,
      };
    }).filter((g) => g.hours.length > 0);

    return {
      date,
      made: day.made, target: day.target, pct: day.pct, lost: day.lost,
      hoursRun: day.hoursRun, hoursLogged: day.hoursTotal, onTarget: day.onTarget,
      wideHours: day.wideHours,
      gaps, slotsPossible: slots.length,
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
    // The elapsed-hours denominator, summed from the same per-day slot lists
    // the gap rows are built from — one source, so the headline share and the
    // expanded list can never tell different stories.
    hoursPossible: days.reduce((a, d) => a + d.slotsPossible, 0),
    gapDays: days.filter((d) => d.gaps.length > 0).map((d) => ({ date: d.date, gaps: d.gaps })),
    hoursMissing: days.reduce((a, d) => a + d.gaps.reduce((b, g) => b + g.hours.length, 0), 0),
    mix: [...mix.values()]
      .map((m) => ({ design: m.design, made: m.made, batches: m.batches.size, days: m.days.size }))
      .filter((m) => m.made > 0)
      .sort((a, b) => b.made - a.made),
    maintenance: {
      events: maint.events, minutes: maint.minutes, daysAffected: maint.daysAffected,
      withRca: maint.withRca, sparesHours: maint.sparesHours, power: maint.power,
      byArea: [...maint.byArea.values()]
        .map((a) => ({ area: a.area, events: a.events, minutes: a.minutes, days: a.days.size }))
        .sort((a, b) => b.minutes - a.minutes || b.events - a.events),
      byShift: [...maint.byShift.values()].sort((a, b) => a.shift.localeCompare(b.shift)),
    },
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
    // at all — and WHICH SHIFT left each gap. A silent hour is a fact the month
    // must show; the daily report cannot, because nobody opens it for that day.
    // The in-progress day contributes only its ELAPSED hours — the same
    // exemption zeroDays makes, applied to the denominator: charging today all
    // 24 at breakfast means a perfectly-filed plant can never read 100%.
    // The numerator is DISTINCT elapsed slots filled, not rows: an hour filed
    // twice is one hour, and a row with no hour label fills no slot. Derived
    // from the same slot arithmetic as the gaps, so "724 of 738" and the
    // fourteen rows the list expands to are always the same fourteen.
    hoursLogged: core.hoursPossible - core.hoursMissing,
    hoursPossible: core.hoursPossible,
    hoursMissing: core.hoursMissing,
    /** Hours the month set aside for an impossible slab range, and which days. */
    wideHours: core.days.reduce((a, d) => a + d.wideHours, 0),
    wideDays: core.days.filter((d) => d.wideHours > 0).map((d) => d.date),
    /** Day by day, the shifts that left hours unfiled — what the discipline
     *  section expands into, and what an admin's Fill button opens. */
    gapDays: core.gapDays,
    // A day is only silent once it has had hours to be silent IN: the
    // in-progress day is exempt (at 07:00 its sheet legitimately holds one
    // row, and calling today "unfiled" at breakfast is noise), and a day whose
    // 06:00 has not arrived at all has nothing to file yet.
    zeroDays: core.days
      .filter((d) => d.hoursLogged === 0 && d.slotsPossible > 0 && !(monthToDate && d.date === today))
      .map((d) => d.date),
    bestDay: ranked[0] ?? null, worstDay: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    topDay: byMade[0]?.made ? byMade[0] : null,
    causes,
    mix: core.mix,
    maintenance: core.maintenance,
    quality: getQuality(entries, qc),
    prev: prevCore ? {
      month: prevCore.month, made: prevCore.made, target: prevCore.target,
      pct: prevCore.pct, lost: prevCore.lost, daysRun: prevCore.daysRun,
    } : null,
  };
}

export type MonthlyReport = Awaited<ReturnType<typeof getMonthlyReport>>;
