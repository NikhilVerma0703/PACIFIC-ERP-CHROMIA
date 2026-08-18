import { MAX_RECALIBRATION_ATTEMPTS, RECALIBRATION_OVERDUE_DAYS } from '@/lib/chromia/constants/process-stages';

/**
 * The recalibration journey, as the plant actually runs it.
 *
 * QC marking a slab Grade C does **not** send it anywhere. The slab is put
 * down inside the plant and stays there — two days, a week, a month — until
 * the in-charge decides to gather a load and send it out. That waiting period
 * is a real state with real ageing, and it is the one the old screen had no
 * concept of, which is why the attempt counter used to jump the moment QC
 * saved.
 *
 * So the count of attempts is the count of times a slab has physically left,
 * never the number of times it has been condemned. Everything in this file is
 * pure, because these are the rules worth being certain about.
 */

export const MAX_ATTEMPTS = MAX_RECALIBRATION_ATTEMPTS;

/** One physical trip out of the plant, or one still being waited on. */
export interface Trip {
  attemptNumber: number;
  sentDate: Date | null;
  receivedDate: Date | null;
  restartedAt: Date | null;
}

export type RecalStage =
  /** Condemned by QC, sitting in the plant, not yet sent. */
  | 'AWAITING_SEND'
  /** Physically away at the recalibration department. */
  | 'OUT'
  /** Back in the plant, production not restarted yet. */
  | 'RETURNED'
  /** Running the line again, waiting for QC. */
  | 'IN_PRODUCTION'
  /** QC passed it — the recalibration journey is over. */
  | 'CLEARED'
  /** Five attempts used and condemned again. */
  | 'WRITTEN_OFF';

export interface SlabRecalState {
  /** `currentDisposition` on the slab. */
  disposition: string | null;
  /** True once the slab has been written off. */
  writtenOff: boolean;
  trips: readonly Trip[];
}

const PASSED_OUTCOMES = ['DISPATCH', 'STOCK', 'SAMPLE_CUTTING'];

/** Newest trip first — the one every decision is made against. */
function latestTrip(trips: readonly Trip[]): Trip | undefined {
  return [...trips].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
}

/**
 * Attempts used.
 *
 * A trip counts only once the slab has left, which is the rule the whole
 * screen turns on: a slab condemned four times but sent twice has used two of
 * its five attempts.
 */
export function attemptsUsed(trips: readonly Trip[]): number {
  return trips.filter((trip) => trip.sentDate !== null).length;
}

export function openTrip(trips: readonly Trip[]): Trip | undefined {
  return trips.find((trip) => trip.sentDate !== null && trip.receivedDate === null);
}

export function pendingTrip(trips: readonly Trip[]): Trip | undefined {
  return trips.find((trip) => trip.sentDate === null);
}

export function stageOf({ disposition, writtenOff, trips }: SlabRecalState): RecalStage {
  if (writtenOff) return 'WRITTEN_OFF';
  if (openTrip(trips)) return 'OUT';

  const last = latestTrip(trips);
  if (last?.receivedDate && !last.restartedAt) return 'RETURNED';

  if (disposition === 'RECALIBRATION') return 'AWAITING_SEND';
  if (disposition && PASSED_OUTCOMES.includes(disposition)) return 'CLEARED';

  return 'IN_PRODUCTION';
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/**
 * The Status column.
 *
 * "Need 2nd Time Recalibration" on a slab whose Attempt still reads 1 is the
 * sentence the in-charge is looking for: it has been out once, it has failed
 * again, and it is waiting for the next load to go.
 */
export function statusLabel(state: SlabRecalState, grade?: string | null): string {
  const stage = stageOf(state);
  const used = attemptsUsed(state.trips);

  switch (stage) {
    case 'WRITTEN_OFF':
      return 'Written Off / Waste';
    case 'OUT':
      return `Out for ${ordinal(openTrip(state.trips)?.attemptNumber ?? used)} Time Recalibration`;
    case 'RETURNED':
      return `Returned — Restart Production`;
    case 'IN_PRODUCTION':
      return `In Processing — After Attempt ${used}`;
    case 'CLEARED':
      return `Cleared${grade ? ` — Grade ${grade}` : ''}`;
    case 'AWAITING_SEND':
    default:
      return `Need ${ordinal(used + 1)} Time Recalibration`;
  }
}

/** No sixth trip: the fifth failure ends the slab. */
export function canSend(state: SlabRecalState): boolean {
  return stageOf(state) === 'AWAITING_SEND' && attemptsUsed(state.trips) < MAX_ATTEMPTS;
}

/** A slab condemned again with every attempt spent is finished. */
export function isWriteOff(trips: readonly Trip[]): boolean {
  return attemptsUsed(trips) >= MAX_ATTEMPTS;
}

/**
 * Which screen the slab number opens.
 *
 * One link, four destinations, decided by where the slab actually is — the
 * in-charge taps the same number every time and always gets the next thing
 * that needs doing.
 */
export type RecalAction = 'TRIP' | 'RESTART' | 'QC' | 'NONE';

export function actionFor(state: SlabRecalState): RecalAction {
  switch (stageOf(state)) {
    case 'AWAITING_SEND':
      return attemptsUsed(state.trips) < MAX_ATTEMPTS ? 'TRIP' : 'NONE';
    case 'OUT':
      return 'TRIP';
    case 'RETURNED':
      return 'RESTART';
    case 'IN_PRODUCTION':
      return 'QC';
    default:
      return 'NONE';
  }
}

const MS_PER_DAY = 86_400_000;

function wholeDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

/**
 * Days out.
 *
 * The clock starts the day QC condemned the slab, not the day it was sent —
 * time spent lying in the plant is exactly the delay this module exists to
 * make visible. Once it is away, the count is time at the facility; once it is
 * back, the trip's own turnaround.
 */
export function daysOut(
  state: SlabRecalState,
  condemnedAt: Date | null,
  now: Date,
): { days: number; overdue: boolean } {
  const stage = stageOf(state);
  const last = latestTrip(state.trips);

  let days = 0;

  if (stage === 'AWAITING_SEND' || stage === 'WRITTEN_OFF') {
    days = condemnedAt ? wholeDays(condemnedAt, now) : 0;
  } else if (stage === 'OUT') {
    const sent = openTrip(state.trips)?.sentDate;
    days = sent ? wholeDays(sent, now) : 0;
  } else if (last?.sentDate && last.receivedDate) {
    days = wholeDays(last.sentDate, last.receivedDate);
  }

  return { days, overdue: days > RECALIBRATION_OVERDUE_DAYS };
}

export function formatDaysOut({ days, overdue }: { days: number; overdue: boolean }): string {
  return `${days} day${days === 1 ? '' : 's'}${overdue ? ' · overdue' : ''}`;
}
