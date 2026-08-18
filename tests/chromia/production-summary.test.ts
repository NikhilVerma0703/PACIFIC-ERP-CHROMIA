import { describe, expect, it } from 'vitest';

import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import {
  buildDailyActivity,
  buildHeadline,
  buildMaterialSummary,
  buildOutcomeMix,
  buildRecalibrationFunnel,
  totalDailyRow,
  totalMaterialRow,
  type SummarySlab,
} from '@/lib/chromia/production-summary';

function slab(overrides: Partial<SummarySlab> = {}): SummarySlab {
  return {
    status: SlabStatus.IN_PROCESS,
    disposition: null,
    recalibrationCount: 0,
    returnedFromRecalibration: false,
    materialName: 'Robo Trail',
    ...overrides,
  };
}

/** 10 slabs: 7 clean, 3 recalibrated — 2 saved, 1 written off. */
const COHORT: SummarySlab[] = [
  ...Array.from({ length: 5 }, () =>
    slab({ status: SlabStatus.DISPATCHED, disposition: Disposition.DISPATCH }),
  ),
  slab({ status: SlabStatus.IN_STOCK, disposition: Disposition.STOCK }),
  slab({ status: SlabStatus.IN_PROCESS, disposition: null }),
  slab({
    status: SlabStatus.DISPATCHED,
    disposition: Disposition.DISPATCH,
    recalibrationCount: 1,
    returnedFromRecalibration: true,
    materialName: 'Florence',
  }),
  slab({
    status: SlabStatus.IN_STOCK,
    disposition: Disposition.STOCK,
    recalibrationCount: 2,
    returnedFromRecalibration: true,
    materialName: 'Florence',
  }),
  slab({
    status: SlabStatus.WASTE,
    disposition: Disposition.WASTE,
    recalibrationCount: 5,
    returnedFromRecalibration: true,
    materialName: 'Florence',
  }),
];

describe('headline figures', () => {
  it('measures first-pass yield against everything received', () => {
    const headline = buildHeadline(COHORT);
    expect(headline.received).toBe(10);
    expect(headline.recalibrated).toBe(3);
    expect(headline.firstPass).toBe(7);
    expect(headline.firstPassYield).toBe(70);
    expect(headline.recalibrationRate).toBe(30);
  });

  it('counts the slabs with no outcome decided yet', () => {
    // One slab in the cohort is still IN_PROCESS with no disposition; it must
    // agree with the pie's "Still in process" slice, which reads the same field.
    expect(buildHeadline(COHORT).inProcess).toBe(1);
    expect(buildOutcomeMix(COHORT).find((slice) => slice.key === 'UNDECIDED')?.count).toBe(1);
  });

  it('rates each outcome against everything received', () => {
    const headline = buildHeadline(COHORT);
    // 6 dispatched, 2 stocked, 0 sample cut, of 10 received.
    expect(headline.dispatched).toBe(6);
    expect(headline.dispatchRate).toBe(60);
    expect(headline.stocked).toBe(2);
    expect(headline.stockRate).toBe(20);
    expect(headline.sampleCut).toBe(0);
    expect(headline.sampleCutRate).toBe(0);
  });

  it('measures recovery against the slabs that actually went', () => {
    const headline = buildHeadline(COHORT);
    expect(headline.savedByRecalibration).toBe(2);
    // 2 of the 3 sent — not 2 of 10.
    expect(headline.recoveryRate).toBe(67);
    expect(headline.waste).toBe(1);
    expect(headline.wasteRate).toBe(10);
  });

  it('never divides by zero on an empty period', () => {
    const headline = buildHeadline([]);
    expect(headline).toMatchObject({
      received: 0,
      inProcess: 0,
      firstPassYield: 0,
      recalibrationRate: 0,
      recoveryRate: 0,
      wasteRate: 0,
    });
  });
});

