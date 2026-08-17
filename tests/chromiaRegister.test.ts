import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMN, dispositionFromRemark, findDuplicateSlabNos, FIRST_DATA_ROW_INDEX,
  parseProRegister, reasonCodeFromRemark, statusForImportedRow, toCalendarDay,
  toCode, toDate,
} from "../src/lib/chromia/register.ts";

// The register is the line's whole history, and the import runs once. A row
// misread here becomes a slab in the wrong month, or a recalibration backlog
// that never appears on the tracking screen — the exact blindness the module
// was built to end.

/** Build a sheet row with cells at the register's real column indexes. */
function row(cells: Partial<Record<keyof typeof COLUMN, unknown>>): unknown[] {
  const out: unknown[] = new Array(24).fill("");
  for (const [k, v] of Object.entries(cells)) {
    out[COLUMN[k as keyof typeof COLUMN]] = v;
  }
  return out;
}

const header = [[], [], [], []]; // three merged header rows plus a spacer

test("data starts on the fifth row, below the merged headers", () => {
  assert.equal(FIRST_DATA_ROW_INDEX, 4);
  const r = parseProRegister([
    ...header,
    row({ date: "2026-05-01", slabName: "Base 18mm", batchNo: "MAY-01", slabNo: "CHR-1" }),
  ]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].sourceRow, 5, "1-based, matching what Excel shows");
});

test("a spreadsheet day that arrives seconds short of midnight is still that day", () => {
  // The bug this repairs: "1 May 2026" comes back as 30 Apr 23:59:50, which
  // files the whole month under April and makes a May filter return nothing.
  const drifted = new Date(2026, 3, 30, 23, 59, 50);
  const snapped = toCalendarDay(drifted);
  assert.equal(snapped.getMonth(), 4, "should be May");
  assert.equal(snapped.getDate(), 1);
  assert.equal(snapped.getHours(), 0);
});

test("dates are read as local days, whichever way the register wrote them", () => {
  const iso = toDate("2026-05-01");
  assert.ok(iso);
  assert.equal(iso.getMonth(), 4);
  assert.equal(iso.getDate(), 1, "not the previous day west of Greenwich");

  // "5/1/26" would otherwise land in 2001.
  const short = toDate("5/1/26");
  assert.ok(short);
  assert.equal(short.getFullYear(), 2026);

  assert.equal(toDate(""), null);
  assert.equal(toDate("not a date"), null);
  // A pre-2000 date is a parsing accident, not history.
  assert.equal(toDate("1/1/1970"), null);
});

test("the date is carried down the sheet, the way a person reads it", () => {
  // The DATE cell is written once per day, on that day's first slab.
  const r = parseProRegister([
    ...header,
    row({ date: "2026-05-12", slabName: "Base", batchNo: "B1", slabNo: "S1" }),
    row({ slabName: "Base", batchNo: "B1", slabNo: "S2" }),
    row({ slabName: "Base", batchNo: "B1", slabNo: "S3" }),
  ]);
  assert.equal(r.rows.length, 3);
  for (const parsed of r.rows) assert.equal(parsed.receivedDate.getDate(), 12);
});

test("the fully-printed date wins over a date carried from days ago", () => {
  // The May register had the DATE typed once, on row 1, and never again.
  // Carrying it alone stamps the whole month 1 May and a 12-27 May filter finds
  // nothing. The fully-printed column is filled for every slab, so it is the
  // only honest answer where DATE was abandoned.
  const r = parseProRegister([
    ...header,
    row({ date: "2026-05-01", slabName: "Base", batchNo: "B1", slabNo: "S1" }),
    row({ slabName: "Base", batchNo: "B1", slabNo: "S2", fullyPrintedDate: "2026-05-19" }),
  ]);
  assert.equal(r.rows[0].receivedDate.getDate(), 1);
  assert.equal(r.rows[1].receivedDate.getDate(), 19, "not carried from 1 May");
});

test("blank spacer rows are skipped quietly, incomplete ones are reported", () => {
  const r = parseProRegister([
    ...header,
    row({ date: "2026-05-01", slabName: "Base", batchNo: "B1", slabNo: "S1" }),
    row({}),                                            // spacer — normal
    row({ slabName: "Base", batchNo: "B1" }),           // no slab number
    row({ slabName: "Base", slabNo: "S9" }),            // no batch
  ]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped, 1, "the blank row is not an error");
  assert.equal(r.issues.length, 2);
  assert.match(r.issues[0].reason, /slab number/i);
  assert.match(r.issues[1].reason, /batch/i);
  // Issues carry the Excel row so someone can go and look at it.
  assert.ok(r.issues.every((i) => i.sourceRow > FIRST_DATA_ROW_INDEX));
});

