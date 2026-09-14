// Finished-goods access rules — who may OPEN the module, who may only READ it,
// who may CHANGE it, and who may HAND THE VIEW GRANT OUT. Four questions, four
// functions, one file.
//
// PURE AND IMPORT-FREE, like lib/inventory/intakeRules.ts and lib/chromia/tier.ts,
// and for the same reason: `node --test` resolves neither the `@/` alias nor
// next-auth, so the rules that decide who sees finished goods have to live
// somewhere a test can import directly. tests/inventoryViewerAccess.test.ts is
// that test. The session-reading gates stay next door in ./access.ts, which
// calls currentUser() and therefore cannot sit here; that file imports AND
// re-exports every name below, so every existing
// `from "@/lib/inventory/access"` keeps working untouched. It is the same split
// lib/rbac.ts made with lib/roles.ts, and intakeGate.ts with intakeAccess.ts.
//
// THE MODULE IS AN OFFICE MODULE, AND THEN THERE IS THE VIEW GRANT.
// Finished goods belongs to the OFFICE branch: Finance and Accounts hold the
// slabs table, Commercial dispatches off it, Sales gets the Stock by Design
// summary and nothing else, and the shop floor and fabrication never see it at
// all. On 2026-09-14 the owner asked for "finished good's visibility for
// chromia@thepacific.group, gibin@thepacific.group (full visibility but no edit
// options)". Both of those logins are LINE_MANAGER on branches that are not
// OFFICE — CHROMIA and FABRICATION — so no role+branch pair means those two
// people and nobody else. scripts/0083-fg-view-grant.sql argues that at length
// and lands on a per-login boolean, users.fg_view, carried on the session as
// `fgView`. Read that file before changing anything here; it is the spec.
//
// THE GRANT ADDS, AND IT NEVER SUBTRACTS, AND IT ADDS ONLY TO READING.
// canWriteInventory() below does not mention fgView anywhere. That is not an
// omission, it is the whole shape of the answer. A login holding the flag and
// nothing else reads everything and writes nothing; a login that could already
// write — an ACCOUNTS user handed the flag as well, later, for whatever reason
// — keeps writing exactly as before, because the write rule never looks at the
// flag it would have to look at in order to take anything away.
//
// AND THE DIRECTION IS DELIBERATE AND FAIL-CLOSED. The write rule is the old
// rule under the old name, inventoryGate(). A route written next year and gated
// the way every other write route in this module is gated therefore refuses a
// viewer without its author ever having heard of any of this, and a read has to
// opt in by name. The inverse arrangement — leaving inventoryGate() as the
// permissive one and asking new writes to remember a stricter gate — would hand
// a viewer whatever the next author forgot. Do not invert it.

/** The office roles that own the module outright: the whole slabs table, the
 *  KPIs, the exports, and every action on them. */
export const INVENTORY_ROLES = new Set(["ADMIN", "FINANCE", "ACCOUNTS"]);
/** Sales: sees the inventory module but ONLY the Stock by Design summary. */
export const SUMMARY_ONLY_ROLES = new Set(["SALES"]);
/** Commercial (and its manager): sees ONLY the Slabs table; may dispatch (PI + customer + invoice). */
export const SLABS_ONLY_ROLES = new Set(["COMMERCIAL", "COMMERCIAL_MANAGER"]);

/** What these rules read off a login, and all they read. Structurally satisfied
 *  by the session user, by a users row and by the JWT alike — the same shape
 *  trick lib/roleContext.ts plays with GrantedContexts, and for the same reason:
 *  three callers holding three different objects can ask one question. */
export interface InventoryUser {
  role?: string | null;
  branch?: string | null;
  fgView?: boolean | null;
}

const roleOf = (user: unknown): string => String((user as InventoryUser | null | undefined)?.role ?? "");
const branchOf = (user: unknown): string => String((user as InventoryUser | null | undefined)?.branch ?? "");

/**
 * Whether this login carries the users.fg_view grant — "may look at finished
 * goods, whatever branch it is on, and may change nothing in it".
 *
 * STRICTLY `=== true`, and that is the only interesting line in the function. A
 * session minted before the column was threaded onto the token answers
 * `undefined` here, and `undefined` has to read as "no grant" rather than as
 * "unknown, let them in" — the whole column defaults to false in the database
 * for the same reason. The flag is granted to two people and asked about on
 * every render of the sidebar, so it must also be cheap and total: no database
 * call, no await, no failure mode.
 */
export function hasFgView(user: unknown): boolean {
  return (user as InventoryUser | null | undefined)?.fgView === true;
}

