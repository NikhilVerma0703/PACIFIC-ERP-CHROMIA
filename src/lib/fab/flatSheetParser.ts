// The manager's NEW fabrication intake sheet: a flat piece list, nothing else.
//
//     Sr | Length | Width | Qty | SFT
//
// It replaces the Drawing Summary (excelParser.ts), which carried drawing
// numbers, sink cuts and a DE&P column and let the file decide routing. Nothing
// in this format routes anything: every piece is edge-polished, and sinks are
// chosen by the supervisor afterwards, per requirement row, with a quantity.
// So this parser's whole job is to get 1,060 pieces of geometry into the system
// without losing or inventing a single one.
//
// PURE, AND IT IMPORTS NOTHING. `node --test` resolves ESM strictly, so a
// relative import without a .ts extension fails at runtime while adding the
// extension fights the Next build; every unit-tested module in this repo is
// self-contained for that reason (see the same note in finance/pipelineRules.ts).
// The xlsx read lives next door in flatSheetWorkbook.ts, which hands this
// function a plain cell matrix — that is the only reason it can be tested at
// all, because a rule you can only exercise by uploading a real .xlsx to a real
// database is a rule nobody ever exercises.
//
// UNITS. Length and Width are INCHES, as printed on the sheet. SFT is square
// FEET. FabRequirement.length/width are inches too, so nothing is converted on
// the way in; the inch -> mm conversion happens later and only where slab
// geometry is involved (see slabLoss.ts).

/** Square inches in a square foot. SFT = L x W x Qty / 144. */
export const SQ_IN_PER_SQ_FT = 144;

/**
 * How far the file's own SFT may sit from the recomputed value before we say so.
 *
 * 0.01 sqft, ABSOLUTE — not a percentage.
 *
 * Every SFT in the verified sample is the exact product rounded to two decimals
 * (25 x 4 x 40 / 144 = 27.7778 is written 27.78), so the largest discrepancy a
 * correctly-built file can produce is 0.005. 0.01 is exactly twice that and
 * nothing more, which makes it the tightest threshold that never fires on a
 * clean file. A 0.5% relative tolerance would have allowed 2.42 sqft of drift on
 * the 484.38 row — enough to hide a manager changing a Width from 22.5 to 22.6
 * (0.44%) and not updating the SFT beside it, which is precisely the mistake
 * this check exists to catch.
 *
 * The cost of being tight is a noisy-but-harmless warning list if a future
 * template stores SFT to one decimal. It is a warning: it never rejects the
 * upload and never changes a number.
 */
export const SFT_TOLERANCE_SQFT = 0.01;

/** How many rows from the top we will look through for the header row. */
const HEADER_SCAN_LIMIT = 25;

export interface FlatSheetRow {
  /**
   * The row number the manager sees. Taken from the sheet's own index column
   * when it has one, otherwise the 1-based position among the data rows.
   *
   * THIS MUST SURVIVE. The sample has 43 x 22.5 twice, 43 x 4 twice, 61 x 22.5
   * three times and 61 x 4 three times; without the row number the supervisor
   * cannot tell row 11 from row 13 when he goes to put a sink on one of them.
   */
  rowNumber: number;
  /** 1-based physical row in the sheet, as Excel numbers it. For "show me the row" UI. */
  sheetRow: number;
  /** Inches. */
  lengthIn: number;
  /** Inches. */
  widthIn: number;
  quantity: number;
  /**
   * Square feet, RECOMPUTED as lengthIn x widthIn x quantity / 144 and rounded
   * to 2dp. Never the value read from the file — see checkSft below.
   */
  totalSqft: number;
  /** The SFT the file claimed, or null when the sheet has no SFT column. */
  fileSqft: number | null;
}

export interface SkippedRow {
  rowNumber: number;
  sheetRow: number;
  lengthIn: number;
  widthIn: number;
  reason: "ZERO_QTY";
}

export interface FlatSheetTotals {
  /** Live rows kept (Qty > 0). */
  rowCount: number;
  /** Sum of Qty over the kept rows. */
  totalPieces: number;
  /** Sum of the recomputed per-row SFT, 2dp. */
  totalSqft: number;
}

export interface FlatSheetParseResult {
  rows: FlatSheetRow[];
  /**
   * Rows the file contained and this parser did not keep, because Qty was 0.
   * Handed back rather than dropped: 6 of the sample's 23 rows are Qty 0, and a
   * manager who uploads 23 rows and is shown 17 with no explanation reasonably
   * concludes the upload lost his data.
   */
  skippedZeroQtyRows: SkippedRow[];
  totals: FlatSheetTotals;
  /** Non-empty means the upload is rejected. Every problem found, not just the first. */
  errors: string[];
  /** Non-empty means "look at this", not "stop". */
  warnings: string[];
}

