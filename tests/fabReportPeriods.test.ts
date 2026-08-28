import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodOf, bucketByPeriod, dayKeysBetween,
  PERIOD_GRAINS, GRAIN_LABEL, type PeriodGrain,
} from "../src/lib/fab/reportPeriods.ts";

// Day, week and month buckets for the fabrication report.
//
// The module takes a LOCAL DAY KEY ("2026-08-25"), never a timestamp. A
// completion at 00:30 on the 26th in Chennai is 19:00 on the 25th UTC, so
// bucketing UTC timestamps moves the night shift's work into the previous day —
// and the 22:00–06:00 shift is exactly the one this shop runs. The day is
// decided once, server-side, before anything here sees it.

test("the three grains, named once", () => {
  assert.deepEqual(PERIOD_GRAINS, ["day", "week", "month"]);
  assert.equal(GRAIN_LABEL.day, "Day-wise");
  assert.equal(GRAIN_LABEL.week, "Week-wise");
  assert.equal(GRAIN_LABEL.month, "Month-wise");
});

test("day: the key is the day, the label is what a person reads", () => {
  const p = periodOf("2026-08-25", "day")!;
  assert.equal(p.key, "2026-08-25");
  assert.equal(p.label, "Tue 25 Aug");     // 25 Aug 2026 is a Tuesday
  assert.equal(p.startDayKey, "2026-08-25");
  assert.equal(p.endDayKey, "2026-08-25");
  assert.equal(periodOf("2026-08-18", "day")!.label, "Tue 18 Aug");
  assert.equal(periodOf("2026-01-01", "day")!.label, "Thu 1 Jan");
});

test("WEEKS RUN MONDAY TO SUNDAY, so a Saturday shift is not split off", () => {
  // A Sunday-start week puts Saturday and Sunday in different rows from the
  // Monday–Friday they belong to.
  const tue = periodOf("2026-08-25", "week")!;   // Tue
  assert.equal(tue.startDayKey, "2026-08-24");   // Monday
  assert.equal(tue.endDayKey, "2026-08-30");     // Sunday
  assert.equal(tue.label, "24–30 Aug");

  // Every day of that week lands in the SAME bucket — including the weekend.
  for (const d of ["2026-08-24","2026-08-25","2026-08-28","2026-08-29","2026-08-30"]) {
    assert.equal(periodOf(d, "week")!.key, tue.key, d);
  }
  // And the Monday after starts a new one.
  assert.notEqual(periodOf("2026-08-31", "week")!.key, tue.key);
});

test("week: a bucket spanning two months names both", () => {
  const p = periodOf("2026-09-01", "week")!;     // Tue 1 Sep
  assert.equal(p.startDayKey, "2026-08-31");
  assert.equal(p.endDayKey, "2026-09-06");
  assert.equal(p.label, "31 Aug – 6 Sep");
});

test("week: the key is the ISO week, so it sorts across a year boundary", () => {
  // 31 Dec 2026 is a Thursday — ISO week 53 of 2026.
  const dec = periodOf("2026-12-31", "week")!;
  // 1 Jan 2027 is a Friday, the SAME ISO week.
  const jan = periodOf("2027-01-01", "week")!;
  assert.equal(dec.key, jan.key, "one week, one bucket, across new year");
  assert.match(dec.key, /^\d{4}-W\d{2}$/);
  // Keys sort chronologically as plain strings.
  assert.ok(periodOf("2026-08-24", "week")!.key < periodOf("2026-08-31", "week")!.key);
});

test("month: the bucket covers the whole calendar month, leap years included", () => {
  const aug = periodOf("2026-08-25", "month")!;
  assert.equal(aug.key, "2026-08");
  assert.equal(aug.label, "August 2026");
  assert.equal(aug.startDayKey, "2026-08-01");
  assert.equal(aug.endDayKey, "2026-08-31");

  assert.equal(periodOf("2026-02-10", "month")!.endDayKey, "2026-02-28");
  assert.equal(periodOf("2028-02-10", "month")!.endDayKey, "2028-02-29", "2028 is a leap year");
  assert.equal(periodOf("2026-12-05", "month")!.endDayKey, "2026-12-31");
  assert.equal(periodOf("2026-04-05", "month")!.endDayKey, "2026-04-30");
});

test("an unreadable day is REFUSED, never bucketed into today", () => {
  for (const bad of ["", "25-08-2026", "2026/08/25", "2026-13-01", "2026-08-32", "not a date", null, undefined]) {
    for (const g of PERIOD_GRAINS) {
      assert.equal(periodOf(bad as string, g), null, `${bad} @ ${g}`);
    }
  }
});

