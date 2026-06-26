// Fabrication access model. Fabrication is a DEPARTMENT (branch === "FABRICATION"),
// and a user's fab "tier" is derived from their normal role rank — so there is ONE
// role hierarchy, not a parallel fabRole field. Admins span every department.
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";

export type FabTier = "EMPLOYEE" | "SUPERVISOR" | "MANAGER" | "ADMIN";
const TIER_RANK: Record<FabTier, number> = { EMPLOYEE: 1, SUPERVISOR: 2, MANAGER: 3, ADMIN: 4 };

/** The fabrication tier for a user (from branch + role rank), or null if not fab staff. */
export function fabTierOf(user: unknown): FabTier | null {
  if (!user) return null;
  const u = user as { role?: string | null; branch?: string | null };
  const role = String(u.role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN";            // admins span all departments
  if (String(u.branch ?? "") !== "FABRICATION") return null;
  const r = rankOf(role);
  if (r >= ROLE_RANK.LINE_MANAGER) return "MANAGER";
  if (r >= ROLE_RANK.INCHARGE) return "SUPERVISOR";
  if (r >= ROLE_RANK.OPERATOR) return "EMPLOYEE";
  return null;
}

export interface FabGate {
  ok: boolean;
  status: number;                                  // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
  tier: FabTier | null;
}

/** Server gate for fabrication endpoints/pages. Revalidates the session (active +
 * sessionVersion via currentUser), confirms fabrication membership, and enforces a
 * minimum tier. Put at the top of every /api/fab route. */
export async function fabGate(min: FabTier = "EMPLOYEE"): Promise<FabGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null, tier: null };
  const tier = fabTierOf(user);
  if (!tier) return { ok: false, status: 403, user, tier: null };
  if (TIER_RANK[tier] < TIER_RANK[min]) return { ok: false, status: 403, user, tier };
  return { ok: true, status: 200, user, tier };
}
