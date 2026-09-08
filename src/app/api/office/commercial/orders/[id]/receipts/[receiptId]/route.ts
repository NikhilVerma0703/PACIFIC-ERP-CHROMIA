// DELETE /api/office/commercial/orders/[id]/receipts/[receiptId] — take a
// receipt off the order. An "approve" action (the Commercial Manager or an
// admin): removing the only ADVANCE closes dispatch again (answer 2), and a
// figure the bank has already matched should not vanish on a Commercial
// login's mis-click. Logged with the amount and kind so the log still says
// what was there.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { advanceReceived, receiptNote } from "@/lib/commercial/receipts-rules";
import { db, loadOrderWithItems } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; receiptId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("approve");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id, receiptId } = await params;
    if (!id || !receiptId) fail(400, "Missing id");
    await loadOrderWithItems(id);
    // The row is read first only for the log line (amount, kind). The delete
    // itself is a filtered deleteMany, not delete-by-id: two managers clicking
    // the same row would otherwise have the second throw P2025 (a 500) after
    // the first won, and the orderId in the filter keeps a receipt from being
    // removed through another order's URL.
    const row = await db.commercialReceipt.findUnique({ where: { id: receiptId } });
    if (!row || row.orderId !== id) fail(404, "Receipt not found on this order");
    const del = await db.commercialReceipt.deleteMany({ where: { id: receiptId, orderId: id } });
    if (del.count === 0) fail(404, "Receipt not found on this order");
    const gone = plain<{ kind: string; amount: number; currency: string; receivedAt: string | null; mode: string | null; reference: string | null }>(row);
    // Logged only for the delete that actually happened: the loser of a race
    // 404s above and writes nothing, so the log carries one "deleted" per row.
    await logOrderEvent(id, "receipt_deleted", {
      note: receiptNote(gone, "deleted"),
      by: g.user,
      payload: { receiptId, kind: gone.kind, amount: gone.amount, currency: gone.currency, receivedAt: gone.receivedAt, mode: gone.mode, reference: gone.reference },
    });
    const items = await db.commercialReceipt.findMany({ where: { orderId: id }, orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }] });
    return json(plain({ ok: true, deleted: receiptId, items, advanceReceived: advanceReceived(items) }));
  });
}
