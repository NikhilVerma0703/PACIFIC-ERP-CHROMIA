import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBatch, parentBatch } from "../src/lib/normalizeBatch.ts";

test("normalizeBatch collapses formatting variants to one key", () => {
  assert.equal(normalizeBatch("D1310"), normalizeBatch("1310"));
  assert.equal(normalizeBatch("1 194"), normalizeBatch("1194"));
  assert.equal(normalizeBatch("1,194"), normalizeBatch("1194"));
});

test("normalizeBatch: design-switch sub-batches keep their letter suffix", () => {
  assert.equal(normalizeBatch("1359 A"), "1359-A");
  assert.equal(normalizeBatch("D1359 A"), "1359-A");
  assert.equal(normalizeBatch("1359a"), "1359-A");
});

test("parentBatch strips the sub-batch suffix", () => {
  assert.equal(parentBatch("1359-A"), "1359");
});
