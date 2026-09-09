// Fill templates/commercial/export-docs-template.xlsx from the ERP's data.
//
// ─────────────────────────── FIDELITY, MEASURED ──────────────────────────────
//
// exceljs 4.4 round-trips this workbook without loss. Loading the template and
// writing it straight back out gives, per sheet, identical formula counts,
// identical merged ranges, identical print areas, both embedded images (2 media
// entries in, 2 out) and the hidden state of "Invoice (R)". Verified by
// tests/commercialExportWorkbook.test.ts, which does exactly that comparison on
// every build. Nothing in this file relies on hand-repairing what the library
// drops, because it drops nothing here.
//
// Two things exceljs does NOT do, and this file works around:
//
//   1. It does not adjust formulas, merges or print areas when rows are
//      spliced. So NOTHING here splices rows. The tables are laid out at
//      computed row numbers and the handful of cells that point into them are
//      re-pointed by hand (mapping.ts SUMMARY_LINKS). A shipment with more
//      slabs than the template's 60-row well pushes the summary block down and
//      everything still refers to the right place.
//
//   2. It writes formulas with no cached result, so a freshly built file shows
//      zeros until Excel recalculates. `calcProperties.fullCalcOnLoad = true`
//      below makes Excel recalculate the moment the file opens. A viewer that
//      ignores that flag (Google Sheets' quick preview, some phone viewers)
//      will show empty formula cells; Excel, LibreOffice and Numbers do not.
//
// One deliberate change of formula CLASS, documented so nobody reads it as a
// bug: the summary block's slab count and SQFT total used COUNTIF/SUMIF over
// the batch column alone, which double-counts the moment one colour arrives in
// two batches. They are rebuilt as SUMPRODUCT over colour AND thickness — the
// grouping the ERP actually uses. See mapping.ts SUMMARY_TABLE.
//
// And one repair: "Invoice (R)" is stale in the source — invoice PESPL/1891 of
// 04/09/2025 to Universal Stone LLC against PI 00381, an expired LUT, a C&F
// freight/duty cost block and eight formulas reading ='Measmt List'!#REF!. It
// is an OUTPUT sheet, so writeInvoiceR below fills its header from the same
// roots the Invoice uses (mapping.ts INVOICE_R_MIRRORS), re-points its
// cross-wired consignee and notify blocks at the Invoice (INVOICE_R_LINKS) and
// clears what has no ERP source (INVOICE_R_CLEARED). Nothing of the previous
// customer survives a build; tests/commercialExportWorkbook.test.ts scans the
// whole output for their identifiers.
//
// Rates: the template prices a SQMT quantity from a per-SQFT rate parked in a
// helper column — Invoice!I38 is =+L38*10.764, with L38 the ratePerSqft root.
// Rebuilt rows 2..n do the same (their own per-SQFT rate goes into L39, L40 …),
// so a second design cannot be invoiced at its per-SQFT rate against a
// quantity in square metres. See writeItemRows.

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import {
  ROOT_CELLS, SLAB_TABLE, SUMMARY_TABLE, SUMMARY_LINKS, PACKING_ROWS, INVOICE_ROWS,
  PL852_TABLE, INVOICE_R_MIRRORS, INVOICE_R_LINKS, INVOICE_R_CLEARED, PARKED_ADDRESS_BLOCK,
  SQFT_PER_SQM, isCountUnit, rootCell, kgFromMt,
  type SlabRow, type CrateRow, type RootCell,
} from "./mapping.ts";

export const TEMPLATE_RELATIVE_PATH = "templates/commercial/export-docs-template.xlsx";

export interface BuildExportWorkbookInput {
  /** mapping.ts ROOT_CELLS keyed by `key`. Unknown keys are ignored. */
  roots: Record<string, unknown>;
  /** One row per packed slab, in print order, already grouped by crate. */
  slabs: SlabRow[];
  /** The goods lines the invoice and packing sheets print. */
  crateRows: CrateRow[];
}

export interface WorkbookLayout {
  slabFirstRow: number;
  slabLastRow: number;
  crateSubtotalRows: number[];
  measmtTotalRow: number;
  summaryHeaderRow: number;
  summaryFirstRow: number;
  summaryRowCount: number;
  summaryTotalRow: number;
  summaryFooterRows: number[];
  measmtLastRow: number;
  pl852LastRow: number;
}

// ────────────────────────────── small helpers ────────────────────────────────

type Ws = ExcelJS.Worksheet;
type Cell = ExcelJS.Cell;

function cellAt(ws: Ws, col: string, row: number): Cell {
  return ws.getCell(`${col}${row}`);
}

function setText(ws: Ws, col: string, row: number, v: unknown): void {
  const c = cellAt(ws, col, row);
  c.value = v === null || v === undefined || v === "" ? null : String(v);
}

function setNumber(ws: Ws, col: string, row: number, v: unknown): void {
  const n = typeof v === "number" ? v : Number(v);
  cellAt(ws, col, row).value = Number.isFinite(n) ? n : null;
}

/** Empty, not zero. `setNumber(…, null)` would write 0 — Number(null) is 0. */
function setBlank(ws: Ws, col: string, row: number): void {
  cellAt(ws, col, row).value = null;
}

