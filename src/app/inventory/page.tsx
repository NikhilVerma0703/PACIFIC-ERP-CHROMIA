import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canAccessInventory, SUMMARY_ONLY_ROLES, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { isAdmin, currentRole } from "@/lib/rbac";
import { InventoryDashboard } from "@/components/inventory/InventoryDashboard";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  if (!(await canAccessInventory())) redirect("/");
  const admin = await isAdmin();
  const role = await currentRole();
  const summaryOnly = SUMMARY_ONLY_ROLES.has(role);
  const slabsOnly = SLABS_ONLY_ROLES.has(role);
  return (
    <Shell>
      <InventoryDashboard admin={admin} summaryOnly={summaryOnly} slabsOnly={slabsOnly} />
    </Shell>
  );
}
