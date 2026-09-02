import test from "node:test";
import assert from "node:assert/strict";

import { slabSearchWhere } from "../src/lib/robo/slabSearch.ts";
import { productionDateWhere } from "../src/lib/robo/productionDate.ts";

/* The "Find a Slab" filter. Production Date, Batch No., Slab Number and Design
   Name have to compose — an operator narrowing by two of them means AND.

   Batch No. no longer lives on the related setup as a `contains`: the route
   resolves the typed number to the setups it names (batchNo.ts / batchFilter.ts)
   and hands in `batchRecipeIds`, which this narrows on the scalar `batchRecipeId`
   FK. Design Name is the only filter left on the relation, so the old
   two-writers-one-relation hazard is gone — but the composition still has to
   hold, and that is what these pin.

   Production Date is the one to watch: not a column on the slab at all but a
   fallback across two relations, so it arrives as an OR that has to sit BESIDE
   the other keys rather than inside them. See productionDate.ts. */

/** The production-date match, so these tests state the composition rather than
 *  restating productionDateWhere's own shape — that is pinned in its own file. */
const onDate = (d: string) => productionDateWhere(d)!.OR;

test("no filters searches everything", () => {
  const { where, hasFilters } = slabSearchWhere({});
  assert.deepEqual(where, {});
  assert.equal(hasFilters, false);
});

test("blank and whitespace-only values are not filters", () => {
  const { where, hasFilters } = slabSearchWhere({ date: "  ", slabNumber: "", designName: null, batchRecipeIds: null });
  assert.deepEqual(where, {});
  assert.equal(hasFilters, false);
});

test("each filter narrows its own column", () => {
  assert.deepEqual(slabSearchWhere({ date: "2026-08-18" }).where, { OR: onDate("2026-08-18") });
  assert.deepEqual(slabSearchWhere({ slabNumber: "140748" }).where, { slabNumber: { contains: "140748" } });
  assert.deepEqual(slabSearchWhere({ shiftId: "shift_1" }).where, { shiftId: "shift_1" });
  assert.deepEqual(slabSearchWhere({ batchRecipeIds: ["r1", "r2"] }).where, { batchRecipeId: { in: ["r1", "r2"] } });
  assert.deepEqual(slabSearchWhere({ designName: "BANYAN" }).where, { batchRecipe: { designName: { contains: "BANYAN" } } });
});

test("a batch that matched nothing is an empty-in filter, NOT no filter", () => {
  // The route resolved a real, typed batch number to zero setups. That must
  // narrow to zero rows — `{ in: [] }` — not fall through to the whole register.
  const { where, hasFilters } = slabSearchWhere({ batchRecipeIds: [] });
  assert.deepEqual(where, { batchRecipeId: { in: [] } });
  assert.equal(hasFilters, true);
});

test("batch (by id) and design name AND together as separate top-level keys", () => {
  const { where } = slabSearchWhere({ batchRecipeIds: ["r1"], designName: "BANYAN" });
  assert.deepEqual(where, {
    batchRecipeId: { in: ["r1"] },
    batchRecipe: { designName: { contains: "BANYAN" } },
  });
});

test("all four screen filters compose", () => {
  const { where, hasFilters } = slabSearchWhere({
    date: "2026-08-18",
    batchRecipeIds: ["r1", "r2"],
    slabNumber: " 140748 ",
    designName: " BANYAN ",
  });
  assert.deepEqual(where, {
    OR: onDate("2026-08-18"),
    slabNumber: { contains: "140748" },
    batchRecipeId: { in: ["r1", "r2"] },
    batchRecipe: { designName: { contains: "BANYAN" } },
  });
  assert.equal(hasFilters, true);
});

test("the date filter sits beside the design filter, not inside it", () => {
  /* Putting the date INTO where.batchRecipe would collapse two independent
     narrowings into one relation filter. Prisma ANDs the top-level keys, so as
     separate keys they narrow each other: "this design, on this date". */
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
  // OR[0] is the slab's own per-slab date now; the setup date is OR[1]. Neither
  // is a bare shift.date filter, which is the bug this guards.
  assert.deepEqual(where.OR?.[0], { productionDate: "2026-08-13" });
  assert.deepEqual(where.OR?.[1], { productionDate: null, batchRecipe: { productionDate: "2026-08-13" } });
  assert.equal("shift" in where, false, "no bare shift.date filter may remain");
});

test("string values are trimmed, so a pasted space does not miss every row", () => {
  assert.deepEqual(slabSearchWhere({ slabNumber: "  140748  " }).where, { slabNumber: { contains: "140748" } });
  assert.deepEqual(slabSearchWhere({ designName: "  BANYAN  " }).where, { batchRecipe: { designName: { contains: "BANYAN" } } });
});
