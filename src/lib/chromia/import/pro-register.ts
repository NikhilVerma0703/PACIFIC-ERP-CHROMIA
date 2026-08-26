import { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade } from '@prisma/client';

import { plantInstant } from '@/lib/chromia/plant-time';

/**
 * Parser for the production register.
 *
 * Two shapes of workbook reach this module and both end up as the same
 * `ParseResult`, so everything downstream — the preview, the importer, the
 * duplicate check — is written once:
 *
 *   • The flexible register (the operational format). Any column order, minor
 *     header-name variations, and extra columns it does not care about. Its
 *     columns are found by matching the header row by NAME — see
 *     `parseRegister` and `detectHeaderRow`.
 *
 *   • The legacy monthly register ("PRO MAY" and its siblings). Three merged
 *     header rows, one row per slab, columns addressed by index because the
 *     merged headers cannot be matched by name. Kept exactly as it was so an
 *     old file re-imports the way it always did — see `parseProRegister`.
 *
 * `parseRegister` is the entry point and picks between them. Both are pure — no
 * database, no file I/O — so the mapping rules stay unit-testable against real
 * rows.
 */

/** Zero-based column indexes in the legacy monthly register. */
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
  /** Grade implied by the remark, so a historical row carries a real QC grade. */
  grade: SlabGrade | null;
  /** Millimetres, when a thickness column was present. */
  thicknessMm: number | null;
  /** An explicit in-time, when one was given; otherwise the received date is used. */
  inTime: Date | null;
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
  /**
   * Required columns whose header could not be found in a flexible-format file.
   * Empty/absent when every required column is present (or for the legacy
   * format, which is addressed by position and cannot report this).
   */
  missingColumns?: string[];
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

/** Centimetres on the register → millimetres in the database. Null when blank. */
function toThicknessMm(cell: Cell): number | null {
  if (cell === null || cell === undefined) return null;
  const raw = typeof cell === 'number' ? cell : Number(String(cell).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw * 10;
}

/**
 * Combine a day with an explicit in-time.
 *
 * Accepts "HH:mm" text and an Excel time fraction (0–1). A datetime cell that
 * arrives as a Date is deliberately NOT read for its time here — reading the
 * clock off a bare-time Date is exactly the drift the plant-timezone work
 * removed — so those fall through to null and the received date is used, which
 * is what the legacy importer has always done for in-time.
 */
function toInTime(day: Date, cell: Cell): Date | null {
  if (cell === null || cell === undefined) return null;

  let hours: number | null = null;
  let minutes: number | null = null;

  if (typeof cell === 'number' && cell > 0 && cell < 1) {
    const total = Math.round(cell * 24 * 60);
    hours = Math.floor(total / 60) % 24;
    minutes = total % 60;
  } else {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(cell).trim());
    if (match) {
      hours = Number(match[1]);
      minutes = Number(match[2]);
    }
  }

  if (hours === null || minutes === null || hours > 23 || minutes > 59) return null;
  return plantInstant(day.getFullYear(), day.getMonth() + 1, day.getDate(), hours, minutes);
}

/**
 * Map a free-text remark to a disposition.
 *
 * Real values seen in the register: "STOCK", "RECALIBRATE - HALF PRINT",
 * "RECALIBRATE - RED COLOUR", "SAMPLE CUTTING  5 MAY", "DISPATCH". Matched
 * case-insensitively, most specific first, so "dispatch from stock" reads as
 * stock rather than dispatch.
 */
export function dispositionFromRemark(
  remark: string | null,
  hasDispatchDate = false,
): Disposition | null {
  const value = (remark ?? '').toUpperCase();

  if (/RECALIB/.test(value)) return Disposition.RECALIBRATION;
  if (/SAMPLE/.test(value)) return Disposition.SAMPLE_CUTTING;
  if (/WASTE|SCRAP/.test(value)) return Disposition.WASTE;
  if (/STOCK/.test(value)) return Disposition.STOCK;
  if (/DISPATCH|DESPATCH/.test(value)) return Disposition.DISPATCH;
  if (hasDispatchDate) return Disposition.DISPATCH;
  return null;
}

/**
 * The grade a disposition implies, for a historical row graded from its remark.
 *
 *   Dispatch → A · Stock → A · Sample Cutting → B · Recalibration → C
 *
 * These are the only pairings `GRADE_ALLOWED_DISPOSITIONS` permits, so a row
 * graded this way passes the same rule a QC decision does. Waste carries no
 * grade.
 */
