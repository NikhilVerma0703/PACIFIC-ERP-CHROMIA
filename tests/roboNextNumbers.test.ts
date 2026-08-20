import test from "node:test";
import assert from "node:assert/strict";

import {
  isNumericSlab,
  latestNumericSlab,
  nextSerialNumber,
  nextSlabNumber,
} from "../src/lib/robo/nextNumbers.ts";

/* The numbers the entry form offers. The bug these replace: both were computed
   from the active shift, and a shift row is created silently once a day — so
   every morning the S.No. restarted at 1 against a register at 35, and the slab
   number went blank. */

test("the S.No. continues from the highest one recorded", () => {
  assert.equal(nextSerialNumber(34), 35);
  assert.equal(nextSerialNumber(65), 66);
});

test("the S.No. starts at 1 only when nothing is numbered yet", () => {
  assert.equal(nextSerialNumber(null), 1);
  assert.equal(nextSerialNumber(undefined), 1);
  assert.equal(nextSerialNumber(0), 1);
  // A NULL serialNumber ordering first is what used to pin the server's own
  // fallback at 1 forever; an aggregate max cannot return one, but guard anyway.
  assert.equal(nextSerialNumber(Number.NaN), 1);
});

test("what counts as a slab number we can count from", () => {
  assert.equal(isNumericSlab("17578"), true);
  assert.equal(isNumericSlab(" 17578 "), true);
  assert.equal(isNumericSlab("140748-A"), false);
  assert.equal(isNumericSlab("A17578"), false);
  assert.equal(isNumericSlab(""), false);
  assert.equal(isNumericSlab(null), false);
});

test("the slab number continues from the latest record", () => {
  assert.equal(nextSlabNumber("17578"), "17579");
  assert.equal(nextSlabNumber("140748"), "140749");
});

test("a non-numeric slab number in the newest row does not stop the suggestion", () => {
  assert.equal(latestNumericSlab(["140748-A", "140747", "140746"]), "140747");
  assert.equal(latestNumericSlab(["17578"]), "17578");
  assert.equal(latestNumericSlab([null, undefined, "  "]), null);
  assert.equal(latestNumericSlab([]), null);
});

test("nothing to count from means no suggestion, not a made-up first number", () => {
  assert.equal(nextSlabNumber(null), "");
  assert.equal(nextSlabNumber("SLAB-1"), "");
});

test("a number already taken is skipped, so the operator is never handed a duplicate", () => {
  assert.equal(nextSlabNumber("17578", new Set(["17579"])), "17580");
  assert.equal(nextSlabNumber("17578", new Set(["17579", "17580", "17581"])), "17582");
  // and it gives up rather than looping forever
  const wall = new Set(Array.from({ length: 40 }, (_, i) => String(17579 + i)));
  assert.equal(nextSlabNumber("17578", wall, 25), "");
});

test("leading zeros are part of the number, not formatting", () => {
  assert.equal(nextSlabNumber("00042"), "00043");
  assert.equal(nextSlabNumber("09999"), "10000");
  assert.equal(nextSlabNumber("99"), "100");
});

test("numbers past 2^53 stay exact", () => {
  // BigInt, not Number — a register that ever reaches this must not round.
  assert.equal(nextSlabNumber("9007199254740993"), "9007199254740994");
});
