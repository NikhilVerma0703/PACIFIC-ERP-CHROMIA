// Pure scoring arithmetic - no database, no Prisma, no I/O.
//
// Split out of shiftScore.ts so `node --test` can reach it without a database.
// These functions decide money and every one of them has already been wrong
// once: CTS scored as a reject, two spellings of one man paid twice, a floor
// that zeroed the whole board. Cheap to test, expensive to get wrong.
//
// shiftScore.ts re-exports everything here, so no caller needs to know.

/** Ideal MEASURED thickness at Jot, per nominal slab class.
 *  A slab leaves the line thicker than nominal and is ground down in polishing,
 *  so 3 cm is not 30 mm here — it is 34. Confirmed for 3 cm; the others follow
 *  the same +4 mm allowance and should be confirmed before anyone is paid. */
export const IDEAL_MM: Record<string, number> = {
  "3 cm": 34,
  "2 cm": 24,
  "1.2 cm": 16,
};

/** Deviation (mm) at which the quality score reaches zero; inside the band the
 *  score falls off linearly (34.0 -> 100%, 36.0 -> 50%, 38.0 -> 0% at tol 4).
 *
 *  CALIBRATION, NOT A GUESS. The line currently averages 36.9 mm on 3 cm. At a
 *  ±2 mm band that is already zero, so every shift scored nothing and the whole
 *  scoreboard read 1% — an incentive nobody can earn is one nobody plays. 4 mm
 *  puts today's output around 27% and makes each millimetre of improvement
 *  visibly worth money, which is the behaviour this is meant to buy. Tighten it
 *  as the line gets closer to target. */
export const TOLERANCE_MM = 4;

/** Readings outside this are physically impossible and are data-entry errors
 *  (the live data holds a 3.3 mm and a 267 mm on slabs declared 3 cm / 2 cm).
 *  Scoring them would let one typo wipe out a shift, so they are dropped and
 *  counted separately instead. */
export const MIN_PLAUSIBLE_MM = 5;
export const MAX_PLAUSIBLE_MM = 60;

/** Widest slab range one MIS hour may declare before it is treated as a typo.
 *
 *  CALIBRATED ON THE PLANT'S OWN ENTRIES, not guessed. Over the last 120 days
 *  every real hour declares 2-20 slabs; the single widest legitimate row is 35.
 *  Above that the data is only digit slips - 112, 503, 1,011, 9,005, 30,010,
 *  135,513 and two rows over 1.2 MILLION slabs.
 *
 *  The old cap of 500 was ~25x the real ceiling, so it caught the millions and
 *  waved the 112 through: on 2026-07-17 an hour typed 148551-148662 instead of
 *  ~148551-148562 and swallowed 100 slabs that Pradhap's rows had already
 *  claimed. Both shifts then lost them to the double-claim rule. 60 is 3x the
 *  widest hour this plant has ever really worked and still rejects that row. */
export const MAX_SLABS_PER_HOUR = 60;

export const IST_MIN = 330;
const SHIFT_START: Record<ShiftLetter, number> = { A: 6, B: 14, C: 22 };
export type ShiftLetter = "A" | "B" | "C";

export const plusDay = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** UTC span of one shift instance (anchor = the IST date the shift STARTED). */
export function shiftRange(anchor: string, shift: ShiftLetter) {
  const istStart = new Date(`${anchor}T${String(SHIFT_START[shift]).padStart(2, "0")}:00:00.000Z`);
  const start = new Date(istStart.getTime() - IST_MIN * 60_000);
  return { start, end: new Date(start.getTime() + 8 * 3600_000) };
}

/** Grade -> quality credit. A is the saleable target, B is usable but worth
 *  less, C is a reject and earns nothing. Anything else (CTS, Printing,
 *  "Not graded yet") is not a verdict on production and is excluded entirely
 *  rather than scored as zero. */
