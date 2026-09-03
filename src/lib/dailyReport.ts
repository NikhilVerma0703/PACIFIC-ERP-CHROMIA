// Every figure the CEO daily report prints, derived from the database.
//
// WHY THIS IS SEPARATE FROM THE PAGE THAT RENDERS IT
// The numbers are the part that can be wrong in a way nobody notices. Keeping
// them here means they can be re-derived and checked without rendering
// anything, and the page cannot quietly compute a figure of its own.
//
// THE DAY IS 06:00 TO 06:00 IST, NOT MIDNIGHT TO MIDNIGHT
// A shift starts at 06:00 and C shift runs past midnight, so a calendar day
// would cut C shift in half and blame two dates for one night's work.
//
// WHICH TIMESTAMP EACH TABLE IS KEYED ON, AND WHY THEY DIFFER
// mis.dateAndTime is entered by the shift in-charge and is trustworthy.
// polishEntry.created / polishQc.createdTime ARE NOT: both stop dead at
// 2026-06-08 across the whole table, so a window on them returns nothing for
// any recent day. Those two are keyed on importedAt, the Airtable sync time,
// which is the only timestamp still moving. If `created` starts populating
// again, prefer it — but check coverage first, do not assume.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { canonPerson, slabsDeclared, rangeImpossible as rangeImpossibleShared } from "@/lib/shiftScoreMath";

export const IST_OFFSET_MIN = 330;
export type ShiftLetter = "A" | "B" | "C";

const SHIFTS: { letter: ShiftLetter; label: string }[] = [
  { letter: "A", label: "06:00 - 14:00" },
  { letter: "B", label: "14:00 - 22:00" },
  { letter: "C", label: "22:00 - 06:00" },
];

/** The 06:00->06:00 IST window for `date` (YYYY-MM-DD), as UTC instants. */
export function reportWindow(date: string) {
  const from = new Date(`${date}T06:00:00.000Z`);
  from.setUTCMinutes(from.getUTCMinutes() - IST_OFFSET_MIN);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

const hourStart = (h: string | null) => (h ? Number(String(h).slice(0, 2)) : null);
const shiftOf = (h: number): ShiftLetter => (h >= 6 && h < 14 ? "A" : h >= 14 && h < 22 ? "B" : "C");
const istHour = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60000).getUTCHours();
const FACE: Record<string, string> = { BS: "Bottom side", TS: "Top side" };

/** Slabs an hour declares, and whether its range is impossible.
 *
 *  BOTH ARE THE SHARED RULE NOW — slabsDeclared / rangeImpossible in
 *  lib/shiftScoreMath, the file that owns MAX_SLABS_PER_HOUR. This report
 *  was the reference implementation (the guard against the 135,513-slab hour
 *  of 26 July and the two 30,000-slab June nights was first written here) and
 *  the downtime page and the emailed PDF now call the same function rather
 *  than carrying their own copies: on 30 August the three surfaces printed
 *  329, 329 and 97 slabs for one day. The local names are kept so nothing
 *  below has to change; the behaviour is identical to the slab, including
 *  the boundary — an hour of exactly 60 is still accepted, as the entry form
 *  and the scoreboard accept it. */
const slabsOf = (s: number | null, e: number | null): number | null => slabsDeclared(s, e);
const rangeImpossible = (s: number | null, e: number | null): boolean => rangeImpossibleShared(s, e);

export type HourRow = {
  hour: string | null; h: number | null; shift: ShiftLetter | null;
  incharge: string | null; batch: string | null; design: string | null;
  made: number | null; wideRange: boolean; std: number | null; lost: number;
  delay: { process: number; cleaning: number; breakdown: number; power: number };
  reasons: string[]; details: string | null; area: string[];
  breakdown: boolean; spares: string | null; actionTaken: string | null; rca: string | null;
  electrical: string | null; mechanical: string | null;
};

