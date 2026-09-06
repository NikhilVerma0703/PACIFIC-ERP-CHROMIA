// Commercial overview. A server page that gates on "view" (the dispatch team
// is sent to its own screen) and renders the client dashboard.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { CommercialDashboard } from "@/components/commercial/CommercialDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commercial | Pacific ERP" };

export default async function CommercialHome() {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Commercial</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Enquiries, internal sales orders, stock holds, proforma invoices, packing lists, the dispatch check, invoices and delivery challans.
        </p>
      </div>
      <CommercialDashboard actions={g.actions} />
    </>
  );
}
