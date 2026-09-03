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
import type { Prisma } from "@prisma/client";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { SHIFT_HOURS } from "@/lib/misShiftHours";
import {
  MIS_SELECT, ENTRY_SELECT, QC_SELECT, IST_OFFSET_MIN,
  assembleHours, assembleDay, getQuality, getMaintenance, reportWindow,
  gradeOf,
  type HourRow,
} from "@/lib/dailyReport";
import { MAX_SLABS_PER_HOUR } from "@/lib/shiftScoreMath";

export type ShiftKey = "A" | "B" | "C";

/** A/A2/B/C over one population of SLABS, with the two buckets that are
 *  neither a pass nor a reject kept out of all four and reported beside them,
 *  so the six numbers add up to `slabs` exactly. See gradeProduced. */
export type GradeTally = {
  /** Distinct slab numbers in the population — the sum of the six below. */
  slabs: number;
  A: number; A2: number; B: number; C: number;
  /** Routed to cut-to-size or sampling with no verdict surviving. Not a pass,
   *  not a reject, and out of both sides of any rate — dailyReport.noVerdict
   *  is the rule, and it is the same rule the pass rate above uses. */
  cut: number;
  /** No QC row at all, or a row that still reads "Not graded yet". */
  ungraded: number;
};

const emptyTally = (): GradeTally => ({ slabs: 0, A: 0, A2: 0, B: 0, C: 0, cut: 0, ungraded: 0 });

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

/** The slab numbers a declared range covers, or null when the range is not one
 *  this report will walk. ONE rule with TWO readers — the month's own
 *  enumeration below and the provenance lookup in `declaredOutside` — and
 *  deliberately the same four conditions shiftScore.claimedSlabs applies:
 *  finite both ends, start above zero, end not before start, width under
 *  MAX_SLABS_PER_HOUR. Two enumerations with different edge cases is how the
 *  scoreboard and the report come to disagree about which slabs a shift
 *  pressed — and, now that sheet three places a QC entry against the MIS
 *  ranges of OTHER months, it is also how one page could call a slab "stone
 *  from another month" that a second page had already counted as this one's. */
