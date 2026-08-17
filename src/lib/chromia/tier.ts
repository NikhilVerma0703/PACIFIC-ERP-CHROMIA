// Chromia tier mapping — the PURE half of lib/chromia/access.ts, split out
// (like fab/routing.ts) so node --test can import it: no auth, no aliases at
// runtime beyond lib/roles.ts, which is itself import-free. The server gate
// (chromiaGate, currentUser) stays in access.ts.
//
// See access.ts for the full guard-group mapping table and its reasoning;
// this file is only the mechanics.
// Explicit .ts extension, as extract.ts does for ./gstin.ts: node's strict ESM
// resolver does not add one, so the extensionless form makes this module
// unimportable from node --test — which is the only reason it exists.
import { rankOf, ROLE_RANK } from "../roles.ts";

export type ChromiaTier = "EMPLOYEE" | "SUPERVISOR" | "MANAGER" | "ADMIN";
export const CHROMIA_TIER_RANK: Record<ChromiaTier, number> = { EMPLOYEE: 1, SUPERVISOR: 2, MANAGER: 3, ADMIN: 4 };

/** The chromia tier for a user (from branch + role rank), or null if not Chromia staff. */
export function chromiaTierOf(user: unknown): ChromiaTier | null {
  if (!user) return null;
  const u = user as { role?: string | null; branch?: string | null };
  const role = String(u.role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN";            // admins span all departments
  if (String(u.branch ?? "") !== "CHROMIA") return null;
  const r = rankOf(role);
  if (r >= ROLE_RANK.LINE_MANAGER) return "MANAGER";
  if (r >= ROLE_RANK.INCHARGE) return "SUPERVISOR";
  if (r >= ROLE_RANK.OPERATOR) return "EMPLOYEE";
  return null;
}

// The module's four guard groups, expressed as minimum tiers. Route handlers
// and actions say chromiaGate(CHROMIA_MIN_TIER.quality) rather than repeating
// the mapping table in access.ts — ONE place to change when QC/store get real
// roles.
export const CHROMIA_MIN_TIER: Record<"management" | "production" | "quality" | "store", ChromiaTier> = {
  management: "SUPERVISOR", // module MANAGEMENT_ROLES (dashboards, masters, imports)
  production: "EMPLOYEE",   // module PRODUCTION_ROLES (stage progress on the floor)
  quality:    "SUPERVISOR", // module QUALITY_ROLES — approximation until a QC role exists
  store:      "SUPERVISOR", // module STORE_ROLES — approximation until a store role exists
};
