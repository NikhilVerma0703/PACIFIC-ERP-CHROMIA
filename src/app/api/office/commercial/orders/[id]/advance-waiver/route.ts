// POST   /api/office/commercial/orders/[id]/advance-waiver — { reason }
// DELETE /api/office/commercial/orders/[id]/advance-waiver — lift it
//
// Round two, answer 12: "a truck with no advance — the manager may let it go
// by overriding the advance rule." So this is the ONE way past the module's
// only payment gate, and it is deliberately narrow:
//
//   commercialGate("cancel", "orders") — the Commercial Manager or an admin, the same
//   people who may cancel a PI or an order. Never the clerk who is being told
//   the truck is waiting.
//
//   always with a reason. A waiver with no reason is indistinguishable from a
//   mis-click three months later, when somebody asks why this container left
//   unpaid. An empty reason is a 400, not a null column.
//
//   always logged, both ways, under kinds of its own (advance_waived /
//   advance_waiver_lifted) rather than a free-text note — so the log can be
//   filtered for every order that shipped unpaid. Lifting is logged too:
//   otherwise the order would silently go back to refusing dispatch with
//   nothing to explain it.
//
// Both writes are CONDITIONAL (updateMany on the state they were read under).
// Two managers clicking "Lift the waiver" at the same moment both read a waived
// order and, unconditionally, both wrote and both logged — the second line
// saying it lifted a waiver that was already gone. Now exactly one write lands
// and the other is told the same 409 a stale screen gets.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, bad, fail, handle, readBody, plain, paramId } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { parseWaiverReason, canWaiveAdvance } from "@/lib/commercial/receipts-rules";
import { db, loadOrderDetail, loadOrderWithItems } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const NOT_ALLOWED = "Only the Commercial Manager or an admin waives the advance";
const NOT_WAIVED = "The advance is not waived on this order";

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("cancel", "orders");
  // The refusal names the desk that can, rather than the generic deny —
  // the clerk reading it needs to know whom to ask (answer 12).
  if (!g.ok) return g.status === 403 ? bad(NOT_ALLOWED, 403) : deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    // The same line canRecordReceipt draws: a closed or cancelled order has no
    // truck left to let go, so a waiver on it would be a stamp and nothing else.
    const waivable = canWaiveAdvance(String(order.status ?? ""));
    if (!waivable.ok) fail(409, waivable.reason);
    const body = await readBody<{ reason?: unknown }>(req);
    const parsed = parseWaiverReason(body.reason);
    if (!parsed.ok) fail(400, parsed.error);
    const stamp = actorStamp(g.user);
    const data = {
      advanceWaivedAt: new Date(),
      advanceWaivedById: stamp.id,
      advanceWaivedByName: stamp.name,
      advanceWaivedReason: parsed.reason,
    };
    // Re-waiving an already-waived order is a change of reason, and the log
    // says which of the two happened rather than two identical lines. Which it
    // was is decided by the write, not by the read before it, so two waivers
    // racing cannot both be logged as the first.
    const fresh = await db.commercialOrder.updateMany({ where: { id, advanceWaivedAt: null }, data });
    const again = fresh.count === 0;
    if (again) await db.commercialOrder.update({ where: { id }, data });
    await logOrderEvent(id, "advance_waived", {
      note: `${again ? "Advance waiver amended" : "Advance waived"}: ${parsed.reason}`,
      by: g.user,
      payload: { advanceWaived: true, reason: parsed.reason, amended: again },
    });
    return json(plain(await loadOrderDetail(id)));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("cancel", "orders");
  // The refusal names the desk that can, rather than the generic deny —
  // the clerk reading it needs to know whom to ask (answer 12).
  if (!g.ok) return g.status === 403 ? bad(NOT_ALLOWED, 403) : deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    if (order.advanceWaivedAt == null) fail(409, NOT_WAIVED);
    const was = (order.advanceWaivedReason as string | null) ?? null;
    // Lifting is NOT refused on a closed or cancelled order the way waiving
    // is: it only puts the gate back, and a waiver stamped on the wrong order
    // should still be removable after the order is closed.
    const res = await db.commercialOrder.updateMany({
      where: { id, advanceWaivedAt: { not: null } },
      data: { advanceWaivedAt: null, advanceWaivedById: null, advanceWaivedByName: null, advanceWaivedReason: null },
    });
    // Somebody else lifted it between the read and the write: nothing of ours
    // landed, so nothing of ours is logged.
    if (res.count === 0) fail(409, NOT_WAIVED);
    await logOrderEvent(id, "advance_waiver_lifted", {
      note: `Advance waiver lifted — the advance is asked for again${was ? ` (it was waived: ${was})` : ""}`,
      by: g.user,
      payload: { advanceWaived: false, previousReason: was },
    });
    return json(plain(await loadOrderDetail(id)));
  });
}
