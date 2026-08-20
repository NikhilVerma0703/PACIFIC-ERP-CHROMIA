import test from "node:test";
import assert from "node:assert/strict";

import { delayGrandTotal, delayTotalsByDate, type DelayForTotals } from "../src/lib/robo/delayTotals.ts";

/* The Delay List download gave one pair of numbers for the whole file. Right
   for one day, useless for "All" — one figure across thirty days says nothing
   about which day went wrong. */

const d = (date: string, durationMinutes: number): DelayForTotals => ({ date, durationMinutes });

test("each production date gets its own events and minutes", () => {
  const days = delayTotalsByDate([
    d("2026-08-13", 30), d("2026-08-13", 12),
    d("2026-08-14", 45),
    d("2026-08-13", 8),
  ]);
  assert.deepEqual(days, [
    { date: "2026-08-13", events: 3, minutes: 50 },
    { date: "2026-08-14", events: 1, minutes: 45 },
  ]);
});

test("dates come out oldest first", () => {
  // yyyy-mm-dd sorts as text exactly as it sorts as a date, which is the
  // reason the module stores dates that way.
  const days = delayTotalsByDate([d("2026-09-01", 1), d("2026-08-31", 1), d("2026-12-25", 1), d("2026-01-05", 1)]);
  assert.deepEqual(days.map((x) => x.date), ["2026-01-05", "2026-08-31", "2026-09-01", "2026-12-25"]);
});

test("a delay with no date is shown, not dropped", () => {
  // Dropping it would leave the breakdown short of the overall total, and the
  // first thing anyone does with two totals is check they agree.
  const days = delayTotalsByDate([d("", 20), d("2026-08-13", 10), d("  ", 5)]);
  assert.deepEqual(days[0], { date: "", events: 2, minutes: 25 });
  assert.equal(delayGrandTotal(days).minutes, 35);
});

test("the overall totals are computed from the same rows as the breakdown", () => {
  const rows = [d("2026-08-13", 30), d("2026-08-13", 12), d("2026-08-14", 45), d("2026-08-15", 3)];
  const days = delayTotalsByDate(rows);
  const total = delayGrandTotal(days);
  assert.equal(total.events, rows.length);
  assert.equal(total.minutes, rows.reduce((s, r) => s + r.durationMinutes, 0));
  assert.equal(total.minutes, 90);
});

test("nothing to total is an empty breakdown and two zeros", () => {
  assert.deepEqual(delayTotalsByDate([]), []);
  assert.deepEqual(delayGrandTotal([]), { events: 0, minutes: 0 });
});

test("a broken duration costs its own row, not the whole day", () => {
  const days = delayTotalsByDate([
    d("2026-08-13", 30),
    { date: "2026-08-13", durationMinutes: Number.NaN },
    d("2026-08-13", 10),
  ]);
  assert.deepEqual(days, [{ date: "2026-08-13", events: 3, minutes: 40 }]);
  assert.equal(Number.isFinite(delayGrandTotal(days).minutes), true);
});

test("the counted rows are not mutated", () => {
  // The route reuses the same array for the row list it writes to the sheet.
  const rows = [d("2026-08-13", 30), d("2026-08-13", 12)];
  const before = JSON.parse(JSON.stringify(rows));
  delayTotalsByDate(rows);
  assert.deepEqual(rows, before);
});