test("remarks become dispositions, including the real ones from the sheet", () => {
  assert.equal(dispositionFromRemark("RECALIBRATE - HALF PRINT", false), "RECALIBRATION");
  assert.equal(dispositionFromRemark("RECALIBRATE - RED COLOUR", false), "RECALIBRATION");
  assert.equal(dispositionFromRemark("SAMPLE CUTTING  5 MAY", false), "SAMPLE_CUTTING");
  assert.equal(dispositionFromRemark("STOCK", false), "STOCK");
  assert.equal(dispositionFromRemark("SCRAP", false), "WASTE");

  // No remark, but a dispatch date in the sheet means it went out.
  assert.equal(dispositionFromRemark(null, true), "DISPATCH");
  assert.equal(dispositionFromRemark(null, false), null, "unknown stays unknown");
});

test("recalibration reasons are classified, and nothing unrecognised is lost", () => {
  assert.equal(reasonCodeFromRemark("RECALIBRATE - HALF PRINT"), "HALF-PRINT");
  assert.equal(reasonCodeFromRemark("RECALIBRATE - RED COLOUR"), "RED-COLOUR");
  assert.equal(reasonCodeFromRemark("RECALIBRATE - GLOSS LOW"), "GLOSS-OUT-OF-SPEC");
  // Unrecognised falls to OTHER; the original text stays on the slab.
  assert.equal(reasonCodeFromRemark("RECALIBRATE - SOMETHING NEW"), "OTHER");
  // A remark that is not a recalibration has no reason at all.
  assert.equal(reasonCodeFromRemark("STOCK"), null);
  assert.equal(reasonCodeFromRemark(null), null);
});

test("a recalibration with no return date imports as still out", () => {
  // The population the tracking screen exists to surface. Importing it as
  // anything else hides the backlog the module was built to find.
  assert.equal(
    statusForImportedRow({ disposition: "RECALIBRATION", recalReceivedDate: null }),
    "OUT_FOR_RECALIBRATION",
  );
  assert.equal(
    statusForImportedRow({ disposition: "RECALIBRATION", recalReceivedDate: new Date() }),
    "RECEIVED_FROM_RECALIBRATION",
  );
  assert.equal(statusForImportedRow({ disposition: "DISPATCH", recalReceivedDate: null }), "DISPATCHED");
  assert.equal(statusForImportedRow({ disposition: "STOCK", recalReceivedDate: null }), "IN_STOCK");
  assert.equal(statusForImportedRow({ disposition: "WASTE", recalReceivedDate: null }), "WASTE");
  // A row with no disposition is still somewhere on the line.
  assert.equal(statusForImportedRow({ disposition: null, recalReceivedDate: null }), "IN_PROCESS");
});

test("the register's repeated slab numbers are found before anything is written", () => {
  const rows = parseProRegister([
    ...header,
    row({ date: "2026-05-01", slabName: "Base", batchNo: "B1", slabNo: "CHR-7" }),
    row({ slabName: "Base", batchNo: "B1", slabNo: "chr-7" }),
    row({ slabName: "Base", batchNo: "B1", slabNo: "CHR-8" }),
  ]).rows;
  // Case-insensitive: the sheet is typed by hand.
  assert.deepEqual(findDuplicateSlabNos(rows), ["chr-7"]);
});

test("master-data codes are stable slugs of the sheet's free text", () => {
  assert.equal(toCode("Base Slab 18mm"), "BASE-SLAB-18MM");
  assert.equal(toCode("  spaced  out  "), "SPACED-OUT");
  assert.equal(toCode("Ply / MDF"), "PLY-MDF");
  assert.equal(toCode("x".repeat(80)).length, 60, "fits the column");
});

test("a full row carries every column the sheet records", () => {
  const r = parseProRegister([
    ...header,
    row({
      date: "2026-05-12", slabName: "Base 18mm", batchNo: "MAY-04", slabNo: "CHR-1042",
      designFile: "MARBLE-07.tif", fullyPrintedDate: "2026-05-12",
      remark: "RECALIBRATE - HALF PRINT", recalSentDate: "2026-05-14",
      recalReceivedDate: "2026-05-25",
    }),
  ]);
  const p = r.rows[0];
  assert.equal(p.slabNo, "CHR-1042");
  assert.equal(p.batchNo, "MAY-04");
  assert.equal(p.materialName, "Base 18mm");
  assert.equal(p.designFile, "MARBLE-07.tif");
  assert.equal(p.disposition, "RECALIBRATION");
  assert.equal(p.recalibrationReasonCode, "HALF-PRINT");
  assert.equal(p.recalSentDate?.getDate(), 14);
  assert.equal(p.recalReceivedDate?.getDate(), 25);
  assert.equal(p.remark, "RECALIBRATE - HALF PRINT", "the original text is kept verbatim");
});
