import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLING_ACTIONS, SAMPLING_ACTORS,
  samplingActorOf, samplingCan, samplingActionsFor,
  isFabStockContributor, maySeeSamplingModule,
} from "../src/lib/sampling/actions.ts";
import { ROLE_RANK, rankOf, ROLE_LABEL } from "../src/lib/roles.ts";
import { homeFor, maySeeMis, samplingMayVisit, storeMayVisit, operatorMayVisit } from "../src/lib/routeCaps.ts";

// actions.ts is imported by access.ts and by middleware.ts rather than copied
// into either (the lesson lib/routeCaps.ts records), so these exercise the rule
// every /api/sampling route and the path gate both run.
//
// TWO KINDS OF LOGIN reach this module and that is the whole subtlety: the
// Sampling Incharge owns it, and the Fabrication Supervisor is allowed exactly
// one action inside it because the offcuts are his.

const u = (role: string, branch: string) => ({ role, branch });
const all = [...SAMPLING_ACTIONS];

// ---------------------------------------------------------------------------
// SAMPLING IS A ROLE, NOT A DEPARTMENT
// ---------------------------------------------------------------------------

test("THE SAMPLING INCHARGE IS Role.SAMPLING, AND DRIVES THE WHOLE MODULE", () => {
  // The owner's rule: view the inventory, add stock, and all three transitions.
  const incharge = u("SAMPLING", "SHOP_FLOOR");
  assert.equal(samplingActorOf(incharge), "SAMPLING");
  assert.deepEqual(samplingActionsFor(incharge), all);
  for (const a of all) assert.ok(samplingCan(incharge, a), `sampling should be able to ${a}`);
});

test("NO Branch.SAMPLING WAS ADDED, AND A LOGIN ON ONE GETS NOTHING", () => {
  // The correction this module exists to record. Sampling was designed as a
  // DEPARTMENT — Branch SAMPLING with the shared OPERATOR / INCHARGE /
  // LINE_MANAGER ranks, so that "Sampling Incharge" was SAMPLING + INCHARGE.
  // Chromia has since been retired AS a department (lib/branchNames.ts keeps
  // the value only so old rows decode; scripts/0046 moves those logins onto
  // Role.CHROMIA), and the surviving pattern for a single-purpose module is a
  // capped role. So there is no Branch value, and inventing one in the database
  // by hand would buy nothing: every rank on it is refused here.
  for (const role of ["OPERATOR", "INCHARGE", "LINE_MANAGER", "STORE", "FINANCE"]) {
    assert.equal(samplingActorOf(u(role, "SAMPLING")), null, `${role} on a SAMPLING branch`);
    assert.deepEqual(samplingActionsFor(u(role, "SAMPLING")), []);
  }
  // ...and the role means the same thing on every branch, exactly as roboGate()
  // treats ROBO. A role/branch pair whose caps do not intersect is a
  // configuration to reject in Users & Roles, not something a gate can fix.
  for (const b of ["SHOP_FLOOR", "OFFICE", "", "SAMPLING"]) {
    assert.deepEqual(samplingActionsFor(u("SAMPLING", b)), all, `SAMPLING on ${b}`);
  }
});

test("the module has no ranks, because the owner gave it to one person", () => {
  // There is no sampling OPERATOR and no sampling LINE_MANAGER: the ladder the
  // department design carried had one rung on it. Anything above the Sampling
  // Incharge is an admin — the same thing scripts/0046 says about Chromia.
  assert.deepEqual(Object.keys(SAMPLING_ACTORS).sort(), [...SAMPLING_ACTIONS].sort());
  const actors = new Set(Object.values(SAMPLING_ACTORS).flatMap((a) => [...a]));
  assert.deepEqual([...actors].sort(), ["ADMIN", "FAB_SUPERVISOR", "SAMPLING"]);
});

test("an admin spans every department, whatever branch they sit in", () => {
  for (const b of ["SHOP_FLOOR", "OFFICE", "FABRICATION", "CHROMIA", "INTERNATIONAL_SALES"]) {
    assert.equal(samplingActorOf(u("ADMIN", b)), "ADMIN");
    assert.deepEqual(samplingActionsFor(u("ADMIN", b)), all);
  }
});

