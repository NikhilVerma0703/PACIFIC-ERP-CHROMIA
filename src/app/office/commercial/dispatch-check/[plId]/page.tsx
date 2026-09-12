// One packing list on the floor: fit or unfit, slab by slab and piece by piece.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { DispatchCheck } from "@/components/commercial/dispatch/DispatchCheck";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dispatch check | Commercial | Pacific ERP" };

export default async function DispatchCheckListPage({ params }: { params: Promise<{ plId: string }> }) {
  const g = await commercialGate("verify", "dispatchCheck");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial/dispatch-check");
  const { plId } = await params;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Check the crates</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {/* Answer 30: what an unfit slab costs depends on the list. On a
              SUBMITTED list, verifying rejects it — the unfit slabs come off
              and go back to stock. A VERIFIED or FINAL list is what the
              container was stuffed from: nothing comes off it, the slab is
              swapped for a like-for-like one. The old sentence promised the
              first outcome on every list.

              Round four, answer 1: a cut-to-size line is checked here too, and
              an unfit one does NOT go back to stock on any list — it was cut to
              a customer's size and there is nothing to return it to. The
              heading no longer says slabs, because on a cut-to-size list there
              are none. */}
          Mark every line fit or unfit, slabs and cut-to-size pieces alike; an unfit line needs a reason. On a submitted list,
          verifying sends the unfit slabs back to stock and the list back to Commercial — an unfit piece stays on the list to be
          recut. On a verified or final list nothing ships until Commercial swaps a like-for-like slab in.
        </p>
      </div>
      <DispatchCheck plId={plId} />
    </>
  );
}
