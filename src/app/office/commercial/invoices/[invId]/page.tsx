// One invoice. Gates "view"; the client component hides the write controls
// when the login has no "write" action.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { InvoiceDetail } from "@/components/commercial/invoices/InvoiceDetail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice | Commercial | Pacific ERP" };

export default async function CommercialInvoicePage({ params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/invoices");
  const { invId } = await params;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Invoice</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          What the PDF prints, frozen at the moment the invoice was drafted. A draft can still be changed; an issued invoice can only be cancelled.
        </p>
      </div>
      <InvoiceDetail invoiceId={invId} actions={g.actions} />
    </>
  );
}
