import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entryCreateData,
  rebuildsEntries,
  setupScalarData,
  typedMasterNames,
  type SetupEntryInput,
} from "../src/lib/robo/setupMasters.ts";
import { DESIGN_PRESETS } from "../src/lib/robo/design-presets.ts";

/* The shared shaping behind POST /api/robo/batch-recipes and the in-place
   PATCH on [id]. Both routes write the same rows, so a difference between them
   only ever surfaces as a setup that reads one way when it was created and
   another way after it was corrected. These pin the shape both must produce. */

test("entryCreateData maps blanks to null and coerces the cycle time", () => {
  const rows = entryCreateData([
    { machineId: "m1", programName: "BANYAN 2", toolName: "DISCOTHIN", liquidName: "LVBR2", powderName: "DVCTLM2", rollerHeight: "20", targetCycleTime: "214" },
  ]);
  assert.deepEqual(rows, [{
    machineId: "m1", programName: "BANYAN 2", toolName: "DISCOTHIN", liquidName: "LVBR2",
    powderName: "DVCTLM2", rollerHeight: "20", targetCycleTime: 214,
  }]);

  // The form sends "" for a field the operator left alone; "" must reach the
  // database as NULL, not as an empty string that then prints as a blank tool.
  const blank = entryCreateData([{ machineId: "m2", programName: "", toolName: "", liquidName: "", powderName: "", rollerHeight: "", targetCycleTime: "" }]);
  assert.deepEqual(blank, [{
    machineId: "m2", programName: null, toolName: null, liquidName: null,
    powderName: null, rollerHeight: null, targetCycleTime: null,
  }]);
});

test("entryCreateData drops an entry with no machine rather than failing mid-rebuild", () => {
  // machineId is a required FK. On the PATCH path the create runs AFTER the
  // old rows were deleted, so a row that cannot be written must be filtered
  // out here and not discovered by Postgres halfway through the transaction.
  const rows = entryCreateData([
    { machineId: "m1", programName: "A" },
    { programName: "orphan" },
    { machineId: "", programName: "also orphan" },
  ] as SetupEntryInput[]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].machineId, "m1");
});

test("entryCreateData keeps duplicate machines so the unique index can reject them", () => {
  // @@unique([batchRecipeId, machineId]) is the right place to catch this:
  // collapsing the pair here would have to pick a winner and silently throw
  // one machine's settings away.
  const rows = entryCreateData([
    { machineId: "m1", toolName: "DISCOTHIN" },
    { machineId: "m1", toolName: "DISCOFAT" },
  ]);
  assert.equal(rows.length, 2);
});

test("typedMasterNames trims, drops blanks and de-duplicates, first-seen order", () => {
  const entries: SetupEntryInput[] = [
    { machineId: "m1", toolName: "  SOMBRERO-20 " },
    { machineId: "m2", toolName: "DISCOTHIN" },
    { machineId: "m3", toolName: "SOMBRERO-20" },
    { machineId: "m4", toolName: "   " },
    { machineId: "m5" },
  ];
  assert.deepEqual(typedMasterNames(entries, (e) => e.toolName), ["SOMBRERO-20", "DISCOTHIN"]);
});

test("typedMasterNames does not fold case — the master index does not either", () => {
  // RoboTool.name is @unique and case-sensitive in Postgres. Folding case here
  // would skip a name the database genuinely does not have, so the next shift
  // still could not pick it from the dropdown.
  const names = typedMasterNames(
    [{ machineId: "m1", toolName: "DISCOTHIN" }, { machineId: "m2", toolName: "discothin" }],
    (e) => e.toolName,
  );
  assert.deepEqual(names, ["DISCOTHIN", "discothin"]);
});

test("a design preset's combined names reach the registrar whole", () => {
  /* This is why registerTypedMasters is live in the ERP rather than dead code
     the comboboxes make unreachable. applyDesignPreset writes these straight
     into the form with no "+ Add" POST in between, and two of them are not
     master rows at all — "BOAT 120, PAINTING TOOL" is not one of the seeded
     tools ("BOAT 120" and "PAINTING TOOL" are separate rows). The name must
     survive as one string; splitting it on the comma would invent two tools
     the sheet never named. */
  const calacatta = DESIGN_PRESETS.find((p) => p.design === "CALACATTA GOLD");
  assert.ok(calacatta, "CALACATTA GOLD must stay in the reference sheet");
  const entries: SetupEntryInput[] = Object.values(calacatta.machines).map((mp, i) => ({
    machineId: `m${i}`, toolName: mp.toolName, liquidName: mp.liquidName, powderName: mp.powderName,
  }));
  assert.ok(typedMasterNames(entries, (e) => e.toolName).includes("BOAT 120, PAINTING TOOL"));
});

test("rebuildsEntries separates a full setup save from the old notes-only PATCH", () => {
  // Absent means "leave the machines alone". No ERP screen sends a notes-only
  // PATCH today — RoboEntryForm is the route's only caller and it always sends
  // a full setup — but the contract is kept for anything calling the API
  // directly and for upstream's standalone copy, which still relies on it.
  // Reading an absent array as "no machines were ticked" would strip every
  // robot off a running setup.
  assert.equal(rebuildsEntries({ notes: "second pour" }), false);
  assert.equal(rebuildsEntries({ notes: null, entries: undefined }), false);
  assert.equal(rebuildsEntries({}), false);
  assert.equal(rebuildsEntries(null), false);
  assert.equal(rebuildsEntries(undefined), false);
  // An EMPTY array is a deliberate statement and is honoured as one.
  assert.equal(rebuildsEntries({ entries: [] }), true);
  assert.equal(rebuildsEntries({ entries: [{ machineId: "m1" }] }), true);
});

test("setupScalarData trims the design and never carries shiftId", () => {
  const data = setupScalarData({ productionDate: "2026-08-18", batchNo: " B-1042 ", designName: "  BANYAN ", targetSlabs: "120", thickness: "2", notes: "run 2" });
  assert.deepEqual(data, { productionDate: "2026-08-18", batchNo: "B-1042", designName: "BANYAN", targetSlabs: 120, thickness: 2, notes: "run 2" });
  // Moving a setup between shifts would count its slabs under a shift they
  // were not made in, so the key must not exist for a caller to set.
  assert.equal("shiftId" in data, false);
});

test("setupScalarData carries the production date and batch number, blanked when unset", () => {
  // Both are the operator's own record of the run, so they are trimmed and
  // blank-to-null exactly like notes — a setup corrected with the batch number
  // cleared must read as "not set", not as "".
  assert.deepEqual(
    setupScalarData({ productionDate: "  2026-08-01  ", batchNo: "  42 " }),
    { productionDate: "2026-08-01", batchNo: "42", designName: "", targetSlabs: null, thickness: null, notes: null },
  );
  const blank = setupScalarData({ productionDate: "   ", batchNo: "" });
  assert.equal(blank.productionDate, null);
  assert.equal(blank.batchNo, null);
});

test("setupScalarData blanks empty targets rather than storing zero", () => {
  const data = setupScalarData({ designName: "", targetSlabs: "", thickness: null, notes: "" });
  assert.deepEqual(data, { productionDate: null, batchNo: null, designName: "", targetSlabs: null, thickness: null, notes: null });
  // 0 is not a target anyone types; the form sends "" and this keeps them the
  // same "not set" so a corrected setup does not read as "target 0 slabs".
  assert.equal(setupScalarData({ targetSlabs: 0, thickness: 0 }).targetSlabs, null);
});
