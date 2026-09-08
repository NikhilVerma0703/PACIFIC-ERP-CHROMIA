import test from "node:test";
import assert from "node:assert/strict";

import { roboThicknessOf, roboThicknessKey } from "../src/lib/robo/thickness.ts";

/* Thickness used to be read off the batch setup alone, one value for the whole
   run. The per-slab column now overrides it so a batch can change thickness
   partway through — exactly the way productionDate lets a slab carry its own
   day. Every existing row is NULL there, so turning this on must leave them
   reading the setup's thickness, unchanged. */

test("roboThicknessOf: the slab's own thickness wins when set", () => {
  assert.equal(
    roboThicknessOf({ thickness: 12, batchRecipe: { thickness: 20 } }),
    12,
  );
});

test("roboThicknessOf: falls back to the batch setup when the slab has none", () => {
  assert.equal(
    roboThicknessOf({ thickness: null, batchRecipe: { thickness: 20 } }),
    20,
  );
});

test("roboThicknessOf: an all-null slab (every existing row) is null, not 0", () => {
  assert.equal(roboThicknessOf({ thickness: null, batchRecipe: { thickness: null } }), null);
  assert.equal(roboThicknessOf({ thickness: null, batchRecipe: null }), null);
  assert.equal(roboThicknessOf({}), null);
  assert.equal(roboThicknessOf(null), null);
});

test("roboThicknessOf: a per-slab 0 still overrides — only NULL means unset", () => {
  // Not a real slab thickness, but the invariant is that NULL alone is "unset",
  // so a stored 0 must win over the setup rather than being read as absent.
  assert.equal(roboThicknessOf({ thickness: 0, batchRecipe: { thickness: 20 } }), 0);
});

test("roboThicknessKey: null is one bucket (\"\"), a number is its own text", () => {
  assert.equal(roboThicknessKey({ thickness: null, batchRecipe: { thickness: null } }), "");
  assert.equal(roboThicknessKey({ thickness: null, batchRecipe: { thickness: 20 } }), "20");
  assert.equal(roboThicknessKey({ thickness: 12.5, batchRecipe: { thickness: 20 } }), "12.5");
});