// ---------------------------------------------------------------------------
// The fabrication seam — the reason this gates per ACTION and not per tier
// ---------------------------------------------------------------------------

test("A FABRICATION SUPERVISOR MAY ADD STOCK, AND NOTHING ELSE", () => {
  const fabSup = u("INCHARGE", "FABRICATION");
  assert.deepEqual(samplingActionsFor(fabSup), ["addStock"]);
  assert.ok(samplingCan(fabSup, "addStock"));
  assert.ok(!samplingCan(fabSup, "view"), "the sample inventory is not his to read");
  assert.ok(!samplingCan(fabSup, "release"));
  assert.ok(!samplingCan(fabSup, "dispatch"));
  assert.ok(!samplingCan(fabSup, "deliver"));
  // He is not sampling staff — he has one errand here, not a rank.
  assert.equal(samplingActorOf(fabSup), "FAB_SUPERVISOR");
});

test("\"may add but may not view\" is why this is not a minimum-tier gate", () => {
  // fabGate(min) / chromiaGate(min) ask "is this login at least tier X", which
  // can only describe a ladder: any answer admitting addStock would admit
  // everything at or below it, and view sits below addStock in every ordering
  // anyone would write. The table is per-action precisely so this pair can
  // disagree.
  const fabSup = u("INCHARGE", "FABRICATION");
  assert.equal(samplingCan(fabSup, "addStock"), true);
  assert.equal(samplingCan(fabSup, "view"), false);
  // And the sampling login is not merely "higher" — it is a different actor.
  assert.notEqual(samplingActorOf(fabSup), samplingActorOf(u("SAMPLING", "SHOP_FLOOR")));
});

test("the fab tier admitted here is the one fabGate(\"SUPERVISOR\") admits", () => {
  // lib/fab/access.ts cannot be imported from a pure module (it reaches @/auth,
  // and middleware imports this file), so the test is where the two definitions
  // are held together: fabTierOf gives SUPERVISOR at rank >= INCHARGE and
  // MANAGER above it, and both clear a "SUPERVISOR" minimum.
  assert.ok(isFabStockContributor(u("INCHARGE", "FABRICATION")));
  assert.ok(isFabStockContributor(u("LINE_MANAGER", "FABRICATION")));
  assert.deepEqual(samplingActionsFor(u("LINE_MANAGER", "FABRICATION")), ["addStock"]);
  // The machine operator does not decide what is worth keeping.
  assert.ok(!isFabStockContributor(u("OPERATOR", "FABRICATION")));
  assert.deepEqual(samplingActionsFor(u("OPERATOR", "FABRICATION")), []);
  // The seam is the BRANCH, because fabrication is still a department — unlike
  // Chromia, which stopped being one. The same rank elsewhere is not a fab
  // supervisor.
  assert.ok(!isFabStockContributor(u("INCHARGE", "SHOP_FLOOR")));
  // And the rank comparison it is built on is the shared one.
  assert.equal(rankOf("INCHARGE"), ROLE_RANK.INCHARGE);
  assert.ok(ROLE_RANK.LINE_MANAGER > ROLE_RANK.INCHARGE);
});

test("every other department's incharge gets nothing at all", () => {
  for (const b of ["SHOP_FLOOR", "OFFICE", "CHROMIA", "INTERNATIONAL_SALES"]) {
    assert.deepEqual(samplingActionsFor(u("INCHARGE", b)), [], `${b} incharge should get nothing`);
    assert.deepEqual(samplingActionsFor(u("LINE_MANAGER", b)), []);
  }
  assert.deepEqual(samplingActionsFor(u("FINANCE", "OFFICE")), []);
  assert.deepEqual(samplingActionsFor(u("STORE", "SHOP_FLOOR")), []);
  assert.deepEqual(samplingActionsFor(u("ROBO", "SHOP_FLOOR")), []);
  assert.deepEqual(samplingActionsFor(u("CHROMIA", "SHOP_FLOOR")), []);
});

// ---------------------------------------------------------------------------
// Failing closed
// ---------------------------------------------------------------------------

