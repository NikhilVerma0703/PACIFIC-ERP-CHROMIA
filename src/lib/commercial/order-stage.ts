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
import { commercialActorOf, type CommercialUser } from "./access";
import { dispatchReservedForOrder } from "./inventory-bridge";
import { autoDispatchNote, autoDispatchIntentNote } from "./tasks-rules";
import { advanceRateFor } from "@/lib/commercial/advance-rate";

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
    // Round three, answer 10: the rate on the order's live invoice, so a
    // foreign advance counts here exactly as it counts on the receipts card.
    rate: await advanceRateFor(orderId),
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

/** What the close did to the stock, for the caller that asked for the move. */
export interface AutoDispatchReport {
  moved: number;
  slabNumbers: number[];
  skipped: { slab: number; reason: string }[];
  /** RESERVED against the order but not readable by this login (the
   *  sales-approval filter) — left where they are, and said out loud. */
  unreadable: number;
  /** The line written to the order log; safe to show on screen. */
  note: string;
}

/**
 * CLOSED is the last stage, and round three, answer 6 says what reaching it
 * does to the stock: "whatever is reserved should be marked dispatched after
 * deliver / last step."
 *
 * WHY THIS RUNS AFTER THE STAGE WRITE AND NOT IN A TRANSACTION WITH IT. The
 * bridge moves slabs through changeSlabStatus — the same function Finished
 * Goods uses, which opens its own writes and takes no transaction client — so
 * there is no way to enrol it in the order's update from here. Given that, the
 * ORDER of the two matters more than their atomicity: the stage write is the
 * conditional one (updateMany where { id, status }) and is what decides which
 * of two concurrent closers wins. Dispatching first would mean the loser had
 * already moved the stock. So the close lands, then the stock follows, and the
 * gap is covered by the log rather than pretended away.
 *
 * Nothing here may fail the close. The order IS closed by the time this runs;
 * a bridge error becomes a logged note naming it, so the desk is told the
 * slabs are still reserved instead of the whole call 500-ing after the fact.
 */
async function dispatchOnClose(orderId: string, by: CommercialUser | null): Promise<AutoDispatchReport | null> {
  try {
    const order = await db.commercialOrder.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        client: { select: { name: true } },
        enquiry: { select: { number: true } },
        holds: { select: { reference: true } },
      },
    });
    if (!order) return null;
    // The same list packSlabs is given (packing-lists/_lib.ownReferences): the
    // order number, every hold it placed, and its enquiry number. A slab
    // reserved under somebody else's PI is not ours to move, and closing an
    // order must never become a way to clear another desk's hold.
    const refs = new Set<string>();
    if (order.number) refs.add(String(order.number));
    for (const h of (order.holds ?? []) as Array<{ reference?: string | null }>) if (h?.reference) refs.add(h.reference);
    if (order.enquiry?.number) refs.add(String(order.enquiry.number));

    const res = await dispatchReservedForOrder({
      references: Array.from(refs),
      reference: String(order.number ?? ""),
      customer: (order.client?.name as string | undefined) ?? "",
      by: by?.name || by?.email || null,
      isAdmin: commercialActorOf(by) === "ADMIN",
      // WRITTEN BEFORE ANYTHING MOVES. The sweep is one round trip per slab
      // (changeSlabStatus reads, writes and logs each one), so a close with a
      // large enquiry-level hold behind it can outlive the serverless
      // function: half the slabs move and the result note below — written
      // last — never lands, leaving the log silent about a stock movement
      // that half happened. This line is the record that survives that, and
      // the per-slab events finished goods writes say how far it got.
      onPlanned: async (plan) => {
        await logOrderEvent(orderId, "dispatched", {
          note: autoDispatchIntentNote(String(order.number ?? ""), plan.slabNumbers),
          by,
          payload: { auto: true, closed: true, intent: true, slabs: plan.slabNumbers, skipped: plan.skipped },
        });
      },
    });
    const note = autoDispatchNote(String(order.number ?? ""), res.updated, res.skipped.length, res.unreadable);
    // Logged whether or not anything moved: a no-op is a fact the desk needs
    // ("nothing was still reserved"), and after this change nobody is ticking
    // slabs by hand, so the log is the only record that the sweep ran at all.
    await logOrderEvent(orderId, "dispatched", {
      note,
      by,
      payload: { auto: true, closed: true, dispatched: res.updated, slabs: res.slabNumbers, skipped: res.skipped, unreadable: res.unreadable },
    });
    return { moved: res.updated, slabNumbers: res.slabNumbers, skipped: res.skipped, unreadable: res.unreadable, note };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    await logOrderEvent(orderId, "note", {
      note: `The order closed, but the automatic dispatch of its reserved slabs failed: ${msg}. They are still RESERVED — dispatch them from finished goods.`,
      by,
      payload: { auto: true, closed: true, failed: msg },
    });
    return null;
  }
}

/**
 * An explicit move. `extra` is merged into the same update as the stage
 * patch — the stage route passes { cancelReason } with it, so a cancelled
 * order can never exist without its reason (one write, not two: a failure
 * between them would leave CANCELLED with no reason, and canEnter refuses the
 * retry because a cancelled order cannot move). The stage patch wins over
 * `extra` on a clashing key so a caller cannot smuggle a different status in.
 */
export async function moveOrder(orderId: string, to: OrderStatus, by: CommercialUser | null, note?: string | null, extra?: Record<string, unknown>): Promise<{ ok: true; status: OrderStatus; autoDispatch?: AutoDispatchReport } | { ok: false; reason: string }> {
  const order = await loadStageFacts(orderId);
  if (!order) return { ok: false, reason: "Order not found" };
  const check = canEnter(order.status, to, order.facts);
  if (!check.ok) return check;
  const now = new Date();
  if (!(await writeStage(orderId, order.status, to, now, extra))) return { ok: false, reason: MOVED_MEANWHILE };
  await logOrderEvent(orderId, to === "CANCELLED" ? "cancelled" : "stage", { note: note ?? `${stageOf(order.status)?.label ?? order.status} → ${stageOf(to)?.label ?? to}`, by, payload: { from: order.status, to } });
  // Answer 6: the last stage takes the stock with it. Only the mover that
  // actually landed the write gets here, so the sweep runs once per close.
  const autoDispatch = to === "CLOSED" ? await dispatchOnClose(orderId, by) : null;
  return autoDispatch ? { ok: true, status: to, autoDispatch } : { ok: true, status: to };
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
  // Nothing implies CLOSED today, but answer 6 is about REACHING the last
  // stage, not about which route asked — so the sweep hangs off the move
  // itself and a later implied close cannot quietly skip it.
  if (to === "CLOSED") await dispatchOnClose(orderId, by);
  return to;
}
