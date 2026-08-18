import { describe, expect, it } from 'vitest';

import { labelStride, niceScale, wrapLabel } from '@/components/chromia/charts/chart-ink';

describe('axis ticks', () => {
  it('rounds to numbers a person would choose', () => {
    // 0, 3.33, 6.67, 10 is what naive division gives and nobody reads.
    expect(niceScale(10).ticks).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceScale(7).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(43).ticks).toEqual([0, 20, 40, 60]);
  });

  it('always starts at zero, so bar heights are honest', () => {
    for (const max of [1, 6, 19, 250, 1234]) {
      expect(niceScale(max).ticks[0]).toBe(0);
    }
  });

  it('always reaches the tallest value', () => {
    for (const max of [1, 3, 17, 99, 4001]) {
      expect(niceScale(max).max).toBeGreaterThanOrEqual(max);
    }
  });

  it('survives a period in which nothing happened', () => {
    expect(niceScale(0).ticks).toEqual([0, 1]);
    expect(niceScale(-5).max).toBe(1);
  });
});

describe('x-axis labels', () => {
  it('shows every day when the days are far apart', () => {
    expect(labelStride(7, 90)).toBe(1);
  });

  it('thins them when a month has to fit', () => {
    // Thirty-one dates at 20px apart cannot all be read; skipping beats
    // overlapping, and overlapping beats nothing only in the wrong direction.
    expect(labelStride(31, 20)).toBeGreaterThan(1);
  });

  it('never divides by zero on a single day', () => {
    expect(labelStride(1, 0)).toBe(1);
    expect(labelStride(5, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('category labels', () => {
  it('keeps the part that tells two materials apart', () => {
    // Truncated to one line these are the same string, and two different
    // materials read as one — the failure this wrapping exists to prevent.
    expect(wrapLabel('Bianco crisstallo')).toEqual(['Bianco', 'crisstallo']);
    expect(wrapLabel('Bianco crisstallo 3cm')).toEqual(['Bianco', 'crisstallo 3cm']);
  });

  it('leaves a short name alone', () => {
    expect(wrapLabel('Astral Mist')).toEqual(['Astral Mist']);
  });

  it('never returns more lines than there is room for', () => {
    expect(wrapLabel('One Two Three Four Five Six Seven').length).toBeLessThanOrEqual(2);
  });

  it('cuts a single unbreakable word rather than letting it overflow', () => {
    expect(wrapLabel('CRISTALLOFINALVERSION')[0]).toContain('…');
  });
});

