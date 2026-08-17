import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHROMIA_MIN_TIER, CHROMIA_TIER_RANK, chromiaTierOf,
} from "../src/lib/chromia/tier.ts";

// tier.ts was split out of access.ts specifically so these tests could reach
// the real mapping instead of a copy. It decides who may sign a QC verdict and
// who may run an import that rewrites history, so the boundary is worth
// pinning rather than assuming.

const u = (role: string, branch: string) => ({ role, branch });

test("Chromia ranks map onto the three ERP roles", () => {
  assert.equal(chromiaTierOf(u("LINE_MANAGER", "CHROMIA")), "MANAGER");
  assert.equal(chromiaTierOf(u("INCHARGE", "CHROMIA")), "SUPERVISOR");
  assert.equal(chromiaTierOf(u("OPERATOR", "CHROMIA")), "EMPLOYEE");
});

test("an admin spans every department, whatever branch they sit in", () => {
  assert.equal(chromiaTierOf(u("ADMIN", "SHOP_FLOOR")), "ADMIN");
  assert.equal(chromiaTierOf(u("ADMIN", "OFFICE")), "ADMIN");
  assert.equal(chromiaTierOf(u("ADMIN", "CHROMIA")), "ADMIN");
});

test("the same role in another department is not Chromia staff", () => {
  // The branch is the whole boundary: a Fabrication supervisor has identical
  // rank and must still get nothing here, or every department's supervisors
  // could sign Chromia QC verdicts.
  assert.equal(chromiaTierOf(u("INCHARGE", "FABRICATION")), null);
  assert.equal(chromiaTierOf(u("LINE_MANAGER", "SHOP_FLOOR")), null);
  assert.equal(chromiaTierOf(u("OPERATOR", "SHOP_FLOOR")), null);
  assert.equal(chromiaTierOf(u("FINANCE", "OFFICE")), null);
});

test("no session, and roles outside the hierarchy, get no tier", () => {
  assert.equal(chromiaTierOf(null), null);
  assert.equal(chromiaTierOf(undefined), null);
  assert.equal(chromiaTierOf({}), null);
  // A role the rank table does not know scores 0 — below OPERATOR — so a
  // typo'd or retired role fails closed rather than landing on EMPLOYEE.
  assert.equal(chromiaTierOf(u("QUALITY_INSPECTOR", "CHROMIA")), null);
  assert.equal(chromiaTierOf(u("", "CHROMIA")), null);
});

test("the guard groups are ordered so a higher tier clears a lower gate", () => {
  const clears = (tier: keyof typeof CHROMIA_TIER_RANK, gate: keyof typeof CHROMIA_MIN_TIER) =>
    CHROMIA_TIER_RANK[tier] >= CHROMIA_TIER_RANK[CHROMIA_MIN_TIER[gate]];

  // An operator works the floor and nothing else.
  assert.ok(clears("EMPLOYEE", "production"));
  assert.ok(!clears("EMPLOYEE", "management"));
  assert.ok(!clears("EMPLOYEE", "quality"), "an operator must not sign off their own QC");
  assert.ok(!clears("EMPLOYEE", "store"));

  // Supervisor and above clear everything currently defined.
  for (const gate of ["management", "production", "quality", "store"] as const) {
    assert.ok(clears("SUPERVISOR", gate), `supervisor should clear ${gate}`);
    assert.ok(clears("MANAGER", gate), `manager should clear ${gate}`);
    assert.ok(clears("ADMIN", gate), `admin should clear ${gate}`);
  }
});

test("import is management-gated, not production-gated", () => {
  // The Excel import rewrites history wholesale, so it sits with dashboards
  // and masters rather than with floor entry. If this ever flips to EMPLOYEE
  // the nav's own supervisor check silently becomes the only guard.
  assert.equal(CHROMIA_MIN_TIER.management, "SUPERVISOR");
  assert.notEqual(CHROMIA_MIN_TIER.management, CHROMIA_MIN_TIER.production);
});
