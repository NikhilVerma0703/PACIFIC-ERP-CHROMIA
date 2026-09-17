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
 * The ONLY paths served without a session: Next's own build output and the
 * handful of files that actually sit in public/.
 *
 * The old rule was "anything ending in .png/.jpg/.svg/.ico/.webmanifest/.txt/.xml",
 * in three places (here as STATIC_FILE, in auth.config.ts, and in the
 * middleware matcher). An extension test says nothing about WHERE a path
 * points: /api/robo/shifts/55.png, /tables/Press.png and /silo/5.png all
 * ended in .png, and a matcher-excluded path runs NO middleware and NO
 * authorized() callback at all - it skips both gates at once. It was inert
 * only because the handlers behind those ids happened to miss on "55.png";
 * that is luck, not a control.
 *
 * So this is an ALLOWLIST of real files, matched exactly - the same shape as
 * every cap in this file. public/ holds exactly these today (ls it): the PWA
 * icons, the two logos the login page shows, and the manifest. favicon.ico is
 * kept although nothing ships one: browsers ask for it unprompted, and a 404
 * is the right answer, not a redirect to /login. A file added to public/
 * later must be added HERE (and to the matcher in middleware.ts, which is a
 * string literal Next reads at build time and cannot call this function) or
 * it will need a sign-in to load - a dead asset, never a leak.
 *
 * Pure, so the matcher string and this function can be checked against each
 * other in tests/publicAssets.test.ts.
 */
// lib/roles.ts is import-free, so this stays edge-safe (see the head of this file).
import { isCommercialRole } from "./roles.ts";

export const PUBLIC_ASSET = /^\/(?:favicon\.ico|apple-touch-icon\.png|icon-[\w-]+\.png|logo-[\w-]+\.png|manifest\.webmanifest)$/;

export function isPublicAsset(p: string): boolean {
  return p.startsWith("/_next/static/") || p.startsWith("/_next/image") || PUBLIC_ASSET.test(p);
}

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
    p.startsWith("/office/batch-verify/") ||
    // The Commercial module's dispatch check: the store incharge stands in for
    // the dispatch team until that team has a role of its own (owner, 2026-09-05:
    // a separate team physically checks each slab is fit to go). Exact-or-subpath
    // like batch-verify above; the rest of /office/commercial stays closed to
    // this role, and lib/commercial/access-rules.ts is the rule both edge gates
    // and the route gate share.
    p === "/office/commercial/dispatch-check" ||
    p.startsWith("/office/commercial/dispatch-check/")
  );
}

/**
 * Operators only use their station's entry forms, and the tables behind them.
 *
 * THIS IS THE SHOP-FLOOR OPERATOR, NOT THE FABRICATION ONE, and no /fab path
 * belongs here. A FABRICATION operator never reaches this function: both gates
 * hand that login to the fab branch allowlist and return before the role caps
 * run — `if (branch === "FABRICATION") return true` in auth.config.ts's
 * authorized(), and the `branch === "FABRICATION"` block's own `return` in
 * middleware.ts, which is where his pages (the five station queues,
 * /fab/session and /fab/supervisor/slabs) are listed. Adding one of them here
 * would grant it to the wrong operator — the man on the production line — and
 * would not grant the fab cutter anything, because he is already gone by then.
 */
export function operatorMayVisit(p: string): boolean {
  return alwaysOk(p) || p.startsWith("/entry") || p.startsWith("/tables");
}

/**
 * Sampling Incharge (Role.SAMPLING). The sampling module and ITS APIs - nothing
 * else, exactly like the ROBO and CHROMIA tablet roles.
 *
 * SAMPLING IS A ROLE, NOT A BRANCH. It was designed as a department (Branch
 * SAMPLING carrying the shared OPERATOR/INCHARGE/LINE_MANAGER ranks) while
 * Chromia was still one. Chromia has since been retired AS a department -
 * lib/branchNames.ts keeps the value only so old rows decode, and
 * scripts/0046-migrate-chromia-branch-users.sql moves those logins onto
 * Role.CHROMIA - so the surviving shape for a single-purpose module is a capped
 * role, and this follows it. No Branch value was added.
 *
 * NOT alwaysOk: that helper hands out all of /api and /live. The ROBO cap's own
 * comment in middleware.ts records what a bare `startsWith("/api")` costs -
 * it said "nothing else" and meant the opposite, handing a shop-floor tablet
 * /api/sales, /api/admin, /api/office and the rest.
 *
 * The refusal page IS reachable, so a refused sampling login is not bounced off
 * the page it was just sent to; see the note on REFUSAL_PAGE.
 *
 * Written as exact-or-subpath rather than a bare prefix, so a future
 * /sampling-admin or /api/sampling-export is not opened by accident the day
 * somebody adds one - the same near-miss the Store Incharge's
 * /office/batch-verify clause is anchored against.
 *
 * WHO ELSE REACHES THE MODULE is a different question, and is NOT answered
 * here: a Fabrication Supervisor may add sample stock (the offcuts are his) and
 * is capped by his own branch block, not by this. That rule lives once, in
 * lib/sampling/actions.ts, which middleware and every route gate both call.
 */
