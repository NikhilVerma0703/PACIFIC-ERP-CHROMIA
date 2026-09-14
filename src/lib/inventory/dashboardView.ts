// What the finished-goods dashboard SHOWS, as arithmetic on four booleans.
//
// PURE AND IMPORT-FREE, the same rule ./accessRules.ts follows and for the same
// reason: `node --test` resolves neither the `@/` alias nor React, and the
// question "does this login get a Save button" is worth pinning in a test that
// runs in a tenth of a second rather than in a rendering harness this repo does
// not have. tests/inventoryDashboardView.test.ts is that test.
//
// FOUR FLAGS, AND WHY THE FOURTH EXISTS. Three of them were already there and
// mean what they always meant: `admin` is the full office login plus approvals,
// Designs and the Excel export; `summaryOnly` is Sales, which gets Stock by
// Design and nothing else; `slabsOnly` is Commercial, which gets the slab table
// and the two actions it dispatches with. The fourth, `readOnly`, arrived on
// 2026-09-14 with the owner's "Please add finished good's visibility for
// chromia@thepacific.group, gibin@thepacific.group (full visibility but no edit
// options)" — a login that sees the whole module and may press none of it.
//
// THE FOURTH IS NOT A NARROWER VIEW, IT IS THE SAME VIEW WITH THE WRITES GONE.
// summaryOnly and slabsOnly take screens away; readOnly takes no screen, no
// filter, no card and no column away from anybody. It removes controls, and it
// removes them by not rendering them rather than by disabling them: a greyed
// Apply button still announces that the action exists and still ships its
// handler down to a browser that was never meant to have it. See
// scripts/0083-fg-view-grant.sql for why the grant is a per-login column, and
// ./accessRules.ts for the rule that decides who carries it.
//
// WHERE readOnly COMES FROM, WHICH IS THE PART THAT MUST NOT DRIFT. The page
// sets it to `!canWriteInventory(user)` — the very predicate inventoryGate()
// runs on every write route. So the screen hides exactly the controls the
// server would refuse, and it does so by construction rather than by two lists
// being kept in step by hand. A login that gains the write rule later gains the
// buttons on the same render, and one that loses it loses them.

/** The roles an admin can preview the module as, plus "admin" for their own
 *  view. "viewer" is the 2026-09-14 view grant. */
export type InventoryViewAs = "admin" | "office" | "sales" | "commercial" | "viewer";

/** What the SERVER decided about this login, before any preview. Every field
 *  defaults to false, which is the least this module ever shows. */
export interface InventoryDashboardGrant {
  /** Full office login: approvals, the Designs tab, the Excel export. */
  admin?: boolean;
  /** Sales: Stock by Design and nothing else. */
  summaryOnly?: boolean;
  /** Commercial: the slab table, dispatch and CTS. */
  slabsOnly?: boolean;
  /** May read everything here and change none of it — `!canWriteInventory(user)`. */
  readOnly?: boolean;
}

/** The same four questions, answered for the view actually on screen. */
export interface InventoryDashboardView {
  admin: boolean;
  summaryOnly: boolean;
  slabsOnly: boolean;
  readOnly: boolean;
}

/**
 * Resolve what to render from what the login was granted and which role an
 * admin is previewing.
 *
 * A PREVIEW CAN ONLY EVER TAKE THINGS AWAY, and that is structural rather than
 * inspected: every line below is the granted flag OR'd with a preview term, and
 * every preview term is itself AND'd with `real` — the login's own admin flag.
 * A login that is not an admin therefore gets its granted flags back whatever
 * `viewAs` says, so the select that drives this (which is only rendered for an
 * admin in the first place) cannot become a way to widen anything by poking at
 * component state. The one flag that narrows rather than widens, `admin`, is
 * the one that uses AND.
 *
 * SALES PREVIEWS AS READ-ONLY TOO, because a SALES login IS read-only here:
 * canWriteInventory() refuses SUMMARY_ONLY_ROLES before it looks at anything
 * else. Today that changes nothing on screen — the summary view has no control
 * that posts — and it is set anyway so that the day one is added, the preview
 * and the real login still agree about who may press it.
 *
 * READ-ONLY BEATS ADMIN WHEN THE TWO EVER MEET, which is the line in here worth
 * reading twice. Half a dozen controls in the dashboard are drawn behind a bare
 * `admin &&` — the Designs tab and its merge, the slab Edit button, the Excel
 * export, the approve boxes on Stock by Design — and they are safe today only
 * because no login can hold both flags: `admin` comes from isAdmin(), the top
 * of the rank table, and an ADMIN passes canWriteInventory() from any branch,
 * so readOnly is false for it. That is a fact about ROLE_RANK having nothing
 * above ADMIN, not a fact about this module, and a role added above ADMIN
 * later that did not also pass the office rule would silently hand every one of
 * those controls to a login the server refuses. So the flags are ordered here
 * instead: a login that may not write is not admin for the purposes of what
 * this screen draws. It costs nothing today (no real login is both) and it
 * means the `admin &&` controls need no second condition to stay closed.
 */
export function inventoryDashboardView(
  grant: InventoryDashboardGrant,
  viewAs: InventoryViewAs,
): InventoryDashboardView {
  const real = grant.admin === true;
  const previewing = real && viewAs !== "admin";
  const readOnly = grant.readOnly === true || (previewing && (viewAs === "viewer" || viewAs === "sales"));
  return {
    admin: real && viewAs === "admin" && !readOnly,
    summaryOnly: grant.summaryOnly === true || (previewing && viewAs === "sales"),
    slabsOnly: grant.slabsOnly === true || (previewing && viewAs === "commercial"),
    readOnly,
  };
}
