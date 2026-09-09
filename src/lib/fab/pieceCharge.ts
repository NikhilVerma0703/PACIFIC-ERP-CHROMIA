// WHAT ONE PACKED PIECE EARNED — AND WHY THAT HAS TO BE WRITTEN DOWN.
//
// ─────────────────────────────── THE PROBLEM ────────────────────────────────
// The period report re-prices from the LIVE ordered row every time it is
// opened. So a row edited in September changes what July earned:
//
//     July      60 pieces packed, one face   ->  505 ft   ->  Rs7,575
//     September somebody sets edge_faces=BOTH
//     July      the same report, reopened    ->  1,010 ft ->  Rs15,150
//
// Nothing was re-done and nothing was re-billed; a closed month simply reads
// differently than it did. The same is true of finished_edges, shape_type, the
// dimensions, sink_quantity and the slab thickness — every input to priceRow.
//
// This predates the shape and face work: the report has always re-priced. What
// the new columns did was make it easy to trip, because BOTH is a doubling and
// it is chosen on a screen the supervisor uses every day.
//
// ─────────────────────────────── THE FIX ────────────────────────────────────
// PACKING IS WHEN A PIECE EARNS. It is already the moment the report counts
// (api/fab/ceo: "money is earned on the day a piece is packed"), so it is the
// moment to write the figure down. fab_piece.charged_edge / charged_sink /
// charged_at hold it — scripts/0066 — and the report prefers the stamp to a
// fresh calculation whenever one is there.
//
// This module is the arithmetic both sides share, so the stamp written at
// packing and the fallback computed at read time cannot drift apart. It is the
// rule that used to live inline in the CEO route's loop, lifted out unchanged.
//
// ─────────────────────────────── WHAT IT DOES NOT DO ────────────────────────
// IT DOES NOT FREEZE THE PAST. Pieces packed before scripts/0066 have no stamp,
// there is no honest value to invent for them, and they keep being re-priced
// live exactly as they are today. The freeze starts the day the column lands
// and moves forward. Saying that plainly beats a backfill that writes today's
// answer and calls it history.
//
// PURE, AND IT IMPORTS TWO THINGS — pricing.ts and periodReport.ts, both of
// which are themselves pure. Explicit .ts extensions, as the house rule
// requires: node's strict ESM resolver does not add one.

import { priceRow, parsePricingMode, type RowPricingInput, type UnpricedReason } from "./pricing.ts";
import { perPieceCharge } from "./periodReport.ts";
import { type FaceEdges } from "./shape.ts";

/** What ONE piece of a row is worth, split by the two jobs. */
export interface RowShares {
  /** Hand edge polish, per piece that carries it. */
  edge: number;
  /** Sink cutting, per piece that has a sink. */
  sink: number;
  /**
   * Does this row carry hand edge polish at all?
   *
   * A ROW IS HOMOGENEOUS — a row where only some pieces want edge polish is
   * split into two rows instead (see pricing.ts) — so the row's answer IS every
   * piece's answer, and there is no per-piece edge flag to read.
   */
  rowHasEdgeWork: boolean;
  /**
   * COULD THIS ROW BE PRICED IN FULL? Carried out of priceRow deliberately, and
   * leaving it behind was a real bug that reached an audit.
   *
   * THERE ARE THREE STATES, NOT TWO. A row is priced; or it is priced at zero
   * because nothing was ordered; or IT COULD NOT BE PRICED — a blank width, an
   * off-card thickness, an L-shaped outline — and priceRow returns 0 with
   * `unpriced: true` for that third one.
   *
   * Flatten the third into the second and a 0 gets FROZEN onto the piece as
   * though somebody had agreed it. scripts/0061 exists because slab thicknesses
   * of 120 and 70 mm were once stored and repaired later; a trolley packed in
   * between would have been stamped ₹0 and the repair could never have reached
   * it, because the stamp is written once and never rewritten.
   *
   * So the caller that WRITES a stamp must refuse when this is true, and the
   * caller that READS one live-prices as it always did. Both are downstream of
   * this one boolean.
   */
  unpriced: boolean;
  /** Which of the four holes it was, for a log line. Null when priced cleanly. */
  unpricedReason: UnpricedReason | null;
}

