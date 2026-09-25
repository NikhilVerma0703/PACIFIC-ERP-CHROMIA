import test from "node:test";
import assert from "node:assert/strict";

import { productionSpanMinutes, avgSlabsPerHour, type SpanSlab } from "../src/lib/robo/productionSpan.ts";
import { hourlyProduction } from "../src/lib/robo/hourlyProduction.ts";
import { d1432 } from "./fixtures/roboD1432.ts";

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
  //
  // BOTH SLABS ARE DATED THE 24th, and that is the fix rather than the test
  // being wrong before. The fixture used to date the second slab the 25th
  // while its comment described one overnight run; the old placement rule
  // re-derived the day from the sequence and so hid the contradiction. Reading
  // the stored date exposes it: a slab dated the 25th with In 23:50 really is
  // the following night, and 26 hours would be the honest answer for THAT
  // data. One overnight run is two slabs on the SAME date, the second crossing
  // midnight — which is exactly what the operator records.
  const slabs = [slab(DAY, "23:00", "23:40"), slab(DAY, "23:50", "01:00")];
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

/* One placement rule, shared with the hourly chart (hourlyProduction.placeSlabs):
   each slab on its own stored date, a slab's Out before its In on the next day —
   except a slab EXACTLY one day off from the slabs made around it, which is
   placed where they show it was made (2026-09-25; see the D-1432 tests below). */

test("a last slab whose Out clock precedes its In clock ends the span the NEXT day", () => {
  // 20:00 → 00:10 next morning = 250 minutes, not 120 (Out stamped on the same
  // day as In fell before the earlier slabs' Outs and was ignored).
  const slabs = [
    slab("2026-09-01", "20:00", "21:00"),
    slab("2026-09-01", "21:00", "22:00"),
    slab("2026-09-01", "23:30", "00:10"),
  ];
  assert.equal(productionSpanMinutes(slabs), 250);
  assert.equal(avgSlabsPerHour(3, 250), 0.7);
});

test("a lone slab crossing midnight by itself has a span, not '—'", () => {
  assert.equal(productionSpanMinutes([slab("2026-09-01", "23:30", "00:10")]), 40);
});

test("BATCH 1432 — two slabs stored on 01 Sep in a 31 Aug run: the KPI reads the real run again", () => {
  // THIS TEST HAS ASSERTED BOTH ANSWERS, and this is the third version.
  //   · Until 2026-09-16 the placement walked serialNumber order and ignored a
  //     forward date "where the clock barely moved": 11h 30m.
  //   · From 2026-09-16 each slab sat on its stored date, full stop, and the
  //     test asserted 35h 30m — "a wrong stored date is corrected on the slab
  //     (Slab Records → Edit)". The owner saw exactly that on the real D-1432:
  //     Total Production Time 34 hours 40 minutes, Avg Slabs/hour 3.6, for a run
  //     that never left 31 Aug.
  //   · Since 2026-09-25 a slab stored exactly one day away from the slabs made
  //     around it is placed where they show it was made — bounded to one day,
  //     judged in production order, never by a walking day cursor (the thing
  //     that drifted 1440 and 1445), and only with a clear majority of
  //     neighbours. Slabs 7 and 8 here are that slab.
  //
  // WHAT HAS NOT CHANGED, AND IS STILL GUARDED: the KPI and the chart are one
  // placement, so whatever they say, they say the same thing.
  const rows = [
    { serialNumber: 1, productionDate: "2026-08-31", inTime: "11:20", outTime: "12:00" },
    { serialNumber: 2, productionDate: "2026-08-31", inTime: "20:00", outTime: "21:30" },
    { serialNumber: 3, productionDate: "2026-08-31", inTime: "21:35", outTime: "22:05" },
    { serialNumber: 4, productionDate: "2026-08-31", inTime: "22:05", outTime: "22:20" },
    { serialNumber: 5, productionDate: "2026-08-31", inTime: "22:20", outTime: "22:30" },
    { serialNumber: 6, productionDate: "2026-08-31", inTime: "22:30", outTime: "22:40" },
    { serialNumber: 7, productionDate: "2026-09-01", inTime: "22:40", outTime: "22:45" },
    { serialNumber: 8, productionDate: "2026-09-01", inTime: "22:45", outTime: "22:50" },
  ];
  const span = productionSpanMinutes(rows);
  assert.equal(span, 11 * 60 + 30); // 31 Aug 11:20 → 31 Aug 22:50 = 690
  const chart = hourlyProduction(rows);
  // THE AGREEMENT, asserted rather than assumed: the chart starts in the hour
  // of the first In, ends in the hour of the last Out, and the KPI's span is
  // exactly the distance between those two hours' worth of minutes.
  assert.equal(chart[0].hour, 11);
  assert.equal(chart[0].date, "2026-08-31");
  assert.equal(chart[chart.length - 1].hour, 22);
  assert.equal(chart[chart.length - 1].date, "2026-08-31");
  assert.ok(chart.every((b) => b.date === "2026-08-31"), "no second, 24-hour-late timeline");
  assert.equal(Math.floor((span as number) / 60), chart.length - 1);

  // Correcting the two records (Slab Records → Edit) changes nothing on the
  // screen — the reports already draw them where they were made.
  const corrected = rows.map((r) => ({ ...r, productionDate: "2026-08-31" }));
  assert.equal(productionSpanMinutes(corrected), span);
  assert.deepEqual(hourlyProduction(corrected), chart);
});

