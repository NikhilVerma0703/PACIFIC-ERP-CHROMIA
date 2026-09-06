// The dispatch team's queue. Gates "verify" — this is the one screen a
// verify-only login reaches (access-rules isDispatchCheckPath).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { DispatchQueue } from "@/components/commercial/dispatch/DispatchQueue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dispatch check | Commercial | Pacific ERP" };

export default async function DispatchCheckPage() {
  const g = await commercialGate("verify");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial/dispatch-check");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Dispatch check</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Packing lists waiting to be checked slab by slab before the container is stuffed. Oldest first.
        </p>
      </div>
      <DispatchQueue />
    </>
  );
}
