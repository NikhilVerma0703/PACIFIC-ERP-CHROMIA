import test from "node:test";
import assert from "node:assert/strict";

import {
  slabSearchWhere,
  slabListTake,
  SLAB_LIST_MAX_TAKE,
  SLAB_LIST_DEFAULT_TAKE,
} from "../src/lib/robo/slabSearch.ts";
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

/* Which filters BOUND the result. A batch resolves to a finite set of setups, a
   date is a day, a shift is a shift. Slab Number and Design Name are substring
   `contains` matches, so alone they bound nothing — "1" is most of the register. */

test("bounded: batch ids, a date or a shift each bound the search", () => {
  assert.equal(slabSearchWhere({ batchRecipeIds: ["r1"] }).bounded, true);
  assert.equal(slabSearchWhere({ batchRecipeIds: [] }).bounded, true);   // a real filter that matches nothing
  assert.equal(slabSearchWhere({ date: "2026-08-18" }).bounded, true);
  assert.equal(slabSearchWhere({ shiftId: "shift_1" }).bounded, true);
});

test("bounded: substring filters alone do not, and no filter does not", () => {
  assert.equal(slabSearchWhere({}).bounded, false);
  assert.equal(slabSearchWhere({ slabNumber: "1" }).bounded, false);
  assert.equal(slabSearchWhere({ designName: "B" }).bounded, false);
  const both = slabSearchWhere({ slabNumber: "1", designName: "B" });
  assert.equal(both.hasFilters, true);
  assert.equal(both.bounded, false);
});

test("bounded: a substring filter combined with a bounded one is bounded", () => {
  assert.equal(slabSearchWhere({ slabNumber: "1", batchRecipeIds: ["r1"] }).bounded, true);
  assert.equal(slabSearchWhere({ designName: "B", date: "2026-08-18" }).bounded, true);
});

/* How many rows the list returns — the regression behind "batch 1423 shows 200
   on Slabs Records but 301 in Reports and Downloads". A BOUNDED search must
   return EVERY match (undefined = no Prisma limit), or a batch past 200 slabs is
   silently truncated and the operator cannot tell 200-of-301 from all of them.
   A substring-only search is the opposite hazard — one typed character fetching
   the whole register with three includes — so it keeps a cap. */

test("slabListTake: a BOUNDED search is uncapped — the whole batch, not 200", () => {
  // undefined means no `take`, so Prisma returns every matching row — this is
  // the fix. A 301-slab batch now comes back whole, like Reports/Downloads.
  assert.equal(slabListTake(0, true, true), undefined);
  assert.equal(slabListTake(NaN, true, true), undefined);
});

test("slabListTake: a substring-only search is capped at 500, not the whole register", () => {
  // Slab Number "1" or Design Name "B" alone: a real filter, but one that
  // matches most of the register. Capped like an explicit ?limit=, never open.
  assert.equal(slabListTake(0, true, false), SLAB_LIST_MAX_TAKE);
  assert.equal(slabListTake(0, true, false), 500);
  assert.equal(slabListTake(NaN, true, false), SLAB_LIST_MAX_TAKE);
});

test("slabListTake: NO filter stays capped at the latest 25 (register is unbounded)", () => {
  assert.equal(slabListTake(0, false, false), SLAB_LIST_DEFAULT_TAKE);
  assert.equal(slabListTake(0, false, false), 25);
});

test("slabListTake: an explicit ?limit= wins, and is capped at 500", () => {
  assert.equal(slabListTake(100, false, false), 100);
  assert.equal(slabListTake(100, true, true), 100);       // explicit beats the uncapped default too
  assert.equal(slabListTake(100, true, false), 100);      // and the substring cap
  assert.equal(slabListTake(9999, true, true), SLAB_LIST_MAX_TAKE);
  assert.equal(slabListTake(9999, false, false), 500);
  assert.equal(slabListTake(50.9, true, true), 50);       // truncated to a whole row count
});

test("slabListTake: a zero or negative limit is ignored, not treated as a real cap", () => {
  // Number("") === 0 and a stray "-5" must fall through to the real rule, never
  // pin the list to zero rows.
  assert.equal(slabListTake(0, true, true), undefined);
  assert.equal(slabListTake(-5, true, true), undefined);
  assert.equal(slabListTake(-5, true, false), SLAB_LIST_MAX_TAKE);
  assert.equal(slabListTake(-5, false, false), SLAB_LIST_DEFAULT_TAKE);
});
