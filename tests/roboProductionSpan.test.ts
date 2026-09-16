import test from "node:test";
import assert from "node:assert/strict";

import { productionSpanMinutes, avgSlabsPerHour, type SpanSlab } from "../src/lib/robo/productionSpan.ts";
import { hourlyProduction } from "../src/lib/robo/hourlyProduction.ts";

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

/* One placement rule, shared with the hourly chart (slabPlacement.ts): a slab's
   Out before its In is the next day, and a forward stored date is only trusted
   when the clock went backwards against the run. */

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

test("BATCH 1432 — a wrong stored date is corrected on the slab, and the KPI and chart agree either way", () => {
  // THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-16, and the reversal is
  // deliberate. Slabs 7 and 8 of batch 1432 carry 01 Sep when the run was all
  // on 31 Aug. The old rule detected that ("the clock barely moved, so ignore
  // the forward date") and read 11h 30m.
  //
  // Reading the stored date means the KPI now reads 35h 30m for this data —
  // because that IS what the records say. The rule is stated in
  // hourlyProduction: a genuinely wrong stored date is corrected on the slab
  // (Slab Records → Edit), not reconstructed away in the reports. The old
  // detection was bought at a price that turned out to be far higher: the same
  // sequence walk drifted batch 1440 (8–10 Sep) onto 23–25 Sep and 1445
  // (15–16 Sep) onto 18–20 Sep, because serialNumber is mistyped and restarted
  // on real runs.
  //
  // WHAT STILL MATTERS, AND IS WHAT THIS TEST NOW GUARDS: whatever the data
  // says, the KPI and the chart beneath it must say the SAME thing. They now
  // share one function (placeByStoredDate), so they cannot drift apart again.
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
  // 31 Aug 11:20 → 01 Sep 22:50, because that is what the rows say.
  assert.equal(span, 35 * 60 + 30); // 2130
  const chart = hourlyProduction(rows);
  // THE AGREEMENT, asserted rather than assumed: the chart starts in the hour
  // of the first In, ends in the hour of the last Out, and the KPI's span is
  // exactly the distance between those two hours' worth of minutes.
  assert.equal(chart[0].hour, 11);
  assert.equal(chart[0].date, "2026-08-31");
  assert.equal(chart[chart.length - 1].hour, 22);
  assert.equal(chart[chart.length - 1].date, "2026-09-01");

  // And once the two slabs are corrected on the slab record — which is where
  // the rule says a wrong date is fixed — both read the real run.
  const corrected = rows.map((r) => ({ ...r, productionDate: "2026-08-31" }));
  assert.equal(productionSpanMinutes(corrected), 11 * 60 + 30); // 690
  const fixedChart = hourlyProduction(corrected);
  assert.equal(fixedChart[fixedChart.length - 1].date, "2026-08-31");
  assert.equal(Math.floor((span as number) / 60), chart.length - 1);
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
  // A slab dated a week forward gives a true span of days. The KPI reports it —
  // it is what the records say. The CHART refuses to draw weeks of empty hours
  // and stops at four days (MAX_HOURS), anchored on the batch start so the real
  // beginning is always visible. That is a bound on the drawing, not a second
  // opinion about the data, and it is the only divergence between the two.
  const rows = [slab(DAY, "11:20", "12:00"), slab("2026-09-01", "22:45", "22:50")];
  const span = productionSpanMinutes(rows);
  const chart = hourlyProduction(rows);
  assert.ok((span as number) > 4 * 24 * 60, "the KPI reports the true distance");
  assert.equal(chart.length, 4 * 24, "the chart stops at four days");
  assert.equal(chart[0].hour, 11, "and still starts at the batch's real first In");
  assert.equal(chart[0].date, DAY);
});