test("BUCKETING: the shop's real fortnight, at all three grains", () => {
  // The dashboard's own numbers: 46 pieces on Tue 18 Aug, 204 on Tue 25 Aug.
  const rows = [
    { dayKey: "2026-08-18", stage: "CUTTING", pieces: 34 },
    { dayKey: "2026-08-18", stage: "POLISH",  pieces: 3 },
    { dayKey: "2026-08-18", stage: "SINK",    pieces: 3 },
    { dayKey: "2026-08-18", stage: "FAB",     pieces: 3 },
    { dayKey: "2026-08-18", stage: "PACK",    pieces: 3 },
    { dayKey: "2026-08-25", stage: "CUTTING", pieces: 204 },
  ];
  const sum = (b: { rows: { pieces: number }[] }) => b.rows.reduce((n, r) => n + r.pieces, 0);

  const day = bucketByPeriod(rows, "day");
  assert.equal(day.buckets.length, 2);
  assert.equal(day.buckets[0].period.key, "2026-08-18");
  assert.equal(sum(day.buckets[0]), 46);
  assert.equal(sum(day.buckets[1]), 204);

  // Two different ISO weeks — 18 Aug is week 34, 25 Aug is week 35.
  const week = bucketByPeriod(rows, "week");
  assert.equal(week.buckets.length, 2);
  assert.equal(sum(week.buckets[0]), 46);
  assert.equal(sum(week.buckets[1]), 204);

  // One month.
  const month = bucketByPeriod(rows, "month");
  assert.equal(month.buckets.length, 1);
  assert.equal(month.buckets[0].period.label, "August 2026");
  assert.equal(sum(month.buckets[0]), 250, "the fortnight's total");
});

test("bucketing: oldest first, and a dropped row is COUNTED not hidden", () => {
  const rows = [
    { dayKey: "2026-08-25", pieces: 1 },
    { dayKey: "2026-08-18", pieces: 1 },
    { dayKey: "garbage",    pieces: 99 },
    { dayKey: "2026-08-20", pieces: 1 },
  ];
  const { buckets, dropped } = bucketByPeriod(rows, "day");
  assert.deepEqual(buckets.map(b => b.period.key), ["2026-08-18", "2026-08-20", "2026-08-25"]);
  assert.equal(dropped, 1, "the caller can say so rather than losing 99 pieces silently");
  assert.equal(buckets.reduce((n, b) => n + b.rows.length, 0), 3);
  assert.deepEqual(bucketByPeriod([], "day"), { buckets: [], dropped: 0 });
});

test("EMPTY DAYS ARE PRODUCED, because a day that cut nothing still has to show", () => {
  const days = dayKeysBetween("2026-08-12", "2026-08-25");
  assert.equal(days.length, 14, "the dashboard's Last 14 days");
  assert.equal(days[0], "2026-08-12");
  assert.equal(days[13], "2026-08-25");
  // Across a month end.
  assert.deepEqual(dayKeysBetween("2026-08-30", "2026-09-02"),
    ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  // And a leap day is not skipped.
  assert.ok(dayKeysBetween("2028-02-27", "2028-03-01").includes("2028-02-29"));
  // Backwards, junk and runaway ranges all answer with something safe.
  assert.deepEqual(dayKeysBetween("2026-08-25", "2026-08-12"), []);
  assert.deepEqual(dayKeysBetween("nope", "2026-08-12"), []);
  assert.equal(dayKeysBetween("2020-01-01", "2030-01-01").length, 400, "capped");
});

test("every day of a long range lands in exactly one bucket, at every grain", () => {
  // The property that matters for a report footer: the buckets partition the
  // range. Nothing double-counted, nothing missing.
  const days = dayKeysBetween("2026-01-01", "2026-12-31");
  assert.equal(days.length, 365);
  for (const grain of PERIOD_GRAINS) {
    const rows = days.map(d => ({ dayKey: d, pieces: 1 }));
    const { buckets, dropped } = bucketByPeriod(rows, grain as PeriodGrain);
    assert.equal(dropped, 0, grain);
    assert.equal(buckets.reduce((n, b) => n + b.rows.length, 0), 365, grain);
    const keys = buckets.map(b => b.period.key);
    assert.equal(new Set(keys).size, keys.length, `${grain}: a bucket appeared twice`);
  }
  assert.equal(bucketByPeriod(days.map(d => ({ dayKey: d })), "month").buckets.length, 12);
});
