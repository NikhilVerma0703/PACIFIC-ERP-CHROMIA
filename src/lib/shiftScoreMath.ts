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
 *  WHY. Raw grade share does not discriminate: in July every shift landed
 *  between 93.6% and 98.0%, so the quality factor was ~0.95 for everyone and the
 *  ranking collapsed into pure quantity — the second axis was decorative. C
 *  grades are only ~3% of output, so there is simply not much room below 100%.
 *  Rescaling against a 90% floor turns that 4-point spread into a 44-point one
 *  (93.6% -> 36%, 98.0% -> 80%), so quality decides places again. A shift below
 *  the floor scores zero on quality and therefore zero points, which is the
 *  intended cliff. */
export const QUALITY_FLOOR = 0.9;

/** Raw grade share -> scored quality, stretched against the floor. */
export function scaleQuality(raw: number | null): number | null {
  if (raw == null) return null;
  return Math.max(0, Math.min(1, (raw - QUALITY_FLOOR) / (1 - QUALITY_FLOOR)));
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