// ONLY THE COLUMNS THIS FILE READS. Mis carries six Json columns and PolishQc an
// image, a barcode and a last-modified blob that no figure here derives from;
// fetching whole rows shipped all of it from Neon for every report. Each select
// names exactly the fields the mapping below touches, so the figures cannot
// change — a field that is not read cannot alter a number.
export const MIS_SELECT = {
  hour: true, productionInchargeName: true, submittedBy: true, batch: true, design: true,
  startingSlabNumber: true, endingSlabNumber: true, slabsPerHourStd: true,
  processDelayDurationMinutes: true, cleaningDelayDurationMinutes: true,
  breakdownDelayDurationMechanicalOrElectricalMinutes: true, poweroutDelayDurationMinutes: true,
  reasonForDeviation: true, details: true, areaOfProblem: true, anyBreakdownYesNo: true,
  sparesUsed: true, actionTaken: true, rcaNo: true, electricalInchargeName: true, mechanicalInchargeName: true,
} satisfies Prisma.MisSelect;
export type MisReportRow = Prisma.MisGetPayload<{ select: typeof MIS_SELECT }>;
export const ENTRY_SELECT = {
  design: true, polishSide: true, batchNumber: true, slabNumber: true, importedAt: true,
  calliberator: true, slabThickness: true,
} satisfies Prisma.PolishEntrySelect;
export const QC_SELECT = {
  qualityGrade: true, qualityIssue: true, slabNumber: true, repolishStatus: true, rwStatus: true,
  goingToDispatch: true, importedAt: true, inspector: true,
  // ONE MORE COLUMN, AND THE PASS RATE IS WRONG WITHOUT IT.
  // quality_grade used to answer "was this slab cut?" as well as "how did it
  // grade?", because marking a slab CTS overwrote the verdict with 'CTS'.
  // scripts/0071 and 0072 then regraded all 63 of those rows to 'B' by the
  // owner's decision, so quality_grade no longer says CUT for anybody:
  // measured on live Neon 2026-09-03, 0 rows in polish_qc read 'CTS' or
  // 'SAMPLE'. quality_grade_before_cts (scripts/0056) is what those two
  // scripts stamped 'CTS' on, and it is how getQuality still recognises a B
  // that was decided rather than measured — see `noVerdict` there.
  qualityGradeBeforeCts: true,
} satisfies Prisma.PolishQcSelect;
export type EntryRow = Prisma.PolishEntryGetPayload<{ select: typeof ENTRY_SELECT }>;
export type QcRow = Prisma.PolishQcGetPayload<{ select: typeof QC_SELECT }>;

/* ---------------------------------------------------------- day assembly */
// The hour/shift/day/cause math, extracted PURE so the monthly report can run
// the identical computation per day off one month-wide fetch. Any change here
// changes both reports together — which is the point: a monthly day row that
// disagreed with that day's own report would be trusted by nobody.

export function assembleHours(mis: MisReportRow[]): HourRow[] {
  return mis.map((r) => {
    const h = hourStart(r.hour);
    return {
      hour: r.hour, h, shift: h == null ? null : shiftOf(h),
      incharge: r.productionInchargeName ?? r.submittedBy ?? null,
      batch: r.batch, design: r.design,
      made: slabsOf(r.startingSlabNumber, r.endingSlabNumber),
      /** The range was typed impossibly wide — the hour is set aside, and the
       *  report says how many it set aside rather than dropping them silently. */
      wideRange: rangeImpossible(r.startingSlabNumber, r.endingSlabNumber),
      std: r.slabsPerHourStd ?? null,
      lost: (r.processDelayDurationMinutes ?? 0) + (r.cleaningDelayDurationMinutes ?? 0)
          + (r.breakdownDelayDurationMechanicalOrElectricalMinutes ?? 0) + (r.poweroutDelayDurationMinutes ?? 0),
      delay: {
        process: r.processDelayDurationMinutes ?? 0,
        cleaning: r.cleaningDelayDurationMinutes ?? 0,
        breakdown: r.breakdownDelayDurationMechanicalOrElectricalMinutes ?? 0,
        power: r.poweroutDelayDurationMinutes ?? 0,
      },
      reasons: r.reasonForDeviation ?? [], details: r.details ?? null, area: r.areaOfProblem ?? [],
      breakdown: /^yes$/i.test(r.anyBreakdownYesNo ?? ""),
      spares: r.sparesUsed ?? null, actionTaken: r.actionTaken ?? null, rca: r.rcaNo ?? null,
      electrical: r.electricalInchargeName ?? null, mechanical: r.mechanicalInchargeName ?? null,
    };
  });
}

