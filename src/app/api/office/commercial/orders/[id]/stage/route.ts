// PATCH /api/office/commercial/orders/[id]/stage — { to, note?, reason? }
// → moveOrder; CANCELLED also records cancelReason and is a "cancel" action
// (answer 24: only an admin or the Commercial Manager). 409 with canEnter's
// own reason when a gate refuses the move (answers 1, 2, 10), or when the
// order moved under the caller.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { moveOrder } from "@/lib/commercial/order-stage";
import { isOrderStatus } from "@/lib/commercial/stages";
import { loadOrderDetail, loadOrderWithItems } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadOrderWithItems(id);
    const body = await readBody<{ to?: unknown; note?: unknown; reason?: unknown }>(req);
    const to = str(body.to)?.toUpperCase();
    if (!to || !isOrderStatus(to)) fail(400, "to must be an order stage");
    const reason = str(body.reason);
    const note = str(body.note);
    if (to === "CANCELLED") {
      // The write gate let the caller in; cancelling is the narrower action,
      // and it can only be asked once the body says that is what this is.
      const c = await commercialGate("cancel");
      if (!c.ok) fail(403, "Only the Commercial Manager or an admin cancels an order");
      if (!reason) fail(400, "Give a reason for cancelling");
    }
    // cancelReason rides in the SAME update as the status: written separately
    // afterwards, a failure between the two left a CANCELLED order with no
    // reason, and the retry was refused because a cancelled order cannot move.
    const res = await moveOrder(
      id, to, g.user,
      to === "CANCELLED" ? `Cancelled: ${reason}${note ? ` — ${note}` : ""}` : note,
      to === "CANCELLED" ? { cancelReason: reason } : undefined,
    );
    if (!res.ok) fail(409, res.reason);
    return json(plain({ status: res.status, order: await loadOrderDetail(id) }));
  });
}
