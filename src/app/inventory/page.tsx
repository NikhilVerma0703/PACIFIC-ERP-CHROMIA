import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canAccessInventory, SUMMARY_ONLY_ROLES } from "@/lib/inventory/access";
import { isAdmin, currentRole } from "@/lib/rbac";
import { InventoryDashboard } from "@/components/inventory/InventoryDashboard";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  if (!(await canAccessInventory())) redirect("/");
  const admin = await isAdmin();
  const summaryOnly = SUMMARY_ONLY_ROLES.has(await currentRole());
  return (
    <Shell>
      <InventoryDashboard admin={admin} summaryOnly={summaryOnly} />
    </Shell>
  );
}
