import test from "node:test";
import assert from "node:assert/strict";

import { productionSpanMinutes, avgSlabsPerHour, type SpanSlab } from "../src/lib/robo/productionSpan.ts";

/* Total Production Time = last Out Time − first In Time across the filtered
   slabs. Wall-clock "HH:MM" with no day of its own, so the span is date-aware:
   pair each time with the slab's production date, then measure the real distance.
   The KPI shows "—" (null) when no span can be formed, never a wall-clock guess. */

const DAY = "2026-08-24";
const NEXT = "2026-08-25";
const slab = (productionDate: string, inTime: string | null, outTime: string | null): SpanSlab =>
  ({ productionDate, inTime, outTime });

test("the batch-1428 example: In 11:30, last Out 17:52 → 382 minutes (6h 22m)", () => {
  const slabs = [
    slab(DAY, "11:30", "12:10"),
    slab(DAY, "12:10", "14:05"),
    slab(DAY, "14:05", "17:52"),
  ];
  assert.equal(productionSpanMinutes(slabs), 382);
  assert.equal(Math.floor(382 / 60), 6);
  assert.equal(382 % 60, 22);
});

test("first In and last Out may be different slabs — the run's start and finish", () => {
  // Earliest In is on slab 1 (09:00); latest Out is on slab 2 (18:30).
  const slabs = [slab(DAY, "09:00", "10:00"), slab(DAY, "17:00", "18:30")];
  assert.equal(productionSpanMinutes(slabs), 9 * 60 + 30); // 09:00 → 18:30 = 570
});

test("a batch past midnight spans the day boundary correctly", () => {
  // In 23:00 on the 24th, last slab Out 01:00 on the 25th → 2 hours, not −22h.
  const slabs = [slab(DAY, "23:00", "23:40"), slab(NEXT, "23:50", "01:00")];
  assert.equal(productionSpanMinutes(slabs), 120);
});

test("multiple dates: earliest In and latest Out are taken across all of them", () => {
  // 24th 10:00 In … 25th 16:00 Out. Span = one day + 6h = 1800 minutes.
  const slabs = [
    slab(DAY, "10:00", "11:00"),
    slab(DAY, "11:00", "20:00"),
    slab(NEXT, "08:00", "16:00"),
  ];
  assert.equal(productionSpanMinutes(slabs), 24 * 60 + 6 * 60); // 1800
});

test("nothing completed yet (no Out Time on any slab) → null, never the clock", () => {
  const slabs = [slab(DAY, "11:30", null), slab(DAY, "12:00", null)];
  assert.equal(productionSpanMinutes(slabs), null);
});

test("no slab has an In Time → null", () => {
  const slabs = [slab(DAY, null, "17:52")];
  assert.equal(productionSpanMinutes(slabs), null);
});

test("empty selection → null", () => {
  assert.equal(productionSpanMinutes([]), null);
});

test("missing / null / undefined times are skipped safely, not read as midnight", () => {
  const slabs: SpanSlab[] = [
    slab(DAY, null, null),
    slab(DAY, "  ", "  "),
    { productionDate: DAY, inTime: undefined, outTime: undefined },
    slab(DAY, "11:30", "17:52"), // the only usable pair
  ];
  assert.equal(productionSpanMinutes(slabs), 382);
});

test("a slab with no resolvable production date is skipped, not anchored at epoch", () => {
  const slabs = [slab("", "00:05", "23:55"), slab(DAY, "11:30", "17:52")];
  // The dateless slab would otherwise blow the span open; only the dated pair counts.
  assert.equal(productionSpanMinutes(slabs), 382);
});

test("an inconsistent negative span (only Out precedes only In) → null", () => {
  const slabs = [slab(DAY, "18:00", null), slab(DAY, null, "09:00")];
  assert.equal(productionSpanMinutes(slabs), null);
});

test("an exact-hours span drops the minutes cleanly (360 = 6h 0m)", () => {
  const slabs = [slab(DAY, "10:00", "16:00")];
  assert.equal(productionSpanMinutes(slabs), 360);
});

/* Avg Slabs/hour = Total Slabs ÷ elapsed batch duration (the span), delays LEFT
   IN. The operator's own definition and example. */

test("avgSlabsPerHour: the operator's example — 46 slabs over 7h 40m ≈ 6.0", () => {
  // 14:10 → 21:50 = 460 minutes = 7.6667 h; 46 ÷ 7.6667 = 6.0.
  const span = productionSpanMinutes([slab(DAY, "14:10", "21:50")]); // 460
  assert.equal(span, 460);
  assert.equal(avgSlabsPerHour(46, span), 6.0);
});

test("avgSlabsPerHour: delays are NOT subtracted — the full span is the divisor", () => {
  // Even with 3h 36m of delay inside the run, the divisor is the whole 7h 40m.
  assert.equal(avgSlabsPerHour(46, 460), 6.0);
});

test("avgSlabsPerHour: rounds to one decimal", () => {
  assert.equal(avgSlabsPerHour(301, 382), 47.3); // 301 ÷ 6.3667 = 47.28…
  assert.equal(avgSlabsPerHour(10, 60), 10);     // 10 ÷ 1h = 10
  assert.equal(avgSlabsPerHour(5, 120), 2.5);    // 5 ÷ 2h = 2.5
});

test("avgSlabsPerHour: no span (nothing completed) or a zero/negative span → null", () => {
  assert.equal(avgSlabsPerHour(46, null), null);
  assert.equal(avgSlabsPerHour(46, 0), null);
  assert.equal(avgSlabsPerHour(46, -30), null);
});

test("avgSlabsPerHour: zero slabs over a span is a clean 0, not a divide error", () => {
  assert.equal(avgSlabsPerHour(0, 460), 0);
});
