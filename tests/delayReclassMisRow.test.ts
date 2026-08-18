// The three objects that carry a reclassification across to the Mis row:
// reading the hour off the row, the update written back, and the optimistic-lock
// guard that decides whether the write is allowed to land at all.
//
// These look like plumbing and are not. The `data` and `where` a server action
// hands Prisma are loosely typed once their keys are dynamic, so a wrong column
// name here compiles, passes review and writes a delay figure into the wrong
// field — and the fields in question feed the uptime in src/lib/shiftScore.ts,
// which ranks the electrical and mechanical incharges for their share of the
// monthly incentive pool. The null-versus-zero case below is the subtle one: get
// it wrong and every move INTO an empty bucket is refused as a phantom conflict.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bucketsFromMisRow,
  misDelayUpdate,
  misDelayUnchanged,
  planReclass,
  DELAY_KEYS,
  DELAY_COL,
} from "../src/lib/delayReclass.ts";

/** A Mis row as Prisma hands it back: NULL where the hour logged no delay of
 *  that kind, which is the normal case for three of the four buckets. */
const ROW = {
  processDelayDurationMinutes: null,
  cleaningDelayDurationMinutes: null,
  breakdownDelayDurationMechanicalOrElectricalMinutes: 20,
  poweroutDelayDurationMinutes: 5,
};

// ---------------------------------------------------------------------------
// reading the row
// ---------------------------------------------------------------------------

test("a Mis row reads into the bucket vocabulary, NULL and all", () => {
  const b = bucketsFromMisRow(ROW);
  assert.equal(b.breakdown, 20);
  assert.equal(b.powerout, 5);
  // NULL is preserved rather than coerced here — planReclass owns the decision
  // that absent means zero, and it refuses figures that are present but nonsense.
  assert.equal(b.cleaning, null);
  assert.equal(b.process, null);
});

test("a row missing the delay columns entirely reads as an hour with no delay", () => {
  // A caller that forgot a column in its `select` must not silently look like an
  // hour of zeros that then accepts a move out of nothing — planReclass refuses
  // it, which is the behaviour this pins.
  const b = bucketsFromMisRow({});
  assert.deepEqual(Object.keys(b).sort(), [...DELAY_KEYS].sort());
  const plan = planReclass({ current: b, from: "cleaning", to: "breakdown", minutes: 10 });
  assert.equal(plan.ok, false);
});

test("the row is read through DELAY_COL, so the column names exist in one place", () => {
  // Renaming a Mis column in downtimeShared.ts without touching this helper must
  // not leave the reader silently returning nothing for that bucket.
  for (const key of DELAY_KEYS) {
    const b = bucketsFromMisRow({ [DELAY_COL[key]]: 7 });
    assert.equal(b[key], 7, `${key} must be read from ${DELAY_COL[key]}`);
  }
});

// ---------------------------------------------------------------------------
// the update
// ---------------------------------------------------------------------------

test("the update writes all four columns, not just the two that moved", () => {
  const plan = planReclass({ current: bucketsFromMisRow(ROW), from: "breakdown", to: "cleaning", minutes: 20 });
  assert.ok(plan.ok);
  const data = misDelayUpdate(plan.next);
  assert.deepEqual(data, {
    processDelayDurationMinutes: 0,
    cleaningDelayDurationMinutes: 20,
    breakdownDelayDurationMechanicalOrElectricalMinutes: 0,
    poweroutDelayDurationMinutes: 5,
  });
  // The hour's total is what keeps the 60-min/hr cap in tables/actions.ts
  // satisfied without this path re-checking it.
  const sum = Object.values(data).reduce((a, n) => a + n, 0);
  assert.equal(sum, 25);
});

// ---------------------------------------------------------------------------
// the optimistic lock
// ---------------------------------------------------------------------------

test("the guard names every bucket, so no figure can move unobserved", () => {
  const guard = misDelayUnchanged({ process: 1, cleaning: 2, breakdown: 3, powerout: 4 });
  assert.equal(guard.length, DELAY_KEYS.length);
  assert.deepEqual(guard, [
    { processDelayDurationMinutes: 1 },
    { cleaningDelayDurationMinutes: 2 },
    { breakdownDelayDurationMechanicalOrElectricalMinutes: 3 },
    { poweroutDelayDurationMinutes: 4 },
  ]);
});

test("a zero bucket is guarded as 0 OR NULL — the case that would break every move into an empty bucket", () => {
  // An hour with no cleaning delay stores NULL, not 0. Guarding it as `{ col: 0 }`
  // matches no row, so the update writes nothing, and the action reports a
  // conflict that never happened — permanently, for exactly the corrections the
  // owner asked for (cleaning minutes wrongly filed as breakdown).
  const guard = misDelayUnchanged({ process: 0, cleaning: 0, breakdown: 20, powerout: 0 });
  assert.deepEqual(guard[1], {
    OR: [{ cleaningDelayDurationMinutes: 0 }, { cleaningDelayDurationMinutes: null }],
  });
  assert.deepEqual(guard[2], { breakdownDelayDurationMechanicalOrElectricalMinutes: 20 });
});

test("the guard is built from the BEFORE figures, so it matches the row that was read", () => {
  const before = bucketsFromMisRow(ROW);
  const plan = planReclass({ current: before, from: "breakdown", to: "cleaning", minutes: 20 });
  assert.ok(plan.ok);
  const guard = misDelayUnchanged(plan.before);
  // Every clause describes the row as it was read — the breakdown clause asks for
  // 20, not the 0 it is about to become. A guard built from `next` would match
  // only after the write it is supposed to protect.
  assert.deepEqual(guard[2], { breakdownDelayDurationMechanicalOrElectricalMinutes: 20 });
  assert.deepEqual(guard[3], { poweroutDelayDurationMinutes: 5 });
});
