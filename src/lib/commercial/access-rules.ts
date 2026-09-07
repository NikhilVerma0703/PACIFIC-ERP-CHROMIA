// Who may do what in the Commercial module — the PURE half of
// lib/commercial/access.ts, split out exactly as lib/sampling/actions.ts is so
// that `node --test` can import it and so that middleware can: no auth, no
// aliases beyond lib/roles.ts, which is itself import-free. The server gate
// (commercialGate, currentUser) lives in access.ts and IMPORTS this module
// rather than restating it, so the tests exercise the rule the routes run.
//
// MIDDLEWARE IMPORTS THIS FILE, which makes it EDGE CODE. Nothing here may
// import Prisma, `next/headers` or any server-only module — the same rule
// lib/routeCaps.ts states at its head, and for the same reason: the path gate
// and the route gate must ask ONE question about who the dispatch team is.
//
// ------------------------------------------------------------ THE MODULE ---
// The Commercial module lives at /office/commercial + /api/office/commercial.
// It is NOT the ported "International Sales" module (/sales, salesGate), which
// has its own duty strings — one of them also spelled "COMMERCIAL". That one
// is users.sales_role; this one is Role.COMMERCIAL, the OFFICE-branch role the
// one live Commercial login carries. Do not conflate them.
//
// --------------------------------------------------------------- ACTORS ---
// FOUR KINDS OF LOGIN REACH THIS MODULE:
//
//   ADMIN            (rank >= ADMIN)  everything
//   COMMERCIAL       (Role.COMMERCIAL) view, write, verify-view; NOT plan/admin
//   DISPATCH_CHECKER (Role.STORE)     verify ONLY — the packing-list check
//   PLANT_MANAGER    (LINE_MANAGER)   verify ONLY, same as the store incharge
//
// The dispatch team is "another team in our factory which physically sees the
// condition of slabs and lets us know if they are fit to go" (owner,
// 2026-09-05). Which ERP role they hold is UNDECIDED — the candidates are the
// existing STORE role (3 shop-floor logins, 1 active) or a new DISPATCH role.
// Until decided, STORE and LINE_MANAGER are admitted to the verification
// screen and nothing else; a new role is one line in dispatchCheckerOf below.
//
// ---------------------------------------------------- GATE ON THE ACTION ---
// A table of actions, not a minimum rank: "the store incharge may verify a
// packing list but may not see an enquiry" is not a ladder.
import { rankOf, ROLE_RANK } from "../roles.ts";

/** Everything a signed-in user can be asked to do in this module. */
export type CommercialAction = "view" | "write" | "verify" | "plan" | "approve" | "cancel" | "admin";
export const COMMERCIAL_ACTIONS: CommercialAction[] = ["view", "write", "verify", "plan", "approve", "cancel", "admin"];

/** The four kinds of login, plus the Commercial Manager the owner added on
 *  2026-09-07 (answer 9: "a commercial manager role"). Answers 10 and 24 say
 *  what the manager does that a Commercial user does not: approve the
 *  checklist, cancel a PI. The per-task roles the owner also asked for wait
 *  for the task sets. */
export type CommercialActor = "ADMIN" | "COMMERCIAL_MANAGER" | "COMMERCIAL" | "DISPATCH_CHECKER";

/**
 * Who may perform each action.
 *
 *   view    read enquiries, orders, holds, PIs, packing lists, invoices, queue
 *   write   create/edit all of the above, place holds, raise requests, issue
 *           documents
 *   verify  the dispatch check: mark packed slabs fit/unfit, verify or reject
 *           a submitted packing list
 *   plan    the production planning queue: reorder, schedule, mark produced
 *   admin   settings — numbering, hold days, company master, banks
 *
 * ADMIN is on every line rather than special-cased, so "admins span every
 * department" is readable in the table. COMMERCIAL may verify too: the owner
 * has one Commercial login and the dispatch team has no login yet, and a
 * module that cannot be exercised end to end by the person building it with
 * us is a module nobody can test. Take it off this line when the dispatch
 * team has its own logins.
 */
