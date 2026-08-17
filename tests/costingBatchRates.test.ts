import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBatchRates, compareToCard, isOverridable, OVERRIDABLE_CATEGORIES,
  rateKey, type BatchRateRow, type RateCardLike,
} from "../src/lib/costing/batchRates.ts";

// The layering decides what a batch costs. Every case below is one where
// getting it wrong produces a plausible-looking number rather than an error —
// which is the only kind of costing bug that survives to a customer quote.

const card: RateCardLike = {
  onDate: "2026-08-01",
  resinBySupplier: { Aypols: 161, "3n Composits": 145 },
  rates: {
    "grit-0.6-1.2": 14780,
    "filler-400": 12499,
    tio2: 310,
    manpower: 9_000_000,
    "sqft-per-slab": 75,
  },
  effectiveFrom: {
    "resin · Aypols": "2026-08-01",
    "grit-0.6-1.2": "2026-08-01",
    manpower: "2026-08-01",
  },
  missing: [],
};

const row = (o: Partial<BatchRateRow>): BatchRateRow => ({
  item: "grit-0.6-1.2", variant: "", category: "GRIT", rate: 15000, ...o,
});

test("a batch with no rates of its own prices exactly as the card", () => {
  // The guarantee that makes this safe to ship: every costing that exists
  // today must be unchanged until somebody deliberately sets a rate.
  const r = applyBatchRates(card, []);
  assert.deepEqual(r.rates, card.rates);
  assert.deepEqual(r.resinBySupplier, card.resinBySupplier);
  assert.deepEqual(r.overridden, []);
  assert.deepEqual(r.rejected, []);
  for (const k of Object.keys(card.rates)) assert.equal(r.source[k], "card");
});

test("a batch rate wins over the card, and says so", () => {
  const r = applyBatchRates(card, [row({ rate: 15500 })]);
  assert.equal(r.rates["grit-0.6-1.2"], 15500);
  assert.equal(r.source["grit-0.6-1.2"], "batch");
  assert.deepEqual(r.overridden, ["grit-0.6-1.2"]);
  // Everything untouched still comes from the card.
  assert.equal(r.rates["filler-400"], 12499);
  assert.equal(r.source["filler-400"], "card");
});

test("resin is overridden per supplier, not wholesale", () => {
  // Resin is the one item that splits by variant. Setting Aypols must not
  // silently re-price the other supplier's tanks.
  const r = applyBatchRates(card, [
    row({ item: "resin", variant: "Aypols", category: "RESIN", rate: 172 }),
  ]);
  assert.equal(r.resinBySupplier.Aypols, 172);
  assert.equal(r.resinBySupplier["3n Composits"], 145, "the other supplier is untouched");
  assert.equal(r.source["resin · Aypols"], "batch");
  assert.equal(r.source["resin · 3n Composits"], "card");
});

test("the card is never mutated", () => {
  // The caller may hold one card across several batches; layering in place
  // would leak one batch's resin price into the next.
  const before = JSON.stringify(card);
  applyBatchRates(card, [
    row({ rate: 99999 }),
    row({ item: "resin", variant: "Aypols", category: "RESIN", rate: 999 }),
  ]);
  assert.equal(JSON.stringify(card), before);
});

test("an overridden rate stops claiming a card revision date", () => {
  const r = applyBatchRates(card, [row({ rate: 15500 })]);
  assert.equal(r.effectiveFrom["grit-0.6-1.2"], "set on this batch");
  // Untouched items keep pointing at the revision that really supplied them.
  assert.equal(r.effectiveFrom["manpower"], "2026-08-01");
});

