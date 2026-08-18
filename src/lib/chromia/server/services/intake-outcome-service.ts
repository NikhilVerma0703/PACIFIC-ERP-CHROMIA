import { DISPOSITION_LABELS, GRADE_ALLOWED_DISPOSITIONS } from '@/lib/chromia/constants/process-stages';
import { ChromiaCycleStatus as CycleStatus, ChromiaDisposition as Disposition, ChromiaSlabEventType as SlabEventType, type ChromiaSlabGrade as SlabGrade, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import type { IntakeQcInput } from '@/lib/chromia/validation/slab';

const log = createLogger('intake-qc');

/**
 * The QC decision taken on the intake page.
 *
 * This is the light-weight sibling of `recordQualityCheck`: the in-charge
 * decides a grade and an outcome without filling in the six-point inspection
 * sheet, which is how the paper register works. It writes the GradeDecision so
 * the audit trail is identical either way, then hands over to the disposition
 * services for the outcome-specific record.
 *
 * Recalibration is the one outcome that is NOT completed here — the slab is
 * left graded and awaiting despatch to the facility, and the caller sends the
 * user to the Recalibration page to record the reason and dates.
 */
export async function applyIntakeGrade(slabId: string, input: IntakeQcInput, userId: string) {
  const grade = input.grade as SlabGrade;
  const disposition = input.disposition as Disposition;

  const allowed = GRADE_ALLOWED_DISPOSITIONS[grade];
  if (!allowed.includes(disposition)) {
    throw new BusinessRuleViolationError(
      `Grade ${grade} cannot go to ${DISPOSITION_LABELS[disposition]}`,
    );
  }

  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      recalibrationCount: true,
      cycles: { orderBy: { cycleNumber: 'desc' }, take: 1, select: { id: true } },
    },
  });

  if (!slab) throw new NotFoundError('Slab');

  const cycleId = slab.cycles[0]?.id;
  if (!cycleId) throw new NotFoundError('Process cycle');

  const now = new Date();
  const isRecalibration = disposition === Disposition.RECALIBRATION;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaGradeDecision.create({
      data: {
        cycleId,
        slabId: slab.id,
        grade,
        disposition,
        reason: 'Graded at intake',
        remarks: input.slabRemarks ?? null,
        decidedById: userId,
        decidedAt: now,
        attemptNumberAtDecision: slab.recalibrationCount + 1,
      },
    });

    await tx.chromiaProcessCycle.update({
      where: { id: cycleId },
      data: {
        finalGrade: grade,
        disposition,
        // A slab heading for recalibration has not finished its cycle — the
        // recalibration service closes it when the slab is sent out.
        ...(isRecalibration ? {} : { status: CycleStatus.COMPLETED, completedAt: now }),
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.GRADED,
        currentGrade: grade,
        currentDisposition: disposition,
        remarks: input.slabRemarks ?? null,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId,
        eventType: SlabEventType.GRADE_ASSIGNED,
        toStatus: SlabStatus.GRADED,
        userId,
        occurredAt: now,
        note: `Grade ${grade} → ${DISPOSITION_LABELS[disposition]} (decided at intake)`,
      },
    });
  });

  log.info({ slabNo: slab.slabNo, grade, disposition }, 'Intake grade recorded');
}
