import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Alias-free relative import with an explicit extension: `node --test` resolves
// neither the `@/` alias nor React. See src/lib/inventory/dashboardView.ts.
import {
  inventoryDashboardView,
  type InventoryViewAs,
  type InventoryDashboardGrant,
} from "../src/lib/inventory/dashboardView.ts";
// The fence itself, imported for the same reason the rule is: it is pure and
// import-free (see the head of lib/routeCaps.ts), and the question "may a
// viewer follow this link" is one half fence and one half screen. Asking the
// real function rather than restating where the grant reaches is what stops
// this file from becoming the second copy routeCaps exists to abolish.
import { fgViewMayVisit } from "../src/lib/routeCaps.ts";

// THE FINISHED-GOODS SCREEN UNDER THE VIEW GRANT, pinned from both ends.
//
// The owner, 2026-09-14: "Please add finished good's visibility for
// chromia@thepacific.group, gibin@thepacific.group (full visibility but no edit
// options)". tests/inventoryViewerAccess.test.ts pins who is admitted and which
// gate each route calls. This file pins what the SCREENS then do about it: what
// the dashboard draws, and whether the sidebar offers the link at all.
//
// Two halves again, and again the second one is the half that rots.
//
// The first half is arithmetic on four booleans and is tested directly. It
// lives in a module of its own precisely so that it can be: the alternative was
// three && / || expressions inside a 1500-line client component, where "a
// preview can only ever take things away" is a property nobody can check.
//
// The second half is which controls are actually wrapped in those booleans, and
// no amount of testing the rule catches a Save button somebody hangs outside
// them. The components cannot be imported here — React, next/navigation and the
// whole App Router — so the second half reads the source, in the style of
// inventoryViewerAccess.test.ts and creditNoteRoleGate.test.ts. The list of
// endpoints the dashboard writes to is exhaustive, so a new one is a failure
// until somebody writes down which flag hides its control.

const ALL_VIEWS: InventoryViewAs[] = ["admin", "office", "sales", "commercial", "viewer"];

// The four logins that reach this screen, as the page hands them over.
const asAdmin: InventoryDashboardGrant = { admin: true };
const asOffice: InventoryDashboardGrant = {};                       // Finance / Accounts
const asSales: InventoryDashboardGrant = { summaryOnly: true, readOnly: true };
const asCommercial: InventoryDashboardGrant = { slabsOnly: true };
const asViewer: InventoryDashboardGrant = { readOnly: true };       // chromia@, gibin@

test("a viewer gets the office screen with the writes gone, and nothing else taken away", () => {
  const v = inventoryDashboardView(asViewer, "admin");
  assert.equal(v.readOnly, true);
  // NOT summaryOnly and NOT slabsOnly, and that is the whole point of the
  // fourth flag existing. Both of those hide screens — the slab table, the
  // tabs, the KPI strip, Stock by Design — and the grant was "full
  // visibility". It removes controls; it removes no surface.
  assert.equal(v.summaryOnly, false);
  assert.equal(v.slabsOnly, false);
  assert.equal(v.admin, false);
});

test("the other four logins are exactly what they were before the grant existed", () => {
  // The regression pin. These four answers were three lines of && and || in
  // InventoryDashboard; moving them here must not have moved any of them.
  assert.deepEqual(inventoryDashboardView(asAdmin, "admin"), { admin: true, summaryOnly: false, slabsOnly: false, readOnly: false });
  assert.deepEqual(inventoryDashboardView(asOffice, "admin"), { admin: false, summaryOnly: false, slabsOnly: false, readOnly: false });
  assert.deepEqual(inventoryDashboardView(asCommercial, "admin"), { admin: false, summaryOnly: false, slabsOnly: true, readOnly: false });
  // Sales is summary-only as it always was. `readOnly` is newly true for it and
  // changes nothing on screen today: the summary view has no control that
  // posts. It is set because a SALES login genuinely cannot write here —
  // canWriteInventory refuses SUMMARY_ONLY_ROLES — and the day a control is
  // added to that screen, this is what keeps it away from Sales.
  assert.deepEqual(inventoryDashboardView(asSales, "admin"), { admin: false, summaryOnly: true, slabsOnly: false, readOnly: true });
});

