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

/**
 * Undo a slab's QC so it can be graded again — the Edit / correction path.
 *
 * Operators are catching up historical production and sometimes put the wrong
 * grade or outcome on a slab. This lets the Edit screen re-open the QC section
 * on an already-decided slab: it clears the current decision — the grade
 * decision and whichever of dispatch, stock, sample-cutting or waste record it
 * produced — and returns the slab to IN_PROCESS on its current cycle, so the
 * ordinary grading path (`applyIntakeGrade` + the disposition services) can
 * decide it afresh, onto the SAME record. No duplicate slab is ever made.
 *
 * History is appended, never erased: the slab's events stay as they were and a
 * CORRECTION event records the reset, so the story still reads true.
 *
 * A slab inside a recalibration cycle is out of scope — its multi-cycle journey
 * belongs to the Recalibration page — and is refused with a message that says
 * so, rather than being half-unwound here.
 */
export async function resetSlabQcForCorrection(slabId: string, userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentGrade: true,
      currentDisposition: true,
      cycles: { orderBy: { cycleNumber: 'desc' }, take: 1, select: { id: true } },
    },
  });
  if (!slab) throw new NotFoundError('Slab');

  const inRecalibration =
    slab.currentDisposition === Disposition.RECALIBRATION ||
    slab.status === SlabStatus.OUT_FOR_RECALIBRATION ||
    slab.status === SlabStatus.RECEIVED_FROM_RECALIBRATION;

  if (inRecalibration) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is in a recalibration cycle — correct it on the Recalibration page, not here.`,
    );
  }

  // Nothing decided yet: "editing" an ungraded slab's QC is simply grading it,
  // and the ordinary grading path does exactly that. There is nothing to undo.
  if (slab.currentGrade === null && slab.currentDisposition === null) return;

  const cycleId = slab.cycles[0]?.id ?? null;
  const priorGrade = slab.currentGrade;
  const priorDisposition = slab.currentDisposition;

  await prisma.$transaction(async (tx) => {
    // A slab holds one live outcome at a time, so clearing by slab id removes
    // exactly the current one. Recalibration is refused above, so its cycles are
    // never touched here.
    await tx.chromiaDispatch.deleteMany({ where: { slabId: slab.id } });
    await tx.chromiaStockEntry.deleteMany({ where: { slabId: slab.id } });
    await tx.chromiaSampleCutting.deleteMany({ where: { slabId: slab.id } });
    await tx.chromiaWasteRecord.deleteMany({ where: { slabId: slab.id } });

    if (cycleId) {
      await tx.chromiaGradeDecision.deleteMany({ where: { cycleId } });
      await tx.chromiaProcessCycle.update({
        where: { id: cycleId },
        data: {
          finalGrade: null,
          disposition: null,
          status: CycleStatus.ACTIVE,
          completedAt: null,
        },
      });
    }

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.IN_PROCESS,
        currentGrade: null,
        currentDisposition: null,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId,
        eventType: SlabEventType.CORRECTION,
        userId,
        note: `QC reset for correction — was Grade ${priorGrade ?? '—'} → ${
          priorDisposition ? DISPOSITION_LABELS[priorDisposition] : '—'
        }`,
      },
    });
  });

  log.info({ slabNo: slab.slabNo }, 'QC reset for correction');
}
