// The MIS entry rules that used to live in the browser only. Every assertion
// here is guarding a number that moves money: the four delay buckets feed the
// uptime in src/lib/shiftScore.ts (and through it the incentive pool and the
// OEE), and slabsPerHourStd is the denominator of the CEO report's target, the
// downtime page's day rate and the incentive multiplier.
//
// Pure rules, so `node --test` reaches them with no database — which is the
// whole point of them living in src/lib/requiredFields.ts rather than inside
// the server action or the sheet.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIS_DELAY_COLUMNS,
  MAX_DELAY_MINUTES_PER_HOUR,
  misDelayFieldError,
  misStdRequiredError,
} from "../src/lib/requiredFields.ts";

const BREAKDOWN = "breakdownDelayDurationMechanicalOrElectricalMinutes";

test("the four delay columns are the ones the Mis table actually has", () => {
  // Derived from downtimeShared's DELAY_FIELDS — this pins the derivation, so a
  // rename that silently stops matching the Prisma field names fails here rather
  // than in production, where the loop would simply check nothing.
  assert.deepEqual([...MIS_DELAY_COLUMNS], [
    "processDelayDurationMinutes",
    "cleaningDelayDurationMinutes",
    BREAKDOWN,
    "poweroutDelayDurationMinutes",
  ]);
});

test("a negative delay is refused on every bucket", () => {
  for (const col of MIS_DELAY_COLUMNS) {
    assert.match(String(misDelayFieldError(col, -1)), /cannot be negative/);
    assert.match(String(misDelayFieldError(col, "-45")), /cannot be negative/);
  }
});

test("negative minutes cannot be smuggled past a TOTAL check", () => {
  // The bug this file exists for: the only server rule was `total > 60`, and the
  // sheet's own check was the same sum. This hour totals 45 — comfortably legal —
  // while claiming 90 minutes of breakdown and MINUS 45 of process, which nets
  // out against a real 45-minute breakdown logged in another hour of the shift.
  const hour: Record<string, number> = {
    processDelayDurationMinutes: -45,
    cleaningDelayDurationMinutes: 0,
    [BREAKDOWN]: 90,
    poweroutDelayDurationMinutes: 0,
  };
  const total = MIS_DELAY_COLUMNS.reduce((a, k) => a + (hour[k] ?? 0), 0);
  assert.equal(total, 45);
  assert.equal(total > MAX_DELAY_MINUTES_PER_HOUR, false, "the old check passes this hour");
  const refusals = MIS_DELAY_COLUMNS.map((k) => misDelayFieldError(k, hour[k])).filter(Boolean);
  assert.equal(refusals.length, 2, "per-bucket bounds catch both the -45 and the 90");
});

test("a bucket may hold the whole hour but not more", () => {
  assert.equal(misDelayFieldError(BREAKDOWN, MAX_DELAY_MINUTES_PER_HOUR), null);
  assert.equal(misDelayFieldError(BREAKDOWN, 0), null);
  assert.match(String(misDelayFieldError(BREAKDOWN, 60.5)), /at most 60 minutes/);
  assert.match(String(misDelayFieldError(BREAKDOWN, 480)), /at most 60 minutes/);
});

test("an empty delay box is not a delay of zero, and is never an error", () => {
  // The columns are nullable Floats: an hour with no cleaning delay stores NULL.
  for (const v of [null, undefined, "", "   "]) assert.equal(misDelayFieldError(BREAKDOWN, v), null);
  // Junk is left to coerceField (which stores null for it) rather than refused
  // here — otherwise a stray keystroke would block a save with a message about
  // downtime that says nothing about what is actually wrong.
  assert.equal(misDelayFieldError(BREAKDOWN, "abc"), null);
});

test("Std is required once Actual claims output", () => {
  assert.match(String(misStdRequiredError(null, 20)), /Std/);
  assert.match(String(misStdRequiredError(0, 20)), /Std/);
  assert.match(String(misStdRequiredError("", "18")), /Std/);
  // BLANKING the Std of an hour that already has an Actual is the edit-path
  // shape of the same defect, and reads identically here.
  assert.match(String(misStdRequiredError("", 18)), /Std/);
});

test("Std stays optional on an hour the line did not run", () => {
  assert.equal(misStdRequiredError(null, null), null);
  assert.equal(misStdRequiredError(null, 0), null);
  assert.equal(misStdRequiredError(null, ""), null);
  assert.equal(misStdRequiredError(12, 18), null);
  assert.equal(misStdRequiredError("12", "18"), null);
});