function setFormula(ws: Ws, col: string, row: number, formula: string): void {
  cellAt(ws, col, row).value = { formula, date1904: false } as ExcelJS.CellFormulaValue;
}

function clearCells(ws: Ws, cols: string[], firstRow: number, lastRow: number): void {
  for (let r = firstRow; r <= lastRow; r++) {
    for (const c of cols) cellAt(ws, c, r).value = null;
  }
}

/** A deep-enough copy of a row's per-column styles, taken before the region is
 *  rewritten, so a subtotal row landing where a slab row used to be still looks
 *  like a subtotal row. */
type RowStyle = { height: number | undefined; cells: Record<string, ExcelJS.Style> };

function snapshotRowStyle(ws: Ws, row: number, cols: string[]): RowStyle {
  const cells: Record<string, ExcelJS.Style> = {};
  for (const c of cols) cells[c] = JSON.parse(JSON.stringify(cellAt(ws, c, row).style)) as ExcelJS.Style;
  return { height: ws.getRow(row).height, cells };
}

function applyRowStyle(ws: Ws, row: number, style: RowStyle, cols: string[]): void {
  if (style.height !== undefined) ws.getRow(row).height = style.height;
  for (const c of cols) {
    const s = style.cells[c];
    if (s) cellAt(ws, c, row).style = JSON.parse(JSON.stringify(s)) as ExcelJS.Style;
  }
}

function setPrintArea(ws: Ws, area: string): void {
  ws.pageSetup = { ...(ws.pageSetup ?? {}), printArea: area };
}

/** Every merged range on the sheet that starts inside [first, last]. */
function mergesInRows(ws: Ws, first: number, last: number): string[] {
  const model = ws.model as unknown as { merges?: string[] };
  const all = Array.isArray(model.merges) ? model.merges : [];
  return all.filter((m) => {
    const rowMatch = m.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/);
    if (!rowMatch) return false;
    const top = Number(rowMatch[1]);
    return top >= first && top <= last;
  });
}

function unmerge(ws: Ws, range: string): void {
  try { ws.unMergeCells(range); } catch { /* already unmerged — fine */ }
}

function merge(ws: Ws, range: string): void {
  try { ws.mergeCells(range); } catch { /* overlapping — leave the sheet as is */ }
}

/** A YYYY-MM-DD (or ISO) string to a UTC-midnight Date, for a date cell. */
function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ────────────────────────────── the root cells ───────────────────────────────

export function writeRoots(wb: ExcelJS.Workbook, roots: Record<string, unknown>): number {
  let written = 0;
  for (const rc of ROOT_CELLS) {
    if (!(rc.key in roots)) continue;
    const ws = wb.getWorksheet(rc.sheet);
    if (!ws) continue;
    writeRootCell(ws, rc, roots[rc.key]);
    written += 1;
  }
  return written;
}

function writeRootCell(ws: Ws, rc: RootCell, value: unknown): void {
  const cell = ws.getCell(rc.cell);
  if (value === null || value === undefined || value === "") { cell.value = null; return; }
  if (rc.kind === "number") {
    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    cell.value = Number.isFinite(n) ? n : null;
    return;
  }
  if (rc.kind === "date") {
    const d = asDate(value);
    cell.value = d ?? String(value);
    return;
  }
  cell.value = String(value);
}

// ───────────────────────── the measurement list ──────────────────────────────

/** Slabs grouped by crate, crates in the order they first appear. */
export function crateGroups(slabs: SlabRow[]): Array<{ crateNo: number; slabs: SlabRow[] }> {
  const order: number[] = [];
  const by = new Map<number, SlabRow[]>();
  for (const s of slabs) {
    const n = Number.isFinite(s.crateNo) ? s.crateNo : 0;
    if (!by.has(n)) { by.set(n, []); order.push(n); }
    by.get(n)!.push(s);
  }
  return order.map((n) => ({ crateNo: n, slabs: by.get(n)! }));
}

const ML_COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