/**
 * Price a row and divide it by the pieces that earn each half.
 *
 * TWO DIVISORS, NOT ONE. Edge money spreads over the pieces carrying hand edge
 * polish and sink money over the sink pieces, and those two sets stopped being
 * identical when the owner separated the jobs. One divisor gave a 60-piece row
 * with 30 sinks the right project total and the wrong figure on every piece and
 * every day inside it.
 */
export function rowShares(input: RowPricingInput): RowShares {
  const priced = priceRow(input);
  return {
    // chargePieces, NOT edgePieces — THE DIVISOR IS WHAT THE MONEY IS SPREAD
    // OVER, and on a per-piece or lump-sum row those are not the same count.
    //
    // A row of 35 sent to the hand bench whole at Rs150 each has NO ticked
    // edges, so edgePieces is 0 while edgeCost is Rs5,250. Dividing by 0 hits
    // perPieceCharge's `k > 0 ? cost/k : 0` guard and hands every piece a share
    // of ZERO — and stampPieceCharges then freezes that zero onto each piece
    // permanently, because charged_at is written once and never rewritten.
    // The row total would still read Rs5,250 and every piece under it Rs0.
    ...perPieceCharge(priced.edgeCost, priced.sinkCost, priced.chargePieces, priced.sinkPieces),
    // "Does this row carry hand work that is charged for" — again the charged
    // count, so a fully-hand-fabricated row is not reported as having none.
    rowHasEdgeWork: priced.chargePieces > 0,
    unpriced: priced.unpriced,
    unpricedReason: priced.unpricedReason,
  };
}

/**
 * MAY THIS ROW'S FIGURE BE FROZEN ONTO A PIECE?
 *
 * Only a row that priced cleanly. A row that could not be priced still has a
 * live answer — a sink-only total, or zero — and that answer must stay live so
 * it corrects itself the moment somebody fills in the width or fixes the
 * thickness. Freezing it would make the gap permanent, and the stamp is written
 * once and never rewritten.
 *
 * A missing row (no requirement at all) is never frozen either: it cannot be
 * priced now and it cannot be priced later, so a stamp would only make a
 * guess look like a decision.
 */
export function mayFreeze(shares: RowShares | null | undefined): shares is RowShares {
  return !!shares && !shares.unpriced;
}

export interface PieceCharge {
  edge: number;
  sink: number;
}

export const NO_CHARGE: PieceCharge = { edge: 0, sink: 0 };

/**
 * WHAT ONE PACKED PIECE EARNS — the question asked twice, once per job.
 *
 *   SINK share  this piece has a sink. Per PIECE, and half a row can.
 *   EDGE share  this piece's ROW carries hand edge polish. Per ROW, because a
 *               row is homogeneous.
 *
 * A piece whose row could not be found earns nothing rather than a guess: a
 * fabricated rate is indistinguishable from a real one the moment it is
 * written, and the piece is still counted as packed by the caller.
 */
export function pieceCharge(
  shares: RowShares | null | undefined,
  hasSink: boolean,
): PieceCharge {
  if (!shares) return { ...NO_CHARGE };
  return {
    edge: shares.rowHasEdgeWork ? shares.edge : 0,
    sink: hasSink ? shares.sink : 0,
  };
}

/**
 * A STAMP READ BACK OFF A PIECE — or null when there is not one.
 *
 * NULL AND ZERO ARE DIFFERENT ANSWERS and the whole fallback turns on it. A
 * piece packed before scripts/0066 has charged_at NULL and must be re-priced
 * live; a plain piece on a row with no sink and no edge work was stamped ZERO
 * and must NOT be, or it would pick up a charge the day somebody marks its row.
 *
 * charged_at is the flag rather than the money, because 0/0 is a legitimate
 * stamp and there is no rupee value that can mean "never asked".
 */
export function frozenCharge(row: {
  charged_at?: Date | string | null;
  charged_edge?: number | string | null;
  charged_sink?: number | string | null;
} | null | undefined): PieceCharge | null {
  if (!row || row.charged_at == null) return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return { edge: num(row.charged_edge), sink: num(row.charged_sink) };
}