describe('outcome mix', () => {
  it('drops outcomes with no slabs rather than drawing empty segments', () => {
    const mix = buildOutcomeMix(COHORT);
    expect(mix.map((slice) => slice.key)).toEqual([
      Disposition.DISPATCH,
      Disposition.STOCK,
      Disposition.WASTE,
      'UNDECIDED',
    ]);
  });

  it('counts and shares add up', () => {
    const mix = buildOutcomeMix(COHORT);
    expect(mix.reduce((sum, slice) => sum + slice.count, 0)).toBe(10);
    expect(mix.find((slice) => slice.key === Disposition.DISPATCH)?.count).toBe(6);
    expect(mix.find((slice) => slice.key === 'UNDECIDED')?.count).toBe(1);
  });

  it('gives every segment a colour', () => {
    expect(buildOutcomeMix(COHORT).every((slice) => /^#[0-9a-f]{6}$/i.test(slice.color))).toBe(
      true,
    );
  });
});

describe('recalibration funnel', () => {
  it('narrows step by step against a single base', () => {
    const funnel = buildRecalibrationFunnel(COHORT);
    expect(funnel.map((step) => step.count)).toEqual([10, 3, 3]);
    // Every step is a share of received, so the percentages are comparable.
    expect(funnel.map((step) => step.percent)).toEqual([100, 30, 30]);
  });

  it('holds up when nothing was recalibrated', () => {
    const funnel = buildRecalibrationFunnel([slab(), slab()]);
    expect(funnel.map((step) => step.count)).toEqual([2, 0, 0]);
  });
});

describe('material summary', () => {
  it('groups by material, busiest first', () => {
    const rows = buildMaterialSummary(COHORT);
    expect(rows.map((row) => row.name)).toEqual(['Robo Trail', 'Florence']);
    expect(rows[0]?.received).toBe(7);
    expect(rows[1]?.received).toBe(3);
  });

  it('exposes the recalibration rate per material', () => {
    const rows = buildMaterialSummary(COHORT);
    expect(rows.find((row) => row.name === 'Robo Trail')?.recalibrationRate).toBe(0);
    expect(rows.find((row) => row.name === 'Florence')?.recalibrationRate).toBe(100);
  });

  it('totals the columns and recomputes the rate rather than averaging it', () => {
    const total = totalMaterialRow(buildMaterialSummary(COHORT));
    expect(total.received).toBe(10);
    expect(total.recalibrated).toBe(3);
    expect(total.waste).toBe(1);
    // 3/10, not the mean of 0% and 100%.
    expect(total.recalibrationRate).toBe(30);
  });
});

describe('daily activity diary', () => {
  const may = (day: number, hour = 12) => new Date(2026, 4, day, hour);

  it('counts each event on its own date', () => {
    const rows = buildDailyActivity({
      received: [may(3), may(3), may(4)],
      processingDone: [may(3)],
      dispatched: [may(20)],
      stocked: [may(20), may(20)],
      sampleCut: [may(4)],
      recalibration: [may(3)],
    });

    // Newest first.
    expect(rows.map((row) => row.day)).toEqual(['2026-05-20', '2026-05-04', '2026-05-03']);

    const third = rows.find((row) => row.day === '2026-05-03');
    expect(third).toMatchObject({
      received: 2,
      processingDone: 1,
      dispatched: 0,
      stocked: 0,
      sampleCut: 0,
      recalibration: 1,
    });

    const twentieth = rows.find((row) => row.day === '2026-05-20');
    expect(twentieth).toMatchObject({ received: 0, dispatched: 1, stocked: 2 });
  });

  it('omits days with no activity rather than padding the range', () => {
    const rows = buildDailyActivity({
      received: [may(1)],
      processingDone: [],
      dispatched: [],
      stocked: [],
      sampleCut: [],
      recalibration: [may(9)],
    });
    expect(rows).toHaveLength(2);
  });

  it('keys on the local day, so a late-evening event stays on its own date', () => {
    const rows = buildDailyActivity({
      received: [new Date(2026, 4, 3, 23, 30)],
      processingDone: [],
      dispatched: [],
      stocked: [],
      sampleCut: [],
      recalibration: [],
    });
    expect(rows[0]?.day).toBe('2026-05-03');
  });

  it('totals every column', () => {
    const rows = buildDailyActivity({
      received: [may(3), may(4)],
      processingDone: [may(3)],
      dispatched: [may(4)],
      stocked: [may(4)],
      sampleCut: [],
      recalibration: [may(3), may(3)],
    });

    expect(totalDailyRow(rows)).toMatchObject({
      received: 2,
      processingDone: 1,
      dispatched: 1,
      stocked: 1,
      sampleCut: 0,
      recalibration: 2,
    });
  });

  it('totals to zero on an empty period', () => {
    expect(totalDailyRow([]).received).toBe(0);
  });
});
