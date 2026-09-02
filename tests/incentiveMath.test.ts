import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TIERS, FLOOR_SLABS, poolFor, nextTier, ROLES, SALARY_BILL, HEADCOUNT, pctOfSalary, bandAmounts,
} from "../src/lib/incentiveLadder.ts";
import {
  rollUpByLetter, splitPoolByLetter, plantTotals, projectOutstanding, type ScoredInstance,
} from "../src/lib/incentiveMath.ts";
import { scaleQuality } from "../src/lib/shiftScoreMath.ts";

// These decide who is paid what for August 2026. The ladder is copied from the
// Python script that prints the notice; the roll-up is the grouping the payout
// is settled on. Both were first done by hand in a document — this is what
// makes them checkable.

/* ------------------------------------------------- the ladder is the notice's */

const py = readFileSync(new URL("../scripts/make-incentive-notice-pdf.py", import.meta.url), "utf8");

test("the TypeScript ladder is the Python notice's ladder, row for row", () => {
  const m = py.match(/TIERS = \[([\s\S]*?)\]/);
  assert.ok(m, "TIERS not found in scripts/make-incentive-notice-pdf.py");
  const rows = [...m![1].matchAll(/\((\d[\d_]*),\s*(\d[\d_]*)\)/g)]
    .map((x) => ({ slabs: Number(x[1].replace(/_/g, "")), pool: Number(x[2].replace(/_/g, "")) }));
  assert.deepEqual(TIERS.map((t) => ({ slabs: t.slabs, pool: t.pool })), rows,
    "incentiveLadder.ts and make-incentive-notice-pdf.py disagree about the pool ladder — the wall and the ERP would pay differently");
});

test("the pay bands and headcount are the Python notice's, figure for figure", () => {
  const num = (name: string) => {
    const m = py.match(new RegExp(`${name} = (\\d[\\d_]*)`));
    assert.ok(m, `${name} not found in the Python script`);
    return Number(m![1].replace(/_/g, ""));
  };
  // "MANAGERS, MANAGER_PAY = 5, 175_000" — two names, two numbers, one line.
  const pair = (a: string, b: string) => {
    const m = py.match(new RegExp(`${a}, ${b} = (\\d[\\d_]*), (\\d[\\d_]*)`));
    assert.ok(m, `${a}, ${b} not found in the Python script`);
    return [Number(m![1].replace(/_/g, "")), Number(m![2].replace(/_/g, ""))];
  };
  const [ops, opPay] = pair("OPERATORS", "OPERATOR_PAY");
  const [inc, incPay] = pair("INCHARGES", "INCHARGE_PAY");
  const [bc, bcPay] = pair("B_CAT", "B_CAT_PAY");
  const [mg, mgPay] = pair("MANAGERS", "MANAGER_PAY");
  const byKey = Object.fromEntries(ROLES.map((r) => [r.key, r]));
  assert.deepEqual([byKey.operator.heads, byKey.operator.pay], [ops, opPay]);
  assert.deepEqual([byKey.supervisor.heads, byKey.supervisor.pay], [inc, incPay]);
  assert.deepEqual([byKey.catB.heads, byKey.catB.pay], [bc, bcPay]);
  assert.deepEqual([byKey.manager.heads, byKey.manager.pay], [mg, mgPay]);
  assert.equal(HEADCOUNT, 112);
  assert.equal(SALARY_BILL, 4_100_000);
  void num;
});

test("the ladder is a step, and below the floor there is nothing", () => {
  assert.equal(FLOOR_SLABS, 7000);
  assert.equal(poolFor(6999), 0);
  assert.equal(poolFor(6156.5), 0);
  assert.equal(poolFor(7000), 300_000);
  assert.equal(poolFor(7656), 300_000, "7,656 pays the 7,000 row — the ladder does not interpolate");
  assert.equal(poolFor(7999), 300_000);
  assert.equal(poolFor(8000), 600_000);
  assert.equal(poolFor(12_000), 2_500_000);
  assert.equal(poolFor(20_000), 2_500_000);
  assert.deepEqual(nextTier(6156.5), { slabs: 7000, pool: 300_000 });
  assert.deepEqual(nextTier(7656), { slabs: 8000, pool: 600_000 });
  assert.equal(nextTier(12_000), null);
});

test("a share of the pool becomes a percentage of salary on a third of the bill", () => {
  // The notice's own worked line: 35.3% x Rs 3,00,000 / Rs 13,66,667 = 7.75%.
  const pct = pctOfSalary(0.353, 300_000);
  assert.equal(Math.round(pct * 10000) / 100, 7.75);
  const amt = bandAmounts(pct);
  assert.equal(amt.operator, 1550);
  assert.equal(amt.supervisor, 4068);
  assert.equal(amt.catB, 5812);
  // 1,75,000 x 7.749% = 13,561 — the notice printed 13,560, a rounding slip.
  assert.ok(Math.abs(amt.manager - 13_561) <= 1);
});

/* ---------------------------------------------------- the roll-up by letter */

const inst = (o: Partial<ScoredInstance> & { shift: ScoredInstance["shift"] }): ScoredInstance => ({
  quantity: 0, graded: 0, ungraded: 0, gradeA: 0, gradeB: 0, gradeC: 0, goodSlabs: 0, slowSlabs: 0,
  points: 0, weight: 1, hoursLogged: 8, breakdownMin: 0, poweroutMin: 0, quality: null, rawQuality: null,
  people: ["someone"], ...o,
});

