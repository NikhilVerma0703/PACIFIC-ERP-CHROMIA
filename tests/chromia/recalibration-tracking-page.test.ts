import { describe, expect, it } from 'vitest';

import { buildTrackingKpis, attemptOf, type TrackedSlab } from '@/lib/chromia/recalibration-kpis';
import { MAX_ATTEMPTS } from '@/lib/chromia/recalibration-flow';
import {
  ATTEMPT_CHOICES,
  buildQuery,
  endOfDay,
  hasActiveFilters,
  matchesText,
  parseTrackingFilters,
} from '@/lib/chromia/recalibration-tracking-filters';

const day = (d: number) => new Date(2026, 7, d);

const trip = (attemptNumber: number, done = true) => ({
  attemptNumber,
  sentDate: day(1),
  receivedDate: done ? day(4) : null,
  restartedAt: done ? day(5) : null,
});

/** A slab that has finished `n` trips and is waiting to be sent again. */
const afterTrips = (n: number): TrackedSlab => ({
  disposition: 'RECALIBRATION',
  writtenOff: false,
  trips: Array.from({ length: n }, (_, i) => trip(i + 1)),
});

describe('the tracking figures', () => {
  it('counts every slab in the recovery loop', () => {
    const kpis = buildTrackingKpis([afterTrips(0), afterTrips(1), afterTrips(3)]);
    expect(kpis.total).toBe(3);
  });

  it('reads down as a funnel, not as a set of buckets', () => {
    // A slab on its third trip has completed the first and second too, so
    // "1st completed" is always the widest figure. That is the point: it shows
    // how many slabs the plant saved first time and how many kept coming back.
    const kpis = buildTrackingKpis([afterTrips(1), afterTrips(2), afterTrips(3)]);
    expect(kpis.completed.map((bucket) => bucket.count)).toEqual([3, 2, 1, 0, 0]);
  });

  it('names each figure the way the plant says it', () => {
    const kpis = buildTrackingKpis([]);
    expect(kpis.completed.map((bucket) => bucket.label)).toEqual([
      '1st Time Recalibration Completed',
      '2nd Time Recalibration Completed',
      '3rd Time Recalibration Completed',
      '4th Time Recalibration Completed',
      '5th Time Recalibration Completed',
    ]);
  });

  it('separates waiting in the plant from actually being away', () => {
    const waiting = afterTrips(0);
    const away: TrackedSlab = {
      disposition: 'RECALIBRATION',
      writtenOff: false,
      trips: [trip(1, false)],
    };

    const kpis = buildTrackingKpis([waiting, away]);
    expect(kpis.waiting).toBe(1);
    expect(kpis.out).toBe(1);
  });

  it('counts write-offs and slabs the recalibration saved', () => {
    const written: TrackedSlab = {
      disposition: 'RECALIBRATION',
      writtenOff: true,
      trips: Array.from({ length: MAX_ATTEMPTS }, (_, i) => trip(i + 1)),
    };
    const saved: TrackedSlab = { disposition: 'DISPATCH', writtenOff: false, trips: [trip(1)] };

    const kpis = buildTrackingKpis([written, saved]);
    expect(kpis.writtenOff).toBe(1);
    expect(kpis.cleared).toBe(1);
  });

  it('never counts a trip past the fifth', () => {
    const overrun: TrackedSlab = {
      disposition: 'RECALIBRATION',
      writtenOff: true,
      trips: Array.from({ length: 7 }, (_, i) => trip(i + 1)),
    };
    expect(buildTrackingKpis([overrun]).completed).toHaveLength(MAX_ATTEMPTS);
  });

  it('agrees with the Recalibration page about the attempt number', () => {
    expect(attemptOf(afterTrips(2))).toBe(2);
    expect(attemptOf(afterTrips(0))).toBe(0);
  });
});

describe('the tracking filters', () => {
  it('offers nought through five', () => {
    expect([...ATTEMPT_CHOICES]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('reads a filter out of the query string', () => {
    const filters = parseTrackingFilters({
      batchNo: ' 1245 ',
      slabNo: '85477',
      attempt: '2',
      receivedFrom: '2026-08-01',
    });

    expect(filters.batchNo).toBe('1245');
    expect(filters.slabNo).toBe('85477');
    expect(filters.attempt).toBe(2);
    expect(filters.receivedFrom).toBeInstanceOf(Date);
  });

  it('keeps attempt 0 rather than reading it as "not set"', () => {
    // Nought is a real answer here: condemned, never sent.
    expect(parseTrackingFilters({ attempt: '0' }).attempt).toBe(0);
    expect(parseTrackingFilters({}).attempt).toBeNull();
  });

  it('ignores an attempt that is not on the list', () => {
    expect(parseTrackingFilters({ attempt: '9' }).attempt).toBeNull();
    expect(parseTrackingFilters({ attempt: 'two' }).attempt).toBeNull();
  });

  it('knows when anything is set', () => {
    expect(hasActiveFilters(parseTrackingFilters({}))).toBe(false);
    expect(hasActiveFilters(parseTrackingFilters({ attempt: '0' }))).toBe(true);
    expect(hasActiveFilters(parseTrackingFilters({ slabNo: '1' }))).toBe(true);
  });

  it('round-trips through the query string', () => {
    const filters = parseTrackingFilters({ batchNo: '1245', attempt: '3' });
    const query = buildQuery(filters);
    expect(parseTrackingFilters(Object.fromEntries(new URLSearchParams(query)))).toEqual(filters);
  });

  it('takes the whole of the "to" day', () => {
    // Midnight would drop everything received on that very day.
    const end = endOfDay(new Date(2026, 7, 12));
    expect(end.getDate()).toBe(12);
    expect(end.getHours()).toBe(23);
  });

  it('matches text loosely, because nobody types a whole batch number', () => {
    expect(matchesText('1245', '24')).toBe(true);
    expect(matchesText('Astral Mist', 'astral')).toBe(true);
    expect(matchesText('Astral Mist', 'zzz')).toBe(false);
    expect(matchesText(null, '')).toBe(true);
  });
});