/** The grade share every shift already clears. Quality is scored on the distance
 *  ABOVE this, not from zero.
 *
 *  WHY A FLOOR AT ALL. Raw grade share does not discriminate: in July every
 *  shift landed between 93.6% and 98.0%, so the quality factor was ~0.95 for
 *  everyone and the ranking collapsed into pure quantity — the second axis was
 *  decorative. C grades are only ~3% of output, so there is simply not much room
 *  below 100%. Stretching a narrow band into a wide one is what makes quality
 *  decide places again. A shift below the floor scores zero on quality and
 *  therefore takes nothing from the quality pool, which is the intended cliff.
 *
 *  WHY 87, NOT 90. Set by decision 2026-08-06 together with QUALITY_TARGET. The
 *  band is still ten points wide, so a point of grade share is worth the same
 *  ten points of score it always was — the window simply slides down three, and
 *  a shift having a bad month is no longer wiped out at 89%. */
export const QUALITY_FLOOR = 0.87;

/** The grade share that scores a FULL 100% on quality. Above it there is nothing
 *  further to win.
 *
 *  WHY NOT 100%. A perfect grade share is not a target anyone can plan for — it
 *  is the absence of the one bad slab that was always going to happen. Scoring
 *  against it meant the top of the scale was permanently out of reach, and the
 *  shifts genuinely running the plant's best quality were still being told they
 *  had 20% left to find. 97% is the number the good months actually hit.
 *
 *  THE COST, STATED PLAINLY: this compresses the top. A shift at 97% and a shift
 *  at 99.5% now tie on quality at 100%, where before they scored 70% and 95%.
 *  Above 97% the quality pool is split evenly and only volume separates them.
 *  That is the intended trade — a reachable ceiling beats a discriminating one —
 *  but if the field ever bunches ABOVE 97%, raise this rather than the floor. */
export const QUALITY_TARGET = 0.97;

/** Raw grade share -> scored quality, stretched between the floor and the target.
 *  87% -> 0, 92% -> 50%, 97% and anything above -> 100%. */
export function scaleQuality(raw: number | null): number | null {
  if (raw == null) return null;
  return Math.max(0, Math.min(1, (raw - QUALITY_FLOOR) / (QUALITY_TARGET - QUALITY_FLOOR)));
}

/** The same treatment for uptime, and for the same reason: unstretched, the
 *  electrical and mechanical shares came out near-equal by headcount however the
 *  month actually went.
 *
 *  CALIBRATED, like TOLERANCE_MM. Measured against hours logged, July 2026 runs
 *  84.4% to 93.9% for everyone with more than one shift. A 90% floor zeroed two
 *  of the four electricals outright and handed 40% of their pool to a man with a
 *  single quiet shift. 0.75 keeps the whole real field on the board and still
 *  turns a 9-point spread into a 38-point one. */
export const UPTIME_FLOOR = 0.75;
export function scaleUptime(raw: number | null): number | null {
  if (raw == null) return null;
  return Math.max(0, Math.min(1, (raw - UPTIME_FLOOR) / (1 - UPTIME_FLOOR)));
}

/** Polishing has its own floor because it is a different measurement. "Finished
 *  OK" runs 89.3-91.5% across the three calliberators, so scoring it from the
 *  90% grade floor put one of the three on zero and told the other two almost
 *  nothing. 0.85 sits below the real field and still separates it. */
export const POLISH_FLOOR = 0.85;
export function scalePolish(raw: number | null): number | null {
  if (raw == null) return null;
  return Math.max(0, Math.min(1, (raw - POLISH_FLOOR) / (1 - POLISH_FLOOR)));
}

// --------------------------------------------------------------------------
// SLOW PRODUCTS COUNT DOUBLE
// --------------------------------------------------------------------------
// Not every slab costs the same to make. The MIS hour carries the STANDARD
// output for what was running that hour - slabs_per_hour_std - and it ranges
// from 3 to 16 across August. A shift on a 15-an-hour design and a shift on a
// 7-an-hour one were paid per slab at the same rate, so the hard work paid
// barely half as much per hour of the same effort. Nobody wants the difficult
// design.
//
// So a product whose STANDARD is 10 an hour or less counts each good slab as
// TWO. Set by decision; the threshold is on the STANDARD, not on what the shift
// actually achieved, which matters: it is a property of the product the plant
// chose to run, not of how the shift performed. A shift cannot earn the
// multiplier by running slowly.
//
// In August this covers 242 of the 636 hours that carry a standard - 1,663 of
// the 6,327 slabs claimed, about a quarter of the month.
//
// A BLANK STANDARD IS NOT A SLOW ONE. 100 August rows have no standard at all,
// and every one of them also declares no slab range, so they claim nothing
// either way - but the rule is written to be explicit rather than to rely on
// that: no standard means no multiplier. Zero is treated the same, being a
// missing value wearing a number.
export const SLOW_STD_MAX = 10;
export const SLOW_STD_MULTIPLIER = 2;

