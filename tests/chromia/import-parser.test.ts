import { describe, expect, it } from 'vitest';

import { ChromiaDisposition as Disposition } from '@prisma/client';
import {
  COLUMN,
  dispositionFromRemark,
  findDuplicateSlabNos,
  gradeFromRemark,
  parseProRegister,
  parseRegister,
  reasonCodeFromRemark,
  toCalendarDay,
} from '@/lib/chromia/import/pro-register';

/** Build a register row with only the columns we care about filled in. */
function row(values: Partial<Record<keyof typeof COLUMN, unknown>>): unknown[] {
  const out: unknown[] = new Array(30).fill(null);
  for (const [key, value] of Object.entries(values)) {
    out[COLUMN[key as keyof typeof COLUMN]] = value;
  }
  return out;
}

const HEADERS: unknown[][] = [[], [], [], []];

/** Local calendar day — the register records days, so that is what we assert. */
function day(date: Date | null | undefined): string | undefined {
  if (!date) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe('remark → disposition', () => {
  it('reads the real values from the May register', () => {
    expect(dispositionFromRemark('STOCK', false)).toBe(Disposition.STOCK);
    expect(dispositionFromRemark('RECALIBRATE - HALF PRINT', false)).toBe(
      Disposition.RECALIBRATION,
    );
    expect(dispositionFromRemark('RECALIBRATE - RED COLOUR', false)).toBe(
      Disposition.RECALIBRATION,
    );
    expect(dispositionFromRemark('SAMPLE CUTTING  5 MAY', false)).toBe(Disposition.SAMPLE_CUTTING);
  });

  it('falls back to dispatch when a dispatch date exists and there is no remark', () => {
    expect(dispositionFromRemark(null, true)).toBe(Disposition.DISPATCH);
    expect(dispositionFromRemark(null, false)).toBeNull();
  });

  it('prefers an explicit remark over the dispatch date', () => {
    expect(dispositionFromRemark('STOCK', true)).toBe(Disposition.STOCK);
  });
});

describe('remark → recalibration reason', () => {
  it('maps the known reasons to seeded codes', () => {
    expect(reasonCodeFromRemark('RECALIBRATE - HALF PRINT')).toBe('HALF-PRINT');
    expect(reasonCodeFromRemark('RECALIBRATE - RED COLOUR')).toBe('RED-COLOUR');
    expect(reasonCodeFromRemark('RECALIBRATE - SOMETHING NEW')).toBe('OTHER');
  });

  it('returns nothing for a non-recalibration remark', () => {
    expect(reasonCodeFromRemark('STOCK')).toBeNull();
    expect(reasonCodeFromRemark(null)).toBeNull();
  });
});

describe('parsing the register', () => {
  it('carries the date forward across rows that leave it blank', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
      row({ slabNo: '129317', batchNo: '1232', slabName: 'robo trail' }),
    ]);

    expect(result.rows).toHaveLength(2);
    expect(day(result.rows[0]?.receivedDate)).toBe('2026-05-01');
    expect(day(result.rows[1]?.receivedDate)).toBe('2026-05-01');
  });

  it('skips blank spacer rows quietly', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
      row({}),
      row({}),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(2);
    expect(result.issues).toHaveLength(0);
  });

  it('reports a partially filled row instead of importing rubbish', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabName: 'robo trail', batchNo: '1245' }),
    ]);

    expect(result.rows).toHaveLength(0);
    expect(result.issues[0]?.reason).toContain('Missing slab number');
  });

  it('reports a row with no date above it', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
    ]);

    expect(result.issues[0]?.reason).toContain('no date found');
  });

  it('maps a full recalibration row end to end', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({
        date: '2026-05-01',
        slabNo: '129317',
        batchNo: '1232',
        slabName: 'robo trail',
        designFile: 'lighter THAJ 3',
        fullyPrintedDate: '2026-05-01',
        remark: 'RECALIBRATE - HALF PRINT',
        recalSentDate: '2026-05-03',
        recalReceivedDate: '2026-05-09',
      }),
    ]);

    const parsed = result.rows[0];
    expect(parsed?.slabNo).toBe('129317');
    expect(parsed?.designFile).toBe('lighter THAJ 3');
    expect(parsed?.disposition).toBe(Disposition.RECALIBRATION);
    expect(parsed?.recalibrationReasonCode).toBe('HALF-PRINT');
    expect(day(parsed?.recalSentDate)).toBe('2026-05-03');
    expect(day(parsed?.recalReceivedDate)).toBe('2026-05-09');
  });

  it('reports row numbers as they appear in Excel', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
    ]);
    expect(result.rows[0]?.sourceRow).toBe(5);
  });
});

