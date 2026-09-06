// One packing list on the floor: fit or unfit, slab by slab.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { DispatchCheck } from "@/components/commercial/dispatch/DispatchCheck";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dispatch check | Commercial | Pacific ERP" };

export default async function DispatchCheckListPage({ params }: { params: Promise<{ plId: string }> }) {
  const g = await commercialGate("verify");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial/dispatch-check");
  const { plId } = await params;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Check the slabs</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Mark every slab fit or unfit. An unfit slab needs a reason; it goes back to stock and the list returns to Commercial.
        </p>
      </div>
      <DispatchCheck plId={plId} />
    </>
  );
}
