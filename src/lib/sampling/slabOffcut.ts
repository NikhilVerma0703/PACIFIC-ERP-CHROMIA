// TAKING SAMPLES OUT OF A USED SLAB'S OFFCUT, until there is none left.
//
// The owner: "not all the wastage to samples — only wastage taken to samples by
// the sample guy. He should see slab wastage on used slab, then he can click the
// slab and enter the size and quantity, then take from that until it empties."
//
// Two halves, and the second one did not exist:
//
//   WHAT IS LEFT      already modelled, and modelled correctly.
//                     computeSlabLoss gives remainingAreaSqft = slab area minus
//                     the purchase order's pieces minus what has ALREADY been
//                     taken as samples. Only the stone actually taken is
//                     credited — the rest stays wastage, which is exactly the
//                     distinction the owner is drawing.
//
//   TAKING FROM IT    nothing stopped it. /api/sampling/intake verified that the
//                     source slab EXISTS and then wrote the intake, so forty
//                     pieces of 12 x 12 could be booked against a slab with
//                     three square feet left. The stone was reported as
//                     consumed twice over and the slab's wastage went negative.
//
// So this module answers one question, and both the screen and the route ask it
// of this file rather than each computing it: HOW MUCH IS LEFT, and DOES THIS
// TAKE FIT.
//
// ─────────────────────────────── WHY A MODULE AND NOT AN `IF` ───────────────
// The same rule has to hold in two places that must not disagree:
//
//   the offcut list    greys a slab, and shows him how much he can take
//   the intake route   refuses the write
//
// A screen that offers what the route will refuse is the failure decideSendToCutting
// and sampledArea already exist to prevent on the fabrication side; this is the
// sampling side of the same rule. PURE, so `node --test` reaches it and a client
// component can import it.
//
// ─────────────────────────────── AREA, NOT SHAPE ────────────────────────────
// This checks AREA and says so plainly: 3 sqft of offcut will not yield a
// 12 x 12 piece if it is a 2-inch strip down one edge. Nesting is a human
// judgement made looking at the stone, and pretending to model it would be a
// confident answer nobody can check.
//
// What area accounting DOES guarantee is the direction that costs money: it can
// never say yes to a take the slab cannot possibly hold. It is a ceiling, not a
// promise — and the message says which.

import { sampleAreaSqft, sqftFromInches } from "../fab/slabLoss.ts";

/** 2dp, half away from zero, EPSILON-corrected — the same money()/round2 rule
 *  slabLoss.ts and slabCosting.ts use, so the figures compare exactly. */
