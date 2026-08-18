import { describe, expect, it } from 'vitest';

import { PRODUCTION_STAGES, PRODUCTION_STAGE_NAMES } from '@/lib/chromia/constants/process-stages';
import { ChromiaProcessStage as ProcessStage } from '@prisma/client';
import { recordOutTimeSchema } from '@/lib/chromia/validation/processing';

const UUID = '3f6d2b1e-2f2a-4f2e-9c3a-1b2c3d4e5f60';

describe('processing window', () => {
  it('covers exactly the six untimed production stages', () => {
    expect(PRODUCTION_STAGES).toEqual([
      ProcessStage.BASE_PRIMER,
      ProcessStage.PRINTING,
      ProcessStage.MOULDING,
      ProcessStage.COOLING,
      ProcessStage.POLISHING,
      ProcessStage.UV_POLISHING,
    ]);
  });

  it('excludes intake and quality stages from the window', () => {
    for (const stage of [
      ProcessStage.INCOMING,
      ProcessStage.INCOMING_DETAILS,
      ProcessStage.QUALITY_CHECK,
      ProcessStage.GRADE_DECISION,
    ]) {
      expect(PRODUCTION_STAGES).not.toContain(stage);
    }
  });

  it('names the stages in running order', () => {
    expect(PRODUCTION_STAGE_NAMES[0]).toBe('Base Primer');
    expect(PRODUCTION_STAGE_NAMES.at(-1)).toBe('UV Polishing');
  });
});

describe('out-time validation', () => {
  it('treats a blank out-time as "now"', () => {
    const result = recordOutTimeSchema.safeParse({ cycleId: UUID, outTime: '' });
    expect(result.success && result.data.outTime).toBeUndefined();
  });

  it('accepts an explicit datetime-local value', () => {
    const result = recordOutTimeSchema.safeParse({ cycleId: UUID, outTime: '2026-05-08T14:30' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.outTime instanceof Date).toBe(true);
  });

  it('rejects a non-uuid cycle', () => {
    expect(recordOutTimeSchema.safeParse({ cycleId: 'nope' }).success).toBe(false);
  });
});