export function samplingMayVisit(p: string): boolean {
  // Strip a query string once, as maintenanceMayVisit does, so a caller that
  // passes one cannot get a different answer than the same page without it.
  const q = p.indexOf("?");
  const path = q === -1 ? p : p.slice(0, q);
  const under = (base: string) => path === base || path.startsWith(base + "/");
  return path === REFUSAL_PAGE || under("/sampling") || under("/api/sampling") || isPublicAsset(path);
}

/**
 * THE FINISHED-GOODS VIEW GRANT, AS A PATH - what a login carrying
 * users.fg_view is let through to, and the whole of what it is let through to.
 *
 * The owner, 2026-09-14: "Please add finished good's visibility for
 * chromia@thepacific.group, gibin@thepacific.group (full visibility but no edit
 * options)". Neither of them sits on the OFFICE branch that owns the module -
 * chromia@ is on CHROMIA, gibin@ on FABRICATION - so both are refused finished
 * goods by a branch cap long before any route gate gets a chance to admit them.
 * scripts/0083-fg-view-grant.sql is the argument for answering that with a
 * per-login boolean instead of a role, and lib/inventory/accessRules.ts holds
 * the rule that reads the flag. This file answers only the other half: WHERE.
 *
 * IT SAYS NOTHING ABOUT WHAT THE VIEWER MAY DO, and it cannot: a slab lookup
 * and a slab edit are both POSTs under /api/inventory, and a path match cannot
 * tell them apart. The split is made in the route by inventoryReadGate(), which
 * admits the flag, against inventoryGate(), which refuses it and guards every
 * write. Those gates are the enforcement; this is the outer fence, and the two
 * have to agree - a page refused while its API is open is the failure
 * lib/commercial/access-rules.ts records at length. The reverse of that failure
 * is what the /api/photo clause below fixes: a page admitted while one endpoint
 * it renders stays refused, which does not read as a refusal to the person
 * looking at it. It reads as the feature being broken.
 *
 * BOTH EDGE GATES IMPORT IT, like every other cap in this file, so middleware.ts
 * cannot come to admit a path that auth.config.ts's authorized() refuses. That
 * disagreement would be especially quiet here, because authorized() runs FIRST
 * and a Response it returns replaces middleware wholesale: the viewer would be
 * bounced off the page by the gate in front of the one that admitted them.
 *
 * Exact-or-subpath rather than a bare prefix, for the reason samplingMayVisit
 * gives: an /inventory-admin page or an /api/inventory-export added later is a
 * new decision to take, not one to inherit from the spelling of its name.
 */
export function fgViewMayVisit(p: string): boolean {
  // Strip a query string once, as maintenanceMayVisit and samplingMayVisit do,
  // so /inventory?status=IN_STOCK cannot be answered differently from /inventory.
  const q = p.indexOf("?");
  const path = q === -1 ? p : p.slice(0, q);
  const under = (base: string) => path === base || path.startsWith(base + "/");
  const exact = (base: string) => path === base;
  return (
    under("/inventory") ||
    under("/api/inventory") ||
    // AND THE SLAB PHOTOS, which the detail panel does not load from
    // /api/inventory at all. It renders one <img src="/api/photo?id=..."> per
    // photo row and Lightbox opens the same URL, while the rows themselves come
    // from /api/inventory/slab - which is on inventoryReadGate and therefore
    // hands a viewer the ids. Leaving the picture endpoint outside this fence
    // did not hide the Photos strip, it drew it: a row of broken tiles and a
    // lightbox that opens on a blank frame, for exactly the two logins the
    // grant was made for. maintenanceMayVisit names this same path for the same
    // reason, and its comment records that the first cut of THAT allowlist
    // silently broke the photo evidence for the one role that files it. This is
    // the same omission, so it gets the same line.
    //
    // A PATH, AND THE ROUTE STILL DECIDES WHICH PICTURE. /api/photo serves
    // every model in the ERP and the id in the query string does not say which
    // one, so a fence cannot scope this to finished goods and must not pretend
    // to. The scoping lives in the route, which answers a view-grant login for
    // model "FinishedSlab" and refuses it the rest - including, since this line
    // was added, the Chromia tablet's own photos, which its branch cap used to
    // refuse on this fence's behalf.
    //
    // exact(), not under(): a pathname, optionally carrying a query string, and
    // there is no /api/photo/<something> to reach. The form maintenanceMayVisit
    // settled on after a bare startsWith let /api/mis/exporter through.
    exact("/api/photo")
  );
}