/* -- Header vocabulary ------------------------------------------------------ */

/** Lowercase, collapse every run of non-alphanumerics to one space, trim.
 *  "Length (in)" -> "length in", "Sr. No." -> "sr no", "#" -> "". */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Spelling, case and punctuation vary between whoever last saved the file, so
// match a vocabulary rather than an exact string. "depth" is here because the
// old Drawing Summary called the second dimension Depth and the habit will
// outlive the template.
const LENGTH_HEADERS = new Set([
  "length", "length in", "length inch", "length inches", "length inchs",
  "len", "l", "l in", "lenght", "lenght in",
]);

const WIDTH_HEADERS = new Set([
  "width", "width in", "width inch", "width inches", "width inchs",
  "wid", "w", "w in", "breadth", "bredth", "depth", "depth in", "widht",
]);

const QTY_HEADERS = new Set([
  "qty", "qty nos", "qty pcs", "quantity", "qnty", "qnty nos", "qtty",
  "nos", "no of pcs", "no of pieces", "number of pieces", "pcs", "pieces",
  "total pcs", "total pieces", "pc", "count",
]);

// Deliberately NOT "area" on its own: the old template used an Area column for
// the room name, and a text column silently matched as SFT would produce a
// mismatch warning on every single row.
const SFT_HEADERS = new Set([
  "sft", "sfts", "sq ft", "sqft", "sq feet", "square feet", "square foot",
  "total sft", "total sqft", "total sq ft", "area sft", "area sqft", "sft total",
]);

// The leading row-number column. "" is in the set on purpose: an unnamed first
// column carrying 1..23 is the commonest shape of this sheet.
const INDEX_HEADERS = new Set([
  "", "sr", "sr no", "srno", "s no", "sno", "sl", "sl no", "slno",
  "serial", "serial no", "no", "row", "row no", "s", "item", "item no",
]);

interface ColumnMap {
  length: number;
  width: number;
  quantity: number;
  sft: number;
  index: number;
}

const NO_COLUMN = -1;

function mapHeaderRow(cells: unknown[]): ColumnMap {
  const cols: ColumnMap = {
    length: NO_COLUMN, width: NO_COLUMN, quantity: NO_COLUMN,
    sft: NO_COLUMN, index: NO_COLUMN,
  };
  for (let c = 0; c < cells.length; c++) {
    const h = normalizeHeader(cells[c]);
    // First match wins for each field: a sheet that repeats a header keeps its
    // leftmost column rather than silently switching to the rightmost.
    if (cols.length === NO_COLUMN && LENGTH_HEADERS.has(h)) { cols.length = c; continue; }
    if (cols.width === NO_COLUMN && WIDTH_HEADERS.has(h)) { cols.width = c; continue; }
    if (cols.quantity === NO_COLUMN && QTY_HEADERS.has(h)) { cols.quantity = c; continue; }
    if (cols.sft === NO_COLUMN && SFT_HEADERS.has(h)) { cols.sft = c; continue; }
    // Only column 0 may be the unnamed index column — an empty header anywhere
    // else is just an empty header.
    if (cols.index === NO_COLUMN && INDEX_HEADERS.has(h) && (h !== "" || c === 0)) cols.index = c;
  }
  return cols;
}

/* -- Cell reading ----------------------------------------------------------- */

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** A number, or null if the cell is empty or is not one. Tolerates thousands
 *  separators ("1,060") because Excel hands those back as text often enough. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(/,/g, "");
  if (text === "") return null;
  // Plain decimal only. "25 in", "N/A" and "" are not dimensions, and turning
  // them into 0 (what the old parser's parseFloat(...) || 0 did) is how a piece
  // silently becomes zero-area.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* -- The parser ------------------------------------------------------------- */

