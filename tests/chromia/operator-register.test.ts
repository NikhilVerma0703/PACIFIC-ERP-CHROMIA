import { describe, expect, it } from 'vitest';

import {
  combineDateAndTime,
  designCodeFromFileName,
  endOfDay,
  normaliseFileName,
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
