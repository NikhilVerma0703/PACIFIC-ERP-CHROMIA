import test from "node:test";
import assert from "node:assert/strict";

import {
  delayProductionDateOf,
  delayProductionDateWhere,
  productionDateOf,
  productionDateWhere,
  setupProductionDate,
} from "../src/lib/robo/productionDate.ts";

/* Production Date used to be read off RoboShift.date on every screen — and a
   shift row is plumbing the entry form creates silently with today's date, not
   anything anybody fills in. So a register caught up on Monday for a run that
   happened on Thursday said Monday, everywhere, on every slab. */

test("the date the operator typed on the setup is the production date", () => {
  assert.equal(
    productionDateOf({ batchRecipe: { productionDate: "2026-08-13" }, shift: { date: "2026-08-17" } }),
    "2026-08-13",
  );
});

test("a setup saved before that field existed falls back to its shift", () => {
  assert.equal(productionDateOf({ batchRecipe: { productionDate: null }, shift: { date: "2026-08-17" } }), "2026-08-17");
  assert.equal(productionDateOf({ batchRecipe: { productionDate: "  " }, shift: { date: "2026-08-17" } }), "2026-08-17");
});

test("a slab logged without a setup falls back to its shift too", () => {
  assert.equal(productionDateOf({ batchRecipe: null, shift: { date: "2026-08-17" } }), "2026-08-17");
  assert.equal(productionDateOf({ shift: { date: "2026-08-17" } }), "2026-08-17");
});

test("nothing anywhere is empty, so the screen can show its own dash", () => {
  assert.equal(productionDateOf({ batchRecipe: null, shift: null }), "");
  assert.equal(productionDateOf({}), "");
  assert.equal(productionDateOf(null), "");
  assert.equal(productionDateOf(undefined), "");
});

test("a setup row answers the same way from its own shift", () => {
  assert.equal(setupProductionDate({ productionDate: "2026-08-13", shift: { date: "2026-08-17" } }), "2026-08-13");
  assert.equal(setupProductionDate({ productionDate: null, shift: { date: "2026-08-17" } }), "2026-08-17");
  assert.equal(setupProductionDate(null), "");
});

test("the search matches exactly what the column shows", () => {
  const where = productionDateWhere("2026-08-13");
  assert.deepEqual(where, {
    OR: [
      { batchRecipe: { productionDate: "2026-08-13" } },
      { batchRecipe: { productionDate: null }, shift: { date: "2026-08-13" } },
      { batchRecipe: { productionDate: "" }, shift: { date: "2026-08-13" } },
      { batchRecipe: null, shift: { date: "2026-08-13" } },
    ],
  });
});

test("the fallback branch pins productionDate to null, or the search over-matches", () => {
  /* Without `productionDate: null` on the second branch, a slab whose setup is
     dated the 13th would ALSO come back when searching the 17th — because its
     shift row happens to say the 17th. That is the exact confusion this
     replaces, reappearing inside the search. */
  const where = productionDateWhere("2026-08-17");
  // "Unset" is NULL *or* "", one branch each: productionDateOf() falls back to
  // the shift for a blank string too, so a filter that only matched NULL would
  // print a date on a row nothing could find. Prisma's `in` takes string[] and
  // cannot carry a null, so this cannot be collapsed into one branch.
  assert.deepEqual(where!.OR[1], { batchRecipe: { productionDate: null }, shift: { date: "2026-08-17" } });
  assert.deepEqual(where!.OR[2], { batchRecipe: { productionDate: "" }, shift: { date: "2026-08-17" } });
});

test("a blank date is no filter at all, so it can be spread unconditionally", () => {
  assert.equal(productionDateWhere(""), undefined);
  assert.equal(productionDateWhere("   "), undefined);
  assert.equal(productionDateWhere(null), undefined);
  assert.equal(productionDateWhere(undefined), undefined);
});

test("the date is trimmed before it is used", () => {
  assert.deepEqual(productionDateWhere(" 2026-08-13 ")!.OR[0], { batchRecipe: { productionDate: "2026-08-13" } });
});

/* ── delays ────────────────────────────────────────────────────────────────
   A delay is dated by the SLAB it held up, so a delay and its slab never land
   on two different days in the same workbook. */

test("a delay takes the production date of the slab it held up", () => {
  assert.equal(
    delayProductionDateOf({
      productionRecord: { batchRecipe: { productionDate: "2026-08-13" }, shift: { date: "2026-08-17" } },
      shift: { date: "2026-08-17" },
    }),
    "2026-08-13",
  );
});

test("a delay logged against no slab at all is dated by its shift", () => {
  // RoboDelayLog.productionRecordId is nullable — a line stoppage between
  // slabs belongs to the shift and nothing else.
  assert.equal(delayProductionDateOf({ productionRecord: null, shift: { date: "2026-08-17" } }), "2026-08-17");
  assert.equal(delayProductionDateOf({ shift: { date: "2026-08-17" } }), "2026-08-17");
  assert.equal(delayProductionDateOf({}), "");
  assert.equal(delayProductionDateOf(null), "");
});

test("a delay on a slab whose setup carries no date falls back to the shift", () => {
  assert.equal(
    delayProductionDateOf({
      productionRecord: { batchRecipe: { productionDate: null } },
      shift: { date: "2026-08-17" },
    }),
    "2026-08-17",
  );
});

test("the delay search covers the slab-less case the slab search does not need", () => {
  const where = delayProductionDateWhere("2026-08-13");
  assert.equal(where!.OR.length, 5);
  assert.deepEqual(where!.OR[0], { productionRecord: { batchRecipe: { productionDate: "2026-08-13" } } });
  assert.deepEqual(where!.OR[4], { productionRecord: null, shift: { date: "2026-08-13" } });
});

test("a blank delay date is no filter either", () => {
  assert.equal(delayProductionDateWhere(""), undefined);
  assert.equal(delayProductionDateWhere(null), undefined);
});
