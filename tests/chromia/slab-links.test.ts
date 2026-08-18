import { describe, expect, it } from 'vitest';

import { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { needsIntakeQc, slabHref } from '@/lib/chromia/slab-links';

describe('where a slab number leads', () => {
  it('opens the intake form while the slab still needs grading', () => {
    for (const status of [
      SlabStatus.RECEIVED,
      SlabStatus.IN_PROCESS,
      SlabStatus.UNDER_INSPECTION,
    ]) {
      expect(needsIntakeQc(status)).toBe(true);
      expect(slabHref('abc', status)).toBe('/chromia/slabs/new?slab=abc');
    }
  });

  it('is plain text once the slab has been graded', () => {
    // There is no per-slab page any more, so a finished number links nowhere
    // rather than to a route that no longer exists.
    for (const status of [
      SlabStatus.GRADED,
      SlabStatus.IN_STOCK,
      SlabStatus.DISPATCHED,
      SlabStatus.SAMPLE_CUT,
      SlabStatus.WASTE,
      SlabStatus.ON_HOLD,
    ]) {
      expect(needsIntakeQc(status)).toBe(false);
      expect(slabHref('abc', status)).toBeNull();
    }
  });

  it('leaves recalibration to the recalibration section', () => {
    // A slab at the facility is not re-graded on the intake form; it is
    // received back and restarted from the Recalibration page.
    expect(slabHref('abc', SlabStatus.OUT_FOR_RECALIBRATION)).toBeNull();
    expect(slabHref('abc', SlabStatus.RECEIVED_FROM_RECALIBRATION)).toBeNull();
  });
});
