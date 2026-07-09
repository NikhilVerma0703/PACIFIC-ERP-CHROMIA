// International Sales session compat — the ported fork code was written against
// next-auth's auth() returning a session whose user carries salesRole /
// salesFactory. In THIS repo access is decided by salesGate (lib/sales/access.ts):
// tier comes from the ONE role hierarchy + branch INTERNATIONAL_SALES, and the
// optional users.sales_role column only refines duties INSIDE the module.
//
// salesAuth() is the drop-in replacement for auth() inside /sales + /api/sales:
//   - returns null unless salesGate passes (session revalidated against the DB,
//     active + sessionVersion, membership enforced) -> every ported route that
//     does `if (!session?.user) 401` is really gated by OUR access model;
//   - fills user.salesRole with the EFFECTIVE duty: ADMIN tier is always
//     SALES_ADMIN; otherwise the users.sales_role text when it's one of the
//     known duties; otherwise a safe default by tier (manager -> REPORTING_MANAGER,
//     member -> SALESPERSON, i.e. own-records-only).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { salesGate, type SalesTier } from "./access";

export type EffectiveSalesRole =
  | "SALESPERSON"
  | "REPORTING_MANAGER"
  | "COMMERCIAL"
  | "ACCOUNTS"
  | "SALES_ADMIN";

const KNOWN_ROLES: readonly string[] = [
  "SALESPERSON",
  "REPORTING_MANAGER",
  "COMMERCIAL",
  "ACCOUNTS",
  "SALES_ADMIN",
];

function effectiveDuty(tier: SalesTier, dbRole: string | null): EffectiveSalesRole {
  if (tier === "ADMIN") return "SALES_ADMIN";
  if (dbRole && KNOWN_ROLES.includes(dbRole)) return dbRole as EffectiveSalesRole;
  return tier === "MANAGER" ? "REPORTING_MANAGER" : "SALESPERSON";
}

/** Effective duty for nav/visibility (Shell) — same rules as salesAuth, but a
 * single-column read that never throws (0020 unapplied / stale client -> tier
 * default). */
export async function salesDutyFor(userId: string, tier: SalesTier): Promise<EffectiveSalesRole> {
  if (tier === "ADMIN") return "SALES_ADMIN";
  let dbRole: string | null = null;
  try {
    const row: any = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { salesRole: true },
    });
    dbRole = row?.salesRole ?? null;
  } catch {
    /* fall back to tier default */
  }
  return effectiveDuty(tier, dbRole);
}

export interface SalesSessionUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string; // ERP role (OPERATOR … ADMIN) — kept for the fork's `mainRole` checks
  branch: string | null;
  tier: SalesTier;
  salesRole: EffectiveSalesRole;
  salesFactory: string | null; // QUARTZ | GRANITE | null = both
}

export interface SalesSession {
  user: SalesSessionUser;
}

/** auth() drop-in for the International Sales module (see header). */
export const salesAuth = cache(async (): Promise<SalesSession | null> => {
  const gate = await salesGate();
  if (!gate.ok || !gate.user || !gate.tier) return null;
  const u = gate.user as {
    id?: string;
    name?: string | null;
    email?: string | null;
    role?: string | null;
    branch?: string | null;
  };
  const id = String(u.id ?? "");
  if (!id) return null;

  let name = u.name ?? null;
  let email = u.email ?? null;
  let dbSalesRole: string | null = null;
  let salesFactory: string | null = null;
  try {
    const row: any = await (prisma as any).user.findUnique({
      where: { id },
      select: { name: true, email: true, salesRole: true, salesFactory: true },
    });
    if (row) {
      name = row.name ?? name;
      email = row.email ?? email;
      dbSalesRole = row.salesRole ?? null;
      salesFactory = row.salesFactory ?? null;
    }
  } catch {
    /* sales columns not migrated yet (scripts/0020) — fall back to tier defaults */
  }

  const salesRole = effectiveDuty(gate.tier, dbSalesRole);

  return {
    user: {
      id,
      name,
      email,
      role: String(u.role ?? ""),
      branch: (u.branch as string | null) ?? null,
      tier: gate.tier,
      salesRole,
      salesFactory,
    },
  };
});
