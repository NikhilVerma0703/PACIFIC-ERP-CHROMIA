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
// is users.sales_role; these are Role.*, the OFFICE-branch roles the commercial
// desk carries. Do not conflate them.
//
// --------------------------------------------------------------- ACTORS ---
// The owner named the desk person by person on 2026-09-08 (DECISIONS-2.md 1
// and 2: "new roles for each set of tasks... one role that sees only its
// screens"). One role per set of tasks:
//
//   ADMIN                everything. One admin login spans Office, the
//                        International Sales branch and the shop floor.
//   COMMERCIAL_MANAGER   Santosh Thapa — "all access", except the production
//                        planner, which answer 16 keeps admin-only.
//   COMMERCIAL_EXEC      Setumani — everything Raghav does, plus the stock
//                        check, the PI, packing and the dispatch marking.
//   COMMERCIAL_DOCS      Raghav — the invoice, the checklist and the export
//                        documents. Most of his day (BL draft, COO, CEFA, the
//                        Daltile portal, fumigation) is outside this module.
//   COMMERCIAL_LOGISTICS Murali — container booking and the freight side, so
//                        here: enquiries, orders, challans, and the checklist
//                        APPROVAL the owner gave him on 2026-09-07.
//   COMMERCIAL           the one live Commercial login that predates the
//                        split. Kept exactly as it was so nobody is locked out
//                        the day this deploys; retire it once the four people
//                        above have their own.
//   DISPATCH_CHECKER     the dispatch team in bay 5. Answer 6: no new role —
//                        they sign in as they do now and get ONE tab.
//
// ------------------------------------- GATE ON THE ACTION AND ON THE AREA ---
// TWO questions, because "may Raghav write?" and "may Raghav write a packing
// list?" are different questions and the second is the one the owner answered.
//
//   the ACTION table   what KIND of thing a login may do at all
//   the AREA table     WHICH screens it may do it on
//
// Middleware asks the area question for every path in the module, so a screen
// nobody granted is refused even if its route forgets to name its area. A
// route may name its area as well (commercialGate("write", "packing")), and
// should wherever one login writes there and another only reads.
import { rankOf, ROLE_RANK } from "../roles.ts";

/** Everything a signed-in user can be asked to do in this module. */
export type CommercialAction = "view" | "write" | "verify" | "plan" | "approve" | "cancel" | "admin";
export const COMMERCIAL_ACTIONS: CommercialAction[] = ["view", "write", "verify", "plan", "approve", "cancel", "admin"];

/** The screens, as the owner divided the work. */
export type CommercialArea =
  | "overview" | "enquiries" | "clients" | "orders" | "checklist"
  | "stock" | "planning" | "designCodes" | "proforma" | "packing"
  | "dispatchCheck" | "invoices" | "challans" | "settings";

export const COMMERCIAL_AREAS: CommercialArea[] = [
  "overview", "enquiries", "clients", "orders", "checklist",
  "stock", "planning", "designCodes", "proforma", "packing",
  "dispatchCheck", "invoices", "challans", "settings",
];

export const AREA_LABEL: Record<CommercialArea, string> = {
  overview: "Overview", enquiries: "Enquiries", clients: "Clients", orders: "Orders",
  checklist: "Order checklist", stock: "Stock check and holds", planning: "Production queue",
  designCodes: "Design codes and colours", proforma: "Proforma invoices", packing: "Packing lists",
  dispatchCheck: "Dispatch check", invoices: "Invoices", challans: "Delivery challans", settings: "Settings",
};

export type CommercialActor =
  | "ADMIN" | "COMMERCIAL_MANAGER" | "COMMERCIAL_EXEC" | "COMMERCIAL_DOCS"
  | "COMMERCIAL_LOGISTICS" | "COMMERCIAL" | "DISPATCH_CHECKER";

/**
 * Who may perform each KIND of action.
 *
 *   view    read the screens this login's area table admits
 *   write   create and edit on those screens, issue their documents
 *   verify  the dispatch check: mark packed slabs fit or unfit, verify or
 *           reject a submitted packing list
 *   plan    the production queue: reorder, edit the planned hours and slabs,
 *           mark produced. ADMIN ALONE (answer 16: "no, only admin" — and the
 *           Commercial Manager does not see the planner either, as of now)
 *   approve stamp "Approved by" on the order checklist. Murali approves
 *           (2026-09-07 answer 10) and so does the manager
 *   cancel   cancel a PI, an invoice, a challan or an order — and waive the
 *           advance so a truck may leave without it (answer 12)
 *   admin   settings: numbering, hold days, the company master, the banks
 */