test("plant-wide costs cannot be set per batch", () => {
  // Conversion is a whole-plant monthly figure — there is no such thing as this
  // batch's electricity bill. Basis is worse: slab area and ₹/USD are the
  // denominators, so a per-batch value makes two batches incomparable while
  // still printing the same column heading.
  for (const category of ["CONVERSION", "BASIS"]) {
    const r = applyBatchRates(card, [row({ item: "manpower", category, rate: 1 })]);
    assert.equal(r.rates["manpower"], 9_000_000, `${category} leaked through`);
    assert.equal(r.rejected.length, 1);
    assert.match(r.rejected[0].reason, /plant-wide/i);
  }
  assert.equal(isOverridable("CONVERSION"), false);
  assert.equal(isOverridable("BASIS"), false);
  for (const c of ["RESIN", "GRIT", "FILLER", "PIGMENT", "CHEMICAL", "DOSING"]) {
    assert.ok(OVERRIDABLE_CATEGORIES.has(c), `${c} should be settable`);
  }
});

test("a zero or negative rate is refused, not applied", () => {
  // The failure this stops: a zero does not error, it prices the material at
  // nothing and makes the batch look cheap.
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = applyBatchRates(card, [row({ rate: bad as number })]);
    assert.equal(r.rates["grit-0.6-1.2"], 14780, `rate ${bad} was applied`);
    assert.equal(r.rejected.length, 1);
    assert.match(r.rejected[0].reason, /above zero/i);
  }
});

test("a rejected row is reported rather than dropped", () => {
  // An override that silently did nothing is worse than one refused: the
  // person who typed it believes the batch is costed at their number.
  const r = applyBatchRates(card, [
    row({ rate: 15500 }),
    row({ item: "", rate: 100 }),
    row({ item: "packing", category: "CONVERSION", rate: 30 }),
  ]);
  assert.deepEqual(r.overridden, ["grit-0.6-1.2"]);
  assert.equal(r.rejected.length, 2);
});

test("an override fills a hole the card left open", () => {
  const gappy: RateCardLike = { ...card, rates: {}, missing: ["tio2", "filler-400"] };
  const r = applyBatchRates(gappy, [row({ item: "tio2", category: "PIGMENT", rate: 320 })]);
  assert.equal(r.rates.tio2, 320);
  assert.deepEqual(r.missing, ["filler-400"], "only the still-missing item remains");
});

test("resin counts as present once any supplier has a rate", () => {
  const gappy: RateCardLike = { ...card, resinBySupplier: {}, missing: ["resin"] };
  const r = applyBatchRates(gappy, [
    row({ item: "resin", variant: "Aypols", category: "RESIN", rate: 170 }),
  ]);
  assert.deepEqual(r.missing, []);
});

test("the last row wins when the same item is set twice", () => {
  const r = applyBatchRates(card, [row({ rate: 15000 }), row({ rate: 16000 })]);
  assert.equal(r.rates["grit-0.6-1.2"], 16000);
  assert.deepEqual(r.overridden, ["grit-0.6-1.2"], "listed once, not twice");
});

test("rate keys match how the card files them", () => {
  assert.equal(rateKey("resin", "Aypols"), "resin · Aypols");
  assert.equal(rateKey("grit-0.6-1.2", ""), "grit-0.6-1.2");
  // Resin with no supplier is not a per-supplier key.
  assert.equal(rateKey("resin", ""), "resin");
});

test("the comparison shows how far a batch rate sits from the card", () => {
  // The point of showing both: 12% above the month's card is usually a
  // correction and occasionally a typo, and only seeing both tells them apart.
  const [grit] = compareToCard(card, [row({ rate: 15000 })]);
  assert.equal(grit.cardRate, 14780);
  assert.equal(grit.deltaPct, 1.5);

  const [resin] = compareToCard(card, [
    row({ item: "resin", variant: "Aypols", category: "RESIN", rate: 180 }),
  ]);
  assert.equal(resin.cardRate, 161);
  assert.equal(resin.deltaPct, 11.8);
});

test("a rate the card cannot price compares against nothing, not against zero", () => {
  // Dividing by a missing card rate would print Infinity% — worse than blank.
  const [c] = compareToCard(card, [row({ item: "silane", category: "CHEMICAL", rate: 420 })]);
  assert.equal(c.cardRate, null);
  assert.equal(c.deltaPct, null);
});
