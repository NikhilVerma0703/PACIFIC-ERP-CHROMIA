import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Alias-free relative import with an explicit extension: `node --test` resolves
// neither the `@/` alias nor next-auth, which is why the rules about this grant
// live in an import-free module. See src/lib/inventory/accessRules.ts.
import {
  mayGrantFgView,
  hasFgView,
  canReadInventory,
  canWriteInventory,
} from "../src/lib/inventory/accessRules.ts";

// THE ADMINISTRATIVE HALF OF THE FINISHED-GOODS VIEW GRANT.
//
// The rule that reads the grant is pinned by tests/inventoryViewerAccess.test.ts
// and the path it takes through the session by tests/fgViewRequestPath.test.ts.
// Both of those ask what the flag DOES once somebody holds it. This file asks
// the question neither of them can fail on: whether an admin can see who holds
// it, and take it back.
//
// That is not a nicety, it is the argument scripts/0083-fg-view-grant.sql makes
// for the column existing at all: "It is one boolean, it defaults to false, and
// it is visible in Users & Roles next to the person it belongs to rather than
// buried in a role table that somebody later widens for an unrelated reason."
// A per-login boolean was chosen OVER a role because of where it would show up.
// A grant that never reaches that screen is the buried-in-a-table failure the
// script set out to avoid, reproduced one column over — and it is worse there,
// because src/auth.ts records that a revocation only takes effect if
// users.session_version is bumped in the same breath, which is a thing Users &
// Roles does automatically for a role and nothing does for hand-written SQL.
//
// Two halves, the way the grant's other tests are built.
//
// The first is a rule on two strings — who may move the grant — and is exercised
// directly. The second is the wiring: four files in a row, each of which used to
// hold a closed list that the column fell out of (the list select, the row type,
// the page's row literal, the table's cells). None of them can be imported here
// — Prisma, next-auth and the App Router all arrive with them — so that half is
// read out of the source, in the style of tests/fgViewRequestPath.test.ts and
// tests/creditNoteRoleGate.test.ts. Reading the real files is the point: a
// paraphrase of the pipeline in this test would be one more copy to drift.

const src = (rel: string) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const USERS_LIB = src("src/lib/users.ts");
const PAGE = src("src/app/admin/users/page.tsx");
const ADMIN_UI = src("src/app/admin/users/UserAdmin.tsx");
const ACTIONS = src("src/app/admin/users/actions.ts");
const ACCESS = src("src/lib/inventory/access.ts");

// ---------------------------------------------------------------------------
// WHO MAY MOVE THE GRANT
// ---------------------------------------------------------------------------

test("an admin may hand the grant out on any branch the screen lists", () => {
  // The two the owner named, on the branches they actually sit on.
  assert.equal(mayGrantFgView("ADMIN", "CHROMIA"), true);
  assert.equal(mayGrantFgView("ADMIN", "FABRICATION"), true);
  // And anywhere else, because the grant is per login and the branch is not
  // part of what it means — the same reason canReadInventory ignores it.
  for (const b of ["OFFICE", "SHOP_FLOOR", "A_BRANCH_INVENTED_LATER"]) {
    assert.equal(mayGrantFgView("ADMIN", b), true, `an admin may grant it on ${b}`);
  }
});

test("nobody below an admin may, however senior they are on their own branch", () => {
  // canManageTarget lets a LINE_MANAGER manage the ranks below them inside their
  // own department, which is right for a password reset and too wide for this:
  // finished goods is an OFFICE module, and a shop-floor manager handing it to
  // their own incharges would widen an OFFICE module from the shop floor, one
  // grant at a time, with no admin ever seeing it happen.
  for (const role of ["LINE_MANAGER", "INCHARGE", "FINANCE", "ACCOUNTS", "COMMERCIAL", "SALES", "OPERATOR", "", "admin"]) {
    assert.equal(mayGrantFgView(role, "CHROMIA"), false, `${role || "(blank)"} must not be able to grant finished-goods visibility`);
  }
  assert.equal(mayGrantFgView(null, "CHROMIA"), false);
  assert.equal(mayGrantFgView(undefined, "CHROMIA"), false);
});

