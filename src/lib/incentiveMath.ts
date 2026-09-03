// Roll a month of scored shift instances up by SHIFT LETTER — the three teams
// the notice on the wall pays — and split the pool between them.
//
// Pure: no database. It consumes the ShiftScore rows scoreRange() already
// produces, so it cannot disagree with the scoreboard about what a shift made;
// it only adds the grouping the payout is actually settled on. The per-PERSON
// roll-up in shiftScore.ts (`roll`) is the same arithmetic keyed by name; this
// is keyed by letter, and the test pins both quality methods so the choice
// between them is a decision on the record rather than an accident of which
// file did the sum.
//
// TWO WAYS TO SCORE A LETTER'S QUALITY, BOTH REPORTED.
//   weighted  — the graded-weighted mean of each INSTANCE's scaled score
//               (sum q_i*g_i / sum g_i). This is what scoreRange's per-person
//               roll does and therefore what /scoreboard pays on today.
//   aggregate — scale the letter's whole-month grade share once
//               (sum credit / sum graded, stretched 87%..97%). This is what the
//               August notice printed.
// They differ because scaleQuality clamps at 0 and 1 per instance: a night at
// 99% scores 100% and carries no surplus to offset a night at 90%, so
// `weighted` sits below `aggregate` whenever instances straddle the target. The
// gap is small in points and real in rupees; neither is wrong, the wall notice
// describes "your grade share" for the month, which reads closer to aggregate.
import {
  scaleQuality, credibility, POOL_VOLUME, POOL_QUALITY, type ShiftLetter,
} from "./shiftScoreMath.ts";

/** The slice of ShiftScore this needs — kept structural so a test can feed
 *  hand-made rows without building a whole ShiftScore. */
export interface ScoredInstance {
  shift: ShiftLetter;
  quantity: number;
  graded: number;
  ungraded: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  goodSlabs: number;
  slowSlabs: number;
  points: number;
  weight: number;
  hoursLogged: number;
  breakdownMin: number;
  poweroutMin: number;
  quality: number | null;
  rawQuality: number | null;
  people: string[];
}

export type QualityMethod = "weighted" | "aggregate";

export interface LetterTotals {
  shift: ShiftLetter;
  /** Shift instances that claimed slabs or named a crew. */
  instances: number;
  /** Sum of shift weights — the divisor the per-shift rate uses. */
  effectiveShifts: number;
  hoursLogged: number;
  stoppedMin: number;
  claimed: number;
  graded: number;
  ungraded: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  /** Exact good-slab count: A = 1, B = 0.5, C = 0, before the slow multiplier.
   *  Rebuilt from rawQuality x graded rather than summing the per-instance
   *  rounded goodSlabs, so a half-slab survives. */
  credit: number;
  slowSlabs: number;
  /** What the volume pool pays on: credit with slow-product slabs doubled.
   *  Sum of per-instance points, which scoreShift rounds — so this is a whole
   *  number even when the exact figure ends in a half. */
  points: number;
  pointsPerShift: number;
  /** credit / graded for the whole month. */
  rawShare: number | null;
  qualityWeighted: number | null;
  qualityAggregate: number | null;
  credibility: number;
}

export function rollUpByLetter(rows: readonly ScoredInstance[]): LetterTotals[] {
  const letters: ShiftLetter[] = ["A", "B", "C"];
  return letters.map((shift) => {
    const mine = rows.filter((r) => r.shift === shift && (r.quantity > 0 || r.people.length > 0));
    const sum = (f: (r: ScoredInstance) => number) => mine.reduce((a, r) => a + f(r), 0);
    const graded = sum((r) => r.graded);
    const credit = sum((r) => (r.rawQuality ?? 0) * r.graded);
    const qNum = sum((r) => (r.quality ?? 0) * r.graded);
    const effectiveShifts = sum((r) => r.weight);
    const points = sum((r) => r.points);
    const rawShare = graded ? credit / graded : null;
    return {
      shift,
      instances: mine.length,
      effectiveShifts,
      hoursLogged: sum((r) => r.hoursLogged),
      stoppedMin: sum((r) => r.breakdownMin + r.poweroutMin),
      claimed: sum((r) => r.quantity),
      graded,
      ungraded: sum((r) => r.ungraded),
      gradeA: sum((r) => r.gradeA),
      gradeB: sum((r) => r.gradeB),
      gradeC: sum((r) => r.gradeC),
      credit,
      slowSlabs: sum((r) => r.slowSlabs),
      points,
      pointsPerShift: effectiveShifts ? points / effectiveShifts : 0,
      rawShare,
      qualityWeighted: graded ? qNum / graded : null,
      qualityAggregate: scaleQuality(rawShare),
      credibility: credibility(mine.length),
    };
  });
}