function round2(n: number): number {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function positive(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** One sample size being taken: the piece, and how many of it. */
export interface OffcutTake {
  lengthIn: number | null | undefined;
  widthIn: number | null | undefined;
  quantity: number | null | undefined;
}

export interface OffcutState {
  /** The slab's face area, square feet. */
  slabAreaSqft: number;
  /** Square feet committed to the PURCHASE ORDER's pieces. */
  usedAreaSqft: number;
  /** Square feet ALREADY taken as samples off this slab. */
  sampledAreaSqft: number;
}

export interface OffcutRemaining {
  /**
   * WHAT THE SAMPLE GUY CAN STILL TAKE, square feet, floored at zero.
   *
   * slabAreaSqft - usedAreaSqft - sampledAreaSqft. FLOORED, deliberately: a
   * slab that is already over-committed has nothing to give, and a negative
   * "available" figure on his screen would read as a credit.
   */
  availableSqft: number;
  /** The same as a share of the slab, for the bar on his screen. Null when the
   *  slab has no usable dimensions — "we do not know" is not "0%". */
  availablePct: number | null;
  /** True when the slab is spent: nothing left to take. */
  empty: boolean;
  /** True when MORE has been committed than the slab holds. Not his fault and
   *  not his problem to fix, but he must not be offered stone that is already
   *  over-subscribed. */
  overCommitted: boolean;
}

/** How much of this slab is still available to sample from. */
export function offcutRemaining(state: OffcutState): OffcutRemaining {
  const slab = round2(positive(state.slabAreaSqft));
  const used = round2(positive(state.usedAreaSqft));
  const sampled = round2(positive(state.sampledAreaSqft));
  const raw = round2(slab - used - sampled);
  const availableSqft = raw > 0 ? raw : 0;
  return {
    availableSqft,
    availablePct: slab > 0 ? round2((availableSqft / slab) * 100) : null,
    empty: availableSqft <= 0,
    overCommitted: slab > 0 && round2(used + sampled) > slab,
  };
}

/** Square feet one take would consume. */
export function takeAreaSqft(takes: OffcutTake[]): number {
  return sampleAreaSqft(takes ?? []);
}

export type OffcutRefusal =
  /** The slab has no dimensions, so there is no area to draw against. */
  | "NO_SLAB_AREA"
  /** Nothing left — the stone is spent. */
  | "EMPTY"
  /** More is committed to this slab than it holds; it cannot give more. */
  | "OVER_COMMITTED"
  /** The take itself is not a take: no size, or no quantity. */
  | "NOTHING_TAKEN"
  /** It would take more than is left. */
  | "TOO_LARGE";

export interface OffcutDecision {
  ok: boolean;
  /** Square feet this take consumes. */
  takeSqft: number;
  /** Available before the take. */
  availableSqft: number;
  /** Available after it — zero when the take empties the slab exactly. Only
   *  meaningful when ok; zero on a refusal, because nothing was taken. */
  remainingAfterSqft: number;
  /** Why not. Null when ok. */
  reason: OffcutRefusal | null;
  /** The refusal in the words the sample guy needs, or null when ok. Written
   *  here rather than in the route so the screen and the API say the same
   *  thing, and so it names the NUMBER he is over by. */
  error: string | null;
}

/**
 * MAY HE TAKE THIS, AND WHAT IS LEFT AFTERWARDS.
 *
 * The one function the offcut screen and the intake route both call.
 *
 * A take that lands EXACTLY on the remaining area is allowed — that is the
 * "until it empties" case and refusing it would leave a sliver nobody can ever
 * book. Anything past that is refused, with the overage named.
 */
export function decideOffcutTake(
  state: OffcutState,
  takes: OffcutTake[],
): OffcutDecision {
  const remaining = offcutRemaining(state);
  const takeSqft = takeAreaSqft(takes);
  const base = {
    takeSqft,
    availableSqft: remaining.availableSqft,
    remainingAfterSqft: 0,
  };

  if (round2(positive(state.slabAreaSqft)) <= 0) {
    return {
      ...base, ok: false, reason: "NO_SLAB_AREA",
      error: "This slab has no size recorded, so there is no offcut to measure. Ask the supervisor to enter its length and width.",
    };
  }
  if (takeSqft <= 0) {
    return {
      ...base, ok: false, reason: "NOTHING_TAKEN",
      error: "Enter a size and a quantity before taking from this slab.",
    };
  }
  if (remaining.overCommitted) {
    return {
      ...base, ok: false, reason: "OVER_COMMITTED",
      error: "More stone is already committed to this slab than it holds, so nothing can be taken from it. The supervisor needs to fix its allocation first.",
    };
  }
  if (remaining.empty) {
    return {
      ...base, ok: false, reason: "EMPTY",
      error: "This slab is finished — there is no offcut left on it. Pick another slab.",
    };
  }
  if (takeSqft > remaining.availableSqft) {
    const over = round2(takeSqft - remaining.availableSqft);
    return {
      ...base, ok: false, reason: "TOO_LARGE",
      error: `That is ${takeSqft} sqft and only ${remaining.availableSqft} sqft is left on this slab — ${over} sqft too much. Take fewer pieces, or a smaller size, or use another slab.`,
    };
  }

  return {
    ...base,
    ok: true,
    remainingAfterSqft: round2(remaining.availableSqft - takeSqft),
    reason: null,
    error: null,
  };
}

/** One size's area, for a screen that prices a take before it is made. */
export function oneTakeSqft(lengthIn: unknown, widthIn: unknown, quantity: unknown): number {
  return round2(sqftFromInches(positive(lengthIn), positive(widthIn)) * positive(quantity));
}
