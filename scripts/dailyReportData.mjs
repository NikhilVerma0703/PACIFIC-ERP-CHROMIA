// Every figure the daily report prints, derived from the database and nothing else.
//
// WHY THIS FILE IS SEPARATE FROM THE LAYOUT
// The numbers are the part that can be wrong in a way nobody notices. Keeping
// them here means they can be re-derived and checked without rendering a PDF,
// and the layout file cannot quietly compute anything of its own.
//
// THE DAY IS 06:00 TO 06:00 IST, NOT MIDNIGHT TO MIDNIGHT
// A shift starts at 06:00 and C shift runs past midnight, so a calendar day
// would cut C shift in half and blame two dates for one night's work. Every
// window below is [06:00 IST on the report date, 06:00 IST the next day).
//
// WHICH TIMESTAMP EACH TABLE IS KEYED ON, AND WHY THEY DIFFER
// mis.date_and_time is entered by the shift in-charge and is trustworthy.
// polish_entry.created / polish_qc.created_time ARE NOT: both stop dead at
// 2026-06-08 across the whole table, so a window on them returns zero rows for
// any recent day. Those two are keyed on imported_at, the Airtable sync time,
// which is the only timestamp that still moves. If `created` ever starts
// populating again, prefer it — but check coverage first, do not assume.
import { PrismaClient } from "@prisma/client";

const IST_OFFSET_MIN = 330;
const SHIFTS = [
  { letter: "A", from: 6,  incharge: null, label: "06:00 - 14:00" },
  { letter: "B", from: 14, incharge: null, label: "14:00 - 22:00" },
  { letter: "C", from: 22, incharge: null, label: "22:00 - 06:00" },
];