// ═══════════════════════════════════════════════════════════════════════════
//  A PIECE PULLED OFF THE MACHINE AND GIVEN TO THE HAND BENCH
// ═══════════════════════════════════════════════════════════════════════════
//
// The owner: "already decided is also sent to hand later if machine doesn't
// support or busy or breakdown." And on what happens then: "it need to ask the
// cost on how much per feet, which all the side — top or bottom or side or any
// combo — and choose the number of side for top, no of side for bottom, and no
// of side for side. And this can be per piece."
//
// ─────────────────────── THIS BREAKS THE HOMOGENEOUS-ROW RULE, DELIBERATELY ──
// Everything else in this module rests on "a row is homogeneous — if half the
// pieces need something different, SPLIT the row". That rule is right for the
// ORDER, which is a decision made once at a desk with time to think.
//
// A machine breaking at nine at night is not that. It takes the pieces that
// happen to be in front of it, mid-row, and there is nobody to renumber an
// order around it. So the reassignment is recorded PER PIECE, with its own
// specification and its own rate, and it OVERRIDES its row's edge charge for
// that piece only. The row keeps its price for every piece that never moved.
//
// The owner asked for it in exactly those words, and it is the one place the
// group rule does not hold.
//
// ─────────────────────── PRICED AS A ROW OF ONE ─────────────────────────────
// Not by a second copy of the arithmetic. handPieceCharge builds a
// RowPricingInput with quantity 1 and hands it to priceRow, so the piece gets
// the same three-face summing, the same four refusals, the same override rescue
// and the same rate resolution as anything else. A separate code path here
// would be a second answer to one question, and this file exists because that
// already happened once.
//
// THE SINK IS NOT PART OF IT. A sink is cut on the saw at a fixed per-piece
// rate and has nothing to do with who polished the edge; the piece keeps its
// row's sink share exactly as before.


/** What a piece sent to the hand bench carries of its own. Every field is
 *  nullable because a piece that was never reassigned has none of them. */
export interface HandSpec {
  /** fab_piece.polish_by_hand — the flag that makes the rest of this apply. */
  byHand: boolean;
  /** scripts/0069 — fab_piece.hand_pair_rate. Rs per foot for a side done on
   *  BOTH faces at the bench. NULL = no discount, the faces are summed. */
  pairRate?: number | null;
  /** scripts/0070 — fab_piece.hand_rate_top / _bottom / _side. Each NULL falls
   *  back to `rate`, so an untouched spec prices exactly as before. */
  rateTop?: number | null;
  rateBottom?: number | null;
  rateSide?: number | null;
  /** Its own three faces. Absent means "sent to hand but nobody specified
   *  what", which is a hole and is reported, not guessed at. */
  faceEdges?: FaceEdges | null;
  /** Its own rate, in the unit its mode implies. NULL falls back to the card. */
  rate?: number | null;
  pricingMode?: unknown;
  /** The phone-call number for this one piece. */
  totalOverride?: number | null;
}

export interface PieceDimsAndStone {
  lengthIn: number | null | undefined;
  widthIn: number | null | undefined;
  thicknessMm: number | null | undefined;
  shape?: unknown;
}

/**
 * WHAT ONE HAND-REASSIGNED PIECE'S EDGE WORK IS WORTH.
 *
 * Returns null when the piece was never sent to hand, so the caller falls
 * through to its row's share — `handPieceCharge(...) ?? rowShare` reads as the
 * rule it is.
 *
 * A piece that WAS sent to hand but carries no specification returns a charge
 * of zero flagged unpriced, rather than nothing: it is on the bench, somebody
 * is polishing it, and the figure is missing. That is a question for a screen
 * to ask, not a gap to swallow.
 */
