// POST /api/office/commercial/packing-lists/[plId]/dispatch — the container
// has left.
//
// The slabs go DISPATCHED in finished goods under the order number and the
// client's name (that pair is what the Finished Goods screen shows against a
// dispatched slab), the hold rows that reserved them are stamped packed so a
// lapsed-hold sweep never tries to hand them back, and the order goes
// DISPATCHED.
//
// ALL OR NOTHING, AND THAT IS THE POINT. The inventory refuses a slab that has
// been cut since it was packed (fabrication marks it CTS; changeSlabStatus
// answers "marked CTS — cut to size, not dispatchable as a full slab") and it
// says so in `skipped` rather than by failing. This route used to mark the list
// and the order DISPATCHED anyway: the slab stayed PACKED with nothing pointing
// at it and the packing list — the document the container was stuffed from and
// the one customs reads — said it shipped.
//
// So: read every slab back first (dispatchPlan), and if ONE of them cannot
// leave, move nothing, name every one of them and why, and leave the list FINAL
// and the order where it was. There is no half-dispatched packing list in this
// module — a list cannot be split, and a FINAL list's slabs cannot be edited —
// so the honest answer to "one of these cannot go" is that this list does not
// go, and Commercial either fixes the slab or rebuilds the list.
//
// TWO MORE REFUSALS SINCE THE OWNER'S ANSWERS OF 2026-09-07, both before
// anything is read from finished goods:
//
//   answers 2 and 31 — NOTHING SHIPS UNTIL THE LIST IS CORRECTED. A slab the
//   dispatch check marked UNFIT (on a FINAL list, at loading) and a slab nobody
//   has checked (a replacement swapped in since) both stop the list; the reason
//   names them (dispatchBlockers).
//
//   answer 2 — THE TRUCK DOES NOT LEAVE BEFORE THE ADVANCE. The one payment
//   gate in the module: no ADVANCE receipt on the order, no dispatch. Packing,
//   the check and the finalise are not gated (answer 2 again), so this is the
//   first and only place the money is asked about.
//
// And the order moves with moveOrder, not bumpOrder: DISPATCHED is one of the
// three gated stages (stages.canEnter) and the explicit move is the one that
// carries the gate. Its refusal is reported, never swallowed.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { moveOrder } from "@/lib/commercial/order-stage";
import { readSlabs, dispatchSlabs } from "@/lib/commercial/inventory-bridge";
import {
  canDispatch, dispatchNote, dispatchPlan, dispatchBlockers, bridgeSkips, fmtSlabNo,
  PACKING_STATUS_LABEL, type PackingStatus,
} from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl, byOf, isAdminOf } from "../../_lib";

/** "The advance has not been received" — the reason the owner's answer 2 sets,
 *  word for word, so the screen and the stage strip say the same thing. */
const NO_ADVANCE = "The advance has not been received";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

