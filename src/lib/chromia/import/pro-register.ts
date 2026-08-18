import { ChromiaDisposition as Disposition } from '@prisma/client';

/**
 * Parser for the monthly production register ("PRO MAY" and its siblings).
 *
 * The workbook has three merged header rows and one row per slab. Columns are
 * addressed by index because the headers are merged and cannot be matched by
 * name reliably.
 *
 * Kept pure — no database, no file I/O — so the mapping rules are unit-testable
 * against real rows from the sheet.
 */

/** Zero-based column indexes in the register. */
export const COLUMN = {
  serial: 0,
  date: 1,
  slabName: 2,
  batchNo: 3,
  slabNo: 4,
  designFile: 7,
  fullyPrintedDate: 8,
  bypassedDate: 11,
  remark: 15,
  recalSentDate: 16,
  recalReceivedDate: 19,
  dispatchDate: 22,
} as const;

/** Data starts on the fifth row; rows 1–3 are headers and row 4 is a spacer. */
export const FIRST_DATA_ROW_INDEX = 4;

export interface ParsedSlabRow {
  sourceRow: number;
  slabNo: string;
  batchNo: string;
  materialName: string;
  designFile: string | null;
  receivedDate: Date;
  fullyPrintedDate: Date | null;
  bypassedDate: Date | null;
  remark: string | null;
  disposition: Disposition | null;
  recalibrationReasonCode: string | null;
  recalSentDate: Date | null;
  recalReceivedDate: Date | null;
  dispatchDate: Date | null;
}

export interface ParseIssue {
  sourceRow: number;
  reason: string;
}

export interface ParseResult {
  rows: ParsedSlabRow[];
  issues: ParseIssue[];
  skipped: number;
}

type Cell = unknown;

function text(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}

/**
 * Snap an instant to the calendar day it means.
 *
 * The register records days, never times, but a spreadsheet stores a day as an
 * instant — and the reader hands that instant back a few seconds short of the
 * midnight it was meant to be. "1 May 2026" arrives as 30 Apr 2026 23:59:50,
 * which files the whole month under April and makes a May filter come back
 * empty.
 *
 * Rounding to the nearest minute repairs that drift (every time zone is a whole
 * number of minutes from UTC, so rounding the instant rounds the local clock
 * too), and flattening to midnight makes the value say what the register says:
 * a day, with no time of day attached.
 */
export function toCalendarDay(date: Date): Date {
  const rounded = new Date(Math.round(date.getTime() / 60_000) * 60_000);
  return new Date(rounded.getFullYear(), rounded.getMonth(), rounded.getDate());
}

function toDate(cell: Cell): Date | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return toCalendarDay(cell);

  const raw = text(cell);
  if (!raw) return null;

  // "2026-05-01" would otherwise parse as UTC midnight, which is the previous
  // day west of Greenwich. The register means a local day, so build one.
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoDay) {
    return new Date(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]));
  }

  // "5/1/26" style two-digit years parse as 2001 — normalise to 20xx.
  const shortYear = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(raw);
  if (shortYear) {
    const [, month, day, year] = shortYear;
    const parsedShort = new Date(2000 + Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsedShort.getTime()) ? null : toCalendarDay(parsedShort);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  // A date before the mill existed is a parsing accident, not real data.
  return parsed.getFullYear() < 2000 ? null : toCalendarDay(parsed);
}

/**
 * Map a free-text remark to a disposition.
 *
 * Real values seen in the register: "STOCK", "RECALIBRATE - HALF PRINT",
 * "RECALIBRATE - RED COLOUR", "SAMPLE CUTTING  5 MAY".
 */
export function dispositionFromRemark(
  remark: string | null,
  hasDispatchDate: boolean,
): Disposition | null {
  const value = (remark ?? '').toUpperCase();

  if (/RECALIB/.test(value)) return Disposition.RECALIBRATION;
  if (/SAMPLE/.test(value)) return Disposition.SAMPLE_CUTTING;
  if (/WASTE|SCRAP/.test(value)) return Disposition.WASTE;
  if (/STOCK/.test(value)) return Disposition.STOCK;
  if (hasDispatchDate) return Disposition.DISPATCH;
  return null;
}

/**
 * Map the free-text part of a recalibration remark to a seeded reason code.
 * Anything unrecognised falls back to OTHER, with the original text preserved
 * on the slab so nothing is lost.
 */