export function assembleDay(hours: HourRow[]) {
  // A shift's target counts only the hours it declared output for. Charging it
  // for an hour it never claimed would invent a miss.
  const shifts = SHIFTS.map((s) => {
    const rows = hours.filter((x) => x.shift === s.letter);
    const made = rows.reduce((a, x) => a + (x.made ?? 0), 0);
    const target = rows.reduce((a, x) => a + (x.made == null ? 0 : x.std ?? 0), 0);
    return {
      ...s, rows, made, target,
      incharge: rows.find((x) => x.incharge)?.incharge ?? null,
      pct: target ? (100 * made) / target : null,
      lost: rows.reduce((a, x) => a + x.lost, 0),
    };
  });

  const day = {
    made: shifts.reduce((a, s) => a + s.made, 0),
    target: shifts.reduce((a, s) => a + s.target, 0),
    lost: shifts.reduce((a, s) => a + s.lost, 0),
    hoursRun: hours.filter((x) => x.made != null).length,
    hoursTotal: hours.length,
    /** Hours whose slab range is an impossible width and were set aside. */
    wideHours: hours.filter((x) => x.wideRange).length,
    onTarget: hours.filter((x) => x.made != null && x.std != null && x.made >= x.std && x.lost === 0).length,
    pct: 0 as number | null,
  };
  day.pct = day.target ? (100 * day.made) / day.target : null;

  // DOWNTIME IS RECLASSIFIED, AND THE REPORT SAYS SO ON THE PAGE.
  // Shifts have booked power-cut hours to the breakdown column while writing
  // "Power cut 17:33-18:00" in the notes and leaving the breakdown flag blank.
  // Printing the raw column names the wrong cause and reads as a machine
  // problem maintenance does not have. The rule is narrow on purpose:
  // breakdown minutes move to power ONLY when the hour's own reason list says
  // POWER. Nothing else moves, and the total cannot change.
  let reclassified = 0;
  const cause = { cleaning: 0, power: 0, process: 0, breakdown: 0 };
  for (const x of hours) {
    // Only rows that reach a shift. day.lost is summed via the three shifts, so
    // a row with no hour label contributes nothing there — counting its delay
    // minutes HERE made the cause table sum past its own "total time lost" row
    // (June 2026: 8,996 cause minutes against 8,796 lost).
    if (x.shift == null) continue;
    const isPower = x.reasons.some((r) => /POWER/i.test(r));
    cause.cleaning += x.delay.cleaning;
    cause.process += x.delay.process;
    cause.power += x.delay.power + (isPower ? x.delay.breakdown : 0);
    cause.breakdown += isPower ? 0 : x.delay.breakdown;
    if (isPower) reclassified += x.delay.breakdown;
  }

  return { shifts, day, cause, reclassified };
}