describe('duplicate detection', () => {
  it('finds slab numbers repeated within one sheet', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: '130520', batchNo: '1245', slabName: 'a' }),
      row({ slabNo: '130520', batchNo: '1245', slabName: 'a' }),
      row({ slabNo: '999', batchNo: '1245', slabName: 'a' }),
    ]);

    expect(findDuplicateSlabNos(result.rows)).toEqual(['130520']);
  });

  it('returns nothing when every slab number is unique', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: '1', batchNo: '1', slabName: 'a' }),
      row({ slabNo: '2', batchNo: '1', slabName: 'a' }),
    ]);
    expect(findDuplicateSlabNos(result.rows)).toEqual([]);
  });
});

describe('remark → grade', () => {
  it('maps each outcome to the grade the QC rules allow', () => {
    expect(gradeFromRemark('Dispatch')).toBe('A');
    expect(gradeFromRemark('STOCK')).toBe('A');
    expect(gradeFromRemark('Sample Cutting')).toBe('B');
    expect(gradeFromRemark('Sample Cut')).toBe('B');
    expect(gradeFromRemark('RECALIBRATE - RED COLOUR')).toBe('C');
  });

  it('leaves an unrecognised or empty remark ungraded', () => {
    expect(gradeFromRemark('some free text')).toBeNull();
    expect(gradeFromRemark(null)).toBeNull();
    expect(gradeFromRemark('WASTE')).toBeNull();
  });
});

/** Build a flexible sheet: a header row, then one array per data row. */
function flexSheet(headers: string[], dataRows: (string | number | null)[][]): unknown[][] {
  return [headers, ...dataRows];
}

const REQUIRED_HEADERS = [
  'Production Date',
  'Batch Number',
  'Slab Number',
  'Base Material / Slab Name',
  'File Name / Planned Design',
  'Remarks',
];

