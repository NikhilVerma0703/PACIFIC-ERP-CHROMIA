// POST /api/office/commercial/invoices/[invId]/cancel — { reason }
//
// A cancelled invoice is kept, not deleted: the number was taken from the
// counter and the register has to show what happened to it. The reason is
// required, and it lands on the order's log.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { canCancelInvoice } from "@/lib/commercial/invoice-rules";
import { db, INVOICE_INCLUDE, invoiceIdOf, loadInvoice } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    const row = await loadInvoice(id);
    if (!canCancelInvoice(String(row.status))) fail(409, `This invoice is already ${String(row.status).toLowerCase()}`);
    const body = await readBody<Record<string, unknown>>(req);
    const reason = str(body.reason);
    if (!reason) fail(400, "Say why the invoice is being cancelled");

    await db.commercialInvoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    await logOrderEvent(String(row.orderId), "invoice_cancelled", {
      note: `${row.kind} invoice ${row.number} cancelled — ${reason}`,
      by: g.user,
      payload: { invoiceId: id, number: row.number, reason },
    });
    const after = await db.commercialInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    return json(plain(after));
  });
}