/**
 * Read the flat piece list out of a sheet already flattened to a cell matrix
 * (row-major, `matrix[r][c]`, exactly what xlsx's `sheet_to_json({header:1})`
 * produces).
 *
 * Rules, all of them load-bearing:
 *  - SFT is RECOMPUTED from Length x Width x Qty / 144. The file's SFT is only
 *    ever compared, never used, and a disagreement beyond SFT_TOLERANCE_SQFT is
 *    a warning naming the row — not an overwrite and not a rejection.
 *  - Qty 0 rows are skipped and handed back in `skippedZeroQtyRows`.
 *  - Repeated (Length, Width) pairs stay SEPARATE rows. Nothing is ever merged;
 *    two 43 x 22.5 rows are two lines the supervisor allocates independently.
 *  - Non-numeric or negative Length/Width/Qty, a missing required column, or an
 *    empty sheet are errors, and the upload is refused with every offending row
 *    named at once.
 */
export function parseFlatSheet(matrix: unknown[][]): FlatSheetParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: FlatSheetRow[] = [];
  const skippedZeroQtyRows: SkippedRow[] = [];

  const empty: FlatSheetTotals = { rowCount: 0, totalPieces: 0, totalSqft: 0 };
  const fail = (message: string): FlatSheetParseResult => ({
    rows: [], skippedZeroQtyRows, totals: empty, errors: [message], warnings,
  });

  const grid = Array.isArray(matrix) ? matrix : [];
  const hasAnyCell = grid.some(row => Array.isArray(row) && row.some(cell => cellText(cell) !== ""));
  if (!hasAnyCell) {
    return fail("The sheet is empty — there is nothing to read. Upload the piece list with its Length, Width, Qty and SFT columns.");
  }

  /* Header row: the first row that names all three required columns. If none
     does, keep the best partial match so we can say what is missing rather than
     "could not find the header". */
  let headerRowIndex = -1;
  let columns: ColumnMap | null = null;
  let bestPartial: { rowIndex: number; cols: ColumnMap; score: number } | null = null;

  const scanLimit = Math.min(grid.length, HEADER_SCAN_LIMIT);
  for (let r = 0; r < scanLimit; r++) {
    const cells = Array.isArray(grid[r]) ? grid[r] : [];
    const cols = mapHeaderRow(cells);
    const score =
      (cols.length !== NO_COLUMN ? 1 : 0) +
      (cols.width !== NO_COLUMN ? 1 : 0) +
      (cols.quantity !== NO_COLUMN ? 1 : 0);
    if (score === 3) { headerRowIndex = r; columns = cols; break; }
    if (score > 0 && (!bestPartial || score > bestPartial.score)) {
      bestPartial = { rowIndex: r, cols, score };
    }
  }

  if (!columns) {
    if (bestPartial) {
      const missing = [
        bestPartial.cols.length === NO_COLUMN ? "Length" : null,
        bestPartial.cols.width === NO_COLUMN ? "Width" : null,
        bestPartial.cols.quantity === NO_COLUMN ? "Qty" : null,
      ].filter((m): m is string => m !== null);
      return fail(
        `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        `The sheet needs a header row with Length, Width and Qty (SFT is optional — it is recalculated).`,
      );
    }
    return fail(
      "Could not find a header row. The sheet needs a row naming Length, Width and Qty before the piece rows.",
    );
  }

  if (columns.sft === NO_COLUMN) {
    warnings.push("No SFT column found — SFT was calculated from Length × Width × Qty ÷ 144 for every row.");
  }

  const dataRows = grid.slice(headerRowIndex + 1);
  if (!dataRows.length) {
    return fail("The header row is the last row — there are no piece rows below it.");
  }

  let ordinal = 0;
  let sawAnyDataRow = false;

  for (let i = 0; i < dataRows.length; i++) {
    const cells = Array.isArray(dataRows[i]) ? dataRows[i] : [];
    const sheetRow = headerRowIndex + 1 + i + 1; // 1-based, as Excel numbers rows

    const lengthCell = cells[columns.length];
    const widthCell = cells[columns.width];
    const qtyCell = cells[columns.quantity];

    // A row with no dimensions at all is padding or a totals line ("Total |  |
    // | 1060 | 3548.61"), not a piece. Skip it without comment — complaining
    // about the totals row on every upload trains people to ignore warnings.
    if (cellText(lengthCell) === "" && cellText(widthCell) === "") continue;

    sawAnyDataRow = true;
    ordinal += 1;

    // The file's own number if it has one, and only if it reads as a positive
    // whole number; otherwise count the data rows ourselves.
    const indexValue = columns.index !== NO_COLUMN ? toNumber(cells[columns.index]) : null;
    const rowNumber =
      indexValue !== null && Number.isInteger(indexValue) && indexValue > 0 ? indexValue : ordinal;

    const lengthIn = toNumber(lengthCell);
    const widthIn = toNumber(widthCell);
    const quantity = toNumber(qtyCell);

    let rowFailed = false;
    const reject = (message: string) => { errors.push(`Row ${rowNumber}: ${message}`); rowFailed = true; };

    if (lengthIn === null) reject(`Length "${cellText(lengthCell)}" is not a number.`);
    else if (lengthIn < 0) reject(`Length is negative (${lengthIn}).`);

    if (widthIn === null) reject(`Width "${cellText(widthCell)}" is not a number.`);
    else if (widthIn < 0) reject(`Width is negative (${widthIn}).`);

    if (quantity === null) reject(`Qty "${cellText(qtyCell)}" is not a number.`);
    else if (quantity < 0) reject(`Qty is negative (${quantity}).`);
    else if (!Number.isInteger(quantity)) reject(`Qty must be a whole number of pieces (got ${quantity}).`);

    if (rowFailed) continue;

    // Non-null past the guards above.
    const l = lengthIn as number;
    const w = widthIn as number;
    const q = quantity as number;

    if (q === 0) {
      skippedZeroQtyRows.push({ rowNumber, sheetRow, lengthIn: l, widthIn: w, reason: "ZERO_QTY" });
      continue;
    }

    // Only now do zero dimensions matter: a live row that asks for 40 pieces of
    // 0 x 22.5 is a broken row, while a 0-qty row with real dimensions is just
    // a line the manager zeroed out.
    if (l === 0) { errors.push(`Row ${rowNumber}: Length is 0 but Qty is ${q}.`); continue; }
    if (w === 0) { errors.push(`Row ${rowNumber}: Width is 0 but Qty is ${q}.`); continue; }

    const computedSqft = (l * w * q) / SQ_IN_PER_SQ_FT;
    const fileSqft = columns.sft !== NO_COLUMN ? toNumber(cells[columns.sft]) : null;

    if (fileSqft !== null && Math.abs(fileSqft - computedSqft) > SFT_TOLERANCE_SQFT) {
      warnings.push(
        `Row ${rowNumber}: SFT in the file is ${round2(fileSqft)} but ${l} × ${w} × ${q} ÷ 144 = ` +
        `${round2(computedSqft)}. The calculated value was used — check whether the dimensions or the SFT is the stale one.`,
      );
    }

    // NEVER merged with an identical earlier row. The sample carries 43 × 22.5
    // twice and 61 × 22.5 three times, and they are different lines of work.
    rows.push({
      rowNumber, sheetRow,
      lengthIn: l, widthIn: w, quantity: q,
      totalSqft: round2(computedSqft),
      fileSqft,
    });
  }

  if (skippedZeroQtyRows.length) {
    const numbers = skippedZeroQtyRows.map(r => r.rowNumber).join(", ");
    warnings.push(
      `${skippedZeroQtyRows.length} row${skippedZeroQtyRows.length === 1 ? "" : "s"} had Qty 0 and ` +
      `${skippedZeroQtyRows.length === 1 ? "was" : "were"} skipped: row ${numbers}.`,
    );
  }

  if (errors.length) {
    return { rows: [], skippedZeroQtyRows, totals: empty, errors, warnings };
  }

  if (!sawAnyDataRow) {
    return fail("The header row is the last row — there are no piece rows below it.");
  }

  if (!rows.length) {
    return {
      rows: [], skippedZeroQtyRows, totals: empty, warnings,
      errors: [
        skippedZeroQtyRows.length
          ? `Every row has Qty 0 — there is nothing to fabricate. ${skippedZeroQtyRows.length} row(s) were read and all of them were empty of pieces.`
          : "No piece rows were found below the header row.",
      ],
    };
  }

  const totals: FlatSheetTotals = {
    rowCount: rows.length,
    totalPieces: rows.reduce((s, r) => s + r.quantity, 0),
    totalSqft: round2(rows.reduce((s, r) => s + r.totalSqft, 0)),
  };

  return { rows, skippedZeroQtyRows, totals, errors, warnings };
}

/**
 * How a parsed row's number is written onto the requirement it becomes.
 *
 * The flat sheet has no drawing number and no piece label, and this change adds
 * exactly one column to fab_requirement (sink_quantity) — so the row number
 * rides in the existing `piece_label`, which is what describeRequirement() and
 * the slab-allocation board already display. "Row 11" rather than "11" because
 * both of those render it as "piece <label>".
 */
export function flatRowLabel(rowNumber: number): string {
  return `Row ${rowNumber}`;
}
