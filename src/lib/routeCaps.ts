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
/**
 * The refusal page, reachable by EVERY capped role.
 *
 * Both gates already treat it as public before any cap runs, so the app does
 * not depend on this. It is here so the cap FUNCTIONS are correct standalone:
 * a caller that asks "may this role visit /no-access" and is told no would send
 * a refused user to a page it then refuses - the two-gates-pointing-at-each-
 * other shape this file exists to make impossible. Relying on call ORDER to
 * avoid it is the sort of implicit contract that drifted here once already.
 */
const REFUSAL_PAGE = "/no-access";

const alwaysOk = (p: string) => p === REFUSAL_PAGE || p === "/live" || p.startsWith("/api");

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

/**
 * The start page for a login — where "Go to my start page" leads.
 *
 * Every capped role has a landing page it is allowed to open; sending someone
 * to "/" from the no-access page would, for most of these roles, bounce them
 * straight back to no-access and read as a loop.
 *
 * Branch is checked before role because branch is the coarser cap: a
 * FABRICATION incharge and a shop-floor incharge share a role and have
 * different homes.
 */
export function homeFor(role: string, branch: string): string {
  // THE ORDER OF THESE TESTS MIRRORS THE ORDER OF THE BLOCKS IN middleware.ts,
  // and has to. denied() sends a refused user here, so an answer this gives
  // that the next gate refuses is not a suggestion that misses - it is a
  // redirect chain, and when the refusal lands back on "/" it is an infinite
  // one. Role CHROMIA did exactly that. Every line below names the middleware
  // block it is mirroring; move one and it must move there too.
  if (role === "ADMIN") return "/";

  // mw: `role === "CHROMIA" || (!isAdmin && branch === "CHROMIA")` - one block,
  // so role CHROMIA is capped to /chromia on EVERY branch, not just its own.
  if (role === "CHROMIA" || branch === "CHROMIA") return "/chromia";

  // mw: `!isAdmin && branch === "FABRICATION"`. The three fab tiers do not
  // share a landing page; middleware used to carry this in a local (fabHome)
  // that stopped being read when its redirect became denied().
  if (branch === "FABRICATION") {
    if (role === "LINE_MANAGER") return "/fab/manager";
    if (role === "INCHARGE") return "/fab/supervisor/slabs";
    return "/fab/cutting";  // fab OPERATOR - a queue page, which their cap lists
  }

  // mw: `!isAdmin && branch === "INTERNATIONAL_SALES"`. This block returns
  // before the ROLE caps below run, so the branch wins here for the same
  // reason it wins there - including for a ROBO or STORE login sitting on it.
  if (branch === "INTERNATIONAL_SALES") return "/sales";

  // Then the role caps, in middleware's order.
  if (role === "ROBO") return "/robo";
  // SALES normally carries branch OFFICE. Letting OFFICE answer first sent them
  // to /office, which the SALES cap refuses, so "Go to my start page" led
  // straight back to the refusal page. /inventory is allowed by both caps -
  // but only on the OFFICE branch (mw refuses /inventory to any other), which
  // is why SALES/COMMERCIAL on the shop floor has no reachable page at all.
  // That is a configuration with nowhere to land, not a wrong answer here.
  if (role === "SALES" || role === "COMMERCIAL") return "/inventory";
  // Before branch OFFICE: this role's cap allows "/" and refuses /office, so
  // letting the branch answer would hand it a page it cannot open. MAINTENANCE
  // is SHOP_FLOOR today - this is here so a mis-set branch in Users & Roles is
  // a wrong menu, not a login that cannot land anywhere.
  if (role === "MAINTENANCE") return "/";
  // ...and for the SAME reason, so must these two. Middleware has NO
  // `branch === "OFFICE"` block at all - an OFFICE login falls through to the
  // ROLE caps - so the line below mirrors no gate; it is a convenience for
  // office STAFF. Letting it answer first handed a STORE login "/office",
  // which storeMayVisit refuses, so the only button on the refusal page led
  // straight back to the refusal page. auth.config refuse() already sends
  // these two to /live and /entry; homeFor now agrees with it.
  if (role === "STORE") return STORE_HOME;
  if (role === "OPERATOR") return OPERATOR_HOME;
  if (branch === "OFFICE") return "/office";
  // MAINTENANCE, INCHARGE, LINE_MANAGER and anything new all start at Overview,
  // which every one of them can open.
  return "/";
}

