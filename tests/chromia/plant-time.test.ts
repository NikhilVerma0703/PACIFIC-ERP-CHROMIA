import { describe, expect, it } from 'vitest';

import {
  formatPlantDate,
  formatPlantDateTime,
  formatPlantTime,
  plantInstant,
  toPlantDateInput,
  toPlantTimeInput,
} from '@/lib/chromia/plant-time';

/**
 * The one clock the whole module reads and writes by: Asia/Kolkata, +05:30, no
 * DST. Every assertion below is fed an instant built in UTC and checks the
 * plant-time result, so it holds whatever timezone the test host runs in —
 * which is the entire point of the module (the server runs in UTC, and reading
 * its clock is what showed a 14:53 QC as 09:23).
 */

describe('parsing a plant wall clock into an instant', () => {
  it('is +05:30 ahead of UTC', () => {
    // 14:53 in the plant is 09:23 UTC.
    expect(plantInstant(2026, 8, 24, 14, 53).toISOString()).toBe('2026-08-24T09:23:00.000Z');
    // 00:00 in the plant is the evening before, in UTC.
    expect(plantInstant(2026, 8, 24, 0, 0).toISOString()).toBe('2026-08-23T18:30:00.000Z');
  });

  it('round-trips a typed date and time back to what was typed', () => {
    for (const [date, time] of [
      ['2026-08-24', '14:53'],
      ['2026-08-24', '00:00'],
      ['2026-08-24', '23:59'],
      ['2026-01-01', '05:29'],
    ] as const) {
      const [y, mo, d] = date.split('-').map(Number);
      const [h, mi] = time.split(':').map(Number);
      const instant = plantInstant(y, mo, d, h, mi);
      expect(toPlantDateInput(instant)).toBe(date);
      expect(toPlantTimeInput(instant)).toBe(time);
    }
  });
});

describe('formatting an instant in plant time', () => {
  // 09:23 UTC = 14:53 in the plant — the very case that read as 09:23 on screen.
  const instant = new Date('2026-08-24T09:23:00.000Z');

  it('shows the local date, date-time and time', () => {
    expect(formatPlantDate(instant)).toBe('24 Aug 2026');
    expect(formatPlantDateTime(instant)).toBe('24 Aug, 14:53');
    expect(formatPlantTime(instant)).toBe('14:53');
  });

  it('keeps a date-only midnight on its own calendar day', () => {
    // A production date is stored as UTC midnight; +05:30 never rolls it forward
    // a day, so it reads correctly through the plant-time formatter.
    const utcMidnight = new Date('2026-08-24T00:00:00.000Z');
    expect(formatPlantDate(utcMidnight)).toBe('24 Aug 2026');
    expect(toPlantDateInput(utcMidnight)).toBe('2026-08-24');
  });

  it('crosses midnight correctly — an evening instant is still that evening', () => {
    // 20:00 UTC on the 24th is 01:30 on the 25th in the plant.
    const evening = new Date('2026-08-24T20:00:00.000Z');
    expect(formatPlantDateTime(evening)).toBe('25 Aug, 01:30');
  });
});