function writeMeasmtList(wb: ExcelJS.Workbook, slabs: SlabRow[], crateRows: CrateRow[]): WorkbookLayout {
  const ws = wb.getWorksheet(SLAB_TABLE.sheet);
  if (!ws) throw new Error(`Template has no sheet "${SLAB_TABLE.sheet}"`);

  const pat = SLAB_TABLE.patternRows;
  const styles = {
    crateFirst: snapshotRowStyle(ws, pat.crateFirstSlab, ML_COLS),
    slab: snapshotRowStyle(ws, pat.slab, ML_COLS),
    subtotal: snapshotRowStyle(ws, pat.subtotal, ML_COLS),
    blank: snapshotRowStyle(ws, pat.blank, ML_COLS),
    total: snapshotRowStyle(ws, pat.total, ML_COLS),
    summaryHeader: snapshotRowStyle(ws, SUMMARY_TABLE.templateHeaderRow, ML_COLS),
    summaryRow: snapshotRowStyle(ws, SUMMARY_TABLE.templateFirstRow, ML_COLS),
    summaryTotal: snapshotRowStyle(ws, SUMMARY_TABLE.templateTotalRow, ML_COLS),
    footer: snapshotRowStyle(ws, SUMMARY_TABLE.templateFooterRows[0], ML_COLS),
  };

  // Clear the whole well, the summary and the footer — everything below the
  // column headers. Styles survive a null value, and are re-applied per row.
  const oldLast = Math.max(ws.rowCount, SUMMARY_TABLE.templateFooterRows[1]);
  clearCells(ws, ML_COLS, SLAB_TABLE.firstRow, oldLast);

  const groups = crateGroups(slabs);
  const col = SLAB_TABLE.columns;
  const subtotalRows: number[] = [];
  let row = SLAB_TABLE.firstRow;
  let sl = 1;

  for (const g of groups) {
    const blockFirst = row;
    for (const s of g.slabs) {
      const first = row === blockFirst;
      applyRowStyle(ws, row, first ? styles.crateFirst : styles.slab, ML_COLS);
      setNumber(ws, col.sl, row, sl);
      setText(ws, col.sku, row, s.sku);
      setText(ws, col.batch, row, s.batch);
      setText(ws, col.slabNo, row, s.slabNo);
      setText(ws, col.thick, row, s.thick);
      setNumber(ws, col.lengthCm, row, s.lengthCm);
      setNumber(ws, col.widthCm, row, s.widthCm);
      // The area column stays a formula: the sheet must recompute if somebody
      // corrects a measurement by hand on the floor copy.
      setFormula(ws, col.sqm, row, SLAB_TABLE.areaFormula(row));
      setText(ws, col.crateNo, row, String(g.crateNo).padStart(2, "0"));
      sl += 1;
      row += 1;
    }
    const blockLast = row - 1;
    applyRowStyle(ws, row, styles.subtotal, ML_COLS);
    setFormula(ws, SLAB_TABLE.subtotalStyle.column, row, SLAB_TABLE.subtotalStyle.formula(blockFirst, blockLast));
    subtotalRows.push(row);
    row += 1;
    for (let i = 0; i < SLAB_TABLE.subtotalStyle.gapRows; i++) { applyRowStyle(ws, row, styles.blank, ML_COLS); row += 1; }
  }

  const slabFirstRow = SLAB_TABLE.firstRow;
  const slabLastRow = subtotalRows.length ? subtotalRows[subtotalRows.length - 1] : SLAB_TABLE.firstRow;

  const measmtTotalRow = row;
  applyRowStyle(ws, measmtTotalRow, styles.total, ML_COLS);
  setText(ws, SLAB_TABLE.totalRow.labelColumn, measmtTotalRow, SLAB_TABLE.totalRow.label);
  // SUM over slabs AND their subtotals, halved — the template's own idiom, and
  // the reason a crate subtotal may sit inside the summed range.
  setFormula(ws, SLAB_TABLE.totalRow.column, measmtTotalRow, SLAB_TABLE.totalRow.formula(slabFirstRow, slabLastRow));

  // ── the summary block ──────────────────────────────────────────────────────
  const summaryHeaderRow = measmtTotalRow + 2;
  applyRowStyle(ws, summaryHeaderRow, styles.summaryHeader, ML_COLS);
  for (const [c, text] of Object.entries(SUMMARY_TABLE.headers)) setText(ws, c, summaryHeaderRow, text);

  const summaryFirstRow = summaryHeaderRow + 1;
  const sc = SUMMARY_TABLE.columns;
  crateRows.forEach((line, i) => {
    const r = summaryFirstRow + i;
    applyRowStyle(ws, r, styles.summaryRow, ML_COLS);
    setNumber(ws, sc.sl, r, i + 1);
    setText(ws, sc.colour, r, line.description);
    setText(ws, sc.thick, r, line.thick);
    setText(ws, sc.batch, r, line.batch ?? "");
    setNumber(ws, sc.netWeight, r, line.netWeight);
    setNumber(ws, sc.crates, r, line.crates ?? 0);
    if (line.isSample || slabs.length === 0) {
      // No slab rows to sum: the sample line's figures are typed, not derived.
      setNumber(ws, sc.slabs, r, line.slabs);
      if (isCountUnit(line.unit)) {
        // "8 NOS" is eight boxes, not eight square metres. The count is already
        // in the Slabs/Pcs column; the area columns stay empty so the sheet does
        // not declare an area it does not have and the Total row — a plain SUM —
        // leaves the pieces out of the shipment's SQFT and SQMT.
        setBlank(ws, sc.sqft, r);
        setBlank(ws, sc.sqmt, r);
      } else {
        setNumber(ws, sc.sqft, r, Math.round(line.qty * SQFT_PER_SQM * 1000) / 1000);
        setNumber(ws, sc.sqmt, r, line.qty);
      }
    } else {
      setFormula(ws, sc.slabs, r, SUMMARY_TABLE.countFormula(slabFirstRow, slabLastRow, r));
      setFormula(ws, sc.sqft, r, SUMMARY_TABLE.sqftFormula(slabFirstRow, slabLastRow, r));
      setFormula(ws, sc.sqmt, r, SUMMARY_TABLE.sqmtFormula(r));
    }
  });

  const summaryRowCount = crateRows.length;
  const summaryLastRow = summaryFirstRow + Math.max(summaryRowCount, 1) - 1;
  const summaryTotalRow = summaryFirstRow + Math.max(summaryRowCount, 1);
  applyRowStyle(ws, summaryTotalRow, styles.summaryTotal, ML_COLS);
  setText(ws, sc.thick, summaryTotalRow, "Total");
  for (const c of [sc.slabs, sc.sqft, sc.netWeight, sc.sqmt]) {
    setFormula(ws, c, summaryTotalRow, SUMMARY_TABLE.totalFormula(c, summaryFirstRow, summaryLastRow));
  }

  const summaryFooterRows = [summaryTotalRow + 1, summaryTotalRow + 2];
  summaryFooterRows.forEach((r, i) => {
    applyRowStyle(ws, r, styles.footer, ML_COLS);
    setFormula(ws, "A", r, SUMMARY_TABLE.footerFormulas[i]);
  });

  const measmtLastRow = summaryFooterRows[1];
  setPrintArea(ws, `A1:${ML_COLS[ML_COLS.length - 1]}${measmtLastRow}`);

  return {
    slabFirstRow, slabLastRow, crateSubtotalRows: subtotalRows, measmtTotalRow,
    summaryHeaderRow, summaryFirstRow, summaryRowCount, summaryTotalRow,
    summaryFooterRows, measmtLastRow, pl852LastRow: 0,
  };
}

