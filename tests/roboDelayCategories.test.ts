import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_META, CATEGORY_ORDER, guessCategory, defaultRobotSpecific } from "../src/lib/robo/delayCategories.ts";
import { formatSlabRemarks } from "../src/lib/robo/utils.ts";

// The entry form lets an operator add a delay code the catalogue does not have
// yet, mid-slab, rather than abandoning the entry and walking to Master Lists.
// The guess only has to be close — the operator can change it — but it has to
// follow the printed master list, or every new code lands in GENERAL and the
// delay reports stop separating a robot fault from a power cut.

test("a typed code lands in the group the master list numbers it under", () => {
  assert.equal(guessCategory("RM1"), "ROYMIX");
  assert.equal(guessCategory("RM12"), "ROYMIX");
  assert.equal(guessCategory("L3"), "LINE");
  assert.equal(guessCategory("D2"), "DISTRIBUTOR");
  assert.equal(guessCategory("S1"), "LINE_START");
  assert.equal(guessCategory("P4"), "PRESS");
  assert.equal(guessCategory("M16"), "MAINTENANCE");
  assert.equal(guessCategory("C8"), "ROBOT");
  assert.equal(guessCategory("G2"), "GENERAL");
  assert.equal(guessCategory("T1"), "POWERCUT");
});

test("RM wins over a bare R — checked before the single-letter prefixes", () => {
  // Without the RM rule first, "RM1" has no single-letter match and would fall
  // through to GENERAL, quietly mis-filing every Roy Mixer delay.
  assert.equal(guessCategory("RM9"), "ROYMIX");
  assert.equal(guessCategory("rm9"), "ROYMIX");
  assert.equal(guessCategory(" m16 "), "MAINTENANCE");
});

test("anything the rule cannot read falls back to GENERAL, never undefined", () => {
  for (const odd of ["", "X9", "ZZ", "9", "M", "hello"]) {
    assert.equal(guessCategory(odd), "GENERAL", `${odd} should fall back to GENERAL`);
  }
});

test("every group has a robot default, and the robot groups are the robot ones", () => {
  // The flag decides whether logging the delay asks WHICH machine. Getting it
  // wrong either loses the machine on a robot fault or demands one for a
  // line-wide power cut.
  const robot = CATEGORY_META.filter((c) => c.isRobotSpecific).map((c) => c.key);
  assert.deepEqual(robot, ["MAINTENANCE", "ROBOT", "GENERAL"]);
  for (const c of CATEGORY_META) assert.equal(defaultRobotSpecific(c.key), c.isRobotSpecific);
  // An unknown group must not demand a machine nobody was asked for.
  assert.equal(defaultRobotSpecific("NOT_A_GROUP"), false);
});

test("guessCategory only ever names a group that exists", () => {
  for (const code of ["RM1", "L1", "D1", "S1", "P1", "M1", "C1", "G1", "T1", "X1", ""]) {
    assert.ok(CATEGORY_ORDER.includes(guessCategory(code)), `${code} produced an unknown group`);
  }
});

// ── Remark column ─────────────────────────────────────────────────────────
// The Robo1..Robo4 rename is presentation-only, so the delay log stores
// "Roycut-1". Slabs Records was the last place still printing the stored name.

test("the Remark line names machines the way every other screen does", () => {
  const line = formatSlabRemarks("Wet body", [
    { durationMinutes: 12, startTime: "09:30", endTime: "09:42", machineName: "Roycut-1", remarks: null, delayCode: { code: "C8", description: "Robot fault" } },
  ]);
  assert.equal(line, "C8 Robo1 12m [09:30-09:42] · Wet body");
  assert.ok(!line.includes("Roycut"), "the stored machine name must not reach the operator");
});

test("an unmapped or missing machine name still reads sensibly", () => {
  assert.equal(
    formatSlabRemarks(null, [{ durationMinutes: 5, machineName: null, delayCode: { code: "T1", description: "Power cut" } }]),
    "T1 5m",
  );
  // A machine outside the four passes through rather than vanishing.
  assert.equal(
    formatSlabRemarks(null, [{ durationMinutes: 5, machineName: "Kreos", delayCode: { code: "T1", description: "Power cut" } }]),
    "T1 Kreos 5m",
  );
  assert.equal(formatSlabRemarks(null, []), "-");
});
