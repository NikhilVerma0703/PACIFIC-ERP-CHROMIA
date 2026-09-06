// The customer master. Gates "view" (the dispatch team is sent to its own
// screen) and renders the client list; the write action decides whether the
// "New customer" panel is offered.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { ClientsList } from "@/components/commercial/clients/ClientsList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customers | Commercial | Pacific ERP" };

export default async function CommercialClientsPage() {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/clients");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Customers</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The customer master, shared with International Sales. GSTIN, PAN, customer code and the address blocks that print on
          the proforma, the invoice and the packing list are this module&apos;s own and live beside it.
        </p>
      </div>
      <ClientsList canWrite={g.actions.includes("write")} />
    </>
  );
}
