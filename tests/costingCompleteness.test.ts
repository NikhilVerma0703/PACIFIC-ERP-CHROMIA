import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchCompleteness,
  type CompletenessCard, type CompletenessConsumption, type CompletenessLine,
} from "../src/lib/costing/completeness.ts";

// The completeness rule is what stands between a half-entered batch and a
// sign-off over it. Every case below is one where getting it wrong either
// blocks a batch that is genuinely finished (verifiers learn to distrust the
// gate) or approves one that is not (the gate was theatre). Both failure modes
// are silent in production, which is why the coverage here is deliberately
// hard: sums, the remainder rule, over-assignment, unpriced materials, missing
// doses, and the empty batch.

// A batch that consumed a bit of everything: 1,000 kg resin, 8.05 t of one
// grit band, 2 t filler. Chemical quantities derive from the doses in force.
const consumption = (o: Partial<CompletenessConsumption> = {}): CompletenessConsumption => ({
  resinKg: 1000,
  fillerKg: 2000,
  gritCharges: [{ band: "1.2-2.5", kg: 8050 }],
  ...o,
});

// A card that prices everything and doses all four chemicals — the state in
// which a batch with no lines at all is complete.
const fullCard = (): CompletenessCard => ({
  rates: {
    "grit-1.2-2.5": 14755, "filler-400": 12499,
    tio2: 310, silane: 420, cobalt: 365, catalyst: 535,
    "tio2-pct-of-resin": 6, "silane-pct-of-resin": 1.2,
    "cobalt-pct-of-resin": 0.08, "catalyst-pct-of-resin": 1,
  },
  resinBySupplier: { Aypols: 161 },
});

const line = (o: Partial<CompletenessLine>): CompletenessLine => ({
  item: "resin", seq: 0, category: "RESIN", qty: null, rate: 161, ...o,
});

const LABELS = { tio2: "TiO₂", "grit-1.2-2.5": "Grit 1.2 – 2.5" };

// --- the ordinary cases ------------------------------------------------------

test("a batch fully priced at the card, with all doses on the card, is complete", () => {
  // The panel says it out loud: a material you assign nothing to is priced
  // whole at the rate card, which is the normal case. The gate must agree, or
  // every batch would be blocked until somebody typed redundant lines.
  const r = batchCompleteness(consumption(), [], fullCard());
  assert.deepEqual(r, { ok: true, blockers: [] });
});

test("an empty batch — no mixer records — is trivially complete", () => {
  // The mark API refuses these earlier ("no mixer records for that batch");
  // this function must not add a second, contradictory answer.
  const r = batchCompleteness(null, [], { rates: {}, resinBySupplier: {} });
  assert.deepEqual(r, { ok: true, blockers: [] });
});

test("a batch that consumed nothing has nothing to block on", () => {
  const r = batchCompleteness(
    { resinKg: 0, fillerKg: 0, gritCharges: [] },
    [], { rates: {}, resinBySupplier: {} },
  );
  assert.deepEqual(r, { ok: true, blockers: [] });
});

// --- rule 1: everything consumed must resolve a price -------------------------

test("a consumed material with no batch lines and no card rate blocks", () => {
  const card = fullCard();
  delete (card.rates as Record<string, number>)["grit-1.2-2.5"];
  const r = batchCompleteness(consumption(), [], card, LABELS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, [
    "Grit 1.2 – 2.5: no price — nothing entered on this batch and nothing on the rate card",
  ]);
});

test("resin with no card suppliers and no lines blocks; a batch line clears it", () => {
  const card = fullCard();
  card.resinBySupplier = {};
  const blocked = batchCompleteness(consumption(), [], card);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.some((b) => b.startsWith("resin: no price")));

  // One remainder line — "everything from Aypols at 161" — is a full answer.
  const cleared = batchCompleteness(consumption(), [line({ qty: null })], card);
  assert.equal(cleared.ok, true);
});

test("a zero card rate counts as no price, not a cheap one", () => {
  // Zero does not fail loudly — it prices the material at nothing. The report
  // treats it as missing; the gate must too, or the two would disagree.
  const card = fullCard();
  (card.rates as Record<string, number>)["filler-400"] = 0;
  const r = batchCompleteness(consumption(), [], card);
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.startsWith("filler-400: no price")));
});

test("a dosed chemical needs a price too, once its dose gives it a quantity", () => {
  const card = fullCard();
  delete (card.rates as Record<string, number>)["tio2"];
  const r = batchCompleteness(consumption(), [], card, LABELS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, [
    "TiO₂: no price — nothing entered on this batch and nothing on the rate card",
  ]);
});

// --- rule 2: dose-rule materials must have their dose set ---------------------

test("a missing dose blocks with the panel's own words", () => {
  const card = fullCard();
  delete (card.rates as Record<string, number>)["tio2-pct-of-resin"];
  const r = batchCompleteness(consumption(), [], card, LABELS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, ["TiO₂: no dose set"]);
});

test("a dose set on the batch satisfies the rule the card cannot", () => {
  const card = fullCard();
  delete (card.rates as Record<string, number>)["silane-pct-of-resin"];
  const r = batchCompleteness(
    consumption(),
    [line({ item: "silane-pct-of-resin", category: "DOSING", qty: null, rate: 1.4 })],
    card,
  );
  assert.equal(r.ok, true);
});

test("with no resin there is nothing to dose, so no dose is demanded", () => {
  // A percentage of zero resin is zero kilograms of chemical — demanding a
  // value for it would block a batch over a number that changes nothing.
  const r = batchCompleteness(
    { resinKg: 0, fillerKg: 2000, gritCharges: [] },
    [], { rates: { "filler-400": 12499 }, resinBySupplier: {} },
  );
  assert.deepEqual(r, { ok: true, blockers: [] });
});

