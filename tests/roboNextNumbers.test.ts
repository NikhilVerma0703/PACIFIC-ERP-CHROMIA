import test from "node:test";
import assert from "node:assert/strict";

import {
  isNumericSlab,
  latestNumericSlab,
  latestSerialNumber,
  nextSerialNumber,
  nextSlabNumber,
} from "../src/lib/robo/nextNumbers.ts";

/* The numbers the entry form offers. Two bugs behind these.

   First: both were computed from the active shift, and a shift row is created
   silently once a day — so every morning the S.No. restarted at 1 against a
   register at 35, and the slab number went blank.

   Then: the fix read "the latest record" two different ways. The slab number
   counted from the newest ROW, the S.No. from the highest NUMBER anywhere —
   max(serial_number) + 1 — and those agree only in a register nothing has been
   imported into. The imported rows carry the old paper register's own S.No.
   column, into the hundreds, so a line whose last saved slab was 19 was offered
   241. Both come from the last saved row now. */

test("the S.No. continues from the last one SAVED, not the highest anywhere", () => {
  // The report: last slab S.No. 19, form offered 241.
  assert.equal(nextSerialNumber(19), 20);
  assert.equal(nextSerialNumber(34), 35);
  assert.equal(nextSerialNumber(65), 66);
});

test("the S.No. starts at 1 only when nothing is numbered yet", () => {
  assert.equal(nextSerialNumber(null), 1);
  assert.equal(nextSerialNumber(undefined), 1);
  assert.equal(nextSerialNumber(0), 1);
  // A NULL serialNumber ordering first is what used to pin the server's own
  // fallback at 1 forever. The walk skips NULLs, but guard anyway.
  assert.equal(nextSerialNumber(Number.NaN), 1);
});

test("the last S.No. saved comes from the newest row that has one", () => {
  // Newest first, as the route reads them.
  assert.equal(latestSerialNumber([19, 18, 17]), 19);
  // 240 is an imported row sitting further down the register. It is not the
  // last row, so it is not what the next slab counts from — this is the whole
  // difference between the old max and the new walk.
  assert.equal(latestSerialNumber([19, 18, 240, 17]), 19);
  assert.equal(nextSerialNumber(latestSerialNumber([19, 18, 240, 17])), 20);
});

test("a row saved without an S.No. does not restart the register at 1", () => {
  // serial_number is nullable, so this is a real row, not a hypothetical.
  assert.equal(latestSerialNumber([null, null, 19]), 19);
  assert.equal(latestSerialNumber([undefined, 19]), 19);
  assert.equal(latestSerialNumber([null, undefined]), null);
  assert.equal(latestSerialNumber([]), null);
  assert.equal(latestSerialNumber([Number.NaN, 0, -3, 19]), 19);
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

test("a solid block of taken numbers is walked past, not given up on", () => {
  /* What the route does with the "" above, one probe at a time. This is the
     case that emptied the slab-number field: an imported register can hold a
     continuous run of numbers above the last slab the line actually ran, and a
     single probe against such a run came back with nothing to offer. */
  const wall = new Set(Array.from({ length: 40 }, (_, i) => String(17579 + i)));
  const probe = 25;

  let from = "17578";
  let pick = nextSlabNumber(from, wall, probe);
  assert.equal(pick, "", "first probe lands entirely inside the block");

  // The route counts on from the end of the window it just checked.
  from = String(BigInt(from) + BigInt(probe));
  pick = nextSlabNumber(from, wall, probe);
  assert.equal(pick, "17619", "the second reaches the first free number past it");
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