test("BATCH D-1432 — Total Production Time 11 hours 11 minutes, Avg Slabs/hour 11.3 (was 34h 40m, 3.6)", () => {
  // The owner's batch, rebuilt from the Reports screen (tests/fixtures/roboD1432.ts):
  // 126 slabs, first In 31 Aug 11:20, last Out 31 Aug 22:31, two of the last
  // hour's slabs a day off — as a production date, or as an Out typed before its In.
  for (const slip of ["date", "out"] as const) {
    const rows = d1432(slip);
    assert.equal(rows.length, 126);
    // As stored, each slab alone: exactly the screen the owner reported.
    const asStored = productionSpanMinutes(rows.map((r, i) => ({ ...r, runKey: String(i) })));
    assert.equal(asStored, 34 * 60 + 40, `${slip}: 34 hours 40 minutes as stored`);
    assert.equal(avgSlabsPerHour(126, asStored), 3.6);
    // Placed where they were made: 11:20 → 22:31.
    const span = productionSpanMinutes(rows);
    assert.equal(span, 11 * 60 + 11, `${slip}: 11 hours 11 minutes`);
    assert.equal(avgSlabsPerHour(126, span), 11.3, "126 ÷ 11.18 h");
  }
});

test("a filter over several batches: each batch's slip is judged within its own batch (runKey)", () => {
  // The Reports KPI without a batch filter passes each slab's batch as its run.
  // D-1432's two late Outs are still put back — and a three-slab trial batch
  // run the next evening at the same clock times is left on its own date.
  const a = d1432("out").map((r) => ({ ...r, runKey: "D1432" }));
  const b = ["21:40", "21:46", "21:52"].map((t, k) => ({
    runKey: "D1433", slabNumber: String(157804 + k), productionDate: "2026-09-01",
    inTime: t, outTime: `22:${String(20 + k).padStart(2, "0")}`,
  }));
  // 31 Aug 11:20 → 01 Sep 22:22: D-1432 corrected, D-1433 exactly as stored.
  assert.equal(productionSpanMinutes([...a, ...b]), 24 * 60 + (22 * 60 + 22) - (11 * 60 + 20));
  // The same filter as ONE run would read the trial as three slabs a day late
  // and drag them back too: that is why a run is a batch.
  const asOne = [...a, ...b].map(({ runKey: _, ...r }) => r);
  assert.equal(productionSpanMinutes(asOne), 11 * 60 + 11);
});

