import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { buildOutcomeSplit, type OutcomeKey } from '@/lib/chromia/dashboard-live';
import { buildOverallTiles, type OverallCounts } from '@/lib/chromia/dashboard-totals';

/** Start of today, local to the server. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Everything the live dashboard needs, in one round trip.
 *
 * Four questions, four groups of queries: how the plant stands overall, where
 * its slabs are, what has happened today, and what QC just decided. Every
 * figure is read from live transactional data — no nightly roll-up and no
 * cached snapshot, so the screen cannot drift from the shop floor.
 *
 * The overall figures and the distribution bar are deliberately read from the
 * same grouping of `currentDisposition`, so a tile and the bar beneath it can
 * never disagree about how many slabs are in stock.
 */
export async function loadLiveDashboard() {
  const today = startOfToday();

  const [
    outcomeCounts,
    received,
    writtenOff,
    qcDone,
    receivedToday,
    stillProcessing,
    processingDone,
    qcDoneToday,
    leftPlant,
    latestQc,
  ] = await Promise.all([
    // Where every slab ended up, by the outcome that was recorded. Slabs with
    // no outcome yet are the ones still on the line.
    prisma.chromiaSlab.groupBy({
      by: ['currentDisposition'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),

    prisma.chromiaSlab.count({ where: { deletedAt: null } }),

    // A slab leaves the plant in exactly two ways: dispatched, or written off
    // after its final recalibration attempt.
    prisma.chromiaSlab.count({ where: { deletedAt: null, status: SlabStatus.WASTE } }),

    // QC done means a grade has been decided, whatever it turned out to be.
    prisma.chromiaSlab.count({ where: { deletedAt: null, currentGrade: { not: null } } }),

    prisma.chromiaSlab.count({ where: { deletedAt: null, receivedDate: { gte: today } } }),

    // Still on the line: received today, with a cycle that has not been stamped
    // out yet. This is the exact complement of "processing completed" for
    // today's intake — a slab is in one or the other, never both.
    prisma.chromiaSlab.count({
      where: {
        deletedAt: null,
        receivedDate: { gte: today },
        cycles: { some: { outTime: null } },
      },
    }),

    prisma.chromiaProcessCycle.count({ where: { outTime: { gte: today } } }),

    prisma.chromiaGradeDecision.count({ where: { decidedAt: { gte: today } } }),

    prisma.chromiaGradeDecision.groupBy({
      by: ['disposition'],
      where: { decidedAt: { gte: today } },
      _count: { _all: true },
    }),

    prisma.chromiaGradeDecision.findMany({
      orderBy: { decidedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        grade: true,
        disposition: true,
        decidedAt: true,
        slab: { select: { id: true, slabNo: true, batch: { select: { batchNo: true } } } },
      },
    }),
  ]);

  const outcomes: Partial<Record<OutcomeKey, number>> = {};
  for (const row of outcomeCounts) {
    const key: OutcomeKey = row.currentDisposition ?? 'IN_PROCESSING';
    outcomes[key] = (outcomes[key] ?? 0) + row._count._all;
  }

  const byOutcome = (key: OutcomeKey) => outcomes[key] ?? 0;

  const overall: OverallCounts = {
    received,
    dispatched: byOutcome(Disposition.DISPATCH),
    writtenOff,
    inProcessing: byOutcome('IN_PROCESSING'),
    qcDone,
    stocked: byOutcome(Disposition.STOCK),
    sampleCut: byOutcome(Disposition.SAMPLE_CUTTING),
    recalibration: byOutcome(Disposition.RECALIBRATION),
  };

  const dispositionToday = (key: string) =>
    leftPlant.find((row) => row.disposition === key)?._count._all ?? 0;

  return {
    overall: buildOverallTiles(overall),
    outcomes: buildOutcomeSplit(outcomes),
    today: {
      received: receivedToday,
      inProcessing: stillProcessing,
      processingDone,
      qcDone: qcDoneToday,
      dispatched: dispositionToday('DISPATCH'),
      stocked: dispositionToday('STOCK'),
      sampleCut: dispositionToday('SAMPLE_CUTTING'),
      sentForRecalibration: dispositionToday('RECALIBRATION'),
    },
    latestQc,
  };
}

export type LiveDashboard = Awaited<ReturnType<typeof loadLiveDashboard>>;
