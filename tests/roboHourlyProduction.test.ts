import test from "node:test";
import assert from "node:assert/strict";

import { hourlyProduction } from "../src/lib/robo/hourlyProduction.ts";

/* Slabs completed per hour across ONE batch's own run: from the hour it started
   (first In Time) to the hour it completed (last Out Time), a bucket per hour,
   counting each slab in the hour of its Out Time, zero hours included. */

const sum = (s: { slabs: number }[]) => s.reduce((a, b) => a + b.slabs, 0);

test("the reference case: starts 11:20, completes 23:55 → 11:00–12:00 … 23:00–00:00", () => {
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "11:20", outTime: "12:10" }, // out in 12:00–13:00
    { productionDate: "2026-09-01", inTime: "12:30", outTime: "23:55" }, // out in 23:00–00:00
  ]);
  assert.equal(s.length, 13); // hours 11..23
  assert.equal(s[0].hour, 11);
  assert.match(s[0].label, /^11:00.12:00$/); // dash-agnostic
  assert.equal(s[s.length - 1].hour, 23);
  assert.match(s[s.length - 1].label, /^23:00.00:00$/);
  // Counted by Out Time hour; the start hour (11) has no completion → 0.
  assert.equal(s.find((b) => b.hour === 11)!.slabs, 0);
  assert.equal(s.find((b) => b.hour === 12)!.slabs, 1);
  assert.equal(s.find((b) => b.hour === 23)!.slabs, 1);
  assert.equal(sum(s), 2);
});

test("the batch's start hour opens the timeline even with no completion in it", () => {
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "08:23", outTime: "10:05" },
  ]);
  assert.equal(s[0].hour, 8);
  assert.match(s[0].label, /^08:00.09:00$/);
  // 08 and 09 are empty, the completion lands in 10.
  assert.deepEqual(s.map((b) => b.slabs), [0, 0, 1]);
});

test("every hour between start and end shows, even the empty ones", () => {
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "09:00", outTime: "09:30" },
    { productionDate: "2026-09-01", inTime: "09:40", outTime: "13:15" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [9, 10, 11, 12, 13]);
  assert.deepEqual(s.map((b) => b.slabs), [1, 0, 0, 0, 1]);
});

test("a batch past midnight follows its real chronology, labels wrapping", () => {
  // Later slabs carry the next day's production date (change 5) — that is how a
  // bare 00:10 is known to be AFTER 23:50 rather than before it.
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "22:05", outTime: "22:40" },
    { productionDate: "2026-09-01", inTime: "23:00", outTime: "23:50" },
    { productionDate: "2026-09-02", inTime: "00:10", outTime: "00:45" },
    { productionDate: "2026-09-02", inTime: "01:00", outTime: "01:30" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [22, 23, 0, 1]);
  assert.deepEqual(s.map((b) => b.slabs), [1, 1, 1, 1]);
  assert.match(s[1].label, /^23:00.00:00$/);
  assert.match(s[2].label, /^00:00.01:00$/);
});

test("a single slab whose Out Time is before its In Time crossed midnight itself", () => {
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "23:50", outTime: "00:10" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [23, 0]); // 23:50 start → 00:10 completion next day
  assert.deepEqual(s.map((b) => b.slabs), [0, 1]); // completion counts in 00:00–01:00
});

test("in-processing slabs (no Out Time) add no completion but can open the run", () => {
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "10:00", outTime: "10:30" },
    { productionDate: "2026-09-01", inTime: "10:40", outTime: null },
  ]);
  assert.equal(s.length, 1);
  assert.equal(s[0].hour, 10);
  assert.equal(s[0].slabs, 1); // only the completed one counts
});

test("a batch that has started but completed nothing is one empty hour, not a crash", () => {
  const s = hourlyProduction([{ productionDate: "2026-09-01", inTime: "14:15", outTime: null }]);
  assert.equal(s.length, 1);
  assert.equal(s[0].hour, 14);
  assert.equal(s[0].slabs, 0);
});

test("nothing usable is an empty series, never NaN hours", () => {
  assert.deepEqual(hourlyProduction([]), []);
  assert.deepEqual(hourlyProduction([{ productionDate: null, inTime: "10:00", outTime: "10:30" }]), []);
  assert.deepEqual(hourlyProduction([{ productionDate: "not-a-date", inTime: "10:00", outTime: "10:30" }]), []);
});

test("a stray far-off date can't ask for thousands of empty hours", () => {
  // One bad row years away must not blow the timeline up; it is capped.
  const s = hourlyProduction([
    { productionDate: "2020-01-01", inTime: "10:00", outTime: "10:30" },
    { productionDate: "2026-09-01", inTime: "11:00", outTime: "11:30" },
  ]);
  assert.ok(s.length <= 48, `expected ≤ 48 buckets, got ${s.length}`);
});
