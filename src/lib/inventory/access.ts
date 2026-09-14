// Finished-goods inventory access — an OFFICE (Commercial) module. Office staff
// (Finance, Accounts) and Admins hold it, Commercial sees the slabs table and
// dispatches off it, Sales sees only the Stock by Design summary, and the shop
// floor never sees it at all. Extend the OFFICE side by adding roles to
// INVENTORY_ROLES.
//
// SINCE 2026-09-14 THERE IS A FOURTH ANSWER: a per-login VIEW grant,
// users.fg_view, which lets a named login read this module from any branch and
// change nothing in it. The rules themselves — the role sets and the three
// predicates the gates below are built out of — moved to ./accessRules.ts,
// which imports nothing at all so `node --test` can load it bare
// (tests/inventoryViewerAccess.test.ts); they are imported AND re-exported here
// so every existing `from "@/lib/inventory/access"` keeps working unchanged.
// Read scripts/0083-fg-view-grant.sql and the head of accessRules.ts for why
// the grant is a column and not a role, and why it can only ever add.
//
// THREE GATES, AND WHICH ONE A ROUTE WANTS IS DECIDED BY ITS VERB, NOT BY ITS
// SUBJECT MATTER:
//
//   inventoryGate()      guards everything that CHANGES stock. Unchanged for
//                        everyone who passed it yesterday, and it refuses a
//                        view-grant login. A new write route gated this way is
//                        closed to viewers before its author has read any of
//                        this, which is the point.
//   inventoryReadGate()  guards the read surface — the table, a slab, the KPIs,
//                        the filter vocabulary, the exports. Everyone
//                        inventoryGate admits, plus a view-grant login.
//   summaryGate()        guards Stock by Design, the one surface Sales holds.
//
import { currentUser } from "@/lib/rbac";
import {
  INVENTORY_ROLES,
  SUMMARY_ONLY_ROLES,
  SLABS_ONLY_ROLES,
  hasFgView,
  hasOfficeInventoryAccess,
  canSeeInventoryModule,
  canReadInventory,
  canWriteInventory,
  mayGrantFgView,
  type InventoryUser,
} from "./accessRules";

export {
  INVENTORY_ROLES,
  SUMMARY_ONLY_ROLES,
  SLABS_ONLY_ROLES,
  hasFgView,
  hasOfficeInventoryAccess,
  canSeeInventoryModule,
  canReadInventory,
  canWriteInventory,
  mayGrantFgView,
};
export type { InventoryUser };

/**
 * Sync check used by Shell/Nav, the inventory page and /api/photo: may this
 * login see the module at all.
 *
 * TWO SHAPES, AND ONLY ONE OF THEM CAN SEE THE VIEW GRANT. Pass the USER — the
 * session object, whole — and the answer includes fgView. The older
 * (role, branch) pair is still accepted, but a pair of strings cannot carry a
 * per-login flag, so that form answers the pre-2026-09-14 rule and a viewer
 * fails it.
 *
 * That is the safe direction of the two and the reason the old form was kept at
 * all rather than given an optional third argument: a caller left on it
 * UNDER-grants — it withholds from a viewer whatever that one call site guards,
 * until the call site is moved over — where a defaulted parameter invites the
 * opposite mistake, a viewer handed a surface nobody decided to give it.
 *
 * NOTHING CALLS THE OLD FORM ANY MORE. Shell, the nav and /api/photo all moved
 * to the object form on 2026-09-14, with the grant itself, so a viewer gets the
 * sidebar row, the slabs table and the slab photos alike, and there is no
 * outstanding migration behind this function. The signature stays anyway,
 * because deleting it buys nothing that keeping it does not already give: it
 * fails closed, it is marked @deprecated, and the list of callers on it is
 * pinned at empty by tests/inventoryViewerAccess.test.ts, which fails the day a
 * new two-string caller appears and tells whoever added it to pass the user
 * instead. tests/inventoryDashboardView.test.ts holds the sidebar row for both
 * grant holders. Keep that paragraph true: it is read as the answer to "how
 * much of this module is still closed to a viewer", and a stale one invites the
 * next author to re-do finished work or to relax something else in its belief.
 */
export function hasInventoryAccess(user: InventoryUser | null | undefined): boolean;
/** @deprecated Pass the user object instead — a role and a branch cannot carry
 *  the fgView grant, so this form silently answers "no" for a viewer. */
