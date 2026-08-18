import { describe, expect, it } from 'vitest';

import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { slabStatusView } from '@/lib/chromia/slab-status-label';

describe('a slab QC has condemned', () => {
  it('reads "Pending Recalibration", not "Graded"', () => {
    // Every slab that has ever been through QC is graded, so "Graded" tells
    // nobody anything — least of all that the slab is waiting to go out.
    const view = slabStatusView(SlabStatus.GRADED, Disposition.RECALIBRATION);
    expect(view.label).toBe('Pending Recalibration');
    expect(view.tone).toBe('recalibration');
  });

  it('says the same thing on the second and fifth condemnation', () => {
    // The status does not walk through lifecycle names as the loop repeats:
    // waiting to be sent is waiting to be sent, whichever attempt it is.
    for (const status of [
      SlabStatus.GRADED,
      SlabStatus.RECEIVED_FROM_RECALIBRATION,
      SlabStatus.IN_PROCESS,
    ]) {
      expect(slabStatusView(status, Disposition.RECALIBRATION).label).toBe(
        'Pending Recalibration',
      );
    }
  });

  it('keeps its own name while the slab is physically away', () => {
    // "Pending" would be a lie about where the slab is.
    expect(
      slabStatusView(SlabStatus.OUT_FOR_RECALIBRATION, Disposition.RECALIBRATION).label,
    ).toBe('Out for Recalibration');
  });

  it('says written off once the last attempt has failed', () => {
    const view = slabStatusView(SlabStatus.WASTE, Disposition.RECALIBRATION);
    expect(view.label).toBe('Written Off / Waste');
    expect(view.tone).toBe('waste');
  });
});

describe('every other slab', () => {
  it('keeps the status name it always had', () => {
    expect(slabStatusView(SlabStatus.IN_PROCESS, null).label).toBe('In Processing');
    expect(slabStatusView(SlabStatus.UNDER_INSPECTION, null).label).toBe('Awaiting QC');
    expect(slabStatusView(SlabStatus.DISPATCHED, Disposition.DISPATCH).label).toBe('Dispatched');
    expect(slabStatusView(SlabStatus.IN_STOCK, Disposition.STOCK).label).toBe('In Stock');
    expect(slabStatusView(SlabStatus.SAMPLE_CUT, Disposition.SAMPLE_CUTTING).label).toBe(
      'Sample Cut',
    );
  });

  it('works with no outcome passed at all', () => {
    expect(slabStatusView(SlabStatus.GRADED).label).toBe('Graded');
  });

  it('gives every status a tone', () => {
    for (const status of Object.values(SlabStatus)) {
      expect(slabStatusView(status, null).tone).toBeTruthy();
    }
  });
});
