// Piece rejection after cut. The piece stays in the table as REJECTED so the
// cut history is not rewritten; the planning ledger
// (fab_requirement_allocation) is decremented so the demand shows up again on
// Slab & Sink Assignment. The slab is not reopened and cut area is not restored.

export const REJECT_REASONS = [
  { id: "CONTAMINATION", label: "Contamination" },
  { id: "CRACK",         label: "Crack" },
  { id: "CHIP",          label: "Chip" },
  { id: "WRONG_SIZE",    label: "Wrong size" },
  { id: "COLOUR",        label: "Colour / shade" },
  { id: "OTHER",         label: "Other" },
] as const;

export type RejectReasonId = (typeof REJECT_REASONS)[number]["id"];

export function isRejectReason(value: unknown): value is RejectReasonId {
  return typeof value === "string" && REJECT_REASONS.some(r => r.id === value);
}

/** Statuses that must not appear in station queues. */
export function isDroppedFromQueues(status: string): boolean {
  return status === "REJECTED" || status === "PENDING";
}

export function canRejectPiece(status: string, packaged: boolean): { ok: true } | { ok: false; error: string } {
  if (status === "REJECTED") return { ok: false, error: "Already rejected." };
  if (status === "PENDING") return { ok: false, error: "Piece has not been cut yet." };
  if (status === "PACKAGED" || packaged) return { ok: false, error: "Unpack this piece before rejecting it." };
  return { ok: true };
}

/**
 * After one piece is rejected, how the matching allocation row should change.
 * Quantity 1 → delete the row (remaining demand is then fully unallocated).
 * Quantity > 1 → decrement by 1.
 * Quantity 0 or missing → leave the ledger alone; the piece is still rejected.
 */
export function allocationAfterReject(allocatedQuantity: number):
  | { action: "noop" }
  | { action: "delete" }
  | { action: "decrement"; next: number } {
  const n = Number.isFinite(allocatedQuantity) ? Math.floor(allocatedQuantity) : 0;
  if (n <= 0) return { action: "noop" };
  if (n === 1) return { action: "delete" };
  return { action: "decrement", next: n - 1 };
}
