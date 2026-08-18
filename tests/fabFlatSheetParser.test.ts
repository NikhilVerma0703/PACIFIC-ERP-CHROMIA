import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFlatSheet, flatRowLabel, SFT_TOLERANCE_SQFT,
} from "../src/lib/fab/flatSheetParser.ts";

// The new manager intake: a flat Length / Width / Qty / SFT list, no drawings,
// no sink columns, nothing that routes anything. The rules that matter are the
// ones that lose data quietly — a dropped Qty-0 row, two identical rows merged
// into one, an SFT the manager edited without touching the dimensions beside it.

/** The real sample, all 23 rows, verified against the file the manager sent:
 *  1,060 pieces and 3,548.61 sqft across the 17 live rows. */
const SAMPLE: (string | number)[][] = [
  ["", "Length", "Width", "Qty", "SFT"],
  [1, 25, 22.5, 40, 156.25],
  [2, 25, 4, 40, 27.78],
  [3, 28, 22.5, 60, 262.50],
  [4, 28, 4, 60, 46.67],
  [5, 31, 22.5, 100, 484.38],
  [6, 31, 4, 100, 86.11],
  [7, 34, 22.5, 60, 318.75],
  [8, 34, 4, 60, 56.67],
  [9, 37, 22.5, 100, 578.13],
  [10, 37, 4, 100, 102.78],
  [11, 43, 22.5, 60, 403.13],
  [12, 43, 4, 60, 71.67],
  [13, 43, 22.5, 60, 403.13],
  [14, 43, 4, 60, 71.67],
  [15, 49, 22.5, 0, 0.00],
  [16, 49, 4, 0, 0.00],
  [17, 61, 22.5, 30, 285.94],
  [18, 61, 4, 30, 50.83],
  [19, 61, 22.5, 0, 0.00],
  [20, 61, 4, 0, 0.00],
  [21, 61, 22.5, 0, 0.00],
  [22, 61, 4, 0, 0.00],
  [23, 128, 4, 40, 142.22],
];

const clone = (grid: (string | number)[][]) => grid.map(r => [...r]);

/* -- The sample, end to end ------------------------------------------------- */

test("the real sample parses to 17 rows, 1,060 pieces and 3,548.61 sqft", () => {
  const out = parseFlatSheet(SAMPLE);

  assert.deepEqual(out.errors, []);
  assert.equal(out.rows.length, 17);
  assert.equal(out.totals.rowCount, 17);
  assert.equal(out.totals.totalPieces, 1060);
  assert.equal(out.totals.totalSqft, 3548.61);

  // Every SFT is the file's own value, because every row in this file is right.
  for (const r of out.rows) assert.equal(r.totalSqft, r.fileSqft);
  // Nothing about the file is worth complaining about except the zero rows.
  assert.equal(out.warnings.filter(w => w.includes("SFT in the file")).length, 0);
});

test("SFT is recomputed, not read — the file's column is only ever compared", () => {
  const out = parseFlatSheet(SAMPLE);
  const row1 = out.rows[0];
  assert.equal(row1.lengthIn, 25);
  assert.equal(row1.widthIn, 22.5);
  assert.equal(row1.quantity, 40);
  assert.equal(row1.totalSqft, 156.25); // 25 * 22.5 * 40 / 144, exactly

  // Two decimals is the sheet's own precision: 25 * 4 * 40 / 144 = 27.7778.
  assert.equal(out.rows[1].totalSqft, 27.78);
  // ...and 43 * 22.5 * 60 / 144 = 403.125 rounds up, not down.
  assert.equal(out.rows.find(r => r.rowNumber === 11)?.totalSqft, 403.13);
});

/* -- The SFT mismatch warning ----------------------------------------------- */

test("an SFT the manager did not update warns, names the row, and is not obeyed", () => {
  // Row 5 is 31 x 22.5 x 100 = 484.38. Someone changed the Qty to 90 and left
  // the SFT alone — the classic one-cell edit.
  const grid = clone(SAMPLE);
  grid[5][3] = 90;

  const out = parseFlatSheet(grid);
  assert.deepEqual(out.errors, [], "a stale SFT is never a rejection");

  const warning = out.warnings.find(w => w.startsWith("Row 5:"));
  assert.ok(warning, `expected a warning for row 5, got: ${JSON.stringify(out.warnings)}`);
  assert.match(warning, /SFT in the file is 484\.38/);
  assert.match(warning, /435\.94/); // 31 * 22.5 * 90 / 144

  // The recomputed value wins, and it is the one carried forward.
  const row = out.rows.find(r => r.rowNumber === 5);
  assert.equal(row?.totalSqft, 435.94);
  assert.equal(row?.fileSqft, 484.38, "the file's claim is kept for reference, not used");
  assert.equal(row?.quantity, 90);

  // Only the row that is wrong is named.
  assert.equal(out.warnings.filter(w => w.includes("SFT in the file")).length, 1);
});

