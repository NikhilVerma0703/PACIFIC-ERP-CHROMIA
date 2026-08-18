import { ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { ConflictError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { needsIntakeQc } from '@/lib/chromia/slab-links';
import { toDateColumn } from '@/lib/chromia/utils/dates';
import type { SlabIntakeInput } from '@/lib/chromia/validation/slab';

const log = createLogger('slab-intake');

/**
 * Finish a slab that is already on the line.
 *
 * The operator enters the slab's identity and an in-time on the register. The
 * in-charge later opens that slab's intake page, which asks only for the day it
 * came off printed. That is this function: it records the printed date, stamps
 * the out-time, and hands the slab to `applyIntakeGrade` for the QC decision.
 *
 * The out-time is the moment this form is saved — that is when the in-charge
 * confirms the slab is off the line. The fully printed date is a calendar day
 * and stays in its own column; using it as a time would stamp every slab at
 * midnight. A slab that already carries an out-time keeps it.
 */
export async function completeSlabIntake(
  slabId: string,
  input: SlabIntakeInput,
  userId: string,
) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { id: true, inTime: true, outTime: true },
      },
    },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (!needsIntakeQc(slab.status)) {
    throw new ConflictError(`Slab "${slab.slabNo}" has already been graded`);
  }

  const cycle = slab.cycles[0];
  if (!cycle) throw new NotFoundError('Process cycle');

  const now = new Date();
  const outTime = cycle.outTime ?? now;
  const inTime = cycle.inTime;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: { status: SlabStatus.UNDER_INSPECTION, updatedById: userId },
    });

    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id },
      data: {
        fullyPrintedDate: toDateColumn(input.fullyPrintedDate),
        outTime,
        processingMinutes:
          inTime && outTime > inTime
            ? Math.round((outTime.getTime() - inTime.getTime()) / 60_000)
            : null,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId: cycle.id,
        eventType: SlabEventType.CYCLE_COMPLETED,
        toStatus: SlabStatus.UNDER_INSPECTION,
        userId,
        occurredAt: now,
        note: `Slab ${slab.slabNo} came off the line`,
      },
    });
  });

  log.info({ slabId: slab.id, slabNo: slab.slabNo }, 'Slab intake completed');

  return { id: slab.id };
}
