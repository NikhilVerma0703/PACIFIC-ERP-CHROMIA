import { test } from "node:test";
import assert from "node:assert/strict";
import { MACHINE_LABEL, machineLabel, canonicalMachineName } from "../src/lib/robo/utils.ts";

// The Robo1..Robo4 rename is presentation-only: the database keeps Roycut-1 /
// Roymix / Roycut-2 / Roycut-3 because those names carry the line ordering, the
// RoyMix field rules, the design-preset keys and the machine on every delay log
// ever saved. These pin BOTH directions, because the rename changed what people
// type as well as what they read.

test("every display name maps back to the stored name it came from", () => {
  for (const [stored, shown] of Object.entries(MACHINE_LABEL)) {
    assert.equal(machineLabel(stored), shown);
    assert.equal(canonicalMachineName(shown), stored, `${shown} must fold back to ${stored}`);
    // The round trip has to close, or an imported workbook lands on a machine
    // the operator did not name.
    assert.equal(machineLabel(canonicalMachineName(shown)), shown);
  }
});

test("the four robots are exactly the four the plant runs", () => {
  assert.deepEqual(Object.keys(MACHINE_LABEL), ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"]);
  assert.deepEqual(Object.values(MACHINE_LABEL), ["Robo1", "Robo2", "Robo3", "Robo4"]);
});

test("a stored name passes through canonicalisation untouched", () => {
  // Workbooks written before the rename still say Roymix, and must keep working.
  for (const stored of Object.keys(MACHINE_LABEL)) {
    assert.equal(canonicalMachineName(stored), stored);
  }
});

test("a header typed by hand still resolves — case and spacing are not a key", () => {
  assert.equal(canonicalMachineName("robo2"), "Roymix");
  assert.equal(canonicalMachineName("ROBO2"), "Roymix");
  assert.equal(canonicalMachineName("  Robo2  "), "Roymix");
  assert.equal(canonicalMachineName("RoBo4"), "Roycut-3");
});

test("an unknown machine passes through rather than vanishing", () => {
  // It then meets the same lookup it always did and is reported as unmatched.
  // Mapping it to "" here would turn an unrecognised machine into a missing one.
  assert.equal(canonicalMachineName("Roycut-9"), "Roycut-9");
  assert.equal(canonicalMachineName("Robo9"), "Robo9");
});

test("empty input is empty, not a spurious machine", () => {
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(canonicalMachineName(v), v === "   " ? "" : "");
  }
  assert.equal(machineLabel(null), "");
  assert.equal(machineLabel(undefined), "");
});