test("2dp rounding in a clean file never trips the warning", () => {
  // The worst legitimate case in the sample: 484.375 written as 484.38, a
  // discrepancy of 0.005 — half the tolerance.
  const out = parseFlatSheet(SAMPLE);
  assert.equal(out.warnings.filter(w => w.includes("SFT in the file")).length, 0);
  assert.equal(SFT_TOLERANCE_SQFT, 0.01);

  // Exactly at the tolerance is still clean; a hair past it is not.
  const atEdge = clone(SAMPLE);
  atEdge[1][4] = 156.25 + SFT_TOLERANCE_SQFT;
  assert.equal(parseFlatSheet(atEdge).warnings.filter(w => w.includes("SFT in the file")).length, 0);

  const overEdge = clone(SAMPLE);
  overEdge[1][4] = 156.25 + SFT_TOLERANCE_SQFT + 0.001;
  assert.equal(parseFlatSheet(overEdge).warnings.filter(w => w.includes("SFT in the file")).length, 1);
});

test("a sheet with no SFT column is fine, and says so once", () => {
  const grid = SAMPLE.map(r => r.slice(0, 4));
  const out = parseFlatSheet(grid);

  assert.deepEqual(out.errors, []);
  assert.equal(out.rows.length, 17);
  assert.equal(out.totals.totalSqft, 3548.61);
  for (const r of out.rows) assert.equal(r.fileSqft, null);
  assert.equal(out.warnings.filter(w => w.includes("No SFT column")).length, 1);
});

/* -- Qty 0 ------------------------------------------------------------------ */

test("Qty 0 rows are skipped, counted, and handed back by row number", () => {
  const out = parseFlatSheet(SAMPLE);

  // 6 of the 23 rows. Dropping them silently is how a manager concludes the
  // upload ate his data.
  assert.equal(out.skippedZeroQtyRows.length, 6);
  assert.deepEqual(out.skippedZeroQtyRows.map(r => r.rowNumber), [15, 16, 19, 20, 21, 22]);
  assert.ok(out.skippedZeroQtyRows.every(r => r.reason === "ZERO_QTY"));
  // Their dimensions come back too, so the UI can show what was dropped.
  assert.deepEqual(out.skippedZeroQtyRows[0], {
    rowNumber: 15, sheetRow: 16, lengthIn: 49, widthIn: 22.5, reason: "ZERO_QTY",
  });

  // 17 + 6 = 23: every row in the file is accounted for as kept or skipped.
  assert.equal(out.rows.length + out.skippedZeroQtyRows.length, SAMPLE.length - 1);

  // And it is in the warnings, so a UI that only renders warnings still tells
  // the truth.
  const w = out.warnings.find(x => x.includes("Qty 0"));
  assert.ok(w);
  assert.match(w, /^6 rows had Qty 0 and were skipped: row 15, 16, 19, 20, 21, 22\.$/);
});

test("a single zero row reads as singular", () => {
  const out = parseFlatSheet([
    ["Length", "Width", "Qty"],
    [25, 22.5, 0],
    [25, 4, 40],
  ]);
  assert.match(out.warnings.find(w => w.includes("Qty 0")) ?? "", /^1 row had Qty 0 and was skipped: row 1\.$/);
});

test("a sheet where every row is Qty 0 is refused, not silently empty", () => {
  const out = parseFlatSheet([
    ["", "Length", "Width", "Qty", "SFT"],
    [1, 49, 22.5, 0, 0],
    [2, 49, 4, 0, 0],
  ]);
  assert.equal(out.rows.length, 0);
  assert.equal(out.skippedZeroQtyRows.length, 2);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /Every row has Qty 0/);
});

/* -- No merging ------------------------------------------------------------- */

