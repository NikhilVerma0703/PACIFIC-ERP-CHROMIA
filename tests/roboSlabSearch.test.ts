import test from "node:test";
import assert from "node:assert/strict";

import { slabSearchWhere } from "../src/lib/robo/slabSearch.ts";
import { productionDateWhere } from "../src/lib/robo/productionDate.ts";

/* The "Find a Slab" filter. Production Date, Batch No., Slab Number and Design
   Name have to compose — an operator narrowing by two of them means AND. Batch
   No. and Design Name are the pair that can go wrong, because both live on the
   same related setup.

   Production Date is the other one to watch: it is not a column on the slab at
   all but a fallback across two relations, so it arrives as an OR that has to
   sit BESIDE the setup filter rather than inside it. See productionDate.ts. */

/** The production-date match, so these tests state the composition rather than
 *  restating productionDateWhere's own shape — that is pinned in its own file. */
const onDate = (d: string) => productionDateWhere(d)!.OR;

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
  assert.deepEqual(slabSearchWhere({ date: "2026-08-18" }).where, { OR: onDate("2026-08-18") });
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
    OR: onDate("2026-08-18"),
    slabNumber: { contains: "140748" },
    batchRecipe: { designName: { contains: "BANYAN" }, batchNo: { contains: "B-1042" } },
  });
  assert.equal(hasFilters, true);
});

test("the date filter sits beside the setup filter, not inside it", () => {
  /* Both narrow the setup, so putting the date INTO where.batchRecipe would be
     the same clobbering bug this module exists to prevent, one relation over.
     Prisma ANDs the top-level keys, so as separate keys they narrow each other:
     "this design, on this production date". */
  const { where } = slabSearchWhere({ date: "2026-08-18", designName: "BANYAN" });
  assert.deepEqual(Object.keys(where).sort(), ["OR", "batchRecipe"]);
  assert.deepEqual(where.batchRecipe, { designName: { contains: "BANYAN" } });
  assert.deepEqual(where.OR, onDate("2026-08-18"));
});

test("the date is the one the operator entered, not the shift's own", () => {
  /* The bug: Production Date was matched against RoboShift.date, which the
     entry form sets to the day the tablet was open. Searching for last
     Thursday's run came back empty, because every one of those slabs sat on a
     shift row dated whenever the register was caught up. */
  const { where } = slabSearchWhere({ date: "2026-08-13" });
  assert.deepEqual(where.OR?.[0], { batchRecipe: { productionDate: "2026-08-13" } });
  assert.equal("shift" in where, false, "no bare shift.date filter may remain");
});

test("values are trimmed, so a pasted space does not miss every row", () => {
  assert.deepEqual(slabSearchWhere({ batchNo: "  B-7  " }).where, { batchRecipe: { batchNo: { contains: "B-7" } } });
});
