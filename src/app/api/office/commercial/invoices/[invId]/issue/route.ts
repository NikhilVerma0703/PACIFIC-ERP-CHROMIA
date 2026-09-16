// POST /api/office/commercial/invoices/[invId]/issue — a draft becomes real.
//
// Answer 10: the final invoice waits for the checklist's approval. The gate
// itself lives in stages.canEnter (INVOICED needs `approved`), which
// order-stage loads the fact for; this route asks the same question FIRST so
// the refusal comes back as a 409 naming who can approve, and no invoice is
// stamped ISSUED on an order that then refuses to move. Stamps issuedAt, moves
// the order to INVOICED (forward only — bumpOrder, so an order already past it
// is not dragged back), and logs invoice_issued. After this the invoice is
// read-only; a mistake is cancelled with a reason, never quietly edited.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import { isTerminal, stageOf } from "@/lib/commercial/stages";
import { refuseIssue, refuseIssueUnapproved, refuseIssueSellerChanged } from "@/lib/commercial/invoice-rules";
import { loadSettings } from "@/lib/commercial/settings";
import { db, INVOICE_INCLUDE, invoiceIdOf, loadInvoice, snapshotOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("write", "invoices");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    const row = await loadInvoice(id);
    const refusal = refuseIssue({ status: String(row.status), snapshot: row.snapshot as { lines?: unknown } | null });
    if (refusal) fail(409, refusal);
    snapshotOf(row);                        // a snapshot-less row cannot be printed, so it cannot be issued

    const orderId = String(row.orderId);
    const order = await db.commercialOrder.findUnique({ where: { id: orderId }, select: { status: true, approvedAt: true, sellerKey: true } });
    if (!order) fail(404, "Order not found");
    // WHO SELLS IS FROZEN AT DRAFT, AND THE ORDER CAN STILL MOVE UNDER IT.
    // refuseInvoiceForSeller runs when the draft is CREATED; nothing re-asked
    // at issue, and the selling company on the order stays editable at any
    // status. Before invoices knew about sellers that was harmless. Now the
    // window between drafting and issuing is a real one: draft under Monolith,
    // correct the order back to Pacific, press Issue, and an ISSUED invoice
    // goes out numbered MSI-1 printing MONOLITH SURFACES INC on a Pacific
    // shipment — which the export document set then refuses to accompany,
    // because the snapshot still says Monolith. The mirror is worse: an Indian
    // GST tax invoice issued on an order the ERP records as sold by a US
    // company.
    //
    // REFUSED RATHER THAN RE-FROZEN. Re-resolving the identity here would
    // rewrite a document somebody has already read on screen, and the number
    // has already been drawn from one company's series. Cancel and raise it
    // again is the honest repair, and it is what the message says to do.
    const drift = refuseIssueSellerChanged(snapshotOf(row), order.sellerKey, await loadSettings());
    if (drift) fail(409, drift);
    if (isTerminal(String(order.status))) fail(409, `A ${stageOf(String(order.status))?.label.toLowerCase() ?? order.status} order cannot be invoiced`);
    const unapproved = refuseIssueUnapproved(order);
    if (unapproved) fail(409, unapproved);

    const issuedAt = new Date();
    await db.commercialInvoice.update({ where: { id }, data: { status: "ISSUED", issuedAt } });
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
