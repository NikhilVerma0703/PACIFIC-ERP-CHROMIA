// One packing list: crates, slabs, the stuffing header and the two PDFs.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { PackingListEditor } from "@/components/commercial/packing/PackingListEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Packing list | Commercial | Pacific ERP" };

export default async function PackingListPage({ params }: { params: Promise<{ plId: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/packing-lists");
  const { plId } = await params;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Packing list</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          What is in each crate, slab by slab. Measured centimetres and the customer&rsquo;s own numbering print on the measurement list.
        </p>
      </div>
      <PackingListEditor plId={plId} actions={g.actions} />
    </>
  );
}
