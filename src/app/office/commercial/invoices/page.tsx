// The invoice register. A server page that gates on "view" and renders the
// client register; the layout supplies the Shell.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { InvoiceRegister } from "@/components/commercial/invoices/InvoiceRegister";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoices | Commercial | Pacific ERP" };

export default async function CommercialInvoicesPage() {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/invoices");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Invoices</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Every DTA (domestic, with GST) and export invoice raised from a Commercial order. An invoice is drafted from the order&apos;s Invoice tab, checked here, then issued.
        </p>
      </div>
      <InvoiceRegister />
    </>
  );
}
