import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canAccessInventory } from "@/lib/inventory/access";
import { isAdmin } from "@/lib/rbac";
import { InventoryDashboard } from "@/components/inventory/InventoryDashboard";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  if (!(await canAccessInventory())) redirect("/");
  const admin = await isAdmin();
  return (
    <Shell>
      <InventoryDashboard admin={admin} />
    </Shell>
  );
}
