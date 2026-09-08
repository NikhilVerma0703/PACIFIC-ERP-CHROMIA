// Moving an order along the pipeline — the server half of ./stages.
//
//   moveOrder(id, "PACKING", by, "Packing list PL/26-27/0004 created")
//     an explicit move, refused by canEnter (terminal state, or one of the
//     three gates below with its fact missing)
//   bumpOrder(id, "STOCK_CHECKED", by, "Hold placed …")
//     the automatic move a side effect implies; only ever moves FORWARD
//     (impliedStage), so a hold placed on an invoiced order changes nothing
//
// Both stamp the stage's timestamp and write an order event. Both load the
// order's StageFacts here — stockChecked, approved, advanceReceived — and hand
// them to canEnter, so the gates the owner set on 2026-09-07 (answers 1, 2,
// 10) hold whichever route asks for the move. A caller cannot forget to pass
// a fact, because no caller passes them.
//
// The write is CONDITIONAL on the status the facts were read under
// (updateMany where { id, status }). Two concurrent moves both read the same
// row and both pass canEnter; without the condition the second would
// overwrite the first's stage and stamp and log a "from" that was no longer
// true. With it, exactly one lands and the other is told to reload — and
// nothing is logged for a move that did not happen.
//
// Residual window, accepted: the facts themselves (a live hold, an approval
// stamp, the advance arithmetic of round-two answer 11) are not part of the
// condition, so a receipt deleted between the read and the write still lets
// DISPATCHED through once.
// That deletion is an approve-level action (the Commercial Manager or an
// admin) and is itself logged with the amount, so the window is narrow, the
// actor is accountable, and the log shows both sides — cheap enough to leave
// against the cost of a transaction that holds the order row on every move.
import { prisma } from "@/lib/prisma";
import { canEnter, impliedStage, stagePatch, stageOf, type OrderStatus, type StageFacts } from "./stages";
import { stageFactsOf, orderTotals } from "./orders-rules";
import { advanceStatus, effectiveAdvancePct, type AdvanceStatus } from "./receipts-rules";
import { loadSettings } from "./settings";
import { logOrderEvent } from "./events";
import type { CommercialUser } from "./access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const MOVED_MEANWHILE = "The order moved meanwhile — reload and try again";

/** The order's status and the three facts canEnter gates on, or null when
 *  there is no such order. One-row probes rather than the full lists: the
 *  question is "is there one", not "which".
 *
 *  The hold probe asks for a hold that is ACTIVE *and not yet past its
 *  expiry*: the inventory sweep (reconcileHold) marks a lapsed hold EXPIRED
 *  later, and between the lapse and the sweep the row still says ACTIVE
 *  while the slabs are no longer held. A stock check the PI relies on
 *  (answer 1) has to mean stock that is actually held right now. */
export async function loadStageFacts(orderId: string, now: Date = new Date()): Promise<{ status: OrderStatus; facts: StageFacts; advance: AdvanceStatus } | null> {
  const order = await db.commercialOrder.findUnique({
    where: { id: orderId },
    select: {
      status: true, stockCheckedAt: true, approvedAt: true,
      kind: true, currency: true, advancePct: true, advanceWaivedAt: true,
      holds: { where: { status: "ACTIVE", expiresAt: { gt: now } }, select: { status: true, expiresAt: true }, take: 1 },
      // Round two, answer 11: the gate is arithmetic now, not a count — every
      // ADVANCE receipt and every line amount, because the question is whether
      // the agreed SHARE of the order total has arrived.
      items: { select: { amount: true } },
      receipts: { where: { kind: "ADVANCE" }, select: { kind: true, amount: true, currency: true } },
    },
  });
  if (!order) return null;
  const settings = await loadSettings();
  const advance = advanceStatus({
    receipts: order.receipts,
    orderTotal: orderTotals(order.items).amount,
    currency: String(order.currency ?? ""),
    advancePct: effectiveAdvancePct(order.advancePct, String(order.kind ?? ""), {
      domestic: settings.dispatch.advancePctDomestic,
      export: settings.dispatch.advancePctExport,
    }),
    // Answer 12: the manager's waiver satisfies the gate outright.
    waived: order.advanceWaivedAt != null,
  });
  return { status: order.status as OrderStatus, facts: stageFactsOf({ ...order, advance }, now), advance };
}

/** The stage patch plus whatever else must land in the SAME write, applied
 *  only if the row is still at the status the facts were read under. Returns
 *  whether that one row was updated. */
async function writeStage(orderId: string, from: OrderStatus, to: OrderStatus, now: Date, extra?: Record<string, unknown>): Promise<boolean> {
  const res = await db.commercialOrder.updateMany({
    where: { id: orderId, status: from },
    data: { ...(extra ?? {}), ...stagePatch(to, now) },
  });
  return res.count === 1;
}

/**
 * An explicit move. `extra` is merged into the same update as the stage
 * patch — the stage route passes { cancelReason } with it, so a cancelled
 * order can never exist without its reason (one write, not two: a failure
 * between them would leave CANCELLED with no reason, and canEnter refuses the
 * retry because a cancelled order cannot move). The stage patch wins over
 * `extra` on a clashing key so a caller cannot smuggle a different status in.
 */
export async function moveOrder(orderId: string, to: OrderStatus, by: CommercialUser | null, note?: string | null, extra?: Record<string, unknown>): Promise<{ ok: true; status: OrderStatus } | { ok: false; reason: string }> {
  const order = await loadStageFacts(orderId);
  if (!order) return { ok: false, reason: "Order not found" };
  const check = canEnter(order.status, to, order.facts);
  if (!check.ok) return check;
  const now = new Date();
  if (!(await writeStage(orderId, order.status, to, now, extra))) return { ok: false, reason: MOVED_MEANWHILE };
  await logOrderEvent(orderId, to === "CANCELLED" ? "cancelled" : "stage", { note: note ?? `${stageOf(order.status)?.label ?? order.status} → ${stageOf(to)?.label ?? to}`, by, payload: { from: order.status, to } });
  return { ok: true, status: to };
}

/** The stage the side effect moved the order to; null when it moved nothing —
 *  already there or beyond, a terminal order, a gate refused it, or the order
 *  moved under us (the other writer's move stands and is the one logged). A
 *  gate refusal is written to the log rather than swallowed: the side effect
 *  (an invoice issued, slabs dispatched) has already happened, and an order
 *  that stays put without a word is the kind of thing that gets "fixed" by
 *  hand later. */
export async function bumpOrder(orderId: string, implied: OrderStatus, by: CommercialUser | null, note?: string | null): Promise<OrderStatus | null> {
  const order = await loadStageFacts(orderId);
  if (!order) return null;
  const to = impliedStage(order.status, implied);
  if (!to) return null;
  const check = canEnter(order.status, to, order.facts);
  if (!check.ok) {
    await logOrderEvent(orderId, "note", { note: `Not moved to ${stageOf(to)?.label ?? to}: ${check.reason}`, by, payload: { from: order.status, to, implied: true, refused: check.reason } });
    return null;
  }
  const now = new Date();
  if (!(await writeStage(orderId, order.status, to, now))) return null;
  await logOrderEvent(orderId, "stage", { note: note ?? `${stageOf(order.status)?.label ?? order.status} → ${stageOf(to)?.label ?? to}`, by, payload: { from: order.status, to, implied: true } });
  return to;
}