test("repeated Length x Width pairs stay separate rows, carrying their row numbers", () => {
  const out = parseFlatSheet(SAMPLE);

  // 43 x 22.5 appears twice (rows 11 and 13) and 61 x 22.5 three times (17, 19,
  // 21 — two of which are Qty 0). Merging any of them would lose the
  // supervisor's ability to put a sink on one row and not the other.
  const at43x225 = out.rows.filter(r => r.lengthIn === 43 && r.widthIn === 22.5);
  assert.equal(at43x225.length, 2);
  assert.deepEqual(at43x225.map(r => r.rowNumber), [11, 13]);
  assert.deepEqual(at43x225.map(r => r.quantity), [60, 60]);

  const at43x4 = out.rows.filter(r => r.lengthIn === 43 && r.widthIn === 4);
  assert.deepEqual(at43x4.map(r => r.rowNumber), [12, 14]);

  // Row numbers are unique and are the file's own, not a re-count of the rows
  // that survived — row 17 must still be 17 after 15 and 16 were skipped.
  const numbers = out.rows.map(r => r.rowNumber);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.ok(numbers.includes(17));
  assert.ok(!numbers.includes(18) || out.rows.find(r => r.rowNumber === 18)?.widthIn === 4);

  // Identical dimensions AND identical quantity are still two rows.
  const dupes = parseFlatSheet([
    ["Sr", "Length", "Width", "Qty"],
    [1, 43, 22.5, 60],
    [2, 43, 22.5, 60],
  ]);
  assert.equal(dupes.rows.length, 2);
  assert.deepEqual(dupes.rows.map(r => r.rowNumber), [1, 2]);
  assert.equal(dupes.totals.totalPieces, 120);
});

test("without an index column the row number is the position among data rows", () => {
  const out = parseFlatSheet([
    ["Length", "Width", "Qty", "SFT"],
    [25, 22.5, 40, 156.25],
    [43, 22.5, 60, 403.13],
    [43, 22.5, 60, 403.13],
  ]);
  assert.deepEqual(out.rows.map(r => r.rowNumber), [1, 2, 3]);
  assert.deepEqual(out.rows.map(r => r.sheetRow), [2, 3, 4]);
});

test("flatRowLabel is how the row number reaches the requirement", () => {
  // The flat sheet has no drawing number and no piece label, and this change
  // adds exactly one column to fab_requirement — so the row number rides in
  // piece_label, which the board and describeRequirement already render.
  assert.equal(flatRowLabel(11), "Row 11");
  assert.equal(flatRowLabel(1), "Row 1");
});

/* -- Header tolerance ------------------------------------------------------- */

test("headers are matched by meaning, not by spelling", () => {
  const variants = [
    ["Sr. No.", "LENGTH (IN)", "width  (in)", "QTY", "S.F.T"],
    ["#", "length", "Width", "Quantity", "Sq Ft"],
    ["S.No", "Length_in", "Depth (in)", "No. of Pcs", "Total SFT"],
    ["", "  Length  ", "Width", "Qty.", "SFT"],
  ];
  for (const header of variants) {
    const out = parseFlatSheet([header, [1, 25, 22.5, 40, 156.25]]);
    assert.deepEqual(out.errors, [], `header ${JSON.stringify(header)}`);
    assert.equal(out.rows.length, 1, `header ${JSON.stringify(header)}`);
    assert.equal(out.rows[0].totalSqft, 156.25);
    assert.equal(out.rows[0].rowNumber, 1);
  }
});

test("a title block above the header does not hide it", () => {
  const out = parseFlatSheet([
    ["PACIFIC SURFACES", "", "", "", ""],
    ["Drawing summary — Project ABC", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "Length", "Width", "Qty", "SFT"],
    [1, 25, 22.5, 40, 156.25],
  ]);
  assert.deepEqual(out.errors, []);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].sheetRow, 5);
});

test("a totals row under the data is not a piece", () => {
  const out = parseFlatSheet([
    ["", "Length", "Width", "Qty", "SFT"],
    [1, 25, 22.5, 40, 156.25],
    [2, 25, 4, 40, 27.78],
    ["Total", "", "", 80, 184.03],
  ]);
  assert.deepEqual(out.errors, []);
  assert.equal(out.rows.length, 2);
  assert.equal(out.totals.totalPieces, 80);
});

