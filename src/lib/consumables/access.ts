// Consumables access model (mirrors lib/fab/access.ts). Consumables is a
// CAPABILITY, not a department: Admin, Store, Line Manager and Incharge can
// use it; operators and office-only roles (Sales/Commercial/Finance/Accounts)
// cannot. Writes (add consumption / inventory / film rolls) need WRITE tier.
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";

export type ConsumablesTier = "VIEW" | "WRITE" | "ADMIN";
const TIER_RANK: Record<ConsumablesTier, number> = { VIEW: 1, WRITE: 2, ADMIN: 3 };
const ALLOWED = new Set(["ADMIN", "STORE", "LINE_MANAGER", "INCHARGE"]);

/** The consumables tier for a user, or null if they can't see the section. */
export function consumablesTierOf(user: unknown): ConsumablesTier | null {
  if (!user) return null;
  const u = user as { role?: string | null };
  const role = String(u.role ?? "");
  if (!ALLOWED.has(role)) return null;
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN";
  return "WRITE"; // Store/Incharge/Line Manager both see and log
}

export interface ConsumablesGate {
  ok: boolean;
  status: number;                                  // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
  tier: ConsumablesTier | null;
}

/** Server gate for consumables endpoints/pages. Revalidates the session
 * (active + sessionVersion via currentUser) and enforces a minimum tier.
 * Put at the top of every /api/consumables route. */
export async function consumablesGate(min: ConsumablesTier = "VIEW"): Promise<ConsumablesGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null, tier: null };
  const tier = consumablesTierOf(user);
  if (!tier) return { ok: false, status: 403, user, tier: null };
  if (TIER_RANK[tier] < TIER_RANK[min]) return { ok: false, status: 403, user, tier };
  return { ok: true, status: 200, user, tier };
}

/** Nav/page visibility helper. */
export async function canAccessConsumables(): Promise<boolean> {
  return consumablesTierOf(await currentUser()) !== null;
}
