// What the SCOREBOARD banner reports, pinned.
//
// These are the money assertions. src/lib/shiftScore.ts computes
// uptime = 1 - (breakdown + power-out) / (hoursLogged x 60) and ranks the
// ELECTRICAL and MECHANICAL incharges on it for their share of the monthly
// incentive pool. The Maintenance Manager may now move minutes out of those two
// buckets — an edit to an input to their own payout — so the admin's banner on
// /scoreboard has to state the direction and the size of the move correctly.
// A sign error here would tell the person signing the cheque that a correction
// which RAISED the maintenance share had lowered it.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scoredMinutesRemoved,
  SCORED_DELAY_KEYS,
  describeReclass,
  DELAY_KEYS,
  type ReclassRecord,
} from "../src/lib/delayReclass.ts";

test("the scored buckets are exactly the two shiftScore reads into uptime", () => {
  // If a fifth bucket is ever added, or one of these renamed, this fails here
  // rather than silently omitting minutes from the banner the admin pays on.
  assert.deepEqual([...SCORED_DELAY_KEYS], ["breakdown", "powerout"]);
  for (const k of SCORED_DELAY_KEYS) assert.ok(DELAY_KEYS.includes(k));
});

test("cleaning wrongly booked as breakdown, then corrected, RAISES the maintenance share", () => {
  // The owner's own example: production charged maintenance for cleaning time.
  // Moving it back takes 20 minutes of stoppage out of the uptime numerator.
  const log: ReclassRecord[] = [{ fromType: "breakdown", toType: "cleaning", minutes: 20 }];
  const r = scoredMinutesRemoved(log);
  assert.equal(r.breakdown, 20, "positive = downtime shrank = uptime and payout up");
  assert.equal(r.powerout, 0);
});

test("the reverse correction reports as negative, not as an absolute size", () => {
  // Maintenance can also move minutes INTO breakdown (honestly — a stoppage
  // production filed as cleaning really was a broken belt). The banner must say
  // the score went DOWN, so the figure is signed rather than a magnitude.
  const log: ReclassRecord[] = [{ fromType: "cleaning", toType: "breakdown", minutes: 15 }];
  assert.equal(scoredMinutesRemoved(log).breakdown, -15);
});

test("moves between the two unscored buckets report zero impact", () => {
  // Process <-> cleaning is a real correction and still gets the violet mark on
  // /mis, but no uptime figure on the scoreboard moves. Claiming an impact would
  // send an admin hunting for a change to a number that did not change.
  const log: ReclassRecord[] = [{ fromType: "process", toType: "cleaning", minutes: 30 }];
  const r = scoredMinutesRemoved(log);
  assert.equal(r.breakdown, 0);
  assert.equal(r.powerout, 0);
});

test("power-out is tracked separately from breakdown, because only electrical is scored on it", () => {
  // scoreRange rolls electrical with withPowerout = true and mechanical without,
  // so the two cannot be summed into one number without misreporting one role.
  const log: ReclassRecord[] = [{ fromType: "powerout", toType: "process", minutes: 12 }];
  const r = scoredMinutesRemoved(log);
  assert.equal(r.powerout, 12);
  assert.equal(r.breakdown, 0);
});

test("many corrections across many hours accumulate, and an undo nets to zero", () => {
  // The banner sums a whole scoring window, not one hour. A pair of corrections
  // that cancel must report no impact — the append-only log keeps both rows, and
  // reporting "2 corrections, 0 minutes" is the truthful pair of figures.
  const log: ReclassRecord[] = [
    { fromType: "breakdown", toType: "cleaning", minutes: 20 },
    { fromType: "cleaning", toType: "breakdown", minutes: 20 },
    { fromType: "breakdown", toType: "process", minutes: 45 },
    { fromType: "powerout", toType: "cleaning", minutes: 5 },
  ];
  assert.equal(describeReclass(log).count, 4);
  const r = scoredMinutesRemoved(log);
  assert.equal(r.breakdown, 45);
  assert.equal(r.powerout, 5);
});

test("a corrupt minutes value cannot poison the figure the admin is shown", () => {
  // The row still counts as a correction (the admin must know the hour was
  // touched) but contributes nothing to a number, rather than turning the whole
  // banner into NaN and hiding the three real moves beside it.
  const log: ReclassRecord[] = [
    { fromType: "breakdown", toType: "cleaning", minutes: Number.NaN },
    { fromType: "breakdown", toType: "cleaning", minutes: 10 },
  ];
  assert.equal(describeReclass(log).count, 2);
  assert.equal(scoredMinutesRemoved(log).breakdown, 10);
});

test("the banner's figure is the exact negation of the marks' net — one traversal, no drift", () => {
  // The violet marks on /mis and the amber banner on /scoreboard describe the
  // same moves. They are derived from one function so they cannot disagree; this
  // pins that relationship rather than the arithmetic twice.
  const log: ReclassRecord[] = [
    { fromType: "breakdown", toType: "cleaning", minutes: 7 },
    { fromType: "process", toType: "powerout", minutes: 3 },
  ];
  const net = describeReclass(log).netByType;
  const r = scoredMinutesRemoved(log);
  assert.equal(r.breakdown, -net.breakdown);
  assert.equal(r.powerout, -net.powerout);
  // and never the negative zero that negation produces on an untouched bucket
  assert.ok(Object.is(scoredMinutesRemoved([]).breakdown, 0));
  assert.ok(Object.is(scoredMinutesRemoved([]).powerout, 0));
});