test("numbers that arrive as text, thousands separators included", () => {
  const out = parseFlatSheet([
    ["", "Length", "Width", "Qty", "SFT"],
    ["1", "25", "22.5", "1,000", "3906.25"],
  ]);
  assert.deepEqual(out.errors, []);
  assert.equal(out.rows[0].quantity, 1000);
  assert.equal(out.rows[0].totalSqft, 3906.25);
});

/* -- Rejections ------------------------------------------------------------- */

test("a non-numeric dimension is rejected, by row and by column", () => {
  const out = parseFlatSheet([
    ["", "Length", "Width", "Qty", "SFT"],
    [1, 25, 22.5, 40, 156.25],
    [2, "twenty five", 4, 40, 27.78],
    [3, 28, "N/A", 60, 262.5],
  ]);
  assert.equal(out.rows.length, 0, "nothing is imported from a file with a bad row");
  assert.equal(out.errors.length, 2, "every bad row is named at once, not just the first");
  assert.match(out.errors[0], /^Row 2: Length "twenty five" is not a number\.$/);
  assert.match(out.errors[1], /^Row 3: Width "N\/A" is not a number\.$/);
});

test("negative values are rejected", () => {
  const out = parseFlatSheet([
    ["", "Length", "Width", "Qty", "SFT"],
    [1, -25, 22.5, 40, 0],
    [2, 25, -22.5, 40, 0],
    [3, 25, 22.5, -40, 0],
  ]);
  assert.equal(out.rows.length, 0);
  assert.equal(out.errors.length, 3);
  assert.match(out.errors[0], /^Row 1: Length is negative \(-25\)\.$/);
  assert.match(out.errors[1], /^Row 2: Width is negative \(-22\.5\)\.$/);
  assert.match(out.errors[2], /^Row 3: Qty is negative \(-40\)\.$/);
});

test("a fractional quantity is rejected — half a piece is not a piece", () => {
  const out = parseFlatSheet([["Length", "Width", "Qty"], [25, 22.5, 2.5]]);
  assert.match(out.errors[0], /^Row 1: Qty must be a whole number of pieces \(got 2\.5\)\.$/);
});

test("a live row with a zero dimension is rejected, but a Qty-0 row with one is not", () => {
  const bad = parseFlatSheet([["Length", "Width", "Qty"], [0, 22.5, 40]]);
  assert.match(bad.errors[0], /^Row 1: Length is 0 but Qty is 40\.$/);

  // A zeroed-out line keeps its real dimensions and is simply not made.
  const ok = parseFlatSheet([["Length", "Width", "Qty"], [0, 0, 0], [25, 22.5, 40]]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.rows.length, 1);
  assert.equal(ok.skippedZeroQtyRows.length, 1);
});

test("a missing required column says which one", () => {
  const noQty = parseFlatSheet([["", "Length", "Width", "SFT"], [1, 25, 22.5, 156.25]]);
  assert.equal(noQty.rows.length, 0);
  assert.match(noQty.errors[0], /^Missing required column: Qty\./);

  const noWidth = parseFlatSheet([["Length", "SFT"], [25, 156.25]]);
  assert.match(noWidth.errors[0], /^Missing required columns: Width, Qty\./);
  assert.match(noWidth.errors[0], /SFT is optional/);
});

test("a sheet with no header row at all says so", () => {
  const out = parseFlatSheet([[1, 25, 22.5, 40, 156.25], [2, 25, 4, 40, 27.78]]);
  assert.equal(out.rows.length, 0);
  assert.match(out.errors[0], /Could not find a header row/);
});

test("an empty sheet is refused", () => {
  for (const grid of [[], [[]], [["", "", ""]], [["", ""], ["", ""]]]) {
    const out = parseFlatSheet(grid);
    assert.equal(out.rows.length, 0);
    assert.equal(out.errors.length, 1);
    assert.match(out.errors[0], /The sheet is empty/);
  }
});

test("a header row with nothing under it is refused", () => {
  const out = parseFlatSheet([["", "Length", "Width", "Qty", "SFT"]]);
  assert.equal(out.rows.length, 0);
  assert.match(out.errors[0], /no piece rows below it/);
});

test("errors suppress rows entirely — a partly bad file is never half-imported", () => {
  const grid = clone(SAMPLE);
  grid[3][1] = "oops";
  const out = parseFlatSheet(grid);
  assert.equal(out.rows.length, 0);
  assert.equal(out.totals.totalPieces, 0);
  assert.ok(out.errors.length >= 1);
});
