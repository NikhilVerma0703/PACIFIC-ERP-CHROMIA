// The slab-first assignment board's arithmetic: how much of a requirement is
// still unallocated, whether one more allocation is allowed, and whether a slab
// may be sent to the cutter.
//
// PURE, AND IT IMPORTS NOTHING — same reason as slabLoss.ts and
// flatSheetParser.ts: `node --test` resolves ESM strictly, so a relative import
// without a .ts extension fails at runtime while adding the extension fights the
// Next build. That is also why decideSendToCutting takes the fields of a
// SlabLossResult one by one instead of importing the type.
//
// WHY IT IS A LIB AND NOT INLINE IN THE ROUTE. The over-allocation rule has to
// hold in two places that cannot share a call stack: the browser greys the
// button out, and the server refuses inside a transaction because two
// supervisors on two tablets is a real scenario in this shop. If the rule were
// written inline in the route the screen would have to guess at it, and the two
// would drift the first time either was touched — the screen would offer a
// quantity the server then rejected, which reads to the supervisor as the
// tablet being broken.
//
// THE LEDGER. Allocations live in fab_requirement_allocation
// (requirementId, slabId, allocatedQuantity) and nowhere else. There is no
// second tally of "how much is assigned" to keep in step; every number below is
// derived from those rows on the spot.

/** One fab_requirement_allocation row, as much of it as this module needs. */
export interface AllocationLike {
  id: string;
  allocatedQuantity: number;
}

/** Whole pieces only, never negative. A fractional or negative
 *  allocated_quantity is data damage, not an instruction — half a slab piece
 *  does not exist and a negative one would silently create head-room. */
