import type { ChromiaDisposition as Disposition } from '@prisma/client';
import { ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { ConflictError, ValidationError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { combineDateAndTime, registerDay } from '@/lib/chromia/operator-register';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import type { OperatorEntryInput } from '@/lib/chromia/validation/operator';
import { resolveBaseMaterialId, resolveDesignId } from '@/lib/chromia/server/services/reference-service';

const log = createLogger('operator');

export interface RegisterRow {
  id: string;
  /** Its number within its OWN production date — what the paper book says. */
  serialNo: number;
  receivedDate: Date;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string | null;
  /** Centimetres — the register's unit. The database stores millimetres. */
  thicknessCm: number | null;
  inTime: Date | null;
  /** When the row was actually saved — what "recent" is ordered by. */
  enteredAt: Date;
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
  /*
   * The production date is what dates the record — not the in-time, which is
   * now optional. The two agree whenever a time was typed, because
   * startOfDay(date + time) is the same midnight; what changes is that an
   * entry with no time still has a date, and it is the one the operator chose.
   */
  const receivedDate = registerDay(input.entryDate);
  if (!receivedDate) {
    throw new ValidationError('Enter a valid production date');
  }

  const inTime = input.inTime ? combineDateAndTime(input.entryDate, input.inTime) : null;
  if (input.inTime && !inTime) {
    throw new ValidationError('Enter a valid in-time');
  }

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
        // The moment it happened, as well as it is known: the stamped in-time,
        // or the production date when none was stamped.
        occurredAt: inTime ?? receivedDate,
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


/** How many rows "Recent slabs" shows. */
export const RECENT_REGISTER_LIMIT = 20;

const slabSelect = {
  id: true,
  slabNo: true,
  receivedDate: true,
  createdAt: true,
  currentThicknessMm: true,
  status: true,
  currentDisposition: true,
  batch: { select: { batchNo: true } },
  baseMaterial: { select: { name: true } },
  plannedDesign: { select: { fileName: true } },
  cycles: {
    where: { cycleNumber: 1 },
    take: 1,
    select: { inTime: true, design: { select: { fileName: true } } },
  },
} as const;

/**
 * The most recently ENTERED slabs, whatever day they were produced on.
 *
 * This replaced "Today's register", which listed one day and found it by the
 * cycle's in-time. Two things were wrong with that, and both bite the same
 * operator on the same afternoon:
 *
 *   - the in-time is optional now, and a row entered without one would not
 *     have appeared in any day's list at all; and
 *   - the production date is the operator's to choose and is often an older
 *     day being caught up, so a row saved just now would vanish from the
 *     screen the moment it was saved, which reads as the save having failed.
 *
 * So the list is ordered strictly by when the row was SAVED. It is the answer
 * to "did that go in?", which is the only question this table is asked.
 *
 * S. No. still means what the paper book means by it — the entry's number
 * within its own production date — so the numbers here match the register even
 * though the rows are from several days. It is worked out from every slab on
 * those dates, not just the ones on screen, which is why the second query is
 * not simply the twenty rows counted.
 */
export async function loadRecentRegister(
  limit: number = RECENT_REGISTER_LIMIT,
): Promise<RegisterRow[]> {
  const recent = await prisma.chromiaSlab.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: slabSelect,
  });

  if (recent.length === 0) return [];

  // Every slab on the production dates these twenty span, oldest first, so a
  // row can be told its position within its own day.
  const dates = [...new Set(recent.map((slab) => slab.receivedDate.getTime()))].map(
    (time) => new Date(time),
  );
  const sameDays = await prisma.chromiaSlab.findMany({
    where: { receivedDate: { in: dates } },
    orderBy: [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, receivedDate: true },
  });

  const serialById = new Map<string, number>();
  const runningByDate = new Map<number, number>();
  for (const slab of sameDays) {
    const key = slab.receivedDate.getTime();
    const next = (runningByDate.get(key) ?? 0) + 1;
    runningByDate.set(key, next);
    serialById.set(slab.id, next);
  }

  return recent.map((slab) => toRegisterRow(slab, serialById.get(slab.id) ?? 0));
}

type SlabWithCycle = {
  id: string;
  slabNo: string;
  receivedDate: Date;
  createdAt: Date;
  currentThicknessMm: unknown;
  status: SlabStatus;
  currentDisposition: Disposition | null;
  batch: { batchNo: string };
  baseMaterial: { name: string };
  plannedDesign: { fileName: string } | null;
  cycles: { inTime: Date | null; design: { fileName: string } | null }[];
};

function toRegisterRow(slab: SlabWithCycle, serialNo: number): RegisterRow {
  const cycle = slab.cycles[0];
  return {
    id: slab.id,
    serialNo,
    receivedDate: slab.receivedDate,
    slabNo: slab.slabNo,
    batchNo: slab.batch.batchNo,
    baseMaterial: slab.baseMaterial.name,
    fileName: cycle?.design?.fileName ?? slab.plannedDesign?.fileName ?? null,
    // Decimal is not serialisable across the server/client boundary.
    thicknessCm:
      slab.currentThicknessMm === null ? null : Number(slab.currentThicknessMm) / 10,
    inTime: cycle?.inTime ?? null,
    enteredAt: slab.createdAt,
    status: slab.status,
    currentDisposition: slab.currentDisposition,
  };
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
