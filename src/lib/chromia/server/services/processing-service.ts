import { ChromiaMovementReason as MovementReason, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { formatMinutes, minutesBetween } from '@/lib/chromia/utils/dates';
import type { RecordOutTimeInput } from '@/lib/chromia/validation/processing';

const log = createLogger('processing');

/**
 * Processing window.
 *
 * The Chromia line runs Base Primer → Printing → Moulding → Cooling →
 * Polishing → UV Polishing as one continuous block. Operators do not record
 * each stage separately: the slab is stamped **in** at intake and **out** once
 * every stage is finished. Total processing time is derived from the two.
 *
 * After the out-time is recorded the slab waits for Quality Check.
 */
export async function recordOutTime(input: RecordOutTimeInput, userId: string) {
  const cycle = await prisma.chromiaProcessCycle.findUnique({
    where: { id: input.cycleId },
    include: {
      slab: { select: { id: true, slabNo: true, currentLocationId: true } },
    },
  });

  if (!cycle) {
    throw new NotFoundError('Process cycle');
  }

  if (cycle.outTime) {
    throw new BusinessRuleViolationError(
      `Out-time for slab ${cycle.slab.slabNo} has already been recorded`,
    );
  }

  const outTime = input.outTime ?? new Date();

  /*
   * No in-time, no duration.
   *
   * This used to fall back to cycle.startedAt, which is `@default(now())` —
   * the instant the row was SAVED. That was harmless while the in-time was
   * required; now that it is optional, a slab booked in without one would get
   * a plausible-looking figure measuring the gap between data entry and coming
   * off the line, written into processingMinutes and into the history note as
   * if it had been observed. A blank is honest and matches completeSlabIntake,
   * which has always left it null for the same reason.
   */
  const inTime = cycle.inTime;

  if (inTime && outTime < inTime) {
    throw new BusinessRuleViolationError('Out-time cannot be earlier than in-time');
  }

  const processingMinutes = inTime ? minutesBetween(inTime, outTime) : null;

  const locationId = input.locationId ?? cycle.slab.currentLocationId ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id },
      data: {
        outTime,
        processingMinutes,
        notes: input.notes ?? cycle.notes,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: cycle.slabId },
      data: {
        status: SlabStatus.UNDER_INSPECTION,
        currentLocationId: locationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: cycle.slabId,
        cycleId: cycle.id,
        eventType: SlabEventType.CYCLE_COMPLETED,
        fromStatus: SlabStatus.IN_PROCESS,
        toStatus: SlabStatus.UNDER_INSPECTION,
        locationId,
        userId,
        occurredAt: outTime,
        // No in-time, no duration to quote — see above.
        note:
          processingMinutes === null
            ? 'Processing complete — awaiting quality check (no in-time was recorded)'
            : `Processing complete in ${formatMinutes(processingMinutes)} — awaiting quality check`,
      },
    });

    if (locationId && locationId !== cycle.slab.currentLocationId) {
      await tx.chromiaSlabMovement.create({
        data: {
          slabId: cycle.slabId,
          fromLocationId: cycle.slab.currentLocationId,
          toLocationId: locationId,
          reason: MovementReason.QC_TRANSFER,
          movedById: userId,
          movedAt: outTime,
        },
      });
    }
  });

  log.info({ slabNo: cycle.slab.slabNo, processingMinutes }, 'Out-time recorded');
}
