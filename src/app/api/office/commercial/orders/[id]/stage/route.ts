// PATCH /api/office/commercial/orders/[id]/stage — { to, note?, reason? }
// → moveOrder; CANCELLED also records cancelReason. 409 when the move is refused.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { moveOrder } from "@/lib/commercial/order-stage";
import { isOrderStatus } from "@/lib/commercial/stages";
import { db, loadOrderDetail, loadOrderWithItems } from "../../_lib";

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
    if (to === "CANCELLED" && !reason) fail(400, "Give a reason for cancelling");
    const res = await moveOrder(id, to, g.user, to === "CANCELLED" ? `Cancelled: ${reason}${note ? ` — ${note}` : ""}` : note);
    if (!res.ok) fail(409, res.reason);
    if (to === "CANCELLED") await db.commercialOrder.update({ where: { id }, data: { cancelReason: reason } });
    return json(plain({ status: res.status, order: await loadOrderDetail(id) }));
  });
}