// ───────────────── the goods lines on the invoice / packing sheets ───────────

function writeItemRows(wb: ExcelJS.Workbook, crateRows: CrateRow[], layout: WorkbookLayout, roots: Record<string, unknown>): void {
  const ml = SLAB_TABLE.sheet;
  for (const spec of PACKING_ROWS) {
    const ws = wb.getWorksheet(spec.sheet);
    if (!ws) continue;
    const capacity = spec.lastRow - spec.firstRow + 1;
    if (crateRows.length > capacity) {
      throw new Error(
        `The ${spec.sheet} sheet has room for ${capacity} goods lines and this invoice has ${crateRows.length}. ` +
        `Split the shipment across invoices, or widen the block in mapping.ts PACKING_ROWS.`,
      );
    }
    const cols = spec.columns;
    // Column B is vertically merged across the goods block on several sheets,
    // so only its first row is ever written and it is never cleared.
    const clearable = [cols.colour, cols.thick, cols.netWeight, cols.slabs, cols.qty, cols.unit, cols.rate, cols.amount]
      .filter((c): c is string => Boolean(c));
    clearCells(ws, clearable, spec.firstRow, spec.lastRow);
    // The first row's marks cell is either a root cell (Invoice) or written
    // below; only the rows under it are cleared.
    if (cols.marks) clearCells(ws, [cols.marks], spec.firstRow + 1, spec.lastRow);
    // The per-SQFT helper column, everywhere except line 1 — that cell is the
    // `ratePerSqft` ROOT and writeRoots has already filled it. Lines 2..n are
    // written below; anything left from the template must go first so a stale
    // rate cannot be picked up by a row that is no longer the row it belonged to.
    if (spec.ratePerSqftColumn) clearCells(ws, [spec.ratePerSqftColumn], spec.firstRow + 1, spec.lastRow);

    crateRows.forEach((line, k) => {
      const r = spec.firstRow + k;
      const countLine = isCountUnit(line.unit);
      if (spec.source === "summary") {
        const sr = layout.summaryFirstRow + k;
        const sc = SUMMARY_TABLE.columns;
        setFormula(ws, cols.colour, r, `+'${ml}'!${sc.colour}${sr}`);
        setFormula(ws, cols.thick, r, `+'${ml}'!${sc.thick}${sr}`);
        setFormula(ws, cols.netWeight, r, `+'${ml}'!${sc.netWeight}${sr}`);
        setFormula(ws, cols.slabs, r, `+'${ml}'!${sc.slabs}${sr}`);
        setFormula(ws, cols.qty, r, `+'${ml}'!${sc.sqmt}${sr}`);
        // The unit label: the summary block's own SQMT header, copied down the
        // way the template copies it — except for a line counted in pieces,
        // which says so, and which therefore cannot be the row copied from.
        if (countLine) setText(ws, cols.unit, r, line.unit);
        else if (k === 0 || isCountUnit(crateRows[0]?.unit)) setFormula(ws, cols.unit, r, `+'${ml}'!${sc.sqmt}${layout.summaryHeaderRow}`);
        else setFormula(ws, cols.unit, r, `+${cols.unit}${spec.firstRow}`);
        if (cols.rate) writeRate(ws, spec, r, k, line, countLine);
        if (cols.amount && cols.rate) {
          // Quantity × rate, both per SQMT — or pieces × rate per piece, which
          // is the only reading a NOS line has: it carries no area at all.
          const qtyCol = countLine ? cols.slabs : cols.qty;
          setFormula(ws, cols.amount, r, `+${qtyCol}${r}*${cols.rate}${r}`);
        }
        // Marks & packages: the Invoice's own two cells are root cells; the
        // other summary-sourced sheet copies them.
        if (spec.sheet !== "Invoice") {
          if (cols.marks && k === 0) setFormula(ws, cols.marks, r, `+Invoice!${INVOICE_ROWS.columns.marks}${INVOICE_ROWS.firstRow}`);
          if (cols.packages && k === 0) setFormula(ws, cols.packages, r, `+Invoice!${INVOICE_ROWS.columns.packages}${INVOICE_ROWS.firstRow}`);
        }
      } else {
        const ir = INVOICE_ROWS.firstRow + k;
        const ic = INVOICE_ROWS.columns;
        setFormula(ws, cols.colour, r, `+Invoice!${ic.colour}${ir}`);
        setFormula(ws, cols.thick, r, `+Invoice!${ic.thick}${ir}`);
        setFormula(ws, cols.netWeight, r, `+Invoice!${ic.netWeight}${ir}`);
        setFormula(ws, cols.slabs, r, `+Invoice!${ic.slabs}${ir}`);
        setFormula(ws, cols.qty, r, `+Invoice!${ic.qty}${ir}`);
        setFormula(ws, cols.unit, r, `+Invoice!${ic.unit}${ir}`);
        if (cols.rate && ic.rate) {
          const rateRef = `Invoice!${ic.rate}${ir}`;
          setFormula(ws, cols.rate, r, spec.rateInInr ? `+${rateRef}*Invoice!F57` : `+${rateRef}`);
        }
        if (cols.amount && cols.rate) {
          const qtyCol = countLine ? cols.slabs : cols.qty;
          setFormula(ws, cols.amount, r, `+${cols.rate}${r}*${qtyCol}${r}`);
        }
        if (cols.marks && k === 0) setFormula(ws, cols.marks, r, `+Invoice!${ic.marks}${ir}`);
        if (cols.packages && k === 0) setFormula(ws, cols.packages, r, `+Invoice!${ic.packages}${ir}`);
      }
    });

    // The totals row never moves; only the ranges it sums are rebuilt.
    const lastUsed = spec.firstRow + Math.max(crateRows.length, 1) - 1;
    for (const t of spec.totals) {
      if (t.kind === "sum") setFormula(ws, t.column, spec.totalRow, `SUM(${t.column}${spec.firstRow}:${t.column}${lastUsed})`);
      else setFormula(ws, t.column, spec.totalRow, `+${t.column}${spec.firstRow}`);
    }

    // "Less Discount" takes the free sample lines back off the total. The
    // template points it at the row ITS sample line sat on; the rebuilt block
    // puts them straight after the goods lines, wherever that is.
    if (spec.discountCell && cols.amount) {
      const firstSample = crateRows.findIndex((l) => l.isSample);
      const cell = ws.getCell(spec.discountCell);
      if (firstSample < 0) cell.value = 0;
      else {
        const from = spec.firstRow + firstSample;
        const to = spec.firstRow + crateRows.length - 1;
        cell.value = { formula: `-SUM(${cols.amount}${from}:${cols.amount}${to})`, date1904: false } as ExcelJS.CellFormulaValue;
      }
    }
  }

  const inv = wb.getWorksheet("Invoice");
  if (inv) {
    // C44 held a note under the samples line ('=Measmt List'!B77) that the
    // rebuilt summary block no longer has.
    if (INVOICE_ROWS.lastRow + 1 < INVOICE_ROWS.totalRow) cellAt(inv, "C", INVOICE_ROWS.lastRow + 1).value = null;
  }
  void roots;
}

