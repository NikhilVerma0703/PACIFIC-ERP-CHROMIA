import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KG_EPSILON, SUPPLIER_THRESHOLD, gritAssignBlockers, matchSize, matchSupplier,
  mergeSizeCatalogue, reconcileSuppliers, sizeKey, supKey,
} from "../src/lib/costing/gritAssign.ts";

// Grit assigned silo by silo. The rules that decide whether a flag fires, and the
// two properties that must hold whatever the rules say: a flag never blocks a
// save, and nothing here can produce a patch for a Silo row.

// ---------------------------------------------------------------- size keys

test("one band written five ways is one key", () => {
  const want = sizeKey("0.1-0.4");
  for (const v of ["0.1-0.4", "0.10-0.40", "# 0.1 - 0.4", "  0.1-0.4  ", "0.1 – 0.4", "0.1—0.4"]) {
    assert.equal(sizeKey(v), want, `${v} should key the same as 0.1-0.4`);
  }
});

test("different bands stay different — this is what a fuzzy score would break", () => {
  assert.notEqual(sizeKey("0.1-0.4"), sizeKey("0.3-0.7"));
  assert.notEqual(sizeKey("0.6-1.2"), sizeKey("1.2-2.5"));
});

test("sizeKey is a comparison key and can never become a catalogue item", () => {
  // The 'grit-Grit' failure was bandOf conflating the two jobs. "grit" is a
  // perfectly good comparison key; it just must never be looked up as a rate.
  assert.equal(sizeKey("Grit"), "grit");
  assert.equal(sizeKey(""), "");
  assert.equal(sizeKey(null), "");
});

test("units and decoration are noise", () => {
  assert.equal(sizeKey("0.1-0.4 mm"), sizeKey("0.1-0.4"));
  assert.equal(sizeKey("#8-16"), sizeKey("8-16"));
  assert.equal(sizeKey("0.6-1.2 pm"), sizeKey("0.6-1.2"));
});

// ------------------------------------------------------------- size verdicts

test("picking the size the bags record is a plain match", () => {
  assert.equal(matchSize("0.1-0.4", ["0.1-0.4"]).verdict, "match");
  assert.equal(matchSize("0.10-0.40", ["0.1-0.4"]).verdict, "match");
});

test("picking one of two recorded sizes is a match OF A CONFLICT, and says so", () => {
  // A silo runs one size in a batch — two means the data disagrees with itself,
  // and choosing correctly out of a contradiction is worth reporting.
  const m = matchSize("0.1-0.4", ["0.1-0.4", "0.3-0.7"]);
  assert.equal(m.verdict, "match-of-conflict");
  assert.equal(m.recordedKeys.length, 2);
});

test("a size the bags do not record is a mismatch — and still a legal entry", () => {
  const m = matchSize("0.6-1.2", ["0.1-0.4"]);
  assert.equal(m.verdict, "mismatch");
  assert.equal(m.entered, "0.6-1.2");   // the entered value is reported, never replaced
});

test("nothing recorded, or nothing entered, are their own verdicts — not mismatches", () => {
  assert.equal(matchSize("0.1-0.4", []).verdict, "no-silo-value");
  assert.equal(matchSize("0.1-0.4", ["", "  "]).verdict, "no-silo-value");
  assert.equal(matchSize("", ["0.1-0.4"]).verdict, "no-entry");
});

// ------------------------------------------------------------ supplier keys

test("the spellings the plant actually uses collapse to one key", () => {
  assert.equal(supKey("Vinayaka"), supKey("VINAYAKA"));
  assert.equal(supKey("Aypols Pvt Ltd"), supKey("Aypols"));
  assert.equal(supKey("A&A Silicates"), supKey("A and A Silicates"));
  // The rate card itself ships "3n Composits" — singleton glue is what makes
  // this pair match rather than reading as two suppliers.
  assert.equal(supKey("3 N Composites"), supKey("3n Composites"));
});

test("an Airtable-truncated name loses only the ellipsis", () => {
  assert.equal(supKey("Pristine Quartz Pri..."), "pristine quartz pri");
});

// -------------------------------------------------------- supplier verdicts

test("the same supplier written differently matches", () => {
  assert.equal(matchSupplier("Vinayaka", ["Vinayaka"]).verdict, "exact");
  assert.equal(matchSupplier("Grit Vinayaka", ["Vinayaka"]).verdict !== "mismatch", true);
  assert.equal(matchSupplier("3n Composits", ["3N Composites"]).verdict !== "mismatch", true);
});

test("A GRADE IS NOT A SPELLING — Supreme G2 must not match Supreme G3", () => {
  // The highest-cost error in the set: two products of one mineral at two
  // prices, 90% similar as strings. The variant-token override is what stops it.
  const m = matchSupplier("Supreme G2", ["Supreme G3"]);
  assert.equal(m.verdict, "mismatch");
  assert.equal(m.reason, "variant-token");
  assert.ok(m.score < SUPPLIER_THRESHOLD, `scored ${m.score}, must be under ${SUPPLIER_THRESHOLD}`);
});

