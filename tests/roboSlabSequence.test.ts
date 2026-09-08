import test from "node:test";
import assert from "node:assert/strict";

import {
  slabNumberValue,
  compareSlabOrder,
  sequencedByBatch,
  sequenceNumbersById,
  type SeqSlab,
} from "../src/lib/robo/slabSequence.ts";

/* S.No. is derived from the physical slab number (the authoritative production
   sequence), never from the mistyped stored serialNumber. */

test("slab numbers sort as numbers, not as text", () => {
  assert.equal(slabNumberValue("9"), 9);
  assert.equal(slabNumberValue("10"), 10);
  assert.equal(slabNumberValue("148775"), 148775);
  // leading zeros are value, not order
  assert.equal(slabNumberValue("00042"), 42);
  // no leading digit → sorts after every real number
  assert.equal(slabNumberValue("A-12"), Number.MAX_SAFE_INTEGER);
  assert.equal(slabNumberValue(""), Number.MAX_SAFE_INTEGER);
  assert.equal(slabNumberValue(null), Number.MAX_SAFE_INTEGER);
});

test("a batch with mistyped S.No. still numbers 1..N by slab number", () => {
  // The reported case: slab numbers run clean 148775.. even though the operator's
  // S.No. went 1..3 then restarted. Delivered shuffled to prove order comes from
  // the slab number, not input order.
  const slabs: (SeqSlab & { id: string; serial?: number })[] = [
    { id: "c", slabNumber: "148777", serial: 1 },  // operator restarted S.No. at 1
    { id: "a", slabNumber: "148775", serial: 1 },
    { id: "b", slabNumber: "148776", serial: 2 },
  ];
  const seq = sequencedByBatch(slabs);
  assert.deepEqual(seq.map((x) => x.slab.id), ["a", "b", "c"]);
  assert.deepEqual(seq.map((x) => x.seqNo), [1, 2, 3]);
});

test("numeric ordering beats string ordering across a digit-count boundary", () => {
  const slabs: (SeqSlab & { id: string })[] = [
    { id: "x", slabNumber: "100" },
    { id: "y", slabNumber: "99" },
  ];
  assert.deepEqual(sequencedByBatch(slabs).map((s) => s.slab.id), ["y", "x"]); // 99 before 100
});

test("ties (equal / non-numeric numbers) fall to entry order then id, deterministically", () => {
  const slabs: (SeqSlab & { id: string })[] = [
    { id: "b", slabNumber: "A", createdAtMs: 200 },
    { id: "a", slabNumber: "A", createdAtMs: 100 },
    { id: "c", slabNumber: "A", createdAtMs: 100 }, // same time as a → id breaks it
  ];
  const order = sequencedByBatch(slabs).map((s) => s.slab.id);
  assert.deepEqual(order, ["a", "c", "b"]); // 100/a, 100/c, then 200/b
  // stable across a reshuffle
  const reshuffled = sequencedByBatch([slabs[2], slabs[0], slabs[1]]).map((s) => s.slab.id);
  assert.deepEqual(reshuffled, order);
});

test("compareSlabOrder is a total order usable directly in sort()", () => {
  const arr: (SeqSlab & { id: string })[] = [
    { id: "3", slabNumber: "300" },
    { id: "1", slabNumber: "100" },
    { id: "2", slabNumber: "200" },
  ];
  assert.deepEqual([...arr].sort(compareSlabOrder).map((s) => s.id), ["1", "2", "3"]);
});

test("sequenceNumbersById numbers each batch on its own, 1..N", () => {
  const slabs = [
    { id: "a1", slabNumber: "500", batch: "A" },
    { id: "a2", slabNumber: "501", batch: "A" },
    { id: "b1", slabNumber: "800", batch: "B" },
    { id: "a3", slabNumber: "502", batch: "A" },
    { id: "b2", slabNumber: "799", batch: "B" }, // lower number → B's first
  ];
  const m = sequenceNumbersById(slabs, (s) => s.batch);
  assert.equal(m.get("a1"), 1);
  assert.equal(m.get("a2"), 2);
  assert.equal(m.get("a3"), 3);
  assert.equal(m.get("b2"), 1); // 799 < 800
  assert.equal(m.get("b1"), 2);
});

test("empty input yields no rows and no ranks", () => {
  assert.deepEqual(sequencedByBatch([]), []);
  assert.equal(sequenceNumbersById([], () => "x").size, 0);
});