test("no session, and roles outside the hierarchy, get no actor and no action", () => {
  assert.equal(samplingActorOf(null), null);
  assert.equal(samplingActorOf(undefined), null);
  assert.equal(samplingActorOf({}), null);
  // A near-miss on the role name is not the role.
  assert.equal(samplingActorOf(u("SAMPLE", "SHOP_FLOOR")), null);
  assert.equal(samplingActorOf(u("sampling", "SHOP_FLOOR")), null);
  assert.equal(samplingActorOf(u("", "SHOP_FLOOR")), null);
  assert.deepEqual(samplingActionsFor(null), []);
});

test("an action nobody defined is refused, not defaulted", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(!samplingCan(u("SAMPLING", "SHOP_FLOOR"), "delete" as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(!samplingCan(u("ADMIN", "SHOP_FLOOR"), "" as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(!samplingCan(u("ADMIN", "SHOP_FLOOR"), "constructor" as any), "no prototype key is an action");
});

test("every action names its actors, and addStock is the only wider one", () => {
  for (const a of SAMPLING_ACTIONS) {
    assert.ok(SAMPLING_ACTORS[a]?.length, `${a} has no actors`);
    assert.ok(SAMPLING_ACTORS[a].includes("SAMPLING"), `${a} must be the sampling incharge's`);
    assert.ok(SAMPLING_ACTORS[a].includes("ADMIN"), `${a} must be an admin's`);
  }
  const widened = SAMPLING_ACTIONS.filter((a) => SAMPLING_ACTORS[a].includes("FAB_SUPERVISOR"));
  assert.deepEqual(widened, ["addStock"], "only stock intake reaches outside the module");
});

// ---------------------------------------------------------------------------
// The coarse gate middleware asks at the path prefix
// ---------------------------------------------------------------------------

test("the module door admits everyone with an errand, and nobody else", () => {
  // middleware matches on a path prefix and cannot tell an intake POST from an
  // inventory GET, so it asks "can you do ANYTHING here" and leaves which
  // action to samplingGate() in the route — the split middleware.ts already
  // documents on /office/batch-verify.
  assert.equal(maySeeSamplingModule(u("SAMPLING", "SHOP_FLOOR")), true);
  assert.equal(maySeeSamplingModule(u("ADMIN", "OFFICE")), true);
  assert.equal(maySeeSamplingModule(u("INCHARGE", "FABRICATION")), true, "he has to reach the intake route");
  assert.equal(maySeeSamplingModule(u("OPERATOR", "FABRICATION")), false);
  assert.equal(maySeeSamplingModule(u("STORE", "SHOP_FLOOR")), false);
  assert.equal(maySeeSamplingModule(u("INCHARGE", "SHOP_FLOOR")), false);
  assert.equal(maySeeSamplingModule(null), false);
});

test("the door cannot drift from the action table", () => {
  // maySeeSamplingModule is defined as "can do at least one thing", not as its
  // own list of roles, so an actor added to SAMPLING_ACTORS is admitted by
  // construction. This is the assertion that says so.
  for (const who of [
    u("SAMPLING", "SHOP_FLOOR"), u("ADMIN", "SHOP_FLOOR"), u("INCHARGE", "FABRICATION"),
    u("OPERATOR", "FABRICATION"), u("ROBO", "SHOP_FLOOR"), u("INCHARGE", "SAMPLING"), {},
  ]) {
    assert.equal(maySeeSamplingModule(who), samplingActionsFor(who).length > 0);
  }
});

// ---------------------------------------------------------------------------
// Registration: a capped role missing from one list is a dead link or a leak
// ---------------------------------------------------------------------------

test("SAMPLING is capped to its own module, exactly like ROBO and CHROMIA", () => {
  for (const p of ["/sampling", "/sampling/stock", "/sampling/dispatch/abc", "/api/sampling/intake"]) {
    assert.equal(samplingMayVisit(p), true, `sampling should reach ${p}`);
  }
  // "and nothing else" has to MEAN nothing else. The ROBO cap's own comment
  // records what happens when the second clause is `startsWith("/api")`: it
  // hands a shop-floor tablet every API in the ERP.
  for (const p of [
    "/", "/live", "/entry", "/tables", "/store", "/report", "/mis", "/inventory",
    "/office/costing", "/robo", "/chromia/dashboard", "/fab/projects", "/sales/orders",
    "/api/office/costing-admin/batch-rates", "/api/robo/shifts", "/api/mis/export", "/api/admin/users",
  ]) {
    assert.equal(samplingMayVisit(p), false, `sampling should NOT reach ${p}`);
  }
  // Exact-or-subpath at the prefix, so a future sibling route is not opened by
  // accident — the near-miss the store cap's /office/batch-verify-admin case
  // pins for the same reason.
  assert.equal(samplingMayVisit("/sampling-admin"), false);
  assert.equal(samplingMayVisit("/api/sampling-export"), false);
});

test("a SAMPLING login has a home its own cap allows — the loop test", () => {
  // Role CHROMIA fell through every branch test to "/", which its cap refuses;
  // denied() sends a refused user to homeFor, so sign-in ended in
  // ERR_TOO_MANY_REDIRECTS. Any role whose cap excludes "/" MUST have an arm in
  // homeFor, and this is Sampling's.
  assert.equal(homeFor("SAMPLING", "SHOP_FLOOR"), "/sampling");
  assert.equal(samplingMayVisit(homeFor("SAMPLING", "SHOP_FLOOR")), true);
  assert.notEqual(homeFor("SAMPLING", "SHOP_FLOOR"), "/");
  assert.notEqual(homeFor("SAMPLING", "SHOP_FLOOR"), "/no-access");
  assert.equal(samplingMayVisit("/no-access"), true, "the refusal page is reachable, or it is a loop");
  // Its arm sits with ROBO's, AFTER the branch tests, because its cap in
  // middleware.ts is a ROLE block that runs after the branch blocks. So a
  // SAMPLING login parked on a branch that has its own block belongs to the
  // branch — answering "/sampling" there would be a refusal on the next hop.
  assert.equal(homeFor("SAMPLING", "OFFICE"), "/sampling");
  assert.equal(homeFor("SAMPLING", "FABRICATION"), "/fab/cutting");
  assert.equal(homeFor("SAMPLING", "INTERNATIONAL_SALES"), "/sales");
  assert.equal(homeFor("SAMPLING", "CHROMIA"), "/chromia");
});

test("SAMPLING is MIS-blind, like every other capped module role", () => {
  // /mis has no gate of its own: its audience is whoever no cap turns away, and
  // this cap turns SAMPLING away. /api/mis/export must agree, or a login that
  // cannot open the page can still download the whole downtime log from it.
  assert.equal(samplingMayVisit("/mis"), false);
  assert.equal(maySeeMis("SAMPLING", "SHOP_FLOOR"), false);
  assert.equal(maySeeMis("SAMPLING", "OFFICE"), false);
  // The company it keeps.
  for (const r of ["ROBO", "CHROMIA", "STORE", "OPERATOR"]) {
    assert.equal(maySeeMis(r, "SHOP_FLOOR"), false, `${r} was already blind`);
  }
  // ...and an admin still is not.
  assert.equal(maySeeMis("ADMIN", "SHOP_FLOOR"), true);
});

test("the new role is in the shared role tables, not just in this module", () => {
  // A capped role missing from one of these is a login that cannot be created,
  // or one that renders as a raw enum value on screen.
  assert.equal(ROLE_RANK.SAMPLING, 1, "a capped shop-floor role, like ROBO and CHROMIA");
  assert.equal(rankOf("SAMPLING"), 1);
  assert.ok(ROLE_LABEL.SAMPLING, "Users & Roles shows the label, not the enum value");
  // Rank 1 is below every rank test in the ERP, which is the point: the role is
  // named where it is wanted and inherits nothing.
  assert.ok(rankOf("SAMPLING") < ROLE_RANK.INCHARGE);
  // The other two capped caps are untouched by any of this.
  assert.equal(storeMayVisit("/store"), true);
  assert.equal(operatorMayVisit("/entry"), true);
  assert.equal(storeMayVisit("/sampling"), false, "the store incharge has no business here");
  assert.equal(operatorMayVisit("/sampling"), false);
});
