// Chromia access model. Chromia is a DEPARTMENT (branch === "CHROMIA"), and a
// user's chromia "tier" is derived from their normal role rank — the exact
// shape of lib/fab/access.ts, because that is how this ERP already expresses
// "same ranks, different department": ONE role hierarchy (OPERATOR / INCHARGE
// / LINE_MANAGER), a branch value, and department display labels
// (CHROMIA_ROLE_LABEL in lib/rbac.ts). Admins span every department.
//
// THE GUARD-GROUP MAPPING — the standalone module shipped SEVEN roles
// (src/constants/roles.ts in CHROMIA_MODULE: ADMIN, PRODUCTION_MANAGER,
// SUPERVISOR, OPERATOR, QUALITY_INSPECTOR, STORE_KEEPER, VIEWER) and four
// guard groups written against them. The ERP deliberately does NOT add those
// seven to its Role enum — the line is starting with three ranks, and a DB
// enum is the most expensive place to park a taxonomy nobody uses yet. The
// module's guard groups map onto ERP ranks like this:
//
//   module group       members (module)                        ERP rule here
//   ---------------    -------------------------------------   -------------------------
//   ADMIN_ROLES        ADMIN                                   tier ADMIN
//   MANAGEMENT_ROLES   ADMIN, PRODUCTION_MANAGER, SUPERVISOR   tier >= SUPERVISOR (rank >= INCHARGE, plus admin)
//   PRODUCTION_ROLES   + OPERATOR                              tier >= EMPLOYEE (any CHROMIA-branch role, plus admin)
//   QUALITY_ROLES      ADMIN, PRODUCTION_MANAGER, QI           tier >= SUPERVISOR for now — see below
//   STORE_ROLES        ADMIN, PRODUCTION_MANAGER, STORE_KEEPER tier >= SUPERVISOR for now — see below
//
// QUALITY_ROLES / STORE_ROLES are the deliberate approximation: the line has
// no dedicated QC inspector or store keeper login yet, so "incharge and
// above" is the honest current answer to "who signs a QC verdict / records a
// dispatch". The module's own constants stay in its ported code untouched, so
// the day the line hires a dedicated inspector, the finer roles get real
// values behind the guards that already exist — no rework here, just a new
// tier or a named role test in the two helpers below.
// The tier mapping itself lives in ./tier — a pure, alias-free module node
// --test can import. It is IMPORTED here rather than restated: this file used
// to carry its own second copy of chromiaTierOf, TIER_RANK and
// CHROMIA_MIN_TIER, which meant the tests exercised one copy while every page
// and route ran the other. That is exactly the drift splitting tier.ts was
// meant to prevent, so there is one definition and this module re-exports it.
import { currentUser } from "@/lib/rbac";
import { chromiaTierOf, CHROMIA_MIN_TIER, CHROMIA_TIER_RANK, type ChromiaTier } from "./tier";

export { chromiaTierOf, CHROMIA_MIN_TIER };
export type { ChromiaTier };

export interface ChromiaGate {
  ok: boolean;
  status: number;                                  // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
  tier: ChromiaTier | null;
}

/** Server gate for chromia endpoints/pages. Revalidates the session (active +
 * sessionVersion via currentUser), confirms Chromia membership, and enforces a
 * minimum tier. Put at the top of every /api/chromia route and every /chromia
 * page — middleware stops the request at the path prefix, this stops a direct
 * render, and each is useless on its own the day the other is edited. */
export async function chromiaGate(min: ChromiaTier = "EMPLOYEE"): Promise<ChromiaGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null, tier: null };
  const tier = chromiaTierOf(user);
  if (!tier) return { ok: false, status: 403, user, tier: null };
  if (CHROMIA_TIER_RANK[tier] < CHROMIA_TIER_RANK[min]) return { ok: false, status: 403, user, tier };
  return { ok: true, status: 200, user, tier };
}
