// The rule that stopped the polish entry form clearing itself when the
// operator took a photo (2026-09-12). lib/entryReload carries the reasoning;
// these pin the behaviour that was wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldReloadDefaults } from "../src/lib/entryReload.ts";

test("THE BUG: blurring a box that still holds the same value reloads nothing", () => {
  // The camera button blurs the slab box, which is what re-resolved the slab
  // already showing, bumped the form's version and remounted every field.
  assert.equal(shouldReloadDefaults("10245", "10245"), false);
  assert.equal(shouldReloadDefaults("D1310", "D1310"), false);
  // Whitespace is not a change either — a box the operator tapped into and out
  // of can come back with a trailing space from a tablet keyboard.
  assert.equal(shouldReloadDefaults("10245", " 10245 "), false);
  assert.equal(shouldReloadDefaults(" D1310", "D1310 "), false);
});

test("a genuinely different slab or batch still reloads, because its defaults differ", () => {
  assert.equal(shouldReloadDefaults("10245", "10246"), true);
  assert.equal(shouldReloadDefaults("D1310", "D1311"), true);
  // Nothing loaded yet: the first blur after typing must resolve.
  assert.equal(shouldReloadDefaults(null, "10245"), true);
  assert.equal(shouldReloadDefaults("", "10245"), true);
});

test("an empty box is never a reload — there is nothing to look up", () => {
  assert.equal(shouldReloadDefaults(null, ""), false);
  assert.equal(shouldReloadDefaults(null, "   "), false);
  // Including after a save, which empties the box and takes the cursor back:
  // that blur must not fire a lookup for nothing.
  assert.equal(shouldReloadDefaults("10245", ""), false);
});

test("the comparison is by value, not by identity or type", () => {
  assert.equal(shouldReloadDefaults("10245", String(10245)), false);
  assert.equal(shouldReloadDefaults("0", "0"), false);
  // "0" is a real slab number as far as this rule is concerned; only blank is
  // blank. A falsy-value shortcut here would refuse to load it.
  assert.equal(shouldReloadDefaults(null, "0"), true);
});
