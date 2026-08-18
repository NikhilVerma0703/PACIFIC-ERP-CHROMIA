import { ChromiaDisposition as Disposition, type ChromiaSlabGrade as SlabGrade, type ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import {
  attemptBudget,
  deriveStage,
  type TrackingStage,
  type TripSummary,
} from '@/lib/chromia/recalibration-tracking';

/**
 * Journeys — every slab that has entered the recalibration loop.
 *
 * A slab qualifies once it has been recalibrated at least once, or the moment
 * QC routes it there. Slabs that sailed through first time never appear, which
 * keeps the section about the problem it exists to solve.
 */

const journeySelect = {
  id: true,
  slabNo: true,
  status: true,
  currentGrade: true,
  currentDisposition: true,
  currentCycleNumber: true,
  recalibrationCount: true,
  originalThicknessMm: true,
  currentThicknessMm: true,
  receivedDate: true,
  batch: { select: { batchNo: true } },
  baseMaterial: { select: { name: true } },
  plannedDesign: { select: { name: true, fileName: true } },
  cycles: {
    orderBy: { cycleNumber: 'desc' },
    select: {
      id: true,
      cycleNumber: true,
      inTime: true,
      outTime: true,
      finalGrade: true,
      disposition: true,
      qcRecord: { select: { id: true } },
    },
  },
  recalibrations: {
    orderBy: { attemptNumber: 'asc' },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      sentDate: true,
      receivedDate: true,
      turnaroundDays: true,
      thicknessBeforeMm: true,
      thicknessAfterMm: true,
      failedCycleId: true,
      restartedCycleId: true,
      reason: { select: { name: true } },
      reasonNotes: true,
    },
  },
} as const;

export interface Journey {
  slabId: string;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  design: string | null;
  receivedDate: Date;
  status: SlabStatus;
  stage: TrackingStage;
  grade: SlabGrade | null;
  disposition: Disposition | null;
  currentCycleNumber: number;
  attempts: ReturnType<typeof attemptBudget>;
  originalThicknessMm: string | null;
  currentThicknessMm: string | null;
  /** Set while the slab is away — how long it has been gone. */
  outSince: Date | null;
  trips: TripSummary[];
}

type Row = {
  id: string;
  slabNo: string;
  status: SlabStatus;
  currentGrade: SlabGrade | null;
  currentDisposition: Disposition | null;
  currentCycleNumber: number;
  recalibrationCount: number;
  originalThicknessMm: { toString(): string } | null;
  currentThicknessMm: { toString(): string } | null;
  receivedDate: Date;
  batch: { batchNo: string };
  baseMaterial: { name: string };
  plannedDesign: { name: string; fileName: string } | null;
  cycles: {
    id: string;
    cycleNumber: number;
    inTime: Date | null;
    outTime: Date | null;
    finalGrade: SlabGrade | null;
    disposition: Disposition | null;
    qcRecord: { id: string } | null;
  }[];
  recalibrations: {
    id: string;
    attemptNumber: number;
    status: string;
    sentDate: Date | null;
    receivedDate: Date | null;
    turnaroundDays: number | null;
    thicknessBeforeMm: { toString(): string } | null;
    thicknessAfterMm: { toString(): string } | null;
    failedCycleId: string | null;
    restartedCycleId: string | null;
    reason: { name: string } | null;
    reasonNotes: string | null;
  }[];
};

function toJourney(row: Row): Journey {
  const cycleByNumber = new Map(row.cycles.map((cycle) => [cycle.id, cycle]));
  const latest = row.cycles[0];

  const stage = deriveStage({
    status: row.status,
    currentDisposition: row.currentDisposition,
    latestOutTime: latest?.outTime ?? null,
    latestHasQc: Boolean(latest?.qcRecord),
  });

  const trips: TripSummary[] = row.recalibrations.map((trip) => {
    // The pass that ran after the slab came back answers "did it work?".
    const restarted = trip.restartedCycleId ? cycleByNumber.get(trip.restartedCycleId) : undefined;
    const failed = trip.failedCycleId ? cycleByNumber.get(trip.failedCycleId) : undefined;

    return {
      attemptNumber: trip.attemptNumber,
      reason: trip.reason?.name ?? trip.reasonNotes ?? null,
      sentDate: trip.sentDate,
      receivedDate: trip.receivedDate,
      turnaroundDays: trip.turnaroundDays,
      thicknessBeforeMm: trip.thicknessBeforeMm?.toString() ?? null,
      thicknessAfterMm: trip.thicknessAfterMm?.toString() ?? null,
      failedCycleNumber: failed?.cycleNumber ?? null,
      restartedCycleNumber: restarted?.cycleNumber ?? null,
      outcomeGrade: restarted?.finalGrade ?? null,
      outcomeDisposition: restarted?.disposition ?? null,
    };
  });

  const openTrip = row.recalibrations.find((trip) => trip.sentDate && !trip.receivedDate);

  return {
    slabId: row.id,
    slabNo: row.slabNo,
    batchNo: row.batch.batchNo,
    baseMaterial: row.baseMaterial.name,
    design: row.plannedDesign?.fileName ?? row.plannedDesign?.name ?? null,
    receivedDate: row.receivedDate,
    status: row.status,
    stage,
    grade: row.currentGrade,
    disposition: row.currentDisposition,
    currentCycleNumber: row.currentCycleNumber,
    attempts: attemptBudget(row.recalibrationCount),
    originalThicknessMm: row.originalThicknessMm?.toString() ?? null,
    currentThicknessMm: row.currentThicknessMm?.toString() ?? null,
    outSince: openTrip?.sentDate ?? null,
    trips,
  };
}

/** Every slab in the loop, newest activity first. */
export async function listJourneys(): Promise<Journey[]> {
  const rows = await prisma.chromiaSlab.findMany({
    where: {
      deletedAt: null,
      OR: [{ recalibrationCount: { gt: 0 } }, { currentDisposition: Disposition.RECALIBRATION }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
    select: journeySelect,
  });

  return rows.map((row) => toJourney(row as Row));
}

/** One slab's journey, for the tracking detail view. */
export async function findJourney(slabId: string): Promise<Journey | null> {
  const row = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: journeySelect,
  });

  return row ? toJourney(row as Row) : null;
}
