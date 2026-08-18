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
export type RoleName = "OPERATOR" | "INCHARGE" | "LINE_MANAGER" | "ADMIN" | "FINANCE" | "ACCOUNTS" | "SALES" | "COMMERCIAL" | "STORE" | "MAINTENANCE" | "ROBO";

// FINANCE and ACCOUNTS are flat office roles directly under ADMIN (rank 2:
// they may edit office tables, but user management stays admin-only in Office).
export const ROLE_RANK: Record<string, number> = { OPERATOR: 1, STORE: 1, MAINTENANCE: 1, SALES: 1, COMMERCIAL: 1, ROBO: 1, INCHARGE: 2, FINANCE: 2, ACCOUNTS: 2, LINE_MANAGER: 3, ADMIN: 4 };

export function rankOf(role?: string | null): number { return ROLE_RANK[String(role ?? "")] ?? 0; }
