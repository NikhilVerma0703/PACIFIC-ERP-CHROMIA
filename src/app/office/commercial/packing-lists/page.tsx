// Every packing list in the module. Gates "view" — the dispatch team has its
// own screen and is sent there rather than shown the whole book.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { PackingLists } from "@/components/commercial/packing/PackingLists";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Packing lists | Commercial | Pacific ERP" };

export default async function PackingListsPage() {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/packing-lists");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Packing lists</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Every list, by stage: being built, waiting for the dispatch check, verified, final, gone.
        </p>
      </div>
      <PackingLists />
    </>
  );
}
