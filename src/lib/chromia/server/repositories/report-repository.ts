import { prisma } from '@/lib/chromia/db';
import {
  buildAttemptDistribution,
  buildDailyProduction,
  buildGradeAnalysis,
  buildRecalibrationAnalysis,
  totalsOf,
  type DateRange,
} from '@/lib/chromia/reports';
import { isWithinRangeDays, padRange } from '@/lib/chromia/exports';
import {
  buildDailyActivity,
  buildHeadline,
  buildMaterialSummary,
  buildOutcomeMix,
  buildRecalibrationFunnel,
  totalDailyRow,
  totalMaterialRow,
  type SummarySlab,
} from '@/lib/chromia/production-summary';
import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';

/**
 * Report data for a date range.
 *
 * Rows are fetched thin and aggregated in `@/lib/reports`, so the same numbers
 * drive the screen and the Excel export with no duplicated logic.
 */
export async function loadReports(range: DateRange) {
  const within = { gte: range.from, lte: range.to };

  const [received, completed, qc, dispatched, recalSent, gradedSlabs, recalibrations, slabCounts] =
    await Promise.all([
      prisma.chromiaSlab.findMany({
        where: { deletedAt: null, receivedDate: within },
        select: { receivedDate: true },
      }),

      prisma.chromiaProcessCycle.findMany({
        where: { outTime: within },
        select: { outTime: true },
      }),

      prisma.chromiaQcRecord.findMany({
        where: { inspectedAt: within },
        select: { inspectedAt: true },
      }),

      prisma.chromiaDispatch.findMany({
        where: { dispatchDate: within },
        select: { dispatchDate: true },
      }),

      prisma.chromiaRecalibrationCycle.findMany({
        where: { sentDate: within },
        select: { sentDate: true },
      }),

      prisma.chromiaSlab.findMany({
        where: { deletedAt: null, receivedDate: within, currentGrade: { not: null } },
        select: {
          currentGrade: true,
          baseMaterial: { select: { name: true } },
          plannedDesign: { select: { name: true } },
        },
      }),

      prisma.chromiaRecalibrationCycle.findMany({
        where: { sentDate: within },
        select: {
          turnaroundDays: true,
          receivedDate: true,
          reason: { select: { name: true } },
        },
      }),

      prisma.chromiaSlab.findMany({
        where: { deletedAt: null, receivedDate: within },
        select: { recalibrationCount: true },
      }),
    ]);

  const daily = buildDailyProduction({
    received: received.map((row) => ({ at: row.receivedDate })),
    processingCompleted: completed
      .filter((row): row is { outTime: Date } => row.outTime !== null)
      .map((row) => ({ at: row.outTime })),
    qualityChecks: qc.map((row) => ({ at: row.inspectedAt })),
    dispatched: dispatched.map((row) => ({ at: row.dispatchDate })),
    sentForRecalibration: recalSent
      .filter((row): row is { sentDate: Date } => row.sentDate !== null)
      .map((row) => ({ at: row.sentDate })),
  });

  return {
    range,
    daily,
    totals: totalsOf(daily),
    byMaterial: buildGradeAnalysis(
      gradedSlabs.map((row) => ({ name: row.baseMaterial.name, grade: row.currentGrade })),
    ),
    byDesign: buildGradeAnalysis(
      gradedSlabs.map((row) => ({
        name: row.plannedDesign?.name ?? 'No design recorded',
        grade: row.currentGrade,
      })),
    ),
    byReason: buildRecalibrationAnalysis(
      recalibrations.map((row) => ({
        reason: row.reason?.name ?? null,
        turnaroundDays: row.turnaroundDays,
        returned: row.receivedDate !== null,
      })),
    ),
    attempts: buildAttemptDistribution(slabCounts, MAX_RECALIBRATION_ATTEMPTS),
  };
}

export type ReportData = Awaited<ReturnType<typeof loadReports>>;

/**
 * Production summary — one cohort, four views.
 *
 * The cohort is every slab **received inside the window**. Headline figures,
 * outcome mix, funnel and the material table all measure that same set, so a
 * percentage on one card can be compared with a percentage on another. The
 * daily trend is separate by design: it is a diary of activity, not a cohort.
 */
export async function loadProductionSummary(range: DateRange) {
  // Padded for the query, filtered exactly by calendar day afterwards — a
  // received date is a calendar day stored as an instant, so comparing
  // instants alone drops rows that sit exactly on a boundary.
  const within = padRange(range);
  const onDay = (date: Date | null) => isWithinRangeDays(date, range);

  const [cohort, completed, dispatched, stocked, sampleCut, sentForRecalibration] =
    await Promise.all([
      prisma.chromiaSlab.findMany({
        where: { deletedAt: null, receivedDate: within },
        select: {
          status: true,
          currentDisposition: true,
          recalibrationCount: true,
          receivedDate: true,
          baseMaterial: { select: { name: true } },
          recalibrations: { select: { receivedDate: true } },
        },
      }),

      prisma.chromiaProcessCycle.findMany({ where: { outTime: within }, select: { outTime: true } }),
      prisma.chromiaDispatch.findMany({ where: { dispatchDate: within }, select: { dispatchDate: true } }),
      prisma.chromiaStockEntry.findMany({ where: { stockDate: within }, select: { stockDate: true } }),
      prisma.chromiaSampleCutting.findMany({ where: { cutDate: within }, select: { cutDate: true } }),
      prisma.chromiaRecalibrationCycle.findMany({
        where: { sentDate: within },
        select: { sentDate: true },
      }),
    ]);

  const inCohort = cohort.filter((slab) => onDay(slab.receivedDate));

  const slabs: SummarySlab[] = inCohort.map((slab) => ({
    status: slab.status,
    disposition: slab.currentDisposition,
    recalibrationCount: slab.recalibrationCount,
    returnedFromRecalibration: slab.recalibrations.some((trip) => trip.receivedDate !== null),
    materialName: slab.baseMaterial.name,
  }));

  const onlyDays = (dates: (Date | null)[]) => dates.filter((date): date is Date => onDay(date));

  const daily = buildDailyActivity({
    received: inCohort.map((slab) => slab.receivedDate),
    processingDone: onlyDays(completed.map((row) => row.outTime)),
    dispatched: onlyDays(dispatched.map((row) => row.dispatchDate)),
    stocked: onlyDays(stocked.map((row) => row.stockDate)),
    sampleCut: onlyDays(sampleCut.map((row) => row.cutDate)),
    recalibration: onlyDays(sentForRecalibration.map((row) => row.sentDate)),
  });

  const materials = buildMaterialSummary(slabs);

  return {
    range,
    headline: buildHeadline(slabs),
    outcomes: buildOutcomeMix(slabs),
    funnel: buildRecalibrationFunnel(slabs),
    daily,
    dailyTotal: totalDailyRow(daily),
    materials,
    materialTotal: totalMaterialRow(materials),
  };
}

export type ProductionSummary = Awaited<ReturnType<typeof loadProductionSummary>>;
