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

import { priceRow, type RowPricingInput, type UnpricedReason } from "./pricing.ts";
import { perPieceCharge } from "./periodReport.ts";

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
    ...perPieceCharge(priced.edgeCost, priced.sinkCost, priced.edgePieces, priced.sinkPieces),
    rowHasEdgeWork: priced.edgePieces > 0,
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
