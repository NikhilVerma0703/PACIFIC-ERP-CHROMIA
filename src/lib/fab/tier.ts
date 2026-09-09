// WHO IS WHO IN FABRICATION — the rule alone, with nothing hanging off it.
//
// This is lifted out of ./access.ts unchanged. That file has to import
// @/lib/rbac for currentUser(), which reaches @/auth and from there the Prisma
// client, so nothing in it can be imported by `node --test` — the runner throws
// "@prisma/client did not initialize yet" before a single assertion runs.
//
// The rule underneath is pure. It reads a role and a branch off an object and
// answers with a tier; it touches no session, no request and no database. So it
// lives here, imported and re-exported by access.ts, and the tests exercise the
// same function the gate runs rather than a copy of it that has to be kept in
// step by hand.
//
// THIS IS THE LESSON lib/roles.ts AND lib/sampling/actions.ts BOTH RECORD, and
// the reason it is worth repeating a third time: an access rule that cannot be
// unit-tested gets tested by deploying it.
//
// IMPORTS ONLY ../roles.ts, which itself imports nothing — the same standing
// permission actions.ts has.
//
// ─────────────────────────────── WHY THE LADDER IS ONE LADDER ───────────────
// A user's fab tier is DERIVED from their ordinary role rank; there is no
// parallel fabRole column. One hierarchy, so a promotion is one edit, and a
// gate expressed as a minimum ("at least SUPERVISOR") cannot disagree with a
// gate expressed as a role.
//
// That shape is what made the cutter's board a four-line change rather than a
// rewrite: widening a gate from SUPERVISOR to EMPLOYEE lets the operator in
// WITHOUT taking it from the supervisor and manager above him, because the
// comparison is >= and not ==.
//
// AND THE BRANCH IS THE REAL DOOR. fabTierOf returns null for anybody outside
// the FABRICATION branch, whatever their role. So "EMPLOYEE" on a fab gate does
// not mean "anybody signed in" — it means a fabrication operator, standing at a
// machine, in this department. That is why the widening above is safe, and it
// is the fact to check before ever widening another one.

import { rankOf, ROLE_RANK } from "../roles.ts";

export type FabTier = "EMPLOYEE" | "SUPERVISOR" | "MANAGER" | "ADMIN";

/** The ladder gates compare on. fabGate(min) admits any tier at or above `min`. */
export const TIER_RANK: Record<FabTier, number> = {
  EMPLOYEE: 1, SUPERVISOR: 2, MANAGER: 3, ADMIN: 4,
};

/** The fabrication tier for a user (from branch + role rank), or null if not
 *  fab staff. Null is the answer that keeps everyone else out — see above. */
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

/** Does this user clear a minimum tier? The comparison every fabGate makes,
 *  written once so a route and a test cannot read it differently. */
export function fabTierMeets(user: unknown, min: FabTier): boolean {
  const tier = fabTierOf(user);
  return tier !== null && TIER_RANK[tier] >= TIER_RANK[min];
}
