import { describe, expect, it } from 'vitest';

import { ChromiaSlabGrade as SlabGrade } from '@prisma/client';
import {
  buildAttemptDistribution,
  buildDailyProduction,
  buildGradeAnalysis,
  buildRecalibrationAnalysis,
  dayKey,
  defaultRange,
  parseRange,
  totalsOf,
} from '@/lib/chromia/reports';

const NOW = new Date(2026, 4, 20, 12, 0, 0); // 20 May 2026, local

describe('date range', () => {
  it('defaults to the last 30 days, inclusive', () => {
    const range = defaultRange(NOW);
    expect(dayKey(range.to)).toBe('2026-05-20');
    expect(dayKey(range.from)).toBe('2026-04-21');
    expect(range.from.getHours()).toBe(0);
    expect(range.to.getHours()).toBe(23);
  });

  it('falls back when a date is unparseable', () => {
    const range = parseRange('rubbish', '', NOW);
    expect(dayKey(range.to)).toBe('2026-05-20');
  });

  it('swaps a reversed range instead of returning nothing', () => {
    const range = parseRange('2026-05-20', '2026-05-01', NOW);
    expect(dayKey(range.from)).toBe('2026-05-01');
    expect(dayKey(range.to)).toBe('2026-05-20');
  });

  it('covers the whole of the end day', () => {
    const range = parseRange('2026-05-01', '2026-05-31', NOW);
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
  });
});

describe('daily production', () => {
  const d = (day: number, hour = 9) => new Date(2026, 4, day, hour);

  it('groups activity by calendar day, newest first', () => {
    const rows = buildDailyProduction({
      received: [{ at: d(1) }, { at: d(1, 18) }, { at: d(2) }],
      processingCompleted: [{ at: d(2) }],
      qualityChecks: [],
      dispatched: [{ at: d(3) }],
      sentForRecalibration: [{ at: d(1) }],
    });

    expect(rows.map((r) => r.day)).toEqual(['2026-05-03', '2026-05-02', '2026-05-01']);
    expect(rows.at(-1)).toMatchObject({ received: 2, sentForRecalibration: 1 });
    expect(rows[1]).toMatchObject({ received: 1, processingCompleted: 1 });
  });

  it('omits days with no activity at all', () => {
    const rows = buildDailyProduction({
      received: [{ at: d(1) }],
      processingCompleted: [],
      qualityChecks: [],
      dispatched: [],
      sentForRecalibration: [],
    });
    expect(rows).toHaveLength(1);
  });

  it('totals every column', () => {
    const rows = buildDailyProduction({
      received: [{ at: d(1) }, { at: d(2) }],
      processingCompleted: [{ at: d(1) }],
      qualityChecks: [{ at: d(1) }, { at: d(2) }, { at: d(3) }],
      dispatched: [],
      sentForRecalibration: [],
    });
    expect(totalsOf(rows)).toMatchObject({
      received: 2,
      processingCompleted: 1,
      qualityChecks: 3,
      dispatched: 0,
    });
  });
});

describe('grade analysis', () => {
  it('splits grades per group and computes percentages', () => {
    const rows = buildGradeAnalysis([
      { name: 'Coastal Pearl', grade: SlabGrade.A },
      { name: 'Coastal Pearl', grade: SlabGrade.A },
      { name: 'Coastal Pearl', grade: SlabGrade.C },
      { name: 'Maple Gaze', grade: SlabGrade.B },
    ]);

    expect(rows[0]).toMatchObject({
      name: 'Coastal Pearl',
      a: 2,
      c: 1,
      total: 3,
      aPercent: 67,
      cPercent: 33,
    });
  });

  it('sorts by volume so the biggest producers lead', () => {
    const rows = buildGradeAnalysis([
      { name: 'Small', grade: SlabGrade.A },
      { name: 'Big', grade: SlabGrade.A },
      { name: 'Big', grade: SlabGrade.B },
    ]);
    expect(rows[0]?.name).toBe('Big');
  });

  it('ignores ungraded slabs', () => {
    expect(buildGradeAnalysis([{ name: 'X', grade: null }])).toEqual([]);
  });
});

describe('recalibration analysis', () => {
  it('counts sent, returned and outstanding per reason', () => {
    const rows = buildRecalibrationAnalysis([
      { reason: 'Half Print', turnaroundDays: 6, returned: true },
      { reason: 'Half Print', turnaroundDays: 4, returned: true },
      { reason: 'Half Print', turnaroundDays: null, returned: false },
      { reason: 'Red Colour', turnaroundDays: 9, returned: true },
    ]);

    expect(rows[0]).toMatchObject({
      reason: 'Half Print',
      sent: 3,
      returned: 2,
      outstanding: 1,
      averageTurnaroundDays: 5,
    });
  });

  it('reports no average when nothing has come back', () => {
    const rows = buildRecalibrationAnalysis([
      { reason: 'Half Print', turnaroundDays: null, returned: false },
    ]);
    expect(rows[0]?.averageTurnaroundDays).toBeNull();
  });

  it('labels a missing reason rather than dropping the row', () => {
    const rows = buildRecalibrationAnalysis([
      { reason: null, turnaroundDays: 2, returned: true },
    ]);
    expect(rows[0]?.reason).toBe('Not recorded');
  });
});

describe('attempt distribution', () => {
  it('covers zero through the ceiling', () => {
    const rows = buildAttemptDistribution(
      [
        { recalibrationCount: 0 },
        { recalibrationCount: 0 },
        { recalibrationCount: 5 },
      ],
      5,
    );
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ attempts: 0, slabs: 2 });
    expect(rows[5]).toEqual({ attempts: 5, slabs: 1 });
  });
});
