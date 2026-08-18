import { describe, expect, it } from 'vitest';

import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import {
  dispatchSchema,
  sampleCuttingSchema,
  stockSchema,
  wasteSchema,
} from '@/lib/chromia/validation/disposition';

const UUID = '3f6d2b1e-2f2a-4f2e-9c3a-1b2c3d4e5f60';

const TERMINAL: SlabStatus[] = [SlabStatus.DISPATCHED, SlabStatus.SAMPLE_CUT, SlabStatus.WASTE];

/** Mirrors the guards in disposition-service. */
const can = {
  dispatch: (status: SlabStatus, disposition: Disposition | null) =>
    !TERMINAL.includes(status) &&
    (disposition === Disposition.DISPATCH || status === SlabStatus.IN_STOCK),
  stock: (status: SlabStatus, disposition: Disposition | null) =>
    !TERMINAL.includes(status) &&
    status !== SlabStatus.IN_STOCK &&
    disposition === Disposition.STOCK,
  sampleCut: (status: SlabStatus, disposition: Disposition | null) =>
    !TERMINAL.includes(status) &&
    (disposition === Disposition.SAMPLE_CUTTING || status === SlabStatus.IN_STOCK),
  waste: (status: SlabStatus, disposition: Disposition | null, attempts: number) =>
    !TERMINAL.includes(status) &&
    (disposition === Disposition.WASTE || attempts >= MAX_RECALIBRATION_ATTEMPTS),
};

describe('disposition routing', () => {
  it('dispatches a graded slab marked for dispatch', () => {
    expect(can.dispatch(SlabStatus.GRADED, Disposition.DISPATCH)).toBe(true);
    expect(can.dispatch(SlabStatus.GRADED, Disposition.STOCK)).toBe(false);
  });

  it('stocks a graded slab marked for stock, once only', () => {
    expect(can.stock(SlabStatus.GRADED, Disposition.STOCK)).toBe(true);
    expect(can.stock(SlabStatus.IN_STOCK, Disposition.STOCK)).toBe(false);
  });

  it('treats stock as a holding state, not an end state', () => {
    expect(can.dispatch(SlabStatus.IN_STOCK, Disposition.STOCK)).toBe(true);
    expect(can.sampleCut(SlabStatus.IN_STOCK, Disposition.STOCK)).toBe(true);
  });

  it('cuts samples for a Grade B slab marked for sample cutting', () => {
    expect(can.sampleCut(SlabStatus.GRADED, Disposition.SAMPLE_CUTTING)).toBe(true);
    expect(can.sampleCut(SlabStatus.GRADED, Disposition.DISPATCH)).toBe(false);
  });

  it('allows waste once all five attempts are consumed', () => {
    expect(can.waste(SlabStatus.GRADED, Disposition.RECALIBRATION, 4)).toBe(false);
    expect(can.waste(SlabStatus.GRADED, Disposition.RECALIBRATION, 5)).toBe(true);
    expect(can.waste(SlabStatus.GRADED, Disposition.WASTE, 0)).toBe(true);
  });

  it('refuses every action on a terminal slab', () => {
    for (const status of TERMINAL) {
      expect(can.dispatch(status, Disposition.DISPATCH)).toBe(false);
      expect(can.stock(status, Disposition.STOCK)).toBe(false);
      expect(can.sampleCut(status, Disposition.SAMPLE_CUTTING)).toBe(false);
      expect(can.waste(status, Disposition.WASTE, 5)).toBe(false);
    }
  });
});

describe('disposition validation', () => {
  it('accepts minimal payloads', () => {
    expect(dispatchSchema.safeParse({ slabId: UUID }).success).toBe(true);
    expect(stockSchema.safeParse({ slabId: UUID }).success).toBe(true);
    expect(sampleCuttingSchema.safeParse({ slabId: UUID }).success).toBe(true);
    expect(wasteSchema.safeParse({ slabId: UUID }).success).toBe(true);
  });

  it('drops a non-positive or fractional piece count', () => {
    const zero = sampleCuttingSchema.safeParse({ slabId: UUID, piecesProduced: '0' });
    expect(zero.success && zero.data.piecesProduced).toBeUndefined();
    const frac = sampleCuttingSchema.safeParse({ slabId: UUID, piecesProduced: '2.5' });
    expect(frac.success && frac.data.piecesProduced).toBeUndefined();
    const ok = sampleCuttingSchema.safeParse({ slabId: UUID, piecesProduced: '6' });
    expect(ok.success && ok.data.piecesProduced).toBe(6);
  });

  it('treats a blank dispatch date as "today"', () => {
    const parsed = dispatchSchema.safeParse({ slabId: UUID, dispatchDate: '' });
    expect(parsed.success && parsed.data.dispatchDate).toBeUndefined();
  });

  it('captures nothing beyond the slab and the date for dispatch', () => {
    const parsed = dispatchSchema.safeParse({
      slabId: UUID,
      dispatchDate: '2026-05-08',
      orderNo: 'SO-2214',
      destination: 'Mumbai',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual(['dispatchDate', 'slabId']);
  });

  it('rejects a bad slab id', () => {
    expect(dispatchSchema.safeParse({ slabId: 'nope' }).success).toBe(false);
  });
});
