// WHO REACHES THE PRODUCTION PLAN after it left the Commercial module.
//
// Production planning moved from /office/commercial/production-planning to its
// own Office tab on 2026-09-17. Everything under /office/commercial is refused
// by maySeeCommercialModule in middleware; the new paths are outside that
// prefix and inherit none of it. So the danger of this change is not that the
// page breaks — it is that the page opens, to everyone. These tests are pointed
// at that: the first group pins who is ADMITTED, the second who is REFUSED, and
// the refusals are the half that matters.
//
// Pure: lib/production-plan/access-rules imports lib/roles (no imports at all)
// and lib/commercial/access-rules, so node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mayPlanProduction, maySeeApprovedPlan, productionPlanGuard,
  isApprovedPlanStatus, APPROVED_PLAN_STATUSES,
  PLANNING_BOARD_PATH, APPROVED_PLAN_PATH,
} from "../src/lib/production-plan/access-rules.ts";

const admin = { role: "ADMIN", branch: "OFFICE" };
const lineManager = { role: "LINE_MANAGER", branch: "SHOP_FLOOR" };
const incharge = { role: "INCHARGE", branch: "SHOP_FLOOR" };
const operator = { role: "OPERATOR", branch: "SHOP_FLOOR" };
const commercial = { role: "COMMERCIAL", branch: "OFFICE" };
const commercialManager = { role: "COMMERCIAL_MANAGER", branch: "OFFICE" };
const docs = { role: "COMMERCIAL_DOCS", branch: "OFFICE" };
const logistics = { role: "COMMERCIAL_LOGISTICS", branch: "OFFICE" };
const exec = { role: "COMMERCIAL_EXEC", branch: "OFFICE" };
const finance = { role: "FINANCE", branch: "OFFICE" };
const store = { role: "STORE", branch: "SHOP_FLOOR" };
const sampling = { role: "SAMPLING", branch: "OFFICE" };

// ── the board: exactly the reach it had inside Commercial ────────────────────

test("the board keeps the reach it had as a Commercial screen — the admin's alone", () => {
  assert.equal(mayPlanProduction(admin), true);
  // Answer 16 made the planner the admin's alone. Moving the page must not have
  // quietly promoted anyone, the commercial manager least of all.
  for (const u of [commercialManager, exec, docs, logistics, commercial]) {
    assert.equal(mayPlanProduction(u), false, String(u.role));
  }
});

test("MOVING THE PAGE MUST NOT OPEN IT TO THE FLOOR", () => {
  // These roles are uncapped in middleware and fall through the bare `/office`
  // allowance. Before this rule existed, every one of them would have reached
  // the board the moment it left /office/commercial.
  for (const u of [lineManager, incharge, operator, finance, store, sampling]) {
    assert.equal(mayPlanProduction(u), false, String(u.role));
  }
});

test("nothing is admitted without a login", () => {
  for (const u of [null, undefined, {}, { role: "" }, { role: "NONSENSE", branch: "OFFICE" }]) {
    assert.equal(mayPlanProduction(u), false, JSON.stringify(u));
    assert.equal(maySeeApprovedPlan(u), false, JSON.stringify(u));
  }
});

// ── the approved plan: a different audience, deliberately ────────────────────

test("managers read the approved plan — LINE_MANAGER and above", () => {
  assert.equal(maySeeApprovedPlan(lineManager), true);
  assert.equal(maySeeApprovedPlan(admin), true);
});

test("the planner sees what the floor sees", () => {
  // Not for symmetry: the person setting the running order needs to be able to
  // check what the plant is actually being shown.
  assert.equal(maySeeApprovedPlan(admin), true);
  assert.equal(mayPlanProduction(admin), true);
});

test("INCHARGE IS BELOW THE LINE, and that is the decision, not an oversight", () => {
  // Rank 2 against LINE_MANAGER's 3. If the shift incharges should read the
  // plan too, the comparison in maySeeApprovedPlan is the single edit — and
  // this test is where the change announces itself.
  assert.equal(maySeeApprovedPlan(incharge), false);
  assert.equal(maySeeApprovedPlan(operator), false);
});

