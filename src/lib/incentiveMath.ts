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
   *  Built DIRECTLY from the grade counts on the row — gradeA + gradeB / 2 —
   *  and not from rawQuality x graded. rawQuality is itself credit / graded, so
   *  that form divided and multiplied back: a round trip that is not exact for
   *  every reachable pair (a reviewer brute-forced the space and found 7.8% of
   *  pairs off by an ulp, and it fires on live data — 2026-07-18 shift B was
   *  out by 1.8e-15). gradeA and gradeB are integers, so the sum here is an
   *  exact multiple of a half. */
  credit: number;
  slowSlabs: number;
  /** What the volume pool pays on: credit with slow-product slabs doubled.
   *  The sum of the per-instance points scoreShift reports, which are now
   *  EXACT — so this can end in a half, and a half here is half a real slab
   *  rather than an artefact. */
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
    const credit = sum((r) => r.gradeA + r.gradeB * 0.5);
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
  /** The grade counts credit is built from — integers, so gradeA + gradeB / 2
   *  is an exact multiple of a half. Present here, and not just `rawQuality`,
   *  so that this file's credit and rollUpByLetter's are the SAME arithmetic on
   *  the same row and cannot drift apart by an ulp. */
  gradeA: number;
  gradeB: number;
  rawQuality: number | null;
  points: number;
}

/** `points` — THE FIGURE THE LADDER IS READ OFF — TAKEN APART SO THAT A READER
 *  ADDING THE PARTS UP LANDS ON IT.
 *
 *      credit + doubling = points
 *
 *  and that is now REAL ARITHMETIC, not a definition. There is no third term.
 *  The screen used to print `credit` and `slowSlabs` beside `points` and let a
 *  reader infer the sum, and that sum was wrong twice over:
 *
 *    - `slowSlabs` is a COUNT OF SLABS, not the credit those slabs contribute.
 *      A grade B slab in a slow hour is counted once in `slowSlabs` and adds
 *      half a slab of credit, so the count overstates the contribution by half
 *      for every slow B. On live August 2026 the two differed by 14 (measured
 *      2026-09-03; re-measure with scripts/verify-grade-columns.mts, which
 *      prints both). Hence `doubling`, which is the CREDIT.
 *    - scoreShift used to round EVERY SHIFT INSTANCE, and the only fraction it
 *      can meet is a half, which Math.round takes UP. That drift was carried
 *      here as a `rounding` term DEFINED as points - (credit + doubling), and
 *      a leftover always makes the row add up — so the row added up whether or
 *      not it was right. Reviewers showed on constructed data that 92 of 184
 *      possible half-slab errors in `doubling` landed silently in `rounding`
 *      with every check still green. scoreShift now keeps the exact total
 *      (2026-09-04), so the term is gone and the difference it used to absorb
 *      is a MISMATCH — see `mismatches` below.
 *
 *  Both figures MOVE HOUR BY HOUR while QC files, so nothing here carries a
 *  measured constant. */
export interface CountedParts {
  /** Good slabs: A = 1, B = ½, C = 0. Built from the same gradeA + gradeB / 2
   *  as LetterTotals.credit, over the same instances, so the two are the same
   *  number by construction rather than by luck. */
  credit: number;
  /** What the slow-hour doubling ADDS, in credit — sum over graded good slabs
   *  in slow hours of gradeCredit x (multiplier - 1). NOT a slab count. */
  doubling: number;
  /** The scorer's own total for these instances. Equal to credit + doubling
   *  unless the two counts have genuinely drifted apart, which is what
   *  `mismatches` names. Can end in a half. */
  points: number;
  instances: number;
}

const blankParts = (): CountedParts => ({ credit: 0, doubling: 0, points: 0, instances: 0 });

/** ONE SHIFT INSTANCE WHERE THE SCORER AND THE REBUILD DO NOT AGREE — the day,
 *  the letter and the size of the gap, so the reader can go and look. */
export interface CountedMismatch {
  /** The IST day the shift instance STARTED, as scoreRange anchors it. */
  anchor: string;
  shift: ShiftLetter;
  /** What scoreShift says the instance was worth. */
  points: number;
  /** credit + doubling, rebuilt from the claim. */
  rebuilt: number;
  /** points - rebuilt, signed, in slabs. Never 0 in this list. */
  gap: number;
}

/** Decompose the counted total per letter and for the plant.
 *
 *  `doublingByInstance` is keyed `${anchor}${shift}` and comes from the caller
 *  because ShiftScore does not report it: scoreShift accumulates the weighted
 *  total into a local and returns the total alone, so the slow slabs' share of
 *  it leaves the function unrecorded. An instance missing from the map
 *  contributes 0 — right for a month with no slow hours, and what a caller that
 *  cannot rebuild the claim should hand in, though for such a caller every slow
 *  instance then reads as a mismatch, which is the honest outcome.
 *
 *  THE ALARM. Per instance `points` must EQUAL `credit + doubling`: both sides
 *  are sums of exact multiples of a half, exactly representable in float64, so
 *  the only tolerance needed is against arithmetic dust (1e-9). Anything larger
 *  is a real contradiction between the scorer and the rebuild — on a live plant
 *  most likely a slab re-graded between the two QC reads — and each one is
 *  reported with its day, its letter and its size rather than counted into a
 *  bare total the reader cannot act on. The old check accepted any gap in
 *  [0, +0.5] as "that is the rounding", which swallowed exactly the half-slab
 *  errors it was supposed to catch. */
export function decomposeCounted(
  rows: readonly CountedInstance[],
  doublingByInstance: ReadonlyMap<string, number>,
): {
  byLetter: Record<ShiftLetter, CountedParts>;
  plant: CountedParts;
  disagreements: number;
  mismatches: CountedMismatch[];
} {
  const byLetter: Record<ShiftLetter, CountedParts> = { A: blankParts(), B: blankParts(), C: blankParts() };
  const plant = blankParts();
  const mismatches: CountedMismatch[] = [];
  for (const r of rows) {
    // The same population rollUpByLetter counts, so `instances` and `credit`
    // here are the same instances and the same number as LetterTotals'.
    if (!(r.quantity > 0 || r.people.length > 0)) continue;
    const credit = r.gradeA + r.gradeB * 0.5;
    const doubling = doublingByInstance.get(`${r.anchor}${r.shift}`) ?? 0;
    const gap = r.points - (credit + doubling);
    if (Math.abs(gap) > 1e-9) {
      mismatches.push({ anchor: r.anchor, shift: r.shift, points: r.points, rebuilt: credit + doubling, gap });
    }
    for (const t of [byLetter[r.shift], plant]) {
      t.credit += credit;
      t.doubling += doubling;
      t.points += r.points;
      t.instances += 1;
    }
  }
  // Worst gap first, then oldest — a reader chasing one starts with the one
  // that moves the total most.
  mismatches.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap) || x.anchor.localeCompare(y.anchor) || x.shift.localeCompare(y.shift));
  return { byLetter, plant, disagreements: mismatches.length, mismatches };
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
