import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';

/**
 * Recalibration tracking — the journey model.
 *
 * A slab's life is an alternating chain of **passes** (a run down the Chromia
 * line, one `ProcessCycle`) and **trips** (a visit to the recalibration
 * facility, one `RecalibrationCycle`):
 *
 *   Pass 1 --fail C--> Trip 1 --returns--> Pass 2 --pass A--> Dispatched
 *
 * Most slabs stop after the first trip. Attempts are created *by failure*, never
 * in advance: there is no pool of five slots waiting to be used. Five is only a
 * ceiling, and reaching Grade A or B closes the journey for good, because the
 * only route to a new attempt is a Grade C decision that chooses Recalibration.
 *
 * Everything in this module is pure, so the rules are unit-testable without a
 * database and the stage can never drift from the slab's real state — it is
 * derived on every read rather than stored.
 */

export const TRACKING_STAGES = [
  'AWAITING_DESPATCH',
  'AT_FACILITY',
  'AWAITING_RESTART',
  'REPROCESSING',
  'AWAITING_QC',
  'PASSED',
  'WRITTEN_OFF',
] as const;

export type TrackingStage = (typeof TRACKING_STAGES)[number];

export const STAGE_LABELS: Record<TrackingStage, string> = {
  AWAITING_DESPATCH: 'Awaiting despatch',
  AT_FACILITY: 'At facility',
  AWAITING_RESTART: 'Awaiting restart',
  REPROCESSING: 'Reprocessing',
  AWAITING_QC: 'Awaiting QC',
  PASSED: 'Passed',
  WRITTEN_OFF: 'Written off',
};

/** What the next person has to do. Empty for a closed journey. */
export const STAGE_ACTIONS: Record<TrackingStage, string> = {
  AWAITING_DESPATCH: 'Send the slab out',
  AT_FACILITY: 'Book it back in when it returns',
  AWAITING_RESTART: 'Restart the process',
  REPROCESSING: 'Record the out-time',
  AWAITING_QC: 'Inspect and grade',
  PASSED: '',
  WRITTEN_OFF: '',
};

/** Journeys that still need somebody to do something. */
export const OPEN_STAGES: readonly TrackingStage[] = [
  'AWAITING_DESPATCH',
  'AT_FACILITY',
  'AWAITING_RESTART',
  'REPROCESSING',
  'AWAITING_QC',
];

export function isClosed(stage: TrackingStage): boolean {
  return stage === 'PASSED' || stage === 'WRITTEN_OFF';
}

export interface StageInput {
  status: SlabStatus;
  currentDisposition: Disposition | null;
  /** Out-time of the slab's newest process cycle, if recorded. */
  latestOutTime: Date | null;
  /** Whether the newest cycle has been inspected. */
  latestHasQc: boolean;
}

/**
 * Where the slab stands right now.
 *
 * Read top to bottom: the terminal states win first, so a dispatched slab is
 * never reported as "reprocessing" because of a stale cycle.
 */
export function deriveStage(input: StageInput): TrackingStage {
  switch (input.status) {
    case SlabStatus.WASTE:
      return 'WRITTEN_OFF';

    case SlabStatus.DISPATCHED:
    case SlabStatus.IN_STOCK:
    case SlabStatus.SAMPLE_CUT:
      return 'PASSED';

    case SlabStatus.OUT_FOR_RECALIBRATION:
      return 'AT_FACILITY';

    case SlabStatus.RECEIVED_FROM_RECALIBRATION:
      return 'AWAITING_RESTART';

    case SlabStatus.UNDER_INSPECTION:
      return 'AWAITING_QC';

    case SlabStatus.GRADED:
      // Graded C and routed to recalibration, but not yet handed over.
      return input.currentDisposition === Disposition.RECALIBRATION
        ? 'AWAITING_DESPATCH'
        : 'AWAITING_QC';

    default:
      // In process, received, on hold: off the line means QC is next.
      return input.latestOutTime && !input.latestHasQc ? 'AWAITING_QC' : 'REPROCESSING';
  }
}

// ------------------------------------------------------------- attempts ---

export interface AttemptBudget {
  used: number;
  remaining: number;
  max: number;
  /** True once no further trip may be created — the next Grade C is waste. */
  exhausted: boolean;
}

export function attemptBudget(used: number): AttemptBudget {
  const capped = Math.max(0, Math.min(used, MAX_RECALIBRATION_ATTEMPTS));
  return {
    used: capped,
    remaining: MAX_RECALIBRATION_ATTEMPTS - capped,
    max: MAX_RECALIBRATION_ATTEMPTS,
    exhausted: capped >= MAX_RECALIBRATION_ATTEMPTS,
  };
}

/**
 * Whether a further trip is legal.
 *
 * Two conditions, both real business rules: the journey must still be open —
 * a slab that reached Grade A and was dispatched is finished — and the ceiling
 * must not be reached.
 */
export function canRecalibrateAgain(stage: TrackingStage, used: number): boolean {
  return !isClosed(stage) && !attemptBudget(used).exhausted;
}

// -------------------------------------------------------------- journey ---

export interface TripSummary {
  attemptNumber: number;
  reason: string | null;
  sentDate: Date | null;
  receivedDate: Date | null;
  turnaroundDays: number | null;
  thicknessBeforeMm: string | null;
  thicknessAfterMm: string | null;
  /** The pass that failed and caused this trip. */
  failedCycleNumber: number | null;
  /** The pass that ran after it came back, if it has been restarted. */
  restartedCycleNumber: number | null;
  /** Grade of that following pass — the answer to "did it work?". */
  outcomeGrade: string | null;
  outcomeDisposition: Disposition | null;
}

/**
 * Did the trip fix the slab?
 *
 * A trip is only judged once the slab has been through the line again and
 * graded. Until then the verdict is genuinely unknown, and saying so is more
 * honest than showing a blank that reads like a failure.
 */
export type TripVerdict = 'FIXED' | 'FAILED_AGAIN' | 'PENDING';

export function tripVerdict(trip: TripSummary): TripVerdict {
  if (!trip.outcomeGrade) return 'PENDING';
  if (trip.outcomeGrade === 'C') return 'FAILED_AGAIN';
  return 'FIXED';
}

export const VERDICT_LABELS: Record<TripVerdict, string> = {
  FIXED: 'Fixed',
  FAILED_AGAIN: 'Failed again',
  PENDING: 'Not yet known',
};

/** Millimetres removed across every completed trip. */
export function totalMaterialRemoved(trips: readonly TripSummary[]): number {
  return trips.reduce((total, trip) => {
    const before = trip.thicknessBeforeMm === null ? null : Number(trip.thicknessBeforeMm);
    const after = trip.thicknessAfterMm === null ? null : Number(trip.thicknessAfterMm);
    if (before === null || after === null || !Number.isFinite(before) || !Number.isFinite(after)) {
      return total;
    }
    return total + Math.max(0, before - after);
  }, 0);
}

/** Average turnaround across the trips that have come back. */
export function averageTurnaround(trips: readonly TripSummary[]): number | null {
  const known = trips
    .map((trip) => trip.turnaroundDays)
    .filter((days): days is number => days !== null);

  if (known.length === 0) return null;
  return Math.round(known.reduce((sum, days) => sum + days, 0) / known.length);
}