const walkRange = (a: number | null, b: number | null): [number, number] | null =>
  a == null || b == null || a <= 0 || b < a || b - a >= MAX_SLABS_PER_HOUR ? null : [a, b];

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
  const mix = new Map<string, {
    design: string; made: number; batches: Set<string>; days: Set<string>;
    /** Slab numbers THIS design's hours declared that another row already
     *  owned — see the first-claim-wins note below. */
    contested: number; contestedWith: Set<string>;
  }>();

  // WHICH SLAB NUMBERS THE MONTH PRESSED, and which design each belongs to.
  //
  // WHY THE MIX NEEDS THIS AT ALL. The mix counts what was PRESSED, from the
  // MIS hourly rows; the grades live in polish_qc. Joining the two on "QC rows
  // recorded during the month" would put slabs pressed in April and polished in
  // August into the grade columns of an August design row — a different
  // population from the Slabs column beside it, inviting an arithmetic that is
  // not true. Measured on live Neon 2026-09-03: of the 6,390 QC entries filed
  // in August 2026, 1,000 were for slabs August did not press — 939 of them
  // declared by another month's MIS, 61 in no MIS range at all. (This comment
  // said 938 and 61, which add to 999 rather than 1,000; the split is measured
  // in one pass now, by declaredOutside, so it cannot drift again.) So the join
  // is on the SLAB NUMBERS, and the QC fetch is unwindowed — 450 of August's
  // own slabs had their latest QC row land after the month closed and 348 of
  // those carry a verdict, and a month-windowed join would have lost the lot.
  //
  // THE EXCLUSIONS ARE THE MIX'S OWN, DELIBERATELY. An hour that reaches no
  // shift is skipped below and skipped here; an hour whose range is impossibly
  // wide made no claim in `made` (slabsOf returns null) and makes none here.
  // Any divergence and the grade columns would describe a different set of
  // hours from the Slabs column they sit next to.
  //
  // FIRST CLAIM WINS, so the per-design sets PARTITION the month: a slab
  // number two hours both typed belongs to exactly one design row, and the
  // grade columns therefore add DOWN the page as well as across it. That
  // overlap is a data-entry fault and it is real — August 2026 declared 6,262
  // slabs across 6,261 distinct numbers, because hour 12-13 on 5 August
  // re-typed slab 152439, already claimed by an earlier Simply White hour. The
  // report says so rather than hiding it; see `overclaimed` below.
  //
  // AND THE SECOND CLAIM IS NOT ALWAYS THE SAME DESIGN, which is why each row
  // records WHO took the number off it. First claim wins across the whole
  // month, not within a design, so a number two DIFFERENT designs typed is
  // graded on the row that typed it first and is missing from the other —
  // whose own hours did nothing wrong. Measured on live Neon 2026-09-03: June
  // 2026 has exactly one such number, 144340, kept by Taj Aureate and claimed
  // again by Carrara Royale, which is why Carrara Royale reads 79 slabs across
  // 78 distinct numbers; July's 27 overlaps and August's 1 are all a design
  // re-typing its own number. Without this counter the sheet's note blamed the
  // wrong design's data entry for June's gap.
  const slabOwner = new Map<number, string>();

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
      if (!mix.has(k)) mix.set(k, { design: x.design?.trim() || "(not named)", made: 0, batches: new Set(), days: new Set(), contested: 0, contestedWith: new Set() });
      const e = mix.get(k)!;
      e.made += x.made ?? 0;
      if (x.batch) e.batches.add(normalizeBatch(x.batch));
      e.days.add(date);
      // walkRange is the shared guard — the same one shiftScore.claimedSlabs
      // applies before it walks a range, and the same one the provenance
      // lookup uses on other months' hours. See its comment above.
      const range = walkRange(x.slabFrom, x.slabTo);
      if (!range) continue;
      for (let sn = range[0]; sn <= range[1]; sn++) {
        const held = slabOwner.get(sn);
        if (held === undefined) slabOwner.set(sn, k);
        // A number this design's hours typed that ANOTHER design already
        // holds. A design re-typing its own number is not recorded here: the
        // row's own gap already says that, and the note words the two cases
        // differently because they are different faults.
        else if (held !== k) { e.contested++; e.contestedWith.add(held); }
      }
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
    // `key` is the case-folded design the mix accumulated under, carried out so
    // the grade tally built from slabOwner can be joined back onto the row it
    // belongs to. Joining on the DISPLAY spelling would put "Tiffiny" and
    // "TIFFINY" back into two rows, which the folding above exists to stop.
    mix: [...mix.entries()]
      .map(([key, m]) => ({
        key, design: m.design, made: m.made, batches: m.batches.size, days: m.days.size,
        contested: m.contested,
        // Resolved to the SPELLING that design is printed under, not the
        // folded key, so the note names a row the reader can find on the page.
        contestedWith: [...m.contestedWith].map((k) => mix.get(k)?.design ?? k),
      }))
      .filter((m) => m.made > 0)
      .sort((a, b) => b.made - a.made),
    /** Every slab number the month's hours declared -> the design row it
     *  belongs to. Partitioned, so summing per design gives the month's own
     *  distinct total exactly once. */
    slabOwner,
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

/** Only the columns the produced-slab grades derive from. Deliberately NOT
 *  QC_SELECT: that carries fourteen fields the daily page needs and this does
 *  not, and this fetch is six thousand rows wide on a full month. */
const PRODUCED_QC_SELECT = {
  slabNumber: true, qualityGrade: true, qualityGradeBeforeCts: true,
  createdTime: true, importedAt: true,
} satisfies Prisma.PolishQcSelect;
type ProducedQcRow = Prisma.PolishQcGetPayload<{ select: typeof PRODUCED_QC_SELECT }>;

/** How the slabs a month PRESSED were finally graded — per design and in
 *  total — whenever QC reached them.
 *
 *  UNWINDOWED ON PURPOSE. A slab pressed on 31 August is often graded in
 *  September and it is still an August slab: measured on live Neon 2026-09-03,
 *  450 of August 2026's 6,261 slabs had their latest QC row stamped after the
 *  month's window closed — 348 of them carrying an actual verdict — and none
 *  at all before it opened.
 *
 *  ONE ROW PER SLAB, THE NEWEST. A re-graded slab has several QC rows and
 *  reports its latest outcome — shiftScore's rule, on the same createdTime ??
 *  importedAt stamp, so the payout and the CEO's mix cannot name different
 *  verdicts for one slab. Counting rows instead of slabs would also break the
 *  add-up: six columns summing past the design's own slab count.
 *
 *  Chunked at 5,000 under Postgres's 32,767 bind-parameter cap — present() in
 *  lib/incentiveMonth is the house pattern, and a month is already 6,261. */
