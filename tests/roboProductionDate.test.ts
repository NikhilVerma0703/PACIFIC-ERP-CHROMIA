import test from "node:test";
import assert from "node:assert/strict";

import {
  delayProductionDateOf,
  delayProductionDateWhere,
  delayProductionDateRangeWhere,
  delayProductionDateSelectWhere,
  productionDateOf,
  productionDateWhere,
  productionDateRangeWhere,
  productionDateSelectWhere,
  setupProductionDate,
  setupProductionDateRangeWhere,
  setupProductionDateSelectWhere,
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

test("a slab's OWN date wins over the setup — a batch past midnight", () => {
  // Slab 81 at 00:03: the setup still says the 1st, the slab says the 2nd, and
  // the slab's own day is what shows. Slabs 1-80 (no own date) keep the setup's.
  assert.equal(
    productionDateOf({ productionDate: "2026-09-02", batchRecipe: { productionDate: "2026-09-01" }, shift: { date: "2026-09-01" } }),
    "2026-09-02",
  );
  assert.equal(
    productionDateOf({ productionDate: null, batchRecipe: { productionDate: "2026-09-01" }, shift: { date: "2026-09-01" } }),
    "2026-09-01",
  );
  // A blank per-slab date is no date — falls straight through to the setup.
  assert.equal(
    productionDateOf({ productionDate: "  ", batchRecipe: { productionDate: "2026-09-01" } }),
    "2026-09-01",
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
      // The slab's own date first — a batch past midnight.
      { productionDate: "2026-08-13" },
      // Then the setup/shift fallback, each branch pinned to "no slab date".
      { productionDate: null, batchRecipe: { productionDate: "2026-08-13" } },
      { productionDate: null, batchRecipe: { productionDate: null }, shift: { date: "2026-08-13" } },
      { productionDate: null, batchRecipe: { productionDate: "" }, shift: { date: "2026-08-13" } },
      { productionDate: null, batchRecipe: null, shift: { date: "2026-08-13" } },
    ],
  });
});

test("the fallback branches pin the slab date to null, or the search over-matches", () => {
  /* Two ways this over-matches without the null pins. A slab with its OWN date
     of the 2nd must not also come back for the 1st just because its setup says
     the 1st — the four fallback branches require `productionDate: null`, so it
     can't. And a slab whose setup is dated the 13th must not come back for the
     17th because its shift says the 17th — the setup pins handle that, exactly
     as before the per-slab date existed. */
  const where = productionDateWhere("2026-08-17");
  assert.deepEqual(where!.OR[0], { productionDate: "2026-08-17" });
  assert.deepEqual(where!.OR[1], { productionDate: null, batchRecipe: { productionDate: "2026-08-17" } });
  // "No setup date" is NULL *or* "", one branch each — productionDateOf() falls
  // back to the shift for a blank setup date too. The per-slab column, by
  // contrast, is null-or-real (never ""), so it needs only the one `null` pin.
  assert.deepEqual(where!.OR[2], { productionDate: null, batchRecipe: { productionDate: null }, shift: { date: "2026-08-17" } });
  assert.deepEqual(where!.OR[3], { productionDate: null, batchRecipe: { productionDate: "" }, shift: { date: "2026-08-17" } });
});

test("a blank date is no filter at all, so it can be spread unconditionally", () => {
  assert.equal(productionDateWhere(""), undefined);
  assert.equal(productionDateWhere("   "), undefined);
  assert.equal(productionDateWhere(null), undefined);
  assert.equal(productionDateWhere(undefined), undefined);
});

