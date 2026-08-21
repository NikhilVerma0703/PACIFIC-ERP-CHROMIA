"use client";
import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether this login may RECORD anything in Consumables, as opposed to reading
 * it. Maintenance is the first view-only role here (added 2026-08-21), and the
 * write affordances are spread over five components — the action bar, the film
 * roll table, and three inline-edit tables — so a prop would have to be drilled
 * through ConsumablesDashboard into each of them and kept in step forever.
 *
 * This is presentation ONLY. The authority is `consumablesGate("WRITE")` at the
 * top of every mutating route; a view-only login that reaches the endpoint by
 * hand gets a 403 whatever the page rendered. What this prevents is offering a
 * button whose only possible outcome is that 403.
 *
 * The default is FALSE. A component mounted outside the provider hides its
 * write controls rather than showing ones that cannot work — if this is ever
 * wrong it is wrong in the direction of a missing button, not a broken one.
 */
const WriteAccess = createContext(false);

export function WriteAccessProvider({
  canWrite,
  children,
}: {
  canWrite: boolean;
  children: ReactNode;
}) {
  return <WriteAccess.Provider value={canWrite}>{children}</WriteAccess.Provider>;
}

export function useCanWrite(): boolean {
  return useContext(WriteAccess);
}