async function gradeProduced(slabOwner: Map<number, string>, monthEnd: Date) {
  const numbers = [...slabOwner.keys()];
  const byDesign = new Map<string, GradeTally>();
  const total = emptyTally();
  /** Produced slabs whose VERDICT only arrived after the month closed — the
   *  figure that says why this join is not windowed on the month.
   *
   *  A VERDICT, NOT MERELY A ROW. This used to count any slab whose latest QC
   *  row was stamped after the window closed, including rows that still read
   *  "Not graded yet" — while both sheets print the figure as the count of
   *  slabs that were GRADED after the month. Measured on live Neon 2026-09-03
   *  for August 2026: 450 latest rows landed after the month closed but only
   *  348 of them carry a verdict, so the sheet-three sentence "450 … were not
   *  graded until after the month closed … and 954 still carry no verdict at
   *  all" double-counted 102 slabs in two figures a reader reads as disjoint.
   *  July was 931 against 846, June 286 against 242. Cut-to-size is out of it
   *  too — a routing state is not a grade — though no month yet measured has
   *  a cut slab arriving late (0 in June, July and August 2026). */
  let gradedAfterMonth = 0;
  for (const d of new Set(slabOwner.values())) byDesign.set(d, emptyTally());
  if (!numbers.length) return { byDesign, total, gradedAfterMonth };

  const rows: ProducedQcRow[] = [];
  for (let i = 0; i < numbers.length; i += 5000) {
    rows.push(...await prisma.polishQc.findMany({
      where: { slabNumber: { in: numbers.slice(i, i + 5000) } },
      select: PRODUCED_QC_SELECT,
    }));
  }
  const stamp = (q: ProducedQcRow) => new Date(q.createdTime ?? q.importedAt ?? 0).getTime();
  rows.sort((a, b) => stamp(b) - stamp(a));
  const latest = new Map<number, ProducedQcRow>();
  for (const q of rows) {
    if (q.slabNumber == null) continue;
    const n = Number(q.slabNumber);
    if (!latest.has(n)) latest.set(n, q);
  }

  for (const [slab, design] of slabOwner) {
    const t = byDesign.get(design)!;
    const q = latest.get(slab);
    // gradeOf is dailyReport's exported rule, NOT a second predicate written
    // here: it is what folds a 'CTS'/'SAMPLE' grade and a B that scripts/0071
    // and 0072 decided rather than measured into one bucket that is neither a
    // pass nor a reject. A row with no QC row at all and a row still reading
    // "Not graded yet" are the same fact to a CEO — nobody has judged it yet —
    // so both land in `ungraded`.
    const g = q ? gradeOf(q) : null;
    const bucket: keyof GradeTally =
      g === "A" ? "A" : g === "A2" ? "A2" : g === "B" ? "B"
      : g === "C (Reject)" ? "C" : g === "CTS" ? "cut" : "ungraded";
    t[bucket]++; t.slabs++;
    total[bucket]++; total.slabs++;
    // Gated on the bucket already decided above, so "graded after the month"
    // and "no verdict at all" can never name the same slab. `stamp` is the
    // SAME clock that chose this row as the latest one — createdTime falling
    // back to importedAt. Reading the arrival with a second clock (importedAt
    // alone, as this line did) is how one quantity comes to read two ways:
    // measured 2026-09-03 the two agree exactly on June, July and August 2026
    // (0 of these rows carry a null importedAt), but every QC row written
    // since the June 2026 cutover is stamped createdTime first.
    if (q && bucket !== "cut" && bucket !== "ungraded" && stamp(q) >= monthEnd.getTime()) gradedAfterMonth++;
  }
  return { byDesign, total, gradedAfterMonth };
}

/** Every slab number declared by an MIS hour OUTSIDE this month's window —
 *  what lets sheet three say whether a QC entry that is not this month's stone
 *  can be PLACED in another month at all.
 *
 *  WHY THE REPORT NEEDS IT. Sheet three used to call every QC entry that was
 *  not this month's slab "stone from earlier batches". That is a claim about
 *  where a slab came from, and for some of them the database makes no such
 *  claim: measured on live Neon 2026-09-03, of the 1,000 August 2026 entries
 *  that were not August's own slabs, 939 carry a number an MIS hour in another
 *  month declared and 61 sit in no MIS range in ANY month — they may be stone
 *  from before MIS covered the plant, or a mistyped slab number, and the sheet
 *  is not entitled to decide which. The two figures plus the month's own add
 *  to the entries filed exactly, so the sentence can be checked by adding up.
 *
 *  THE COST, measured the same day: the whole mis table is 7,114 rows and this
 *  reads two numeric columns of the ones outside the window in ~0.6s, walked
 *  into a 46,684-number set in 7ms. It runs in the same Promise.all as the
 *  month's QC fetch, so it costs no wall clock the report was not already
 *  spending. Rows with no timestamp are counted OUTSIDE: the window filter
 *  cannot have claimed them for this month. */
