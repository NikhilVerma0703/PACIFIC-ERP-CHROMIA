import { test } from "node:test";
import assert from "node:assert/strict";
import {
  basisOverrides, daysInMonthOf, dosingOverrides, isOverridable, isSplittable,
  linesByItem, OVERRIDABLE_CATEGORIES, splitMaterial, summariseSplit,
  type BatchMaterialLine,
} from "../src/lib/costing/batchRates.ts";

// The split decides what a batch costs. Every case below is one where getting
// it wrong produces a plausible-looking number rather than an error — the only
// kind of costing bug that survives to a customer quote.

const line = (o: Partial<BatchMaterialLine>): BatchMaterialLine => ({
  item: "resin", seq: 0, category: "RESIN", qty: null, rate: 161, description: "", ...o,
});

// --- the ordinary case ------------------------------------------------------

test("a material with no lines is priced whole at the card rate", () => {
  // The guarantee that keeps this safe: a batch nobody has touched must price
  // exactly as it did before any of this existed.
  const r = splitMaterial(1000, [], 161);
  assert.deepEqual(r.lines, [{ qty: 1000, rate: 161, description: "", fromBatch: false }]);
  assert.equal(r.remainder, 0);
  assert.deepEqual(r.problems, []);
});

test("no lines and no card rate leaves the quantity unpriced, not free", () => {
  // Pricing it at zero would make the batch look cheap; the report shows this
  // as "consumed but not priced" instead.
  const r = splitMaterial(1000, [], null);
  assert.deepEqual(r.lines, []);
  assert.equal(r.unpriced, 1000);
});

// --- the thing this was built for -------------------------------------------

test("one tonne of resin splits into two priced deliveries", () => {
  // The worked example: 600 kg from one supplier, 400 from another, each with
  // its own price and a description saying which is which.
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: 600, rate: 161, description: "Aypols · PO-4471" }),
    line({ seq: 1, qty: 400, rate: 145, description: "3n Composits" }),
  ], 161);

  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines.map((l) => [l.qty, l.rate]), [[600, 161], [400, 145]]);
  assert.equal(r.lines[0].description, "Aypols · PO-4471");
  assert.ok(r.lines.every((l) => l.fromBatch));
  assert.equal(r.remainder, 0);
  assert.deepEqual(r.problems, [], "a balanced split is not a problem");

  // And the money is the point: 600×161 + 400×145 = 154,600, not 1000 × any
  // single average rate.
  const total = r.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  assert.equal(total, 154_600);
});

test("a line with no quantity takes whatever is left", () => {
  // The common shape: split off the one drum you have a price for and let the
  // rest fall through.
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: 250, rate: 180, description: "trial drum" }),
    line({ seq: 1, qty: null, rate: 161, description: "regular stock" }),
  ], null);
  assert.deepEqual(r.lines.map((l) => [l.qty, l.description]),
    [[250, "trial drum"], [750, "regular stock"]]);
  assert.equal(r.remainder, 0);
});

test("lines consume in seq order, so the catch-all does not swallow everything", () => {
  // Entered in the other order. If the null-qty line were applied first it
  // would take all 1000 and the 250 would be added ON TOP, over-pricing the
  // batch by a quarter.
  const r = splitMaterial(1000, [
    line({ seq: 1, qty: 250, rate: 180, description: "second" }),
    line({ seq: 0, qty: null, rate: 161, description: "first" }),
  ], null);
  assert.deepEqual(r.lines.map((l) => [l.qty, l.description]),
    [[1000, "first"], [250, "second"]]);
  // ...and that IS over-allocated, which must be reported.
  assert.ok(r.problems.some((p) => /more is being priced than was weighed/.test(p)));
});

// --- when the split and the mixer disagree ----------------------------------

test("an under-allocated split prices the rest at the card rate", () => {
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: 600, rate: 172, description: "Aypols" }),
  ], 161);
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[1], {
    qty: 400, rate: 161, description: "the rest, at the card rate", fromBatch: false,
  });
  assert.equal(r.remainder, 400);
  assert.equal(r.unpriced, 0);
});

