// The challan book.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { ChallanList } from "@/components/commercial/challans/ChallanList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delivery challans | Commercial | Pacific ERP" };

export default async function CommercialChallansPage() {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/challans");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Delivery challans</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Goods moving that are not a sale: samples, display stands, material to the sister company. Each challan prints on four pages — one copy for the buyer, the transporter, central excise and ourselves.
        </p>
      </div>
      <ChallanList />
    </>
  );
}