test("credit is rebuilt exactly, so a half slab is not lost to per-instance rounding", () => {
  // 3 A + 1 B = 3.5 good slabs. scoreShift rounds goodSlabs to 4 on the row;
  // the letter total must say 3.5, because that is what the plant made.
  const rows = [inst({ shift: "A", quantity: 4, graded: 4, gradeA: 3, gradeB: 1, goodSlabs: 4, points: 4, rawQuality: 3.5 / 4, quality: scaleQuality(3.5 / 4) })];
  const [a] = rollUpByLetter(rows);
  assert.equal(a.credit, 3.5);
  assert.equal(a.rawShare, 0.875);
});

test("the two quality methods differ exactly where instances straddle the target", () => {
  // Two nights, 100 graded each: one at 99% (scaled 1.0, the 2% surplus is
  // clamped away), one at 92% (scaled 0.5). Weighted mean of the scaled scores
  // = 0.75. The aggregate share is 95.5%, scaled = 0.85. Same slabs, different
  // score — and the notice used the second.
  const rows = [
    inst({ shift: "C", quantity: 100, graded: 100, rawQuality: 0.99, quality: scaleQuality(0.99), points: 99 }),
    inst({ shift: "C", quantity: 100, graded: 100, rawQuality: 0.92, quality: scaleQuality(0.92), points: 92 }),
  ];
  const c = rollUpByLetter(rows).find((r) => r.shift === "C")!;
  assert.equal(c.instances, 2);
  assert.equal(Math.round(c.qualityWeighted! * 1000) / 1000, 0.75);
  assert.equal(Math.round(c.rawShare! * 1000) / 1000, 0.955);
  assert.equal(Math.round(c.qualityAggregate! * 1000) / 1000, 0.85);
});

test("a letter with no work takes no share, and the other two share the whole pool", () => {
  const rows = [
    inst({ shift: "A", quantity: 100, graded: 100, rawQuality: 0.96, quality: scaleQuality(0.96), points: 96, weight: 1 }),
    inst({ shift: "A", quantity: 100, graded: 100, rawQuality: 0.96, quality: scaleQuality(0.96), points: 96, weight: 1 }),
    inst({ shift: "A", quantity: 100, graded: 100, rawQuality: 0.96, quality: scaleQuality(0.96), points: 96, weight: 1 }),
    inst({ shift: "B", quantity: 90, graded: 90, rawQuality: 0.93, quality: scaleQuality(0.93), points: 90, weight: 1 }),
    inst({ shift: "B", quantity: 90, graded: 90, rawQuality: 0.93, quality: scaleQuality(0.93), points: 90, weight: 1 }),
    inst({ shift: "B", quantity: 90, graded: 90, rawQuality: 0.93, quality: scaleQuality(0.93), points: 90, weight: 1 }),
  ];
  const totals = rollUpByLetter(rows);
  for (const method of ["weighted", "aggregate"] as const) {
    const shares = splitPoolByLetter(totals, method);
    const c = shares.find((s) => s.shift === "C")!;
    assert.equal(c.share, 0, "an empty letter must take nothing");
    const sum = shares.reduce((a, s) => a + s.share, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `shares must add to exactly 1 (${method}: ${sum})`);
    const a = shares.find((s) => s.shift === "A")!;
    const b = shares.find((s) => s.shift === "B")!;
    assert.ok(a.share > b.share, "more good slabs per shift and a better grade share must pay more");
  }
});

test("the per-shift rate divides by RUNNING shifts, so a broken night does not drag the rate", () => {
  const rows = [
    inst({ shift: "B", quantity: 80, graded: 80, rawQuality: 0.95, quality: scaleQuality(0.95), points: 80, weight: 1 }),
    // the plant spent this one broken: no slabs, no divisor
    inst({ shift: "B", quantity: 0, graded: 0, points: 0, weight: 0, hoursLogged: 8, breakdownMin: 480 }),
  ];
  const b = rollUpByLetter(rows).find((r) => r.shift === "B")!;
  assert.equal(b.instances, 2, "the broken shift is still a shift that was attended");
  assert.equal(b.effectiveShifts, 1);
  assert.equal(b.pointsPerShift, 80);
});

test("credibility discounts a letter with fewer than three shifts", () => {
  const rows = [inst({ shift: "A", quantity: 100, graded: 100, rawQuality: 0.97, quality: 1, points: 100 })];
  const a = rollUpByLetter(rows).find((r) => r.shift === "A")!;
  assert.equal(Math.round(a.credibility * 1000) / 1000, 0.333);
});

test("plant totals and the projection are the sums they claim to be", () => {
  const rows = [
    inst({ shift: "A", quantity: 10, graded: 8, ungraded: 2, gradeA: 7, gradeB: 1, rawQuality: 7.5 / 8, quality: scaleQuality(7.5 / 8), points: 9, slowSlabs: 1 }),
    inst({ shift: "C", quantity: 10, graded: 10, gradeA: 10, rawQuality: 1, quality: 1, points: 10 }),
  ];
  const t = plantTotals(rollUpByLetter(rows));
  assert.equal(t.claimed, 20);
  assert.equal(t.graded, 18);
  assert.equal(t.ungraded, 2);
  assert.equal(t.credit, 17.5);
  assert.equal(t.points, 19);
  assert.equal(Math.round(t.rawShare! * 10000) / 10000, 0.9722);
  // Two outstanding slabs, one on a slow design, at the month's share.
  assert.equal(projectOutstanding([{ mult: 1 }, { mult: 2 }], 0.9722), 0.9722 * 3);
  assert.equal(projectOutstanding([{ mult: 2 }], null), 0);
});
