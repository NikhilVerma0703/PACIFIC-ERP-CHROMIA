// One delivery challan.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { ChallanDetail } from "@/components/commercial/challans/ChallanDetail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delivery challan | Commercial | Pacific ERP" };

export default async function CommercialChallanPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/challans");
  const { id } = await params;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Delivery challan</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          A draft can still be changed. Once issued the challan is read-only — cancel it and raise another if it was wrong.
        </p>
      </div>
      <ChallanDetail challanId={id} actions={g.actions} />
    </>
  );
}
