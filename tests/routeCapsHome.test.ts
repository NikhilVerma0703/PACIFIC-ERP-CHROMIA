import { test } from "node:test";
import assert from "node:assert/strict";
import {
  homeFor, maintenanceMayVisit, operatorMayVisit, OPERATOR_HOME, storeMayVisit, STORE_HOME,
} from "../src/lib/routeCaps.ts";

// homeFor backs the "Go to my start page" button on /no-access. Every answer it
// gives has to be a page that login can actually open — otherwise the button
// out of the refusal page leads straight back to the refusal page, which is a
// worse experience than the silent bounce it replaced.

test("every role lands somewhere its own cap allows", () => {
  // The two caps that are expressible as pure functions are checked directly.
  assert.equal(storeMayVisit(homeFor("STORE", "SHOP_FLOOR")), true);
  assert.equal(operatorMayVisit(homeFor("OPERATOR", "SHOP_FLOOR")), true);
  assert.equal(homeFor("STORE", "SHOP_FLOOR"), STORE_HOME);
  assert.equal(homeFor("OPERATOR", "SHOP_FLOOR"), OPERATOR_HOME);
});

test("branch beats role, because branch is the coarser cap", () => {
  // A fabrication incharge and a shop-floor incharge share a role and have
  // different homes; resolving on role first would send the fab one to "/",
  // which middleware refuses for a non-admin on the FABRICATION branch.
  assert.equal(homeFor("INCHARGE", "FABRICATION"), "/fab/supervisor/slabs");
  assert.equal(homeFor("INCHARGE", "SHOP_FLOOR"), "/");
  assert.equal(homeFor("LINE_MANAGER", "FABRICATION"), "/fab/manager");
  assert.equal(homeFor("SALES", "INTERNATIONAL_SALES"), "/sales");
  assert.equal(homeFor("OPERATOR", "CHROMIA"), "/chromia");
});

test("an admin always starts at the production overview", () => {
  // Admins span every department, so "/" is never refused for them.
  assert.equal(homeFor("ADMIN", "SHOP_FLOOR"), "/");
  assert.equal(homeFor("ADMIN", "OFFICE"), "/");
  assert.equal(homeFor("ADMIN", "FABRICATION"), "/");
});

test("the maintenance manager starts at Overview, which is in their cap", () => {
  // Their cap is p === "/" plus /mis, /maintenance, /report, /consumables.
  assert.equal(homeFor("MAINTENANCE", "SHOP_FLOOR"), "/");
});

test("office and capped commercial roles do not land on the shop floor", () => {
  assert.equal(homeFor("FINANCE", "OFFICE"), "/office");
  assert.equal(homeFor("ACCOUNTS", "OFFICE"), "/office");
  // SALES and COMMERCIAL are capped to /inventory by their own blocks.
  assert.equal(homeFor("SALES", "SHOP_FLOOR"), "/inventory");
  assert.equal(homeFor("COMMERCIAL", "SHOP_FLOOR"), "/office/commercial");
  assert.equal(homeFor("ROBO", "SHOP_FLOOR"), "/robo");
});

test("an unknown role still gets a real page, not an empty string", () => {
  // A role added to the enum and forgotten here must not produce href="" —
  // which renders as a link to the current page and looks like a dead button.
  for (const r of ["", "SOMETHING_NEW", "undefined"]) {
    const home = homeFor(r, "SHOP_FLOOR");
    assert.ok(home.startsWith("/"), `${r} produced ${JSON.stringify(home)}`);
  }
});

