// International Sales access model (mirrors lib/fab/access.ts). International
// Sales is a DEPARTMENT (branch === "INTERNATIONAL_SALES"): its users live in
// /sales and see nothing else (enforced by the middleware); Admins span every
// department. Tier is derived from the ONE role hierarchy — the optional
// users.sales_role column only refines duties INSIDE the module (SP vs
// manager), it never widens ERP access.
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";

export type SalesTier = "MEMBER" | "MANAGER" | "ADMIN";
const TIER_RANK: Record<SalesTier, number> = { MEMBER: 1, MANAGER: 2, ADMIN: 3 };

/** The International Sales tier for a user, or null if they can't see the module. */
export function salesTierOf(user: unknown): SalesTier | null {
  if (!user) return null;
  const u = user as { role?: string | null; branch?: string | null };
  const role = String(u.role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN"; // admins span every department
  if (String(u.branch ?? "") !== "INTERNATIONAL_SALES") return null;
  return rankOf(role) >= ROLE_RANK.LINE_MANAGER ? "MANAGER" : "MEMBER";
}

export interface SalesGate {
  ok: boolean;
  status: number; // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
  tier: SalesTier | null;
}

/** Server gate for International Sales endpoints/pages. Revalidates the
 * session (active + sessionVersion via currentUser), confirms membership and
 * enforces a minimum tier. Put at the top of every /api/sales route. */
export async function salesGate(min: SalesTier = "MEMBER"): Promise<SalesGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null, tier: null };
  const tier = salesTierOf(user);
  if (!tier) return { ok: false, status: 403, user, tier: null };
  if (TIER_RANK[tier] < TIER_RANK[min]) return { ok: false, status: 403, user, tier };
  return { ok: true, status: 200, user, tier };
}

/** Nav/page visibility helper. */
export async function canAccessSales(): Promise<boolean> {
  return salesTierOf(await currentUser()) !== null;
}