/**
 * One goods row's rate, in the unit the row's quantity is in.
 *
 * The template quotes SQMT quantities but the business quotes rates per SQFT,
 * so the sheet parks the per-SQFT rate in a helper column and converts:
 * `Invoice!I38 = +L38*10.764`. Line 1's helper cell is the `ratePerSqft` root;
 * lines 2..n get their own, so every row converts the same way. Writing the
 * per-SQFT rate straight into the rate column instead — which is what this used
 * to do from line 2 down — prices a square-metre quantity at a square-foot
 * rate and under-invoices the line by a factor of 10.764.
 *
 * A sheet with no helper column of its own ("Invoice (R)", whose column L is a
 * leftover text formula) reads the Invoice's finished rate.
 *
 * Only the SLAB lines convert. A sample line's rate is whatever the invoice
 * quoted it at — per piece for a NOS line, per SQMT for the reference
 * shipment's 400 pieces of 4in x 4in at 1.00 — and the template writes it as a
 * plain literal (I43 = 1, not =+L43*10.764). Converting it would invent a
 * price the invoice never quoted.
 */
function writeRate(ws: Ws, spec: (typeof PACKING_ROWS)[number], row: number, k: number, line: CrateRow, countLine: boolean): void {
  const rateCol = spec.columns.rate!;
  const helper = spec.ratePerSqftColumn;
  if (!helper) {
    setFormula(ws, rateCol, row, `+Invoice!${INVOICE_ROWS.columns.rate}${INVOICE_ROWS.firstRow + k}`);
    return;
  }
  if (countLine || line.isSample) {
    setBlank(ws, helper, row);
    setNumber(ws, rateCol, row, line.rate ?? 0);
    return;
  }
  // Line 1's helper cell is the root; do not overwrite what the user typed.
  if (k > 0) setNumber(ws, helper, row, line.rate ?? 0);
  setFormula(ws, rateCol, row, `+${helper}${row}*${SQFT_PER_SQM}`);
}