test("the admin preview shows each role's screen, the viewer's included", () => {
  assert.deepEqual(inventoryDashboardView(asAdmin, "office"), { admin: false, summaryOnly: false, slabsOnly: false, readOnly: false });
  assert.deepEqual(inventoryDashboardView(asAdmin, "sales"), { admin: false, summaryOnly: true, slabsOnly: false, readOnly: true });
  assert.deepEqual(inventoryDashboardView(asAdmin, "commercial"), { admin: false, summaryOnly: false, slabsOnly: true, readOnly: false });
  // The point of adding the option at all: the owner asked for a screen for two
  // named people and can now look at it without signing in as either of them.
  // It must be the office screen minus the controls — the same object the two
  // real logins resolve to, which is what this comparison says.
  assert.deepEqual(inventoryDashboardView(asAdmin, "viewer"), inventoryDashboardView(asViewer, "admin"));
});

test("a login that is not an admin cannot preview itself into anything", () => {
  // The select is only rendered for an admin, but `viewAs` is component state
  // and component state is not a security boundary. Every preview term in the
  // rule is AND'd with the login's own admin flag, so for everybody else the
  // granted flags come back whatever the select says.
  for (const view of ALL_VIEWS) {
    assert.deepEqual(inventoryDashboardView(asViewer, view), inventoryDashboardView(asViewer, "admin"), `viewer must not shift on ${view}`);
    assert.deepEqual(inventoryDashboardView(asOffice, view), inventoryDashboardView(asOffice, "admin"), `office must not shift on ${view}`);
    assert.deepEqual(inventoryDashboardView(asCommercial, view), inventoryDashboardView(asCommercial, "admin"), `commercial must not shift on ${view}`);
    assert.deepEqual(inventoryDashboardView(asSales, view), inventoryDashboardView(asSales, "admin"), `sales must not shift on ${view}`);
  }
});

test("a preview only ever takes away — across every grant and every option", () => {
  // Exhaustive over the sixteen grants and the five options. A restriction the
  // login was granted is never lifted by previewing, and `admin` — the one flag
  // that opens rather than closes — is never true for a login that is not one.
  for (const admin of [false, true]) {
    for (const summaryOnly of [false, true]) {
      for (const slabsOnly of [false, true]) {
        for (const readOnly of [false, true]) {
          const grant = { admin, summaryOnly, slabsOnly, readOnly };
          for (const view of ALL_VIEWS) {
            const v = inventoryDashboardView(grant, view);
            const where = `${JSON.stringify(grant)} as ${view}`;
            if (summaryOnly) assert.equal(v.summaryOnly, true, `summaryOnly lifted: ${where}`);
            if (slabsOnly) assert.equal(v.slabsOnly, true, `slabsOnly lifted: ${where}`);
            if (readOnly) assert.equal(v.readOnly, true, `readOnly lifted: ${where}`);
            if (!admin) assert.equal(v.admin, false, `admin invented: ${where}`);
          }
        }
      }
    }
  }
});

test("admin and read-only are never both true, which is what the bare `admin &&` controls rest on", () => {
  // Half a dozen controls in the dashboard are drawn behind a bare `admin &&`:
  // the Designs tab and its merge, the slab Edit button, the Excel export, the
  // approve boxes on Stock by Design. None of them carries a second condition,
  // and this is why they do not need one. Without this ordering they would be
  // safe only by the accident that ROLE_RANK has nothing above ADMIN — add a
  // role above it that does not also pass the office rule and every one of
  // those controls appears for a login the server refuses.
  for (const admin of [false, true]) {
    for (const summaryOnly of [false, true]) {
      for (const slabsOnly of [false, true]) {
        for (const readOnly of [false, true]) {
          for (const view of ALL_VIEWS) {
            const v = inventoryDashboardView({ admin, summaryOnly, slabsOnly, readOnly }, view);
            assert.ok(!(v.admin && v.readOnly), `admin and readOnly together: ${JSON.stringify({ admin, summaryOnly, slabsOnly, readOnly })} as ${view}`);
          }
        }
      }
    }
  }
});

