// The .xlsx side of the flat piece-list intake: buffer in, cell matrix out,
// straight into parseFlatSheet.
//
// The split is deliberate. Every rule about what the sheet means lives in
// flatSheetParser.ts, which imports nothing and is therefore reachable from
// `node --test`; this file holds the one thing that cannot be tested without a
// real workbook — reading it. Keep it that way: if a decision starts creeping
// in here, it belongs next door.

import * as XLSX from "xlsx";
import { parseFlatSheet, type FlatSheetParseResult } from "./flatSheetParser";

/** Flatten one sheet to the row-major cell matrix parseFlatSheet expects. */
function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    // raw: true keeps numbers as numbers. The old parser used raw:false and got
    // locale-formatted strings back, which is how "1,060" ever needed handling.
    raw: true,
    blankrows: false,
  }) as unknown[][];
}

/**
 * Parse the manager's flat Length / Width / Qty / SFT upload.
 *
 * Tries every sheet in the workbook and returns the first one that yields
 * rows — files arrive with cover sheets, instruction tabs and an old Drawing
 * Summary still sitting in tab 1 often enough that assuming a sheet index is
 * how an upload "loses" all its data. If no sheet parses, the first sheet's
 * result is returned so the caller shows a real error rather than a generic one.
 */
export function parseFlatSheetBuffer(buffer: Buffer): FlatSheetParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return {
      rows: [],
      skippedZeroQtyRows: [],
      totals: { rowCount: 0, totalPieces: 0, totalSqft: 0 },
      errors: ["Could not read that file. It must be a .xlsx or .xls workbook."],
      warnings: [],
    };
  }

  if (!workbook.SheetNames.length) {
    return {
      rows: [],
      skippedZeroQtyRows: [],
      totals: { rowCount: 0, totalPieces: 0, totalSqft: 0 },
      errors: ["That workbook has no sheets in it."],
      warnings: [],
    };
  }

  let firstResult: FlatSheetParseResult | null = null;
  for (const name of workbook.SheetNames) {
    const result = parseFlatSheet(sheetToMatrix(workbook.Sheets[name]));
    if (result.rows.length) return result;
    if (!firstResult) firstResult = result;
  }
  return firstResult as FlatSheetParseResult;
}