/**
 * THE MACHINE ROUTES: hit by a scheduler, never by a browser, so they carry no
 * session and must pass the login gate to reach their own secret check.
 *
 * This list exists because leaving one out fails SILENTLY AND INVISIBLY. A cron
 * route not named here is redirected to /login, and a redirect is a 302 - which
 * Vercel's cron log records as a successful run. The job appears to fire on
 * schedule, forever, and does nothing. That is exactly what happened to the slab
 * intake digest: it shipped, it was scheduled, and every run was bounced to the
 * login page. Both gates now read this one list, so a new cron route is opened
 * in both places or in neither.
 *
 * NOT PUBLIC. Each of these refuses a request without its own secret, and
 * refuses everything when that secret is unset. Passing the login gate only
 * means the route gets to answer for itself.
 *
 * Prefix match, not exact, because these have sub-paths (/api/sales/cron/...).
 */
export const CRON_ROUTES = [
  "/api/telegram/report",           // CRON_SECRET
  "/api/telegram/webhook",          // Telegram's own webhook secret
  "/api/sales/cron",                // CRON_SECRET
  "/api/report/daily-email",        // CRON_SECRET - the 09:00 CEO report
  "/api/report/slab-intake-digest", // CRON_SECRET - the 06:01 / 18:01 intake digest
  // CRON_SECRET, or an admin session for the read-only dry run. A cron route
  // left off this list is bounced to /login with a 302 that Vercel logs as a
  // SUCCESS -- the intake digest already paid for that lesson, so this is added
  // with the route rather than after the first silent failure.
  "/api/salesforce/sync",
] as const;

export function isCronRoute(p: string): boolean {
  const q = p.indexOf("?");
  const path = q === -1 ? p : p.slice(0, q);
  return CRON_ROUTES.some((base) => path === base || path.startsWith(base + "/"));
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
  // mw: `role === "SAMPLING"`, a ROLE block sitting with ROBO's at the foot of
  // middleware - so, like ROBO and unlike CHROMIA, a SAMPLING login on a branch
  // that has its own block belongs to the BRANCH, which returns first. Answering
  // "/sampling" for a fabrication-branch sampling login would be a refusal on
  // the next hop. Its cap excludes "/", so this arm is not optional: a capped
  // role without one inherits the "/" fallthrough at the foot of this function,
  // which is the infinite redirect role CHROMIA shipped.
  if (role === "SAMPLING") return "/sampling";
  // SALES normally carries branch OFFICE. Letting OFFICE answer first sent them
  // to /office, which the SALES cap refuses, so "Go to my start page" led
  // straight back to the refusal page. /inventory is allowed by both caps -
  // but only on the OFFICE branch (mw refuses /inventory to any other), which
  // is why SALES/COMMERCIAL on the shop floor has no reachable page at all.
  // That is a configuration with nowhere to land, not a wrong answer here.
  if (role === "SALES") return "/inventory";
  // COMMERCIAL's home moved from Finished Goods to its own module on 2026-09-06
  // (scripts/0076). Its cap allows /office/** and /api/**, so this is a page it
  // can open on every branch; the module's layout gate decides the rest.
  // COMMERCIAL_MANAGER (scripts/0079) shares the cap and the home.
  if (isCommercialRole(role)) return "/office/commercial";
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

/**
 * Who may open the /mis page - and therefore who may pull its Excel export.
 *
 * /mis itself has no gate of its own: its audience is whoever no cap turns
 * away, which middleware.ts decides block by block. /api/mis/export used to
 * refuse only COMMERCIAL and SALES, while every branch block and every role
 * cap hands its login ALL of /api - so an operator, a store incharge, a
 * fabrication or sales login could download the whole downtime log (incidents,
 * maintenance responses, photo links) for any date range from a page they can
 * never open. This names the page's audience once so the route can mirror it.
 *
 * It is written as the list of REFUSALS because that is what middleware does
 * for /mis: no capped role has it in its allowlist (storeMayVisit,
 * operatorMayVisit), the Fabrication and International Sales blocks never reach
 * a production page, the Chromia cap is the module alone, Commercial and Sales
 * are refused by name, and ROBO and SAMPLING are each capped to their own
 * module. MAINTENANCE is the one capped role whose allowlist includes /mis
 * (maintenanceMayVisit), and is therefore NOT refused here. Admins span every
 * department. If a block in middleware.ts changes who reaches /mis, change this
 * with it - the test in tests/misAudience.test.ts pins the caps it can check.
 */
const MIS_BLIND_ROLES = new Set(["OPERATOR", "STORE", "COMMERCIAL", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC", "COMMERCIAL_DOCS", "COMMERCIAL_LOGISTICS", "SALES", "ROBO", "CHROMIA", "SAMPLING"]);
const MIS_BLIND_BRANCHES = new Set(["FABRICATION", "INTERNATIONAL_SALES", "CHROMIA"]);

export function maySeeMis(role: string, branch: string): boolean {
  if (role === "ADMIN") return true;
  return !MIS_BLIND_ROLES.has(role) && !MIS_BLIND_BRANCHES.has(branch);
}