/** What one good slab is worth, given the standard output of the hour that
 *  claimed it. 2 for a slow product, 1 for everything else. */
export function stdMultiplier(std: number | null | undefined): number {
  const n = Number(std);
  if (!Number.isFinite(n) || n <= 0) return 1;   // blank, or a missing value written as 0
  return n <= SLOW_STD_MAX ? SLOW_STD_MULTIPLIER : 1;
}

export function gradeCredit(grade: string | null | undefined): number | null {
  const g = String(grade ?? "").trim().toUpperCase();
  if (!g || g.startsWith("NOT GRADED")) return null;
  // CTS ("cut to size") and PRINTING are routings, not verdicts on the slab, and
  // must be tested BEFORE the C branch — "CTS".startsWith("C") is true, so they
  // were scoring as rejects. The doc above always said they were excluded; the
  // code did not. 37 slabs live, and each one cost a shift 9 points.
  if (g === "CTS" || g.startsWith("PRINT")) return null;
  if (g.startsWith("A")) return 1;      // A and A2
  if (g.startsWith("B")) return 0.5;
  if (g.startsWith("C")) return 0;      // "C" / "C (Reject)"
  return null;
}

// --------------------------------------------------------------------------
// Polishing outcome — the QC measure for the POLISH line, not the press line
// --------------------------------------------------------------------------
// A grade is a verdict on the slab the press made. It is the wrong measure for
// the calliberator, who does not decide what arrives at his machine — his job is
// to send it out finished, and to RESCUE the ones that come back. QC records
// exactly that in two columns:
//
//   rw_status        Direct Ok | RW Done Ok | RW Required and ongoing | Can't be Reworked
//   repolish_status  Polish Ok | Direct Ok  | Repolish Done           | Repolish Required
//
// so the polishing board is scored on what those say happened, and on how many
// slabs went through — not on A/B/C, which the polisher did not cause.
const RW_OK = new Set(["DIRECT OK", "RW DONE OK"]);
const RW_LOST = new Set(["CAN'T BE REWORKED", "CANT BE REWORKED"]);
const RP_OK = new Set(["POLISH OK", "DIRECT OK", "REPOLISH DONE"]);
const RP_OPEN = new Set(["REPOLISH REQUIRED"]);
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

/** 1 = finished OK (first pass or rescued), 0 = lost, null = still open.
 *  Open work is excluded exactly as an ungraded slab is: never counted as bad. */
export function polishCredit(rw: unknown, rp: unknown): number | null {
  const r = norm(rw), p = norm(rp);
  if (RW_LOST.has(r)) return 0;                 // scrapped at rework — a loss
  if (r === "RW REQUIRED AND ONGOING") return null;
  if (RP_OPEN.has(p)) return null;              // came back, not yet redone
  if (RP_OK.has(p) || RW_OK.has(r)) return 1;   // "RW Done Ok" / "Repolish Done" count here
  return null;                                  // no verdict recorded either way
}

/** Per-slab closeness to ideal: 1.0 exactly on target, 0 at the tolerance edge. */
export function slabQuality(measuredMm: number, ideal: number, tol = TOLERANCE_MM): number {
  const dev = Math.abs(measuredMm - ideal);
  return Math.max(0, 1 - dev / tol);
}


/** One spelling per person.
 *
 *  Names are free text on the MIS form, so the same person arrives in several
 *  forms and the board showed them as separate people with separate scores —
 *  "SURESH" appeared beside "Suresh" with 1 shift against his 187 rows. Case and
 *  spacing are folded here; genuine misspellings (Sundhar for Sundar, Josep for
 *  Joseph) still need the alias map below, because no rule can safely guess
 *  that two different spellings are the same human. */
