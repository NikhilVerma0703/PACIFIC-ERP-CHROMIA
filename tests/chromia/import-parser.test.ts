import { describe, expect, it } from 'vitest';

import { ChromiaDisposition as Disposition } from '@prisma/client';
import {
  COLUMN,
  dispositionFromRemark,
  findDuplicateSlabNos,
  parseProRegister,
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
