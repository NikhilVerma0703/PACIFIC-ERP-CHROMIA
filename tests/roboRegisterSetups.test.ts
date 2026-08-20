import test from "node:test";
import assert from "node:assert/strict";

import { soleSetupDesign } from "../src/lib/robo/registerSetups.ts";


/* ── soleSetupDesign ───────────────────────────────────────────────────────
   Our Complete Production download stopped repeating Design Name on every slab
   line — it belongs to the run, and the Production Setup sheet carries it once.
   Re-importing that workbook has to still know which setup each slab belongs
   to, and that sheet is what says so. */

test("a slab row with no design takes the shift's one configured design", () => {
  assert.equal(soleSetupDesign({ "2026-08-13|1|BANYAN": [] }, "2026-08-13", 1), "BANYAN");
});

test("two designs in one shift is an ambiguity, not a guess", () => {
  // A second pour in the same shift is a real thing. Picking one would attach
  // slabs to the wrong recipe silently, which is worse than attaching none.
  const setups = { "2026-08-13|1|BANYAN": [], "2026-08-13|1|AUREATE": [] };
  assert.equal(soleSetupDesign(setups, "2026-08-13", 1), "");
});

test("only this date and this shift are considered", () => {
  const setups = {
    "2026-08-13|1|BANYAN": [],
    "2026-08-13|2|AUREATE": [],
    "2026-08-14|1|CATERINA": [],
  };
  assert.equal(soleSetupDesign(setups, "2026-08-13", 1), "BANYAN");
  assert.equal(soleSetupDesign(setups, "2026-08-13", 2), "AUREATE");
  assert.equal(soleSetupDesign(setups, "2026-08-14", 1), "CATERINA");
});

test("a shift with no setup sheet entry gets no fallback", () => {
  assert.equal(soleSetupDesign({}, "2026-08-13", 1), "");
  assert.equal(soleSetupDesign({ "2026-08-13|1|BANYAN": [] }, "2026-08-15", 1), "");
});

test("a shift number that is a prefix of another does not match it", () => {
  // shift 1 must not pick up shift 12's setup — the separator is part of the key.
  const setups = { "2026-08-13|12|AUREATE": [] };
  assert.equal(soleSetupDesign(setups, "2026-08-13", 1), "");
});

test("an empty design in the key is not a design", () => {
  assert.equal(soleSetupDesign({ "2026-08-13|1|": [] }, "2026-08-13", 1), "");
});