/** The slice of ShiftScore the counted-slab DECOMPOSITION needs. It is
 *  ScoredInstance plus `anchor`, and it is a separate type rather than a
 *  widening of ScoredInstance so that nothing which already builds one has to
 *  change. `anchor` is here because the doubling's CREDIT cannot be derived
 *  from a ShiftScore at all — see decomposeCounted — and has to be handed in
 *  per shift INSTANCE, which is what anchor + shift names. */
export interface CountedInstance {
  anchor: string;
  shift: ShiftLetter;
  quantity: number;
  people: string[];
  graded: number;
  rawQuality: number | null;
  points: number;
}

/** `points` — THE FIGURE THE LADDER IS READ OFF — TAKEN APART SO THAT A READER
 *  ADDING THE PARTS UP LANDS ON IT.
 *
 *      credit + doubling + rounding = points
 *
 *  exactly and by construction, because `rounding` is DEFINED as the leftover.
 *  The screen used to print `credit` and `slowSlabs` beside `points` and let a
 *  reader infer the sum, and that sum was wrong twice over:
 *
 *    - `slowSlabs` is a COUNT OF SLABS, not the credit those slabs contribute.
 *      A grade B slab in a slow hour is counted once in `slowSlabs` and adds
 *      half a slab of credit, so the count overstates the contribution by half
 *      for every slow B. On live August 2026 the two differed by 14 (measured
 *      2026-09-03; re-measure with scripts/verify-grade-columns.mts, which
 *      prints both). Hence `doubling`, which is the CREDIT.
 *    - scoreShift rounds EVERY SHIFT INSTANCE, and every fraction it can meet
 *      is exactly a half, which Math.round takes UP — so the rounding drift is
 *      one-directional and grows with the number of instances. It is never
 *      negative and never more than half an instance each. Hence `rounding`,
 *      named instead of hidden inside a sum that did not add.
 *
 *  Both figures MOVE HOUR BY HOUR while QC files, so nothing here carries a
 *  measured constant. */
export interface CountedParts {
  /** Good slabs: A = 1, B = ½, C = 0. Summed exactly as LetterTotals.credit
   *  is, over the same instances, so the two are the same number. */
  credit: number;
  /** What the slow-hour doubling ADDS, in credit — sum over graded good slabs
   *  in slow hours of gradeCredit x (multiplier - 1). NOT a slab count. */
  doubling: number;
  /** credit + doubling: the volume total BEFORE scoreShift rounds each shift
   *  instance. Ends in a half whenever an odd number of halves survive. */
  exact: number;
  /** points - exact. Per instance this is 0 or +0.5; over a month it is a
   *  small positive number, and it can never exceed instances / 2. */
  rounding: number;
  points: number;
  instances: number;
  /** How many instances the rounding actually moved (each by exactly +0.5). */
  roundedUp: number;
}

const blankParts = (): CountedParts =>
  ({ credit: 0, doubling: 0, exact: 0, rounding: 0, points: 0, instances: 0, roundedUp: 0 });

/** Decompose the counted total per letter and for the plant.
 *
 *  `doublingByInstance` is keyed `${anchor}${shift}` and comes from the caller
 *  because ShiftScore does not report it: scoreShift accumulates the weighted
 *  total into a local and returns only `Math.round(weighted)`, so the exact
 *  figure and the slow slabs' credit both leave the function unrecorded. An
 *  instance missing from the map contributes 0, which is right for a month
 *  with no slow hours and is also what a caller that cannot rebuild the claim
 *  should hand in — the decomposition then degenerates to "credit + rounding",
 *  still adding to `points`.
 *
 *  `disagreements` is the check: per instance `points - exact` must lie in
 *  [0, 0.5], because that is the only thing rounding a multiple of a half can
 *  do. Anything else means the caller's doubling and the score's own weighted
 *  total have drifted — on a live plant most likely a slab re-graded between
 *  the two reads, and worth saying so rather than printing a decomposition
 *  that quietly stops describing the score. */