export const COMMERCIAL_ACTORS: Record<CommercialAction, readonly CommercialActor[]> = {
  view:    ["ADMIN", "COMMERCIAL_MANAGER", "COMMERCIAL"],
  write:   ["ADMIN", "COMMERCIAL_MANAGER", "COMMERCIAL"],
  verify:  ["ADMIN", "COMMERCIAL_MANAGER", "COMMERCIAL", "DISPATCH_CHECKER"],
  /** The production queue: reorder, edit the planned hours and slabs, mark
   *  produced. Answer 13 says "only for admin"; the manager is admitted as the
   *  office-side admin of this module. */
  plan:    ["ADMIN", "COMMERCIAL_MANAGER"],
  /** Approve the internal sales order checklist (answer 10: "approved by Murali"). */
  approve: ["ADMIN", "COMMERCIAL_MANAGER"],
  /** Cancel a PI (answer 24: "only by admin or commercial manager"). */
  cancel:  ["ADMIN", "COMMERCIAL_MANAGER"],
  admin:   ["ADMIN"],
};

/** Roles that stand in for the dispatch team until it has a role of its own. */
export const DISPATCH_CHECKER_ROLES: readonly string[] = ["STORE", "LINE_MANAGER"];

/**
 * Branches that carry their own block in middleware.ts. Those blocks run AFTER
 * this module's block and they RETURN, so for a login sitting on one of them
 * the branch decides the page and this module never gets the last word.
 *
 * A dispatch checker on such a branch was therefore admitted to every
 * /api/office/commercial/dispatch-check call (the branch blocks pass /api
 * straight through) while being refused the /office/commercial/dispatch-check
 * PAGE — an API a person can drive but a screen they cannot open, which is the
 * worst of both: no UI, and a wider reach than the UI would have given. The
 * fix is to make the rule agree with what middleware will actually do, which is
 * the same precedence routeCaps.homeFor already documents ("a SAMPLING login on
 * a branch that has its own block belongs to the BRANCH").
 *
 * ADMIN is unaffected: middleware exempts admins from every branch block.
 */
const BRANCHES_WITH_OWN_BLOCK: readonly string[] = ["FABRICATION", "INTERNATIONAL_SALES", "CHROMIA"];

/** Which kind of login this is, or null for everybody else. ADMIN first, then
 *  the role: a login can only be one of these and the order is the precedence.
 *  Role COMMERCIAL is answered WITHOUT looking at the branch, as roboGate does
 *  for capped roles. */
export function commercialActorOf(user: unknown): CommercialActor | null {
  if (!user) return null;
  const u = user as { role?: string | null; branch?: string | null };
  const role = String(u.role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN";
  if (role === "COMMERCIAL_MANAGER") return "COMMERCIAL_MANAGER";
  if (role === "COMMERCIAL") return "COMMERCIAL";
  if (DISPATCH_CHECKER_ROLES.includes(role) && !BRANCHES_WITH_OWN_BLOCK.includes(String(u.branch ?? ""))) return "DISPATCH_CHECKER";
  return null;
}

/** May this user do this? The whole access rule, in one call. */
export function commercialCan(user: unknown, action: CommercialAction): boolean {
  if (!COMMERCIAL_ACTIONS.includes(action)) return false;   // unknown action fails closed
  const actor = commercialActorOf(user);
  if (!actor) return false;
  return COMMERCIAL_ACTORS[action].includes(actor);
}

/** Everything this user may do — for a nav, a page's capability payload, or
 *  the layout's "may this login be here at all". */
export function commercialActionsFor(user: unknown): CommercialAction[] {
  return COMMERCIAL_ACTIONS.filter((a) => commercialCan(user, a));
}

/**
 * The paths a verify-only login (the dispatch team) may open. Exact-or-subpath,
 * so /office/commercial/dispatch-check-admin is not opened by accident. The
 * API the screen talks to sits under the same segment for the same reason:
 * middleware can only say yes or no to a path, and this is the one path a
 * dispatch checker gets a yes on.
 */
export const DISPATCH_CHECK_PATHS: readonly string[] = ["/office/commercial/dispatch-check", "/api/office/commercial/dispatch-check"];

export function isDispatchCheckPath(p: string): boolean {
  const q = p.indexOf("?");
  const path = q === -1 ? p : p.slice(0, q);
  return DISPATCH_CHECK_PATHS.some((base) => path === base || path.startsWith(base + "/"));
}

/**
 * May this login reach this Commercial-module PATH at all? The coarse gate
 * middleware asks. A login that may view or write reaches every module path; a
 * verify-only login reaches the dispatch-check paths and nothing else; anyone
 * else is refused. Which ACTION a request is allowed is decided in the route by
 * commercialGate(action).
 */
export function maySeeCommercialModule(user: unknown, p: string): boolean {
  const actions = commercialActionsFor(user);
  if (actions.length === 0) return false;
  if (actions.includes("view")) return true;
  return actions.includes("verify") && isDispatchCheckPath(p);
}

/** Where a Commercial-module login lands. */
export const COMMERCIAL_HOME = "/office/commercial";
