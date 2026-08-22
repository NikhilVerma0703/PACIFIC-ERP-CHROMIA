import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
import { RateCardEditor } from "@/components/office/RateCardEditor";
import { CostingDashboard } from "@/components/office/CostingDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Batch Costing | Pacific ERP" };

export default async function CostingPage() {
  // Middleware already gates /office/costing to admins; re-checked here
  // because a UI condition is not an authorisation. This screen prices the
  // plant's whole cost base - supplier rates, manpower, electricity - which
  // is exactly what a rate negotiation would love to see leaked.
  const u = await currentUser();
  const role = (u as { role?: string } | null)?.role ?? "";
  if (role !== "ADMIN") redirect("/");

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Batch costing</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Pick a batch, enter what it was bought at, and read its sheet. Quantities come from
          the mixer; prices come from you. Nothing is stored — the batch re-costs on every load.
        </p>
      </div>
      <div className="space-y-5">
        {/* Batch work first: picking and pricing a batch is what this page is
            opened FOR. The plant-wide rates change perhaps monthly, and their
            full table used to open above this and push the batch picker below
            the fold - it now folds to one line when complete and sits after
            the thing people actually came to do. */}
        <CostingDashboard />
        <RateCardEditor />
      </div>
    </Shell>
  );
}
