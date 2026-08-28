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
  it('builds the instant the register date and in-time name in plant time', () => {
    // Asserted through the plant-time formatters rather than getHours(), which
    // reads the server's own clock: on the UTC host this runs on, 09:15 in the
    // plant is 03:45 there, and the whole point is that it comes back 09:15.
    const result = combineDateAndTime('2026-08-03', '09:15');
    expect(result).not.toBeNull();
    expect(toDateInput(result as Date)).toBe('2026-08-03');
    expect(toTimeInput(result as Date)).toBe('09:15');
  });

  it('keeps the seconds it was given', () => {
    // The India offset is a whole number of minutes, so seconds never move.
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
  // Fed instants built from a known plant wall clock, so the assertions hold
  // whatever timezone the test host is in — the whole reason plant-time.ts
  // exists. A date that crosses UTC midnight in the plant is the interesting
  // case: 23:30 on the 3rd, plant time, must still read as the 3rd.
  it('formats the date in plant time', () => {
    expect(toDateInput(combineDateAndTime('2026-08-03', '23:30') as Date)).toBe('2026-08-03');
    expect(toDateInput(combineDateAndTime('2026-01-09', '01:05') as Date)).toBe('2026-01-09');
  });

  it('pads the time in plant time', () => {
    expect(toTimeInput(combineDateAndTime('2026-08-03', '09:05') as Date)).toBe('09:05');
    expect(toTimeInput(combineDateAndTime('2026-08-03', '14:30') as Date)).toBe('14:30');
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

  it('keeps the in-time on the day it was entered, whatever the hour', () => {
    // The production date is the day the operator typed. Its in-time, at any
    // hour of that day, stays on the same plant day — 00:00 does not slip to
    // the day before, nor 23:59 to the day after, which is what a naive UTC
    // parse would have done at the edges.
    for (const time of ['00:00', '09:15', '23:59']) {
      const combined = combineDateAndTime('2026-08-03', time);
      expect(toDateInput(combined as Date)).toBe('2026-08-03');
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