async function declaredOutside(from: Date, to: Date): Promise<Set<number>> {
  const rows = await prisma.mis.findMany({
    where: { OR: [{ dateAndTime: { lt: from } }, { dateAndTime: { gte: to } }, { dateAndTime: null }] },
    select: { startingSlabNumber: true, endingSlabNumber: true },
  });
  const declared = new Set<number>();
  for (const r of rows) {
    const range = walkRange(r.startingSlabNumber, r.endingSlabNumber);
    if (!range) continue;
    for (let sn = range[0]; sn <= range[1]; sn++) declared.add(sn);
  }
  return declared;
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
  const [entries, qc, producedGrades, elsewhere] = await Promise.all([
    prisma.polishEntry.findMany({ where: win, select: ENTRY_SELECT }),
    prisma.polishQc.findMany({ where: win, select: QC_SELECT }),
    // The month's OWN slabs, graded whenever QC reached them — the second of
    // the two populations the CEO asked to see side by side. Not windowed on
    // the month; see gradeProduced.
    gradeProduced(core.slabOwner, core.window.to),
    // Where the entries that are NOT this month's slabs came from.
    declaredOutside(core.window.from, core.window.to),
  ]);

  // THE THREE BUCKETS ADD TO THE ENTRIES FILED, by construction: every QC row
  // in the window falls into exactly one arm below. An entry with no slab
  // number typed cannot be placed either, so it lands in `unplaced` with the
  // numbers no MIS range covers — the sheet says "cannot be placed", not
  // "earlier stone", which is the whole point of the split.
  const qcFrom = { own: 0, elsewhere: 0, unplaced: 0 };
  for (const r of qc) {
    if (r.slabNumber != null && core.slabOwner.has(r.slabNumber)) qcFrom.own++;
    else if (r.slabNumber != null && elsewhere.has(r.slabNumber)) qcFrom.elsewhere++;
    else qcFrom.unplaced++;
  }

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
    // Each mix row carries the grades of ITS OWN slabs — the ones those hours
    // declared — so the six grade figures add across to `numbered` and down the
    // page to producedGrades.total. `numbered` is printed beside `made` rather
    // than replacing it: `made` is what the hours claimed and is what sums to
    // the month's output (the invariant this file exists to keep), while
    // `numbered` is how many DISTINCT slab numbers those claims covered. They
    // are equal unless two hours typed the same number, which August 2026 did
    // exactly once — 6,262 made against 6,261 numbered, measured 2026-09-03.
    // The sheet prints the gap rather than papering over it, and `contested`
    // says whether the second claim came from ANOTHER design, because the
    // sentence that explains the gap is a different sentence when it did.
    mix: core.mix.map((m) => ({
      ...m,
      grades: producedGrades.byDesign.get(m.key) ?? emptyTally(),
      numbered: (producedGrades.byDesign.get(m.key) ?? emptyTally()).slabs,
    })),
    /** The month's own slabs, graded whenever QC got to them — the "produced"
     *  half of the two grade tables on sheet three. */
    producedGrades: producedGrades.total,
    /** Of those, how many only got a verdict after the month closed. */
    producedGradedAfter: producedGrades.gradedAfterMonth,
    /** QC entries filed this month that were for slabs THIS month pressed —
     *  the gap the CEO asked to see: August 2026 filed 6,390 entries, 5,390 of
     *  them on its own slabs (live Neon, 2026-09-03). */
    qcEntriesOnOwnSlabs: qcFrom.own,
    /** Of the rest, the ones another month's MIS declared (939 in August 2026)
     *  and the ones no MIS range in any month covers (61) — see declaredOutside.
     *  own + elsewhere + unplaced === quality.inspected, always. */
    qcEntriesElsewhere: qcFrom.elsewhere,
    qcEntriesUnplaced: qcFrom.unplaced,
    /** Slabs the month pressed, counted as distinct numbers — the denominator
     *  every produced-grade figure divides by. */
    producedSlabs: core.slabOwner.size,
    maintenance: core.maintenance,
    quality: getQuality(entries, qc),
    prev: prevCore ? {
      month: prevCore.month, made: prevCore.made, target: prevCore.target,
      pct: prevCore.pct, lost: prevCore.lost, daysRun: prevCore.daysRun,
    } : null,
  };
}

export type MonthlyReport = Awaited<ReturnType<typeof getMonthlyReport>>;