const PERSON_ALIAS: Record<string, string> = {
  // lower-cased variant -> canonical spelling
  sundhar: "Sundar",
  josep: "Joseph",

  // ---- Station operators: the Airtable spelling vs the ERP one --------------
  // Every station carries the same person twice, and the split is a clean
  // changeover, not a typo: the long Airtable name stops in June 2026 and the
  // short ERP-form name starts. Inside one recent month only one spelling
  // appears, so a monthly payout is unaffected — but any range reaching back
  // past June splits one operator into two rows, halves his per-shift rate and
  // dilutes everyone else's share, because the divisor counts him twice.
  //
  // CONFIRM THESE AGAINST THE ACTUAL ROSTER BEFORE ANYONE IS PAID on a range
  // that crosses June 2026. They are read off the changeover pattern, and no
  // rule can safely guess that two spellings are one human.
  "prasanna venkatesan": "Prasanna",
  "duraipandian ashokan": "Duraipandain",
  "sathiyamoorthy a": "Satyamoorthi",
  "balmukund saw": "Balmukund",
  "durairaj krishnan": "Durairaj",
  "elayaraja mani": "Illayaraja",
  rajinish: "Rajneeshraj",
  "satish kumar": "Satish",
  "sukantha kumar": "Sukanta",
  "madhan kumar": "Madhan",
  mathan: "Madhan",
};

/** Accounts that appear in an operator column but are not operators: the office
 *  and admin logins used to correct a record. Ranking them puts a desk on a
 *  shop-floor board and takes a real slice of the pool. */
export const NOT_OPERATORS = new Set(["administrator", "neelam hemanth krishna"]);

/** Rows an operator needs at a station before they are RANKED there. A handful
 *  of rows is somebody covering for an hour or fixing an entry, not working the
 *  machine — and with per-shift rates a single lucky row can outrank a month of
 *  real work. They still appear, unranked, so nothing is hidden. */
export const MIN_ROWS_TO_RANK_STATION = 25;

export function canonPerson(raw: unknown): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const key = t.toLowerCase();
  if (PERSON_ALIAS[key]) return PERSON_ALIAS[key];
  // Title Case so "SURESH" and "suresh" land on the same display name.
  return t.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// --------------------------------------------------------------------------
// How the pool is split
// --------------------------------------------------------------------------
// TWO POOLS, NOT ONE PRODUCT.
//
// The old score was volume x a quality share measured from 90%. Multiply that
// out and it is exactly:
//
//     points = A - 4B - 9C
//
// One more Grade-A slab is worth +1. One more C is worth -9. So the most
// profitable thing a shift could do was NOT ENTER the slabs it thought had come
// out badly - nine times more profitable than pressing a good one. The scheme
// was paying for concealment while the notice on the wall told the floor to
// record everything.
//
// The fix is to stop multiplying. Volume is paid on GOOD SLABS (A = 1, B = 0.5,
// C = 0), where adding a bad slab is worth exactly zero - never negative - so
// there is nothing to gain by hiding it. Quality is paid from its own pool, so
// it still decides real money without ever making a slab worth less than
// nothing.
export const POOL_VOLUME = 0.7;
export const POOL_QUALITY = 0.3;

// --------------------------------------------------------------------------
// A SHIFT IS WORTH THE TIME THE LINE COULD ACTUALLY RUN
// --------------------------------------------------------------------------
// The per-shift rate divides good slabs by shifts worked. Counting a shift the
// plant spent broken as a whole shift charges the incharge for a stoppage he
// did not cause and cannot fix — 2026-08-03 C was down 480 minutes of 480, made
// nothing, and still halved Suresh's rate as if he had worked a normal night
// and produced nothing.
//
// So a shift counts for the fraction of its LOGGED hours the line was not
// stopped. A shift dead throughout counts as zero shifts: it contributes no
// slabs and no divisor, and drops out of the rate instead of dragging it down.
//
// ONLY MECHANICAL/ELECTRICAL BREAKDOWN AND POWEROUT ARE REMOVED. Process and
// cleaning delay stay in, because they are the shift's own work and its own
// pace — removing those would pay a man for running his line slowly.
//
// WHY THIS IS NOT A LICENCE TO CLAIM DOWNTIME. Shrinking the divisor raises the
// rate, so an invented breakdown is worth money. Two things sit against it: the
// hour cannot claim more than 60 minutes, and the SAME figure is what the
// electrical and mechanical incharge are scored on — a breakdown that did not
// happen takes money out of a colleague's pocket on the same shift, and he is
// standing right there. The claim has a witness with the opposite incentive.

