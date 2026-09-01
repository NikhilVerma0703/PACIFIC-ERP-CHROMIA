import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storeMayVisit, operatorMayVisit, isCronRoute, CRON_ROUTES, STORE_HOME, OPERATOR_HOME } from "../src/lib/routeCaps.ts";

// The bug this file exists to prevent: the Store Incharge cap was written out
// twice, in auth.config.ts and in middleware.ts, and the two drifted.
// auth.config allowed only /live, /store and /api; middleware also allowed
// /tables, /consumables and /office/batch-verify. auth.config's `authorized`
// callback runs FIRST, so the staler, stricter list won and three screens the
// role had been granted bounced to /live. Nothing failed loudly — the nav
// rendered the links, the pages existed, the permission checks inside them
// passed, and the click just went nowhere.

test("the store incharge reaches every screen their nav offers", () => {
  for (const p of [
    "/live",
    "/store", "/store/bag", "/store/entry", "/store/resin", "/store/upload", "/store/assign",
    "/tables", "/tables/Rm", "/tables/Rm/new",
    "/consumables", "/consumables/inventory",
    "/office/batch-verify", "/office/batch-verify/D1359",
    "/api/consumables/summary",
  ]) {
    assert.equal(storeMayVisit(p), true, `store should reach ${p}`);
  }
});

test("the store incharge is still kept out of the rest of the office", () => {
  for (const p of [
    "/office", "/office/costing", "/office/finance", "/office/batch-lookup",
    // near-miss on purpose: a future admin screen must not be opened by the
    // batch-verify allowance being a bare prefix
    "/office/batch-verify-admin",
    "/report", "/report/ceo", "/mis", "/maintenance", "/inventory", "/sales/orders",
    "/fab/projects", "/chromia/dashboard", "/robo", "/entry", "/silo", "/batch", "/slab",
  ]) {
    assert.equal(storeMayVisit(p), false, `store should NOT reach ${p}`);
  }
});

test("operators keep their entry forms and the tables behind them", () => {
  for (const p of ["/entry", "/entry/PRESS", "/live", "/tables", "/tables/Rm", "/api/x"]) {
    assert.equal(operatorMayVisit(p), true, `operator should reach ${p}`);
  }
  for (const p of ["/store", "/consumables", "/office/batch-verify", "/report", "/inventory"]) {
    assert.equal(operatorMayVisit(p), false, `operator should NOT reach ${p}`);
  }
});

test("each capped role is sent somewhere it is actually allowed", () => {
  // A cap that redirects to a page its own rule forbids is an infinite loop.
  assert.equal(storeMayVisit(STORE_HOME), true);
  assert.equal(operatorMayVisit(OPERATOR_HOME), true);
});

// The point of routeCaps is that there is ONE list. If either gate grows its
// own inline copy again, this fails — which is the only way to catch a drift
// that produces no error, no log line and no failing request.
test("neither gate keeps a private copy of the caps", () => {
  for (const f of ["src/auth.config.ts", "src/middleware.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /storeMayVisit/, `${f} must use the shared store cap`);
    assert.match(src, /operatorMayVisit/, `${f} must use the shared operator cap`);
    // an inline re-listing of the allowed prefixes is the shape that drifted
    assert.doesNotMatch(
      src,
      /role === "STORE"\)\s*\{[\s\S]{0,400}?startsWith\("\/store"\)/,
      `${f} re-lists the store cap inline instead of importing it`,
    );
  }
});

/* --------------------------------------------------------- the cron routes */

// A scheduled route the login gate does not know about is bounced to /login,
// and a 302 is what Vercel's cron log calls a successful run: the job fires on
// time forever and does nothing, with no error anywhere. The slab intake digest
// shipped that way. So the schedule itself is the test — every path in
// vercel.json has to be a path the gate lets through.

test("EVERY SCHEDULED PATH IN vercel.json PASSES THE LOGIN GATE", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  const crons = vercel.crons ?? [];
  assert.ok(crons.length > 0, "vercel.json should still declare crons");
  for (const c of crons) {
    assert.equal(isCronRoute(c.path), true,
      `${c.path} is scheduled "${c.schedule}" but the login gate would redirect it to /login`);
  }
});

test("a cron route is open with its sub-paths and its query string, and nothing next to it is", () => {
  for (const base of CRON_ROUTES) {
    assert.equal(isCronRoute(base), true, base);
    assert.equal(isCronRoute(base + "/anything"), true, base + "/anything");
    assert.equal(isCronRoute(base + "?dry=1"), true, base + "?dry=1");
    // The near-miss every cap in this file is anchored against: a longer name
    // that merely starts the same way is a DIFFERENT route and stays closed.
    assert.equal(isCronRoute(base + "-admin"), false, base + "-admin");
  }
});

test("an ordinary page is not a cron route", () => {
  for (const p of ["/", "/live", "/api/report", "/api/reports/daily-email", "/login"]) {
    assert.equal(isCronRoute(p), false, p);
  }
});
