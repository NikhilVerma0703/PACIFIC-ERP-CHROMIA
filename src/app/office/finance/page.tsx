import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
import { FinanceBills } from "@/components/office/FinanceBills";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bill Automation | Pacific ERP" };

export default async function FinancePage() {
  // Middleware already gates this route; the in-page check covers direct
  // renders the same way other office pages do.
  const u = await currentUser();
  const role = (u as { role?: string } | null)?.role ?? "";
  const branch = ((u as { branch?: string } | null)?.branch as string | undefined) ?? "SHOP_FLOOR";
  const ok = role === "ADMIN" || (branch === "OFFICE" && (role === "FINANCE" || role === "ACCOUNTS"));
  if (!ok) redirect("/");

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Bill automation</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Reimbursements: pick the person, upload their stack of bills, confirm three fields per bill,
          and export one Tally-importable XML per batch. The engine reads, classifies and learns from
          every correction — no bill reaches Tally without a human confirming it.
        </p>
      </div>
      <FinanceBills />
    </Shell>
  );
}
