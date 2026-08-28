import { describe, expect, it } from 'vitest';

import { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { needsIntakeQc, slabHref } from '@/lib/chromia/slab-links';

describe('where a slab number leads', () => {
  it('opens the operator screen while the slab still needs grading', () => {
    for (const status of [
      SlabStatus.RECEIVED,
      SlabStatus.IN_PROCESS,
      SlabStatus.UNDER_INSPECTION,
    ]) {
      expect(needsIntakeQc(status)).toBe(true);
      // QC moved onto the operator's own screen, under the entry the slab was
      // booked on. /chromia/slabs/new still exists and redirects here.
      expect(slabHref('abc', status)).toBe('/chromia/operator?slab=abc');
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

  it('carries the filters back through QC when given a `back` query', () => {
    // The filtered Slab Records view the row was found under, so completing QC
    // returns there instead of the bare list. Encoded so its own & and = are
    // one parameter's value, not more parameters on the operator URL.
    const back = 'batchNo=1245&receivedFrom=2026-02-01&receivedTo=2026-02-28';
    expect(slabHref('abc', SlabStatus.IN_PROCESS, back)).toBe(
      `/chromia/operator?slab=abc&back=${encodeURIComponent(back)}`,
    );
    // A blank back changes nothing.
    expect(slabHref('abc', SlabStatus.IN_PROCESS, '')).toBe('/chromia/operator?slab=abc');
    // And it is never bolted onto a slab that has nowhere to go.
    expect(slabHref('abc', SlabStatus.IN_STOCK, back)).toBeNull();
  });
});