test("a grade on one side only is held under the threshold too", () => {
  const m = matchSupplier("Supreme G2", ["Supreme"]);
  assert.equal(m.reason, "variant-token-one-sided");
  assert.ok(m.score < SUPPLIER_THRESHOLD, `scored ${m.score}`);
});

test("a genuinely different supplier is a mismatch", () => {
  assert.equal(matchSupplier("Chettinad", ["Vinayaka"]).verdict, "mismatch");
});

test("best-of across every supplier the silo records", () => {
  // A silo filled twice records two names; matching either is a match.
  assert.notEqual(matchSupplier("Aypols", ["Vinayaka", "Aypols"]).verdict, "mismatch");
});

test("empty sides are their own verdicts, and never score", () => {
  assert.equal(matchSupplier("", ["Vinayaka"]).verdict, "no-entry");
  assert.equal(matchSupplier("Vinayaka", []).verdict, "no-silo-value");
  assert.equal(matchSupplier("Vinayaka", ["", " "]).verdict, "no-silo-value");
});

// ------------------------------------------------------- the size catalogue

test("the catalogue is seeded with the known bands and grows by assignment", () => {
  const bands = ["0.1-0.4", "0.3-0.7", "0.6-1.2", "1.2-2.5", "8-16"];
  const got = mergeSizeCatalogue(["0.4-0.8"], bands, []);
  assert.ok(got.includes("0.4-0.8"), "a newly assigned size joins the list");
  for (const b of bands) assert.ok(got.includes(b), `${b} must always be offered`);
});

test("a size that normalises to an existing one does not appear twice", () => {
  const got = mergeSizeCatalogue(["0.10-0.40", "# 0.1 - 0.4"], ["0.1-0.4"], ["0.1 – 0.4"]);
  assert.equal(got.filter((s) => sizeKey(s) === sizeKey("0.1-0.4")).length, 1);
});

test("the list reads in band order, not alphabetically", () => {
  const got = mergeSizeCatalogue([], ["1.2-2.5", "0.1-0.4", "0.6-1.2"], []);
  assert.deepEqual(got, ["0.1-0.4", "0.6-1.2", "1.2-2.5"]);
});

// ------------------------------------------------- reconciliation & blockers

test("a split that covers the silo balances", () => {
  const r = reconcileSuppliers(12480.3, [{ supplier: "Vinayaka", kg: 8000.3 }, { supplier: "Aypols", kg: 4480 }]);
  assert.equal(r.balanced, true);
});

test("the epsilon is the mixer's resolution, not the tonne-side one", () => {
  // 0.3 kg left over must NOT earn a permanent blocker reading "12,480 of 12,480".
  assert.equal(KG_EPSILON, 0.5);
  assert.equal(reconcileSuppliers(12480.3, [{ supplier: "V", kg: 8000 }, { supplier: "A", kg: 4480 }]).balanced, true);
  assert.equal(reconcileSuppliers(12480.3, [{ supplier: "V", kg: 8000 }]).balanced, false);
});

test("blockers name ABSENCES only", () => {
  const rows = [
    { silo: "103", size: "", kg: 100, suppliers: [{ supplier: "Vinayaka", kg: 100 }] },
    { silo: "202", size: "0.1-0.4", kg: 100, suppliers: [] },
    { silo: "104", size: "0.1-0.4", kg: 100, suppliers: [{ supplier: "Vinayaka", kg: 60 }] },
  ];
  const b = gritAssignBlockers(rows);
  assert.equal(b.length, 3);
  assert.match(b[0], /no size assigned/);
  assert.match(b[1], /no supplier assigned/);
  assert.match(b[2], /cover 60\.0 kg of 100\.0 kg/);
});

test("A MISMATCH PRODUCES NO BLOCKER — this is the rule the whole design rests on", () => {
  // Wrong-looking size, wrong-looking supplier, and a two-size conflict. All
  // flagged elsewhere; none of them may stop a sign-off, and none may stop a save.
  const rows = [{ silo: "103", size: "0.6-1.2", kg: 100, suppliers: [{ supplier: "Chettinad", kg: 100 }] }];
  assert.deepEqual(gritAssignBlockers(rows), []);
  assert.equal(matchSize("0.6-1.2", ["0.1-0.4"]).verdict, "mismatch");
  assert.equal(matchSupplier("Chettinad", ["Vinayaka"]).verdict, "mismatch");
});

test("an unused silo is not a blocker", () => {
  assert.deepEqual(gritAssignBlockers([{ silo: "9", size: "", kg: 0, suppliers: [] }]), []);
});

test("no result can be mistaken for a patch — the containment shape", () => {
  // Neither matcher returns anything a Silo write could be built from: no field
  // named like a Silo column, nothing shaped like an update, and no `blocking`.
  const keys = new Set([...Object.keys(matchSize("0.1-0.4", ["0.3-0.7"])), ...Object.keys(matchSupplier("A", ["B"]))]);
  for (const forbidden of ["blocking", "apply", "patch", "sizeFromUsedBag", "nameFromSupplierMaster", "siloId", "airtableId"]) {
    assert.equal(keys.has(forbidden), false, `${forbidden} must not be on a match result`);
  }
});