/** Floor on a shift that DECLARED SLABS: one hour of an eight-hour shift.
 *
 *  A shift that pressed slabs was running for some of it, whatever the delay
 *  columns say. Without this floor a row claiming a full stoppage AND a slab
 *  range divides real output by zero, and one contradictory entry takes the
 *  whole pool. It is a rail against bad data, not a scoring rule — no shift in
 *  the live range hits it. */
export const MIN_RUNNING_SHIFT = 1 / 8;

/** What one shift instance is worth as a divisor: 1 for a shift that ran
 *  clean, 0 for one that never ran at all.
 *
 *  `stoppedMin` is breakdown + powerout only. Measured against the hours MIS
 *  ACTUALLY LOGGED, exactly as uptime is — an hour never entered is not an hour
 *  the line was running, so it cannot be claimed as one. */
export function shiftWeight(hoursLogged: number, stoppedMin: number, declaredSlabs = 0): number {
  if (!(hoursLogged > 0)) return 0;
  const running = Math.max(0, Math.min(1, 1 - stoppedMin / (hoursLogged * 60)));
  return declaredSlabs > 0 ? Math.max(running, MIN_RUNNING_SHIFT) : running;
}

// --------------------------------------------------------------------------
// OEE — REPORTED, NOT PAID
// --------------------------------------------------------------------------
// Availability x Performance x Quality, the standard manufacturing measure, so
// the plant has one number it can compare against the rest of the industry and
// three it can act on. Every input below is already collected for the payout
// maths; nothing new has to be entered to produce it.
//
// IT DOES NOT DECIDE MONEY, DELIBERATELY. The payout is still 70% good slabs /
// 30% quality (POOL_VOLUME / POOL_QUALITY) and this changes none of it. Two
// reasons. Availability and Quality are ALREADY in the payout — availability
// through shiftWeight shrinking the divisor, quality through its own pool — so
// paying OEE on top pays twice for one thing. And Performance depends on
// TARGET_SLABS_PER_SHIFT below, which is a decision, not a measurement: putting
// an unvalidated target into a payout is how an incentive loses the floor's
// trust in its first month. Show it, let the floor watch it move for a month,
// then decide whether it should carry weight.

/** Good slabs an eight-hour shift is expected to produce when the line runs.
 *
 *  NOT MEASURED — A DECISION. It was originally read off the incentive ladder:
 *  the notice's landmark tier was 9,000 good slabs a month, which across 90
 *  shifts is 100 a shift, and that was the row the sheet called "a full extra
 *  month's pay for everyone". Tying Performance to it meant 100% Performance
 *  and the landmark payout described the same night's work.
 *
 *  THAT DERIVATION NO LONGER HOLDS, and the number is now standing on its own.
 *  On 2026-08-06 the notice's floor moved to 7,000 slabs, its top pool was cut
 *  to Rs 25 lakh, and the line grew to 72 people — so NO tier pays a full
 *  month's salary any more (the top row, 12,000 slabs, pays 92%) and there is
 *  no landmark left to read a target off. 100 is kept because it is a sane
 *  eight-hour target and because moving it would silently restate every
 *  Performance and OEE figure on the scoreboard, not because the ladder still
 *  points at it.
 *
 *  For context on how far that is: July 2026 ran 44-51 good slabs per shift, so
 *  the plant currently sits near 50% Performance. That is the point — a target
 *  already being hit measures nothing.
 *
 *  This is REPORTED only and decides no money, so a stale target misleads a
 *  board rather than a payout. Revisit it deliberately. */