test("the date is trimmed before it is used", () => {
  assert.deepEqual(productionDateWhere(" 2026-08-13 ")!.OR[0], { productionDate: "2026-08-13" });
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

test("a delay takes its slab's OWN per-slab date when it has one", () => {
  assert.equal(
    delayProductionDateOf({
      productionRecord: { productionDate: "2026-09-02", batchRecipe: { productionDate: "2026-09-01" } },
      shift: { date: "2026-09-01" },
    }),
    "2026-09-02",
  );
});

test("the delay search covers the slab-less case the slab search does not need", () => {
  const where = delayProductionDateWhere("2026-08-13");
  assert.equal(where!.OR.length, 6);
  assert.deepEqual(where!.OR[0], { productionRecord: { productionDate: "2026-08-13" } });
  assert.deepEqual(where!.OR[1], { productionRecord: { productionDate: null, batchRecipe: { productionDate: "2026-08-13" } } });
  assert.deepEqual(where!.OR[5], { productionRecord: null, shift: { date: "2026-08-13" } });
});

test("a blank delay date is no filter either", () => {
  assert.equal(delayProductionDateWhere(""), undefined);
  assert.equal(delayProductionDateWhere(null), undefined);
});

/* ── ranges ──────────────────────────────────────────────────────────────
   The "Date Range" filter: every slab whose Production Date falls between From
   and To, both included. Same four cases as the single-date search, windowed,
   with `not: ""` keeping the no-date marker out of the setup-dated branch so an
   open low bound never sweeps in date-less rows. */

test("a bounded window matches the cases, ranged, slab date first", () => {
  assert.deepEqual(productionDateRangeWhere("2026-08-01", "2026-08-31"), {
    OR: [
      // The slab's own date, in window. Null is excluded by SQL comparison and
      // the column never holds "", so no `not: ""` is needed on this branch.
      { productionDate: { gte: "2026-08-01", lte: "2026-08-31" } },
      { productionDate: null, batchRecipe: { productionDate: { gte: "2026-08-01", lte: "2026-08-31", not: "" } } },
      { productionDate: null, batchRecipe: { productionDate: null }, shift: { date: { gte: "2026-08-01", lte: "2026-08-31" } } },
      { productionDate: null, batchRecipe: { productionDate: "" }, shift: { date: { gte: "2026-08-01", lte: "2026-08-31" } } },
      { productionDate: null, batchRecipe: null, shift: { date: { gte: "2026-08-01", lte: "2026-08-31" } } },
    ],
  });
});

test("an open bound is a one-sided window, and the no-date guard stays on the setup branch", () => {
  // From only — the slab-date branch is a plain gte (null excluded by SQL), and
  // the SETUP branch keeps `not: ""` because a blank setup date means "fall back
  // to the shift", not "matches every open-low window".
  const fromOnly = productionDateRangeWhere("2026-08-01", "")!;
  assert.deepEqual(fromOnly.OR[0], { productionDate: { gte: "2026-08-01" } });
  assert.deepEqual(fromOnly.OR[1], { productionDate: null, batchRecipe: { productionDate: { gte: "2026-08-01", not: "" } } });
  // To only — "" <= any date is true, so without `not: ""` every date-less
  // setup row would wrongly match; the guard keeps them on the shift branches.
  const toOnly = productionDateRangeWhere("", "2026-08-31")!;
  assert.deepEqual(toOnly.OR[0], { productionDate: { lte: "2026-08-31" } });
  assert.deepEqual(toOnly.OR[1], { productionDate: null, batchRecipe: { productionDate: { lte: "2026-08-31", not: "" } } });
});

test("a range with both bounds blank is no filter", () => {
  assert.equal(productionDateRangeWhere("", ""), undefined);
  assert.equal(productionDateRangeWhere(null, undefined), undefined);
  assert.equal(productionDateRangeWhere("  ", "  "), undefined);
});

test("the setup range drops the slab-less branch, the delay range keeps the extra one", () => {
  // A setup always has its required shift, so three branches, not four. The
  // setup has no per-slab date of its own, so its shape is unchanged.
  assert.equal(setupProductionDateRangeWhere("2026-08-01", "2026-08-31")!.OR.length, 3);
  assert.deepEqual(setupProductionDateRangeWhere("2026-08-01", "2026-08-31")!.OR[0], {
    productionDate: { gte: "2026-08-01", lte: "2026-08-31", not: "" },
  });
  // A delay: slab date first, then the setup/shift fallback, then the slab-less
  // case — six branches, windowed.
  const delayRange = delayProductionDateRangeWhere("2026-08-01", "2026-08-31")!;
  assert.equal(delayRange.OR.length, 6);
  assert.deepEqual(delayRange.OR[0], {
    productionRecord: { productionDate: { gte: "2026-08-01", lte: "2026-08-31" } },
  });
  assert.deepEqual(delayRange.OR[5], {
    productionRecord: null, shift: { date: { gte: "2026-08-01", lte: "2026-08-31" } },
  });
});

/* ── one filter from a screen's selection ──────────────────────────────────
   All / Date Wise / Date Range collapses to a single where. A range beats a
   single date, so a From or To present wins and a stale `date` cannot leak in. */

test("a selection with neither date nor range is no filter", () => {
  assert.equal(productionDateSelectWhere({ date: "", from: "", to: "" }), undefined);
  assert.equal(productionDateSelectWhere({}), undefined);
  assert.equal(setupProductionDateSelectWhere({}), undefined);
  assert.equal(delayProductionDateSelectWhere({}), undefined);
});

test("a selection with only a date is the single-date search", () => {
  assert.deepEqual(productionDateSelectWhere({ date: "2026-08-13" }), productionDateWhere("2026-08-13"));
  assert.deepEqual(delayProductionDateSelectWhere({ date: "2026-08-13" }), delayProductionDateWhere("2026-08-13"));
});

test("a From or a To makes it a range, and the range wins over a stray date", () => {
  assert.deepEqual(
    productionDateSelectWhere({ from: "2026-08-01", to: "2026-08-31" }),
    productionDateRangeWhere("2026-08-01", "2026-08-31"),
  );
  // date is present too, but the range takes precedence — no leak.
  assert.deepEqual(
    productionDateSelectWhere({ date: "2026-08-13", from: "2026-08-01", to: "" }),
    productionDateRangeWhere("2026-08-01", ""),
  );
  assert.deepEqual(
    setupProductionDateSelectWhere({ from: "", to: "2026-08-31" }),
    setupProductionDateRangeWhere("", "2026-08-31"),
  );
});