export const COMMERCIAL_ACTORS: Record<CommercialAction, readonly CommercialActor[]> = {
  view:    ["ADMIN", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC", "COMMERCIAL_DOCS", "COMMERCIAL_LOGISTICS", "COMMERCIAL"],
  write:   ["ADMIN", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC", "COMMERCIAL_DOCS", "COMMERCIAL_LOGISTICS", "COMMERCIAL"],
  verify:  ["ADMIN", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC", "COMMERCIAL", "DISPATCH_CHECKER"],
  plan:    ["ADMIN"],
  approve: ["ADMIN", "COMMERCIAL_MANAGER", "COMMERCIAL_LOGISTICS"],
  cancel:  ["ADMIN", "COMMERCIAL_MANAGER"],
  admin:   ["ADMIN"],
};

/** none = the screen does not exist for this login and middleware refuses the
 *  path; view = read it; write = act on it (subject to the action table). */
export type AreaAccess = "none" | "view" | "write";

const W: AreaAccess = "write", V: AreaAccess = "view", N: AreaAccess = "none";

/**
 * WHICH screens each login reaches. Read a row as "this person's desk".
 *
 * The two rows worth explaining:
 *
 * COMMERCIAL_DOCS (Raghav) gets `checklist` write while `orders` stays view.
 * He fills the checklist on an order he does not otherwise edit — the owner
 * listed "Invoice, Checklist" as his part of this module and nothing else.
 *
 * `planning` is ADMIN alone, and `settings` too. The design master is its own
 * area rather than a section of settings for exactly that reason: the manager
 * maintains the codes and the colours (answer 15) without being handed the
 * numbering counters or the company master.
 */
export const COMMERCIAL_AREA_ACCESS: Record<CommercialActor, Record<CommercialArea, AreaAccess>> = {
  ADMIN: {
    overview: W, enquiries: W, clients: W, orders: W, checklist: W, stock: W, planning: W,
    designCodes: W, proforma: W, packing: W, dispatchCheck: W, invoices: W, challans: W, settings: W,
  },
  // "All access" (answer 1), minus the planner (answer 16) and the settings
  // form, which stays with the one admin login.
  COMMERCIAL_MANAGER: {
    overview: W, enquiries: W, clients: W, orders: W, checklist: W, stock: W, planning: N,
    designCodes: W, proforma: W, packing: W, dispatchCheck: W, invoices: W, challans: W, settings: N,
  },
  // Setumani: everything Raghav does, plus the stock check, the PI, packing
  // and the dispatch marking.
  COMMERCIAL_EXEC: {
    overview: V, enquiries: V, clients: V, orders: W, checklist: W, stock: W, planning: N,
    designCodes: V, proforma: W, packing: W, dispatchCheck: W, invoices: W, challans: W, settings: N,
  },
  // Raghav: the invoice, the checklist, the challans that travel with it.
  COMMERCIAL_DOCS: {
    overview: V, enquiries: N, clients: V, orders: V, checklist: W, stock: N, planning: N,
    designCodes: N, proforma: V, packing: V, dispatchCheck: N, invoices: W, challans: W, settings: N,
  },
  // Murali: the enquiry and the order come in through him, the freight side
  // goes out through him, and he approves the checklist.
  COMMERCIAL_LOGISTICS: {
    overview: V, enquiries: W, clients: W, orders: W, checklist: W, stock: V, planning: N,
    designCodes: V, proforma: V, packing: V, dispatchCheck: N, invoices: V, challans: W, settings: N,
  },
  // The one live Commercial login, unchanged by the split.
  COMMERCIAL: {
    overview: W, enquiries: W, clients: W, orders: W, checklist: W, stock: W, planning: N,
    designCodes: V, proforma: W, packing: W, dispatchCheck: W, invoices: W, challans: W, settings: N,
  },
  // Bay 5: one tab and nothing else (answer 6).
  DISPATCH_CHECKER: {
    overview: N, enquiries: N, clients: N, orders: N, checklist: N, stock: N, planning: N,
    designCodes: N, proforma: N, packing: N, dispatchCheck: W, invoices: N, challans: N, settings: N,
  },
};

/** Roles that stand in for the dispatch team. Answer 6: no new role for them —
 *  they sign in as they do now and reach the one tab. */
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
 *  The Commercial roles are answered WITHOUT looking at the branch, as roboGate
 *  does for capped roles. */
export function commercialActorOf(user: unknown): CommercialActor | null {
  if (!user) return null;
  const u = user as { role?: string | null; branch?: string | null };
  const role = String(u.role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN";
  if (role === "COMMERCIAL_MANAGER") return "COMMERCIAL_MANAGER";
  if (role === "COMMERCIAL_EXEC") return "COMMERCIAL_EXEC";
  if (role === "COMMERCIAL_DOCS") return "COMMERCIAL_DOCS";
  if (role === "COMMERCIAL_LOGISTICS") return "COMMERCIAL_LOGISTICS";
  if (role === "COMMERCIAL") return "COMMERCIAL";
  if (DISPATCH_CHECKER_ROLES.includes(role) && !BRANCHES_WITH_OWN_BLOCK.includes(String(u.branch ?? ""))) return "DISPATCH_CHECKER";
  return null;
}

/** What this login may do on one screen. Unknown actor or unknown area fails
 *  closed, so a screen added without a row here is refused rather than open. */
export function areaAccessFor(actor: CommercialActor | null, area: CommercialArea): AreaAccess {
  if (!actor) return "none";
  return COMMERCIAL_AREA_ACCESS[actor]?.[area] ?? "none";
}

/**
 * May this user do this — and, when an area is named, do it THERE?
 *
 * Without an area this is the action question alone, which is what every route
 * asked before the desk was split; middleware still refuses the path, so those
 * routes are covered. With an area it is both questions: "view" needs the
 * screen readable, everything else needs it writable.
 */
export function commercialCan(user: unknown, action: CommercialAction, area?: CommercialArea): boolean {
  if (!COMMERCIAL_ACTIONS.includes(action)) return false;   // unknown action fails closed
  const actor = commercialActorOf(user);
  if (!actor) return false;
  if (!COMMERCIAL_ACTORS[action].includes(actor)) return false;
  if (!area) return true;
  const access = areaAccessFor(actor, area);
  return action === "view" ? access !== "none" : access === "write";
}

/** Everything this user may do — for a nav, a page's capability payload, or
 *  the layout's "may this login be here at all". */
export function commercialActionsFor(user: unknown): CommercialAction[] {
  return COMMERCIAL_ACTIONS.filter((a) => commercialCan(user, a));
}

/** Every screen this login reaches, with what it may do there. The nav and the
 *  overview build themselves from this rather than from the role. */
export function commercialAreasFor(user: unknown): Record<CommercialArea, AreaAccess> {
  const actor = commercialActorOf(user);
  const out = {} as Record<CommercialArea, AreaAccess>;
  for (const a of COMMERCIAL_AREAS) out[a] = areaAccessFor(actor, a);
  return out;
}

/**
 * The area a path belongs to, or null when the path is not this module's.
 *
 * Both halves map the same way: /office/commercial/invoices and
 * /api/office/commercial/invoices are one screen and one area. A path nested
 * under an order (/api/office/commercial/orders/<id>/packing-lists) belongs to
 * the area of the THING, not of the order — otherwise Raghav, who may read an
 * order, would reach the packing lists hanging off it.
 */
const PAGE_PREFIX = "/office/commercial";
const API_PREFIX = "/api/office/commercial";

const SEGMENT_AREA: Record<string, CommercialArea> = {
  "": "overview",
  dashboard: "overview",
  enquiries: "enquiries",
  clients: "clients",
  orders: "orders",
  checklist: "checklist",
  receipts: "orders",
  items: "orders",
  events: "orders",
  stage: "orders",
  holds: "stock",
  stock: "stock",
  "production-requests": "planning",
  "production-planning": "planning",
  "design-codes": "designCodes",
  // The customer's article master and its labels (round three, answer 4)
  // live with the design master: same people, same screen group.
  articles: "designCodes",
  // The work AROUND an order (answers 7, 8) belongs to the checklist area,
  // not to "orders". Most of that list is Raghav's — the BL draft, COO,
  // CEFA, the portal uploads, fumigation — and he reads orders without
  // writing them. Gating his own tasks on "orders" would have shown him the
  // card with every control disabled.
  tasks: "checklist",
  proformas: "proforma",
  "packing-lists": "packing",
  "dispatch-check": "dispatchCheck",
  invoices: "invoices",
  challans: "challans",
  settings: "settings",
};

export function areaOfPath(p: string): CommercialArea | null {
  const q = p.indexOf("?");
  const path = q === -1 ? p : p.slice(0, q);
  const base = path.startsWith(API_PREFIX) ? API_PREFIX : path.startsWith(PAGE_PREFIX) ? PAGE_PREFIX : null;
  if (!base) return null;
  if (path !== base && !path.startsWith(base + "/")) return null;   // /office/commercial-something-else
  const rest = path.slice(base.length).replace(/^\/+/, "").replace(/\/+$/, "");
  const seg = rest ? rest.split("/") : [""];
  const first = SEGMENT_AREA[seg[0]];
  if (first === undefined) return null;
  // Nested under an order: orders/<id>/<thing> belongs to <thing>'s own area.
  if (first === "orders" && seg.length >= 3) {
    const nested = SEGMENT_AREA[seg[2]];
    if (nested !== undefined) return nested;
  }
  return first;
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
 * middleware asks, and now the only gate that covers EVERY path in the module:
 * the area table decides, so a screen this login was not given is refused
 * whether or not its route remembers to name its area. WHICH action a request
 * is then allowed is decided in the route by commercialGate(action, area).
 *
 * A path this module does not own is not this rule's business — it answers
 * false, and middleware only asks about paths under the two prefixes.
 */
export function maySeeCommercialModule(user: unknown, p: string): boolean {
  const actor = commercialActorOf(user);
  if (!actor) return false;
  const area = areaOfPath(p);
  if (!area) return false;
  return areaAccessFor(actor, area) !== "none";
}

/** Where a Commercial-module login lands. */
export const COMMERCIAL_HOME = "/office/commercial";

/** ...unless it has no overview: the dispatch team lands on its one tab. */
export function commercialHomeFor(user: unknown): string {
  const actor = commercialActorOf(user);
  if (actor && areaAccessFor(actor, "overview") === "none" && areaAccessFor(actor, "dispatchCheck") !== "none") {
    return "/office/commercial/dispatch-check";
  }
  return COMMERCIAL_HOME;
}
