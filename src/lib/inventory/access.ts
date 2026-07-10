// Finished-goods inventory access — an OFFICE (Commercial) module. Only office
// staff (Finance, Accounts) and Admins can see it; shop-floor and fabrication
// users never do, mirroring the department separation. Extend OFFICE side by
// adding roles to INVENTORY_ROLES.
import { currentUser } from "@/lib/rbac";

export const INVENTORY_ROLES = new Set(["ADMIN", "FINANCE", "ACCOUNTS"]);
/** Sales: sees the inventory module but ONLY the Stock by Design summary. */
export const SUMMARY_ONLY_ROLES = new Set(["SALES"]);
/** Commercial: sees ONLY the Slabs table; may dispatch (PI + customer + invoice). */
export const SLABS_ONLY_ROLES = new Set(["COMMERCIAL"]);

/** Sync check used by Shell/Nav and the gates: Admin anywhere; otherwise the
 * session must be an Office-branch user with an inventory role. */
export function hasInventoryAccess(role: string, branch: string): boolean {
  if (role === "ADMIN") return true; // admins span every department
  return branch === "OFFICE" && (INVENTORY_ROLES.has(role) || SUMMARY_ONLY_ROLES.has(role) || SLABS_ONLY_ROLES.has(role));
}

export async function canAccessInventory(): Promise<boolean> {
  const user = await currentUser();
  if (!user) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;
  return hasInventoryAccess(String(u.role ?? ""), String(u.branch ?? ""));
}

export interface InventoryGate {
  ok: boolean;
  status: number; // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
}

/** Server gate for /api/inventory routes + inventory pages. Revalidates the
 * session (active + sessionVersion via currentUser) and enforces role+branch. */
export async function inventoryGate(): Promise<InventoryGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;
  if (!hasInventoryAccess(String(u.role ?? ""), String(u.branch ?? ""))) return { ok: false, status: 403, user };
  if (SUMMARY_ONLY_ROLES.has(String(u.role ?? ""))) return { ok: false, status: 403, user }; // Sales: summary API only
  return { ok: true, status: 200, user };
}

/** Gate for the read-only stock summary — inventory roles PLUS Sales. */
export async function summaryGate(): Promise<InventoryGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;
  if (!hasInventoryAccess(String(u.role ?? ""), String(u.branch ?? ""))) return { ok: false, status: 403, user };
  return { ok: true, status: 200, user };
}
