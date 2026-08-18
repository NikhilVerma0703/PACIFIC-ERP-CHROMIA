// ============================================================
// lib/requirement-derive.ts
//
// Shared logic for turning a requirement row into the derived fields the rest
// of the system routes on:
//   - inch -> mm conversion (Excel is always inches; DB/production is mm)
//   - polishRequired (now ALWAYS true — see below)
//   - sinkRequired   (from the supervisor's sink quantity)
//   - fabricationRequired (= sinkRequired; fabrication here means the
//     outsourced hand-polish of the sink cutout, so it never applies to
//     a piece without a sink)
//
// WHAT CHANGED, AND WHY. The manager's upload used to carry a DE&P (edge
// polish) length and a sink-cut count per drawing row, and routing was derived
// from those columns. It no longer carries either: the new intake is a flat
// Length / Width / Qty / SFT list (flatSheetParser.ts). Two rules replaced them:
//
//   1. EVERY piece is edge-polished. Polish stopped being a decision the sheet
//      makes — it is what the shop does to every piece it cuts. On the last
//      live project 896 of 902 pieces were polished anyway; the 6 that were not
//      were rows where the DE&P cell happened to be blank, not pieces anyone
//      meant to leave raw.
//   2. Sinks are chosen by the SUPERVISOR, per requirement, with a quantity —
//      3 of 10 pieces of a row can have sinks. That count is
//      fab_requirement.sink_quantity; the sheet has no say in it any more.
//
// Fabrication still tracks the sink exactly, unchanged.
//
// WHO ACTUALLY CALLS THIS. /api/fab/supervisor/release-project, and only it.
// The header here used to claim /api/fab/projects (the legacy Drawing Summary
// create path) shared it "so the two piece-creation flows can't drift out of
// sync" — it does not and never did: that route open-codes the old rules at
// route.ts:45-46 (`polishRequired = (r.depLength ?? 0) > 0`). It is left alone
// on purpose; retiring the old intake is a separate change. Until then a
// requirement created through it carries the OLD polish/sink flags in its own
// columns, and release-project ignores them — polish is now unconditional and
// the sink comes from sink_quantity, which that path never sets.
// ============================================================

export const INCH_TO_MM = 25.4;

/** Convert a nullable/undefined inch value to mm. Returns undefined if input is falsy/0. */
export function inchToMm(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === 0) return value === 0 ? 0 : undefined;
  return Math.round(value * INCH_TO_MM * 100) / 100; // round to 2dp to avoid float noise
}

/**
 * How many of a requirement's pieces actually get a sink.
 *
 * NULL and 0 both mean none — the column is nullable so that "the supervisor
 * has not looked at this row yet" and "he looked and said no sinks" are not
 * forced to be the same value, but they route identically.
 *
 * Clamped to [0, quantity] and floored to whole pieces: a stale sink_quantity
 * left behind after someone reduced the ordered quantity would otherwise hand
 * the release loop a count larger than the number of pieces it is about to
 * create, and half a sink is not a thing.
 *
 * `quantity` omitted means "no cap known", not "cap of zero" — a caller that
 * only wants to know whether a row involves sinks at all should not have to
 * produce the ordered quantity to be told the truth.
 */
export function resolveSinkQuantity(
  sinkQuantity: number | null | undefined,
  quantity?: number | null,
): number {
  const wanted = typeof sinkQuantity === "number" && Number.isFinite(sinkQuantity)
    ? Math.floor(sinkQuantity)
    : 0;
  if (wanted <= 0) return 0;
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return wanted;
  const cap = Math.floor(quantity);
  if (cap <= 0) return 0;
  return Math.min(wanted, cap);
}

export interface RoutingFlagsInput {
  /** Supervisor's choice: how many pieces of this requirement carry a sink. */
  sinkQuantity?: number | null;
  /** The requirement's ordered quantity, used only to cap sinkQuantity. */
  quantity?: number | null;
}

export interface RoutingFlags {
  sinkRequired: boolean;
  polishRequired: boolean;
  fabricationRequired: boolean;
}

/**
 * Derive the routing flags that the cutting/polishing/sink/fabrication
 * queues key off.
 *
 * Rule (locked with production team):
 *  - polishRequired      = true, always. Every piece is edge-polished.
 *  - sinkRequired        = the requirement has at least one sink piece
 *                          (resolveSinkQuantity > 0)
 *  - fabricationRequired = sinkRequired
 *      (fabrication = outsourced hand-polish of the sink cutout itself;
 *       only ever relevant once a sink exists, and only actionable after
 *       sink-cutting is completed)
 *
 * These are the REQUIREMENT-level flags — "does this row involve a sink at
 * all". Per-piece routing is finer: only the first `resolveSinkQuantity` pieces
 * of the row carry the sink, and the release route decides that piece by piece.
 */
export function deriveRoutingFlags(input: RoutingFlagsInput): RoutingFlags {
  const sinkRequired = resolveSinkQuantity(input.sinkQuantity, input.quantity) > 0;

  return {
    sinkRequired,
    polishRequired: true,
    fabricationRequired: sinkRequired,
  };
}
