// Where a capped role may go — the single copy, imported by BOTH gates.
//
// WHY THIS FILE EXISTS
// The caps were written out twice, once in auth.config.ts's `authorized`
// callback and once in middleware.ts, and the two drifted. Middleware granted
// the Store Incharge /tables, /consumables and /office/batch-verify;
// auth.config still allowed only /live, /store and /api, and it runs FIRST — so
// the store incharge clicked RM Tables, Consumables or Batch Sign-off and was
// bounced to /live by a rule the other file had already superseded. The screens
// existed, the role was granted them, and they were unreachable for as long as
// the two lists disagreed.
//
// auth.config.ts is edge-safe and Prisma-free, so everything here stays a pure
// function of the pathname. Nothing may import Prisma, `next/headers`, or any
// server-only module into this file.
//
// A cap is a LIST OF WHAT IS REACHABLE, not a list of what is forbidden: a role
// that gains a screen has to be granted it here, which is the behaviour that
// makes a missing entry a dead link rather than a leak.

/** Always reachable by any signed-in capped role: their own landing page's data
 *  APIs, and the live board every shop-floor login is sent to. */
const alwaysOk = (p: string) => p === "/live" || p.startsWith("/api");

/**
 * Store Incharge. The two-tier RM store is theirs (/store), plus the RM tables
 * capped to STORE_MODELS, consumables, and the ONE office path this role
 * reaches: /office/batch-verify, where they sign off the prices a batch is
 * costed at. Exact-or-subpath on that one, so a future /office/batch-verify-admin
 * is not opened by accident and the rest of /office stays closed.
 */
export function storeMayVisit(p: string): boolean {
  return (
    alwaysOk(p) ||
    p.startsWith("/store") ||
    p.startsWith("/tables") ||
    p.startsWith("/consumables") ||
    p === "/office/batch-verify" ||
    p.startsWith("/office/batch-verify/")
  );
}

/** Operators only use their station's entry forms, and the tables behind them. */
export function operatorMayVisit(p: string): boolean {
  return alwaysOk(p) || p.startsWith("/entry") || p.startsWith("/tables");
}

/** Where each capped role is sent when it asks for something outside its cap. */
export const STORE_HOME = "/live";
export const OPERATOR_HOME = "/entry";