/** The 06:00->06:00 IST window for `date` (YYYY-MM-DD), as UTC Dates. */
export function reportWindow(date) {
  const from = new Date(`${date}T06:00:00.000Z`);
  from.setUTCMinutes(from.getUTCMinutes() - IST_OFFSET_MIN);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

/** "06 - 07" -> 6. The hour label is the in-charge's own, so it is the key. */
const hourStart = (h) => (h ? Number(String(h).slice(0, 2)) : null);
const shiftOf = (h) => (h >= 6 && h < 14 ? "A" : h >= 14 && h < 22 ? "B" : "C");
const FACE = { BS: "Bottom side", TS: "Top side" };
const mins = (r) =>
  (r.processDelayDurationMinutes ?? 0) + (r.cleaningDelayDurationMinutes ?? 0) +
  (r.breakdownDelayDurationMechanicalOrElectricalMinutes ?? 0) + (r.poweroutDelayDurationMinutes ?? 0);

/** Slabs an hour declares. e - s + 1, because both ends are inclusive: an hour
 *  running 154962-154973 made twelve slabs, not eleven. An hour that declares
 *  no range made no claim and is null, NOT zero — the difference is the whole
 *  reason two hours are excluded from the target rather than counted as misses. */
function slabsOf(r) {
  if (r.startingSlabNumber == null || r.endingSlabNumber == null) return null;
  const n = r.endingSlabNumber - r.startingSlabNumber + 1;
  return n > 0 ? n : null;
}

export async function collect(date, prisma = new PrismaClient()) {
  const { from, to } = reportWindow(date);

  const mis = await prisma.mis.findMany({
    where: { dateAndTime: { gte: from, lt: to } },
    orderBy: { dateAndTime: "asc" },
  });

  const hours = mis.map((r) => {
    const h = hourStart(r.hour);
    return {
      hour: r.hour, h, shift: shiftOf(h),
      incharge: r.productionInchargeName ?? r.submittedBy ?? null,
      batch: r.batch, design: r.design,
      made: slabsOf(r),
      std: r.slabsPerHourStd ?? null,
      lost: mins(r),
      delay: {
        process: r.processDelayDurationMinutes ?? 0,
        cleaning: r.cleaningDelayDurationMinutes ?? 0,
        breakdown: r.breakdownDelayDurationMechanicalOrElectricalMinutes ?? 0,
        power: r.poweroutDelayDurationMinutes ?? 0,
      },
      reasons: r.reasonForDeviation ?? [],
      details: r.details ?? null,
      area: r.areaOfProblem ?? [],
    };
  });

  // A shift's target counts only the hours it actually declared output for.
  // Charging it for an hour it never claimed would invent a miss.
  const shifts = SHIFTS.map((s) => {
    const rows = hours.filter((x) => x.shift === s.letter);
    const made = rows.reduce((a, x) => a + (x.made ?? 0), 0);
    const target = rows.reduce((a, x) => a + (x.made == null ? 0 : (x.std ?? 0)), 0);
    return {
      ...s,
      incharge: rows.find((x) => x.incharge)?.incharge ?? null,
      rows, made, target,
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
  };
  day.pct = day.target ? (100 * day.made) / day.target : null;

  // DOWNTIME IS RECLASSIFIED, AND THE REPORT SAYS SO ON THE PAGE.
  // B shift booked its power-cut hours to the breakdown column while writing
  // "Power cut 17:33-18:00" in the notes and leaving the breakdown flag blank.
  // Printing the raw column would name the wrong cause and read as a machine
  // problem the maintenance team does not have. The rule is narrow on purpose:
  // breakdown minutes move to power ONLY when the hour's own reason list says
  // POWER SHUTDOWN. Nothing else is moved, and the total cannot change.
  let moved = 0;
  const cause = { cleaning: 0, power: 0, process: 0, breakdown: 0 };
  for (const x of hours) {
    const power = x.reasons.some((r) => /POWER/i.test(r));
    cause.cleaning += x.delay.cleaning;
    cause.process += x.delay.process;
    if (power && x.delay.breakdown) { cause.power += x.delay.breakdown; moved += x.delay.breakdown; }
    else cause.breakdown += x.delay.breakdown;
    cause.power += x.delay.power;
  }

  return { date, window: { from, to }, hours, shifts, day, cause, reclassified: moved,
           quality: await collectQuality(prisma, from, to), prisma };
}

async function collectQuality(prisma, from, to) {
  const win = { importedAt: { gte: from, lt: to } };
  const entries = await prisma.polishEntry.findMany({ where: win });
  const qc = await prisma.polishQc.findMany({ where: win });

  // WHICH SHIFT A PERSON WORKED, from when their rows landed. There is no
  // shift column on either polishing table, so the only evidence is the clock.
  // A second shift is named only when it carries a real share of the work —
  // one stray row at a shift boundary is noise, not a shift worked.
  const IST = (d) => new Date(d.getTime() + IST_OFFSET_MIN * 60000).getUTCHours();
  const shiftLabel = (rows, key, who) => {
    const mine = rows.filter((r) => (key(r) ?? "Not recorded") === who);
    const c = { A: 0, B: 0, C: 0 };
    for (const r of mine) c[shiftOf(IST(r.importedAt))]++;
    const [first, second] = Object.entries(c).sort((a, b) => b[1] - a[1]);
    if (!first?.[1]) return "";
    const tail = second?.[1] / mine.length >= 0.05 ? ` and the tail of ${second[0]}` : "";
    return `${first[0]} shift${tail}`;
  };

  const tally = (rows, key) => {
    const m = new Map();
    for (const r of rows) { const k = key(r); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };

  const grades = tally(qc, (r) => r.qualityGrade ?? "Not recorded");
  const graded = qc.filter((r) => r.qualityGrade && r.qualityGrade !== "Not graded yet");
  const passed = graded.filter((r) => r.qualityGrade === "A" || r.qualityGrade === "A2");

  // Faults are a multi-select: one slab can carry several, so the fault count
  // and the slab count are different numbers and both are reported.
  const faultsOf = (rows) => {
    const m = new Map();
    for (const r of rows) for (const f of r.qualityIssue ?? []) m.set(f, (m.get(f) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const bc = qc.filter((r) => r.qualityGrade === "B" || r.qualityGrade === "C (Reject)");

  // Design comes from polish_entry (what was polished); the grade comes from
  // the slab's QC row. They never disagree on design for the same slab — but
  // they cover different slabs, so 22 polished slabs have no QC row at all and
  // 8 inspected slabs (Arva White) were not polished today. Those 22 are
  // counted as ungraded here, which is why this table's grades do not add up
  // to the Quality Grades table on the same page. The note on the page says so.
  const qcBySlab = new Map();
  for (const r of qc) if (r.slabNumber != null) qcBySlab.set(r.slabNumber, r);
  const byDesign = new Map();
  for (const e of entries) {
    const k = `${e.design ?? "(none)"}`;
    if (!byDesign.has(k)) byDesign.set(k, { design: e.design, batches: new Set(), slabs: 0, face: FACE[e.polishSide] ?? e.polishSide, A: 0, A2: 0, B: 0, C: 0, ungraded: 0 });
    const d = byDesign.get(k);
    d.slabs++; if (e.batchNumber) d.batches.add(e.batchNumber);
    const g = qcBySlab.get(e.slabNumber)?.qualityGrade;
    if (g === "A") d.A++; else if (g === "A2") d.A2++;
    else if (g === "B") d.B++; else if (g === "C (Reject)") d.C++;
    else d.ungraded++;
  }

  return {
    polished: entries.length, inspected: qc.length,
    passed: passed.length, graded: graded.length,
    passRate: graded.length ? (100 * passed.length) / graded.length : null,
    openForRework: qc.filter((r) => r.repolishStatus === "Repolish Required" || r.rwStatus === "RW Required and ongoing").length,
    toDispatch: qc.filter((r) => r.goingToDispatch === "Yes").length,
    grades,
    repolish: tally(qc, (r) => r.repolishStatus ?? "Not recorded"),
    rework: tally(qc, (r) => r.rwStatus ?? "Not recorded"),
    faultsAll: faultsOf(qc),
    faultsBC: faultsOf(bc),
    faultSlabs: qc.filter((r) => (r.qualityIssue ?? []).length > 0).length,
    faultTotal: qc.reduce((a, r) => a + (r.qualityIssue ?? []).length, 0),
    faultSlabsMulti: qc.filter((r) => (r.qualityIssue ?? []).length > 1).length,
    bcSlabs: bc.length,
    bcFaultTotal: bc.reduce((a, r) => a + (r.qualityIssue ?? []).length, 0),
    operators: tally(entries, (r) => r.calliberator ?? "Not recorded")
      .map(([k, n]) => [k, n, shiftLabel(entries, (r) => r.calliberator, k)]),
    inspectors: tally(qc, (r) => r.inspector ?? "Not recorded")
      .map(([k, n]) => [k, n, shiftLabel(qc, (r) => r.inspector, k)]),
    // How many of each grade are already cleared to leave — the grade table
    // says so per row, because "passed" and "shippable" are not the same thing.
    dispatchByGrade: Object.fromEntries([...new Set(qc.map((r) => r.qualityGrade))].map((g) =>
      [g, qc.filter((r) => r.qualityGrade === g && r.goingToDispatch === "Yes").length])),
    designs: [...byDesign.values()].sort((a, b) => b.slabs - a.slabs),
    thickness: tally(entries, (r) => r.slabThickness ?? "Not recorded"),
  };
}
