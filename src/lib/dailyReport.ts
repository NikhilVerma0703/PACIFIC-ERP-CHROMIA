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

/** Slabs an hour declares. e - s + 1, because both ends are inclusive: an hour
 *  running 154962-154973 made twelve slabs, not eleven. An hour that declares
 *  no range made no claim and is null, NOT zero — that difference is why such
 *  hours are left out of the target rather than counted as misses. */
function slabsOf(s: number | null, e: number | null): number | null {
  if (s == null || e == null) return null;
  const n = e - s + 1;
  return n > 0 ? n : null;
}

export type HourRow = {
  hour: string | null; h: number | null; shift: ShiftLetter | null;
  incharge: string | null; batch: string | null; design: string | null;
  made: number | null; std: number | null; lost: number;
  delay: { process: number; cleaning: number; breakdown: number; power: number };
  reasons: string[]; details: string | null; area: string[];
  breakdown: boolean; spares: string | null; actionTaken: string | null; rca: string | null;
  electrical: string | null; mechanical: string | null;
};

export async function getDailyReport(date: string) {
  const { from, to } = reportWindow(date);

  const mis = await prisma.mis.findMany({
    where: { dateAndTime: { gte: from, lt: to } },
    orderBy: { dateAndTime: "asc" },
  });

  const hours: HourRow[] = mis.map((r) => {
    const h = hourStart(r.hour);
    return {
      hour: r.hour, h, shift: h == null ? null : shiftOf(h),
      incharge: r.productionInchargeName ?? r.submittedBy ?? null,
      batch: r.batch, design: r.design,
      made: slabsOf(r.startingSlabNumber, r.endingSlabNumber),
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
    const isPower = x.reasons.some((r) => /POWER/i.test(r));
    cause.cleaning += x.delay.cleaning;
    cause.process += x.delay.process;
    cause.power += x.delay.power + (isPower ? x.delay.breakdown : 0);
    cause.breakdown += isPower ? 0 : x.delay.breakdown;
    if (isPower) reclassified += x.delay.breakdown;
  }

  return {
    date, window: { from, to }, hours, shifts, day, cause, reclassified,
    quality: await getQuality(from, to),
    maintenance: getMaintenance(hours),
  };
}

/* ------------------------------------------------------------- maintenance */
// Built from the MIS rows, not from maintenance_ticket: that table has never
// been written to (0 rows, all time), so reading it would print an empty page
// and imply a quiet day. The page says where its figures come from.
function getMaintenance(hours: HourRow[]) {
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
  const isPower = (x: HourRow) => x.reasons.some((r) => /POWER/i.test(r));
  const events = hours.filter((x) => (x.breakdown || x.delay.breakdown > 0) && !isPower(x));
  const powerRows = hours
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
    const area = x.area.length ? x.area.join(" / ") : "Not recorded";
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
    electrical: [...new Set(hours.map((x) => x.electrical).filter(Boolean))] as string[],
    mechanical: [...new Set(hours.map((x) => x.mechanical).filter(Boolean))] as string[],
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
async function getQuality(from: Date, to: Date) {
  const win = { importedAt: { gte: from, lt: to } };
  const entries = await prisma.polishEntry.findMany({ where: win });
  const qc = await prisma.polishQc.findMany({ where: win });

  const tally = <T>(rows: T[], key: (r: T) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = key(r); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const count = (rows: typeof qc, f: (r: (typeof qc)[number]) => boolean) => rows.filter(f).length;

  const grades = tally(qc, (r) => r.qualityGrade ?? "Not recorded");
  const graded = qc.filter((r) => r.qualityGrade && r.qualityGrade !== "Not graded yet");
  const passed = graded.filter((r) => r.qualityGrade === "A" || r.qualityGrade === "A2");

  // Faults are a multi-select: one slab can carry several, so the fault count
  // and the slab count are different numbers and both are reported.
  const faultsOf = (rows: typeof qc): [string, number][] => {
    const m = new Map<string, number>();
    for (const r of rows) for (const f of r.qualityIssue ?? []) m.set(f, (m.get(f) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const bc = qc.filter((r) => r.qualityGrade === "B" || r.qualityGrade === "C (Reject)");

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
    const g = e.slabNumber != null ? qcBySlab.get(e.slabNumber)?.qualityGrade : null;
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
    ungraded: qc.length - graded.length,
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
    dispatchByGrade: Object.fromEntries([...new Set(qc.map((r) => r.qualityGrade))]
      .map((g) => [g ?? "Not recorded", count(qc, (r) => r.qualityGrade === g && r.goingToDispatch === "Yes")])),
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
    reworkClearByGrade: tally(qc.filter((r) => r.rwStatus === "Direct Ok"), (r) => r.qualityGrade ?? "Not recorded"),
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
