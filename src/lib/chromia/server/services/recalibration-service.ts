import { ChromiaCycleStatus as CycleStatus, ChromiaDisposition as Disposition, ChromiaMovementReason as MovementReason, ChromiaRecalibrationStatus as RecalibrationStatus, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { daysBetween } from '@/lib/chromia/utils/dates';
import type {
  ReceiveFromRecalibrationInput,
  RestartAfterRecalibrationInput,
  ResolvedSendForRecalibration,
} from '@/lib/chromia/validation/recalibration';

const log = createLogger('recalibration');

/**
 * Recalibration — the recovery route for Grade C slabs, and the part of the
 * process the spreadsheet loses track of.
 *
 * Three steps, each a separate physical event:
 *   1. sendForRecalibration  — slab leaves the plant, ageing clock starts
 *   2. receiveFromRecalibration — slab returns, turnaround computed
 *   3. restartAfterRecalibration — a NEW cycle opens; the previous cycle's
 *      full history is retained, never overwritten
 *
 * Hard rule: a maximum of five attempts per slab (CHROMIA_PROCESS.md § 7.7).
 */

// ---------------------------------------------------------------- send ---

export async function sendForRecalibration(input: ResolvedSendForRecalibration, userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: input.slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentDisposition: true,
      recalibrationCount: true,
      isRecalibrationOut: true,
      currentThicknessMm: true,
      currentLocationId: true,
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { id: true, cycleNumber: true },
      },
    },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (slab.isRecalibrationOut) {
    throw new BusinessRuleViolationError(`Slab ${slab.slabNo} is already out for recalibration`);
  }

  if (slab.currentDisposition !== Disposition.RECALIBRATION) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has not been graded for recalibration`,
    );
  }

  if (slab.recalibrationCount >= MAX_RECALIBRATION_ATTEMPTS) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has used all ${MAX_RECALIBRATION_ATTEMPTS} recalibration attempts — it must be declared waste`,
    );
  }

  const attemptNumber = slab.recalibrationCount + 1;
  const sentDate = input.sentDate ?? new Date();
  const failedCycleId = slab.cycles[0]?.id ?? null;

  // Park the slab at the external facility so its location is never unknown.
  const facility = await prisma.chromiaLocation.findFirst({
    where: { type: 'EXTERNAL_FACILITY', isActive: true },
    select: { id: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const recalibration = await tx.chromiaRecalibrationCycle.create({
      data: {
        slabId: slab.id,
        attemptNumber,
        status: RecalibrationStatus.SENT,
        failedCycleId,
        reasonId: input.reasonId,
        reasonNotes: input.reasonNotes ?? null,
        sentDate,
        expectedReturnDate: input.expectedReturnDate ?? null,
        facilityName: input.facilityName ?? null,
        gatePassNo: input.gatePassNo ?? null,
        transporter: input.transporter ?? null,
        vehicleNo: input.vehicleNo ?? null,
        conditionOnSend: input.conditionOnSend ?? null,
        thicknessBeforeMm: input.thicknessBeforeMm ?? slab.currentThicknessMm ?? null,
        issuedById: userId,
        createdById: userId,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.OUT_FOR_RECALIBRATION,
        isRecalibrationOut: true,
        recalibrationCount: attemptNumber,
        currentLocationId: facility?.id ?? slab.currentLocationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId: failedCycleId,
        eventType: SlabEventType.RECALIBRATION_SENT,
        fromStatus: slab.status,
        toStatus: SlabStatus.OUT_FOR_RECALIBRATION,
        locationId: facility?.id ?? slab.currentLocationId,
        userId,
        occurredAt: sentDate,
        note: `Sent for recalibration — attempt ${attemptNumber} of ${MAX_RECALIBRATION_ATTEMPTS}`,
      },
    });

    if (facility && facility.id !== slab.currentLocationId) {
      await tx.chromiaSlabMovement.create({
        data: {
          slabId: slab.id,
          fromLocationId: slab.currentLocationId,
          toLocationId: facility.id,
          reason: MovementReason.RECALIBRATION_OUT,
          movedById: userId,
          movedAt: sentDate,
        },
      });
    }

    return recalibration;
  });

  log.info({ slabNo: slab.slabNo, attemptNumber }, 'Sent for recalibration');

  return created;
}

// ------------------------------------------------------------- receive ---

