import {
  attemptsUsed,
  MAX_ATTEMPTS,
  ordinal,
  stageOf,
  type SlabRecalState,
  type Trip,
} from '@/lib/chromia/recalibration-flow';

/**
 * The tracking figures.
 *
 * All of them are read off the slab's own state — where it is now, and how many
 * trips it has actually made — rather than stored anywhere. A counter that is
 * written down drifts; one that is derived cannot.
 *
 * "1st Time Recalibration Completed" counts slabs that have finished a first
 * trip, so a slab on its third counts in the first, second and third. Read down
 * the row and it is a funnel: how many slabs the plant saved on the first go,
 * and how many kept coming back.
 */

export interface TrackedSlab extends SlabRecalState {
  trips: readonly Trip[];
}

export interface TrackingKpis {
  total: number;
  waiting: number;
  out: number;
  completed: { attempt: number; label: string; count: number }[];
  writtenOff: number;
  cleared: number;
}

function completedTrips(trips: readonly Trip[]): number {
  return trips.filter((trip) => trip.sentDate !== null && trip.receivedDate !== null).length;
}

export function buildTrackingKpis(slabs: readonly TrackedSlab[]): TrackingKpis {
  const completed = Array.from({ length: MAX_ATTEMPTS }, (_, index) => ({
    attempt: index + 1,
    label: `${ordinal(index + 1)} Time Recalibration Completed`,
    count: 0,
  }));

  let waiting = 0;
  let out = 0;
  let writtenOff = 0;
  let cleared = 0;

  for (const slab of slabs) {
    const stage = stageOf(slab);

    if (stage === 'AWAITING_SEND') waiting += 1;
    if (stage === 'OUT') out += 1;
    if (stage === 'WRITTEN_OFF') writtenOff += 1;
    if (stage === 'CLEARED') cleared += 1;

    const done = completedTrips(slab.trips);
    for (let attempt = 1; attempt <= Math.min(done, MAX_ATTEMPTS); attempt += 1) {
      const bucket = completed[attempt - 1];
      if (bucket) bucket.count += 1;
    }
  }

  return { total: slabs.length, waiting, out, completed, writtenOff, cleared };
}

/** Attempts used, exposed here so the page and the filter agree on one rule. */
export function attemptOf(slab: TrackedSlab): number {
  return attemptsUsed(slab.trips);
}