/**
 * "Invoice (R)" — the second invoice sheet the source workbook left filled in
 * from another customer's shipment.
 *
 * Its header is hand-typed literals that nothing pulls, so a build used to
 * leave PESPL/1891, PI 00381, Universal Stone LLC, 4806 Rozzelles Ferry Rd and
 * an LUT that expired on 31.03.2024 sitting on the file the ERP hands out. Each
 * of those cells is now written from the SAME root the Invoice's own cell gets
 * (so there is one field in the form, not two that can disagree), its
 * cross-wired consignee / notify blocks read the Invoice, and what has no ERP
 * source at all is cleared.
 *
 * Called after the goods rows, so nothing it clears can undo them.
 */
function writeInvoiceR(wb: ExcelJS.Workbook, roots: Record<string, unknown>): void {
  const ws = wb.getWorksheet("Invoice (R)");
  if (!ws) return;
  for (const m of INVOICE_R_MIRRORS) {
    const rc = rootCell(m.key);
    if (!rc) continue;
    // Written even when the root is missing: that clears the cell, and a blank
    // beats the last customer's name on this customer's invoice.
    writeRootCell(ws, { ...rc, cell: m.cell }, roots[m.key] ?? "");
  }
  for (const l of INVOICE_R_LINKS) {
    ws.getCell(l.cell).value = { formula: l.formula, date1904: false } as ExcelJS.CellFormulaValue;
  }
  for (const cell of INVOICE_R_CLEARED) ws.getCell(cell).value = null;
}

/** The address book of other customers parked off the Invoice's print area. */
function clearParkedAddresses(wb: ExcelJS.Workbook): void {
  const block = PARKED_ADDRESS_BLOCK;
  const ws = wb.getWorksheet(block.sheet);
  if (!ws) return;
  const keep = new Set(ROOT_CELLS.filter((rc) => rc.sheet === block.sheet).map((rc) => rc.cell));
  for (let r = block.firstRow; r <= block.lastRow; r++) {
    for (const c of block.columns) {
      if (keep.has(`${c}${r}`)) continue;
      cellAt(ws, c, r).value = null;
    }
  }
}

/** The strays that point into the summary block: re-point them where it went. */
function writeSummaryLinks(wb: ExcelJS.Workbook, layout: WorkbookLayout): void {
  const ml = SLAB_TABLE.sheet;
  for (const link of SUMMARY_LINKS) {
    const ws = wb.getWorksheet(link.sheet);
    if (!ws) continue;
    const row = link.target === "header" ? layout.summaryHeaderRow
      : link.target === "footer0" ? layout.summaryFooterRows[0]
      : layout.summaryFooterRows[1];
    ws.getCell(link.cell).value = { formula: `+'${ml}'!${link.column}${row}` } as ExcelJS.CellFormulaValue;
  }
}

// ─────────────────────────── the PL-852 slab sheet ───────────────────────────
//
// In the source workbook PL-852 is where the slabs were typed and "Measmt List"
// read them. The ERP writes Measmt List directly, so PL-852 would otherwise
// keep printing the previous shipment. It is rebuilt from the same slabs: one
// block per crate — label row, two merged header rows, the slabs, a TOTAL row.

const PL_COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

