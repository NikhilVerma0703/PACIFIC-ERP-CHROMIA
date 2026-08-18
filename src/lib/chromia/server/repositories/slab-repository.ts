import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { needsIntakeQc } from '@/lib/chromia/slab-links';
import { buildSlabWhere, type SlabFilters } from '@/lib/chromia/slab-filters';

/**
 * Slab data access. Prisma queries only — no business rules.
 */

export function findSlabByNo(slabNo: string) {
  return prisma.chromiaSlab.findUnique({ where: { slabNo } });
}

export function countSlabs() {
  return prisma.chromiaSlab.count({ where: { deletedAt: null } });
}

/** Most recent slabs, with everything the list view renders. */
export async function listRecentSlabs(take = 50) {
  const slabs = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null },
    orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
    take,
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentStage: true,
      currentCycleNumber: true,
      currentGrade: true,
      currentDisposition: true,
      recalibrationCount: true,
      receivedDate: true,
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true } },
      currentLocation: { select: { name: true } },
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { inTime: true, outTime: true, processingMinutes: true },
      },
    },
  });

  return slabs.map(({ cycles, ...slab }) => ({
    ...slab,
    inTime: cycles[0]?.inTime ?? null,
    outTime: cycles[0]?.outTime ?? null,
    processingMinutes: cycles[0]?.processingMinutes ?? null,
  }));
}

export type SlabListItem = Awaited<ReturnType<typeof listRecentSlabs>>[number];

/**
 * Filtered, paged slab search — the traceability lookup.
 * Returns the page of rows plus the total, so the UI can page accurately.
 */
export async function searchSlabs(filters: SlabFilters) {
  const where = buildSlabWhere(filters) as Prisma.ChromiaSlabWhereInput;

  const [rows, total] = await Promise.all([
    prisma.chromiaSlab.findMany({
      where,
      orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: {
        id: true,
        slabNo: true,
        status: true,
        currentCycleNumber: true,
        currentGrade: true,
        currentDisposition: true,
        currentThicknessMm: true,
        recalibrationCount: true,
        isRecalibrationOut: true,
        receivedDate: true,
        remarks: true,
        batch: { select: { batchNo: true } },
        baseMaterial: { select: { name: true } },
        plannedDesign: { select: { name: true, fileName: true } },
        currentLocation: { select: { name: true } },
        cycles: {
          orderBy: { cycleNumber: 'desc' },
          take: 1,
          select: { inTime: true, outTime: true, fullyPrintedDate: true },
        },
      },
    }),
    prisma.chromiaSlab.count({ where }),
  ]);

  return {
    total,
    rows: rows.map(({ cycles, currentThicknessMm, ...slab }) => ({
      ...slab,
      // Decimal is not serialisable across the server/client boundary, and the
      // register works in centimetres while the database stores millimetres.
      thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
      inTime: cycles[0]?.inTime ?? null,
      outTime: cycles[0]?.outTime ?? null,
      fullyPrintedDate: cycles[0]?.fullyPrintedDate ?? null,
    })),
  };
}

export type SlabSearchRow = Awaited<ReturnType<typeof searchSlabs>>['rows'][number];

/** Options for the slab list filter bar. */
export function loadFilterOptions() {
  return Promise.all([
    prisma.chromiaBaseMaterial.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.chromiaDesign.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
}

/**
 * Reference data needed by the intake form.
 *
 * Only the stock racks now. Material and artwork are chosen by the operator
 * when the slab goes on the line, and Grade C leads to Recalibration rather
 * than Waste, so the defect list is no longer offered here either.
 */
export function loadIntakeOptions() {
  return prisma.chromiaLocation.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/** Everything the slab detail view renders: stage plan, history, cycles. */
export function findSlabDetail(slabId: string) {
  return prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    include: {
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true } },
      currentLocation: { select: { name: true } },
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        include: {
          design: { select: { name: true } },
          qcRecord: {
            include: {
              // The inspector is an ERP user id with no foreign key here — see
              // lib/chromia/actors.ts if a screen ever needs to show the name.
              defects: { include: { defectType: { select: { name: true } } } },
            },
          },
          gradeDecision: {
            include: {
              targetLocation: { select: { name: true } },
            },
          },
        },
      },
      dispatches: { orderBy: { dispatchDate: 'desc' }, select: { id: true, dispatchDate: true } },
      stockEntries: {
        orderBy: { stockDate: 'desc' },
        include: { location: { select: { name: true } } },
      },
      sampleCuttings: { orderBy: { cutDate: 'desc' } },
      wasteRecord: { include: { finalDefectType: { select: { name: true } } } },
      recalibrations: {
        orderBy: { attemptNumber: 'desc' },
        include: {
          reason: { select: { name: true } },
        },
      },
      events: {
        orderBy: { occurredAt: 'desc' },
        take: 40,
        include: {
          location: { select: { name: true } },
        },
      },
    },
  });
}

export type SlabDetail = NonNullable<Awaited<ReturnType<typeof findSlabDetail>>>;

/** Reference data for the out-time, quality-check and disposition forms. */
export function loadStageOptions() {
  return Promise.all([
    prisma.chromiaDefectType.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.chromiaLocation.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
}

/** Stock racks only, for the stock form. */
export function listStockLocations() {
  return prisma.chromiaLocation.findMany({
    where: { isActive: true, deletedAt: null, type: 'STOCK_RACK' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/**
 * A slab that is being finished on the intake form.
 *
 * Returns null when the slab is already graded — that record belongs on the
 * detail page, and re-opening the form for it would invite a second grade
 * decision on a cycle that already has one.
 */
export async function loadSlabForIntake(id: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentThicknessMm: true,
      receivedDate: true,
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true, fileName: true } },
      batch: { select: { batchNo: true } },
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { id: true, inTime: true, outTime: true, fullyPrintedDate: true },
      },
    },
  });

  if (!slab || !needsIntakeQc(slab.status)) return null;

  const cycle = slab.cycles[0];

  return {
    id: slab.id,
    slabNo: slab.slabNo,
    batchNo: slab.batch.batchNo,
    baseMaterial: slab.baseMaterial.name,
    // The form works in file names, which is what the register writes.
    designFileName: slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? '',
    thicknessCm: slab.currentThicknessMm ? Number(slab.currentThicknessMm) / 10 : null,
    receivedDate: slab.receivedDate,
    inTime: cycle?.inTime ?? null,
    outTime: cycle?.outTime ?? null,
    fullyPrintedDate: cycle?.fullyPrintedDate ?? null,
  };
}

export type SlabForIntake = NonNullable<Awaited<ReturnType<typeof loadSlabForIntake>>>;