test("International Sales is refused in this direction too", () => {
  // setAltContext refuses those logins a second job for a related reason: their
  // duty model is their own, and seven of their route handlers judge a request
  // by the raw session rather than currentUser(). A SALES-role login would fail
  // canReadInventory anyway (summary-only), but REPORTING_MANAGER and SALES_ADMIN
  // ride on LINE_MANAGER and would not — so the refusal is made where it shows.
  assert.equal(mayGrantFgView("ADMIN", "INTERNATIONAL_SALES"), false);
});

test("moving the grant is not the same question as honouring one", () => {
  // mayGrantFgView gates the WRITE. It must not become another way of asking
  // whether a login reads finished goods, or the two would drift: a grant made
  // by hand in SQL — which is how the first two were made, since scripts/0083
  // deliberately writes no UPDATE — is honoured by hasFgView exactly as before.
  const viewer = { role: "LINE_MANAGER", branch: "CHROMIA", fgView: true };
  assert.equal(hasFgView(viewer), true);
  assert.equal(canReadInventory(viewer), true);
  // And the grant an admin hands out is still the read-only one. If this ever
  // flips, the answer to "full visibility but no edit options" changed.
  assert.equal(canWriteInventory(viewer), false);
});

// ---------------------------------------------------------------------------
// THE WIRING — four closed lists, and the column has to survive all four
// ---------------------------------------------------------------------------

test("the directory query carries the grant onto every row", () => {
  assert.match(USERS_LIB, /fgView: boolean;/, "UserRow must declare the grant, or the screen cannot be handed it");
  assert.match(USERS_LIB, /fgView: fgViewers\.has\(u\.id\)|fgView: !!u\.fgView/, "listUsersRows must map the grant onto each row");
});

test("and it is read on its own, so its absence cannot take the whole screen down", () => {
  // USER_LIST_SELECT is the one query Users & Roles depends on, and page.tsx
  // answers a throw from it by rendering "Database migration required" INSTEAD
  // OF the user list. Put fg_view in that select and a database where
  // scripts/0083 has not been applied loses the entire screen over a flag two
  // people hold. A query of its own fails on its own and degrades to "nobody
  // holds the grant", which is what the screen showed the day before the grant
  // existed — the same shape the alt_role pair uses two functions further down.
  const listSelect = USERS_LIB.slice(USERS_LIB.indexOf("const USER_LIST_SELECT"), USERS_LIB.indexOf("} as const;"));
  assert.doesNotMatch(listSelect, /fgView/, "fg_view belongs in its own guarded read, not on USER_LIST_SELECT");
  assert.match(USERS_LIB, /SELECT id FROM users WHERE fg_view/, "the guarded read is also the only consumer of the partial index scripts/0083 created for it");
});

test("the page hands the whole row on rather than a second column list", () => {
  // This hop is where the column actually fell out: the row type was written
  // out inline and ended at altBranch, while the map below it spreads every
  // field the query fetched. The literal narrowed what the client was allowed
  // to see, silently, one line after the fetch that had already read it.
  const decl = PAGE.slice(PAGE.indexOf("let rows:"), PAGE.indexOf("let migrateNeeded"));
  assert.ok(
    /Omit<UserRow/.test(decl) || /fgView/.test(decl),
    "the rows type must derive from UserRow (or name fgView itself), or the next column added will fall out here too",
  );
});

