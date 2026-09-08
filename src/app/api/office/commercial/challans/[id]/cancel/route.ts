// POST /api/office/commercial/challans/[id]/cancel — { reason }
//
// Cancellation is an admin's or the Commercial Manager's act, as for every
// numbered document the module issues (commercialGate("cancel")). The challan
// is kept, not deleted: the number came from the counter and the book has to
// account for it. The reason goes into notes (the row has no cancel_reason
// column) and onto the order's log when there is an order.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { canCancelChallan } from "@/lib/commercial/challan-rules";
import { db, CHALLAN_INCLUDE, challanIdOf, loadChallan } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("cancel");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await challanIdOf(params);
    const row = await loadChallan(id);
    if (!canCancelChallan(String(row.status))) fail(409, `This challan is already ${String(row.status).toLowerCase()}`);
    const body = await readBody<Record<string, unknown>>(req);
    const reason = str(body.reason);
    if (!reason) fail(400, "Say why the challan is being cancelled");

    const notes = [str(row.notes), `Cancelled: ${reason}`].filter(Boolean).join("\n");
    await db.commercialDeliveryChallan.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), notes } });
    if (row.orderId) {
      await logOrderEvent(String(row.orderId), "challan_cancelled", {
        note: `Delivery challan ${row.number} cancelled — ${reason}`,
        by: g.user,
        payload: { challanId: id, number: row.number, reason },
      });
    }
    const after = await db.commercialDeliveryChallan.findUnique({ where: { id }, include: CHALLAN_INCLUDE });
    return json(plain(after));
  });
}
