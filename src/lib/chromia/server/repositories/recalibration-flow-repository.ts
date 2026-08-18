import { ChromiaDisposition as Disposition } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';

/**
 * Everything the Recalibration page reads.
 *
 * The list is deliberately wider than "outcome = Recalibration". A slab that
 * has come back and gone down the line again has no outcome at all for a few
 * hours — the next pass has not been graded yet — and that is precisely the
 * moment the in-charge needs to find it, to record the new QC. Filtering on the
 * outcome alone would make the slab vanish mid-journey and reappear later,
 * which is the sort of thing that gets a slab lost. So: anything currently
 * condemned, plus anything that has ever been sent.
 */

const SLAB_FIELDS = {
  id: true,
  slabNo: true,
  status: true,
  currentGrade: true,
  currentDisposition: true,
  currentThicknessMm: true,
  receivedDate: true,
  remarks: true,
  batch: { select: { batchNo: true } },
  baseMaterial: { select: { name: true } },
  plannedDesign: { select: { name: true, fileName: true } },
  cycles: {
    orderBy: { cycleNumber: 'desc' },
    take: 1,
    select: { inTime: true, outTime: true, fullyPrintedDate: true },
  },
  recalibrations: {
    orderBy: { attemptNumber: 'asc' },
    select: {
      id: true,
      attemptNumber: true,
      sentDate: true,
      receivedDate: true,
      restartedAt: true,
      createdAt: true,
      reason: { select: { name: true } },
    },
  },
} as const;

function shape<
  T extends {
    currentThicknessMm: unknown;
    cycles: { inTime: Date | null; outTime: Date | null; fullyPrintedDate: Date | null }[];
    recalibrations: {
      attemptNumber: number;
      sentDate: Date | null;
      receivedDate: Date | null;
      restartedAt: Date | null;
      createdAt: Date;
      reason: { name: string } | null;
    }[];
  },
>(slab: T) {
  const { cycles, currentThicknessMm, ...rest } = slab;
  const trips = slab.recalibrations;
  const latest = trips[trips.length - 1];

  return {
    ...rest,
    // Decimal does not cross the server/client boundary, and the register works
    // in centimetres while the database stores millimetres.
    thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
    inTime: cycles[0]?.inTime ?? null,
    fullyPrintedDate: cycles[0]?.fullyPrintedDate ?? null,
    trips: trips.map(({ reason: _reason, createdAt: _createdAt, ...trip }) => trip),
    /** The reason QC gave, carried from the newest record that has one. */
    reason: [...trips].reverse().find((trip) => trip.reason)?.reason?.name ?? null,
    /** When QC condemned the slab — where the waiting clock starts. */
    condemnedAt: latest?.createdAt ?? null,
    sentDate: latest?.sentDate ?? null,
    returnedDate: latest?.receivedDate ?? null,
  };
}

export async function listRecalibrationRecords() {
  const slabs = await prisma.chromiaSlab.findMany({
    where: {
      deletedAt: null,
      OR: [{ currentDisposition: Disposition.RECALIBRATION }, { recalibrations: { some: {} } }],
    },
    orderBy: [{ updatedAt: 'desc' }],
    select: SLAB_FIELDS,
  });

  return slabs.map(shape);
}

export type RecalibrationRecord = Awaited<ReturnType<typeof listRecalibrationRecords>>[number];

/**
 * The same records, narrowed by the tracking filters.
 *
 * Batch, slab, material, design and the date range are pushed into the query;
 * the attempt is applied afterwards in `recalibration-kpis`, because "attempts
 * used" is derived from the trips rather than stored, and the page and the
 * filter must agree on one definition of it.
 */
export async function searchRecalibrationRecords(filters: {
  batchNo: string;
  slabNo: string;
  baseMaterialId: string | null;
  designId: string | null;
  receivedFrom: Date | null;
  receivedTo: Date | null;
}) {
  const slabs = await prisma.chromiaSlab.findMany({
    where: {
      deletedAt: null,
      OR: [{ currentDisposition: Disposition.RECALIBRATION }, { recalibrations: { some: {} } }],
      ...(filters.slabNo
        ? { slabNo: { contains: filters.slabNo, mode: 'insensitive' as const } }
        : {}),
      ...(filters.batchNo
        ? { batch: { batchNo: { contains: filters.batchNo, mode: 'insensitive' as const } } }
        : {}),
      ...(filters.baseMaterialId ? { baseMaterialId: filters.baseMaterialId } : {}),
      ...(filters.designId ? { plannedDesignId: filters.designId } : {}),
      ...(filters.receivedFrom || filters.receivedTo
        ? {
            receivedDate: {
              ...(filters.receivedFrom ? { gte: filters.receivedFrom } : {}),
              ...(filters.receivedTo ? { lte: filters.receivedTo } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    select: SLAB_FIELDS,
  });

  return slabs.map(shape);
}

export async function findRecalibrationRecord(slabId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: SLAB_FIELDS,
  });

  return slab ? shape(slab) : null;
}
