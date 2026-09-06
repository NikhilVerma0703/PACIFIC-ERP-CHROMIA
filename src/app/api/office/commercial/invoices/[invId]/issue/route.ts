// POST /api/office/commercial/invoices/[invId]/issue — a draft becomes real.
// Stamps issuedAt, moves the order to INVOICED (forward only — bumpOrder), and
// logs invoice_issued. After this the invoice is read-only; a mistake is
// cancelled with a reason, never quietly edited.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import { refuseIssue } from "@/lib/commercial/invoice-rules";
import { db, INVOICE_INCLUDE, invoiceIdOf, loadInvoice, snapshotOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    const row = await loadInvoice(id);
    const refusal = refuseIssue({ status: String(row.status), snapshot: row.snapshot as { lines?: unknown } | null });
    if (refusal) fail(409, refusal);
    snapshotOf(row);                        // a snapshot-less row cannot be printed, so it cannot be issued

    const issuedAt = new Date();
    await db.commercialInvoice.update({ where: { id }, data: { status: "ISSUED", issuedAt } });
    const orderId = String(row.orderId);
    await logOrderEvent(orderId, "invoice_issued", {
      note: `${row.kind} invoice ${row.number} issued`,
      by: g.user,
      payload: { invoiceId: id, number: row.number, kind: row.kind, grandTotal: row.grandTotal },
    });
    const moved = await bumpOrder(orderId, "INVOICED", g.user, `Invoice ${row.number} issued`);

    const after = await db.commercialInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    return json(plain({ invoice: after, orderStatus: moved }));
  });
}