export function decomposeCounted(
  rows: readonly CountedInstance[],
  doublingByInstance: ReadonlyMap<string, number>,
): { byLetter: Record<ShiftLetter, CountedParts>; plant: CountedParts; disagreements: number } {
  const byLetter: Record<ShiftLetter, CountedParts> = { A: blankParts(), B: blankParts(), C: blankParts() };
  const plant = blankParts();
  let disagreements = 0;
  for (const r of rows) {
    // The same population rollUpByLetter counts, so `instances` and `credit`
    // here are the same instances and the same number as LetterTotals'.
    if (!(r.quantity > 0 || r.people.length > 0)) continue;
    const credit = (r.rawQuality ?? 0) * r.graded;
    const doubling = doublingByInstance.get(`${r.anchor}${r.shift}`) ?? 0;
    const drift = r.points - (credit + doubling);
    if (drift < -1e-9 || drift > 0.5 + 1e-9) disagreements += 1;
    for (const t of [byLetter[r.shift], plant]) {
      t.credit += credit;
      t.doubling += doubling;
      t.points += r.points;
      t.instances += 1;
      if (Math.abs(drift) > 1e-9) t.roundedUp += 1;
    }
  }
  // Derived last, from the totals, so the identity holds on the printed row
  // and not merely instance by instance.
  for (const t of [byLetter.A, byLetter.B, byLetter.C, plant]) {
    t.exact = t.credit + t.doubling;
    t.rounding = t.points - t.exact;
  }
  return { byLetter, plant, disagreements };
}

export interface LetterShare {
  shift: ShiftLetter;
  /** The quality score the split used, under the chosen method. */
  quality: number | null;
  volumeShare: number;
  qualityShare: number;
  /** volumeShare + qualityShare — this letter's slice of the pool. */
  share: number;
}

/** Split the pool 70/30 across the three letters, exactly as scoreRange's
 *  splitPool does across people: each half shared in proportion to
 *  rate x credibility. Shares sum to 1 whenever anyone qualifies. */
export function splitPoolByLetter(rows: readonly LetterTotals[], method: QualityMethod): LetterShare[] {
  const q = (r: LetterTotals) => (method === "weighted" ? r.qualityWeighted : r.qualityAggregate);
  const vol = (r: LetterTotals) => (r.instances > 0 ? r.pointsPerShift * r.credibility : 0);
  const qua = (r: LetterTotals) => (r.instances > 0 ? (q(r) ?? 0) * r.credibility : 0);
  const vTot = rows.reduce((a, r) => a + vol(r), 0);
  const qTot = rows.reduce((a, r) => a + qua(r), 0);
  return rows.map((r) => {
    const volumeShare = vTot ? (POOL_VOLUME * vol(r)) / vTot : 0;
    const qualityShare = qTot ? (POOL_QUALITY * qua(r)) / qTot : 0;
    return { shift: r.shift, quality: q(r), volumeShare, qualityShare, share: volumeShare + qualityShare };
  });
}

/** Plant totals across the three letters. */
export function plantTotals(rows: readonly LetterTotals[]) {
  const sum = (f: (r: LetterTotals) => number) => rows.reduce((a, r) => a + f(r), 0);
  const graded = sum((r) => r.graded);
  const credit = sum((r) => r.credit);
  return {
    instances: sum((r) => r.instances),
    claimed: sum((r) => r.claimed),
    graded,
    ungraded: sum((r) => r.ungraded),
    gradeA: sum((r) => r.gradeA),
    gradeB: sum((r) => r.gradeB),
    gradeC: sum((r) => r.gradeC),
    credit,
    slowSlabs: sum((r) => r.slowSlabs),
    points: sum((r) => r.points),
    rawShare: graded ? credit / graded : null,
  };
}

/** What the outstanding slabs are expected to add if they grade at `share`
 *  (the month's grade share so far) with the multiplier of the hour that
 *  claimed each one. The notice's projection, made explicit. */
export function projectOutstanding(outstanding: readonly { mult: number }[], share: number | null): number {
  if (share == null) return 0;
  return outstanding.reduce((a, o) => a + share * o.mult, 0);
}
