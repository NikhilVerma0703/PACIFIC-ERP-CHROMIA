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
          Quantities come from the mixer; prices come from you. Material rates are set on the
          batch that bought them, and manpower, electricity, polishing, packing and the basis
          figures are plant-wide. Nothing is stored: correct a mixer row or change a rate and
          the batch re-costs on the next load. Estimates are flagged, missing rates block
          loudly, and the variance panel shows where two records of the same quantity
          disagree.
        </p>
      </div>
      <div className="space-y-5">
        <RateCardEditor />
        <CostingDashboard />
      </div>
    </Shell>
  );
}