function writePl852(wb: ExcelJS.Workbook, slabs: SlabRow[], crateRows: CrateRow[], roots: Record<string, unknown>, layout: WorkbookLayout): number {
  const ws = wb.getWorksheet(PL852_TABLE.sheet);
  if (!ws) return 0;
  const T = PL852_TABLE;
  const col = T.columns;

  const styles = {
    label: snapshotRowStyle(ws, T.patternRows.crateLabel, PL_COLS),
    header1: snapshotRowStyle(ws, T.patternRows.header1, PL_COLS),
    header2: snapshotRowStyle(ws, T.patternRows.header2, PL_COLS),
    slab: snapshotRowStyle(ws, T.patternRows.slab, PL_COLS),
    total: snapshotRowStyle(ws, T.patternRows.total, PL_COLS),
    qty: snapshotRowStyle(ws, T.footer.templateQtySqmRow, PL_COLS),
    sumHeader: snapshotRowStyle(ws, T.footer.templateSummaryHeaderRow, PL_COLS),
    sumRow: snapshotRowStyle(ws, T.footer.templateSummaryFirstRow, PL_COLS),
    sumTotal: snapshotRowStyle(ws, T.footer.templateSummaryTotalRow, PL_COLS),
  };

  // Every merge from the first block row down has to go before anything is
  // written: exceljs resolves a write to a merged slave onto its master, so a
  // leftover merge would silently redirect a slab number into the wrong cell.
  const oldLast = Math.max(ws.rowCount, T.footer.templateEchoRows[1]);
  for (const m of mergesInRows(ws, T.firstBlockRow, oldLast)) unmerge(ws, m);
  clearCells(ws, PL_COLS, T.firstBlockRow, oldLast);

  const groups = crateGroups(slabs);
  let row = T.firstBlockRow;
  let sl = 1;
  const blockTotals: number[] = [];

  for (const g of groups) {
    applyRowStyle(ws, row, styles.label, PL_COLS);
    setText(ws, col.sl, row, `CRATE  # ${g.crateNo}`);
    row += 1;

    const h1 = row, h2 = row + 1;
    applyRowStyle(ws, h1, styles.header1, PL_COLS);
    applyRowStyle(ws, h2, styles.header2, PL_COLS);
    for (const [c, text] of Object.entries(T.headerTexts.row1)) setText(ws, c, h1, text);
    for (const [c, text] of Object.entries(T.headerTexts.row2)) setText(ws, c, h2, text);
    for (const c of T.headerMergeColumns) merge(ws, `${c}${h1}:${c}${h2}`);
    merge(ws, `${col.lengthCm}${h1}:${col.widthCm}${h1}`);
    row += 2;

    const blockFirst = row;
    g.slabs.forEach((s, i) => {
      applyRowStyle(ws, row, styles.slab, PL_COLS);
      setText(ws, col.sl, row, String(sl).padStart(2, "0"));
      setText(ws, col.colour, row, s.sku);
      setText(ws, col.batch, row, s.batch);
      setText(ws, col.slabNo, row, s.slabNo);
      setText(ws, col.thick, row, s.thick);
      setNumber(ws, col.lengthCm, row, s.lengthCm);
      setNumber(ws, col.widthCm, row, s.widthCm);
      setFormula(ws, col.sqft, row, T.areaFormula(row));
      // The sheet's weight column is per slab; the ERP holds a crate total, so
      // it is spread evenly and the crate's TOTAL row is what anyone reads.
      const perSlab = slabWeightKg(crateRows);
      if (perSlab !== null) setNumber(ws, col.weightKg, row, perSlab);
      if (i === Math.floor(g.slabs.length / 2)) {
        setText(ws, col.note, row, `${String(g.slabs.length).padStart(2, "0")} SLABS`);
      }
      sl += 1;
      row += 1;
    });
    const blockLast = row - 1;

    applyRowStyle(ws, row, styles.total, PL_COLS);
    setText(ws, col.lengthCm, row, "TOTAL");
    merge(ws, `${col.lengthCm}${row}:${col.widthCm}${row}`);
    setFormula(ws, col.sqft, row, T.totalFormula(blockFirst, blockLast));
    blockTotals.push(row);
    row += 1;
  }

  const blocksLastRow = row - 1;

  // ── footer: quantity lines, summary, the container / vehicle echoes ───────
  row += 1;
  // PL-852 prints kilos where the invoice prints "23.50 MT"; one weight, two
  // renderings, so the two sheets cannot disagree.
  const netKg = kgFromMt(roots["netWeightText"]);
  const grossKg = kgFromMt(roots["grossWeightText"]);

  const qtySftRow = row + 1;
  applyRowStyle(ws, row, styles.qty, PL_COLS);
  setText(ws, "A", row, "QUANTITY ( SQM)");
  merge(ws, `A${row}:F${row}`);
  setFormula(ws, "G", row, `G${qtySftRow}/10.764`);
  merge(ws, `G${row}:H${row}`);
  setText(ws, "I", row, netKg ? `${netKg}     (Kgs)` : "");
  row += 1;

  applyRowStyle(ws, row, styles.qty, PL_COLS);
  setText(ws, "A", row, "QUANTITY ( SFT)");
  merge(ws, `A${row}:F${row}`);
  setFormula(ws, "G", row, `SUM(${col.sqft}${T.firstBlockRow}:${col.sqft}${blocksLastRow})/2`);
  merge(ws, `G${row}:H${row}`);
  setText(ws, "I", row, netKg ? `${netKg}     (Kgs)` : "");
  row += 2;

  const sumHeaderRow = row;
  applyRowStyle(ws, sumHeaderRow, styles.sumHeader, PL_COLS);
  const heads: Record<string, string> = {
    A: "COLOR", C: "BATCH NO", D: "SLABS", E: "THICK", F: "SQM",
    G: "TOTAL    SFT", H: "NET            WEIGHT (Kgs)", I: "GROSS       WEIGHT (Kgs)",
  };
  for (const [c, t] of Object.entries(heads)) setText(ws, c, sumHeaderRow, t);
  merge(ws, `A${sumHeaderRow}:B${sumHeaderRow}`);
  row += 1;

  const sumFirstRow = row;
  const goods = crateRows.filter((c) => !c.isSample);
  const lines = goods.length ? goods : crateRows;
  lines.forEach((line, i) => {
    const r = sumFirstRow + i;
    applyRowStyle(ws, r, styles.sumRow, PL_COLS);
    setText(ws, "A", r, line.description);
    merge(ws, `A${r}:B${r}`);
    setText(ws, "C", r, line.batch ?? "");
    setNumber(ws, "D", r, line.slabs);
    setText(ws, "E", r, line.thick);
    setFormula(ws, "F", r, `G${r}/10.764`);
    setFormula(ws, "G", r, `+'${SLAB_TABLE.sheet}'!${SUMMARY_TABLE.columns.sqft}${layout.summaryFirstRow + i}`);
    setNumber(ws, "H", r, i === 0 ? netKg : 0);
    setNumber(ws, "I", r, i === 0 ? grossKg : 0);
    row += 1;
  });
  const sumLastRow = row - 1;

  const sumTotalRow = row;
  applyRowStyle(ws, sumTotalRow, styles.sumTotal, PL_COLS);
  setText(ws, "A", sumTotalRow, "TOTAL");
  merge(ws, `A${sumTotalRow}:B${sumTotalRow}`);
  for (const c of ["D", "F", "G", "H", "I"]) setFormula(ws, c, sumTotalRow, `SUM(${c}${sumFirstRow}:${c}${sumLastRow})`);
  row += 2;

  // ── the SAMPLES block, when the shipment carries sample boxes ─────────────
  const samples = crateRows.filter((c) => c.isSample);
  if (samples.length) {
    applyRowStyle(ws, row, styles.sumHeader, PL_COLS);
    setText(ws, "A", row, "SAMPLES");
    merge(ws, `A${row}:I${row}`);
    row += 1;
    applyRowStyle(ws, row, styles.sumHeader, PL_COLS);
    setText(ws, "A", row, "COLOR NAME");
    setText(ws, "D", row, "SIZE");
    setText(ws, "H", row, "NO.OF PCS");
    merge(ws, `A${row}:C${row}`); merge(ws, `D${row}:G${row}`); merge(ws, `H${row}:I${row}`);
    row += 1;
    for (const sm of samples) {
      applyRowStyle(ws, row, styles.sumRow, PL_COLS);
      setText(ws, "A", row, sm.description);
      setText(ws, "D", row, sm.size ?? sm.thick);
      setText(ws, "H", row, `${sm.slabs} NOS`);
      setText(ws, "J", row, sm.boxes ?? "");
      merge(ws, `A${row}:C${row}`); merge(ws, `D${row}:G${row}`); merge(ws, `H${row}:I${row}`);
      row += 1;
    }
    row += 1;
  }

  const echo0 = row, echo1 = row + 1;
  setFormula(ws, "A", echo0, `+'${SLAB_TABLE.sheet}'!A${layout.summaryFooterRows[0]}`);
  setFormula(ws, "A", echo1, `+'${SLAB_TABLE.sheet}'!A${layout.summaryFooterRows[1]}`);

  setPrintArea(ws, `A1:J${echo1}`);
  return echo1;
}

