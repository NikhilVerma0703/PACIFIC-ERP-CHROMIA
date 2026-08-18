// Chromia access tiers — pure, import-free apart from the role-rank table.
//
// Alias-free (and importing `../roles.ts` with an explicit extension) for the
// same reason lib/fab/routing.ts is: `node --test` resolves neither the `@/`
// alias nor next-auth, so the logic that decides who may open the module has to
// live somewhere a test can import. tests/chromiaAccess.test.ts is that test.
//
// The module is gated exactly like Robo: ONE dedicated shop-floor role owns it,
// and admins span every department. The standalone app shipped seven roles of
// its own (ADMIN, PRODUCTION_MANAGER, SUPERVISOR, OPERATOR, QUALITY_INSPECTOR,
// STORE_KEEPER, VIEWER); those are not roles in this ERP and are NOT added to
// the Role enum — they collapse onto the two tiers below, which is all the
// module's screens actually distinguish.
import { rankOf, ROLE_RANK } from "../roles.ts";

export type ChromiaTier = "OPERATOR" | "ADMIN";

export const CHROMIA_TIER_RANK: Record<ChromiaTier, number> = { OPERATOR: 1, ADMIN: 2 };

/** The Chromia tier for a user, or null if the module is not theirs to open. */
export function chromiaTierOf(user: unknown): ChromiaTier | null {
  if (!user) return null;
  const role = String((user as { role?: string | null }).role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN"; // admins span every department
  if (role === "CHROMIA") return "OPERATOR";
  return null;
}

/** Destructive or history-rewriting actions (delete a slab, import a register). */
export function chromiaCanManage(user: unknown): boolean {
  return chromiaTierOf(user) === "ADMIN";
}
