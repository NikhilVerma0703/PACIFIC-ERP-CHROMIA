/**
 * Server gate for the Chromia module.
 *
 * Same three-layer shape the rest of the ERP uses, and the same reason: the
 * middleware stops a request at the path prefix, this stops a direct render or
 * a fetch that never passed through it, and the nav hides what neither would
 * allow. Each is useless on its own the day one of the others is edited.
 *
 * Put `chromiaGate()` at the top of every /chromia page and every
 * /api/chromia route handler.
 */
import { currentUser } from "@/lib/rbac";
import { chromiaTierOf, chromiaCanManage, CHROMIA_TIER_RANK, type ChromiaTier } from "./tier";

export interface ChromiaGate {
  ok: boolean;
  /** 401 no session · 403 not allowed · 200 ok */
  status: number;
  user: unknown | null;
  tier: ChromiaTier | null;
}

export async function chromiaGate(min: ChromiaTier = "OPERATOR"): Promise<ChromiaGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null, tier: null };
  const tier = chromiaTierOf(user);
  if (!tier) return { ok: false, status: 403, user, tier: null };
  if (CHROMIA_TIER_RANK[tier] < CHROMIA_TIER_RANK[min]) return { ok: false, status: 403, user, tier };
  return { ok: true, status: 200, user, tier };
}

/**
 * Verb-level gate for the destructive actions, enforced INSIDE the handler.
 * Middleware matches on path prefix only and cannot tell a DELETE from a GET,
 * and hiding a button is a courtesy to the operator, not a control — the
 * endpoint is reachable with a fetch from the same signed-in session.
 */
export async function canManageChromia(): Promise<boolean> {
  return chromiaCanManage(await currentUser());
}

export { chromiaTierOf, chromiaCanManage, CHROMIA_TIER_RANK };
export type { ChromiaTier };
