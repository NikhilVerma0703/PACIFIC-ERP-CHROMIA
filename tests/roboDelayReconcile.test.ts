import test from "node:test";
import assert from "node:assert/strict";

import { planDelayReconcile, delayFieldsOf } from "../src/lib/robo/delayReconcile.ts";

/* The delay-log reconcile on PATCH /api/robo/production/[id]. The payload is
   the whole list as the operator left it; ids it carries decide update vs
   create, and this slab's ids it omits are deleted. Every id-bearing write
   must be scoped to the slab being edited. */

const item = (over: Record<string, unknown> = {}) => ({
  delayCodeId: "dc-power",
  machineId: "m1",
  machineName: "Robo 1",
  durationMinutes: 15,
  startTime: "10:00",
  endTime: "10:15",
  remarks: null,
  ...over,
});

test("planDelayReconcile: an owned id is kept and updated in place", () => {
  const plan = planDelayReconcile([item({ id: "d1" })], ["d1", "d2"]);
  assert.deepEqual(plan.keepIds, ["d1"]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "d1");
  assert.equal(plan.updates[0].fields.delayCodeId, "dc-power");
  assert.deepEqual(plan.creates, []);
  // d2 is not in keepIds, so the slab-scoped deleteMany removes it.
  assert.ok(!plan.keepIds.includes("d2"));
});

test("planDelayReconcile: a foreign id (another slab's delay) is created here, never written through", () => {
  // Slab A's payload carries slab B's delay id. Writing it through would put
  // A's code/machine/times onto B's row.
  const plan = planDelayReconcile([item({ id: "slabB-delay" })], ["a1"]);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].delayCodeId, "dc-power");
  // and it cannot shield anything of this slab from deletion
  assert.deepEqual(plan.keepIds, []);
});

test("planDelayReconcile: a stale id (row removed by another tab) becomes a new row instead of throwing", () => {
  // The slab currently owns nothing — the other tab deleted d1 and saved.
  const plan = planDelayReconcile([item({ id: "d1" })], []);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.creates.length, 1);
  assert.deepEqual(plan.keepIds, []);
});

test("planDelayReconcile: keepIds only ever names this slab's rows", () => {
  const plan = planDelayReconcile(
    [item({ id: "mine" }), item({ id: "theirs" }), item({ id: "" }), item()],
    ["mine", "other-mine"],
  );
  assert.deepEqual(plan.keepIds, ["mine"]);
  assert.deepEqual(plan.updates.map((u) => u.id), ["mine"]);
  // theirs, the blank id and the id-less row are all three created
  assert.equal(plan.creates.length, 3);
});

test("planDelayReconcile: a row with no delay code is neither saved nor lets a foreign id through", () => {
  const plan = planDelayReconcile(
    [item({ id: "mine", delayCodeId: "" }), item({ id: "theirs", delayCodeId: null }), item({ delayCodeId: undefined })],
    ["mine"],
  );
  // an owned row whose code was cleared is kept (as before), just not updated
  assert.deepEqual(plan.keepIds, ["mine"]);
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.creates, []);
});

test("planDelayReconcile: an empty payload keeps nothing, so the slab clears all its delays", () => {
  const plan = planDelayReconcile([], ["d1", "d2"]);
  assert.deepEqual(plan, { keepIds: [], updates: [], creates: [] });
});

test("delayFieldsOf: the stored shape is unchanged — blanks to null, duration to a number", () => {
  assert.deepEqual(
    delayFieldsOf({ delayCodeId: "dc", machineId: "", machineName: undefined, durationMinutes: "12", startTime: "", endTime: null, remarks: "" }),
    { machineId: null, machineName: null, delayCodeId: "dc", durationMinutes: 12, startTime: null, endTime: null, remarks: null },
  );
  assert.equal(delayFieldsOf({ delayCodeId: "dc", durationMinutes: "abc" }).durationMinutes, 0);
});
