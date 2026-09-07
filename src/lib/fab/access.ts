// Fabrication access model. Fabrication is a DEPARTMENT (branch === "FABRICATION"),
// and a user's fab "tier" is derived from their normal role rank — so there is ONE
// role hierarchy, not a parallel fabRole field. Admins span every department.
//
// THE RULE ITSELF LIVES IN ./tier.ts — imported and re-exported here rather than
// copied, so every existing `from "@/lib/fab/access"` import keeps working
// unchanged. The same move rbac.ts made for roles.ts and sampling/access.ts made
// for actions.ts, and for the same reason: this file reaches the Prisma client
// through currentUser(), so `node --test` cannot import it, and an access rule
// that cannot be unit-tested ends up being tested by deploying it.
//
// It was worth doing NOW because four of these gates just widened from
// SUPERVISOR to EMPLOYEE to put the slab board in the cutter's hands. What keeps
// that safe is the branch check inside fabTierOf, not the tier floor — and that
// is a sentence better held by a test than by a comment. See tests/
// fabCutterAccess.test.ts.
import { currentUser } from "@/lib/rbac";
import { fabTierOf, TIER_RANK, type FabTier } from "./tier";

export { fabTierOf, TIER_RANK };
export type { FabTier };

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