export async function getDailyReport(date: string) {
  const { from, to } = reportWindow(date);

  // The three tables are keyed on the same window and read nothing from one
  // another, so they are fetched together rather than one after the other —
  // one round of round trips to Neon instead of three.
  const win = { importedAt: { gte: from, lt: to } };
  const [mis, entries, qc] = await Promise.all([
    prisma.mis.findMany({
      where: { dateAndTime: { gte: from, lt: to } },
      orderBy: { dateAndTime: "asc" },
      select: MIS_SELECT,
    }),
    prisma.polishEntry.findMany({ where: win, select: ENTRY_SELECT }),
    prisma.polishQc.findMany({ where: win, select: QC_SELECT }),
  ]);

  const hours = assembleHours(mis);
  const { shifts, day, cause, reclassified } = assembleDay(hours);

  return {
    date, window: { from, to }, hours, shifts, day, cause, reclassified,
    quality: getQuality(entries, qc),
    maintenance: getMaintenance(hours),
  };
}

/* ------------------------------------------------------------- maintenance */
// Built from the MIS rows, not from maintenance_ticket: that table has never
// been written to (0 rows, all time), so reading it would print an empty page
// and imply a quiet day. The page says where its figures come from.
const namesOn = (cols: (string | null)[]): string[] => {
  const set = new Set<string>();
  for (const v of cols) for (const part of String(v ?? "").split(",")) { const n = canonPerson(part); if (n) set.add(n); }
  return [...set].sort();
};

export function getMaintenance(hours: HourRow[]) {
  // THE SAME RECLASSIFICATION THE DOWNTIME TABLE APPLIES, FOR THE SAME REASON.
  // An hour whose reasons say POWER had its minutes booked to the breakdown
  // column but was a grid cut, not a machine fault. Counting it here would put
  // 181 minutes of "breakdown" on this page against 79 on page one and hand
  // maintenance a problem they do not have.
  //
  // POWER HOURS LEAVE THIS TABLE ENTIRELY. Even a power hour the in-charge
  // flagged as a breakdown (the flag is how the sheet says "we stopped") is
  // not a maintenance event — nothing failed in the plant — so it moves to its
  // own table below rather than sitting among the machine faults with a dash
  // for minutes. An hour can appear in both tables only when it genuinely lost
  // time both ways (a fault booked to breakdown and a cut booked to power);
  // the minutes come from different columns, so nothing is counted twice.
  // ROWS THAT REACH NO SHIFT ARE NOT ON THIS PAGE EITHER. An hour with no
  // hour label cannot be placed in a shift or an hour, and page one's target,
  // output, time-lost and cause figures all skip it (assembleDay). Counting it
  // HERE made this page disagree with page one, and with its own by-shift
  // table beside it: June 2026 printed 135 breakdown events / 3,551 minutes
  // against a causes row of 3,401 and a by-shift table summing to 126 / 3,401.
  // One rule, both pages.
  const isPower = (x: HourRow) => x.reasons.some((r) => /POWER/i.test(r));
  const placed = hours.filter((x) => x.shift != null);
  const events = placed.filter((x) => (x.breakdown || x.delay.breakdown > 0) && !isPower(x));
  const powerRows = placed
    .filter((x) => x.delay.power > 0 || (isPower(x) && (x.delay.breakdown > 0 || x.breakdown)))
    .map((x) => ({
      hour: x.hour, shift: x.shift,
      // page one's rule, verbatim: the hour's own power minutes, plus its
      // breakdown minutes when the reasons name the grid as the cause
      minutes: x.delay.power + (isPower(x) ? x.delay.breakdown : 0),
      note: x.details ?? null,
      reasons: x.reasons,
      // Whether the hour's own words are ABOUT the cut. When the reasons name
      // POWER, the note narrates the cut and can be printed beside it. When
      // the row is here only because minutes were typed into the power-out
      // column, the note belongs to the hour's machine stop (09-10 on 18 Aug:
      // 50 m of vacuum-cylinder work AND 10 m of power-out) — printing it
      // here would caption a grid cut with a repair story.
      reasonsSayPower: isPower(x),
      alsoMachineFault: (x.breakdown || x.delay.breakdown > 0) && !isPower(x),
    }));
  const byArea = new Map<string, { area: string; events: number; minutes: number; hours: string[] }>();
  for (const x of events) {
    // SORTED, so one pair of areas is one row. areaOfProblem is a multi-select
    // stored in the order the in-charge tapped it, so "Distributor / Press"
    // and "Press / Distributor" are the same failure typed two ways — over a
    // month that split one area pair into two rows, each with its own share.
    const area = x.area.length ? [...x.area].sort().join(" / ") : "Not recorded";
    const e = byArea.get(area) ?? { area, events: 0, minutes: 0, hours: [] };
    e.events++; e.minutes += x.delay.breakdown; e.hours.push(x.hour ?? "");
    byArea.set(area, e);
  }
  return {
    events,
    powerCuts: { rows: powerRows, minutes: powerRows.reduce((a, x) => a + x.minutes, 0) },
    byArea: [...byArea.values()].sort((a, b) => b.minutes - a.minutes || b.events - a.events),
    minutes: events.reduce((a, x) => a + x.delay.breakdown, 0),
    spares: events.filter((x) => x.spares),
    withRca: events.filter((x) => x.rca).length,
    // ONE NAME PER PERSON. The in-charge columns are comma-joined multi-selects
    // ("Narayanan, Arun") and the same man arrives under several spellings —
    // Joseph / Manikya / Josep / Jose is one mechanic. Split, canonicalise
    // through the same alias map the scoreboard pays on, and de-duplicate, or
    // this table lists a shift's one mechanic as two or three people.
    electrical: namesOn(placed.map((x) => x.electrical)),
    mechanical: namesOn(placed.map((x) => x.mechanical)),
    // Every breakdown-flagged hour, by shift — the shift that carries the
    // machine problem is not always the one with the worst output.
    byShift: (["A", "B", "C"] as ShiftLetter[]).map((s) => ({
      shift: s,
      events: events.filter((x) => x.shift === s).length,
      minutes: events.filter((x) => x.shift === s).reduce((a, x) => a + x.delay.breakdown, 0),
    })).filter((s) => s.events > 0),
  };
}

