import { describe, expect, it } from 'vitest';

import { isClockTime, normaliseClockTime, nowClockTime } from '@/lib/chromia/clock-time';

describe('what counts as a time of day', () => {
  it('takes a real clock time', () => {
    expect(isClockTime('00:00')).toBe(true);
    expect(isClockTime('09:15')).toBe(true);
    expect(isClockTime('23:59')).toBe(true);
    expect(isClockTime('11:34:56')).toBe(true);
  });

  it('refuses an hour or a minute that does not exist', () => {
    // The pattern this replaced accepted both, and `new Date` turned 25:70
    // into ten past one the following morning without complaining.
    expect(isClockTime('25:70')).toBe(false);
    expect(isClockTime('24:00')).toBe(false);
    expect(isClockTime('12:60')).toBe(false);
  });

  it('refuses anything that is not a time', () => {
    expect(isClockTime('')).toBe(false);
    expect(isClockTime('915')).toBe(false);
    expect(isClockTime('9:15')).toBe(false);
    expect(isClockTime('abc')).toBe(false);
  });

  it('ignores space either side, which a paste leaves behind', () => {
    expect(isClockTime('  09:15 ')).toBe(true);
  });
});

describe('tidying up what was typed', () => {
  it('leaves a properly written time alone', () => {
    expect(normaliseClockTime('09:15')).toBe('09:15');
    expect(normaliseClockTime('23:59')).toBe('23:59');
  });

  it('reads a bare hour as the top of that hour', () => {
    expect(normaliseClockTime('9')).toBe('09:00');
    expect(normaliseClockTime('17')).toBe('17:00');
  });

  it('reads the digits the way the register is written', () => {
    expect(normaliseClockTime('930')).toBe('09:30');
    expect(normaliseClockTime('0930')).toBe('09:30');
    expect(normaliseClockTime('1730')).toBe('17:30');
  });

  it('pads a half-typed time', () => {
    expect(normaliseClockTime('9:5')).toBe('09:05');
    expect(normaliseClockTime('9:30')).toBe('09:30');
  });

  it('accepts whatever the operator used as a separator', () => {
    // The colon is a shifted key on a tablet; the full stop is not.
    expect(normaliseClockTime('9.30')).toBe('09:30');
    expect(normaliseClockTime('17 30')).toBe('17:30');
  });

  it('converts a twelve-hour habit rather than storing it as morning', () => {
    expect(normaliseClockTime('9:15 pm')).toBe('21:15');
    expect(normaliseClockTime('9:15am')).toBe('09:15');
    expect(normaliseClockTime('12:05 am')).toBe('00:05');
    expect(normaliseClockTime('12:05 pm')).toBe('12:05');
  });

  it('drops the seconds, because the register does not record them', () => {
    expect(normaliseClockTime('09:15:42')).toBe('09:15');
  });

  it('refuses a time that does not exist rather than guessing', () => {
    expect(normaliseClockTime('25:00')).toBeNull();
    expect(normaliseClockTime('24:00')).toBeNull();
    expect(normaliseClockTime('12:60')).toBeNull();
    expect(normaliseClockTime('2570')).toBeNull();
    expect(normaliseClockTime('13:00 pm')).toBeNull();
  });

  it('refuses anything that is not a time at all', () => {
    expect(normaliseClockTime('')).toBeNull();
    expect(normaliseClockTime('   ')).toBeNull();
    expect(normaliseClockTime('abc')).toBeNull();
    expect(normaliseClockTime('9:15:20:30')).toBeNull();
    expect(normaliseClockTime('1234567')).toBeNull();
  });

  it('always produces something the validator then accepts', () => {
    for (const typed of ['9', '930', '0930', '9:5', '9.30', '17 30', '9:15 pm', '00:00']) {
      const tidied = normaliseClockTime(typed);
      expect(tidied).not.toBeNull();
      expect(isClockTime(tidied as string)).toBe(true);
    }
  });
});

describe('the starting value of the field', () => {
  it('is the current time, zero-padded', () => {
    expect(nowClockTime(new Date(2026, 7, 3, 9, 5))).toBe('09:05');
    expect(nowClockTime(new Date(2026, 7, 3, 17, 30))).toBe('17:30');
    expect(nowClockTime(new Date(2026, 7, 3, 0, 0))).toBe('00:00');
  });

  it('is always a time the validator accepts', () => {
    expect(isClockTime(nowClockTime())).toBe(true);
  });
});

describe('the in-time as the schema receives it', () => {
  it('accepts what an operator actually types, and stores one spelling', async () => {
    const { operatorEntrySchema } = await import('@/lib/chromia/validation/operator');

    const row = {
      entryDate: '2026-08-03',
      batchNo: '1245',
      slabNo: '130520',
      baseMaterial: 'Astral Mist',
      fileName: 'Astral Mist 1',
    };

    for (const [typed, stored] of [
      ['09:30', '09:30'],
      ['930', '09:30'],
      ['0930', '09:30'],
      ['9.30', '09:30'],
      ['9', '09:00'],
    ]) {
      const parsed = operatorEntrySchema.safeParse({ ...row, inTime: typed });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.inTime).toBe(stored);
    }
  });

  it('refuses a time that does not exist, however it was typed', async () => {
    const { operatorEntrySchema } = await import('@/lib/chromia/validation/operator');

    const row = {
      entryDate: '2026-08-03',
      batchNo: '1245',
      slabNo: '130520',
      baseMaterial: 'Astral Mist',
      fileName: 'Astral Mist 1',
    };

    for (const typed of ['25:70', '24:00', '12:60', '', 'abc']) {
      const parsed = operatorEntrySchema.safeParse({ ...row, inTime: typed });
      expect(parsed.success).toBe(false);
      expect(parsed.success === false && parsed.error.flatten().fieldErrors.inTime?.[0]).toBe(
        'Enter a valid in-time (HH:MM)',
      );
    }
  });

  it('applies the same rule to a slab restarting after recalibration', async () => {
    const { restartAfterRecalibrationSchema } = await import('@/lib/chromia/validation/recalibration-flow'
    );

    const row = {
      slabId: '3f1a5c2e-1b7d-4c6a-9e2f-0a1b2c3d4e5f',
      receivedDate: '2026-08-03',
      batchNo: '1245',
      slabNo: '130520',
      baseMaterial: 'Astral Mist',
      fileName: 'Astral Mist 1',
    };

    expect(restartAfterRecalibrationSchema.safeParse({ ...row, inTime: '930' })).toMatchObject({
      success: true,
      data: { inTime: '09:30' },
    });
    expect(restartAfterRecalibrationSchema.safeParse({ ...row, inTime: '25:70' }).success).toBe(
      false,
    );
  });
});