describe('flexible header-name import', () => {
  it('reads the six required columns in any order and grades from the remark', () => {
    const result = parseRegister(
      flexSheet(
        ['Remarks', 'Slab Number', 'Production Date', 'File Name / Planned Design', 'Batch Number', 'Base Material / Slab Name'],
        [['Stock', '130520', '2026-05-01', 'THAJ 3', '1245', 'robo trail']],
      ),
    );

    expect(result.missingColumns).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    const parsed = result.rows[0];
    expect(parsed?.slabNo).toBe('130520');
    expect(parsed?.batchNo).toBe('1245');
    expect(parsed?.materialName).toBe('robo trail');
    expect(parsed?.designFile).toBe('THAJ 3');
    expect(parsed?.disposition).toBe(Disposition.STOCK);
    expect(parsed?.grade).toBe('A');
    expect(day(parsed?.receivedDate)).toBe('2026-05-01');
  });

  it('accepts minor header-name variations and ignores extra columns', () => {
    const result = parseRegister(
      flexSheet(
        ['Date', 'Slab No.', 'Slab Batch Number', 'Slab Name', 'Program Name', 'Remarks', 'Some Extra Column'],
        [['2026-05-02', '59183-A', 'B-9', 'quartz', 'design-7', 'Dispatch', 'ignored']],
      ),
    );

    expect(result.missingColumns).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    // Alphanumeric slab and batch numbers survive intact.
    expect(result.rows[0]?.slabNo).toBe('59183-A');
    expect(result.rows[0]?.batchNo).toBe('B-9');
    expect(result.rows[0]?.disposition).toBe(Disposition.DISPATCH);
    expect(result.rows[0]?.grade).toBe('A');
  });

  it('names the missing required column instead of failing blankly', () => {
    const result = parseRegister(
      flexSheet(
        ['Production Date', 'Batch Number', 'Slab Number', 'Base Material', 'File Name'],
        [['2026-05-01', '1245', '130520', 'robo', 'THAJ']],
      ),
    );

    expect(result.rows).toHaveLength(0);
    expect(result.missingColumns).toEqual(['Remarks']);
  });

  it('imports when the optional Thickness and In-time columns are present', () => {
    const result = parseRegister(
      flexSheet(
        [...REQUIRED_HEADERS, 'Thickness', 'In-time'],
        [['2026-05-01', '1245', '130520', 'robo', 'THAJ', 'Sample Cutting', '2', '14:53']],
      ),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.thicknessMm).toBe(20); // 2 cm → 20 mm
    expect(result.rows[0]?.inTime).not.toBeNull();
    expect(result.rows[0]?.disposition).toBe(Disposition.SAMPLE_CUTTING);
    expect(result.rows[0]?.grade).toBe('B');
  });

  it('imports just as happily when Thickness and In-time are absent', () => {
    const result = parseRegister(
      flexSheet(REQUIRED_HEADERS, [
        ['2026-05-01', '1245', '130520', 'robo', 'THAJ', 'Recalibrate - half print'],
      ]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.thicknessMm).toBeNull();
    expect(result.rows[0]?.inTime).toBeNull();
    expect(result.rows[0]?.disposition).toBe(Disposition.RECALIBRATION);
    expect(result.rows[0]?.grade).toBe('C');
    expect(result.rows[0]?.recalibrationReasonCode).toBe('HALF-PRINT');
  });

  it('reports a row missing its slab number without dropping the rest', () => {
    const result = parseRegister(
      flexSheet(REQUIRED_HEADERS, [
        ['2026-05-01', '1245', '', 'robo', 'THAJ', 'Stock'],
        ['2026-05-01', '1245', '130521', 'robo', 'THAJ', 'Stock'],
      ]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.slabNo).toBe('130521');
    expect(result.issues[0]?.reason).toContain('Missing slab number');
  });
});

describe('choosing the right parser', () => {
  it('falls back to the legacy parser when no header row is recognisable', () => {
    // The legacy fixture: blank header rows, values addressed by position.
    const viaRegister = parseRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
    ]);
    expect(viaRegister.rows).toHaveLength(1);
    expect(viaRegister.rows[0]?.slabNo).toBe('130520');
  });

  it('routes a sheet with a Fully Printed Date column to the legacy parser', () => {
    const headers = new Array(30).fill(null);
    headers[COLUMN.date] = 'Date';
    headers[COLUMN.slabName] = 'Slab Name';
    headers[COLUMN.batchNo] = 'Batch No';
    headers[COLUMN.slabNo] = 'Slab No';
    headers[COLUMN.fullyPrintedDate] = 'Fully Printed Date';
    headers[COLUMN.remark] = 'Remarks';

    const result = parseRegister([
      headers,
      [],
      [],
      [],
      row({ date: '2026-05-01', slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.slabNo).toBe('130520');
  });
});

describe('date cells land on the day they mean', () => {
  it('pulls a spreadsheet instant that fell ten seconds short back onto its day', () => {
    // Exactly what the reader returns for "1 May 2026" in the May register:
    // ten seconds before local midnight, i.e. still 30 April.
    const short = new Date(2026, 3, 30, 23, 59, 50);
    expect(day(toCalendarDay(short))).toBe('2026-05-01');
  });

  it('leaves a date that is already on its day alone', () => {
    expect(day(toCalendarDay(new Date(2026, 4, 1, 0, 0, 0)))).toBe('2026-05-01');
    expect(day(toCalendarDay(new Date(2026, 4, 1, 14, 20, 0)))).toBe('2026-05-01');
  });

  it('strips the time of day, because the register never records one', () => {
    const flattened = toCalendarDay(new Date(2026, 4, 1, 14, 20, 0));
    expect(flattened.getHours()).toBe(0);
    expect(flattened.getMinutes()).toBe(0);
    expect(flattened.getSeconds()).toBe(0);
  });

  it('does not drag a genuine late-evening instant into the next day', () => {
    expect(day(toCalendarDay(new Date(2026, 4, 1, 23, 30, 0)))).toBe('2026-05-01');
  });

  it('carries the repaired day through a parsed register row', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({
        date: new Date(2026, 3, 30, 23, 59, 50),
        slabNo: '130520',
        batchNo: '1245',
        slabName: 'robo trail',
      }),
      row({ slabNo: '129317', batchNo: '1232', slabName: 'robo trail' }),
    ]);

    expect(day(result.rows[0]?.receivedDate)).toBe('2026-05-01');
    expect(day(result.rows[1]?.receivedDate)).toBe('2026-05-01');
  });
});

