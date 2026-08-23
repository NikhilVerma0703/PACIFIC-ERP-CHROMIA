// The ONE role-rank table, in a module with no imports at all.
//
// Split out of lib/rbac.ts (which re-exports it, so nothing else changed) for
// one reason: rbac.ts imports @/auth, and node --test resolves neither the
// alias nor next-auth — so any pure logic living there is untestable, the
// same reason fab/routing.ts is alias-free. Pure per-module logic (e.g. a
// module's access-tier mapping) and its tests both import THIS module, so the
// tests exercise the real table rather than a copy that drifts.
//
// Role hierarchy (low -> high). Kept as string-typed so this compiles even
// before `prisma generate` refreshes the @prisma/client enum.
export type RoleName = "OPERATOR" | "INCHARGE" | "LINE_MANAGER" | "ADMIN" | "FINANCE" | "ACCOUNTS" | "SALES" | "COMMERCIAL" | "STORE" | "MAINTENANCE" | "ROBO" | "CHROMIA";

// FINANCE and ACCOUNTS are flat office roles directly under ADMIN (rank 2:
// they may edit office tables, but user management stays admin-only in Office).
export const ROLE_RANK: Record<string, number> = { OPERATOR: 1, STORE: 1, MAINTENANCE: 1, SALES: 1, COMMERCIAL: 1, ROBO: 1, CHROMIA: 1, INCHARGE: 2, FINANCE: 2, ACCOUNTS: 2, LINE_MANAGER: 3, ADMIN: 4 };

export function rankOf(role?: string | null): number { return ROLE_RANK[String(role ?? "")] ?? 0; }

// Station and role LABELS, here with the rank table for the same two reasons:
// node --test can reach them, and a client component can import them without
// dragging lib/rbac.ts's auth chain into the browser bundle (see rbac.ts).
export type StationName =
  | "PRESS" | "OVEN" | "JOT" | "MIXER" | "KREOS"
  | "DISTRIBUTOR" | "SILO" | "POLISH_QC" | "POLISH_ENTRY" | "CUTTING";

export const STATIONS: StationName[] = ["PRESS", "OVEN", "JOT", "MIXER", "KREOS", "DISTRIBUTOR", "SILO", "POLISH_QC", "POLISH_ENTRY", "CUTTING"];
export const STATION_LABEL: Record<string, string> = {
  PRESS: "Press", OVEN: "Oven", JOT: "Jot", MIXER: "Mixer", KREOS: "Kreos",
  DISTRIBUTOR: "Distributor", SILO: "Silo", POLISH_QC: "Polish QC", POLISH_ENTRY: "Polish Entry", CUTTING: "Cutting",
};

export const ROLE_LABEL: Record<string, string> = {
  OPERATOR: "Operator", INCHARGE: "Incharge", LINE_MANAGER: "Line Manager", ADMIN: "Administrator",
  FINANCE: "Finance", ACCOUNTS: "Accounts", SALES: "Sales", COMMERCIAL: "Commercial", STORE: "Store Incharge", MAINTENANCE: "Maintenance Manager",
  ROBO: "Robo Operator",
  CHROMIA: "Chromia Operator",
};

/** Fabrication shares the ONE role hierarchy with Shop Floor (LINE_MANAGER /
 * INCHARGE / OPERATOR — see lib/fab/access.ts's fabTierOf: there is no
 * parallel fabRole field), but the generic ROLE_LABEL names ("Line Manager",
 * "Incharge", "Operator") don't read as fabrication-specific anywhere the
 * role is displayed — most visibly in Users & Roles, where an admin picking
 * the Fabrication department couldn't find "Fabrication Manager" /
 * "Fabrication Supervisor" / "Fabrication Machine Operator" by name. This
 * gives the SAME underlying roles department-appropriate display names
 * without introducing a second role system or touching the Role enum/DB. */
export const FAB_ROLE_LABEL: Record<string, string> = {
  LINE_MANAGER: "Fabrication Manager",
  INCHARGE: "Fabrication Supervisor",
  OPERATOR: "Fabrication Machine Operator",
};
/** Role label, department-aware: Fabrication uses its own label map for the
 * roles it shares with Shop Floor; every other branch (and any role with no
 * department-specific name) falls back to the generic ROLE_LABEL. */
export function roleLabelFor(role?: string | null, branch?: string | null): string {
  const r = String(role ?? "");
  if (branch === "FABRICATION" && FAB_ROLE_LABEL[r]) return FAB_ROLE_LABEL[r];
  return ROLE_LABEL[r] ?? r;
}