export function handPieceCharge(
  spec: HandSpec | null | undefined,
  piece: PieceDimsAndStone,
): { edge: number; unpriced: boolean; unpricedReason: string | null; runningFeet: number } | null {
  if (!spec || !spec.byHand) return null;

  // SENT TO HAND, AND NOBODY SAID WHAT FOR.
  //
  // Somebody is standing at a bench polishing this piece right now and the
  // specification is empty. Falling through to priceRow would report a clean
  // Rs0 with unpriced:false — the piece would look like one nobody was charging
  // for, which is exactly what it is not. The hole is named instead, and the
  // screen that sent it to hand is the screen that has to come back and fill it.
  const hasSpec =
    !!spec.faceEdges && Object.keys(spec.faceEdges).length > 0;
  const hasFigure =
    spec.totalOverride !== null && spec.totalOverride !== undefined;
  // A PIECE DONE WHOLE BY HAND HAS NO EDGES TO NAME — it has a price.
  //
  // The owner: "for some peice group we give to the hand fabricated fully for
  // peice rate." There is nothing to tick on the drawing for that piece, so
  // requiring faces made his actual case impossible to enter. A per-piece or
  // lump-sum rate IS a complete answer; only RUNNING_FOOT needs to know which
  // edges, because only feet are measured along them.
  const mode = parsePricingMode(spec.pricingMode);
  const hasPieceRate =
    mode !== "RUNNING_FOOT" && spec.rate !== null && spec.rate !== undefined;
  if (!hasSpec && !hasFigure && !hasPieceRate) {
    return { edge: 0, unpriced: true, unpricedReason: "HAND_SPEC", runningFeet: 0 };
  }

  const priced = priceRow({
    lengthIn: piece.lengthIn,
    widthIn: piece.widthIn,
    quantity: 1,
    sinkQuantity: 0,               // the sink is the row's, never the bench's
    thicknessMm: piece.thicknessMm,
    shape: piece.shape,
    faceEdges: spec.faceEdges ?? null,
    // scripts/0069 — the bench is quoted the same way the row is: a piece
    // flipped once is a piece flipped once, whoever is holding it.
    pairRate: spec.pairRate ?? null,
    // scripts/0070 — and each face at its own rate, same as the row.
    rateTop: spec.rateTop ?? null,
    rateBottom: spec.rateBottom ?? null,
    rateSide: spec.rateSide ?? null,
    rate: spec.rate ?? null,
    pricingMode: spec.pricingMode,
    edgeTotalOverride: spec.totalOverride ?? null,
  });

  return {
    edge: priced.edgeCost,
    unpriced: priced.unpriced,
    unpricedReason: priced.unpricedReason,
    runningFeet: priced.runningFeet,
  };
}

/**
 * WHAT ONE PACKED PIECE EARNS, WITH THE HAND BENCH TAKEN INTO ACCOUNT.
 *
 * The same two questions pieceCharge asks, plus the one the reassignment adds:
 *
 *   EDGE  the piece's OWN hand charge if it was sent to hand; otherwise its
 *         row's share, as before.
 *   SINK  always the row's share. Untouched by any of this.
 */
export function pieceChargeWithHand(
  shares: RowShares | null | undefined,
  hasSink: boolean,
  spec: HandSpec | null | undefined,
  piece: PieceDimsAndStone,
): PieceCharge & { fromHandBench: boolean; unpriced: boolean } {
  const rowShare = pieceCharge(shares, hasSink);
  const hand = handPieceCharge(spec, piece);
  if (!hand) {
    return { ...rowShare, fromHandBench: false, unpriced: !!shares?.unpriced };
  }
  return {
    edge: hand.edge,
    sink: rowShare.sink,
    fromHandBench: true,
    unpriced: hand.unpriced,
  };
}

/** The specification to PREFILL the next piece of this row with.
 *
 *  The owner: "if in same row again a piece is sent like that, same applicable
 *  and prefilled for everything." So the first piece sent to hand on a row sets
 *  the pattern and every one after it opens already filled — the machine that
 *  broke is still broken and the next piece needs the same treatment.
 *
 *  The flag itself is NOT carried, only the specification: prefilling `byHand`
 *  would mean opening the dialog had already made the decision. */
export function prefillFrom(spec: HandSpec | null | undefined): Omit<HandSpec, "byHand"> | null {
  if (!spec) return null;
  return {
    faceEdges: spec.faceEdges ?? null,
    // The pair rate and the per-face rates travel with the rate, for the same
    // reason: each is Rs per foot and scales to whatever the next piece is.
    // Only the agreed TOTAL is dropped.
    pairRate: spec.pairRate ?? null,
    rateTop: spec.rateTop ?? null,
    rateBottom: spec.rateBottom ?? null,
    rateSide: spec.rateSide ?? null,
    rate: spec.rate ?? null,
    pricingMode: spec.pricingMode,
    totalOverride: null,   // never carried: a lump sum is for ONE piece, by definition
  };
}
