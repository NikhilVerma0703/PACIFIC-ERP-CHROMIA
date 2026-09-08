import test from "node:test";
import assert from "node:assert/strict";

import { forwardRunIds, bySerialThenCreated } from "../src/lib/robo/rangeUpdate.ts";
import { productionDateOf } from "../src/lib/robo/productionDate.ts";
import { roboThicknessKey } from "../src/lib/robo/thickness.ts";

/* The "apply from this slab forward" rule. A batch saved with one date (or one
   thickness) on the whole run gets corrected by editing the slab where the
   change begins; the run must carry forward to the next change and no further,
   and must never reach back to earlier slabs. */

// A batch all on one date, S.No. in order. id "s<n>" == S.No. n.
const batch = (dates: Record<number, string | null>) =>
  Object.entries(dates).map(([sno, d]) => ({
    id: `s${sno}`,
    serialNumber: Number(sno),
    createdAt: new Date(2025, 0, 1, 0, Number(sno)),
    productionDate: d,
    batchRecipe: { productionDate: "2025-08-19" },
    shift: { date: "2025-08-19" },
  }));

const key = (s: { productionDate?: string | null; batchRecipe?: { productionDate?: string | null } | null; shift?: { date?: string | null } | null }) =>
  productionDateOf(s);

test("forwardRunIds: all one date — editing S.No.18 takes 18 to the end", () => {
  // Nothing overridden yet: every slab falls back to the batch's 19 Aug.
  const slabs = batch({ 1: null, 17: null, 18: null, 110: null, 111: null, 123: null });
  const run = forwardRunIds(slabs, "s18", key);
  assert.deepEqual(run, ["s18", "s110", "s111", "s123"]);
  // 1 and 17 are BEFORE 18 — never in the run.
  assert.ok(!run.includes("s1"));
  assert.ok(!run.includes("s17"));
});

test("forwardRunIds: a later change-point stops the run (111 already 21 Aug)", () => {
  // 111-123 were corrected to 21 Aug first; now editing 18 must stop at 110.
  const slabs = batch({ 1: null, 17: null, 18: null, 110: null, 111: "2025-08-21", 123: "2025-08-21" });
  const run = forwardRunIds(slabs, "s18", key);
  assert.deepEqual(run, ["s18", "s110"]);
  assert.ok(!run.includes("s111"));
  assert.ok(!run.includes("s123"));
});

test("forwardRunIds: the two orders land on the same final state", () => {
  // Order A: 18 first (18..123 -> 20 Aug), then 111 (111..123 -> 21 Aug).
  let slabs = batch({ 1: null, 17: null, 18: null, 110: null, 111: null, 123: null });
  const runA1 = forwardRunIds(slabs, "s18", key); // -> 18,110,111,123
  assert.deepEqual(runA1, ["s18", "s110", "s111", "s123"]);
  // apply 20 Aug to that run
  slabs = slabs.map((s) => (runA1.includes(s.id) ? { ...s, productionDate: "2025-08-20" } : s));
  const runA2 = forwardRunIds(slabs, "s111", key); // 111,123 share 20 Aug -> both
  assert.deepEqual(runA2, ["s111", "s123"]);

  // Order B: 111 first (111,123 -> 21 Aug), then 18 (stops at 110).
  let slabsB = batch({ 1: null, 17: null, 18: null, 110: null, 111: null, 123: null });
  const runB1 = forwardRunIds(slabsB, "s111", key);
  assert.deepEqual(runB1, ["s111", "s123"]);
  slabsB = slabsB.map((s) => (runB1.includes(s.id) ? { ...s, productionDate: "2025-08-21" } : s));
  const runB2 = forwardRunIds(slabsB, "s18", key);
  assert.deepEqual(runB2, ["s18", "s110"]); // stops before the 21 Aug at 111
});

test("forwardRunIds: an unknown start id yields just itself — never nothing", () => {
  const slabs = batch({ 1: null, 2: null });
  assert.deepEqual(forwardRunIds(slabs, "missing", key), ["missing"]);
});

test("forwardRunIds: works the same for thickness keys", () => {
  const slabs = [10, 11, 12, 13].map((sno) => ({
    id: `s${sno}`,
    thickness: null as number | null,
    batchRecipe: { thickness: 20 },
  }));
  // all fall back to 20 -> editing 11 takes 11..13
  assert.deepEqual(forwardRunIds(slabs, "s11", roboThicknessKey), ["s11", "s12", "s13"]);
  // now 13 is its own 15 -> editing 11 stops at 12
  const slabs2 = slabs.map((s) => (s.id === "s13" ? { ...s, thickness: 15 } : s));
  assert.deepEqual(forwardRunIds(slabs2, "s11", roboThicknessKey), ["s11", "s12"]);
});

test("bySerialThenCreated: S.No. ascending, nulls last, createdAt breaks a tie", () => {
  const rows = [
    { serialNumber: 3, createdAt: new Date(2025, 0, 1) },
    { serialNumber: null, createdAt: new Date(2025, 0, 1) },
    { serialNumber: 1, createdAt: new Date(2025, 0, 2) },
    { serialNumber: 1, createdAt: new Date(2025, 0, 1) },
  ];
  const sorted = [...rows].sort(bySerialThenCreated);
  assert.deepEqual(
    sorted.map((r) => [r.serialNumber, r.createdAt.getDate()]),
    [[1, 1], [1, 2], [3, 1], [null, 1]],
  );
});