export const TARGET_SLABS_PER_SHIFT = 100;
export const SHIFT_HOURS = 8;

/** The three numbers every board shows, and their product.
 *
 *  Each is null when the shift carries nothing to measure it from, and OEE is
 *  null unless all three are real — a product with a missing term is not a
 *  smaller OEE, it is an unknown one, and rendering it as a number would put a
 *  confident figure on absent data. */
export interface Oee {
  /** Running time / time MIS actually logged. Breakdown and powerout only —
   *  the same minutes shiftWeight removes, for the same reason. */
  availability: number | null;
  /** Good slabs against what the running time should have produced. Measured
   *  against RUNNING hours, not logged hours: a line that was stopped is an
   *  availability loss and must not be charged again as a pace loss. */
  performance: number | null;
  /** The raw QC grade share (A = 1, B = 0.5, C = 0) — unstretched. This is the
   *  industry definition; QUALITY_FLOOR/QUALITY_TARGET belong to the payout and
   *  would make the figure incomparable with anyone else's OEE. */
  quality: number | null;
  oee: number | null;
}

/** World-class benchmarks, shown beside each figure so the number reads as
 *  "against what". These are the standard targets, not the plant's current
 *  performance — 85% OEE is the classic world-class mark. */
export const OEE_TARGET = { availability: 0.95, performance: 0.95, quality: 0.98, oee: 0.85 };

export function oeeOf(
  hoursLogged: number, stoppedMin: number, points: number, rawQuality: number | null,
): Oee {
  const availability = hoursLogged > 0
    ? Math.max(0, Math.min(1, 1 - stoppedMin / (hoursLogged * 60)))
    : null;
  // Running hours, capped at the shift length: MIS occasionally files more than
  // eight rows for one shift (a corrected hour re-entered), and without the cap
  // that inflates the expected output and understates a good shift.
  const runningHours = availability == null ? 0 : Math.min(hoursLogged, SHIFT_HOURS) * availability;
  const expected = runningHours * (TARGET_SLABS_PER_SHIFT / SHIFT_HOURS);
  const performance = expected > 0 ? Math.max(0, Math.min(1, points / expected)) : null;
  const oee = availability != null && performance != null && rawQuality != null
    ? availability * performance * rawQuality
    : null;
  return { availability, performance, quality: rawQuality, oee };
}

/** Sum OEE across shifts the way a plant figure must be summed: pool the inputs
 *  and divide once. Averaging each shift's OEE weights a two-hour shift the same
 *  as a full one, which is how a plant number ends up describing nobody. */
export function oeeTotal(
  rows: { hoursLogged: number; breakdownMin: number; poweroutMin: number; points: number }[],
  rawQuality: number | null,
): Oee {
  const hours = rows.reduce((a, r) => a + r.hoursLogged, 0);
  const stopped = rows.reduce((a, r) => a + r.breakdownMin + r.poweroutMin, 0);
  const points = rows.reduce((a, r) => a + r.points, 0);
  // Expected output is per shift, so it has to be built shift by shift — the
  // eight-hour cap does not survive being applied to a month of logged hours.
  const expected = rows.reduce((a, r) => {
    const av = r.hoursLogged > 0
      ? Math.max(0, Math.min(1, 1 - (r.breakdownMin + r.poweroutMin) / (r.hoursLogged * 60))) : 0;
    return a + Math.min(r.hoursLogged, SHIFT_HOURS) * av * (TARGET_SLABS_PER_SHIFT / SHIFT_HOURS);
  }, 0);
  const availability = hours > 0 ? Math.max(0, Math.min(1, 1 - stopped / (hours * 60))) : null;
  const performance = expected > 0 ? Math.max(0, Math.min(1, points / expected)) : null;
  const oee = availability != null && performance != null && rawQuality != null
    ? availability * performance * rawQuality : null;
  return { availability, performance, quality: rawQuality, oee };
}

