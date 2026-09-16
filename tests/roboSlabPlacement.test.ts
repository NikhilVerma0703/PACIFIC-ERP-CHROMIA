// The three date/clock primitives the Robo reports share.
//
// THIS FILE USED TO TEST A PLACEMENT RULE — "the first dated slab anchors the
// day", "a forward date is trusted when the clock went backwards", and so on —
// which decided which DAY each slab sat on by walking the batch in serialNumber
// order. That rule was replaced on 2026-09-16: serialNumber proved unreliable
// on real runs, so the walk ran out of order and whole batches drifted forward
// (1440 charted as 23-25 Sep, 1445 as 18-20 Sep). Each slab is now placed on
// its own stored production date.
//
// Those tests went with the rule rather than being left behind. A passing test
// describing a rule the application no longer follows is read by the next
// person as the rule in force, and the placement that IS in force is covered by
// tests/roboHourlyProduction.test.ts and tests/roboProductionSpan.test.ts —
// including that the chart and the KPI share one function and cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayNum, toMins, dateFromDayNum } from "../src/lib/robo/slabPlacement.ts";

test("toMins — minutes since midnight, or null for anything unusable", () => {
  assert.equal(toMins("00:00"), 0);
  assert.equal(toMins("11:20"), 11 * 60 + 20);
  assert.equal(toMins("23:59"), 23 * 60 + 59);
  assert.equal(toMins(null), null);
  assert.equal(toMins(undefined), null);
  assert.equal(toMins(""), null);
  assert.equal(toMins("not a time"), null);
});

test("dayNum — whole days since the epoch, in UTC so no timezone shifts a day", () => {
  assert.equal(dayNum("1970-01-01"), 0);
  assert.equal(dayNum("1970-01-02"), 1);
  // Consecutive dates are consecutive numbers, which is the only property the
  // reports actually rely on — differences, never the absolute value.
  assert.equal((dayNum("2026-09-01") as number) - (dayNum("2026-08-31") as number), 1);
  assert.equal((dayNum("2026-03-02") as number) - (dayNum("2026-02-28") as number), 2, "2026 is not a leap year");
  assert.equal(dayNum("2026-8-31"), null, "the format is strict: yyyy-mm-dd");
  assert.equal(dayNum(""), null);
  assert.equal(dayNum(null), null);
  assert.equal(dayNum("rubbish"), null);
});

test("dateFromDayNum — the exact inverse of dayNum", () => {
  for (const d of ["2026-08-24", "2026-08-31", "2026-09-01", "2026-12-31", "1970-01-01"]) {
    assert.equal(dateFromDayNum(dayNum(d) as number), d, d);
  }
  assert.equal(dateFromDayNum(Number.NaN), null);
});
