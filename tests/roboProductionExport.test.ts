import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCTION_RECORD_COLUMNS,
  PRODUCTION_RECORD_WIDTHS,
  productionRecordRow,
  type ProductionRowInput,
} from "../src/lib/robo/productionExport.ts";

/* The Complete Production download. json_to_sheet APPENDS any row key its
   header does not mention, so a header and a key that drift apart do not fail
   — they produce a blank column where the reader expects data and a stray one
   past the last. These pin the two together. */

const label = (s: string) => (s === "COMPLETED" ? "Completed" : "In-Processing");
const duration = (m: number) => `${m}m`;

const input = (over: Partial<ProductionRowInput> = {}): ProductionRowInput => ({
  serialNumber: 36,
  productionDate: "2026-08-13",
  shiftNumber: 1,
  thickness: 2,
  slabNumber: "17579",
  roymixBodyWeight: 42.5,
  roymixCycleTime: 185,
  inTime: "09:30",
  outTime: "10:05",
  status: "COMPLETED",
  delayCodes: ["RM1", "RM4"],
  delayMinutes: 12,
  remarks: "chipped corner",
  ...over,
});

test("every key a row produces is a column of the sheet", () => {
  // The bug: the header said "Robo2 Body Weight (kg)" while the row was keyed
  // "RoyMix Body Weight (kg)", so the Robo2 column came out empty and the real
  // value was appended after Remarks.
  const columns = new Set<string>(PRODUCTION_RECORD_COLUMNS);
  for (const key of Object.keys(productionRecordRow(input(), 1, label, duration))) {
    assert.ok(columns.has(key), `"${key}" is written by a row but is not a column`);
  }
});

test("every column of the sheet is filled by a row", () => {
  // The other half of the same failure: a header nothing writes is a column of
  // blanks, which reads as "we do not record that" rather than as a mistake.
  const keys = new Set(Object.keys(productionRecordRow(input(), 1, label, duration)));
  for (const column of PRODUCTION_RECORD_COLUMNS) {
    assert.ok(keys.has(column), `column "${column}" is never written`);
  }
});

test("the columns are in the order the register is read", () => {
  assert.deepEqual([...PRODUCTION_RECORD_COLUMNS], [
    "S.No.", "Production Date", "Shift", "Thickness (cm)", "Slab Number",
    "Robo2 Body Weight (kg)", "Robo2 Cycle Time (sec)",
    "In Time", "Out Time",
    "Status", "Delay Codes", "Total Delay", "Remarks",
  ]);
});

test("Remarks is the last column", () => {
  assert.equal(PRODUCTION_RECORD_COLUMNS[PRODUCTION_RECORD_COLUMNS.length - 1], "Remarks");
});

test("the Robo2 pair sits between Slab Number and In Time", () => {
  const at = (name: string) => PRODUCTION_RECORD_COLUMNS.indexOf(name as never);
  assert.equal(at("Robo2 Body Weight (kg)"), at("Slab Number") + 1);
  assert.equal(at("Robo2 Cycle Time (sec)"), at("Slab Number") + 2);
  assert.equal(at("In Time"), at("Slab Number") + 3);
});

test("Operator and Design Name are gone", () => {
  // Operator was RoboShift.operatorName, which nothing fills in — a column of
  // dashes. Design Name is on the Production Setup sheet, once per run.
  assert.equal(PRODUCTION_RECORD_COLUMNS.includes("Operator" as never), false);
  assert.equal(PRODUCTION_RECORD_COLUMNS.includes("Design Name" as never), false);
});

test("nothing is called RoyMix any more", () => {
  for (const c of PRODUCTION_RECORD_COLUMNS) {
    assert.equal(/roymix/i.test(c), false, `"${c}" still says RoyMix`);
  }
});

test("there is one width per column", () => {
  assert.equal(PRODUCTION_RECORD_WIDTHS.length, PRODUCTION_RECORD_COLUMNS.length);
});

test("the Robo2 values are the ones the slab recorded", () => {
  const row = productionRecordRow(input(), 1, label, duration);
  assert.equal(row["Robo2 Body Weight (kg)"], 42.5);
  assert.equal(row["Robo2 Cycle Time (sec)"], 185);
});

test("a blank cell is a dash, and zero is not blank", () => {
  const row = productionRecordRow(
    input({ thickness: null, roymixBodyWeight: null, roymixCycleTime: null, outTime: null, remarks: null, shiftNumber: null, productionDate: "" }),
    1, label, duration,
  );
  for (const c of ["Thickness (cm)", "Robo2 Body Weight (kg)", "Robo2 Cycle Time (sec)", "Out Time", "Remarks", "Shift", "Production Date"]) {
    assert.equal(row[c as keyof typeof row], "-", c);
  }
  // 0 is a reading, not an absence — a body weight of 0 must print as 0. The
  // comparison in dash() is strict for exactly this reason: `0 == ""` is true.
  assert.equal(productionRecordRow(input({ roymixBodyWeight: 0 }), 1, label, duration)["Robo2 Body Weight (kg)"], 0);
  assert.equal(productionRecordRow(input({ roymixCycleTime: 0 }), 1, label, duration)["Robo2 Cycle Time (sec)"], 0);
  assert.equal(productionRecordRow(input({ thickness: 0 }), 1, label, duration)["Thickness (cm)"], 0);
});

test("a slab with no S.No. falls back to its row number", () => {
  assert.equal(productionRecordRow(input({ serialNumber: null }), 7, label, duration)["S.No."], 7);
  assert.equal(productionRecordRow(input({ serialNumber: 36 }), 7, label, duration)["S.No."], 36);
});

test("no delays reads as a dash, not as zero minutes", () => {
  const row = productionRecordRow(input({ delayCodes: [], delayMinutes: 0 }), 1, label, duration);
  assert.equal(row["Delay Codes"], "-");
  assert.equal(row["Total Delay"], "-");
});