describe('which day a slab belongs to', () => {
  it('uses a date written on the row itself', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({
        date: '2026-05-12',
        fullyPrintedDate: '2026-05-13',
        slabNo: '130520',
        batchNo: '1245',
        slabName: 'robo trail',
      }),
    ]);
    expect(day(result.rows[0]?.receivedDate)).toBe('2026-05-12');
  });

  it('uses the fully printed date when the row has no date of its own', () => {
    // The May register: the date was written once on the first row and never
    // again, so carrying it forward would stamp the whole month 1 May.
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
      row({
        fullyPrintedDate: '2026-05-23',
        slabNo: '129317',
        batchNo: '1232',
        slabName: 'robo trail',
      }),
    ]);

    expect(day(result.rows[0]?.receivedDate)).toBe('2026-05-01');
    expect(day(result.rows[1]?.receivedDate)).toBe('2026-05-23');
  });

  it('falls back to the carried date when the row has neither', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-08', slabNo: '130520', batchNo: '1245', slabName: 'robo trail' }),
      row({ slabNo: '129317', batchNo: '1232', slabName: 'robo trail' }),
    ]);
    expect(day(result.rows[1]?.receivedDate)).toBe('2026-05-08');
  });

  it('changes nothing on a register whose days are written properly', () => {
    // Slab goes into the primer and comes off printed the same day, so both
    // columns agree and the rule is invisible.
    const result = parseProRegister([
      ...HEADERS,
      row({
        date: '2026-05-08',
        fullyPrintedDate: '2026-05-08',
        slabNo: '130520',
        batchNo: '1245',
        slabName: 'robo trail',
      }),
      row({
        fullyPrintedDate: '2026-05-08',
        slabNo: '129317',
        batchNo: '1232',
        slabName: 'robo trail',
      }),
    ]);
    expect(result.rows.map((r) => day(r.receivedDate))).toEqual(['2026-05-08', '2026-05-08']);
  });

  it('spreads a month across its real days instead of piling it on day one', () => {
    const result = parseProRegister([
      ...HEADERS,
      row({ date: '2026-05-01', slabNo: 'A', batchNo: '1', slabName: 'robo trail' }),
      row({ fullyPrintedDate: '2026-05-13', slabNo: 'B', batchNo: '1', slabName: 'robo trail' }),
      row({ fullyPrintedDate: '2026-05-22', slabNo: 'C', batchNo: '1', slabName: 'robo trail' }),
      row({ fullyPrintedDate: '2026-05-27', slabNo: 'D', batchNo: '1', slabName: 'robo trail' }),
    ]);

    // A 12–27 May filter now finds three of the four, where before it found none.
    const inWindow = result.rows.filter((r) => {
      const d = day(r.receivedDate) ?? '';
      return d >= '2026-05-12' && d <= '2026-05-27';
    });
    expect(inWindow.map((r) => r.slabNo)).toEqual(['B', 'C', 'D']);
  });
});