test("no home is the refusal page itself", () => {
  // Sending someone from /no-access back to /no-access would be a loop with a
  // button on it.
  const roles = ["ADMIN", "MAINTENANCE", "STORE", "OPERATOR", "ROBO", "SALES",
                 "COMMERCIAL", "FINANCE", "INCHARGE", "LINE_MANAGER"];
  const branches = ["SHOP_FLOOR", "OFFICE", "FABRICATION", "INTERNATIONAL_SALES", "CHROMIA"];
  for (const r of roles) {
    for (const b of branches) {
      assert.notEqual(homeFor(r, b), "/no-access", `${r}/${b}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Regressions found by the adversarial review of this change, each pinned.
// ---------------------------------------------------------------------------

test("a role home is always a page that role can actually open", () => {
  // F3: homeFor checked branch before role, so a SALES login (which normally
  // carries branch OFFICE) was sent to /office - refused by its own cap. The
  // "Go to my start page" button on the refusal page led back to the refusal
  // page, for the one role least able to work around it.
  assert.equal(homeFor("SALES", "OFFICE"), "/inventory");
  // COMMERCIAL lands on its own module since 2026-09-06 (scripts/0076); its
  // cap allows /office/** so the page is reachable from either branch.
  assert.equal(homeFor("COMMERCIAL", "OFFICE"), "/office/commercial");
  assert.equal(homeFor("SALES", "SHOP_FLOOR"), "/inventory");
  // ...but the INTERNATIONAL_SALES BRANCH still wins over the role, because
  // middleware routes that branch by its own block and returns before the role
  // caps run. Fixing the OFFICE case by putting role first broke this one.
  assert.equal(homeFor("SALES", "INTERNATIONAL_SALES"), "/sales");
  // ...and the branch rules still win for everyone they should.
  assert.equal(homeFor("FINANCE", "OFFICE"), "/office");
  assert.equal(homeFor("INCHARGE", "FABRICATION"), "/fab/supervisor/slabs");
});

test("every capped role can open the home it is sent to", () => {
  // The invariant behind the button. Only the two caps expressible as pure
  // functions can be checked mechanically; the rest are asserted above.
  assert.equal(storeMayVisit(homeFor("STORE", "SHOP_FLOOR")), true);
  assert.equal(operatorMayVisit(homeFor("OPERATOR", "SHOP_FLOOR")), true);
  assert.equal(maintenanceMayVisit(homeFor("MAINTENANCE", "SHOP_FLOOR")), true);
});

test("the maintenance cap covers the links its own pages render", () => {
  // F1/F2: narrowing the API allowance to /api/consumables broke two links that
  // sit ON the granted pages - the downtime response photo and the MIS Excel
  // export. Both are written as template literals, so the grep that produced
  // the first allowlist never saw them.
  assert.equal(maintenanceMayVisit("/api/photo?id=abc"), true);
  assert.equal(maintenanceMayVisit("/api/mis/export?from=2026-08-01"), true);
  // Still an allowlist, not a bare prefix.
  assert.equal(maintenanceMayVisit("/api/photos"), false);
  assert.equal(maintenanceMayVisit("/api/mis/exporter"), false,
    "startsWith would grant a route nobody has written yet");
  assert.equal(maintenanceMayVisit("/api/mis"), false);
});

test("a capped ROLE has a home its own cap allows — the loop test", () => {
  // The defect this pins was an INFINITE REDIRECT, not a dead end: role CHROMIA
  // (a Shop Floor login capped to /chromia by scripts/0046) fell through every
  // branch test to "/", which its cap refuses. denied() then sends a refused
  // user to homeFor, so middleware refused "/", homeFor answered "/", and
  // sign-in ended in ERR_TOO_MANY_REDIRECTS.
  //
  // The rule: any role whose cap excludes "/" MUST have an arm here. A role
  // added to the enum and forgotten inherits the "/" fallthrough, which is
  // safe only for roles that can open it.
  assert.equal(homeFor("CHROMIA", "SHOP_FLOOR"), "/chromia");
  assert.equal(homeFor("CHROMIA", "CHROMIA"), "/chromia");
  assert.equal(homeFor("ROBO", "SHOP_FLOOR"), "/robo");
  assert.equal(homeFor("STORE", "SHOP_FLOOR"), "/live");
  assert.equal(homeFor("OPERATOR", "SHOP_FLOOR"), "/entry");
  assert.equal(homeFor("SALES", "SHOP_FLOOR"), "/inventory");

  // A home is never the page the caller was just refused, which is the shape
  // of every loop of this kind.
  for (const role of ["CHROMIA", "ROBO", "STORE", "OPERATOR", "SALES", "COMMERCIAL"]) {
    assert.notEqual(homeFor(role, "SHOP_FLOOR"), "/",
      `${role} is capped away from "/" and must not be sent there`);
  }
});

test("each fabrication tier lands on its own screen, not a shared queue", () => {
  // middleware carried this in a local (fabHome) that stopped being read when
  // its redirect became denied(). denied() defers to homeFor, so the knowledge
  // had to move there or a fab manager would be dropped on a station queue.
  assert.equal(homeFor("LINE_MANAGER", "FABRICATION"), "/fab/manager");
  assert.equal(homeFor("INCHARGE", "FABRICATION"), "/fab/supervisor/slabs");
  // The fab OPERATOR cap is an opt-in list of queue pages; /fab/cutting is on it.
  assert.equal(homeFor("OPERATOR", "FABRICATION"), "/fab/cutting");
  // Branch still beats the STORE/OPERATOR role caps - a fab login is never sent
  // to /live or /entry, which its branch block refuses.
  assert.equal(homeFor("STORE", "FABRICATION"), "/fab/cutting");
});

test("every role/branch pair that EXISTS lands on a page it can open", () => {
  // Read off the active users table on 2026-08-21. The cartesian product of
  // role x branch contains combinations whose role cap and branch cap do not
  // intersect at all (SALES on the shop floor can open /inventory by its role
  // and is refused /inventory by its branch) - those have nowhere to land and
  // no landing page can invent one. These sixteen are the ones real people
  // sign in with, and every one of them must resolve.
  const REAL: [string, string, string][] = [
    ["ADMIN", "SHOP_FLOOR", "/"],
    ["CHROMIA", "SHOP_FLOOR", "/chromia"],
    ["COMMERCIAL", "OFFICE", "/office/commercial"],   // its own module since 2026-09-06
    ["FINANCE", "OFFICE", "/office"],
    ["INCHARGE", "SHOP_FLOOR", "/"],
    ["INCHARGE", "FABRICATION", "/fab/supervisor/slabs"],
    ["LINE_MANAGER", "INTERNATIONAL_SALES", "/sales"],
    ["LINE_MANAGER", "SHOP_FLOOR", "/"],
    ["LINE_MANAGER", "CHROMIA", "/chromia"],
    ["LINE_MANAGER", "FABRICATION", "/fab/manager"],
    ["MAINTENANCE", "SHOP_FLOOR", "/"],
    ["OPERATOR", "SHOP_FLOOR", "/entry"],
    ["OPERATOR", "FABRICATION", "/fab/cutting"],
    ["ROBO", "SHOP_FLOOR", "/robo"],
    ["SALES", "OFFICE", "/inventory"],
    ["STORE", "SHOP_FLOOR", "/live"],
  ];
  for (const [role, branch, expected] of REAL) {
    assert.equal(homeFor(role, branch), expected, `${role}/${branch}`);
  }
});

test("the maintenance manager has a home on any branch, not just his own", () => {
  // His cap allows "/" and refuses /office, so letting branch OFFICE answer
  // would have handed him a page he cannot open. He is SHOP_FLOOR today; this
  // is so a mis-set branch in Users & Roles is a wrong menu rather than a login
  // that cannot land anywhere.
  for (const b of ["SHOP_FLOOR", "OFFICE", ""]) {
    assert.equal(maintenanceMayVisit(homeFor("MAINTENANCE", b)), true, `branch ${b}`);
  }
  // ...but a branch with its own middleware block still wins, because that
  // block returns before the role caps ever run.
  assert.equal(homeFor("MAINTENANCE", "FABRICATION"), "/fab/cutting");
  assert.equal(homeFor("MAINTENANCE", "CHROMIA"), "/chromia");
});

test("homeFor mirrors middleware's block order, including role CHROMIA on any branch", () => {
  // mw: `role === "CHROMIA" || (!isAdmin && branch === "CHROMIA")` is ONE block,
  // so role CHROMIA is capped to /chromia on every branch - the branch tests
  // below it never see that login.
  for (const b of ["SHOP_FLOOR", "OFFICE", "FABRICATION", "INTERNATIONAL_SALES", "CHROMIA"]) {
    assert.equal(homeFor("CHROMIA", b), "/chromia", `CHROMIA/${b}`);
  }
  // ROBO is the opposite case: its cap is a ROLE block that runs AFTER the
  // branch blocks, so a ROBO login on one of those branches belongs to the
  // branch. Answering "/robo" there was a refusal on the next hop.
  assert.equal(homeFor("ROBO", "SHOP_FLOOR"), "/robo");
  assert.equal(homeFor("ROBO", "INTERNATIONAL_SALES"), "/sales");
  assert.equal(homeFor("ROBO", "CHROMIA"), "/chromia");
  assert.equal(homeFor("ROBO", "FABRICATION"), "/fab/cutting");
});

test("STORE and OPERATOR beat the OFFICE convenience line, like every other role cap", () => {
  // Middleware has NO `branch === "OFFICE"` block - an OFFICE login falls through
  // to the ROLE caps - so that line in homeFor mirrors no gate. Letting it answer
  // first handed a STORE login "/office", which its own cap refuses, so the only
  // button on the refusal page led straight back to the refusal page. Exactly the
  // F3 defect, for the two roles the F3 test did not cover.
  assert.equal(homeFor("STORE", "OFFICE"), STORE_HOME);
  assert.equal(homeFor("OPERATOR", "OFFICE"), OPERATOR_HOME);
  assert.equal(storeMayVisit(homeFor("STORE", "OFFICE")), true);
  assert.equal(operatorMayVisit(homeFor("OPERATOR", "OFFICE")), true);
  // ...and OFFICE still answers for the roles it is actually there for.
  assert.equal(homeFor("FINANCE", "OFFICE"), "/office");
  assert.equal(homeFor("ACCOUNTS", "OFFICE"), "/office");
});

test("no role/branch pair is sent to a home its own ROLE cap refuses", () => {
  // The mechanical version of the rule above. It only applies where the ROLE
  // cap is what actually decides - and for three branches it is not.
  //
  // CHROMIA, FABRICATION and INTERNATIONAL_SALES each have their OWN block in
  // middleware that returns before any role cap runs, so on those branches the
  // branch home is right even though the role cap would refuse it. That is not
  // a bug and asserting otherwise is what this test got wrong first time round:
  // homeFor("MAINTENANCE","INTERNATIONAL_SALES") is "/sales", which
  // maintenanceMayVisit says no to and middleware never asks it about.
  const BRANCH_DECIDES = new Set(["CHROMIA", "FABRICATION", "INTERNATIONAL_SALES"]);
  const roles = ["ADMIN", "MAINTENANCE", "STORE", "OPERATOR", "ROBO", "SALES",
                 "COMMERCIAL", "FINANCE", "ACCOUNTS", "INCHARGE", "LINE_MANAGER", "CHROMIA"];
  const branches = ["SHOP_FLOOR", "OFFICE", "FABRICATION", "INTERNATIONAL_SALES", "CHROMIA", ""];
  const CAPS: Record<string, (p: string) => boolean> = {
    STORE: storeMayVisit, OPERATOR: operatorMayVisit, MAINTENANCE: maintenanceMayVisit,
  };
  let checked = 0;
  for (const r of roles) {
    const cap = CAPS[r];
    if (!cap) continue;
    for (const b of branches) {
      if (BRANCH_DECIDES.has(b)) continue;
      const home = homeFor(r, b);
      assert.equal(cap(home), true, `${r}/${b} -> ${home} is refused by its own cap`);
      checked++;
    }
  }
  // Guard against the loop silently checking nothing.
  assert.equal(checked, 9, "expected 3 capped roles x 3 role-decided branches");
});