test("an under-allocated split with no card rate reports the gap loudly", () => {
  // Resin has a rate per supplier, so there is no single card rate to fall back
  // on. Guessing one would book the leftover to a supplier nobody named.
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: 600, rate: 172, description: "Aypols" }),
  ], null);
  assert.equal(r.lines.length, 1);
  assert.equal(r.unpriced, 400);
  assert.ok(r.problems.some((p) => /NOT in the total/.test(p)));
});

test("an over-allocated split still prices what was entered, and says so", () => {
  // The person said what they bought. Silently clamping to the mixer figure
  // would hide a disagreement that means one of the two records is wrong.
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: 700, rate: 161, description: "A" }),
    line({ seq: 1, qty: 500, rate: 145, description: "B" }),
  ], 161);
  assert.equal(r.lines.length, 2, "nothing was dropped");
  assert.equal(r.remainder, 0);
  assert.ok(r.problems.some((p) => /1200.*1000|more is being priced/.test(p)));
});

test("the mixer figure moving later does not blank the costing", () => {
  // The reason the rule is not "they must add up": a corrected mixer row
  // re-costs the batch, so a split that balanced when typed can stop balancing
  // without anyone touching it. It must still price.
  const split = [
    line({ seq: 0, qty: 600, rate: 161, description: "A" }),
    line({ seq: 1, qty: 400, rate: 145, description: "B" }),
  ];
  const corrected = splitMaterial(950, split, 161);
  assert.equal(corrected.lines.length, 2, "still priced after the mixer changed");
  assert.ok(corrected.problems.length > 0, "and the disagreement is surfaced");
});

test("a catch-all line after the quantity is used up prices nothing, and says why", () => {
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: 1000, rate: 161, description: "all of it" }),
    line({ seq: 1, qty: null, rate: 145, description: "leftovers" }),
  ], 161);
  assert.equal(r.lines.length, 1);
  assert.ok(r.problems.some((p) => /prices nothing/.test(p)));
});

// --- rubbish input ----------------------------------------------------------

test("a line with no usable price is left out rather than priced at zero", () => {
  for (const bad of [0, -5, Number.NaN]) {
    const r = splitMaterial(1000, [
      line({ seq: 0, qty: 400, rate: bad as number, description: "bad" }),
      line({ seq: 1, qty: 600, rate: 161, description: "good" }),
    ], null);
    assert.equal(r.lines.length, 1, `rate ${bad} was priced`);
    assert.equal(r.lines[0].description, "good");
    assert.ok(r.problems.some((p) => /no usable price/.test(p)));
  }
});

test("a line with no usable quantity is left out", () => {
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: -100, rate: 161, description: "negative" }),
  ], null);
  assert.equal(r.lines.length, 0);
  assert.ok(r.problems.some((p) => /no usable quantity/.test(p)));
});

test("rounding noise is not treated as a shortfall", () => {
  // Kilos off a scale. 0.002 left over is not worth a warning line on a sheet.
  const r = splitMaterial(1000, [
    line({ seq: 0, qty: 999.998, rate: 161, description: "A" }),
  ], 161);
  assert.equal(r.lines.length, 1, "no spurious remainder line");
  assert.deepEqual(r.problems, []);
});

// --- dosing is a factor, not a quantity -------------------------------------

test("dosing rules cannot be split, only set", () => {
  assert.equal(isSplittable("RESIN"), true);
  assert.equal(isSplittable("GRIT"), true);
  assert.equal(isSplittable("DOSING"), false, "1% of resin weight has nothing to split");
  assert.equal(isSplittable("CONVERSION"), false);

  const d = dosingOverrides([
    line({ item: "catalyst-pct-of-resin", category: "DOSING", seq: 0, rate: 1.1 }),
    line({ item: "silane-pct-of-resin", category: "DOSING", seq: 0, rate: 1.3 }),
    line({ item: "resin", category: "RESIN", seq: 0, rate: 161 }),
  ]);
  assert.deepEqual(d, { "catalyst-pct-of-resin": 1.1, "silane-pct-of-resin": 1.3 });
  assert.ok(!("resin" in d), "a material is not a dosing factor");
});

