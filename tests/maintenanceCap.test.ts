import { test } from "node:test";
import assert from "node:assert/strict";
import { maintenanceMayVisit } from "../src/lib/routeCaps.ts";

// What the Maintenance Manager may open. A cap is a LIST OF WHAT IS REACHABLE,
// so the half of this file that matters is the refusals: every path asserted
// false below is one somebody decided this login should not see, and a cap that
// quietly widens is indistinguishable from one that was never applied.

test("the screens granted to this role are reachable", () => {
  for (const p of [
    "/",                        // Overview
    "/mis",                     // Downtime report
    "/maintenance",             // Maintenance Log
    "/maintenance/uptime",      // the maintenance half of the scoreboard
    "/report",                  // Production Report
    "/report/ceo",              // CEO daily report
    "/consumables",             // consumables dashboard
    "/api/consumables/kpi",     // the only API any of the above calls
  ]) {
    assert.equal(maintenanceMayVisit(p), true, `${p} should be reachable`);
  }
});

test("the lookups stay closed, because a trace is costing by another name", () => {
  // A batch or slab trace carries per-cycle mix weights, silo and bag numbers,
  // invoice numbers and suppliers. /office/batch-lookup exists precisely
  // because that projection had to be narrowed for the office.
  for (const p of ["/batch", "/batch/slabs", "/slab", "/tables", "/tables/Press", "/records"]) {
    assert.equal(maintenanceMayVisit(p), false, `${p} must stay closed`);
  }
});

test("commercial and payroll screens stay closed", () => {
  for (const p of [
    "/office", "/office/costing", "/office/finance", "/office/batch-lookup",
    "/inventory",   // customer names, PI numbers, dispatch invoices
    "/scoreboard",  // ranks named people and drives the incentive pool
    "/store", "/live", "/entry", "/admin/users",
  ]) {
    assert.equal(maintenanceMayVisit(p), false, `${p} must stay closed`);
  }
});

test("other departments stay closed", () => {
  for (const p of ["/fab/cutting", "/fab/ceo", "/chromia", "/robo", "/sales", "/sales/orders"]) {
    assert.equal(maintenanceMayVisit(p), false, `${p} must stay closed`);
  }
});

test("the API allowance is an allowlist, not a bare /api prefix", () => {
  // The bug this shape exists to avoid, documented on the ROBO cap in
  // middleware.ts: `startsWith("/api")` reads as "and its APIs" and means
  // "and every API in the ERP". Granting a page should not grant the whole
  // fetchable surface behind every other page.
  for (const p of [
    "/api/admin/users", "/api/tables/Press", "/api/inventory", "/api/sales/orders",
    "/api/office/costing", "/api/office/finance", "/api/robo/slabs", "/api/chromia/slabs",
    "/api/scoreboard",
  ]) {
    assert.equal(maintenanceMayVisit(p), false, `${p} must not be reachable`);
  }
  assert.equal(maintenanceMayVisit("/api/consumables/kpi"), true);
});

test("a sibling path is not a subpath", () => {
  // under() is exact-or-subpath. A bare startsWith would hand this capped role
  // every future /maintenance-costs, /report-admin or /consumables-pricing
  // without anybody deciding to — opt-OUT security.
  for (const p of [
    "/maintenance-costs", "/maintenance-admin",
    "/reports", "/report-admin", "/reporting",
    "/consumables-pricing", "/consumablesx",
    "/misc",  // must not be caught by /mis
  ]) {
    assert.equal(maintenanceMayVisit(p), false, `${p} must not be opened by a prefix match`);
  }
  // ...while the real subpaths still work.
  assert.equal(maintenanceMayVisit("/mis/2026-08-18"), true);
  assert.equal(maintenanceMayVisit("/maintenance/uptime"), true);
});

test("the refusal page is reachable, so a refusal cannot bounce off it", () => {
  // Both gates treat /no-access as public before any cap runs, so the app does
  // not depend on this. It is pinned because the FUNCTION is now exported and
  // testable on its own: a caller that trusted it without the public check
  // first would send a refused user to a page this said no to. My own
  // end-to-end harness did exactly that and caught it.
  assert.equal(maintenanceMayVisit("/no-access"), true);
});

test("Overview is exact — the cap does not open the whole site", () => {
  // p === "/" and not startsWith("/"), which would allow everything.
  assert.equal(maintenanceMayVisit("/"), true);
  assert.equal(maintenanceMayVisit("/anything-at-all"), false);
});

test("the API allowance is exact-or-subpath, not a bare prefix", () => {
  // /api/consumables was the one clause written as a bare startsWith - the very
  // shape the comment on the ROBO cap exists to warn about. It would have opened
  // /api/consumables-pricing to this role the day somebody added it.
  assert.equal(maintenanceMayVisit("/api/consumables"), true);
  assert.equal(maintenanceMayVisit("/api/consumables/kpi"), true);
  assert.equal(maintenanceMayVisit("/api/consumables-pricing"), false);
  assert.equal(maintenanceMayVisit("/api/consumablesx"), false);
});

test("a query string never changes the answer", () => {
  // Only exact() knew about "?"; under() and the raw comparisons did not, so the
  // same page could be allowed without a query and refused with one.
  for (const [a, b] of [
    ["/", "/?tab=x"],
    ["/consumables", "/consumables?category=All"],
    ["/report", "/report?b=D1310"],
    ["/mis/2026-08-18", "/mis/2026-08-18?shift=A"],
    ["/api/consumables/kpi", "/api/consumables/kpi?from=2026-08-01"],
    ["/tables", "/tables?model=Press"],
    ["/scoreboard", "/scoreboard?from=2026-08-01"],
  ]) {
    assert.equal(maintenanceMayVisit(a), maintenanceMayVisit(b), `${a} vs ${b}`);
  }
  // ...and the exact clauses stay exact once the query is stripped.
  assert.equal(maintenanceMayVisit("/api/photo?id=abc"), true);
  assert.equal(maintenanceMayVisit("/api/mis/export?from=2026-08-01"), true);
  assert.equal(maintenanceMayVisit("/api/mis/exporter?x=1"), false);
});
