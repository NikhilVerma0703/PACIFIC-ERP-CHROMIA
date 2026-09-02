import { test } from "node:test";
import assert from "node:assert/strict";
import { capacityFigures } from "../src/lib/downtimeShared.ts";

// The downtime page printed achievable 6,191 under an actual of 6,262 for
// August 2026: the delay minutes, charged at the standard rate, claimed 1,778
// slabs against a shortfall of 1,707. Achievable is what could have been made
// given the downtime; it was made, so it cannot be less. These pin the bound.

test("AUGUST 2026 — the claim is cut to the shortfall and achievable is the actual", () => {
  const c = capacityFigures(7969, 1778, 6262);
  assert.equal(c.downtimeCostRaw, 1778);
  assert.equal(c.downtimeCost, 1707, "bounded by target - actual");
  assert.equal(c.achievable, 6262, "never below what was actually made");
  assert.equal(c.lost, 0, "downtime explains the whole gap, so nothing is unexplained");
  assert.equal(c.costCapped, true);
});

test("a normal day: the claim fits inside the shortfall and nothing is capped", () => {
  const c = capacityFigures(300, 40, 220);
  assert.equal(c.downtimeCost, 40);
  assert.equal(c.achievable, 260);
  assert.equal(c.lost, 40, "achievable - actual: the gap downtime does not explain");
  assert.equal(c.costCapped, false);
});

test("the line beat its standard: nothing was lost to downtime in capacity terms", () => {
  const c = capacityFigures(200, 90, 240);
  assert.equal(c.downtimeCost, 0);
  assert.equal(c.achievable, 240, "achievable rises to the actual, not the target");
  assert.equal(c.lost, 0);
  assert.equal(c.costCapped, true, "90 slabs were claimed against a shortfall of 0");
});

test("THE INVARIANT HOLDS FOR ANY INPUT: achievable >= actual, lost >= 0, cost <= claim", () => {
  const cases = [[0, 0, 0], [100, 0, 0], [100, 500, 0], [0, 50, 30], [259, 1, 258], [259, 1, 259], [259, 2, 258], [7969, 1778, 6262], [1, 1, 1]];
  for (const [t, raw, a] of cases) {
    const c = capacityFigures(t, raw, a);
    assert.ok(c.achievable >= a, `achievable ${c.achievable} < actual ${a} for ${t}/${raw}/${a}`);
    assert.ok(c.lost >= 0);
    assert.ok(c.downtimeCost <= raw && c.downtimeCost >= 0);
    assert.ok(c.achievable <= Math.max(t, a));
    assert.equal(c.lost, c.achievable - a);
  }
});

test("negative or NaN-ish inputs are treated as zero rather than producing a negative bar", () => {
  const c = capacityFigures(-5, -10, -3);
  assert.deepEqual([c.achievable, c.lost, c.downtimeCost, c.downtimeCostRaw], [0, 0, 0, 0]);
});
