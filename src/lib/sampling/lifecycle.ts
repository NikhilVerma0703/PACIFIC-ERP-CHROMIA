// The sample lifecycle, and the one rule that protects the stock count.
//
// PURE, AND IT IMPORTS NOTHING — see lib/catalogue/colours.ts for why.
//
// THE LIFECYCLE (the owner's decision 6, unchanged):
//
//     IN STOCK  ->  RELEASED TO PACKAGE  ->  DISPATCHED  ->  DELIVERED
//
// IN_STOCK IS NOT A COLUMN. It is where a piece is before any dispatch claims
// it: a row in sampling_stock with a quantity and no dispatch line. Only the
// last three states are ever stored, on sampling_dispatch.status — which is
// why DISPATCH_STATES exists alongside SAMPLE_STATES. Creating the dispatch IS
// the first transition.
//
// STOCK LEAVES THE SHELF AT RELEASE, not at dispatch. "Released to package"
// means the pieces have been physically pulled and put in the box; they are no
// longer available to anyone else, and a count that still showed them would
// promise the same piece to two customers. So the below-zero check belongs to
// the release step, and it is the only step that touches sampling_stock.
//
// EVERY TRANSITION IS ONE STEP FORWARD. No skipping (a package cannot be
// delivered before it is dispatched), no going back, no cancel. Nothing the
// owner has decided authorises an undo, and an undo is not a missing line of
// code — it is an unanswered question about the stock that was already pulled
// (does it come back to the shelf, and at what count?). When someone wants
// one, that question gets answered first and this file gets a new edge.

export type SampleState = "IN_STOCK" | "RELEASED" | "DISPATCHED" | "DELIVERED";

/** The whole lifecycle, in order. */
export const SAMPLE_STATES: SampleState[] = ["IN_STOCK", "RELEASED", "DISPATCHED", "DELIVERED"];

/** The states a sampling_dispatch row can hold. IN_STOCK is absent on purpose:
 *  a dispatch that has not been released does not exist. */
export const DISPATCH_STATES: SampleState[] = ["RELEASED", "DISPATCHED", "DELIVERED"];

/** The three transitions, named the way the buttons will be. */
export const TRANSITIONS: Array<{ from: SampleState; to: SampleState; action: string }> = [
  { from: "IN_STOCK", to: "RELEASED", action: "release to package" },
  { from: "RELEASED", to: "DISPATCHED", action: "dispatch" },
  { from: "DISPATCHED", to: "DELIVERED", action: "delivered" },
];

/** The columns each arrival stamps on sampling_dispatch. Kept here rather than
 *  in the route so "who moved it and when" cannot be half-implemented. */
export const STATE_STAMP: Record<string, { at: string; by: string }> = {
  RELEASED: { at: "releasedAt", by: "releasedById" },
  DISPATCHED: { at: "dispatchedAt", by: "dispatchedById" },
  DELIVERED: { at: "deliveredAt", by: "deliveredById" },
};

export function isSampleState(value: unknown): value is SampleState {
  return SAMPLE_STATES.includes(String(value ?? "") as SampleState);
}

/** The state after this one, or null at the end of the line. */
export function nextState(from: unknown): SampleState | null {
  const i = SAMPLE_STATES.indexOf(String(from ?? "") as SampleState);
  if (i < 0 || i >= SAMPLE_STATES.length - 1) return null;
  return SAMPLE_STATES[i + 1];
}

/** Is this move legal? Exactly one step forward along SAMPLE_STATES. */
export function canTransition(from: unknown, to: unknown): boolean {
  if (!isSampleState(from) || !isSampleState(to)) return false;
  return nextState(from) === to;
}

/** canTransition with the refusal spelled out, for an API to return verbatim. */
export function checkTransition(from: unknown, to: unknown): { ok: true } | { ok: false; reason: string } {
  if (!isSampleState(from)) return { ok: false, reason: `"${String(from)}" is not a sample state` };
  if (!isSampleState(to)) return { ok: false, reason: `"${String(to)}" is not a sample state` };
  if (from === to) return { ok: false, reason: `already ${from}` };
  if (canTransition(from, to)) return { ok: true };
  const forward = SAMPLE_STATES.indexOf(to) > SAMPLE_STATES.indexOf(from);
  return {
    ok: false,
    reason: forward
      ? `${from} -> ${to} skips ${nextState(from)}`
      : `${from} -> ${to} would move backwards`,
  };
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export interface StockRelease {
  /** How the line names itself in a refusal — colour, finish and size. */
  label?: string;
  /** What sampling_stock.quantity says right now. */
  onHand: number;
  /** How many pieces this dispatch line wants. */
  quantity: number;
}

export type ReleaseCheck =
  | { ok: true; remaining: number }
  | { ok: false; reason: string };

/**
 * May this many pieces be pulled from this shelf?
 *
 * Pieces are whole things: a fractional or negative quantity is not a small
 * mistake, it is a different kind of number, and a negative one would ADD
 * stock through the release path.
 *
 * The count must never go below zero. It is not a soft warning: a negative
 * sampling_stock row means the shelf is lying about something that was already
 * given away, and every later count inherits the lie.
 */
export function checkRelease(onHand: number, quantity: number): ReleaseCheck {
  if (!Number.isInteger(quantity)) return { ok: false, reason: `quantity ${quantity} is not a whole number of pieces` };
  if (quantity <= 0) return { ok: false, reason: `quantity ${quantity} must be at least 1` };
  if (!Number.isInteger(onHand)) return { ok: false, reason: `stock on hand ${onHand} is not a whole number of pieces` };
  if (onHand < 0) return { ok: false, reason: `stock on hand is already negative (${onHand})` };
  if (quantity > onHand) return { ok: false, reason: `only ${onHand} in stock, ${quantity} requested` };
  return { ok: true, remaining: onHand - quantity };
}

export interface ReleasePlan {
  ok: boolean;
  /** Every line that cannot be met, in the order they were given. */
  shortfalls: string[];
}

/**
 * Check a whole package before any of it moves.
 *
 * ALL OR NOTHING. A package is packed as one thing: releasing the three lines
 * that fit and silently dropping the fourth sends a customer a box that is
 * missing a sample nobody told them about. The caller applies this inside the
 * same transaction that writes the dispatch, re-reading the counts there —
 * this function decides, it does not reserve.
 */
export function planRelease(lines: StockRelease[]): ReleasePlan {
  const shortfalls: string[] = [];
  (lines ?? []).forEach((line, i) => {
    const check = checkRelease(Number(line?.onHand), Number(line?.quantity));
    if (!check.ok) shortfalls.push(`${line?.label ?? `line ${i + 1}`}: ${check.reason}`);
  });
  return { ok: shortfalls.length === 0, shortfalls };
}

/**
 * Stock after an intake. Same whole-piece rule as a release, from the other
 * side: an intake adds, so the refusals are about the number itself rather
 * than about running out.
 */
export function checkIntake(onHand: number, quantity: number): ReleaseCheck {
  if (!Number.isInteger(quantity)) return { ok: false, reason: `quantity ${quantity} is not a whole number of pieces` };
  if (quantity <= 0) return { ok: false, reason: `quantity ${quantity} must be at least 1` };
  if (!Number.isInteger(onHand) || onHand < 0) return { ok: false, reason: `stock on hand ${onHand} is not a whole, non-negative count` };
  return { ok: true, remaining: onHand + quantity };
}