export function gradeForDisposition(disposition: Disposition | null): SlabGrade | null {
  switch (disposition) {
    case Disposition.DISPATCH:
      return SlabGrade.A;
    case Disposition.STOCK:
      return SlabGrade.A;
    case Disposition.SAMPLE_CUTTING:
      return SlabGrade.B;
    case Disposition.RECALIBRATION:
      return SlabGrade.C;
    default:
      return null;
  }
}

/** The grade a remark implies — its disposition's grade. */
export function gradeFromRemark(remark: string | null): SlabGrade | null {
  return gradeForDisposition(dispositionFromRemark(remark));
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

// ─── Flexible header-name mapping ───────────────────────────────────────────

/** The fields the flexible importer knows how to place. */
export type RegisterField =
  | 'productionDate'
  | 'batchNo'
  | 'slabNo'
  | 'materialName'
  | 'designFile'
  | 'remark'
  | 'thickness'
  | 'inTime';

/** The six a file MUST carry, and the exact words a missing-column error uses. */
export const REQUIRED_FIELDS: RegisterField[] = [
  'productionDate',
  'batchNo',
  'slabNo',
  'materialName',
  'designFile',
  'remark',
];

const OPTIONAL_FIELDS: RegisterField[] = ['thickness', 'inTime'];

export const FIELD_LABELS: Record<RegisterField, string> = {
  productionDate: 'Production Date',
  batchNo: 'Batch Number',
  slabNo: 'Slab Number',
  materialName: 'Base Material / Slab Name',
  designFile: 'File Name / Planned Design',
  remark: 'Remarks',
  thickness: 'Thickness',
  inTime: 'In-time',
};

/**
 * The header names each field answers to, already normalised. Matching is
 * case-insensitive and ignores punctuation and spacing (so "Batch No.",
 * "batch no" and "BatchNo" are one and the same), which is what "minor name
 * variations" means in practice.
 */
const FIELD_ALIASES: Record<RegisterField, string[]> = {
  productionDate: ['production date', 'date', 'prod date', 'production'],
  batchNo: ['batch number', 'slab batch number', 'batch no', 'batch'],
  slabNo: ['slab number', 'slab no'],
  materialName: [
    'base material slab name',
    'slab name',
    'base material',
    'material',
    'material name',
    'base material name',
  ],
  designFile: [
    'file name planned design',
    'file name',
    'planned design',
    'program',
    'program name',
    'design',
    'design name',
  ],
  remark: ['remarks', 'remark'],
  thickness: ['thickness cm', 'thickness', 'thickness in cm', 'thk'],
  inTime: ['in time', 'in', 'time in'],
};

const ALL_FIELDS: RegisterField[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

/** Lowercase, punctuation → space, collapsed. "Batch No." → "batch no". */
function norm(cell: Cell): string {
  return text(cell)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The same with spaces removed, so "SlabNo" and "Slab No" meet. */
function compact(value: string): string {
  return value.replace(/ /g, '');
}

/** Does this header cell name this field, allowing spacing/punctuation drift? */
function headerMatches(cell: Cell, field: RegisterField): boolean {
  const asText = norm(cell);
  if (!asText) return false;
  const asCompact = compact(asText);
  return FIELD_ALIASES[field].some((alias) => {
    const aliasNorm = norm(alias);
    return asText === aliasNorm || asCompact === compact(aliasNorm);
  });
}

interface HeaderDetection {
  /** Row index of the header, or -1 when no row reads as one. */
  index: number;
  /** field → column index, for every field whose header was found. */
  map: Partial<Record<RegisterField, number>>;
}

/**
 * Find the header row and where each field sits in it.
 *
 * Scans the first rows, scores each by how many of the six required headers it
 * carries, and takes the best — a real header row names several fields, a data
 * row names none. A single word never counts for two fields (each column is
 * claimed by the first field it matches), so "Slab Name" and "Slab No." do not
 * fight over one another.
 */
export function detectHeaderRow(rows: Cell[][]): HeaderDetection {
  let best: HeaderDetection & { score: number } = { index: -1, map: {}, score: 0 };
  const scan = Math.min(rows.length, 25);

  for (let i = 0; i < scan; i += 1) {
    const row = rows[i] ?? [];
    const map: Partial<Record<RegisterField, number>> = {};

    for (let column = 0; column < row.length; column += 1) {
      const cell = row[column];
      if (text(cell) === '') continue;
      for (const field of ALL_FIELDS) {
        if (map[field] === undefined && headerMatches(cell, field)) {
          map[field] = column;
          break;
        }
      }
    }

    const score = REQUIRED_FIELDS.filter((field) => map[field] !== undefined).length;
    if (score > best.score) best = { index: i, map, score };
  }

  // Three named headers is enough to trust a row as the header row; fewer and
  // it is more likely a stray label than a real header, and the legacy parser
  // is the safer reading.
  return best.score >= 3 ? { index: best.index, map: best.map } : { index: -1, map: {} };
}

/**
 * Is this the legacy monthly register rather than a flexible-format file?
 *
 * The legacy sheet is the only one with a "Fully Printed Date" column, and it
 * fills the DATE column once and carries it down through that column — logic
 * that lives only in `parseProRegister`. Reading such a file by header name
 * would refill its sparse dates wrong, so its own signature routes it back to
 * its own parser.
 */
function looksLikeLegacyRegister(rows: Cell[][]): boolean {
  const scan = Math.min(rows.length, 6);
  for (let i = 0; i < scan; i += 1) {
    for (const cell of rows[i] ?? []) {
      if (/fully.?printed/.test(compact(norm(cell)))) return true;
    }
  }
  return false;
}

/**
 * Parse a flexible-format sheet using a detected header map.
 *
 * Same row-level rules as the legacy parser — a slab needs a number, a batch, a
 * name and a date, blank rows are skipped quietly — but the columns come from
 * the header, so any order and any extra columns are fine. The date is carried
 * down when a row leaves it blank, exactly as a person reads a register.
 */
function parseByHeader(rows: Cell[][], detection: HeaderDetection): ParseResult {
  const parsed: ParsedSlabRow[] = [];
  const issues: ParseIssue[] = [];
  let skipped = 0;
  let carriedDate: Date | null = null;

  const at = (row: Cell[], field: RegisterField): Cell => {
    const column = detection.map[field];
    return column === undefined ? null : row[column];
  };

  for (let index = detection.index + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const sourceRow = index + 1; // 1-based, matching what the user sees in Excel

    const rowDate = toDate(at(row, 'productionDate'));
    if (rowDate) carriedDate = rowDate;
    const receivedDate = rowDate ?? carriedDate;

    const slabNo = text(at(row, 'slabNo'));
    const batchNo = text(at(row, 'batchNo'));
    const materialName = text(at(row, 'materialName'));

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
      issues.push({ sourceRow, reason: `Slab ${slabNo}: missing production date` });
      continue;
    }

    const remark = text(at(row, 'remark')) || null;
    const disposition = dispositionFromRemark(remark);

    parsed.push({
      sourceRow,
      slabNo,
      batchNo,
      materialName,
      designFile: text(at(row, 'designFile')) || null,
      receivedDate,
      fullyPrintedDate: null,
      bypassedDate: null,
      remark,
      disposition,
      grade: gradeForDisposition(disposition),
      thicknessMm: toThicknessMm(at(row, 'thickness')),
      inTime: toInTime(receivedDate, at(row, 'inTime')),
      recalibrationReasonCode: reasonCodeFromRemark(remark),
      recalSentDate: null,
      recalReceivedDate: null,
      dispatchDate: null,
    });
  }

  return { rows: parsed, issues, skipped };
}

/**
 * Parse a register, whichever shape it is.
 *
 * The flexible header-name path is the operational one; the legacy monthly
 * register keeps its own positional parser. A file that names at least three of
 * the required columns and is not the legacy sheet is read by header — and if
 * it names some but not all six, the missing ones are reported by name rather
 * than the file simply failing.
 */
export function parseRegister(rows: Cell[][]): ParseResult {
  const detection = detectHeaderRow(rows);

  if (detection.index === -1 || looksLikeLegacyRegister(rows)) {
    return parseProRegister(rows);
  }

  const missingColumns = REQUIRED_FIELDS.filter((field) => detection.map[field] === undefined).map(
    (field) => FIELD_LABELS[field],
  );
  if (missingColumns.length > 0) {
    return { rows: [], issues: [], skipped: 0, missingColumns };
  }

  return parseByHeader(rows, detection);
}

/**
 * Parse the legacy monthly register by column position.
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
    const disposition = dispositionFromRemark(remark, Boolean(dispatchDate));

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
      disposition,
      grade: gradeForDisposition(disposition),
      thicknessMm: null,
      inTime: null,
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
