import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaRecalibrationStatus as RecalibrationStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';

/**
 * Outstanding recalibrations — slabs that have left the plant and not come
 * back. This is the view that answers "where is it and how long has it been
 * gone", which the spreadsheet cannot.
 */
export function listOutstandingRecalibrations() {
  return prisma.chromiaRecalibrationCycle.findMany({
    where: {
      status: { in: [RecalibrationStatus.SENT, RecalibrationStatus.AT_FACILITY] },
      receivedDate: null,
    },
    orderBy: { sentDate: 'asc' },
    include: {
      slab: {
        select: {
          id: true,
          slabNo: true,
          recalibrationCount: true,
          batch: { select: { batchNo: true } },
          baseMaterial: { select: { name: true } },
        },
      },
      reason: { select: { name: true } },
    },
  });
}

/** Recently returned, for context beneath the outstanding list. */
export function listRecentReturns(take = 20) {
  return prisma.chromiaRecalibrationCycle.findMany({
    where: { receivedDate: { not: null } },
    orderBy: { receivedDate: 'desc' },
    take,
    include: {
      slab: { select: { id: true, slabNo: true } },
      reason: { select: { name: true } },
    },
  });
}

/** Active recalibration reasons for the send form. */
export function listRecalibrationReasons() {
  return prisma.chromiaRecalibrationReason.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/**
 * Slabs graded for recalibration that have not been sent out yet.
 *
 * These are what the entry form at the top of the Recalibration page offers —
 * the queue between "the in-charge decided recalibration" and "the slab
 * physically left for the facility".
 */
export function listSlabsAwaitingRecalibration() {
  return prisma.chromiaSlab.findMany({
    where: {
      deletedAt: null,
      currentDisposition: Disposition.RECALIBRATION,
      isRecalibrationOut: false,
      recalibrationCount: { lt: MAX_RECALIBRATION_ATTEMPTS },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      slabNo: true,
      recalibrationCount: true,
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
    },
  });
}
