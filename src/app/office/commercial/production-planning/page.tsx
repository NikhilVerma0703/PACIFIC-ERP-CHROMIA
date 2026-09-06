// /office/commercial/production-planning — the shortfall queue.
//
// Gates "view" and passes the user's actions down, so anyone in Commercial can
// SEE what the plant has been asked for while only a login with "plan" can
// re-order it, schedule it or mark it produced (DESIGN.md §3). Gating "plan"
// here instead would hide the queue from the people who raise the requests.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { ProductionPlanningBoard } from "@/components/commercial/production/ProductionPlanningBoard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Production planning | Commercial" };

export default async function ProductionPlanningPage() {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/production-planning");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Production planning</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          What Commercial is short of, in the order the plant should make it. Drag a row (or use ▲▼) to change the order,
          type the cleaning note for the changeover, and mark a request produced once the slabs are in finished goods.
        </p>
      </div>
      <ProductionPlanningBoard actions={g.actions} />
    </>
  );
}
