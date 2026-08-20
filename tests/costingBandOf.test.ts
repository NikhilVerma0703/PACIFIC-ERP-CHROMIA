import { test } from "node:test";
import assert from "node:assert/strict";
import { bandOf, gritItemKey } from "../src/lib/costing/gritBand.ts";

// bandOf turns a silo's free-text size into the key the rate card is looked up
// by. It had no tests and two defects, and both produced the same failure: a key
// no catalogue entry matches, so real tonnage reported itself as "consumed but
// not priced" and no screen could price it (batch 1414: "needs rate 'grit-Grit'").

test("the five bands the catalogue actually holds", () => {
  for (const b of ["0.1-0.4", "0.3-0.7", "0.6-1.2", "1.2-2.5"]) assert.equal(bandOf(b), b);
  assert.equal(bandOf("8-16"), "8-16");
});

test("whitespace is stripped, wherever it is", () => {
  assert.equal(bandOf(" 0.1-0.4 "), "0.1-0.4");
  assert.equal(bandOf("0.1 - 0.4"), "0.1-0.4");
});

test("a # is decoration, not part of the size — it was rejected before", () => {
  assert.equal(bandOf("#0.1-0.4"), "0.1-0.4");
  assert.equal(bandOf("0.1-0.4#"), "0.1-0.4");
  assert.equal(bandOf("# 0.6 - 1.2 "), "0.6-1.2");
  assert.equal(bandOf("#8-16"), "8-16");
});

test("precision is folded — one band, not two keys", () => {
  // The whole point: these are the SAME grit, and only the first had a rate.
  assert.equal(bandOf("0.10-0.40"), bandOf("0.1-0.4"));
  assert.equal(bandOf("0.10-0.40"), "0.1-0.4");
  assert.equal(bandOf("1.20-2.50"), "1.2-2.5");
  assert.equal(bandOf("0.30-0.70"), "0.3-0.7");
});

test("every normalised form lands on a key the catalogue has", () => {
  const CATALOGUE = new Set(["grit-0.1-0.4", "grit-0.3-0.7", "grit-0.6-1.2", "grit-1.2-2.5", "grit-8-16"]);
  for (const raw of ["0.1-0.4", "#0.1-0.4", "0.10-0.40", " 0.1 - 0.4 ", "0.3-0.7", "0.30-0.70",
                     "0.6-1.2", "#0.6-1.2", "1.2-2.5", "1.20-2.50", "8-16", "#8-16"]) {
    assert.ok(CATALOGUE.has(gritItemKey(bandOf(raw))), `${raw} -> ${gritItemKey(bandOf(raw))} is not in the catalogue`);
  }
});

test("filler is still filler, hash on either side", () => {
  for (const f of ["400", "#400", "400#", " 400 "]) assert.equal(bandOf(f), "filler-400");
});

test("nothing, and genuinely unrecognisable text, behave as before", () => {
  assert.equal(bandOf(null), "");
  assert.equal(bandOf(""), "");
  assert.equal(bandOf("   "), "");
  // "Grit" is not a size. It still falls through unchanged, so the sheet still
  // reports it unpriced and names it — that is the correct loud failure.
  assert.equal(bandOf("Grit"), "Grit");
  assert.equal(bandOf("mixed"), "mixed");
});
