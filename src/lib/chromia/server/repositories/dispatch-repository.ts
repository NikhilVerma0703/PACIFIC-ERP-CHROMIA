import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { simpleSlabWhere, type SimpleFilters } from '@/lib/chromia/simple-filters';

/**
 * Dispatch data access.
 *
 * Two questions, kept apart the way the Stockyard keeps its racks and its
 * release log apart:
 *
 *   • what QC has decided to dispatch but nobody has actually sent yet — a slab
 *     whose outcome is Dispatch and whose status is still GRADED (decided, not
 *     gone); and
 *   • what has actually been dispatched straight from the line — a real dispatch
 *     record with no closed stock holding behind it. A slab that was stocked and
 *     then dispatched belongs to the Stockyard's own release log, not here, so
 *     the two pages never show the same departure twice.
 */

/** Slabs QC marked for dispatch that are still waiting to be sent. */
export async function listAwaitingDispatch(filters?: SimpleFilters) {
  const slabs = await prisma.chromiaSlab.findMany({
    where: {
      deletedAt: null,
      status: SlabStatus.GRADED,
      currentDisposition: Disposition.DISPATCH,
      ...(filters ? simpleSlabWhere(filters) : {}),
    },
    orderBy: [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slabNo: true,
      receivedDate: true,
      currentThicknessMm: true,
      currentGrade: true,
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true, fileName: true } },
    },
  });

  return slabs.map(({ currentThicknessMm, ...slab }) => ({
    ...slab,
    thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
  }));
}

export type AwaitingDispatchSlab = Awaited<ReturnType<typeof listAwaitingDispatch>>[number];

/**
 * Slabs actually dispatched straight from the line (not via stock).
 *
 * Mirrors the Stockyard's release log exactly, but for the other kind of
 * departure: a dispatch whose slab has NO closed stock holding.
 */
export async function listDirectDispatches(take = 50) {
  const dispatches = await prisma.chromiaDispatch.findMany({
    where: {
      slab: { deletedAt: null, stockEntries: { none: { releasedAt: { not: null } } } },
    },
    orderBy: [{ dispatchDate: 'desc' }, { createdAt: 'desc' }],
    take,
    select: {
      id: true,
      dispatchDate: true,
      createdAt: true,
      slab: {
        select: {
          id: true,
          slabNo: true,
          receivedDate: true,
          currentGrade: true,
          currentThicknessMm: true,
          batch: { select: { batchNo: true } },
          baseMaterial: { select: { name: true } },
          plannedDesign: { select: { name: true, fileName: true } },
        },
      },
    },
  });

  return dispatches.map((dispatch) => ({
    id: dispatch.id,
    dispatchDate: dispatch.dispatchDate,
    slabId: dispatch.slab.id,
    slabNo: dispatch.slab.slabNo,
    receivedDate: dispatch.slab.receivedDate,
    batchNo: dispatch.slab.batch.batchNo,
    baseMaterial: dispatch.slab.baseMaterial.name,
    designFileName:
      dispatch.slab.plannedDesign?.fileName ?? dispatch.slab.plannedDesign?.name ?? null,
    thicknessCm:
      dispatch.slab.currentThicknessMm === null
        ? null
        : Number(dispatch.slab.currentThicknessMm) / 10,
    grade: dispatch.slab.currentGrade,
  }));
}

export type DirectDispatch = Awaited<ReturnType<typeof listDirectDispatches>>[number];
