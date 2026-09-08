import test from "node:test";
import assert from "node:assert/strict";

import { delayTypesByCode, delayGrandTotalMins, type DelayForTypes } from "../src/lib/robo/delayTypes.ts";

/* The Delay Analysis — All Delay Types chart. The aggregation must match the raw
   Delay Log rows exactly: every code included, durations summed from the stored
   (In/Out-derived) durationMinutes, one row = one event even for a multi-Robo
   delay, longest first, and no dependence on the clock. */

const d = (code: string, minutes: number, machineName: string | null = null): DelayForTypes & { machineName: string | null } => ({
  durationMinutes: minutes,
  machineName,
  delayCode: { code, description: `${code} desc`, category: "MECHANICAL" },
});

test("groups by code, sums minutes, counts events", () => {
  const rows = [d("C1", 10), d("C1", 5), d("C2", 8)];
  const out = delayTypesByCode(rows);
  assert.deepEqual(out, [
    { code: "C1", description: "C1 desc", category: "MECHANICAL", minutes: 15, events: 2 },
    { code: "C2", description: "C2 desc", category: "MECHANICAL", minutes: 8, events: 1 },
  ]);
});

test("EVERY code is included — nothing is dropped or capped to a Top N", () => {
  const rows = ["A", "B", "C", "D", "E", "F", "G"].map((c, i) => d(c, i + 1));
  const out = delayTypesByCode(rows);
  assert.equal(out.length, 7);
  assert.deepEqual(out.map((r) => r.code), ["G", "F", "E", "D", "C", "B", "A"]); // longest first
});

test("longest total duration comes first", () => {
  const out = delayTypesByCode([d("SHORT", 3), d("LONG", 90), d("MID", 40)]);
  assert.deepEqual(out.map((r) => r.code), ["LONG", "MID", "SHORT"]);
});

test("a multi-Robo delay is ONE event, not one per Robo", () => {
  // A single delay row naming two Robos (machineName comma-joined) — it must add
  // ONE event and its minutes ONCE. The function never looks at the machine.
  const rows = [d("C1", 20, "Roycut-1, Roymix"), d("C1", 10, "Roycut-2")];
  const out = delayTypesByCode(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].events, 2);   // two delay rows, not three Robos
  assert.equal(out[0].minutes, 30);
});

test("multiple delays on one slab all count — they arrive as separate rows", () => {
  // The route fetches one row per RoboDelayLog; several against one slab are
  // several rows here, summed under their codes.
  const out = delayTypesByCode([d("C1", 5), d("C2", 7), d("C1", 6)]);
  assert.equal(out.find((r) => r.code === "C1")!.minutes, 11);
  assert.equal(out.find((r) => r.code === "C1")!.events, 2);
  assert.equal(out.find((r) => r.code === "C2")!.events, 1);
});

test("equal-minutes codes keep a stable order (deterministic, no reshuffle)", () => {
  const a = delayTypesByCode([d("X", 10), d("Y", 10), d("Z", 10)]);
  const b = delayTypesByCode([d("X", 10), d("Y", 10), d("Z", 10)]);
  assert.deepEqual(a.map((r) => r.code), b.map((r) => r.code));
  assert.deepEqual(a.map((r) => r.code), ["X", "Y", "Z"]);
});

test("the same rows always give the same result — no clock, no drift", () => {
  const rows = [d("C1", 12), d("C3", 4), d("C1", 8), d("C2", 30)];
  assert.deepEqual(delayTypesByCode(rows), delayTypesByCode(rows));
});

test("grand total is summed from the SAME rows, so parts equal the whole", () => {
  const rows = [d("C1", 12), d("C2", 30), d("C1", 8)];
  const breakdown = delayTypesByCode(rows);
  const total = delayGrandTotalMins(rows);
  assert.equal(total, 50);
  assert.equal(breakdown.reduce((s, r) => s + r.minutes, 0), total);
});

test("a broken duration costs only its own row, not the whole code", () => {
  const out = delayTypesByCode([d("C1", 10), d("C1", NaN)]);
  assert.equal(out[0].minutes, 10);   // NaN contributes 0
  assert.equal(out[0].events, 2);     // but the row is still counted
  assert.equal(delayGrandTotalMins([d("C1", 10), d("C1", NaN)]), 10);
});

test("nothing to total is an empty breakdown and a zero", () => {
  assert.deepEqual(delayTypesByCode([]), []);
  assert.equal(delayGrandTotalMins([]), 0);
});