test("register order, not array order, decides which slab is the run's last", () => {
  const shuffled = [
    { serialNumber: 3, productionDate: "2026-09-01", inTime: "23:30", outTime: "00:10" },
    { serialNumber: 1, productionDate: "2026-09-01", inTime: "20:00", outTime: "21:00" },
    { serialNumber: 2, productionDate: "2026-09-01", inTime: "21:00", outTime: "22:00" },
  ];
  assert.equal(productionSpanMinutes(shuffled), 250);
});

test("a filter over two batches places each batch as its own run (runKey)", () => {
  // Batch A ran the 24th 10:00–20:00, batch B the 25th evening 21:00–23:00.
  // Walked as one sequence B's 21:00 would sit at/after A's run and its date be
  // ignored (a 13h span); as two runs B anchors on its own date → 37h.
  const slabs = [
    { runKey: "A", serialNumber: 1, productionDate: DAY, inTime: "10:00", outTime: "15:00" },
    { runKey: "A", serialNumber: 2, productionDate: DAY, inTime: "15:00", outTime: "20:00" },
    { runKey: "B", serialNumber: 1, productionDate: NEXT, inTime: "21:00", outTime: "22:00" },
    { runKey: "B", serialNumber: 2, productionDate: NEXT, inTime: "22:00", outTime: "23:00" },
  ];
  assert.equal(productionSpanMinutes(slabs), 37 * 60);
});

test("the KPI and the chart are one rule, not two that happen to agree", () => {
  // The property that survived the 2026-09-16 reversal, and the reason the
  // placement lives in ONE exported function. Before it, both read the same
  // module by convention; a headline number that disagrees with the graph
  // beneath it is worse than either being wrong alone.
  const cases: SpanSlab[][] = [
    [slab(DAY, "11:20", "12:00"), slab(DAY, "20:00", "22:50")],
    [slab(DAY, "23:00", "23:40"), slab(DAY, "23:50", "01:00")],          // overnight
    [slab(DAY, "10:00", "11:00"), slab(NEXT, "08:00", "16:00")],          // two days
    [slab(DAY, "09:00", null), slab(DAY, "09:30", "18:30")],              // one still open
  ];
  for (const rows of cases) {
    const span = productionSpanMinutes(rows);
    const chart = hourlyProduction(rows);
    if (span === null) continue;
    // The same two instants, floored to their hours: the chart's width in whole
    // hours is the KPI's span to within one bucket.
    const chartMinutes = (chart.length - 1) * 60;
    assert.ok(chartMinutes <= span + 59, `chart ${chartMinutes} vs KPI ${span}`);
    assert.ok(chartMinutes >= span - 59, `chart ${chartMinutes} vs KPI ${span}`);
  }
});

test("the ONE place they differ is the chart's length cap, and it is a display bound", () => {
  // A slab dated more than a week forward gives a true span of days. The KPI
  // reports it — it is what the records say. The CHART refuses to draw weeks of
  // empty hours and stops at eight days (MAX_HOURS; four until 2026-09-25, when
  // it cut off D-1449, a real six-day run), anchored on the batch start so the
  // real beginning is always visible. That is a bound on the drawing, not a
  // second opinion about the data, and it is the only divergence between the two.
  const rows = [slab(DAY, "11:20", "12:00"), slab("2026-09-01", "22:45", "22:50")];
  const span = productionSpanMinutes(rows);
  const chart = hourlyProduction(rows);
  assert.ok((span as number) > 8 * 24 * 60, "the KPI reports the true distance");
  assert.equal(chart.length, 8 * 24, "the chart stops at eight days");
  assert.equal(chart[0].hour, 11, "and still starts at the batch's real first In");
  assert.equal(chart[0].date, DAY);
});
