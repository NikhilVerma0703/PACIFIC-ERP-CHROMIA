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

test("no other role reaches the module — including shop-floor management", () => {
  for (const role of ["OPERATOR", "INCHARGE", "LINE_MANAGER", "STORE", "MAINTENANCE", "ROBO", "SALES", "FINANCE", "ACCOUNTS", "COMMERCIAL", ""]) {
    assert.equal(chromiaTierOf({ role }), null, `${role || "(blank)"} must not reach Chromia`);
  }
  assert.equal(chromiaTierOf(null), null);
  assert.equal(chromiaTierOf(undefined), null);
});

test("branch alone never grants access — the module is role-gated like Robo", () => {
  assert.equal(chromiaTierOf({ role: "OPERATOR", branch: "CHROMIA" }), null);
  assert.equal(chromiaTierOf({ role: "LINE_MANAGER", branch: "CHROMIA" }), null);
});

test("only admins may run the destructive actions", () => {
  assert.equal(chromiaCanManage({ role: "ADMIN" }), true);
  assert.equal(chromiaCanManage({ role: "CHROMIA" }), false);
  assert.equal(chromiaCanManage(null), false);
});

test("tier ranks order operator below admin", () => {
  assert.ok(CHROMIA_TIER_RANK.OPERATOR < CHROMIA_TIER_RANK.ADMIN);
});
