import test from "node:test";
import assert from "node:assert/strict";

import {
  designMatchKey,
  mergedDelayMinutes,
  avgSlabsPerHourNet,
  type DelaySpanInput,
} from "../src/lib/robo/referenceSheet.ts";

/* ── designMatchKey — match on design, not thickness ─────────────────────── */

test("thickness is stripped so 2 cm and 3 cm of one design match", () => {
  assert.equal(designMatchKey("Costa 2 cm"), "costa");
  assert.equal(designMatchKey("Costa 3 cm"), "costa");
  assert.equal(designMatchKey("Costa 2 cm"), designMatchKey("Costa 3 cm"));
  // spacing and case do not matter, mm as well as cm, a stray trailing dot
  assert.equal(designMatchKey("costa 3cm"), "costa");
  assert.equal(designMatchKey("COSTA 18mm."), "costa");
});

test("designs that differ by name, not thickness, stay different", () => {
  assert.notEqual(designMatchKey("Bellagio Green"), designMatchKey("Bellagio Grey"));
  assert.equal(designMatchKey("Bellagio Green"), "bellagio green");
  assert.equal(designMatchKey("Bellagio Grey"), "bellagio grey");
});

test("a trailing number that is not a thickness is kept", () => {
  // no cm/mm unit → not a thickness, must not be dropped
  assert.equal(designMatchKey("Statuario 5"), "statuario 5");
  assert.notEqual(designMatchKey("Statuario 5"), designMatchKey("Statuario 7"));
});

test("null/blank design keys to empty string (no run can match it)", () => {
  assert.equal(designMatchKey(null), "");
  assert.equal(designMatchKey("   "), "");
});

/* ── mergedDelayMinutes — actual downtime, overlaps counted once ─────────── */

test("non-overlapping delays add up", () => {
  const spans: DelaySpanInput[] = [
    { startAbs: 600, minutes: 30 }, // 10:00–10:30
    { startAbs: 720, minutes: 15 }, // 12:00–12:15
  ];
  assert.equal(mergedDelayMinutes(spans), 45);
});

test("overlapping delays are unioned, not double-counted", () => {
  // 10:00–10:30 and 10:15–10:45 → real downtime 10:00–10:45 = 45, not 60
  const spans: DelaySpanInput[] = [
    { startAbs: 600, minutes: 30 },
    { startAbs: 615, minutes: 30 },
  ];
  assert.equal(mergedDelayMinutes(spans), 45);
});

test("a delay fully inside another counts once", () => {
  const spans: DelaySpanInput[] = [
    { startAbs: 600, minutes: 60 }, // 10:00–11:00
    { startAbs: 615, minutes: 10 }, // 10:15–10:25, inside
  ];
  assert.equal(mergedDelayMinutes(spans), 60);
});

test("touching intervals merge with no gap", () => {
  const spans: DelaySpanInput[] = [
    { startAbs: 600, minutes: 30 }, // 10:00–10:30
    { startAbs: 630, minutes: 30 }, // 10:30–11:00
  ];
  assert.equal(mergedDelayMinutes(spans), 60);
});

test("a delay with no start time still contributes its duration", () => {
  const spans: DelaySpanInput[] = [
    { startAbs: 600, minutes: 30 },
    { startAbs: null, minutes: 20 }, // unplaceable → added
  ];
  assert.equal(mergedDelayMinutes(spans), 50);
});

test("zero and negative durations are ignored", () => {
  const spans: DelaySpanInput[] = [
    { startAbs: 600, minutes: 0 },
    { startAbs: 700, minutes: -5 },
    { startAbs: 800, minutes: 10 },
  ];
  assert.equal(mergedDelayMinutes(spans), 10);
});

test("empty input is zero downtime", () => {
  assert.equal(mergedDelayMinutes([]), 0);
});

/* ── avgSlabsPerHourNet — delays subtracted, guarded ─────────────────────── */

test("delays are subtracted from the duration before dividing", () => {
  // 46 slabs, 460 min span, 60 min actual delay → 46 ÷ (400/60) = 6.9
  assert.equal(avgSlabsPerHourNet(46, 460, 60), 6.9);
});

test("no delay reduces to plain slabs ÷ hours", () => {
  // 46 ÷ (460/60) = 6.0, matching the batch-duration rate when nothing is lost
  assert.equal(avgSlabsPerHourNet(46, 460, 0), 6.0);
});

test("null span (nothing completed) → null, shown as a dash", () => {
  assert.equal(avgSlabsPerHourNet(46, null, 0), null);
});

test("delays meeting or exceeding the span → null, never a divide by zero", () => {
  assert.equal(avgSlabsPerHourNet(46, 460, 460), null);
  assert.equal(avgSlabsPerHourNet(46, 460, 500), null);
});

test("a negative delay figure cannot inflate the rate", () => {
  // floored at 0 → same as no delay
  assert.equal(avgSlabsPerHourNet(46, 460, -100), 6.0);
});
