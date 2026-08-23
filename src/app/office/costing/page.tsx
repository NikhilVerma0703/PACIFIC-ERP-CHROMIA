import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
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
      {/* The dashboard carries the title, the picker, one folded line of
          inputs (sign-off, materials, batch data, plant-wide rates) and the
          document. One component, so the page itself has no sections to stack. */}
      <CostingDashboard />
    </Shell>
  );
}
