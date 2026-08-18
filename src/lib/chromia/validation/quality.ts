import { z } from 'zod';

import { ChromiaDisposition as Disposition, ChromiaQcCheckResult as QcCheckResult, ChromiaQcVerdict as QcVerdict, ChromiaSlabGrade as SlabGrade } from '@prisma/client';

const checkResult = z
  .enum([QcCheckResult.PASS, QcCheckResult.FAIL, QcCheckResult.NOT_APPLICABLE])
  .default(QcCheckResult.NOT_APPLICABLE);

const optionalText = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * Quality Check (stage 9) and Grade Decision (stage 10) are captured together:
 * the inspector records the inspection and, in the same breath, the commercial
 * decision that follows from it.
 */
export const qualityCheckSchema = z.object({
  cycleId: z.string().uuid(),

  // --- Inspection ---------------------------------------------------------
  verdict: z.enum([QcVerdict.PASS, QcVerdict.CONDITIONAL_PASS, QcVerdict.FAIL]),
  printQualityResult: checkResult,
  colourMatchResult: checkResult,
  surfaceFinishResult: checkResult,
  glossResult: checkResult,
  dimensionalResult: checkResult,
  edgeConditionResult: checkResult,
  glossReading: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return undefined;
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }),
  colourDeviation: optionalText,
  defectTypeIds: z.array(z.string().uuid()).default([]),
  remarks: optionalText,

  // --- Grade decision -----------------------------------------------------
  grade: z.enum([SlabGrade.A, SlabGrade.B, SlabGrade.C]),
  disposition: z.enum([
    Disposition.DISPATCH,
    Disposition.STOCK,
    Disposition.SAMPLE_CUTTING,
    Disposition.RECALIBRATION,
    Disposition.WASTE,
  ]),
  gradeReason: optionalText,
  targetLocationId: optionalId,
});

export type QualityCheckInput = z.infer<typeof qualityCheckSchema>;
