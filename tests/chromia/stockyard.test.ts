import { describe, expect, it } from 'vitest';

import { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { isWriteOff, MAX_ATTEMPTS, type Trip } from '@/lib/chromia/recalibration-flow';
import { daysBetween } from '@/lib/chromia/utils/dates';
import { stockRecalibrationSchema, stockReleaseSchema } from '@/lib/chromia/validation/stockyard';

const SLAB_ID = '3f6d2b1e-2f2a-4f2e-9c3a-1b2c3d4e5f60';

/**
 * The stockyard is one step — a slab leaves the rack on a day somebody has to
 * type in, because it is rarely today. These tests pin the two things that step
 * cannot get wrong: the date is compulsory, and it is the day that was typed.
 */
describe('stock release validation', () => {
  it('accepts a slab and a dispatch date', () => {
    const result = stockReleaseSchema.safeParse({
      slabId: SLAB_ID,
      dispatchDate: '2026-08-08',
    });

    expect(result.success).toBe(true);
    expect(result.data?.dispatchDate).toBeInstanceOf(Date);
  });

  it('refuses a release with no dispatch date', () => {
    expect(stockReleaseSchema.safeParse({ slabId: SLAB_ID }).success).toBe(false);
    expect(stockReleaseSchema.safeParse({ slabId: SLAB_ID, dispatchDate: '' }).success).toBe(false);
  });

  it('refuses a dispatch date that is not a date', () => {
    expect(
      stockReleaseSchema.safeParse({ slabId: SLAB_ID, dispatchDate: 'last Tuesday' }).success,
    ).toBe(false);
  });

  it('refuses a release with no slab', () => {
    expect(stockReleaseSchema.safeParse({ dispatchDate: '2026-08-08' }).success).toBe(false);
    expect(
      stockReleaseSchema.safeParse({ slabId: 'not-a-slab', dispatchDate: '2026-08-08' }).success,
    ).toBe(false);
  });

  it('keeps the day that was typed, not UTC midnight', () => {
    // Read as UTC, "2026-08-08" is 05:30 on the 8th in India and still the 7th
    // in the Americas. A dispatch must fall on the day it was written down.
    const result = stockReleaseSchema.safeParse({ slabId: SLAB_ID, dispatchDate: '2026-08-08' });
    const date = result.data?.dispatchDate;

    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(8);
    expect(date?.getHours()).toBe(0);
  });
});

/**
 * Send to recalibration takes no date — marking a slab only opens its waiting
 * record; the day it physically leaves is entered later on the Recalibration
 * page. So the slab id is all this validates.
 */
describe('stock recalibration validation', () => {
  it('accepts a slab on its own', () => {
    expect(stockRecalibrationSchema.safeParse({ slabId: SLAB_ID }).success).toBe(true);
  });

  it('refuses a request with no slab, or one that is not a slab id', () => {
    expect(stockRecalibrationSchema.safeParse({}).success).toBe(false);
    expect(stockRecalibrationSchema.safeParse({ slabId: 'not-a-slab' }).success).toBe(false);
  });
});

/**
 * Mirrors the guard shared by stockyard-service.releaseFromStock AND
 * sendStockToRecalibration: both exits from the rack refuse anything that is
 * not on it.
 */
function canLeaveRack(status: SlabStatus): boolean {
  return status === SlabStatus.IN_STOCK;
}

describe('only stocked slabs can leave the rack', () => {
  it('lets a slab that is on a rack be dispatched or sent for recalibration', () => {
    expect(canLeaveRack(SlabStatus.IN_STOCK)).toBe(true);
  });

  it('refuses everything else, so the page cannot touch the live line', () => {
    for (const status of [
      SlabStatus.RECEIVED,
      SlabStatus.IN_PROCESS,
      SlabStatus.UNDER_INSPECTION,
      SlabStatus.GRADED,
      SlabStatus.OUT_FOR_RECALIBRATION,
      SlabStatus.DISPATCHED,
      SlabStatus.SAMPLE_CUT,
      SlabStatus.WASTE,
    ]) {
      expect(canLeaveRack(status)).toBe(false);
    }
  });
});

/**
 * Sending from stock refuses a slab that has already used every recalibration
 * attempt — mirrors the guard in sendStockToRecalibration. Without it the
 * shared mark-awaiting would write the slab off as waste behind a button that
 * says "send for recalibration", and report it back as a success.
 */
function canSendFromStock(status: SlabStatus, trips: readonly Trip[]): boolean {
  return status === SlabStatus.IN_STOCK && !isWriteOff(trips);
}

const trip = (sentDate: Date | null): Trip => ({
  attemptNumber: 1,
  sentDate,
  receivedDate: null,
  restartedAt: null,
});

describe('sending a stocked slab for recalibration', () => {
  it('allows a stocked slab with attempts to spare', () => {
    expect(canSendFromStock(SlabStatus.IN_STOCK, [])).toBe(true);
    // Four sent trips, one attempt left.
    const four = Array.from({ length: MAX_ATTEMPTS - 1 }, () => trip(new Date(2026, 0, 1)));
    expect(canSendFromStock(SlabStatus.IN_STOCK, four)).toBe(true);
  });

  it('refuses a slab that has used every attempt, rather than writing it off', () => {
    const spent = Array.from({ length: MAX_ATTEMPTS }, () => trip(new Date(2026, 0, 1)));
    expect(canSendFromStock(SlabStatus.IN_STOCK, spent)).toBe(false);
  });

  it('refuses anything not on a rack, whatever its trips', () => {
    expect(canSendFromStock(SlabStatus.IN_PROCESS, [])).toBe(false);
    expect(canSendFromStock(SlabStatus.DISPATCHED, [])).toBe(false);
  });
});

describe('days in stock', () => {
  it('counts whole days between stocking and dispatch', () => {
    const stocked = new Date(2026, 7, 1);
    const dispatched = new Date(2026, 7, 8);
    expect(daysBetween(stocked, dispatched)).toBe(7);
  });

  it('reads a same-day dispatch as zero rather than a negative', () => {
    const day = new Date(2026, 7, 8);
    expect(daysBetween(day, day)).toBe(0);
    expect(daysBetween(new Date(2026, 7, 9), day)).toBe(0);
  });
});