function wholePieces(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Pieces already spoken for across every slab this requirement sits on.
 *
 * `excludeAllocationId` leaves one row out, which is what an ADJUST needs: the
 * row being edited must not be counted against itself, or raising 3 to 4 on a
 * fully-allocated requirement looks like asking for 7.
 */
export function allocatedTotal(
  allocations: AllocationLike[],
  excludeAllocationId?: string | null,
): number {
  return (allocations ?? []).reduce(
    (sum, a) => (excludeAllocationId && a.id === excludeAllocationId ? sum : sum + wholePieces(a.allocatedQuantity)),
    0,
  );
}

/**
 * Pieces of this requirement that still have no slab. Never negative: a row
 * that is already over-allocated (old data, or a CLO import) reads as 0 left
 * rather than as a negative that would let one more through.
 */
export function remainingQuantity(
  orderedQuantity: number,
  allocations: AllocationLike[],
  excludeAllocationId?: string | null,
): number {
  return Math.max(0, wholePieces(orderedQuantity) - allocatedTotal(allocations, excludeAllocationId));
}

export interface AllocationRequest {
  /** fab_requirement.quantity — how many were ordered. */
  orderedQuantity: number;
  /** Every allocation this requirement has right now, across all slabs. */
  existing: AllocationLike[];
  /** The allocation being changed, or null when a new one is being added. */
  allocationId: string | null;
  /** What the supervisor asked for. */
  requestedQuantity: number;
  /** How this row is named on screen — "PO 10026 Row 7" — so the refusal
   *  points at something he can find. */
  label: string;
}

export type AllocationDecision =
  | { ok: true; allocatedQuantity: number; remainingAfter: number }
  | { ok: false; error: string; remaining: number };

/**
 * May this allocation be written?
 *
 * The one rule: the sum of allocated_quantity across slabs must never exceed
 * fab_requirement.quantity. Over-allocating does not overproduce — release
 * caps the piece count at the order (buildReleasePlan) — it silently drops the
 * excess, so the cutter at the second slab is handed pieces that were never
 * created. Refusing here is the only place that failure is visible to someone
 * who can fix it.
 *
 * The refusal NAMES the row and says how many are actually left, because the
 * supervisor's next question is always "then how many can I put on?".
 */
export function decideAllocation(req: AllocationRequest): AllocationDecision {
  const ordered = wholePieces(req.orderedQuantity);
  const wanted = Math.floor(Number(req.requestedQuantity));
  const remaining = remainingQuantity(ordered, req.existing, req.allocationId);

  if (!Number.isFinite(wanted) || wanted < 1) {
    return {
      ok: false,
      remaining,
      error: `${req.label}: a slab has to be given at least one whole piece. Remove the row instead of setting it to zero.`,
    };
  }

  if (ordered <= 0) {
    return {
      ok: false,
      remaining: 0,
      error: `${req.label}: this row has no ordered quantity, so nothing can be cut for it.`,
    };
  }

  if (wanted > remaining) {
    const already = ordered - remaining;
    return {
      ok: false,
      remaining,
      error:
        `${req.label}: only ${remaining} of ${ordered} piece(s) are still unallocated ` +
        `(${already} already assigned to other slabs), so ${wanted} cannot be added. ` +
        `Reduce it to ${remaining} or take pieces off another slab first.`,
    };
  }

  return { ok: true, allocatedQuantity: wanted, remainingAfter: remaining - wanted };
}

/* -- Sending a slab to the cutter ------------------------------------------ */

export interface SendToCuttingInput {
  /** The slab as the supervisor sees it — "Slab 1350". */
  slabLabel: string;
  /** Total pieces assigned to this slab (sum of allocated_quantity). */
  assignedPieceCount: number;
  /** computeSlabLoss(...).overCommitted */
  overCommitted: boolean;
  /** computeSlabLoss(...).usedAreaSqft — PO pieces only. */
  usedAreaSqft: number;
  /** computeSlabLoss(...).slabAreaSqft */
  slabAreaSqft: number;
  /**
   * computeSlabLoss(...).sampledAreaSqft — stone already cut off this slab for
   * sampling. Optional, so a caller with nothing to report keeps the original
   * wording exactly; when it is present and non-zero the refusal SAYS SO.
   *
   * Without it the message is baffling: a supervisor who put 68 sqft of rows on
   * a 75 sqft slab is told he has over-committed it, and nothing on the screen
   * mentions the 10 sqft that left as samples last week. A refusal that cannot
   * be acted on is only half a refusal.
   */
  sampledAreaSqft?: number | null;
}

export type SendToCuttingDecision = { ok: true } | { ok: false; error: string };

/**
 * May this slab go to the cutter?
 *
 * Over-commitment is REFUSED, not clamped. computeSlabLoss returns signed
 * negatives when the pieces exceed the slab, and a negative wastage written into
 * fab_slab_job outlives the mistake that caused it — it means the allocation is
 * wrong, not that the maths is. Clamping it to zero would send a cutter to a
 * slab that physically cannot hold the work and lose the only evidence.
 *
 * Shared by the board (to grey the button and explain why) and by
 * /api/fab/approve-slab (to enforce it), so the screen cannot offer something
 * the server will reject.
 */
export function decideSendToCutting(input: SendToCuttingInput): SendToCuttingDecision {
  if (wholePieces(input.assignedPieceCount) < 1) {
    return {
      ok: false,
      error: `${input.slabLabel} has no piece rows on it yet — there would be nothing for the cutter to cut.`,
    };
  }

  if (input.overCommitted) {
    const sampled = Number(input.sampledAreaSqft);
    const takenBySamples = Number.isFinite(sampled) && sampled > 0 ? Math.round(sampled * 100) / 100 : 0;
    const committed = Math.round((input.usedAreaSqft + takenBySamples) * 100) / 100;
    const over = Math.round((committed - input.slabAreaSqft) * 100) / 100;
    // Name the sample take-off when there is one. The supervisor's own rows are
    // the only thing he can change, so he has to be told the rest of the slab
    // has already gone somewhere else.
    const because = takenBySamples > 0
      ? `${input.usedAreaSqft} sqft of pieces plus ${takenBySamples} sqft already cut for samples, on a `
      : `${input.usedAreaSqft} sqft of pieces on a `;
    return {
      ok: false,
      error:
        `${input.slabLabel} is over-committed: ${because}` +
        `${input.slabAreaSqft} sqft slab, ${over} sqft too much. Take rows off it and put them ` +
        `on another slab — nothing was sent to the cutter.`,
    };
  }

  return { ok: true };
}

/* -- Feeding computeSlabLoss ------------------------------------------------ */

/** An assigned row as the board holds it. Dimensions are INCHES, as stored on
 *  fab_requirement; the slab's own dimensions are MILLIMETRES. See slabLoss.ts,
 *  which exists because those two units live in the same sum. */
export interface AssignedRowLike {
  lengthIn: number | null | undefined;
  widthIn: number | null | undefined;
  allocatedQuantity: number | null | undefined;
}

/**
 * The rows of one slab in the shape computeSlabLoss wants.
 *
 * Only the renaming — allocatedQuantity is the quantity that consumes material,
 * NOT the requirement's ordered quantity. Feeding it the ordered quantity is
 * the easy mistake here: a row split 3-and-7 across two slabs would then be
 * charged 10 pieces to each of them, and both slabs would read as
 * over-committed for work that fits.
 */
export function slabLossPieces(rows: AssignedRowLike[]): {
  lengthIn: number | null | undefined;
  widthIn: number | null | undefined;
  quantity: number;
}[] {
  return (rows ?? []).map(r => ({
    lengthIn: r.lengthIn,
    widthIn: r.widthIn,
    quantity: wholePieces(r.allocatedQuantity),
  }));
}

/** Total pieces on a slab. */
export function assignedPieceCount(rows: AssignedRowLike[]): number {
  return (rows ?? []).reduce((sum, r) => sum + wholePieces(r.allocatedQuantity), 0);
}
