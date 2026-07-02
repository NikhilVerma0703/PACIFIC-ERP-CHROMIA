// Finished-goods inventory access: Admin, production management (Line Manager,
// Incharge) and office Commercial staff (Finance, Accounts) — the Commercial /
// QC / Management users of the inventory module. STORE (RM store) is excluded;
// add it to INVENTORY_ROLES if the Store Incharge should see finished goods.
// Mirrors the fabGate shape.
import { currentUser, currentRole } from "@/lib/rbac";

export const INVENTORY_ROLES = new Set(["ADMIN", "LINE_MANAGER", "INCHARGE", "FINANCE", "ACCOUNTS"]);

export async function canAccessInventory(): Promise<boolean> {
  return INVENTORY_ROLES.has(await currentRole());
}

export interface InventoryGate {
  ok: boolean;
  status: number; // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
}

/** Server gate for /api/inventory routes + inventory pages. Revalidates the
 * session (active + sessionVersion via currentUser) and enforces the role set. */
export async function inventoryGate(): Promise<InventoryGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = String((user as any).role ?? "");
  if (!INVENTORY_ROLES.has(role)) return { ok: false, status: 403, user };
  return { ok: true, status: 200, user };
}