/** Net kilos per slab, from the slab lines only — sample boxes are counted in
 *  pieces, not slabs, and would drag the average down if they were included.
 *  Null when the ERP has no weight: better a blank column than an invented one. */
export function slabWeightKg(crateRows: CrateRow[]): number | null {
  const goods = crateRows.filter((c) => !c.isSample);
  const totalNet = goods.reduce((a, c) => a + (Number.isFinite(c.netWeight) ? c.netWeight : 0), 0);
  const totalSlabs = goods.reduce((a, c) => a + (Number.isFinite(c.slabs) ? c.slabs : 0), 0);
  if (!totalNet || !totalSlabs) return null;
  return Math.round(totalNet / totalSlabs);
}

// ─────────────────────────────── the entry point ─────────────────────────────

function templatePath(): string {
  return path.join(process.cwd(), TEMPLATE_RELATIVE_PATH);
}

/** Load the template into a workbook. Exported so the test can compare a built
 *  file against a pristine one without re-reading the path twice. */
export async function loadTemplate(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs declares its own global `interface Buffer extends ArrayBuffer`,
  // which merges with Node's and makes a real Node Buffer unassignable to it.
  // The value is right; only the declaration disagrees.
  type LoadArg = Parameters<typeof wb.xlsx.load>[0];
  await wb.xlsx.load(fs.readFileSync(templatePath()) as unknown as LoadArg);
  return wb;
}

/**
 * The workbook, filled. Returns the .xlsx bytes.
 *
 * Throws only when a shipment cannot be represented — more goods lines than a
 * sheet's block holds. Everything else degrades to a blank cell.
 */
export async function buildExportWorkbook(input: BuildExportWorkbookInput): Promise<Buffer> {
  const { buffer } = await buildExportWorkbookWithLayout(input);
  return buffer;
}

/** The same build, with the row layout it chose — what the tests assert on. */
export async function buildExportWorkbookWithLayout(
  input: BuildExportWorkbookInput,
): Promise<{ buffer: Buffer; layout: WorkbookLayout; workbook: ExcelJS.Workbook }> {
  const roots = input.roots ?? {};
  const slabs = Array.isArray(input.slabs) ? input.slabs : [];
  const crateRows = Array.isArray(input.crateRows) && input.crateRows.length
    ? input.crateRows
    : [{ marks: "", packages: "", description: "", thick: "", netWeight: 0, slabs: slabs.length, qty: 0, unit: "SQMT" }];

  const wb = await loadTemplate();

  writeRoots(wb, roots);
  const layout = writeMeasmtList(wb, slabs, crateRows);
  writeSummaryLinks(wb, layout);
  // Before the goods rows: the parked block overlaps the Invoice's per-SQFT
  // helper column, and those rates are written by writeItemRows.
  clearParkedAddresses(wb);
  writeItemRows(wb, crateRows, layout, roots);
  layout.pl852LastRow = writePl852(wb, slabs, crateRows, roots, layout);
  writeInvoiceR(wb, roots);

  // Formulas are written without cached results; without this Excel would show
  // the last-saved numbers (or zeros) until somebody pressed F9.
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true } as ExcelJS.Workbook["calcProperties"];

  const out = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(out as ArrayBuffer), layout, workbook: wb };
}

/** "PESPL/2780" → "PESPL-2780-export-docs.xlsx". */
export function workbookFileName(invoiceNumber: string | null | undefined): string {
  const safe = String(invoiceNumber ?? "export")
    .replace(/[\\/]/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "export";
  return `${safe}-export-docs.xlsx`;
}
