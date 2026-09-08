import test from "node:test";
import assert from "node:assert/strict";

import { splitMachineNames, joinMachineNames, firstMachineName } from "../src/lib/robo/delayMachines.ts";
import { machineLabel } from "../src/lib/robo/utils.ts";

/* One delay can name several Robos, kept on the one record in machineName as a
   comma-joined list of canonical names. These conversions and the label must
   leave a single-Robo record (every existing one) behaving exactly as before. */

test("splitMachineNames: a legacy single name stays a one-item list", () => {
  assert.deepEqual(splitMachineNames("Roycut-1"), ["Roycut-1"]);
});

test("splitMachineNames: a joined list splits and trims", () => {
  assert.deepEqual(splitMachineNames("Roycut-1, Roymix"), ["Roycut-1", "Roymix"]);
  assert.deepEqual(splitMachineNames("Roycut-1,Roymix ,  Roycut-3"), ["Roycut-1", "Roymix", "Roycut-3"]);
});

test("splitMachineNames: blank / null is an empty list (no machine)", () => {
  assert.deepEqual(splitMachineNames(""), []);
  assert.deepEqual(splitMachineNames(null), []);
  assert.deepEqual(splitMachineNames(undefined), []);
});

test("joinMachineNames: trims, de-dups, keeps order", () => {
  assert.equal(joinMachineNames(["Roycut-1", "Roymix"]), "Roycut-1, Roymix");
  assert.equal(joinMachineNames([" Roymix ", "Roymix", "Roycut-1"]), "Roymix, Roycut-1");
  assert.equal(joinMachineNames([]), "");
  assert.equal(joinMachineNames(["", null, undefined]), "");
});

test("firstMachineName: the first, for the backward-compatible machineId", () => {
  assert.equal(firstMachineName(["Roycut-1", "Roymix"]), "Roycut-1");
  assert.equal(firstMachineName([]), null);
});

test("machineLabel: a single canonical name is labelled exactly as before", () => {
  assert.equal(machineLabel("Roycut-1"), "Robo1");
  assert.equal(machineLabel("Roymix"), "Robo2");
  assert.equal(machineLabel("Roycut-2"), "Robo3");
  assert.equal(machineLabel("Roycut-3"), "Robo4");
  assert.equal(machineLabel(null), "");
});

test("machineLabel: a joined list labels each and joins with +", () => {
  assert.equal(machineLabel("Roycut-1, Roymix"), "Robo1 + Robo2");
  assert.equal(machineLabel("Roymix, Roycut-3"), "Robo2 + Robo4");
  // round-trips with the split/join the form uses
  assert.equal(machineLabel(joinMachineNames(["Roymix", "Roycut-2"])), "Robo2 + Robo3");
});
