// GET /api/office/commercial/invoices/[invId]/pdf — the printed invoice.
//
// DTA renders the JB Homes layout, EXPORT the CIOT one, both from the frozen
// snapshot so a reprint years later is byte-for-byte what the customer got.
// Inline, so the browser shows it in a tab rather than downloading it.
//
// AND SINCE 2026-09-15 THERE IS A THIRD: an invoice frozen under a seller that
// is not an Indian exporter renders the seller layout, which is the format the
// owner signed off that day. The question is asked of the SNAPSHOT, never of
// today's settings or of the order — so an invoice issued before any of this
// existed carries no seller, answers false, and reaches exactly the renderer
// it always did. That is what keeps the byte-for-byte promise above true.
import { NextResponse } from "next/server";
import { commercialGate } from "@/lib/commercial/access";
import { deny, handle } from "@/lib/commercial/http";
import { invoiceFilename } from "@/lib/commercial/invoice-rules";
import { generateDtaInvoicePdf } from "@/lib/commercial/pdf/dta-invoice";
import { generateExportInvoicePdf } from "@/lib/commercial/pdf/export-invoice";
import { generateSellerInvoicePdf } from "@/lib/commercial/pdf/seller-invoice";
import { printsSellerInvoice } from "@/lib/commercial/seller-invoice-rules";
import { invoiceIdOf, loadInvoice, snapshotOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("view", "invoices");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    const row = await loadInvoice(id);
    const snapshot = snapshotOf(row);
    const kind = String(row.kind) === "DTA" ? "DTA" : "EXPORT";
    const buf = printsSellerInvoice(snapshot)
      ? await generateSellerInvoicePdf(snapshot)
      : kind === "DTA"
        ? await generateDtaInvoicePdf(snapshot)
        : await generateExportInvoicePdf(snapshot);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoiceFilename(String(row.number))}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