/* ----------------------------------------------------------------- quality */
// THREE STATUS FIELDS, THREE DIFFERENT QUESTIONS, THREE DIFFERENT TOTALS.
// The same 172 slabs carry a QC grade, a polishing status and a rework status,
// and they do not agree because they are not asking the same thing:
//   qualityGrade   what grade did QC give it            -> 133 A or A2
//   repolishStatus did it need repolishing              -> 142 did not, or passed after one
//   rwStatus       did it need rework at all            -> 137 went straight through
// A slab can clear one and fail another: of the 20 graded "Polish Ok", six came
// back B and one C. The page names each column by its question for that reason.
// Both tables are read by getDailyReport (alongside the Mis rows, in one go)
// and handed in here; this function only derives.
export function getQuality(entries: EntryRow[], qc: QcRow[]) {
  const tally = <T>(rows: T[], key: (r: T) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = key(r); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const count = (rows: typeof qc, f: (r: (typeof qc)[number]) => boolean) => rows.filter(f).length;

  // CTS IS A ROUTING, NOT A VERDICT ON THE SLAB. A slab sent to cut-to-size was
  // not inspected and found wanting — it was diverted to a different product
  // before that question was ever asked. It used to sit inside `graded` and
  // could never reach `passed`, so every one of the 62 CTS rows in the live
  // polish_qc table counted as a failure and pulled the CEO's pass rate down by
  // an amount nobody could account for from the grade table beside it.
  // gradeCredit() in shiftScoreMath.ts has excluded CTS from the payout for
  // exactly this reason since it was written; this report was the last surface
  // still scoring it as a reject. Own bucket, out of BOTH sides of the rate.
  //
  // ─────────── AND THE GRADE NO LONGER SAYS SO. THIS BUCKET NEARLY DIED ─────
  // This bucket was keyed on `qualityGrade === "CTS"` and nothing else.
  // scripts/0071 and 0072 regraded all 63 cut slabs from 'CTS' to 'B' on the
  // owner's decision, so that key now matches NOTHING — measured on live Neon
  // 2026-09-03, 0 rows in polish_qc carry grade 'CTS' or 'SAMPLE'. Left as it
  // was, this bucket would be permanently 0 and the 63 would fall straight back
  // into `graded` as failures — the exact defect the paragraph above says was
  // fixed, re-created by a data change rather than a code change. Measured over
  // August 2026, the month being settled: graded 5,865 -> 5,840, passed
  // unchanged at 5,475, so the rate goes 5,475/5,865 = 93.35% to 5,475/5,840 =
  // 93.75% (the page prints 93.4 and 93.8). The grade table's B row goes
  // 230 -> 205 with a CTS row of 25 beside it, and `ungraded` is 525 either way.
  //
  // ─────────── WHY THE KEY IS THE VERDICT AND DELIBERATELY NOT THE MARK ─────
  // The obvious re-key is slab_mark IN ('CTS','SAMPLE'). IT IS WRONG HERE, and
  // the next person to reach for it should read this first. Since scripts/0070
  // a cut slab KEEPS its real verdict: markQcSlabCts and markQcSlabSample write
  // the mark and leave quality_grade alone ("A · Sample" — the stone was good
  // AND it has been cut). An A that was genuinely inspected and then sent to
  // fabrication belongs in this rate on both sides. Keying on the mark would
  // quietly delete those real verdicts from the CEO's numbers from now on.
  //
  // What must stay out is a row carrying NO VERDICT — never judged, or judged
  // and then overwritten:
  //   qualityGrade 'CTS'/'SAMPLE'  the legacy write, still taken by any database
  //                                without scripts/0070 or when the mirror push
  //                                fails. The routing state IS the grade there.
  //   qualityGradeBeforeCts 'CTS'  what 0071/0072 stamped on the 63 they
  //                                regraded, precisely so a later reader could
  //                                tell their 'B' was a decision and not a
  //                                measurement. This is that reader.
  const NO_VERDICT = new Set(["CTS", "SAMPLE"]);
  const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
  const noVerdict = (r: (typeof qc)[number]) =>
    NO_VERDICT.has(up(r.qualityGrade)) || up(r.qualityGradeBeforeCts) === "CTS";
  // What this row REPORTS as. One definition, used by every grade-keyed figure
  // below, because a grade table whose B row still counted the 25 cut slabs
  // while the total row beside it named them separately would show them to the
  // CEO twice — 231 B against 206 real ones.
  const gradeOf = (r: (typeof qc)[number]) =>
    (noVerdict(r) ? "CTS" : r.qualityGrade ?? "Not recorded");

  const grades = tally(qc, gradeOf);
  const cts = qc.filter(noVerdict);
  const graded = qc.filter((r) =>
    r.qualityGrade && r.qualityGrade !== "Not graded yet" && !noVerdict(r));
  const passed = graded.filter((r) => r.qualityGrade === "A" || r.qualityGrade === "A2");

  // Faults are a multi-select: one slab can carry several, so the fault count
  // and the slab count are different numbers and both are reported.
  const faultsOf = (rows: typeof qc): [string, number][] => {
    const m = new Map<string, number>();
    for (const r of rows) for (const f of r.qualityIssue ?? []) m.set(f, (m.get(f) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  // gradeOf, not qualityGrade: the 63 regraded slabs read 'B' and carry no
  // faults, because nobody ever inspected them. Counting them here would say
  // 25 more slabs were downgraded in August than were, on zero recorded faults.
  const bc = qc.filter((r) => gradeOf(r) === "B" || gradeOf(r) === "C (Reject)");

  // Which shift a person worked, from when their rows landed — neither
  // polishing table carries a shift column. A second shift is named only when
  // it carries a real share; one row at a boundary is noise, not a shift.
  const shiftLabel = <T extends { importedAt: Date }>(rows: T[], key: (r: T) => string | null, who: string) => {
    const mine = rows.filter((r) => (key(r) ?? "Not recorded") === who);
    const c: Record<ShiftLetter, number> = { A: 0, B: 0, C: 0 };
    for (const r of mine) c[shiftOf(istHour(r.importedAt))]++;
    const [first, second] = (Object.entries(c) as [ShiftLetter, number][]).sort((a, b) => b[1] - a[1]);
    if (!first?.[1]) return "";
    return `${first[0]} shift${second && second[1] / mine.length >= 0.05 ? ` and the tail of ${second[0]}` : ""}`;
  };

  // Design comes from polishEntry (what was polished); the grade comes from the
  // slab's QC row. They never disagree on design for the same slab — but they
  // cover different slabs, so some polished slabs have no QC row at all and
  // some inspected slabs were not polished today. Those are counted ungraded,
  // which is why this table's grades do not add up to the grade table.
  const qcBySlab = new Map<number, (typeof qc)[number]>();
  for (const r of qc) if (r.slabNumber != null) qcBySlab.set(r.slabNumber, r);
  const byDesign = new Map<string, {
    design: string | null; batches: Set<string>; slabs: number; face: string | null;
    A: number; A2: number; B: number; C: number; ungraded: number;
  }>();
  for (const e of entries) {
    const k = e.design ?? "(none)";
    if (!byDesign.has(k)) byDesign.set(k, {
      design: e.design, batches: new Set(), slabs: 0,
      face: e.polishSide ? FACE[e.polishSide] ?? e.polishSide : null,
      A: 0, A2: 0, B: 0, C: 0, ungraded: 0,
    });
    const d = byDesign.get(k)!;
    d.slabs++; if (e.batchNumber) d.batches.add(e.batchNumber);
    const qr = e.slabNumber != null ? qcBySlab.get(e.slabNumber) : undefined;
    const g = qr ? gradeOf(qr) : null;
    if (g === "A") d.A++; else if (g === "A2") d.A2++;
    else if (g === "B") d.B++; else if (g === "C (Reject)") d.C++;
    else d.ungraded++;
  }

  // The headline pair reads wrong at first glance — inspected can exceed
  // polished — and the explanation is queues, not a bug: polishing and QC are
  // separate stations, so QC also clears slabs polished on earlier days while
  // the day's last-polished slabs have not reached it yet. The distinct slab
  // numbers are intersected here so the page can state that split instead of
  // asserting it; rows with no slab number cannot be matched and are left out.
  const polishedSlabs = new Set(entries.map((e) => e.slabNumber).filter((n): n is number => n != null));
  const inspectedSlabs = new Set(qc.map((r) => r.slabNumber).filter((n): n is number => n != null));
  const slabsInBoth = [...polishedSlabs].filter((n) => inspectedSlabs.has(n)).length;

  const pick = (t: [string, number][], k: string) => t.find(([x]) => x === k)?.[1] ?? 0;
  const repolish = tally(qc, (r) => r.repolishStatus ?? "Not recorded");

  return {
    polished: entries.length, inspected: qc.length,
    polishedSlabs: polishedSlabs.size, inspectedSlabs: inspectedSlabs.size,
    slabsInBoth,
    polishedNotInspected: polishedSlabs.size - slabsInBoth,
    inspectedNotPolished: inspectedSlabs.size - slabsInBoth,
    passed: passed.length, graded: graded.length,
    passRate: graded.length ? (100 * passed.length) / graded.length : null,
    gradeA: count(qc, (r) => r.qualityGrade === "A"),
    gradeA2: count(qc, (r) => r.qualityGrade === "A2"),
    // Slabs still WAITING on a verdict. CTS is subtracted separately rather
    // than left to fall in here: it is neither graded nor waiting to be, and
    // rolling it into this figure would only move the same slabs from "counted
    // as failures" to "counted as still in QC" — wrong in a quieter way, and
    // the page prints this number as "still being graded".
    ungraded: qc.length - graded.length - cts.length,
    /** Routed to cut-to-size or to sampling WITHOUT a verdict surviving — the
     *  legacy 'CTS'/'SAMPLE' grade write, or a 'B' that scripts/0071 and 0072
     *  decided rather than measured. A slab that was genuinely graded and then
     *  cut keeps its grade and is NOT in here. Reported so the grade table's
     *  four buckets still add up to everything inspected; not a pass and not a
     *  failure. */
    cts: cts.length,
    held: graded.length - passed.length,
    openForRework: count(qc, (r) => r.repolishStatus === "Repolish Required" || r.rwStatus === "RW Required and ongoing"),
    // The mirror of openForRework: slabs that needed work and CAME BACK GOOD.
    // Counted distinctly, over the two fields, for the same reason the open
    // figure is — a slab can be marked on both, and adding the two columns
    // double-counts it. "Repolish Done" and "RW Done Ok" are the two values
    // that mean the slab was not right, was worked, and then was.
    //
    // Deliberately NOT including a recovery from "ungraded": qualityGrade
    // carries no history, so an ungraded slab that is later graded A leaves no
    // record that it was ever ungraded. There is nothing to count.
    recovered: count(qc, (r) => r.repolishStatus === "Repolish Done" || r.rwStatus === "RW Done Ok"),
    recoveredRepolish: count(qc, (r) => r.repolishStatus === "Repolish Done"),
    recoveredRework: count(qc, (r) => r.rwStatus === "RW Done Ok"),
    toDispatch: count(qc, (r) => r.goingToDispatch === "Yes"),
    grades,
    // Keyed by gradeOf so it lines up with `grades` — the grade table looks
    // this map up by the row label it just printed, and a CTS row that found no
    // key would read as "0 going to dispatch" by accident rather than on
    // purpose.
    dispatchByGrade: Object.fromEntries([...new Set(qc.map(gradeOf))]
      .map((g) => [g, count(qc, (r) => gradeOf(r) === g && r.goingToDispatch === "Yes")])),
    // Named by the question the column answers, not by "passed" — see the note
    // at the top of this function.
    polishing: {
      noRepolish: pick(repolish, "Direct Ok"),
      passedAfter: pick(repolish, "Polish Ok"),
      needsRepolish: pick(repolish, "Repolish Required"),
      repolishDone: pick(repolish, "Repolish Done"),
      notRecorded: pick(repolish, "Not recorded"),
    },
    rework: tally(qc, (r) => r.rwStatus ?? "Not recorded"),
    // What the slabs that never needed rework were actually graded. This is the
    // whole reason 137 and 133 differ, so the page has to be able to say it
    // rather than assert the gap and leave the reader to trust it.
    reworkClearByGrade: tally(qc.filter((r) => r.rwStatus === "Direct Ok"), gradeOf),
    faultsAll: faultsOf(qc), faultsBC: faultsOf(bc),
    faultSlabs: count(qc, (r) => (r.qualityIssue ?? []).length > 0),
    faultTotal: qc.reduce((a, r) => a + (r.qualityIssue ?? []).length, 0),
    faultSlabsMulti: count(qc, (r) => (r.qualityIssue ?? []).length > 1),
    bcSlabs: bc.length, bcFaultTotal: bc.reduce((a, r) => a + (r.qualityIssue ?? []).length, 0),
    operators: tally(entries, (r) => r.calliberator ?? "Not recorded")
      .map(([k, n]) => [k, n, shiftLabel(entries, (r) => r.calliberator, k)] as const),
    inspectors: tally(qc, (r) => r.inspector ?? "Not recorded")
      .map(([k, n]) => [k, n, shiftLabel(qc, (r) => r.inspector, k)] as const),
    designs: [...byDesign.values()].sort((a, b) => b.slabs - a.slabs),
    thickness: tally(entries, (r) => r.slabThickness ?? "Not recorded"),
  };
}

export type DailyReport = Awaited<ReturnType<typeof getDailyReport>>;