const nameThem = (skipped: ReadonlyArray<{ slab: number; reason: string }>): string =>
  skipped.map((s) => `#${fmtSlabNo(s.slab)} (${s.reason})`).join("; ");

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    if (!canDispatch(list.status)) {
      fail(409, `${list.number} is ${PACKING_STATUS_LABEL[list.status as PackingStatus]?.toLowerCase() ?? list.status} — finalise it before dispatch`);
    }
    await readBody(req);

    const numbers = list.slabs.map((s) => Number(s.slabNumber));
    if (!numbers.length) fail(409, `${list.number} has no slabs`);

    // Answers 2 and 31: every slab FIT, or nothing goes.
    const blockers = dispatchBlockers(list.slabs.map((s) => ({ slabNumber: Number(s.slabNumber), fit: String(s.fit), unfitReason: (s.unfitReason as string | null) ?? null })));
    if (!blockers.ok) {
      return json({ error: `${list.number} was not dispatched. ${blockers.reason}`, dispatched: 0, unfit: blockers.unfit, unchecked: blockers.unchecked }, 409);
    }

    // Answer 2: the advance opens the gate. Read off the order's receipts
    // directly — the fact is a count, and this route must not depend on which
    // screen recorded it.
    const advances: number = await db.commercialReceipt.count({ where: { orderId: list.orderId, kind: "ADVANCE" } });
    if (advances < 1) {
      return json({ error: `${list.number} was not dispatched. ${NO_ADVANCE}: record the advance receipt on order ${list.order.number} first — the truck does not leave before it.`, dispatched: 0, advanceReceived: false }, 409);
    }
    const isAdmin = isAdminOf(g);

    // Pre-flight: everything the inventory would refuse, found BEFORE anything
    // moves, so a refusal costs nothing and leaves nothing half-done.
    const live = await readSlabs(numbers, isAdmin);
    const plan = dispatchPlan(numbers, live);
    if (!plan.ok) {
      await logOrderEvent(list.orderId, "note", {
        note: `Packing list ${list.number} was NOT dispatched — ${plan.blocked.length} slab(s) cannot leave: ${nameThem(plan.blocked)}`,
        by: g.user,
        payload: { packingListId: plId, number: list.number, dispatched: 0, blocked: plan.blocked },
      });
      return json({
        error: `${list.number} was not dispatched — ${plan.blocked.length} of ${numbers.length} slab(s) cannot leave: ${nameThem(plan.blocked)}. Nothing has moved; fix the slab or take it off the list, then dispatch again.`,
        dispatched: 0,
        skipped: plan.blocked,
      }, 409);
    }

    const client = list.order.client as { name?: string } | null;
    const res = await dispatchSlabs({
      slabNumbers: numbers,
      reference: list.order.number,
      customer: client?.name ?? "",
      by: byOf(g),
      isAdmin,
    });
    const skipped = bridgeSkips(res);

    // The pre-flight passed and the inventory still refused something: a status
    // changed underneath us between the two reads. Some slabs have gone and
    // cannot be brought back, so the list is NOT marked dispatched and the order
    // is NOT bumped — what actually happened is logged and named instead, and
    // the list stays FINAL so the rest can go once the refusal is dealt with.
    if (skipped.length) {
      await logOrderEvent(list.orderId, "dispatched", {
        note: `${dispatchNote(list.number, res.updated, skipped)}. The list is NOT marked dispatched: ${skipped.length} slab(s) were refused while it was being dispatched.`,
        by: g.user,
        payload: { packingListId: plId, number: list.number, dispatched: res.updated, onList: numbers.length, skipped, partial: true },
      });
      return json({
        error: `${list.number} is not marked dispatched — ${res.updated} of ${numbers.length} slab(s) went out and ${skipped.length} were refused: ${nameThem(skipped)}. Check those slabs in finished goods before trying again.`,
        dispatched: res.updated,
        skipped,
      }, 409);
    }

    const now = new Date();
    const holdIds = (list.order.holds as Array<{ id: string }>).map((h) => h.id);
    if (holdIds.length) {
      await db.commercialStockHoldSlab.updateMany({
        where: { holdId: { in: holdIds }, slabNumber: { in: numbers }, packedAt: null },
        data: { packedAt: now },
      });
    }
    await db.commercialPackingList.update({ where: { id: plId }, data: { status: "DISPATCHED", dispatchedAt: now } });
    // The slabs have left whatever the stage strip says, so the list is marked
    // first and the order's move is reported rather than allowed to undo it:
    // an order already at DISPATCHED (moved by hand) or CLOSED refuses the
    // move, and that is a fact for the log, not a reason to un-dispatch.
    const moved = await moveOrder(list.orderId, "DISPATCHED", g.user, `Packing list ${list.number} dispatched`);

    await logOrderEvent(list.orderId, "dispatched", {
      note: `${dispatchNote(list.number, res.updated, [])}${moved.ok ? "" : `. The order did not move: ${moved.reason}`}`,
      by: g.user,
      payload: { packingListId: plId, number: list.number, dispatched: res.updated, onList: numbers.length, skipped: [], orderMoved: moved.ok, orderMoveReason: moved.ok ? null : moved.reason },
    });
    return json(plain({ list: await loadList(plId), dispatched: res.updated, skipped: [], orderMoved: moved.ok, orderMoveReason: moved.ok ? null : moved.reason }));
  });
}
