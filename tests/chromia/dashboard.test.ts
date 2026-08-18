import { describe, expect, it } from 'vitest';

import { RECALIBRATION_OVERDUE_DAYS } from '@/lib/chromia/constants/process-stages';
import { AGEING_BUCKETS, bucketAgeing, percent } from '@/lib/chromia/dashboard';

const NOW = new Date('2026-05-20T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('recalibration ageing buckets', () => {
  it('covers every age with exactly one bucket', () => {
    for (let days = 0; days <= 40; days += 1) {
      const buckets = bucketAgeing([{ sentAt: daysAgo(days) }], NOW);
      const hit = buckets.filter((b) => b.count === 1);
      expect(hit).toHaveLength(1);
    }
  });

  it('places a slab in the right bucket', () => {
    const buckets = bucketAgeing(
      [
        { sentAt: daysAgo(0) },
        { sentAt: daysAgo(2) },
        { sentAt: daysAgo(5) },
        { sentAt: daysAgo(9) },
        { sentAt: daysAgo(30) },
      ],
      NOW,
    );
    expect(buckets[0]?.count).toBe(2); // 0-3
    expect(buckets[1]?.count).toBe(1); // 4-7
    expect(buckets[2]?.count).toBe(1); // 8-10
    expect(buckets[3]?.count).toBe(1); // overdue
  });

  it('flags only the last bucket as overdue, past the threshold', () => {
    const overdue = AGEING_BUCKETS.at(-1);
    expect(overdue?.min).toBe(RECALIBRATION_OVERDUE_DAYS + 1);
    const buckets = bucketAgeing([], NOW);
    expect(buckets.filter((b) => b.overdue)).toHaveLength(1);
  });

  it('handles an empty outstanding list', () => {
    expect(bucketAgeing([], NOW).every((b) => b.count === 0)).toBe(true);
  });
});

describe('percent', () => {
  it('rounds to whole percent', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 5)).toBe(100);
  });

  it('never divides by zero', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(4, 0)).toBe(0);
  });
});