export function hasInventoryAccess(role: string, branch: string): boolean;
export function hasInventoryAccess(a: InventoryUser | string | null | undefined, b?: string): boolean {
  if (typeof a === "string") return hasOfficeInventoryAccess(a, String(b ?? ""));
  return canSeeInventoryModule(a);
}

export async function canAccessInventory(): Promise<boolean> {
  return canSeeInventoryModule(await currentUser());
}

export interface InventoryGate {
  ok: boolean;
  status: number; // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
}

/** Server gate for every /api/inventory route that WRITES, and the write-strength
 * answer generally. Revalidates the session (active + sessionVersion via
 * currentUser) and enforces role+branch. A view-grant login is refused here:
 * the grant says "may look", and this is the gate on everything else. */
export async function inventoryGate(): Promise<InventoryGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null };
  if (!canWriteInventory(user)) return { ok: false, status: 403, user };
  return { ok: true, status: 200, user };
}

/** Server gate for the /api/inventory routes that only READ — everyone
 * inventoryGate admits, plus a view-grant login on any branch. Sales stays
 * refused, exactly as it is by inventoryGate: the summary is its surface.
 *
 * No handler behind this gate may change a row of its own. If one grows a
 * write — anything a caller asks for, anything shaped by a query parameter,
 * anything with an actor to record — it moves back to inventoryGate rather
 * than growing a second check here.
 *
 * AND THERE IS EXACTLY ONE WRITE BEHIND THIS GATE ALREADY, WHICH IS WHY THAT
 * SENTENCE SAYS "OF ITS OWN" AND NOT "NOTHING". It said "nothing" when the
 * gate was written on 2026-09-14, and it was not true the day it was written:
 * the slabs list and the KPI strip (src/app/api/inventory/route.ts and
 * .../kpi/route.ts) each await sweepExpiredReservations() before reporting, and
 * that helper releases every RESERVED slab whose hold has already lapsed, then
 * logs a slab_event for each one. A viewer's page load therefore does write
 * rows. Naming it here is the honest version of the promise, because a future
 * author placing a handler under this gate will read this comment and not the
 * two handlers.
 *
 * IT IS ALLOWED TO BE THE EXCEPTION BECAUSE A VIEWER CANNOT AIM IT. The clock
 * picks the rows, not the caller: the helper takes no arguments, no actor and
 * no read-only mode, it only lets go of holds that had already expired before
 * the request arrived, it is idempotent under its per-row guards, and it logs
 * the change as "Auto-expiry" with changedBy null. Finance, Accounts and
 * Commercial fire the identical writes on every dashboard load, and the
 * Commercial stock check calls the same helper from
 * src/lib/commercial/inventory-bridge.ts. What the grant promises — that this
 * login has no edit options and changes nothing anybody can trace to it — is
 * intact; what was wrong was the absolute wording.
 *
 * IT CANNOT TAKE THE REMEDY THE PARAGRAPH ABOVE PRESCRIBES, EITHER. Moving
 * those two handlers "back to inventoryGate" would revoke the grant this whole
 * change exists to deliver: the slabs table and its KPIs ARE the read surface
 * the owner asked for. Skipping the sweep for a viewer was the other candidate
 * and is worse — one login would then see lapsed holds still sitting as
 * RESERVED while every other login sees them released, which is a wrong answer
 * on the screen rather than an over-strict comment.
 *
 * So the rule for the next handler placed here is: no write of your own, and if
 * you need lapsed holds cleared, await that same helper rather than writing
 * anything yourself. tests/inventoryViewerAccess.test.ts reads the read-gated
 * handlers and this comment together, and fails on any other writing helper
 * reached from them — including this one, if its name ever leaves this
 * paragraph while the handlers still call it. */
export async function inventoryReadGate(): Promise<InventoryGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null };
  if (!canReadInventory(user)) return { ok: false, status: 403, user };
  return { ok: true, status: 200, user };
}

/** Gate for the read-only stock summary — inventory roles PLUS Sales, and a
 * view-grant login, which reads this surface like any other. */
export async function summaryGate(): Promise<InventoryGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null };
  if (!canSeeInventoryModule(user)) return { ok: false, status: 403, user };
  return { ok: true, status: 200, user };
}
