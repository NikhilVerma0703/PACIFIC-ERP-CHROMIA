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