/**
 * Maintenance Manager.
 *
 * Overview, the Downtime report, their own Maintenance Log and its uptime
 * board, plus the two plant-performance reports and the consumables dashboard.
 *
 * NOT the lookups. A batch or slab trace carries per-cycle mix weights, silo
 * and bag numbers, invoice numbers and suppliers — which is material cost per
 * slab under another name, and the reason /office/batch-lookup exists as a
 * separate, narrower projection for the office.
 *
 * The API clause is an ALLOWLIST, not `startsWith("/api")`. The bare form said
 * "and its APIs" and meant every API in the ERP; /api/consumables is the only
 * one any page in this cap actually calls, because the rest render on the
 * server and their two writes are server actions that POST to the page path.
 */
export function maintenanceMayVisit(p: string): boolean {
  // Both gates pass a pathname, but this function is exported and unit-tested
  // with query strings, and a caller that passes one must not get a different
  // answer than the same page without it. Strip it ONCE here rather than
  // teaching every clause below about "?" - which is how exact() came to know
  // and under() did not.
  const q = p.indexOf("?");
  const path = q === -1 ? p : p.slice(0, q);
  const under = (base: string) => path === base || path.startsWith(base + "/");
  const exact = (base: string) => path === base;
  return (
    // NOT alwaysOk: that helper allows all of /api, which this cap narrows
    // to /api/consumables on purpose.
    path === REFUSAL_PAGE ||
    path === "/" ||
    under("/mis") ||
    under("/maintenance") ||
    under("/report") ||
    under("/consumables") ||
    // exact-or-subpath like every other clause. A bare prefix here would open
    // /api/consumables-pricing to this role the day somebody adds it - the
    // very shape the comment on the ROBO cap exists to warn about.
    under("/api/consumables") ||
    // Two links rendered ON the granted pages, both with their own gates:
    //   /api/photo      - the photo attached to a downtime response,
    //                     rendered by DowntimeRespond on /mis AND
    //                     /maintenance for exactly this role. Checks
    //                     currentUser + canSeeModel itself.
    //   /api/mis/export - the "Download (Excel)" button on /mis.
    // Both are written as template literals, which is why a grep for
    // double-quoted "/api/..." missed them and the first cut of this
    // allowlist silently broke the photo evidence for the one role that
    // files it.
    // exact(): a pathname, optionally carrying a query string. startsWith
    // alone let /api/mis/exporter through - a route that does not exist today
    // and would be granted on the day somebody adds it, which is opt-OUT
    // security in the one place this cap is trying to be an allowlist.
    exact("/api/photo") || exact("/api/mis/export")
  );
}

/**
 * Whether a login may see the MATERIAL-SOURCE TRACE on a production report —
 * the block carrying supplier names, invoice numbers, bag numbers, silo numbers
 * and per-cycle mix weights.
 *
 * /report was granted to Maintenance so the manager can read a batch's
 * production run. The same page also renders that trace, and the instruction
 * granting the page said the batch/slab LOOKUPS were not to be opened —
 * /office/batch-lookup exists precisely because this projection had to be
 * narrowed once already for the office.
 *
 * So this is a DENYLIST, not an allowlist, and deliberately: every role that
 * could read the trace before this change still can. Only a role listed here
 * loses it, so granting a page can never quietly take something away from
 * somebody who already had it. One line reverses it.
 */
const TRACE_BLIND = new Set(["MAINTENANCE"]);

export function maySeeMaterialTrace(role: string): boolean {
  return !TRACE_BLIND.has(role);
}