// And which controls the screens actually wrap in those flags.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const DASHBOARD = read("src", "components", "inventory", "InventoryDashboard.tsx");
const PAGE = read("src", "app", "inventory", "page.tsx");
const SHELL = read("src", "components", "Shell.tsx");
const NAV = read("src", "components", "Nav.tsx");

/** A file with its comments stripped. These files carry long prose comments
 *  that name the very functions the assertions below forbid — the page explains
 *  at length why it does NOT ask hasFgView — so an assertion about what the code
 *  does must not be answered by a sentence about what it does not. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every endpoint the dashboard CHANGES something through, and the flag whose
 *  falsity removes the control that calls it. `readOnly` hides the selection
 *  action panel; `admin` hides the Designs tab and the slab Edit form, and the
 *  test above is what makes `admin` sufficient — an admin is never read-only. */
const WRITE_CONTROLS: Record<string, "readOnly" | "admin"> = {
  "/api/inventory/dispatch": "readOnly",
  "/api/inventory/location": "readOnly",
  "/api/inventory/status": "readOnly",
  "/api/inventory/designs": "admin",
  "/api/inventory/slab/edit": "admin",
};

/** The endpoints a file fetches with a method other than GET, read off its own
 *  source. Split on `fetch(` so each chunk ends where the next call begins, and
 *  look only at the head of the chunk, which is the call's own options object. */
