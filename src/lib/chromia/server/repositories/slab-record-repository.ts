import { prisma } from '@/lib/chromia/db';

/**
 * Reads for correcting and removing a slab record.
 *
 * Separate from `slab-repository`, which answers "which slabs match this
 * search". This one answers "what exactly does this one record say", which is
 * a different shape: one row, every field the form can write, and the latest
 * production cycle it belongs to.
 */

/** Everything the edit form needs, as the form's own field types. */
export async function loadSlabRecord(slabId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      // Where the slab has got to, so a screen can tell whether there is any
      // QC left to offer on it — see needsIntakeQc.
      status: true,
      receivedDate: true,
      remarks: true,
      currentThicknessMm: true,
      // The QC decision, so the Edit screen can pre-fill and correct it.
      currentGrade: true,
      currentDisposition: true,
      recalibrationCount: true,
      batch: { select: { id: true, batchNo: true } },
      baseMaterial: { select: { id: true, name: true } },
      plannedDesign: { select: { id: true, name: true, fileName: true } },
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { id: true, cycleNumber: true, inTime: true },
      },
    },
  });

  if (!slab) return null;

  const cycle = slab.cycles[0] ?? null;

  return {
    id: slab.id,
    slabNo: slab.slabNo,
    status: slab.status,
    receivedDate: slab.receivedDate,
    remarks: slab.remarks,
    currentGrade: slab.currentGrade,
    currentDisposition: slab.currentDisposition,
    // Decimal does not survive the trip to a client component, and the register
    // works in centimetres while the database stores millimetres.
    thicknessCm:
      slab.currentThicknessMm === null ? null : Number(slab.currentThicknessMm) / 10,
    recalibrationCount: slab.recalibrationCount,
    batchNo: slab.batch.batchNo,
    batchId: slab.batch.id,
    baseMaterial: slab.baseMaterial.name,
    designFileName: slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? '',
    cycleId: cycle?.id ?? null,
    cycleNumber: cycle?.cycleNumber ?? null,
    inTime: cycle?.inTime ?? null,
  };
}

export type SlabRecord = NonNullable<Awaited<ReturnType<typeof loadSlabRecord>>>;

/**
 * Is this slab number already spoken for?
 *
 * `exceptId` is the record being edited: a slab keeping its own number is not a
 * duplicate of itself. Deleted slabs still count — the number is theirs until
 * the record is actually removed, and the database's own unique index makes no
 * exception for them either.
 */
export async function findSlabIdByNo(slabNo: string): Promise<string | null> {
  const existing = await prisma.chromiaSlab.findUnique({
    where: { slabNo },
    select: { id: true },
  });

  return existing?.id ?? null;
}

/** True when saving this number would collide with a different record. */
export async function isSlabNoTaken(slabNo: string, exceptId?: string): Promise<boolean> {
  const owner = await findSlabIdByNo(slabNo);
  return owner !== null && owner !== exceptId;
}
