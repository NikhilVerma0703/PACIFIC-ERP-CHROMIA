import test from "node:test";
import assert from "node:assert/strict";

import { resolveTargetBatch, sameBatchIdentity, isReparent, type BatchFields } from "../src/lib/robo/batchSplit.ts";

const cur: BatchFields = { batchNo: "1372", designName: "Crystallo", targetSlabs: 80 };

test("splitting off a new batch: ticked fields change, unticked keep the current", () => {
  const target = resolveTargetBatch(cur, {
    batchNo: { value: "1404", apply: true },
    designName: { value: "Bellagio green", apply: true },
    // Target Slabs box left unticked → keeps the current 80
  });
  assert.deepEqual(target, { batchNo: "1404", designName: "Bellagio green", targetSlabs: 80 });
  assert.equal(isReparent(cur, target), true);
});

test("changing only the design forward keeps the same number", () => {
  const target = resolveTargetBatch(cur, { designName: { value: "Bellagio green", apply: true } });
  assert.deepEqual(target, { batchNo: "1372", designName: "Bellagio green", targetSlabs: 80 });
  assert.equal(isReparent(cur, target), true); // design changed → different batch
});

test("nothing ticked → target equals current → not a re-parent", () => {
  const target = resolveTargetBatch(cur, {});
  assert.deepEqual(target, cur);
  assert.equal(isReparent(cur, target), false);
});

test("only Target Slabs ticked → same batch identity, NOT a re-parent", () => {
  const target = resolveTargetBatch(cur, { targetSlabs: { value: 120, apply: true } });
  assert.equal(target.targetSlabs, 120);
  assert.equal(sameBatchIdentity(cur, target), true);
  assert.equal(isReparent(cur, target), false); // just an attribute edit, no slab moves
});

test("identity matches on number AND design, trimmed & case-insensitive on design", () => {
  assert.equal(sameBatchIdentity(cur, { batchNo: " 1372 ", designName: "crystallo", targetSlabs: 999 }), true);
  assert.equal(sameBatchIdentity(cur, { batchNo: "1372", designName: "Bellagio green", targetSlabs: 80 }), false); // same no, diff design
  assert.equal(sameBatchIdentity(cur, { batchNo: "1404", designName: "Crystallo", targetSlabs: 80 }), false);      // diff no, same design
});

test("a re-parent is driven by the resolved target, ticked box included", () => {
  const t1 = resolveTargetBatch(cur, { batchNo: { value: "1372", apply: true } }); // re-typing the same number
  assert.equal(isReparent(cur, t1), false); // same identity → no move
  const t2 = resolveTargetBatch(cur, { batchNo: { value: "1405", apply: true } });
  assert.equal(isReparent(cur, t2), true);
});