function writeEndpoints(source: string): string[] {
  const found = new Set<string>();
  for (const chunk of source.split("fetch(").slice(1)) {
    const url = /^\s*[`"']([^`"'?]+)/.exec(chunk);
    if (!url) continue;
    if (/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(chunk.slice(0, 200))) found.add(url[1]);
  }
  return [...found].sort();
}

test("the dashboard writes to exactly the endpoints whose controls are accounted for", () => {
  // Exhaustive on purpose. A control added to this component that posts
  // somewhere new fails here until somebody records which flag hides it from a
  // viewer — which is the moment to think about it, rather than after two
  // logins that were promised "no edit options" have been handed one.
  assert.deepEqual(writeEndpoints(DASHBOARD), Object.keys(WRITE_CONTROLS).sort());
});

test("the panel that moves, dispatches and re-statuses slabs is not rendered for a viewer", () => {
  // Not `disabled`, not hidden by CSS: not rendered. A greyed Apply still tells
  // somebody the action is theirs to ask for, and still ships the handler that
  // asks it down to a browser that was never meant to have one.
  assert.match(DASHBOARD, /\{sel\.size > 0 && !readOnly && \(/);
  assert.equal(DASHBOARD.includes("disabled={readOnly"), false, "a viewer's controls must be absent, not disabled");
});

test("the two admin-only write controls are still admin-only", () => {
  // The Designs tab (merge and un-merge) and the slab detail's Edit form. Both
  // keep the gate they had; what makes that gate enough for a viewer is that
  // `admin` and `readOnly` cannot both be true.
  assert.match(DASHBOARD, /view === "designs" && admin/);
  assert.match(DASHBOARD, /\{admin && detail\.slab && !editing && \(/);
  // And the approve boxes on Stock by Design, the third of the writes the owner
  // named, which the dashboard hands down rather than drawing itself.
  assert.match(DASHBOARD, /canApprove=\{admin\}/);
});

/** Every page or API the dashboard LINKS OUT to, and what keeps each link off a
 *  viewer's screen. "grant" means the destination is inside the two prefixes
 *  fgViewMayVisit admits, so a viewer may follow it and nothing need hide it;
 *  the other two name the flag whose falsity removes the link.
 *
 *  Exhaustive, like WRITE_CONTROLS above and for a sharper reason. A control
 *  that POSTS somewhere a viewer may not write is refused by the route gate,
 *  in place, with the person still on the screen. A LINK somewhere a viewer may
 *  not go is refused by middleware, which does not answer in place: it redirects
 *  to /no-access and takes them off the module they were granted. So a new href
 *  in this component fails here until somebody records whether a viewer may
 *  follow it — which is the moment to decide, rather than after two people who
 *  were promised full visibility have been bounced out of it by a button. */
const OUTBOUND_LINKS: Record<string, "grant" | "readOnly" | "admin"> = {
  // The Excel export and the stored invoice PDF. Both are reads under
  // /api/inventory, both are inside the grant, and neither needs a flag.
  "/api/inventory/export": "grant",
  "/api/inventory/invoice": "grant",
  // The QC record in the Tables browser. Drawn only inside the Edit form, which
  // is reached only from a button behind `admin && detail.slab && !editing` —
  // and admin and readOnly are never both true, which the test above pins.
  "/tables/PolishQc/": "admin",
  // The production timeline. Outside the fence on purpose — see the comment on
  // the button itself, and the /slab entry in tests/fgViewRequestPath.test.ts —
  // so the button is not drawn for the logins that pressing it would redirect
  // off the module.
  "/slab": "readOnly",
};

/** The literal head of every href in a file: up to the first interpolation,
 *  query string or closing quote. That head is the part middleware matches a
 *  path cap against, so it is the part worth recording. */
function linkTargets(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/href=\{?[`"]([^`"$?]+)/g)) found.add(m[1]);
  return [...found].sort();
}

test("the dashboard links out to exactly the destinations that are accounted for", () => {
  assert.deepEqual(linkTargets(code(DASHBOARD)), Object.keys(OUTBOUND_LINKS).sort());
});

test("EVERY LINK A VIEWER IS SHOWN LEADS SOMEWHERE A VIEWER MAY GO", () => {
  // The join between this screen and the fence, asserted in both directions so
  // neither can move without the other. A destination recorded as inside the
  // grant that is later moved out of it fails here, and so does one recorded as
  // hidden that later comes inside it and should stop being hidden.
  for (const [target, hidden] of Object.entries(OUTBOUND_LINKS)) {
    assert.equal(fgViewMayVisit(target), hidden === "grant", `${target} is recorded as "${hidden}"`);
  }
});

test("the production timeline button is not drawn for a viewer", () => {
  // What this stops, exactly: gibin@ opens /inventory, clicks slab 41207,
  // presses "Full production timeline" and lands on /no-access?from=/slab —
  // from a button the module drew for him on the screen he had just been
  // granted. The button carried the MANUAL_ENTRY test and no access test at
  // all, and /slab is outside the two prefixes fgViewMayVisit admits, so both
  // branch caps in middleware.ts refuse it.
  //
  // It takes the button from nobody who could follow it. Every other login that
  // can open this panel — an admin on any branch, Finance and Accounts on
  // OFFICE, and Commercial through its own under("/slab") allowance — passes
  // canWriteInventory and is therefore not readOnly. Sales is readOnly and is
  // summary-only, so it never opens the panel in the first place.
  assert.ok(
    DASHBOARD.includes('{!readOnly && detail.slab?.source !== "MANUAL_ENTRY" && ('),
    "the production timeline button must be drawn behind !readOnly"
  );
  // ...and it must still be drawn, for the logins that can follow it. A guard
  // that removed the button outright would pass the line above and quietly take
  // a working link away from Finance, Accounts and Commercial.
  assert.ok(DASHBOARD.includes("Full production timeline"), "and it must survive for everybody else");
  // And the admin preview of the viewer's screen hides it too, which is free:
  // inventoryDashboardView gives `viewer` and `sales` readOnly, so the owner
  // looking at the preview sees the panel the two logins actually get.
  assert.equal(inventoryDashboardView(asAdmin, "viewer").readOnly, true);
});

test("the view-as dropdown is EXACTLY what it was before the grant — no viewer option", () => {
  // The first cut of the grant added a fifth option here so the owner could
  // preview the viewer's screen. He saw it the same day and asked for the
  // screen to be put back ("Why has the UI changed for finished goods. Please
  // revert it back", 2026-09-14): for every login that already had finished
  // goods, that option was the ONLY visible change the grant made, and it was
  // not asked for. So it is pinned absent. inventoryDashboardView still
  // understands "viewer" (the test above relies on it) — that is a pure rule
  // with no control attached to it, and the grant's own rendering does not go
  // through the dropdown at all.
  assert.doesNotMatch(DASHBOARD, /<option value="viewer">/, "the viewer preview option was reverted at the owner's request");
  // And the four that were always there still are, in the same select.
  for (const v of ["admin", "office", "sales", "commercial"]) {
    assert.ok(DASHBOARD.includes(`<option value="${v}">`), `the ${v} preview option must survive`);
  }
});

test("the page sources the flag from the write rule, not from the column", () => {
  // `!canWriteInventory(user)` and not `hasFgView(user)`: the predicate the
  // screen hides controls by is the one inventoryGate() runs on every write
  // route, so the two cannot come to disagree, and an Accounts login handed the
  // flag as well keeps its buttons because it still passes the write rule.
  assert.match(PAGE, /readOnly = !canWriteInventory\(await currentUser\(\)\)/);
  assert.match(PAGE, /readOnly=\{readOnly\}/);
  assert.equal(code(PAGE).includes("hasFgView"), false, "the page must ask the write rule, not the column");
});

test("the sidebar asks about the whole login, so the grant can reach it", () => {
  // A role and a branch cannot carry a per-login flag. The two-argument form of
  // hasInventoryAccess is @deprecated for exactly that reason and answers the
  // pre-grant rule, which is why a viewer used to reach /inventory by URL and
  // get no link to it.
  assert.match(SHELL, /hasInventoryAccess\(user\)/);
  assert.equal(/hasInventoryAccess\([^)]*,/.test(code(SHELL)), false, "Shell must pass the user, not role and branch");
});

/** One arm of the Nav switch, from its own `if (` to the next one. */
function navArm(from: string, to: string): string {
  const at = NAV.indexOf(from);
  assert.ok(at > 0, `Nav arm not found: ${from}`);
  const end = NAV.indexOf(to, at + 1);
  assert.ok(end > at, `Nav arm end not found: ${to}`);
  return NAV.slice(at, end);
}

test("both grant holders get the Finished Goods link, and they land on different arms", () => {
  // chromia@ is a LINE_MANAGER on the CHROMIA branch, so it takes the Chromia
  // whole-nav takeover — which carried no inventory row at all until the grant,
  // because nothing on that branch had ever held the module. Without a row
  // there the answer would have shipped as a page reachable only by URL.
  const chromiaArm = navArm('if (role === "CHROMIA" || (!isAdmin && branch === "CHROMIA"))', 'if (role === "SAMPLING")');
  assert.ok(chromiaArm.includes('label: "Finished Goods"'), "the Chromia arm must offer Finished Goods");
  assert.match(chromiaArm, /inventory \? \[\{ href: "\/inventory"/);
  // Gated, not unconditional: a Chromia line tablet holds no grant and must see
  // no such row. On this arm `inventory` can only be true for a grant holder —
  // no CHROMIA-branch login passes the office role+branch rule, and an admin
  // never reaches this arm.
  assert.match(chromiaArm, /\{\(inventory \|\| slabIntake\) &&/);

  // gibin@ is a LINE_MANAGER on FABRICATION, which falls through every arm to
  // the shop-floor nav at the foot of the file. That one already had the row
  // behind the same flag, so the grant needed nothing there but a true value.
  const shopFloorArm = NAV.slice(NAV.lastIndexOf('if (branch === "INTERNATIONAL_SALES")'));
  assert.ok(shopFloorArm.includes('label: "Finished Goods"'), "the shop-floor arm must offer Finished Goods");
  assert.match(shopFloorArm, /inventory \? \[\{ href: "\/inventory"/);
});