export function reasonCodeFromRemark(remark: string | null): string | null {
  const value = (remark ?? '').toUpperCase();
  if (!/RECALIB/.test(value)) return null;

  if (/HALF\s*PRINT/.test(value)) return 'HALF-PRINT';
  if (/RED\s*COLO/.test(value)) return 'RED-COLOUR';
  if (/COLO(U)?R/.test(value)) return 'COLOUR-MISMATCH';
  if (/MISREG/.test(value)) return 'PRINT-MISREG';
  if (/GLOSS/.test(value)) return 'GLOSS-OUT-OF-SPEC';
  if (/PRIMER/.test(value)) return 'PRIMER-DEFECT';
  if (/MOULD|MOLD/.test(value)) return 'MOULD-DEFECT';
  if (/DIMENSION|SIZE/.test(value)) return 'DIMENSIONAL';
  if (/SURFACE|FINISH/.test(value)) return 'SURFACE-FINISH';
  return 'OTHER';
}

/**
 * Parse the sheet.
 *
 * Which day does a slab belong to?
 *
 * The DATE column is only written on the first slab of a day, so it is carried
 * forward — exactly how a person reads the sheet. But the writing is not always
 * kept up: in the May register the date was entered once, on the very first
 * row, and never again. Carrying it forward alone would stamp every slab in the
 * month with 1 May, so a filter for 12–27 May would find nothing.
 *
 * The FULLY PRINTED DATE column, on the other hand, is filled in for every
 * single slab — it is the day that slab was actually on the line. A slab goes
 * into the primer and comes off printed the same shift, so on a properly filled
 * register the two columns agree and this rule changes nothing. Where the DATE
 * column has been left blank for days on end, it is the only honest answer.
 *
 * Hence, in order: this row's own DATE cell, then its fully printed date, then
 * the date carried down from above.
 */
export function parseProRegister(rows: Cell[][]): ParseResult {
  const parsed: ParsedSlabRow[] = [];
  const issues: ParseIssue[] = [];
  let skipped = 0;
  let carriedDate: Date | null = null;

  for (let index = FIRST_DATA_ROW_INDEX; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const sourceRow = index + 1; // 1-based, matching what the user sees in Excel

    const rowDate = toDate(row[COLUMN.date]);
    if (rowDate) carriedDate = rowDate;

    const fullyPrintedDate = toDate(row[COLUMN.fullyPrintedDate]);
    const receivedDate = rowDate ?? fullyPrintedDate ?? carriedDate;

    const slabNo = text(row[COLUMN.slabNo]);
    const batchNo = text(row[COLUMN.batchNo]);
    const materialName = text(row[COLUMN.slabName]);

    // Blank spacer rows are normal in this sheet — skip quietly.
    if (!slabNo && !batchNo && !materialName) {
      skipped += 1;
      continue;
    }

    if (!slabNo) {
      issues.push({ sourceRow, reason: 'Missing slab number' });
      continue;
    }
    if (!batchNo) {
      issues.push({ sourceRow, reason: `Slab ${slabNo}: missing batch number` });
      continue;
    }
    if (!materialName) {
      issues.push({ sourceRow, reason: `Slab ${slabNo}: missing slab name` });
      continue;
    }
    if (!receivedDate) {
      issues.push({ sourceRow, reason: `Slab ${slabNo}: no date found above this row` });
      continue;
    }

    const remark = text(row[COLUMN.remark]) || null;
    const dispatchDate = toDate(row[COLUMN.dispatchDate]);

    parsed.push({
      sourceRow,
      slabNo,
      batchNo,
      materialName,
      designFile: text(row[COLUMN.designFile]) || null,
      receivedDate,
      fullyPrintedDate,
      bypassedDate: toDate(row[COLUMN.bypassedDate]),
      remark,
      disposition: dispositionFromRemark(remark, Boolean(dispatchDate)),
      recalibrationReasonCode: reasonCodeFromRemark(remark),
      recalSentDate: toDate(row[COLUMN.recalSentDate]),
      recalReceivedDate: toDate(row[COLUMN.recalReceivedDate]),
      dispatchDate,
    });
  }

  return { rows: parsed, issues, skipped };
}

/** Duplicate slab numbers inside one sheet — the register does repeat them. */
export function findDuplicateSlabNos(rows: readonly ParsedSlabRow[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const row of rows) {
    const key = row.slabNo.toUpperCase();
    if (seen.has(key)) duplicates.add(row.slabNo);
    seen.add(key);
  }

  return [...duplicates];
}