export async function receiveFromRecalibration(
  input: ReceiveFromRecalibrationInput,
  userId: string,
) {
  const recalibration = await prisma.chromiaRecalibrationCycle.findUnique({
    where: { id: input.recalibrationId },
    include: {
      slab: {
        select: {
          id: true,
          slabNo: true,
          currentLocationId: true,
          baseMaterial: { select: { minUsableThicknessMm: true } },
        },
      },
    },
  });

  if (!recalibration) throw new NotFoundError('Recalibration cycle');

  if (recalibration.receivedDate) {
    throw new BusinessRuleViolationError(
      `Attempt ${recalibration.attemptNumber} for slab ${recalibration.slab.slabNo} is already received`,
    );
  }

  const receivedDate = input.receivedDate ?? new Date();
  const sentDate = recalibration.sentDate ?? recalibration.createdAt;

  if (receivedDate < sentDate) {
    throw new BusinessRuleViolationError('Received date cannot be earlier than the sent date');
  }

  const turnaroundDays = daysBetween(sentDate, receivedDate);

  const before = recalibration.thicknessBeforeMm
    ? Number(recalibration.thicknessBeforeMm)
    : undefined;
  const after = input.thicknessAfterMm;
  const removed = before !== undefined && after !== undefined ? before - after : undefined;

  if (removed !== undefined && removed < 0) {
    throw new BusinessRuleViolationError(
      'Thickness after recalibration cannot exceed the thickness before',
    );
  }

  const minUsable = recalibration.slab.baseMaterial.minUsableThicknessMm
    ? Number(recalibration.slab.baseMaterial.minUsableThicknessMm)
    : undefined;
  const withinMinThickness =
    after !== undefined && minUsable !== undefined ? after >= minUsable : null;

  const locationId = input.locationId ?? recalibration.slab.currentLocationId ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaRecalibrationCycle.update({
      where: { id: recalibration.id },
      data: {
        status: RecalibrationStatus.RECEIVED,
        receivedDate,
        turnaroundDays,
        thicknessAfterMm: after ?? null,
        materialRemovedMm: removed ?? null,
        withinMinThickness,
        conditionOnReturn: input.conditionOnReturn ?? null,
        workAccepted: input.workAccepted,
        receivedById: userId,
        notes: input.notes ?? recalibration.notes,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: recalibration.slabId },
      data: {
        status: SlabStatus.RECEIVED_FROM_RECALIBRATION,
        isRecalibrationOut: false,
        currentLocationId: locationId,
        ...(after !== undefined ? { currentThicknessMm: after } : {}),
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: recalibration.slabId,
        eventType: SlabEventType.RECALIBRATION_RECEIVED,
        fromStatus: SlabStatus.OUT_FOR_RECALIBRATION,
        toStatus: SlabStatus.RECEIVED_FROM_RECALIBRATION,
        locationId,
        userId,
        occurredAt: receivedDate,
        note: `Received from recalibration — ${turnaroundDays} day${turnaroundDays === 1 ? '' : 's'} out${
          removed !== undefined ? `, ${removed.toFixed(2)} mm removed` : ''
        }`,
      },
    });

    if (locationId && locationId !== recalibration.slab.currentLocationId) {
      await tx.chromiaSlabMovement.create({
        data: {
          slabId: recalibration.slabId,
          fromLocationId: recalibration.slab.currentLocationId,
          toLocationId: locationId,
          reason: MovementReason.RECALIBRATION_IN,
          movedById: userId,
          movedAt: receivedDate,
        },
      });
    }
  });

  log.info({ slabNo: recalibration.slab.slabNo, turnaroundDays }, 'Received from recalibration');
}

// ------------------------------------------------------------- restart ---

export async function restartAfterRecalibration(
  input: RestartAfterRecalibrationInput,
  userId: string,
) {
  const recalibration = await prisma.chromiaRecalibrationCycle.findUnique({
    where: { id: input.recalibrationId },
    include: {
      slab: {
        select: {
          id: true,
          slabNo: true,
          currentCycleNumber: true,
          plannedDesignId: true,
          currentLocationId: true,
        },
      },
    },
  });

  if (!recalibration) throw new NotFoundError('Recalibration cycle');

  if (!recalibration.receivedDate) {
    throw new BusinessRuleViolationError('Book the slab back in before restarting the process');
  }

  if (recalibration.status === RecalibrationStatus.RESTARTED) {
    throw new BusinessRuleViolationError('This recalibration has already been restarted');
  }

  const now = new Date();
  const nextCycleNumber = recalibration.slab.currentCycleNumber + 1;
  const locationId = input.locationId ?? recalibration.slab.currentLocationId ?? null;

  await prisma.$transaction(async (tx) => {
    // Close the failed cycle for good.
    if (recalibration.failedCycleId) {
      await tx.chromiaProcessCycle.update({
        where: { id: recalibration.failedCycleId },
        data: { status: CycleStatus.COMPLETED },
      });
    }

    // A brand-new pass through the line. The previous cycle keeps its own
    // in/out times, QC record and grade decision — nothing is overwritten.
    const cycle = await tx.chromiaProcessCycle.create({
      data: {
        slabId: recalibration.slabId,
        cycleNumber: nextCycleNumber,
        designId: recalibration.slab.plannedDesignId,
        inTime: now,
        createdById: userId,
      },
    });

    await tx.chromiaRecalibrationCycle.update({
      where: { id: recalibration.id },
      data: {
        status: RecalibrationStatus.RESTARTED,
        restartedAt: now,
        restartedCycleId: cycle.id,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: recalibration.slabId },
      data: {
        status: SlabStatus.IN_PROCESS,
        currentCycleNumber: nextCycleNumber,
        currentGrade: null,
        currentDisposition: null,
        currentLocationId: locationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: recalibration.slabId,
        cycleId: cycle.id,
        eventType: SlabEventType.RECALIBRATION_RESTARTED,
        fromStatus: SlabStatus.RECEIVED_FROM_RECALIBRATION,
        toStatus: SlabStatus.IN_PROCESS,
        locationId,
        userId,
        occurredAt: now,
        note: `Process restarted — cycle ${nextCycleNumber} (after recalibration attempt ${recalibration.attemptNumber})`,
      },
    });
  });

  log.info(
    { slabNo: recalibration.slab.slabNo, cycleNumber: nextCycleNumber },
    'Process restarted after recalibration',
  );
}
