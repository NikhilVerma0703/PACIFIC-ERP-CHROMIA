import test from "node:test";
import assert from "node:assert/strict";

import { slabSearchWhere } from "../src/lib/robo/slabSearch.ts";

/* The "Find a Slab" filter. Production Date, Batch No., Slab Number and Design
   Name have to compose — an operator narrowing by two of them means AND. Batch
   No. and Design Name are the pair that can go wrong, because both live on the
   same related setup. */

test("no filters searches everything", () => {
  const { where, hasFilters } = slabSearchWhere({});
  assert.deepEqual(where, {});
  assert.equal(hasFilters, false);
});

test("blank and whitespace-only values are not filters", () => {
  const { where, hasFilters } = slabSearchWhere({ date: "  ", slabNumber: "", designName: null, batchNo: undefined });
  assert.deepEqual(where, {});
  assert.equal(hasFilters, false);
});

test("each filter narrows its own column", () => {
  assert.deepEqual(slabSearchWhere({ date: "2026-08-18" }).where, { shift: { date: "2026-08-18" } });
  assert.deepEqual(slabSearchWhere({ slabNumber: "140748" }).where, { slabNumber: { contains: "140748" } });
  assert.deepEqual(slabSearchWhere({ shiftId: "shift_1" }).where, { shiftId: "shift_1" });
  assert.deepEqual(slabSearchWhere({ batchNo: "B-1042" }).where, { batchRecipe: { batchNo: { contains: "B-1042" } } });
  assert.deepEqual(slabSearchWhere({ designName: "BANYAN" }).where, { batchRecipe: { designName: { contains: "BANYAN" } } });
});

test("batch number and design name AND together instead of overwriting", () => {
  // The bug this guards: two assignments to where.batchRecipe, the second
  // replacing the first, so one of the two filters silently does nothing.
  const { where } = slabSearchWhere({ batchNo: "B-1042", designName: "BANYAN" });
  assert.deepEqual(where, {
    batchRecipe: { designName: { contains: "BANYAN" }, batchNo: { contains: "B-1042" } },
  });
});

test("all four screen filters compose", () => {
  const { where, hasFilters } = slabSearchWhere({
    date: "2026-08-18",
    batchNo: " B-1042 ",
    slabNumber: " 140748 ",
    designName: " BANYAN ",
  });
  assert.deepEqual(where, {
    shift: { date: "2026-08-18" },
    slabNumber: { contains: "140748" },
    batchRecipe: { designName: { contains: "BANYAN" }, batchNo: { contains: "B-1042" } },
  });
  assert.equal(hasFilters, true);
});

test("values are trimmed, so a pasted space does not miss every row", () => {
  assert.deepEqual(slabSearchWhere({ batchNo: "  B-7  " }).where, { batchRecipe: { batchNo: { contains: "B-7" } } });
});
