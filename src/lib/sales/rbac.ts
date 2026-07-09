// Role guards for the International Sales module — REBASED onto our salesGate.
// The fork's requireSalesRole trusted session.user.salesRole from the JWT and
// let platform ADMINs bypass; here everything flows through salesAuth (which
// wraps salesGate: DB-revalidated session + branch membership + tier), and the
// effective salesRole it computes. The fork's production-manager role is
// retired — those duties belong to module admins (SALES_ADMIN / ERP ADMIN).
import { salesAuth, type SalesSession, type EffectiveSalesRole } from "./session";

export type SalesRole = EffectiveSalesRole;

/** Throws unless the caller may access the module AND has one of `roles`
 * (module admins always pass). Returns the sales session. */
export async function requireSalesRole(...roles: SalesRole[]): Promise<SalesSession> {
  const session = await salesAuth();
  if (!session) throw new Error("Forbidden");
  const { salesRole, tier } = session.user;
  if (tier === "ADMIN" || salesRole === "SALES_ADMIN" || roles.includes(salesRole)) {
    return session;
  }
  throw new Error("Forbidden");
}

/** The caller's effective sales duty, or null when they can't see the module. */
export async function getSalesRole(): Promise<SalesRole | null> {
  return (await salesAuth())?.user.salesRole ?? null;
}
