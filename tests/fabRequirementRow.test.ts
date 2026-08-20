import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRequirementRowInput, rowSqft } from "../src/lib/fab/requirementRow.ts";

test("rowSqft matches the importer: 60 x 24 x 2 = 20 sqft", () => {
  assert.deepEqual(rowSqft(60, 24, 2), { sqftPerPiece: 10, totalSqft: 20 });
});

test("parseRequirementRowInput refuses a zero quantity", () => {
  const r = parseRequirementRowInput({ pieceLabel: "Row 1", lengthIn: 60, widthIn: 24, quantity: 0 });
  assert.equal(r.ok, false);
});

test("parseRequirementRowInput accepts a full row and trims notes", () => {
  const r = parseRequirementRowInput({
    pieceLabel: "  Row 12  ",
    length: 48,
    width: 26,
    quantity: 3,
    notes: "  extra splash  ",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.pieceLabel, "Row 12");
    assert.equal(r.value.lengthIn, 48);
    assert.equal(r.value.widthIn, 26);
    assert.equal(r.value.quantity, 3);
    assert.equal(r.value.notes, "extra splash");
  }
});