test("all four missing doses are each named — the fix list is complete in one read", () => {
  const r = batchCompleteness(
    { resinKg: 1000, fillerKg: 0, gritCharges: [] },
    [], { rates: {}, resinBySupplier: { Aypols: 161 } }, LABELS,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, [
    "TiO₂: no dose set", "silane: no dose set", "cobalt: no dose set", "catalyst: no dose set",
  ]);
});

// --- rule 3: splits must account for the full mixer total ---------------------

test("quantities summing to the mixer total are complete", () => {
  const r = batchCompleteness(consumption(), [
    line({ seq: 0, qty: 600, rate: 161 }),
    line({ seq: 1, qty: 400, rate: 145 }),
  ], fullCard());
  assert.equal(r.ok, true);
});

test("a shortfall with no remainder-taker blocks, naming both figures", () => {
  // The exact case from the owner's ask: the split must cover the total. The
  // sheet would price the missing 1.85 t at the card and carry on; an approval
  // may not — nobody said where that quantity came from.
  const r = batchCompleteness(consumption(), [
    line({ item: "grit-1.2-2.5", category: "GRIT", seq: 0, qty: 6.2, rate: 14755 }),
  ], fullCard(), LABELS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, ["Grit 1.2 – 2.5: split covers 6.2 t of 8.05 t weighed"]);
});

test("one blank line takes what is left — that split is complete by construction", () => {
  const r = batchCompleteness(consumption(), [
    line({ seq: 0, qty: 600, rate: 161 }),
    line({ seq: 1, qty: null, rate: 145 }), // the rest: 400 kg
  ], fullCard());
  assert.equal(r.ok, true);
});

test("a single blank line — 'everything from one supplier' — is complete", () => {
  const r = batchCompleteness(consumption(), [line({ qty: null })], fullCard());
  assert.equal(r.ok, true);
});

test("assigning MORE than the mixer weighed blocks", () => {
  const r = batchCompleteness(consumption(), [
    line({ seq: 0, qty: 700, rate: 161 }),
    line({ seq: 1, qty: 400, rate: 145 }),
  ], fullCard());
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, [
    "resin: split covers 1100 kg but the mixer weighed 1000 kg — more assigned than recorded",
  ]);
});

test("over-assignment blocks even with a blank line present", () => {
  // The blank takes what is LEFT, and there is less than nothing left — it
  // prices nothing while the explicit lines exceed the scale.
  const r = batchCompleteness(consumption(), [
    line({ seq: 0, qty: 1100, rate: 161 }),
    line({ seq: 1, qty: null, rate: 145 }),
  ], fullCard());
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("more assigned than recorded")));
});

test("two blank lines block — only one can be the rest", () => {
  // The route refuses this on the way in; the gate recounts from what is
  // stored because an import or an older row does not come through the route.
  const r = batchCompleteness(consumption(), [
    line({ seq: 0, qty: null, rate: 161 }),
    line({ seq: 1, qty: null, rate: 145 }),
  ], fullCard());
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes('left blank for "the rest"')));
});

test("rounding within half a hundredth is not a shortfall", () => {
  // Quantities are read off scales; 8.049 against 8.05 t is the same number.
  const r = batchCompleteness(consumption(), [
    line({ item: "grit-1.2-2.5", category: "GRIT", seq: 0, qty: 8.049, rate: 14755 }),
  ], fullCard());
  assert.equal(r.ok, true);
});

test("a chemical's split reconciles against its DERIVED quantity", () => {
  // 6% of 1,000 kg resin = 60 kg of TiO₂. A split covering 40 must block —
  // the derived figure is the total the panel itself shows in the boxes.
  const r = batchCompleteness(consumption(), [
    line({ item: "tio2", category: "PIGMENT", seq: 0, qty: 40, rate: 310 }),
  ], fullCard(), LABELS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, ["TiO₂: split covers 40 kg of 60 kg weighed"]);
});

test("a batch dose override moves the derived total the split must cover", () => {
  // Dosed at 4% on this batch: 40 kg IS the whole quantity now. The same
  // split that blocked above is complete under the batch's own rule — the
  // gate must resolve doses exactly the way the sheet does.
  const r = batchCompleteness(consumption(), [
    line({ item: "tio2", category: "PIGMENT", seq: 0, qty: 40, rate: 310 }),
    line({ item: "tio2-pct-of-resin", category: "DOSING", seq: 0, qty: null, rate: 4 }),
  ], fullCard(), LABELS);
  assert.equal(r.ok, true);
});

test("a stored line with an unusable rate blocks rather than being ignored", () => {
  const r = batchCompleteness(consumption(), [
    line({ seq: 0, qty: 1000, rate: 0 }),
  ], fullCard());
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("no usable price or quantity")));
});

// --- several problems at once -------------------------------------------------

test("every blocker is reported, not just the first", () => {
  // The verifier gets the whole fix list in one read — a gate that reveals
  // problems one save at a time trains people to stop reading it.
  const card = fullCard();
  delete (card.rates as Record<string, number>)["tio2-pct-of-resin"];
  delete (card.rates as Record<string, number>)["filler-400"];
  const r = batchCompleteness(consumption(), [
    line({ seq: 0, qty: 600, rate: 161 }), // resin short 400, no rest line
  ], card, LABELS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers, [
    "resin: split covers 600 kg of 1000 kg weighed",
    "filler-400: no price — nothing entered on this batch and nothing on the rate card",
    "TiO₂: no dose set",
  ]);
});
