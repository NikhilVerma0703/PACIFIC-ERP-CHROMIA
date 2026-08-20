import test from "node:test";
import assert from "node:assert/strict";

import { nextFieldToFocus, type AdvanceCandidate } from "../src/lib/robo/advanceFocus.ts";

/* Where the cursor goes when a field is done, on the slab-entry form.
   The row these describe is the real one: S.No., slab number, In time,
   Out time, [Robo2 weight, Robo2 CT], remarks. */

const row = (...values: string[]): AdvanceCandidate[] => values.map((value) => ({ value }));

test("it skips the fields the register already filled in", () => {
  // S.No. and slab number arrive suggested. Finishing S.No. must land on In
  // time, not stop on a slab number that is already right.
  const fields = row("36", "17579", "", "", "");
  assert.equal(nextFieldToFocus(fields, 0), 2);
});

test("finishing In time goes to Out time", () => {
  assert.equal(nextFieldToFocus(row("36", "17579", "09:30", "", ""), 2), 3);
});

test("a slab being finished skips straight past the times it already has", () => {
  // Reopened from the Recent table to add the Out time: In time is set, so
  // the cursor must not stop there on the way.
  const fields = row("36", "17579", "09:30", "", "");
  assert.equal(nextFieldToFocus(fields, 1), 3);
});

test("whitespace is empty — a field holding a space is not filled in", () => {
  assert.equal(nextFieldToFocus(row("36", "  ", "", ""), 0), 1);
});

test("nothing empty ahead means stay put, not wrap round", () => {
  // The caller lets go of the field instead, which drops the tablet keyboard
  // and puts the Save button back on screen. Wrapping would fight an operator
  // who is deliberately correcting the last box.
  assert.equal(nextFieldToFocus(row("", "17579", "09:30", "10:05"), 1), null);
  assert.equal(nextFieldToFocus(row("36", "17579", "09:30", "10:05"), 3), null);
});

test("the last field never advances", () => {
  assert.equal(nextFieldToFocus(row("36", "", ""), 2), null);
});

test("fields that are not on screen are stepped over", () => {
  // Robo2 body weight and cycle time only render when the run includes Roymix.
  const fields: AdvanceCandidate[] = [
    { value: "36" }, { value: "17579" }, { value: "09:30" }, { value: "" },
    { value: "", skip: true }, { value: "", skip: true },
    { value: "" },
  ];
  assert.equal(nextFieldToFocus(fields, 3), 6);
});

test("an index that is not a field is left alone", () => {
  const fields = row("", "", "");
  assert.equal(nextFieldToFocus(fields, -1), null);
  assert.equal(nextFieldToFocus(fields, 3), null);
  assert.equal(nextFieldToFocus(fields, 1.5), null);
  assert.equal(nextFieldToFocus(fields, Number.NaN), null);
  assert.equal(nextFieldToFocus([], 0), null);
});
