import type { ChromiaDisposition as Disposition } from '@prisma/client';
import { ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { ConflictError, ValidationError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { combineDateAndTime, endOfDay, startOfDay } from '@/lib/chromia/operator-register';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import type { OperatorEntryInput } from '@/lib/chromia/validation/operator';
import { resolveBaseMaterialId, resolveDesignId } from '@/lib/chromia/server/services/reference-service';

const log = createLogger('operator');

export interface RegisterRow {
  id: string;
  serialNo: number;
  receivedDate: Date;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string | null;
  /** Centimetres — the register's unit. The database stores millimetres. */
  thicknessCm: number | null;
  inTime: Date | null;
  /** Where the slab has got to since it was booked on, and what became of it. */
  status: SlabStatus;
  currentDisposition: Disposition | null;
}

/**
 * Record one line of the operator's register.
 *
 * Date · batch no. · slab no. · file name · in-time. That is the whole entry.
 * The in-time is the Base Primer in-time, and it is the only timestamp the
 * operator writes — the slab comes back out three to four hours later and is
 * next seen at QC.
 *
 * Material and design are chosen from the values the register uses; anything
 * genuinely new is created on the spot rather than forcing the operator to
 * stop and set it up first.
 */
export async function recordOperatorEntry(input: OperatorEntryInput, userId: string) {
  const inTime = combineDateAndTime(input.entryDate, input.inTime);
  if (!inTime) {
    throw new ValidationError('Enter a valid date and in-time');
  }

  const receivedDate = startOfDay(inTime);

  const existing = await prisma.chromiaSlab.findUnique({
    where: { slabNo: input.slabNo },
    select: { id: true },
  });

  if (existing) {
    throw new ConflictError(DUPLICATE_SLAB_NO_MESSAGE);
  }

  const baseMaterialId = await resolveBaseMaterialId(input.baseMaterial);
  const designId = await resolveDesignId(input.fileName);
  const thicknessMm = input.thicknessCm === undefined ? null : input.thicknessCm * 10;

  const slab = await prisma.$transaction(async (tx) => {
    let batch = await tx.chromiaBatch.findUnique({ where: { batchNo: input.batchNo } });

    if (!batch) {
      batch = await tx.chromiaBatch.create({
        data: {
          batchNo: input.batchNo,
          baseMaterialId,
          receivedDate,
          createdById: userId,
        },
      });
    }

    const created = await tx.chromiaSlab.create({
      data: {
        slabNo: input.slabNo,
        batchId: batch.id,
        // The operator chooses the material per slab: one batch can hold more
        // than one, and the batch only records what the first slab was.
        baseMaterialId,
        plannedDesignId: designId,
        originalThicknessMm: thicknessMm,
        currentThicknessMm: thicknessMm,
        status: SlabStatus.IN_PROCESS,
        currentCycleNumber: 1,
        receivedDate,
        createdById: userId,
        updatedById: userId,
      },
    });

    await tx.chromiaBatch.update({
      where: { id: batch.id },
      data: { totalSlabs: { increment: 1 } },
    });

    const cycle = await tx.chromiaProcessCycle.create({
      data: {
        slabId: created.id,
        cycleNumber: 1,
        designId,
        inTime,
        createdById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: created.id,
        cycleId: cycle.id,
        eventType: SlabEventType.SLAB_CREATED,
        toStatus: SlabStatus.IN_PROCESS,
        userId,
        occurredAt: inTime,
        note: `Operator entry — slab ${created.slabNo} into Base Primer (batch ${batch.batchNo})`,
      },
    });

    // No SlabMovement is written: the register has no location column, and a
    // movement without a destination would be a lie in the history.

    return created;
  });

  log.info({ slabId: slab.id, slabNo: slab.slabNo }, 'Operator entry recorded');

  return slab;
}


/** The register for one day, numbered the way the paper book is. */
export async function loadRegisterForDate(day: Date): Promise<RegisterRow[]> {
  const from = startOfDay(day);
  const to = endOfDay(day);

  const cycles = await prisma.chromiaProcessCycle.findMany({
    where: { cycleNumber: 1, inTime: { gte: from, lt: to } },
    orderBy: [{ inTime: 'asc' }, { createdAt: 'asc' }],
    select: {
      inTime: true,
      design: { select: { fileName: true } },
      slab: {
        select: {
          id: true,
          slabNo: true,
          receivedDate: true,
          currentThicknessMm: true,
          status: true,
          currentDisposition: true,
          batch: { select: { batchNo: true } },
          baseMaterial: { select: { name: true } },
          plannedDesign: { select: { fileName: true } },
        },
      },
    },
  });

  return cycles.map((cycle, index) => ({
    id: cycle.slab.id,
    serialNo: index + 1,
    receivedDate: cycle.slab.receivedDate,
    slabNo: cycle.slab.slabNo,
    batchNo: cycle.slab.batch.batchNo,
    baseMaterial: cycle.slab.baseMaterial.name,
    fileName: cycle.design?.fileName ?? cycle.slab.plannedDesign?.fileName ?? null,
    // Decimal is not serialisable across the server/client boundary.
    thicknessCm:
      cycle.slab.currentThicknessMm === null ? null : Number(cycle.slab.currentThicknessMm) / 10,
    inTime: cycle.inTime,
    status: cycle.slab.status,
    currentDisposition: cycle.slab.currentDisposition,
  }));
}

/** Distinct file names, most recently used first — feeds the type-ahead list. */
export async function loadDesignFileNames(): Promise<string[]> {
  const designs = await prisma.chromiaDesign.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { fileName: 'asc' },
    select: { fileName: true },
  });

  return [...new Set(designs.map((design) => design.fileName).filter(Boolean))];
}

/** Base material names, for the register's own dropdown. */
export async function loadBaseMaterialNames(): Promise<string[]> {
  const materials = await prisma.chromiaBaseMaterial.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { name: true },
  });

  return [...new Set(materials.map((material) => material.name))];
}

/** Batch numbers already in use, newest first — feeds the type-ahead list. */
export async function loadRecentBatchNos(): Promise<string[]> {
  const batches = await prisma.chromiaBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { batchNo: true },
  });

  return batches.map((batch) => batch.batchNo);
}