test("Users & Roles shows the grant, and offers a way to take it back", () => {
  assert.match(ADMIN_UI, /<th className="py-2 pr-4">Finished goods<\/th>/, "the list needs a column for the grant — that visibility is why scripts/0083 chose a column over a role");
  assert.match(ADMIN_UI, /u\.fgView/, "and a body cell that actually reads it");
  // The revoke half. A control that can only ever say yes leaves the screen
  // exactly as unable to take the grant back as hand-written SQL was.
  // Bounded by the Status cell that follows it. Both anchors are chosen to be
  // unique: `{u.active ?` also matches the row's own `${u.active ?` template
  // higher up, and `text-green-600` the create form's message, and either would
  // slice backwards into an empty string that matches nothing and proves it.
  const cell = ADMIN_UI.slice(ADMIN_UI.indexOf("canGrantFg ? ("), ADMIN_UI.indexOf(">Active<"));
  assert.ok(cell.length > 0, "the finished-goods cell must sit before the Status cell");
  assert.match(cell, /setFgView\(u\.id, /, "the control must call the server action");
  assert.match(cell, /value=""/, "and must offer 'none', which is the revoke");
  // Drawn exactly where the server would accept it — the same function, not a
  // second copy of the rule. The Row used to render buttons the server refused.
  assert.match(ADMIN_UI, /mayGrantFgView\(myRole, u\.branch\)/, "the control must be gated by the same rule the action checks");
});

test("every column this table adds has a header AND a cell", () => {
  // Not a style rule. UserAdmin.tsx records what happened the last time it was
  // broken: "The header has always rendered 'Second role'; the body never did,
  // so every column from Status rightwards sat one place left of its heading."
  // Both halves of each conditional column are counted here so the next one
  // cannot land half-finished.
  const headers = ADMIN_UI.slice(ADMIN_UI.indexOf("<thead>"), ADMIN_UI.indexOf("</thead>"));
  const body = ADMIN_UI.slice(ADMIN_UI.indexOf("function Row("));
  const count = (hay: string, re: RegExp) => (hay.match(re) ?? []).length;
  assert.equal(
    count(headers, /\{!sales && <th/g), count(body, /\{!sales && <td/g),
    "the factory-side columns must have as many body cells as headings",
  );
  assert.equal(
    count(headers, /\{sales && <th/g), count(body, /\{sales && <td/g),
    "and so must the sales-side ones",
  );
});

test("the grant is revoked on every device, not just in the database", () => {
  // src/auth.ts: the flag rides in the JWT because both edge gates are
  // Prisma-free, and this app refreshes a token's claims only at sign-in. Take
  // the column away without bumping users.session_version and the grant keeps
  // working for the rest of an 8-hour token — a revocation that looks done and
  // is not. setAltContext bumps for its analogue; this must too.
  const action = ACTIONS.slice(ACTIONS.indexOf("export async function setFgView"), ACTIONS.indexOf("export async function signOutEverywhere"));
  assert.ok(action.length > 0, "admin/users/actions.ts must expose setFgView — the screen has nothing to call otherwise");
  assert.match(action, /canManageTarget\(id\)/, "the ordinary rules still hold: not yourself, not above your rank, not another department");
  assert.match(action, /mayGrantFgView\(/, "and the narrower rule for this grant on top of them");
  assert.match(action, /setFgViewRecord\(id, (on|grant)\)/);
  // Only an exact `true` grants. The flag arrives over the wire, and every
  // other reader of it — hasFgView, both jwt callbacks, the column's own
  // DEFAULT — treats anything that is not true as no grant.
  assert.match(action, /on === true/, "the posted flag must be narrowed, not trusted");
  assert.match(action, /bumpSessionVersion\(id\)/, "a revocation that does not sign the login out is not a revocation");
});

test("the rules module is still re-exported whole by lib/inventory/access", () => {
  // access.ts promises in its own header that it "imports AND re-exports" every
  // name in accessRules.ts, so `from "@/lib/inventory/access"` keeps working.
  // Server callers take that path; only the client component reaches past it.
  assert.match(ACCESS, /mayGrantFgView/, "access.ts must re-export the new rule like the rest of them");
});
