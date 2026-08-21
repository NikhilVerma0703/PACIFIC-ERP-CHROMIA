import { test } from "node:test";
import assert from "node:assert/strict";
import { maySeeMaterialTrace, maintenanceMayVisit } from "../src/lib/routeCaps.ts";

// /report renders two things: the production run (timings, cycles, mixer
// weights, slab counts, wastage, delays) and, above it, the material-source
// trace — supplier names, invoice numbers, bag numbers, silo numbers and
// per-cycle mix weights. Granting the PAGE to Maintenance granted both, which
// contradicts the same decision's "no batch/slab lookups".

test("the role granted /report does not thereby get the material trace", () => {
  assert.equal(maintenanceMayVisit("/report"), true, "the page is granted");
  assert.equal(maySeeMaterialTrace("MAINTENANCE"), false, "the trace on it is not");
});

test("nobody who could read the trace before loses it", () => {
  // This is the whole reason the check is a DENYLIST. An allowlist would have
  // silently taken the trace away from every role somebody forgot to list, and
  // /report has no page-level gate at all — the roles that reach it are simply
  // the ones no cap turns away, which is most of them.
  for (const role of [
    "ADMIN", "LINE_MANAGER", "INCHARGE", "STORE", "OPERATOR",
    "SALES", "COMMERCIAL", "FINANCE", "ACCOUNTS", "ROBO", "CHROMIA",
    "", "SOMETHING_ADDED_LATER",
  ]) {
    assert.equal(maySeeMaterialTrace(role), true, `${role} must keep the trace`);
  }
});

test("the CEO report is a different page and is not affected", () => {
  // /report/ceo carries no supplier, invoice, bag or silo field — checked when
  // this was written. The trace gate is on /report only; if a trace block is
  // ever added to the CEO report it needs its own call, not this one.
  assert.equal(maintenanceMayVisit("/report/ceo"), true);
});
