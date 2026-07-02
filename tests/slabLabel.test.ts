import { test } from "node:test";
import assert from "node:assert/strict";
import { slabLabel, parseSlabInput } from "../src/lib/slabLabel.ts";

test("slabLabel: whole numbers plain, insert decimals get letters", () => {
  assert.equal(slabLabel(84), "84");
  assert.equal(slabLabel(84.1), "84a");
  assert.equal(slabLabel(84.2), "84b");
  assert.equal(slabLabel(null), "");
});

test("parseSlabInput: letters map back to decimals, round-trip safe", () => {
  assert.equal(parseSlabInput("84"), 84);
  assert.equal(parseSlabInput("84a"), 84.1);
  assert.equal(parseSlabInput("84A"), 84.1);
  assert.equal(slabLabel(parseSlabInput("84b") as number), "84b");
});