// --------------------------------------------------------------------------
// MIS DISCIPLINE — also reported, not paid
// --------------------------------------------------------------------------
// The notice already tells the floor that an unentered hour claims nothing and a
// disputed slab is paid to nobody. Until now the consequence was only visible
// after the fact, inside a payout nobody could reconstruct. This puts the same
// three failures on the board as one number per shift, so the shift can see the
// points it is throwing away while there is still time to correct the entry.
//
// It is NOT scored, for the same reason as OEE: every one of these already costs
// the shift real points through the payout maths (an unfiled hour claims no
// slabs, a wide row is ignored, a disputed slab is dropped from both shifts).
// Scoring it as well would charge for the same mistake twice.

/** 0-1: how completely a shift filed its own MIS.
 *  1.0 = eight hours filed, nothing disputed, no impossible ranges. */
export function misDiscipline(
  hoursLogged: number, wideRows: number, contested: number, quantity: number,
): number | null {
  if (hoursLogged <= 0) return null;
  const filed = Math.min(1, hoursLogged / SHIFT_HOURS);
  const clean = hoursLogged > 0 ? Math.max(0, 1 - wideRows / hoursLogged) : 1;
  // Disputed slabs as a share of what the shift claimed. A shift that claimed
  // nothing cannot have disputed anything, so this term is 1 rather than 0.
  const undisputed = quantity > 0 ? Math.max(0, 1 - contested / quantity) : 1;
  return filed * clean * undisputed;
}

/** Shifts before a per-shift RATE is trusted at face value.
 *
 *  Both pools are shared on rates, which is what the plant asked for: 3 shifts
 *  making 300 good slabs should beat 10 making 500. But a rate from one shift
 *  is not evidence - a single good night would otherwise take the largest slice
 *  of the month from people who worked twenty. Below this, the share is scaled
 *  down in proportion; at or above it, the rate counts in full.
 *
 *  MEASURED ON SHIFTS ATTENDED, NOT RUNNING SHIFTS — deliberately. Credibility
 *  asks how many times we have watched this man run a shift, and he turned up
 *  for all of them. Scaling it by running time instead cancels the whole
 *  downtime adjustment for exactly the people it protects: below the ramp the
 *  volume term is `(points / shifts) x (shifts / N)`, which is `points / N`
 *  whatever the divisor, so a man whose night was lost to a breakdown would
 *  come out of the fix strictly worse off than before it — punished twice for
 *  one stoppage.
 *
 *  CALIBRATED, like TOLERANCE_MM and UPTIME_FLOOR — 5 was too blunt for a
 *  three-man rotation. On 2026-07-31..08-06 Suresh ran 106 slabs at 100% QC
 *  through the one shift of his two the line was alive for: 111 good slabs per
 *  running shift, nearly double the next man. At 5 that became 111 x 0.40 = 44
 *  and put him THIRD on the money behind rates of 64 and 50 — the board showed
 *  him first on performance and paid him third, which is exactly the reading
 *  that makes an incentive stop working.
 *
 *  At 3 he places first (29.2% against Sivaiha's 28.4%) and the guard is still
 *  live where it matters: two shifts are discounted a third, one shift is cut
 *  to 0.33, so a single lucky night still cannot take the month. Set by
 *  decision on those figures — revisit it if the rotation gets deeper. */
export const CREDIBLE_SHIFTS = 3;
export const credibility = (shifts: number) => Math.min(1, Math.max(0, shifts) / CREDIBLE_SHIFTS);

/** Shifts a person must have worked before they can be RANKED.
 *  Set to 1 by decision: everyone who worked at all is placed, however few
 *  shifts they did. The per-shift rate is the measure, and a short month should
 *  not remove someone from the board. Raise this if a one-shift rate ever wins
 *  in a way that reads unfairly — the mechanism is still here. */
export const MIN_SHIFTS_TO_RANK = 1;

/** Which shift instance a UTC timestamp falls in (IST clock). */
export function shiftKeyOf(d: Date): string {
  const ist = new Date(d.getTime() + IST_MIN * 60_000);
  const h = ist.getUTCHours();
  const day = ist.toISOString().slice(0, 10);
  if (h >= 6 && h < 14) return `${day}A`;
  if (h >= 14 && h < 22) return `${day}B`;
  return `${h >= 22 ? day : plusDay(day, -1)}C`;
}
