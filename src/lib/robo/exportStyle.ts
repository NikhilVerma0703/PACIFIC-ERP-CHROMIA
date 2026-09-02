/**
 * Professional cell styling for the Robo download workbooks — a highlighted,
 * bold header on every sheet and clearly-marked total/section rows, using
 * xlsx-js-style (the community `xlsx` build silently drops all styles).
 *
 * The palette is Office-standard: a dark-blue header, a mid-blue batch section
 * band, a light-blue wash on group totals and a slightly stronger one on the
 * grand total. Data cells are left to Excel's own gridlines, so the highlights
 * are what the eye lands on.
 *
 * Only formatting is added here — the values, columns and row order the routes
 * build are untouched.
 */
import * as XLSX from "xlsx-js-style";
import { type RoboRowRole } from "./exportRowRoles";

const HAIRLINE = { style: "thin", color: { rgb: "B7C4D6" } } as const;
const BORDER = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE } as const;

/** The column-header band: dark blue, bold white, on every sheet. */
export const HEADER_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "1F4E79" } },
  font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: BORDER,
} as const;

/** A batch section header inside the grouped Production Records sheet. */
export const SECTION_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "4472C4" } },
  font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
  alignment: { horizontal: "left", vertical: "center" },
  border: BORDER,
} as const;

/** A group's "Total → X records" line. */
export const SUMMARY_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "DDEBF7" } },
  font: { bold: true, sz: 10, color: { rgb: "1F4E79" } },
  alignment: { horizontal: "left", vertical: "center" },
  border: { top: HAIRLINE, bottom: HAIRLINE },
} as const;

/** The whole-sheet grand total — the bottom line, one shade stronger. */
export const GRAND_TOTAL_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "BDD7EE" } },
  font: { bold: true, sz: 11, color: { rgb: "1F4E79" } },
  alignment: { horizontal: "left", vertical: "center" },
  border: {
    top: { style: "medium", color: { rgb: "8EAADB" } },
    bottom: { style: "medium", color: { rgb: "8EAADB" } },
  },
} as const;

const ROLE_STYLE = {
  section: SECTION_STYLE,
  summary: SUMMARY_STYLE,
  grandTotal: GRAND_TOTAL_STYLE,
} as const;

/** Paint one whole row (every column) with a style, creating empty cells where
 *  the row's data left gaps so the fill spans the full width. */
function styleRow(ws: XLSX.WorkSheet, r: number, columnCount: number, style: unknown): void {
  for (let c = 0; c < columnCount; c += 1) {
    const address = XLSX.utils.encode_cell({ r, c });
    const cell = ws[address] ?? { t: "s", v: "" };
    cell.s = style;
    ws[address] = cell;
  }
}

/**
 * Style a Robo download sheet in place: the header row always, plus each data
 * row the caller flags with a role. `rowRoles[i]` is the row json_to_sheet put
 * at sheet row i+1 (row 0 being the header), so it lines up with the very array
 * the route handed to json_to_sheet. The header row is also given a little extra
 * height so the bold band reads as a header.
 */
export function styleRoboSheet(
  ws: XLSX.WorkSheet,
  opts: { columnCount: number; rowRoles?: readonly (RoboRowRole | null)[]; headerHeightPt?: number },
): void {
  const n = opts.columnCount;
  styleRow(ws, 0, n, HEADER_STYLE);

  (opts.rowRoles ?? []).forEach((role, i) => {
    if (role) styleRow(ws, i + 1, n, ROLE_STYLE[role]);
  });

  const rows = (ws["!rows"] ?? []) as XLSX.RowInfo[];
  rows[0] = { hpt: opts.headerHeightPt ?? 26 };
  ws["!rows"] = rows;
}
