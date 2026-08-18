import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReleasePlan } from "../src/lib/fab/releasePlan.ts";

// Release is the moment planning becomes physical work: every piece created here
// carries the slab it will be cut from, and a wrong slab sends a cutter to the
// wrong stone. The old rule put every piece of a requirement on allocations[0].

test("a split requirement lands on the slabs it was split across", () => {
  const plan = buildReleasePlan({
    quantity: 5,
    allocations: [
      { slabId: "slabA", allocatedQuantity: 2 },
      { slabId: "slabB", allocatedQuantity: 3 },
    ],
    fallbackSlabId: "default",
  });
  assert.deepEqual(plan.slabIds, ["slabA", "slabA", "slabB", "slabB", "slabB"]);
  assert.equal(plan.overAllocatedBy, 0);
  // The whole point: slabB gets work. Reading allocations[0] gave five slabA.
  assert.equal(plan.slabIds.filter(s => s === "slabB").length, 3);
});

test("no allocations: the drawing default carries the whole requirement", () => {
  const plan = buildReleasePlan({ quantity: 3, allocations: [], fallbackSlabId: "default" });
  assert.deepEqual(plan.slabIds, ["default", "default", "default"]);
  assert.equal(plan.overAllocatedBy, 0);
});

test("under-allocation is topped up rather than shipped short", () => {
  // Two of the four pieces were allocated; the rest still have to be cut, so
  // they go to the fallback. Piece count must equal the quantity ordered.
  const plan = buildReleasePlan({
    quantity: 4,
    allocations: [{ slabId: "slabA", allocatedQuantity: 2 }],
    fallbackSlabId: "default",
  });
  assert.deepEqual(plan.slabIds, ["slabA", "slabA", "default", "default"]);
  assert.equal(plan.slabIds.length, 4);
});

test("under-allocation with no fallback tops up from the allocated slab", () => {
  // No drawing default. Falling through would drop pieces silently — the order
  // would be cut short and nobody would find out until the packing bench.
  const plan = buildReleasePlan({
    quantity: 3,
    allocations: [{ slabId: "slabA", allocatedQuantity: 1 }],
    fallbackSlabId: null,
  });
  assert.deepEqual(plan.slabIds, ["slabA", "slabA", "slabA"]);
});

test("over-allocation is capped at the order and reported, never overproduced", () => {
  const plan = buildReleasePlan({
    quantity: 4,
    allocations: [
      { slabId: "slabA", allocatedQuantity: 3 },
      { slabId: "slabB", allocatedQuantity: 3 },
    ],
    fallbackSlabId: null,
  });
  assert.equal(plan.slabIds.length, 4);
  assert.equal(plan.overAllocatedBy, 2);
});

test("nothing to release: no slab anywhere produces no pieces, not a hang", () => {
  // `while (length < quantity) push(fallback)` with a null fallback is an
  // infinite loop if the guard is written the obvious way.
  const plan = buildReleasePlan({ quantity: 3, allocations: [], fallbackSlabId: null });
  assert.deepEqual(plan.slabIds, []);
  assert.equal(plan.overAllocatedBy, 0);
});

test("junk quantities cannot spin the loop or mint stray pieces", () => {
  const plan = buildReleasePlan({
    quantity: 2,
    allocations: [
      { slabId: "slabA", allocatedQuantity: -1 },
      { slabId: "slabB", allocatedQuantity: 1.6 },
    ],
    fallbackSlabId: "default",
  });
  assert.deepEqual(plan.slabIds, ["slabB", "default"]);
});
