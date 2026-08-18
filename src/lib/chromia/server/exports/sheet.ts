import * as XLSX from 'xlsx-js-style';

import { GROUP_COLORS, type ExportColumn } from '@/lib/chromia/exports';

/**
 * Colour-banded workbook writer, shared by every download.
 *
 * Five bands — identity, product, timing, state and the outcome's own fields —
 * each with a solid header and a light wash over its body cells. A wide sheet
 * printed and carried onto the floor is then readable at arm's length: you find
 * the slab number by colour, not by counting columns.
 */

const HAIRLINE = { style: 'thin', color: { rgb: 'D0D5DD' } } as const;

const BORDER = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE } as const;

function headerStyle(column: ExportColumn) {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: GROUP_COLORS[column.group].header } },
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER,
  };
}

function bodyStyle(column: ExportColumn, isEven: boolean) {
  return {
    // Alternate rows drop the wash to white, which keeps long sheets readable.
    fill: {
      patternType: 'solid',
      fgColor: { rgb: isEven ? GROUP_COLORS[column.group].body : 'FFFFFF' },
    },
    font: { sz: 10, color: { rgb: '101828' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: BORDER,
  };
}

export function writeStyledWorkbook({
  sheetName,
  columns,
  rows,
}: {
  sheetName: string;
  columns: ExportColumn[];
  /** One array per row, already in column order. */
  rows: (string | number)[][];
}): Buffer {
  const matrix = [columns.map((column) => column.label), ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);

  columns.forEach((column, columnIndex) => {
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address] ?? { t: 's', v: '' };
      cell.s = rowIndex === 0 ? headerStyle(column) : bodyStyle(column, rowIndex % 2 === 0);
      sheet[address] = cell;
    }
  });

  sheet['!cols'] = columns.map((column) => ({ wch: column.width }));
  sheet['!rows'] = [{ hpt: 28 }];
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(matrix.length - 1, 1), c: columns.length - 1 },
    }),
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Dates for the sheet, in the reader's own clock.
 *
 * `toISOString` prints UTC, so an in-time of 11:10 on the shop floor reached
 * the spreadsheet as 05:40 — off by the whole India offset, every row. The
 * register is read by the people who wrote it, so the sheet must show the time
 * they saw on the wall.
 *
 * `fully_printed_date` is a DATE column and comes back at UTC midnight, so it
 * is formatted from its UTC parts; everything else is a real instant and is
 * formatted locally.
 */
const pad = (value: number) => String(value).padStart(2, '0');

export const dateOnly = (value: Date | null) =>
  value
    ? `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
    : '';

export const localDay = (value: Date | null) =>
  value ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '';

/**
 * The day and the time of day, separated by a comma.
 *
 * `2026-08-17, 11:21` rather than `2026-08-17 11:21`: a space alone lets the
 * two run together at a glance in a narrow column, and the comma is how the
 * register writes it.
 */
export const dateTime = (value: Date | null) =>
  value ? `${localDay(value)}, ${pad(value.getHours())}:${pad(value.getMinutes())}` : '';
