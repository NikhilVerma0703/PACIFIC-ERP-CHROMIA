import { describe, expect, it } from 'vitest';

import {
  DISPOSITION_LABELS,
  GRADE_ALLOWED_DISPOSITIONS,
  MAX_RECALIBRATION_ATTEMPTS,
} from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade } from '@prisma/client';
import { qualityCheckSchema } from '@/lib/chromia/validation/quality';

const UUID = '3f6d2b1e-2f2a-4f2e-9c3a-1b2c3d4e5f60';

/** Mirrors the guard in quality-service.recordQualityCheck. */
function dispositionAllowed(grade: SlabGrade, disposition: Disposition, attemptsUsed: number) {
  if (!GRADE_ALLOWED_DISPOSITIONS[grade].includes(disposition)) return false;
  if (disposition === Disposition.RECALIBRATION && attemptsUsed >= MAX_RECALIBRATION_ATTEMPTS) {
    return false;
  }
  return true;
}

describe('grade routing', () => {
  it('sends Grade A only to dispatch or stock', () => {
    expect(dispositionAllowed(SlabGrade.A, Disposition.DISPATCH, 0)).toBe(true);
    expect(dispositionAllowed(SlabGrade.A, Disposition.STOCK, 0)).toBe(true);
    expect(dispositionAllowed(SlabGrade.A, Disposition.SAMPLE_CUTTING, 0)).toBe(false);
    expect(dispositionAllowed(SlabGrade.A, Disposition.RECALIBRATION, 0)).toBe(false);
  });

  it('sends Grade B only to stock or sample cutting', () => {
    expect(dispositionAllowed(SlabGrade.B, Disposition.STOCK, 0)).toBe(true);
    expect(dispositionAllowed(SlabGrade.B, Disposition.SAMPLE_CUTTING, 0)).toBe(true);
    expect(dispositionAllowed(SlabGrade.B, Disposition.DISPATCH, 0)).toBe(false);
  });

  it('sends Grade C to recalibration while attempts remain', () => {
    expect(dispositionAllowed(SlabGrade.C, Disposition.RECALIBRATION, 0)).toBe(true);
    expect(dispositionAllowed(SlabGrade.C, Disposition.RECALIBRATION, 4)).toBe(true);
  });

  it('refuses a sixth recalibration', () => {
    expect(dispositionAllowed(SlabGrade.C, Disposition.RECALIBRATION, 5)).toBe(false);
  });

  it('never offers waste at QC — the write-off belongs to recalibration', () => {
    expect(dispositionAllowed(SlabGrade.C, Disposition.WASTE, 0)).toBe(false);
    expect(dispositionAllowed(SlabGrade.C, Disposition.WASTE, 5)).toBe(false);
  });

  it('labels every disposition', () => {
    for (const disposition of Object.values(Disposition)) {
      expect(DISPOSITION_LABELS[disposition]).toBeTruthy();
    }
  });
});

describe('quality check validation', () => {
  const base = {
    cycleId: UUID,
    verdict: 'PASS',
    grade: 'A',
    disposition: 'STOCK',
  };

  it('accepts a minimal inspection and defaults the checks to n/a', () => {
    const result = qualityCheckSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.success && result.data.printQualityResult).toBe('NOT_APPLICABLE');
    expect(result.success && result.data.defectTypeIds).toEqual([]);
  });

  it('parses a gloss reading and drops a blank one', () => {
    const withGloss = qualityCheckSchema.safeParse({ ...base, glossReading: '82.5' });
    expect(withGloss.success && withGloss.data.glossReading).toBe(82.5);
    const blank = qualityCheckSchema.safeParse({ ...base, glossReading: '' });
    expect(blank.success && blank.data.glossReading).toBeUndefined();
  });

  it('rejects an unknown grade or verdict', () => {
    expect(qualityCheckSchema.safeParse({ ...base, grade: 'D' }).success).toBe(false);
    expect(qualityCheckSchema.safeParse({ ...base, verdict: 'MAYBE' }).success).toBe(false);
  });
});