test("plant-wide costs still cannot be set per batch", () => {
  for (const c of ["CONVERSION", "BASIS"]) assert.equal(isOverridable(c), false);
  for (const c of ["RESIN", "GRIT", "FILLER", "PIGMENT", "CHEMICAL", "DOSING"]) {
    assert.ok(OVERRIDABLE_CATEGORIES.has(c), `${c} should be settable`);
  }
  // Named individually, so the rest of BASIS stays plant-wide with it.
  for (const item of ["manpower", "electricity", "polishing", "packing", "sqft-per-slab"]) {
    assert.equal(isOverridable("CONVERSION", item), false, item);
    assert.equal(isOverridable("BASIS", item), false, item);
  }
});

test("the exchange rate is the one basis item a batch sets for itself", () => {
  // Reversal of the earlier rule, and deliberate: the rate a batch is quoted at
  // is the rate on the day it was quoted. One global figure silently re-prices
  // every past batch's dollar line the moment somebody revises it.
  assert.equal(isOverridable("BASIS", "inr-per-usd"), true);
  // Slab area sits in the same category and must NOT follow it — it is a
  // denominator, and two batches measured on different slab areas are not
  // comparable however they are labelled.
  assert.equal(isOverridable("BASIS", "sqft-per-slab"), false);
  // One value, never a split.
  assert.equal(isSplittable("BASIS", "inr-per-usd"), false);

  const b = basisOverrides([
    line({ item: "inr-per-usd", category: "BASIS", seq: 0, rate: 88.5 }),
    line({ item: "resin", category: "RESIN", seq: 0, rate: 161 }),
  ]);
  assert.deepEqual(b, { "inr-per-usd": 88.5 });
  // A material is not a basis value, and vice versa — folding the two maps
  // together would let a caller apply the wrong one.
  assert.deepEqual(dosingOverrides([line({ item: "inr-per-usd", category: "BASIS", rate: 88.5 })]), {});
});

test("a zero or negative exchange rate is ignored rather than dividing by it", () => {
  for (const bad of [0, -5]) {
    assert.deepEqual(basisOverrides([
      line({ item: "inr-per-usd", category: "BASIS", seq: 0, rate: bad }),
    ]), {}, `rate ${bad} was accepted`);
  }
});

test("days per month comes off the calendar, not off a form", () => {
  // A typed 30 overstated the daily rate in every 31-day month and understated
  // it in February; monthly plant figures are divided by this.
  assert.equal(daysInMonthOf(new Date(2026, 7, 15)), 31, "August");
  assert.equal(daysInMonthOf(new Date(2026, 8, 1)), 30, "September");
  assert.equal(daysInMonthOf(new Date(2026, 1, 3)), 28, "Feb 2026");
  assert.equal(daysInMonthOf(new Date(2028, 1, 3)), 29, "Feb 2028 is a leap year");
  // Last instant of a month still belongs to that month.
  assert.equal(daysInMonthOf(new Date(2026, 7, 31, 23, 59)), 31);
});

// --- the editor's live view -------------------------------------------------

test("the summary tells the typist what is still unallocated", () => {
  const s = summariseSplit(1000, [
    line({ seq: 0, qty: 600 }), line({ seq: 1, qty: 250 }),
  ]);
  assert.equal(s.allocated, 850);
  assert.equal(s.left, 150);
  assert.equal(s.balanced, false);
});

test("a catch-all line counts as balanced however much is left", () => {
  const s = summariseSplit(1000, [line({ seq: 0, qty: 600 }), line({ seq: 1, qty: null })]);
  assert.equal(s.allocated, 600);
  assert.equal(s.balanced, true, "the rest is spoken for");
  assert.equal(s.hasRest, true);
});

test("over-allocation shows as a negative remainder, not as balanced", () => {
  const s = summariseSplit(1000, [line({ seq: 0, qty: 1200 })]);
  assert.equal(s.left, -200);
  assert.equal(s.balanced, false);
});

test("lines group by material and stay in seq order", () => {
  const m = linesByItem([
    line({ item: "resin", seq: 1, description: "b" }),
    line({ item: "grit-0.6-1.2", category: "GRIT", seq: 0, description: "g" }),
    line({ item: "resin", seq: 0, description: "a" }),
  ]);
  assert.deepEqual(m.get("resin")?.map((l) => l.description), ["a", "b"]);
  assert.equal(m.get("grit-0.6-1.2")?.length, 1);
});
