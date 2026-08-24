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

const input = (over: Partial<ProductionRowInput> = {}): ProductionRowInput => ({
  serialNumber: 36,
  productionDate: "2026-08-13",
  designName: "BANYAN_23",
  thickness: 2,
  batchNo: "B-1042",
  slabNumber: "17579",
  roymixBodyWeight: 42.5,
  roymixCycleTime: 185,
  inTime: "09:30",
  outTime: "10:05",
  // Already formatted by the route, the way Slabs Records shows it.
  remarks: "C5 Robo1 15m [22:40-22:55]",
  ...over,
});

test("every key a row produces is a column of the sheet", () => {
  // The bug: the header said "Robo2 Body Weight (kg)" while the row was keyed
  // "RoyMix Body Weight (kg)", so the Robo2 column came out empty and the real
  // value was appended after Remarks.
  const columns = new Set<string>(PRODUCTION_RECORD_COLUMNS);
  for (const key of Object.keys(productionRecordRow(input(), 1))) {
    assert.ok(columns.has(key), `"${key}" is written by a row but is not a column`);
  }
});

test("every column of the sheet is filled by a row", () => {
  // The other half of the same failure: a header nothing writes is a column of
  // blanks, which reads as "we do not record that" rather than as a mistake.
  const keys = new Set(Object.keys(productionRecordRow(input(), 1)));
  for (const column of PRODUCTION_RECORD_COLUMNS) {
    assert.ok(keys.has(column), `column "${column}" is never written`);
  }
});

test("the columns are in the order the register is read", () => {
  assert.deepEqual([...PRODUCTION_RECORD_COLUMNS], [
    "S.No.", "Production Date", "Design Name", "Thickness (cm)", "Batch No.", "Slab No.",
    "Robo2 Body Weight (kg)", "Robo2 Cycle Time (sec)",
    "In Time", "Out Time", "Remarks",
  ]);
});

test("Remarks is the last column", () => {
  assert.equal(PRODUCTION_RECORD_COLUMNS[PRODUCTION_RECORD_COLUMNS.length - 1], "Remarks");
});

test("the Robo2 pair sits between Slab No. and In Time", () => {
  const at = (name: string) => PRODUCTION_RECORD_COLUMNS.indexOf(name as never);
  assert.equal(at("Robo2 Body Weight (kg)"), at("Slab No.") + 1);
  assert.equal(at("Robo2 Cycle Time (sec)"), at("Slab No.") + 2);
  assert.equal(at("In Time"), at("Slab No.") + 3);
});

test("Design Name and Batch No. are on every row now", () => {
  const row = productionRecordRow(input(), 1);
  assert.equal(row["Design Name"], "BANYAN_23");
  assert.equal(row["Batch No."], "B-1042");
  // Design Name reads right after the date, Batch No. right before the slab.
  const at = (name: string) => PRODUCTION_RECORD_COLUMNS.indexOf(name as never);
  assert.equal(at("Design Name"), at("Production Date") + 1);
  assert.equal(at("Batch No."), at("Slab No.") - 1);
});

test("Shift, Status, Delay Codes and Total Delay are gone", () => {
  for (const col of ["Shift", "Status", "Delay Codes", "Total Delay", "Operator"]) {
    assert.equal(PRODUCTION_RECORD_COLUMNS.includes(col as never), false, `"${col}" is still a column`);
  }
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
  const row = productionRecordRow(input(), 1);
  assert.equal(row["Robo2 Body Weight (kg)"], 42.5);
  assert.equal(row["Robo2 Cycle Time (sec)"], 185);
});

test("the Remarks column is the resolved slab-remark string", () => {
  // Passed in already formatted by the route (formatSlabRemarks), not rebuilt
  // here — this file stays pure so node --test can load it.
  assert.equal(productionRecordRow(input(), 1)["Remarks"], "C5 Robo1 15m [22:40-22:55]");
});

test("a blank cell is a dash, and zero is not blank", () => {
  const row = productionRecordRow(
    input({ thickness: null, roymixBodyWeight: null, roymixCycleTime: null, outTime: null, remarks: "-", batchNo: null, designName: null, productionDate: "" }),
    1,
  );
  for (const c of ["Design Name", "Thickness (cm)", "Batch No.", "Robo2 Body Weight (kg)", "Robo2 Cycle Time (sec)", "Out Time", "Remarks", "Production Date"]) {
    assert.equal(row[c as keyof typeof row], "-", c);
  }
  // 0 is a reading, not an absence — a body weight of 0 must print as 0. The
  // comparison in dash() is strict for exactly this reason: `0 == ""` is true.
  assert.equal(productionRecordRow(input({ roymixBodyWeight: 0 }), 1)["Robo2 Body Weight (kg)"], 0);
  assert.equal(productionRecordRow(input({ roymixCycleTime: 0 }), 1)["Robo2 Cycle Time (sec)"], 0);
  assert.equal(productionRecordRow(input({ thickness: 0 }), 1)["Thickness (cm)"], 0);
});

test("a slab with no S.No. falls back to its row number", () => {
  assert.equal(productionRecordRow(input({ serialNumber: null }), 7)["S.No."], 7);
  assert.equal(productionRecordRow(input({ serialNumber: 36 }), 7)["S.No."], 36);
});
