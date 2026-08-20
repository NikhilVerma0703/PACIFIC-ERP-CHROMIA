import { describe, expect, it } from 'vitest';

import {
  combineDateAndTime,
  designCodeFromFileName,
  endOfDay,
  normaliseFileName,
  registerDay,
  startOfDay,
  toDateInput,
  toTimeInput,
} from '@/lib/chromia/operator-register';

describe('combineDateAndTime', () => {
  it('builds a local Date from the register date and in-time', () => {
    const result = combineDateAndTime('2026-08-03', '09:15');
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(7);
    expect(result?.getDate()).toBe(3);
    expect(result?.getHours()).toBe(9);
    expect(result?.getMinutes()).toBe(15);
  });

  it('accepts a seconds component', () => {
    expect(combineDateAndTime('2026-08-03', '09:15:30')?.getSeconds()).toBe(30);
  });

  it('rejects malformed input', () => {
    expect(combineDateAndTime('03-08-2026', '09:15')).toBeNull();
    expect(combineDateAndTime('2026-08-03', '9:15')).toBeNull();
    expect(combineDateAndTime('', '')).toBeNull();
  });
});

describe('day boundaries', () => {
  it('startOfDay strips the time', () => {
    const start = startOfDay(new Date(2026, 7, 3, 17, 42, 9));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(3);
  });

  it('endOfDay is midnight the next day', () => {
    const end = endOfDay(new Date(2026, 7, 3, 17, 42));
    expect(end.getDate()).toBe(4);
    expect(end.getHours()).toBe(0);
  });

  it('endOfDay rolls over a month boundary', () => {
    const end = endOfDay(new Date(2026, 7, 31, 12, 0));
    expect(end.getMonth()).toBe(8);
    expect(end.getDate()).toBe(1);
  });
});

describe('input formatting', () => {
  it('formats the date in local time, not UTC', () => {
    expect(toDateInput(new Date(2026, 7, 3, 23, 30))).toBe('2026-08-03');
    expect(toDateInput(new Date(2026, 0, 9, 1, 5))).toBe('2026-01-09');
  });

  it('pads the time', () => {
    expect(toTimeInput(new Date(2026, 7, 3, 9, 5))).toBe('09:05');
    expect(toTimeInput(new Date(2026, 7, 3, 14, 30))).toBe('14:30');
  });
});

describe('designCodeFromFileName', () => {
  it('derives an uppercase slug', () => {
    expect(designCodeFromFileName('Lighter Thaj 3')).toBe('LIGHTER-THAJ-3');
    expect(designCodeFromFileName('Cristallo OG.tif')).toBe('CRISTALLO-OG-TIF');
  });

  it('avoids collisions', () => {
    expect(designCodeFromFileName('Statuario', ['STATUARIO'])).toBe('STATUARIO-2');
    expect(designCodeFromFileName('Statuario', ['STATUARIO', 'STATUARIO-2'])).toBe('STATUARIO-3');
  });

  it('never produces an empty code', () => {
    expect(designCodeFromFileName('///')).toBe('DESIGN');
  });
});

describe('normaliseFileName', () => {
  it('ignores case and repeated spaces', () => {
    expect(normaliseFileName('  Lighter   Thaj 3 ')).toBe('lighter thaj 3');
    expect(normaliseFileName('LIGHTER THAJ 3')).toBe(normaliseFileName('lighter thaj 3'));
  });
});

describe('the day a register entry belongs to', () => {
  /* The production date is what dates the record now, not the in-time. It has
     to be, because the in-time is optional — and because the operator chooses
     the date, often an older day being caught up. */

  it('is local midnight of the date typed', () => {
    const day = registerDay('2026-08-03');
    expect(day).not.toBeNull();
    expect(day?.getFullYear()).toBe(2026);
    expect(day?.getMonth()).toBe(7);
    expect(day?.getDate()).toBe(3);
    expect(day?.getHours()).toBe(0);
    expect(day?.getMinutes()).toBe(0);
  });

  it('agrees with the in-time whenever there is one', () => {
    // The rule this replaces was startOfDay(date + time). Nothing may move for
    // a row that does carry a time, or every existing record shifts.
    for (const time of ['00:00', '09:15', '23:59']) {
      const combined = combineDateAndTime('2026-08-03', time);
      expect(startOfDay(combined as Date).getTime()).toBe(registerDay('2026-08-03')?.getTime());
    }
  });

  it('refuses a day that does not exist rather than rolling into the next month', () => {
    // new Date(2026, 1, 31) is 3 March. A register entry dated 31 February is a
    // typo, and silently filing it under March would hide it from its own day.
    expect(registerDay('2026-02-31')).toBeNull();
    expect(registerDay('2026-13-01')).toBeNull();
    expect(registerDay('2026-00-10')).toBeNull();
  });

  it('refuses anything that is not yyyy-mm-dd', () => {
    expect(registerDay('03-08-2026')).toBeNull();
    expect(registerDay('2026-8-3')).toBeNull();
    expect(registerDay('')).toBeNull();
    expect(registerDay('today')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(registerDay('  2026-08-03  ')?.getDate()).toBe(3);
  });
});
