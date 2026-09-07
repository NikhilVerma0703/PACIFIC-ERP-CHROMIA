// The order pipeline — PURE. Stages, their labels, and which timestamp each
// one stamps. There is deliberately NO gate between stages: the owner has not
// yet decided whether the stock check comes before or after the PI, or whether
// payment blocks packing ("might be different from what I have stated and
// there might be more things in between as well", 2026-09-05). So a stage can
// be entered in any order; every entry is stamped and logged, and the screen
// shows the stamps rather than enforcing a sequence. When the order is
// decided, gates go in ONE place — canEnter — and nowhere else.

export type OrderStatus =
  | "DRAFT" | "CONFIRMED" | "STOCK_CHECKED" | "PI_ISSUED" | "PACKING"
  | "DISPATCH_CHECK" | "READY" | "INVOICED" | "DISPATCHED" | "CLOSED" | "CANCELLED";

export interface StageDef {
  status: OrderStatus;
  label: string;
  /** The commercial_order column stamped when this stage is entered. */
  stamp: string | null;
  /** Shown on the pipeline strip (CANCELLED is a side exit, not a step). */
  step: boolean;
}

/** In display order. */
export const ORDER_STAGES: readonly StageDef[] = [
  { status: "DRAFT",          label: "Draft",           stamp: null,                step: true },
  { status: "CONFIRMED",      label: "Confirmed",       stamp: "confirmedAt",       step: true },
  { status: "STOCK_CHECKED",  label: "Stock checked",   stamp: "stockCheckedAt",    step: true },
  { status: "PI_ISSUED",      label: "PI issued",       stamp: "piIssuedAt",        step: true },
  { status: "PACKING",        label: "Packing",         stamp: "packingAt",         step: true },
  { status: "DISPATCH_CHECK", label: "Dispatch check",  stamp: "dispatchCheckedAt", step: true },
  { status: "READY",          label: "Ready",           stamp: "readyAt",           step: true },
  { status: "INVOICED",       label: "Invoiced",        stamp: "invoicedAt",        step: true },
  { status: "DISPATCHED",     label: "Dispatched",      stamp: "dispatchedAt",      step: true },
  { status: "CLOSED",         label: "Closed",          stamp: "closedAt",          step: true },
  { status: "CANCELLED",      label: "Cancelled",       stamp: "cancelledAt",       step: false },
];

export const ORDER_STATUSES: readonly OrderStatus[] = ORDER_STAGES.map((s) => s.status);

export function stageOf(status: string): StageDef | null {
  return ORDER_STAGES.find((s) => s.status === status) ?? null;
}

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && ORDER_STATUSES.includes(v as OrderStatus);
}

export function isTerminal(status: string): boolean {
  return status === "CLOSED" || status === "CANCELLED";
}

/** Index on the pipeline strip; CANCELLED has none. */
export function stageIndex(status: string): number {
  return ORDER_STAGES.filter((s) => s.step).findIndex((s) => s.status === status);
}

/** What an order has actually done, for the three gates below. Every field is
 *  optional so a caller that does not know can still ask about the moves that
 *  need nothing. */
export interface StageFacts {
  /** A hold has been placed (stockCheckedAt set) and is still current. */
  stockChecked?: boolean;
  /** At least one ADVANCE receipt is recorded on the order. */
  advanceReceived?: boolean;
  /** The checklist has been approved (approvedAt set). */
  approved?: boolean;
}

/**
 * May an order in `from` be moved to `to`?
 *
 * THE GATES, decided by the owner on 2026-09-07 (DECISIONS.md 1, 2, 10):
 *
 *   PI_ISSUED   needs the stock check — "stock check before PI"
 *   INVOICED    needs the approval — "after PI, in the final invoice, the
 *               approval must happen"
 *   DISPATCHED  needs an ADVANCE receipt — "packing and loading are possible
 *               before the advance, but the truck is not dispatched"
 *
 * Nothing else is gated: packing, the dispatch check and readiness can all
 * happen before the money. A terminal order never moves, and a move to the
 * same stage is refused as a no-op. Every refusal names the missing thing.
 */
export function canEnter(from: string, to: string, facts: StageFacts = {}): { ok: true } | { ok: false; reason: string } {
  if (!isOrderStatus(to)) return { ok: false, reason: `Unknown stage ${to}` };
  if (from === to) return { ok: false, reason: `Already ${stageOf(to)?.label ?? to}` };
  if (isTerminal(from)) return { ok: false, reason: `A ${stageOf(from)?.label.toLowerCase() ?? from} order cannot move` };
  if (to === "PI_ISSUED" && facts.stockChecked === false) return { ok: false, reason: "Stock check first: place a hold before issuing the PI" };
  if (to === "INVOICED" && facts.approved === false) return { ok: false, reason: "The checklist must be approved before the final invoice" };
  if (to === "DISPATCHED" && facts.advanceReceived === false) return { ok: false, reason: "The advance has not been received: the truck does not leave before it" };
  return { ok: true };
}

/**
 * The Prisma patch that moves an order to a stage: the new status plus that
 * stage's timestamp. An earlier stamp is never cleared — the stamps are the
 * history, and an order that went back to PACKING after a rejected dispatch
 * check keeps the fact that it was once checked.
 */
export function stagePatch(to: OrderStatus, now: Date): Record<string, unknown> {
  const def = stageOf(to);
  const patch: Record<string, unknown> = { status: to };
  if (def?.stamp) patch[def.stamp] = now;
  return patch;
}

/** The stage a side effect implies, for the automatic moves: a hold placed →
 *  STOCK_CHECKED, a PI issued → PI_ISSUED, a packing list submitted → PACKING,
 *  verified → READY, rejected → PACKING, an invoice issued → INVOICED, slabs
 *  dispatched → DISPATCHED. Only moves FORWARD along the strip; a hold placed
 *  on an already-invoiced order does not drag it back. */
export function impliedStage(current: string, implied: OrderStatus): OrderStatus | null {
  if (isTerminal(current)) return null;
  if (stageIndex(implied) > stageIndex(current)) return implied;
  return null;
}
