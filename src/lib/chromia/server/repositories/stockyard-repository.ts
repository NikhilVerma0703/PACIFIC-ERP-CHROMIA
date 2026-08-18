import { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';

/**
 * Stockyard data access.
 *
 * Two questions only: what is on the racks, and what has left them.
 */

/** Every slab whose current outcome is Stock, oldest holding first. */
export async function listStockedSlabs() {
  const slabs = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null, status: SlabStatus.IN_STOCK },
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
      stockEntries: {
        where: { releasedAt: null },
        orderBy: { stockDate: 'desc' },
        take: 1,
        select: { stockDate: true },
      },
    },
  });

  return slabs.map(({ stockEntries, currentThicknessMm, ...slab }) => ({
    ...slab,
    thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
    stockDate: stockEntries[0]?.stockDate ?? null,
  }));
}

export type StockedSlab = Awaited<ReturnType<typeof listStockedSlabs>>[number];

/**
 * Slabs that went out from the racks — the release log.
 *
 * A dispatch counts as a stockyard release when the slab has a closed stock
 * holding behind it, which is exactly what `recordDispatch` writes when it
 * releases the rack.
 */
export async function listStockReleases(take = 50) {
  const dispatches = await prisma.chromiaDispatch.findMany({
    where: { slab: { deletedAt: null, stockEntries: { some: { releasedAt: { not: null } } } } },
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
          currentGrade: true,
          currentThicknessMm: true,
          batch: { select: { batchNo: true } },
          baseMaterial: { select: { name: true } },
          plannedDesign: { select: { name: true, fileName: true } },
          stockEntries: {
            where: { releasedAt: { not: null } },
            orderBy: { releasedAt: 'desc' },
            take: 1,
            select: { stockDate: true },
          },
        },
      },
    },
  });

  return dispatches.map((dispatch) => ({
    id: dispatch.id,
    dispatchDate: dispatch.dispatchDate,
    recordedAt: dispatch.createdAt,
    slabId: dispatch.slab.id,
    slabNo: dispatch.slab.slabNo,
    batchNo: dispatch.slab.batch.batchNo,
    baseMaterial: dispatch.slab.baseMaterial.name,
    designFileName:
      dispatch.slab.plannedDesign?.fileName ?? dispatch.slab.plannedDesign?.name ?? null,
    thicknessCm:
      dispatch.slab.currentThicknessMm === null
        ? null
        : Number(dispatch.slab.currentThicknessMm) / 10,
    grade: dispatch.slab.currentGrade,
    stockDate: dispatch.slab.stockEntries[0]?.stockDate ?? null,
  }));
}

export type StockRelease = Awaited<ReturnType<typeof listStockReleases>>[number];
