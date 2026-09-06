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

/**
 * May an order in `from` be moved to `to`? Today: anything except leaving a
 * terminal state, and except moving to the same state. THIS IS THE ONE PLACE a
 * gate goes when the owner decides the order of steps.
 */
export function canEnter(from: string, to: string): { ok: true } | { ok: false; reason: string } {
  if (!isOrderStatus(to)) return { ok: false, reason: `Unknown stage ${to}` };
  if (from === to) return { ok: false, reason: `Already ${stageOf(to)?.label ?? to}` };
  if (isTerminal(from)) return { ok: false, reason: `A ${stageOf(from)?.label.toLowerCase() ?? from} order cannot move` };
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
