import { describe, expect, it } from 'vitest';

import {
  actionFor,
  attemptsUsed,
  canSend,
  daysOut,
  formatDaysOut,
  isWriteOff,
  MAX_ATTEMPTS,
  ordinal,
  stageOf,
  statusLabel,
  type SlabRecalState,
  type Trip,
} from '@/lib/chromia/recalibration-flow';

const day = (d: number) => new Date(2026, 7, d);

/** A trip that went out and came back, then the slab ran the line again. */
const completed = (attemptNumber: number): Trip => ({
  attemptNumber,
  sentDate: day(1),
  receivedDate: day(5),
  restartedAt: day(6),
});

const condemned = (trips: Trip[] = []): SlabRecalState => ({
  disposition: 'RECALIBRATION',
  writtenOff: false,
  trips,
});

describe('attempts count trips, not condemnations', () => {
  it('stays at zero while the slab waits in the plant', () => {
    // The whole point: QC has failed it, but it has not gone anywhere yet.
    const waiting = condemned([{ attemptNumber: 1, sentDate: null, receivedDate: null, restartedAt: null }]);
    expect(attemptsUsed(waiting.trips)).toBe(0);
    expect(stageOf(waiting)).toBe('AWAITING_SEND');
  });

  it('rises to one the moment the slab is sent', () => {
    const sent: Trip = { attemptNumber: 1, sentDate: day(3), receivedDate: null, restartedAt: null };
    expect(attemptsUsed([sent])).toBe(1);
  });

  it('does not rise again when QC condemns the same slab a second time', () => {
    const state = condemned([
      completed(1),
      { attemptNumber: 2, sentDate: null, receivedDate: null, restartedAt: null },
    ]);
    expect(attemptsUsed(state.trips)).toBe(1);
    expect(statusLabel(state)).toBe('Need 2nd Time Recalibration');
  });
});

describe('the status wording the in-charge reads', () => {
  it('walks 1st to 5th as trips are completed', () => {
    const wording = [0, 1, 2, 3, 4].map((done) => {
      const trips = Array.from({ length: done }, (_, i) => completed(i + 1));
      return statusLabel(condemned([...trips]));
    });

    expect(wording).toEqual([
      'Need 1st Time Recalibration',
      'Need 2nd Time Recalibration',
      'Need 3rd Time Recalibration',
      'Need 4th Time Recalibration',
      'Need 5th Time Recalibration',
    ]);
  });

  it('names the trip while the slab is away', () => {
    const state = condemned([
      completed(1),
      { attemptNumber: 2, sentDate: day(8), receivedDate: null, restartedAt: null },
    ]);
    expect(stageOf(state)).toBe('OUT');
    expect(statusLabel(state)).toBe('Out for 2nd Time Recalibration');
  });

  it('asks for a restart once the slab is back', () => {
    const state: SlabRecalState = {
      disposition: 'RECALIBRATION',
      writtenOff: false,
      trips: [{ attemptNumber: 1, sentDate: day(1), receivedDate: day(4), restartedAt: null }],
    };
    expect(stageOf(state)).toBe('RETURNED');
    expect(statusLabel(state)).toBe('Returned — Restart Production');
  });

  it('shows the slab back on the line, waiting for QC', () => {
    const state: SlabRecalState = { disposition: null, writtenOff: false, trips: [completed(1)] };
    expect(stageOf(state)).toBe('IN_PRODUCTION');
    expect(statusLabel(state)).toBe('In Processing — After Attempt 1');
  });

  it('ends the journey when QC finally passes the slab', () => {
    const state: SlabRecalState = {
      disposition: 'DISPATCH',
      writtenOff: false,
      trips: [completed(1)],
    };
    expect(stageOf(state)).toBe('CLEARED');
    expect(statusLabel(state, 'A')).toBe('Cleared — Grade A');
  });

  it('writes the slab off after the fifth trip fails', () => {
    const trips = Array.from({ length: MAX_ATTEMPTS }, (_, i) => completed(i + 1));
    expect(isWriteOff(trips)).toBe(true);

    const state: SlabRecalState = { disposition: 'RECALIBRATION', writtenOff: true, trips };
    expect(stageOf(state)).toBe('WRITTEN_OFF');
    expect(statusLabel(state)).toBe('Written Off / Waste');
  });

  it('numbers the ordinals the way the plant says them', () => {
    expect([1, 2, 3, 4, 5].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
  });
});

describe('the five-attempt ceiling', () => {
  it('allows a send while attempts remain', () => {
    expect(canSend(condemned([completed(1), completed(2)]))).toBe(true);
  });

  it('refuses a sixth trip', () => {
    const trips = Array.from({ length: MAX_ATTEMPTS }, (_, i) => completed(i + 1));
    expect(canSend(condemned(trips))).toBe(false);
    expect(actionFor(condemned(trips))).toBe('NONE');
  });

  it('is five, as the process document says', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

describe('which screen the slab number opens', () => {
  it('opens the trip page while waiting, and again while away', () => {
    expect(actionFor(condemned())).toBe('TRIP');
    expect(
      actionFor(
        condemned([{ attemptNumber: 1, sentDate: day(2), receivedDate: null, restartedAt: null }]),
      ),
    ).toBe('TRIP');
  });

  it('opens the restart page once the slab is back', () => {
    expect(
      actionFor({
        disposition: 'RECALIBRATION',
        writtenOff: false,
        trips: [{ attemptNumber: 1, sentDate: day(1), receivedDate: day(3), restartedAt: null }],
      }),
    ).toBe('RESTART');
  });

  it('opens QC once the slab has run the line again', () => {
    expect(actionFor({ disposition: null, writtenOff: false, trips: [completed(1)] })).toBe('QC');
  });

  it('opens nothing for a cleared or written-off slab', () => {
    expect(actionFor({ disposition: 'STOCK', writtenOff: false, trips: [completed(1)] })).toBe(
      'NONE',
    );
    expect(actionFor({ disposition: 'RECALIBRATION', writtenOff: true, trips: [] })).toBe('NONE');
  });
});

describe('days out', () => {
  it('counts from the day QC condemned the slab while it waits', () => {
    // Time lying in the plant is the delay this page exists to show.
    const result = daysOut(condemned(), day(1), day(9));
    expect(result.days).toBe(8);
    expect(result.overdue).toBe(false); // still inside the 10-day window
    expect(daysOut(condemned(), day(1), day(20)).overdue).toBe(true);
  });

  it('reads zero on the day it was condemned', () => {
    expect(formatDaysOut(daysOut(condemned(), day(9), day(9)))).toBe('0 days');
  });

  it('counts time at the facility once the slab is away', () => {
    const state = condemned([
      { attemptNumber: 1, sentDate: day(4), receivedDate: null, restartedAt: null },
    ]);
    expect(daysOut(state, day(1), day(10)).days).toBe(6);
  });

  it('freezes at the trip’s own turnaround once the slab is back', () => {
    const state: SlabRecalState = {
      disposition: null,
      writtenOff: false,
      trips: [{ attemptNumber: 1, sentDate: day(1), receivedDate: day(5), restartedAt: day(6) }],
    };
    expect(daysOut(state, day(1), day(30)).days).toBe(4);
  });

  it('says "1 day" rather than "1 days"', () => {
    expect(formatDaysOut({ days: 1, overdue: false })).toBe('1 day');
    expect(formatDaysOut({ days: 9, overdue: true })).toBe('9 days · overdue');
  });
});
