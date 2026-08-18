import test from "node:test";
import assert from "node:assert/strict";

// Alias-free relative import with an explicit extension: `node --test` resolves
// neither the `@/` alias nor next-auth, which is exactly why the tier mapping
// lives in a module of its own. See src/lib/chromia/tier.ts.
import { chromiaTierOf, chromiaCanManage, CHROMIA_TIER_RANK } from "../src/lib/chromia/tier.ts";

test("the dedicated CHROMIA role owns the module at operator tier", () => {
  assert.equal(chromiaTierOf({ role: "CHROMIA" }), "OPERATOR");
  assert.equal(chromiaTierOf({ role: "CHROMIA", branch: "SHOP_FLOOR" }), "OPERATOR");
});

test("admins span every department", () => {
  assert.equal(chromiaTierOf({ role: "ADMIN" }), "ADMIN");
  assert.equal(chromiaTierOf({ role: "ADMIN", branch: "OFFICE" }), "ADMIN");
});

test("no other role on any live branch reaches the module", () => {
  for (const role of ["OPERATOR", "INCHARGE", "LINE_MANAGER", "STORE", "MAINTENANCE", "ROBO", "SALES", "FINANCE", "ACCOUNTS", "COMMERCIAL", ""]) {
    assert.equal(chromiaTierOf({ role }), null, `${role || "(blank)"} must not reach Chromia`);
  }
  assert.equal(chromiaTierOf(null), null);
  assert.equal(chromiaTierOf(undefined), null);
});

test("the retired CHROMIA department still reaches the module — transitional", () => {
  // The old integration made Chromia a department. Those logins keep the module
  // (and nothing else — middleware caps them) until
  // scripts/0045-migrate-chromia-branch-users.sql moves them onto the role.
  // Delete this test with the four transitional arms it covers.
  assert.equal(chromiaTierOf({ role: "OPERATOR", branch: "CHROMIA" }), "OPERATOR");
  assert.equal(chromiaTierOf({ role: "LINE_MANAGER", branch: "CHROMIA" }), "OPERATOR");
  // ...and no further: the module's own destructive tier stays admin-only.
  assert.equal(chromiaCanManage({ role: "LINE_MANAGER", branch: "CHROMIA" }), false);
});

test("a branch value other than CHROMIA never grants access", () => {
  assert.equal(chromiaTierOf({ role: "OPERATOR", branch: "SHOP_FLOOR" }), null);
  assert.equal(chromiaTierOf({ role: "INCHARGE", branch: "FABRICATION" }), null);
});

test("only admins may run the destructive actions", () => {
  assert.equal(chromiaCanManage({ role: "ADMIN" }), true);
  assert.equal(chromiaCanManage({ role: "CHROMIA" }), false);
  assert.equal(chromiaCanManage(null), false);
});

test("tier ranks order operator below admin", () => {
  assert.ok(CHROMIA_TIER_RANK.OPERATOR < CHROMIA_TIER_RANK.ADMIN);
});
