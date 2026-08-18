import { ChromiaCycleStatus as CycleStatus, ChromiaDisposition as Disposition, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import {
  DISPOSITION_LABELS,
  GRADE_ALLOWED_DISPOSITIONS,
  MAX_RECALIBRATION_ATTEMPTS,
} from '@/lib/chromia/constants/process-stages';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import type { QualityCheckInput } from '@/lib/chromia/validation/quality';

const log = createLogger('quality');

/**
 * Quality Check + Grade Decision.
 *
 * Business rules (CHROMIA_PROCESS.md sections 6 and 7):
 *   * A slab can only be inspected once its out-time is recorded.
 *   * One inspection per process cycle — a re-inspection belongs to a new
 *     cycle after recalibration.
 *   * Grade A → Dispatch or Stock
 *     Grade B → Stock or Sample Cutting
 *     Grade C → Recalibration, or Waste once five attempts are used up
 *   * A sixth recalibration is refused outright.
 */
export async function recordQualityCheck(input: QualityCheckInput, userId: string) {
  const cycle = await prisma.chromiaProcessCycle.findUnique({
    where: { id: input.cycleId },
    include: {
      slab: {
        select: {
          id: true,
          slabNo: true,
          status: true,
          recalibrationCount: true,
          currentLocationId: true,
        },
      },
      qcRecord: { select: { id: true } },
    },
  });

  if (!cycle) {
    throw new NotFoundError('Process cycle');
  }

  if (!cycle.outTime) {
    throw new BusinessRuleViolationError(
      'Record the out-time before quality check — processing is not finished',
    );
  }

  if (cycle.qcRecord) {
    throw new BusinessRuleViolationError(
      `Slab ${cycle.slab.slabNo} has already been inspected on cycle ${cycle.cycleNumber}`,
    );
  }

  // Grade → disposition routing.
  const allowed = GRADE_ALLOWED_DISPOSITIONS[input.grade];
  if (!allowed.includes(input.disposition)) {
    throw new BusinessRuleViolationError(
      `Grade ${input.grade} cannot be sent to ${DISPOSITION_LABELS[input.disposition]}. ` +
        `Allowed: ${allowed.map((d) => DISPOSITION_LABELS[d]).join(' or ')}`,
    );
  }

  // The five-attempt ceiling.
  const attemptsUsed = cycle.slab.recalibrationCount;
  if (input.disposition === Disposition.RECALIBRATION && attemptsUsed >= MAX_RECALIBRATION_ATTEMPTS) {
    throw new BusinessRuleViolationError(
      `Slab ${cycle.slab.slabNo} has already used all ${MAX_RECALIBRATION_ATTEMPTS} recalibration attempts — it must be declared waste`,
    );
  }

  const now = new Date();
  const locationId = input.targetLocationId ?? cycle.slab.currentLocationId ?? null;

  const slabStatus =
    input.disposition === Disposition.WASTE ? SlabStatus.WASTE : SlabStatus.GRADED;

  await prisma.$transaction(async (tx) => {
    const qcRecord = await tx.chromiaQcRecord.create({
      data: {
        cycleId: cycle.id,
        slabId: cycle.slabId,
        inspectorId: userId,
        inspectedAt: now,
        verdict: input.verdict,
        printQualityResult: input.printQualityResult,
        colourMatchResult: input.colourMatchResult,
        surfaceFinishResult: input.surfaceFinishResult,
        glossResult: input.glossResult,
        dimensionalResult: input.dimensionalResult,
        edgeConditionResult: input.edgeConditionResult,
        glossReading: input.glossReading ?? null,
        colourDeviation: input.colourDeviation ?? null,
        remarks: input.remarks ?? null,
      },
    });

    if (input.defectTypeIds.length > 0) {
      const defectTypes = await tx.chromiaDefectType.findMany({
        where: { id: { in: input.defectTypeIds } },
        select: { id: true, defaultSeverity: true },
      });

      await tx.chromiaQcDefect.createMany({
        data: defectTypes.map((defectType) => ({
          qcRecordId: qcRecord.id,
          defectTypeId: defectType.id,
          severity: defectType.defaultSeverity,
        })),
      });
    }

    await tx.chromiaGradeDecision.create({
      data: {
        cycleId: cycle.id,
        slabId: cycle.slabId,
        grade: input.grade,
        disposition: input.disposition,
        reason: input.gradeReason ?? null,
        decidedById: userId,
        decidedAt: now,
        targetLocationId: input.targetLocationId ?? null,
        attemptNumberAtDecision: attemptsUsed + 1,
      },
    });

    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id },
      data: {
        status: CycleStatus.COMPLETED,
        completedAt: now,
        finalGrade: input.grade,
        disposition: input.disposition,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: cycle.slabId },
      data: {
        status: slabStatus,
        currentGrade: input.grade,
        currentDisposition: input.disposition,
        currentLocationId: locationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.createMany({
      data: [
        {
          slabId: cycle.slabId,
          cycleId: cycle.id,
          eventType: SlabEventType.QC_RECORDED,
          userId,
          locationId,
          occurredAt: now,
          note: `Quality check: ${input.verdict.replace(/_/g, ' ').toLowerCase()}`,
        },
        {
          slabId: cycle.slabId,
          cycleId: cycle.id,
          eventType: SlabEventType.GRADE_ASSIGNED,
          fromStatus: SlabStatus.UNDER_INSPECTION,
          toStatus: slabStatus,
          userId,
          locationId,
          occurredAt: now,
          note: `Grade ${input.grade} → ${DISPOSITION_LABELS[input.disposition]}`,
        },
      ],
    });
  });

  log.info(
    { slabNo: cycle.slab.slabNo, grade: input.grade, disposition: input.disposition },
    'Quality check recorded',
  );
}
