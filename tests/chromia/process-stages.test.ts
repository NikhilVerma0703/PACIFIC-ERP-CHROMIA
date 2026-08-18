import { describe, expect, it } from 'vitest';

import {
  DISPOSITION_LABELS,
  GRADE_ALLOWED_DISPOSITIONS,
  MAX_RECALIBRATION_ATTEMPTS,
  PROCESS_STAGE_EXPECTED_MINUTES,
  PROCESS_STAGE_LABELS,
  PROCESS_STAGE_ORDER,
  SLAB_STATUS_LABELS,
  nextStage,
  stageSequence,
} from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaProcessStage as ProcessStage, ChromiaSlabGrade as SlabGrade, ChromiaSlabStatus as SlabStatus } from '@prisma/client';

describe('process stages', () => {
  it('orders all ten stages exactly once', () => {
    const enumValues = Object.values(ProcessStage);
    expect(PROCESS_STAGE_ORDER).toHaveLength(enumValues.length);
    expect(new Set(PROCESS_STAGE_ORDER).size).toBe(enumValues.length);
    expect([...PROCESS_STAGE_ORDER].sort()).toEqual([...enumValues].sort());
  });

  it('starts at Incoming and ends at Grade Decision', () => {
    expect(PROCESS_STAGE_ORDER[0]).toBe(ProcessStage.INCOMING);
    expect(PROCESS_STAGE_ORDER.at(-1)).toBe(ProcessStage.GRADE_DECISION);
  });

  it('labels and expected durations cover every stage', () => {
    for (const stage of Object.values(ProcessStage)) {
      expect(PROCESS_STAGE_LABELS[stage]).toBeTruthy();
      expect(PROCESS_STAGE_EXPECTED_MINUTES[stage]).toBeGreaterThan(0);
    }
  });

  it('computes a 1-based stage sequence', () => {
    expect(stageSequence(ProcessStage.INCOMING)).toBe(1);
    expect(stageSequence(ProcessStage.QUALITY_CHECK)).toBe(9);
    expect(stageSequence(ProcessStage.GRADE_DECISION)).toBe(10);
  });

  it('walks forward through the line and stops at the end', () => {
    expect(nextStage(ProcessStage.COOLING)).toBe(ProcessStage.POLISHING);
    expect(nextStage(ProcessStage.UV_POLISHING)).toBe(ProcessStage.QUALITY_CHECK);
    expect(nextStage(ProcessStage.GRADE_DECISION)).toBeNull();
  });
});

describe('grading and dispositions', () => {
  it('labels every grade, disposition and slab status', () => {
    for (const disposition of Object.values(Disposition)) {
      expect(DISPOSITION_LABELS[disposition]).toBeTruthy();
    }
    for (const status of Object.values(SlabStatus)) {
      expect(SLAB_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('routes each grade exactly as CHROMIA_PROCESS.md section 6 specifies', () => {
    expect(GRADE_ALLOWED_DISPOSITIONS[SlabGrade.A]).toEqual([
      Disposition.DISPATCH,
      Disposition.STOCK,
    ]);
    expect(GRADE_ALLOWED_DISPOSITIONS[SlabGrade.B]).toEqual([
      Disposition.STOCK,
      Disposition.SAMPLE_CUTTING,
    ]);
    // Waste is not offered at QC on this line: a failed slab goes back out for
    // recalibration, and the fifth failure is written off from that section.
    expect(GRADE_ALLOWED_DISPOSITIONS[SlabGrade.C]).toEqual([Disposition.RECALIBRATION]);
  });

  it('never allows recalibration for a passing grade', () => {
    expect(GRADE_ALLOWED_DISPOSITIONS[SlabGrade.A]).not.toContain(Disposition.RECALIBRATION);
    expect(GRADE_ALLOWED_DISPOSITIONS[SlabGrade.B]).not.toContain(Disposition.RECALIBRATION);
  });

  it('caps recalibration at five attempts', () => {
    expect(MAX_RECALIBRATION_ATTEMPTS).toBe(5);
  });
});
