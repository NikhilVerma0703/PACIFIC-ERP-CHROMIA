import { describe, expect, it } from 'vitest';

import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import {
  attemptBudget,
  averageTurnaround,
  canRecalibrateAgain,
  deriveStage,
  isClosed,
  totalMaterialRemoved,
  tripVerdict,
  type StageInput,
  type TripSummary,
} from '@/lib/chromia/recalibration-tracking';

function stage(overrides: Partial<StageInput> = {}) {
  return deriveStage({
    status: SlabStatus.IN_PROCESS,
    currentDisposition: null,
    latestOutTime: null,
    latestHasQc: false,
    ...overrides,
  });
}

function trip(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    attemptNumber: 1,
    reason: 'Roller Mark',
    sentDate: new Date(2026, 4, 15),
    receivedDate: new Date(2026, 4, 19),
    turnaroundDays: 4,
    thicknessBeforeMm: '20',
    thicknessAfterMm: '18.5',
    failedCycleNumber: 1,
    restartedCycleNumber: 2,
    outcomeGrade: 'A',
    outcomeDisposition: Disposition.DISPATCH,
    ...overrides,
  };
}

describe('deriving the stage', () => {
  it('closes the journey on a terminal outcome', () => {
    expect(stage({ status: SlabStatus.DISPATCHED })).toBe('PASSED');
    expect(stage({ status: SlabStatus.IN_STOCK })).toBe('PASSED');
    expect(stage({ status: SlabStatus.SAMPLE_CUT })).toBe('PASSED');
    expect(stage({ status: SlabStatus.WASTE })).toBe('WRITTEN_OFF');
  });

  it('reports where the slab physically is', () => {
    expect(stage({ status: SlabStatus.OUT_FOR_RECALIBRATION })).toBe('AT_FACILITY');
    expect(stage({ status: SlabStatus.RECEIVED_FROM_RECALIBRATION })).toBe('AWAITING_RESTART');
  });

  it('separates graded-for-recalibration from graded-for-anything-else', () => {
    expect(
      stage({ status: SlabStatus.GRADED, currentDisposition: Disposition.RECALIBRATION }),
    ).toBe('AWAITING_DESPATCH');

    expect(stage({ status: SlabStatus.GRADED, currentDisposition: Disposition.DISPATCH })).toBe(
      'AWAITING_QC',
    );
  });

  it('tells reprocessing from awaiting QC by the out-time', () => {
    expect(stage({ status: SlabStatus.IN_PROCESS })).toBe('REPROCESSING');
    expect(stage({ status: SlabStatus.IN_PROCESS, latestOutTime: new Date() })).toBe('AWAITING_QC');
    expect(
      stage({ status: SlabStatus.IN_PROCESS, latestOutTime: new Date(), latestHasQc: true }),
    ).toBe('REPROCESSING');
  });

  it('a terminal status always wins over a stale cycle', () => {
    expect(stage({ status: SlabStatus.DISPATCHED, latestOutTime: null })).toBe('PASSED');
  });
});

describe('the attempt ceiling', () => {
  it('counts up to five and no further', () => {
    expect(attemptBudget(0)).toMatchObject({ used: 0, remaining: 5, exhausted: false });
    expect(attemptBudget(1)).toMatchObject({ used: 1, remaining: 4, exhausted: false });
    expect(attemptBudget(5)).toMatchObject({ used: 5, remaining: 0, exhausted: true });
  });

  it('clamps nonsense rather than reporting negative attempts', () => {
    expect(attemptBudget(-3).used).toBe(0);
    expect(attemptBudget(99)).toMatchObject({ used: 5, remaining: 0, exhausted: true });
  });

  it('allows a further trip only while the journey is open and under the ceiling', () => {
    expect(canRecalibrateAgain('AWAITING_DESPATCH', 1)).toBe(true);
    expect(canRecalibrateAgain('AWAITING_DESPATCH', 5)).toBe(false);

    // The rule that matters: passing QC ends it, however many attempts are left.
    expect(canRecalibrateAgain('PASSED', 1)).toBe(false);
    expect(canRecalibrateAgain('WRITTEN_OFF', 0)).toBe(false);
  });

  it('knows which stages are closed', () => {
    expect(isClosed('PASSED')).toBe(true);
    expect(isClosed('WRITTEN_OFF')).toBe(true);
    expect(isClosed('AT_FACILITY')).toBe(false);
  });
});

describe('judging a trip', () => {
  it('is fixed when the following pass graded A or B', () => {
    expect(tripVerdict(trip({ outcomeGrade: 'A' }))).toBe('FIXED');
    expect(tripVerdict(trip({ outcomeGrade: 'B' }))).toBe('FIXED');
  });

  it('failed again when the following pass graded C', () => {
    expect(tripVerdict(trip({ outcomeGrade: 'C' }))).toBe('FAILED_AGAIN');
  });

  it('is honestly unknown until the slab has been graded again', () => {
    expect(tripVerdict(trip({ outcomeGrade: null, restartedCycleNumber: 2 }))).toBe('PENDING');
    expect(tripVerdict(trip({ outcomeGrade: null, restartedCycleNumber: null }))).toBe('PENDING');
  });
});

describe('journey totals', () => {
  it('adds up the thickness lost across trips', () => {
    const trips = [
      trip({ thicknessBeforeMm: '20', thicknessAfterMm: '18.5' }),
      trip({ attemptNumber: 2, thicknessBeforeMm: '18.5', thicknessAfterMm: '17' }),
    ];
    expect(totalMaterialRemoved(trips)).toBeCloseTo(3);
  });

  it('ignores trips with no measurements rather than counting them as zero loss', () => {
    const trips = [
      trip({ thicknessBeforeMm: '20', thicknessAfterMm: '18.5' }),
      trip({ attemptNumber: 2, thicknessBeforeMm: null, thicknessAfterMm: null }),
    ];
    expect(totalMaterialRemoved(trips)).toBeCloseTo(1.5);
  });

  it('averages only the trips that have come back', () => {
    expect(
      averageTurnaround([
        trip({ turnaroundDays: 4 }),
        trip({ attemptNumber: 2, turnaroundDays: 8 }),
      ]),
    ).toBe(6);

    expect(averageTurnaround([trip({ turnaroundDays: null })])).toBeNull();
    expect(averageTurnaround([])).toBeNull();
  });
});