test("the read-only page does NOT open to every Commercial desk", () => {
  // Every commercial role is rank 1, so only the planning area could admit
  // them, and only the admin has it. A desk that cannot plan cannot read the
  // plant's copy either — they have the queue inside their own module.
  for (const u of [commercialManager, exec, docs, logistics, commercial]) {
    assert.equal(maySeeApprovedPlan(u), false, String(u.role));
  }
});

test("neither gate leaks to Finance, Store or the tablet roles", () => {
  for (const u of [finance, store, sampling, { role: "ROBO" }, { role: "CHROMIA" }]) {
    assert.equal(maySeeApprovedPlan(u), false, String((u as { role: string }).role));
  }
});

// ── what "approved" means ────────────────────────────────────────────────────

test("approved is the COMMITTED part of the queue, and queued is withheld", () => {
  assert.deepEqual([...APPROVED_PLAN_STATUSES], ["SCHEDULED", "IN_PRODUCTION"]);
  assert.equal(isApprovedPlanStatus("SCHEDULED"), true);
  assert.equal(isApprovedPlanStatus("IN_PRODUCTION"), true);
  // QUEUED is the part still being argued over: showing the floor an unsettled
  // running order is the failure the page exists to prevent.
  assert.equal(isApprovedPlanStatus("QUEUED"), false);
  // history, not plan
  assert.equal(isApprovedPlanStatus("PRODUCED"), false);
  assert.equal(isApprovedPlanStatus("CANCELLED"), false);
});

test("an unknown status reads as NOT approved rather than throwing", () => {
  for (const v of [null, undefined, "", "APPROVED", 7, {}]) {
    assert.equal(isApprovedPlanStatus(v), false, JSON.stringify(v));
  }
});

// ── the middleware guard ─────────────────────────────────────────────────────

test("the guard picks the right predicate for each path", () => {
  assert.equal(productionPlanGuard(PLANNING_BOARD_PATH), mayPlanProduction);
  assert.equal(productionPlanGuard(APPROVED_PLAN_PATH), maySeeApprovedPlan);
  assert.equal(productionPlanGuard(APPROVED_PLAN_PATH + "?x=1"), maySeeApprovedPlan);
});

test("THE TWO PATHS ARE NOT PREFIXES OF EACH OTHER, and that is deliberate", () => {
  // The manager's page was /office/production-plan for about an hour on
  // 2026-09-17, until tests/navHighlight.test.ts failed: it is a MID-SEGMENT
  // prefix of /office/production-planning, the pair that test exists to catch,
  // and the first such pair the app had ever had. NavLink's boundary clause
  // would have handled the highlight and productionPlanGuard checks the longer
  // path first, so both were correct — but two live paths differing by "ning"
  // is a trap for the next person writing a startsWith, and renaming cost
  // nothing. If this assertion ever fails, the trap is back.
  assert.equal(APPROVED_PLAN_PATH.startsWith(PLANNING_BOARD_PATH), false);
  assert.equal(PLANNING_BOARD_PATH.startsWith(APPROVED_PLAN_PATH), false);
});

test("EXACT-OR-SUBPATH, so a neighbouring path is not opened by accident", () => {
  // The lesson the /office/batch-verify clause in routeCaps already paid for.
  assert.equal(productionPlanGuard("/office/production-planning-admin"), null);
  assert.equal(productionPlanGuard("/office/approved-plan-export"), null);
  assert.equal(productionPlanGuard("/office/production-plannings"), null);
  // ...while real children are covered.
  assert.equal(productionPlanGuard("/office/production-planning/anything"), mayPlanProduction);
});

test("the guard governs only its own two paths and abstains everywhere else", () => {
  for (const p of ["/office", "/office/commercial", "/office/commercial/production-planning",
                   "/api/office/commercial/production-requests", "/batch", "/", "/sampling"]) {
    assert.equal(productionPlanGuard(p), null, p);
  }
});

test("THE BOARD'S PATH IS STRICTER THAN THE PLAN'S, never the other way round", () => {
  // A manager reading the plan must never be admitted to the board by the guard
  // resolving the wrong way for a shared prefix.
  const boardGuard = productionPlanGuard(PLANNING_BOARD_PATH)!;
  const planGuard = productionPlanGuard(APPROVED_PLAN_PATH)!;
  assert.equal(boardGuard(lineManager), false);
  assert.equal(planGuard(lineManager), true);
});
