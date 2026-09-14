import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canAccessInventory, canWriteInventory, SUMMARY_ONLY_ROLES, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { isAdmin, currentRole, currentUser } from "@/lib/rbac";
import { InventoryDashboard } from "@/components/inventory/InventoryDashboard";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  if (!(await canAccessInventory())) redirect("/");
  const admin = await isAdmin();
  const role = await currentRole();
  const summaryOnly = SUMMARY_ONLY_ROLES.has(role);
  const slabsOnly = SLABS_ONLY_ROLES.has(role);
  // MAY LOOK, MAY NOT TOUCH — the 2026-09-14 view grant (users.fg_view), which
  // chromia@ and gibin@ hold. Asked as `!canWriteInventory(user)` rather than as
  // `hasFgView(user)` on purpose: canWriteInventory IS the rule inventoryGate()
  // runs on every write route, so the controls this hides are exactly the ones
  // the server would refuse, and the two cannot drift apart. It also keeps the
  // grant additive in the way scripts/0083-fg-view-grant.sql insists on — an
  // ACCOUNTS login handed the flag as well still writes, because it still
  // passes the write rule and so is not read-only here.
  //
  // It is true for a SALES login too (Sales writes nothing in this module and
  // never did), which is correct and today invisible: the summary screen that
  // role gets has no control that posts.
  const readOnly = !canWriteInventory(await currentUser());
  return (
    <Shell>
      <InventoryDashboard admin={admin} summaryOnly={summaryOnly} slabsOnly={slabsOnly} readOnly={readOnly} />
    </Shell>
  );
}
