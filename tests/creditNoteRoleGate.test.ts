import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The credit-note role gate, guarded from both ends.
//
// The incident: PATCH /api/sales/credit-notes/[id] gained a role check
// (SALES_ADMIN | COMMERCIAL | ACCOUNTS) to stop a salesperson issuing a credit
// note against their own order — but the order page kept drawing Mark
// Inspected / Issue / Reject for anyone who could open the order. Everyone else
// got three live buttons that always answered a bare "Forbidden".
//
// Two rules come out of that, and both are structural (the page is a client
// component whose handlers cannot be imported without a DOM, so these read the
// source in the style of salesOfficeMoneyGuards.test.ts):
//
//   1. the two lists must name the same duties — a button drawn for a role the
//      route refuses is the original bug, and a button withheld from a role the
//      route allows is the mirror of it;
//   2. an UNKNOWN role must not be treated as "no permission". The page learns
//      the duty from /api/sales/me, which can fail; if that failure hid the
//      buttons, a dropped fetch would silently strip Commercial and Accounts of
//      their own job with nothing on screen saying why.
//
// REPORTING_MANAGER is in the list deliberately: the sibling override route,
// orders/[id]/payment-division, already lets an RM waive an entire ADVANCE
// division — uncapped money the company never receives. Refusing them the
// smaller concession here left an SP's bad note with nobody above them able to
// reject it. If you remove RM from either list, remove it from both and say
// here why the payment-division route may still trust them.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const routeSrc = read("src", "app", "api", "sales", "credit-notes", "[id]", "route.ts");
const pageSrc = read("src", "app", "sales", "orders", "[id]", "page.tsx");
const divisionSrc = read("src", "app", "api", "sales", "orders", "[id]", "payment-division", "route.ts");

/** The string literals of a `const NAME = [ ... ]` array declaration. */
function roleList(source: string, name: string): string[] {
  const at = source.indexOf(`const ${name}`);
  assert.notEqual(at, -1, `${name} must still exist — the gate is expressed as a named list on purpose`);
  // Start at the `=`, not at `at`: the page annotates the const as
  // `readonly string[]`, whose own brackets would otherwise be read as an empty
  // array and make this test pass by comparing nothing to nothing.
  const eq = source.indexOf("=", at);
  const body = source.slice(source.indexOf("[", eq) + 1, source.indexOf("]", eq));
  return [...body.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
}

test("the buttons on the order page are drawn for exactly the duties the route accepts", () => {
  assert.deepEqual(
    roleList(pageSrc, "CN_LIFECYCLE_ROLES"),
    roleList(routeSrc, "CN_EDIT_ROLES"),
    "the page's button gate and the PATCH gate must name the same duties — they drifted once and every non-listed user got three buttons that always 403'd",
  );
});

test("SALESPERSON may not move a credit note along, but the other sales duties may", () => {
  const allowed = roleList(routeSrc, "CN_EDIT_ROLES");
  assert.ok(
    !allowed.includes("SALESPERSON"),
    "a salesperson issuing their own credit note against their own order is the hole this gate was cut for",
  );
  for (const duty of ["SALES_ADMIN", "COMMERCIAL", "ACCOUNTS", "REPORTING_MANAGER"]) {
    assert.ok(allowed.includes(duty), `${duty} must be able to inspect/issue/reject`);
  }
});

test("a Reporting Manager who may waive a whole installment may also reject a credit note", () => {
  assert.match(
    divisionSrc, /salesRole !== "REPORTING_MANAGER"/,
    "this test's premise: payment-division still lets an RM waive an ADVANCE division",
  );
  assert.ok(
    roleList(routeSrc, "CN_EDIT_ROLES").includes("REPORTING_MANAGER"),
    "an RM trusted with an uncapped waiver — money never received — cannot coherently be refused the smaller credit-note decision",
  );
});

test("an unknown sales role shows the buttons rather than pre-refusing", () => {
  assert.match(
    pageSrc, /userSalesRole === null \|\| CN_LIFECYCLE_ROLES\.includes\(userSalesRole\)/,
    "null means /api/sales/me has not answered (or failed), not 'no permission' — hiding on unknown would refuse legitimate work every time that fetch drops, and the PATCH refuses the click anyway",
  );
});

test("a user who may not act is told who can, on the states that can still move", () => {
  assert.match(
    pageSrc, /!mayEditCN && \(cn\.status === "PENDING_INSPECTION" \|\| cn\.status === "INSPECTED"\)/,
    "the hint replaces the buttons only while the note is still waiting on somebody; ISSUED and REJECTED are terminal for every duty",
  );
  assert.match(
    pageSrc, /Commercial \/ Accounts \/ RM/,
    "an empty corner reads as 'nothing left to do here' — the row must name whose job it is",
  );
  assert.match(
    routeSrc, /CN_ROLE_FORBIDDEN/,
    "the 403 must carry a message naming the duties: when the page guesses generously and lets a click through, this is all the clerk sees",
  );
});