/**
 * The rule exactly as it stood before the view grant existed: Admin anywhere,
 * otherwise an OFFICE-branch login holding one of the module's roles.
 *
 * Kept as its own named function rather than folded into its two callers
 * because it is the thing the grant is measured against. canWriteInventory()
 * is this and nothing else; canSeeInventoryModule() is this OR the flag; a test
 * that asserts the difference between them has something to point at.
 */
export function hasOfficeInventoryAccess(role: string, branch: string): boolean {
  if (role === "ADMIN") return true; // admins span every department
  return branch === "OFFICE" && (INVENTORY_ROLES.has(role) || SUMMARY_ONLY_ROLES.has(role) || SLABS_ONLY_ROLES.has(role));
}

/**
 * May this login see the finished-goods module AT ALL — the question the nav,
 * the page and the Stock by Design summary ask.
 *
 * The widest of the three, and the only one Sales passes: the summary is the
 * surface Sales exists on. A viewer passes it too, which is right — the summary
 * is a read, and a viewer is meant to see everything a full office login sees.
 */
export function canSeeInventoryModule(user: unknown): boolean {
  return hasOfficeInventoryAccess(roleOf(user), branchOf(user)) || hasFgView(user);
}

/**
 * May this login READ the slabs surface — the table, the KPIs, a slab's
 * detail, the filter vocabulary, the exports.
 *
 * The module rule minus Sales, who is summary-only and has been refused this
 * surface since long before the grant. That refusal is kept verbatim rather
 * than reconsidered: the grant was asked for two line managers, and widening
 * what SALES sees is a different decision with a different person to ask. A
 * SALES login that were handed fgView would therefore still be summary-only
 * here — which takes nothing away from it, since it never had this surface.
 */
export function canReadInventory(user: unknown): boolean {
  if (SUMMARY_ONLY_ROLES.has(roleOf(user))) return false;
  return canSeeInventoryModule(user);
}

/**
 * May this login CHANGE finished goods — approve stock, merge a design,
 * dispatch, move a slab, edit one, set a status.
 *
 * Byte for byte the old rule: the office role+branch test, minus Sales. fgView
 * is absent on purpose and must stay absent. See the head of this file.
 */
export function canWriteInventory(user: unknown): boolean {
  const role = roleOf(user);
  if (SUMMARY_ONLY_ROLES.has(role)) return false;
  return hasOfficeInventoryAccess(role, branchOf(user));
}

/**
 * May THIS admin hand the view grant to — or take it back from — a login on
 * THAT branch. The question Users & Roles asks before it draws the control, and
 * the question the server action asks again before it writes.
 *
 * IT IS HERE, WITH THE OTHER RULES ABOUT THIS GRANT, AND IT TAKES TWO STRINGS.
 * Every other rule in this file reads a login and answers what that login may
 * do; this one reads the admin and the target and answers whether the grant may
 * MOVE. Keeping it next door means the flag's whole life — who may hold it, what
 * holding it buys, and who may issue it — is one file to read, and the screen
 * and the server action import the same sentence rather than writing it twice
 * and drifting. Two plain strings because nothing per-login is needed to answer
 * it: this is not the hasInventoryAccess trap, where a (role, branch) pair could
 * not carry the flag being asked about.
 *
 * ADMIN ONLY, and that is narrower than the screen's ordinary rule on purpose.
 * canManageTarget() in admin/users/actions.ts lets anybody manage the ranks
 * below their own inside their own department, which is right for a password
 * reset and wrong for this: finished goods is an OFFICE module, and a shop-floor
 * LINE_MANAGER handing it to their own INCHARGEs would widen an OFFICE module
 * from the shop floor, one grant at a time, without an admin ever seeing it. The
 * owner named two people. An admin can see every department at once and is the
 * only role that can answer "who else holds this" honestly, so an admin is who
 * issues it.
 *
 * INTERNATIONAL SALES IS REFUSED, the same way setAltContext refuses it and for
 * a related reason: those logins have their own duty model, seven of their route
 * handlers judge a request by the RAW session rather than currentUser(), and a
 * sales duty that also read finished goods would be a decision about the sales
 * department taken on the users screen. SALES-role logins would fail
 * canReadInventory() anyway (they are summary-only), but REPORTING_MANAGER and
 * SALES_ADMIN ride on LINE_MANAGER and would not — so the refusal is made here,
 * where it is visible, rather than left to a role table to enforce by accident.
 *
 * This gate is about MOVING the grant, never about honouring one. A grant made
 * before this rule existed — by hand, in SQL, which is how the first two were
 * made — is read by hasFgView() exactly as it always was.
 */
export function mayGrantFgView(
  adminRole: string | null | undefined,
  targetBranch: string | null | undefined,
): boolean {
  if (String(adminRole ?? "") !== "ADMIN") return false;
  if (String(targetBranch ?? "") === "INTERNATIONAL_SALES") return false;
  return true;
}
