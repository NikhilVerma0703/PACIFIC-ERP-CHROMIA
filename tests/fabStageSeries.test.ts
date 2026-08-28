import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStageSeries, resolveRange, enumerateDays, addDays, daysBetween, isDayKey, dayKeyOf,
  DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS, STAGE_KEYS, STAGE_FIELD,
} from "../src/lib/fab/stageSeries.ts";

// The CEO dashboard's date-wise, stage-wise breakdown. Two things here are
// worth more than the rest:
//
//   1. A day on which nothing happened must still print a row of zeros. The
//      old single-day strip renders a zero tile at opacity-30, which is what
//      made the owner say it "is not showing the done things stage wise" — an
//      empty day looked like an absent one. A trend that drops its empty days
//      does the same thing, but worse, because the days left behind close
//      ranks and read as consecutive.
//
//   2. Cutting is the sum of TWO sources — fab_piece_operation rows and the
//      allocated_quantity of COMPLETED fab_slab_job rows (the CLO round-trip).
//      Miss the second and every CLO slab ever cut vanishes from the column.

/* -- Day keys and the arithmetic on them ----------------------------------- */

test("a day key is a real calendar day, not just four-two-two digits", () => {
  assert.ok(isDayKey("2026-08-18"));
  assert.ok(isDayKey("2024-02-29"), "2024 is a leap year");
  assert.ok(!isDayKey("2026-02-30"), "Date.UTC would roll this into March");
  assert.ok(!isDayKey("2025-02-29"), "2025 is not a leap year");
  assert.ok(!isDayKey("2026-13-01"));
  assert.ok(!isDayKey("18-08-2026"));
  assert.ok(!isDayKey(""));
  assert.ok(!isDayKey(null));
  assert.ok(!isDayKey(20260818));
});

test("adding days crosses months, years and a leap day without drifting", () => {
  assert.equal(addDays("2026-08-18", 1), "2026-08-19");
  assert.equal(addDays("2026-08-18", -1), "2026-08-17");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addDays("2026-08-18", 0), "2026-08-18");
});

test("daysBetween counts inclusively, so one day is 1 and not 0", () => {
  assert.equal(daysBetween("2026-08-18", "2026-08-18"), 1);
  assert.equal(daysBetween("2026-08-18", "2026-08-19"), 2);
  assert.equal(daysBetween("2026-08-05", "2026-08-18"), 14);
});

test("dayKeyOf reads the LOCAL calendar day, matching the route's ?date= filter", () => {
  // The ceo route has always built its day window with setHours(0,0,0,0),
  // i.e. local midnight. If this used toISOString() instead, the key and the
  // window would disagree by a day for half of every day in any zone east or
  // west of UTC, and the new panel would contradict the strip beside it.
  const d = new Date(2026, 7, 18, 23, 30, 0); // 18 Aug, local, half past eleven
  assert.equal(dayKeyOf(d), "2026-08-18");
  const early = new Date(2026, 0, 1, 0, 0, 0);
  assert.equal(dayKeyOf(early), "2026-01-01");
});

/* -- Enumerating the range ------------------------------------------------- */

test("every day in the range is listed, oldest first, both ends included", () => {
  const days = enumerateDays("2026-08-16", "2026-08-19");
  assert.deepEqual(days, ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"]);
});

test("a single-day range is one day, not zero and not two", () => {
  assert.deepEqual(enumerateDays("2026-08-18", "2026-08-18"), ["2026-08-18"]);
});

test("a reversed range is read the way it was obviously meant", () => {
  assert.deepEqual(enumerateDays("2026-08-19", "2026-08-16"),
    ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"]);
});

test("an absurd range is clamped to the cap, keeping the recent end", () => {
  const days = enumerateDays("1970-01-01", "2026-08-18");
  assert.equal(days.length, MAX_RANGE_DAYS);
  assert.equal(days[days.length - 1], "2026-08-18");
  assert.equal(days[0], addDays("2026-08-18", -(MAX_RANGE_DAYS - 1)));
});

/* -- What the query string resolves to ------------------------------------- */

test("no range at all gives the default window ending on the selected date", () => {
  const r = resolveRange({ anchor: "2026-08-18" });
  assert.equal(r.to, "2026-08-18", "the range ends on the day the rest of the page shows");
  assert.equal(daysBetween(r.from, r.to), DEFAULT_RANGE_DAYS);
  assert.equal(r.from, "2026-08-05");
});

test("an explicit from/to is honoured verbatim", () => {
  const r = resolveRange({ from: "2026-08-01", to: "2026-08-07", anchor: "2026-08-18" });
  assert.deepEqual(r, { from: "2026-08-01", to: "2026-08-07" });
});

test("half a range still produces a whole one", () => {
  // to only: walk back the default span from it.
  assert.deepEqual(resolveRange({ to: "2026-08-10", anchor: "2026-08-18", defaultDays: 3 }),
    { from: "2026-08-08", to: "2026-08-10" });
  // from only: run up to the day being looked at.
  assert.deepEqual(resolveRange({ from: "2026-08-16", anchor: "2026-08-18" }),
    { from: "2026-08-16", to: "2026-08-18" });
});

test("junk in the query string falls back instead of throwing or emptying", () => {
  // This feeds a dashboard panel; the alternative to a sane default is a 500
  // on a page whose other twelve blocks were fine.
  const r = resolveRange({ from: "yesterday", to: "2026-02-30", anchor: "2026-08-18" });
  assert.equal(r.to, "2026-08-18");
  assert.equal(daysBetween(r.from, r.to), DEFAULT_RANGE_DAYS);
  const noAnchor = resolveRange({ anchor: "not-a-date" });
  assert.ok(isDayKey(noAnchor.from) && isDayKey(noAnchor.to));
  assert.equal(daysBetween(noAnchor.from, noAnchor.to), DEFAULT_RANGE_DAYS);
});

test("a hand-typed decade is clamped, and the clamp keeps the recent end", () => {
  const r = resolveRange({ from: "2016-01-01", to: "2026-08-18", anchor: "2026-08-18" });
  assert.equal(daysBetween(r.from, r.to), MAX_RANGE_DAYS);
  assert.equal(r.to, "2026-08-18");
});

/* -- The bucketing --------------------------------------------------------- */

test("a day with no activity is a row of zeros, not a missing row", () => {
  // THE POINT OF THE WHOLE MODULE. Nothing happened on the 17th.
  const s = buildStageSeries({
    from: "2026-08-16", to: "2026-08-18",
    ops: [
      { day: "2026-08-16", stage: "POLISHING", count: 4 },
      { day: "2026-08-18", stage: "PACKAGING", count: 2 },
    ],
  });
  assert.equal(s.rows.length, 3, "three days asked for, three rows back");
  assert.deepEqual(s.rows.map(r => r.date), ["2026-08-16", "2026-08-17", "2026-08-18"]);

  const quiet = s.rows[1];
  assert.deepEqual(quiet, {
    date: "2026-08-17",
    cutting: 0, polishing: 0, sinkCutting: 0, fabrication: 0, packaging: 0, operations: 0,
  });
});

test("a range in which nothing at all happened is still a full block of zeros", () => {
  const s = buildStageSeries({ from: "2026-08-16", to: "2026-08-20", ops: [], cuts: [] });
  assert.equal(s.rows.length, 5);
  assert.ok(s.rows.every(r => r.operations === 0));
  assert.equal(s.totals.operations, 0);
  assert.deepEqual(s.rows.map(r => r.date),
    ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"]);
});

test("each stage lands in its own column", () => {
  const s = buildStageSeries({
    from: "2026-08-18", to: "2026-08-18",
    ops: STAGE_KEYS.map((stage, i) => ({ day: "2026-08-18", stage, count: i + 1 })),
  });
  const row = s.rows[0];
  assert.equal(row.cutting, 1);
  assert.equal(row.polishing, 2);
  assert.equal(row.sinkCutting, 3);
  assert.equal(row.fabrication, 4);
  assert.equal(row.packaging, 5);
  assert.equal(row.operations, 15);
  // and the mapping the page reads by is the one used here
  assert.equal(STAGE_FIELD.SINK_CUTTING, "sinkCutting");
});

test("an operation_type the dashboard does not print is ignored, not crashed on", () => {
  const s = buildStageSeries({
    from: "2026-08-18", to: "2026-08-18",
    ops: [
      { day: "2026-08-18", stage: "CUTTING", count: 3 },
      { day: "2026-08-18", stage: "SOMETHING_NEW", count: 99 },
    ],
  });
  assert.equal(s.rows[0].cutting, 3);
  assert.equal(s.rows[0].operations, 3, "the unknown stage must not inflate the total either");
});

/* -- Cutting's two sources ------------------------------------------------- */

test("cutting on a day is piece operations PLUS the CLO slab-job quantities", () => {
  // route.ts: dailyCutLegacy + dailyCutClo. Both halves, same day, one number.
  const s = buildStageSeries({
    from: "2026-08-18", to: "2026-08-18",
    ops:  [{ day: "2026-08-18", stage: "CUTTING", count: 6 }],
    cuts: [{ day: "2026-08-18", pieces: 11 }],
  });
  assert.equal(s.rows[0].cutting, 17);
  assert.equal(s.rows[0].operations, 17);
  assert.equal(s.totals.cutting, 17);
});

test("a day with only CLO cutting still reports cutting", () => {
  // The regression that would hide every slab cut through the CLO round-trip.
  const s = buildStageSeries({
    from: "2026-08-17", to: "2026-08-18",
    ops:  [{ day: "2026-08-17", stage: "CUTTING", count: 4 }],
    cuts: [{ day: "2026-08-18", pieces: 9 }],
  });
  assert.equal(s.rows[0].cutting, 4);
  assert.equal(s.rows[1].cutting, 9);
  assert.equal(s.totals.cutting, 13);
});

test("CLO quantities add to cutting only, never to another stage", () => {
  const s = buildStageSeries({
    from: "2026-08-18", to: "2026-08-18",
    ops:  [{ day: "2026-08-18", stage: "POLISHING", count: 5 }],
    cuts: [{ day: "2026-08-18", pieces: 7 }],
  });
  assert.equal(s.rows[0].cutting, 7);
  assert.equal(s.rows[0].polishing, 5);
  assert.equal(s.rows[0].sinkCutting, 0);
  assert.equal(s.rows[0].operations, 12);
});

/* -- Totals ---------------------------------------------------------------- */

test("the totals row is exactly the sum of the rows printed above it", () => {
  const s = buildStageSeries({
    from: "2026-08-14", to: "2026-08-18",
    ops: [
      { day: "2026-08-14", stage: "CUTTING", count: 3 },
      { day: "2026-08-14", stage: "POLISHING", count: 2 },
      { day: "2026-08-16", stage: "SINK_CUTTING", count: 5 },
      { day: "2026-08-18", stage: "FABRICATION", count: 1 },
      { day: "2026-08-18", stage: "PACKAGING", count: 8 },
    ],
    cuts: [
      { day: "2026-08-14", pieces: 10 },
      { day: "2026-08-18", pieces: 4 },
    ],
  });

  const sum = (pick: (r: (typeof s.rows)[number]) => number) => s.rows.reduce((a, r) => a + pick(r), 0);
  assert.equal(s.totals.cutting, sum(r => r.cutting));
  assert.equal(s.totals.polishing, sum(r => r.polishing));
  assert.equal(s.totals.sinkCutting, sum(r => r.sinkCutting));
  assert.equal(s.totals.fabrication, sum(r => r.fabrication));
  assert.equal(s.totals.packaging, sum(r => r.packaging));
  assert.equal(s.totals.operations, sum(r => r.operations));

  // and the arithmetic itself, spelled out once so a wrong sum is not merely
  // consistently wrong on both sides of the assertion above
  assert.equal(s.totals.cutting, 3 + 10 + 4);
  assert.equal(s.totals.operations, 3 + 2 + 5 + 1 + 8 + 10 + 4);
});

test("the grand total is the sum of the five stage totals", () => {
  const s = buildStageSeries({
    from: "2026-08-10", to: "2026-08-12",
    ops: [
      { day: "2026-08-10", stage: "CUTTING", count: 2 },
      { day: "2026-08-11", stage: "POLISHING", count: 3 },
      { day: "2026-08-12", stage: "PACKAGING", count: 4 },
    ],
    cuts: [{ day: "2026-08-11", pieces: 6 }],
  });
  const t = s.totals;
  assert.equal(t.operations, t.cutting + t.polishing + t.sinkCutting + t.fabrication + t.packaging);
  assert.equal(t.operations, 15);
});

/* -- Boundaries ------------------------------------------------------------ */

test("the first and last day of the range carry their own counts", () => {
  const s = buildStageSeries({
    from: "2026-08-16", to: "2026-08-18",
    ops: [
      { day: "2026-08-16", stage: "CUTTING", count: 1 },
      { day: "2026-08-18", stage: "CUTTING", count: 2 },
    ],
    cuts: [
      { day: "2026-08-16", pieces: 10 },
      { day: "2026-08-18", pieces: 20 },
    ],
  });
  assert.equal(s.rows[0].date, "2026-08-16");
  assert.equal(s.rows[0].cutting, 11);
  assert.equal(s.rows[2].date, "2026-08-18");
  assert.equal(s.rows[2].cutting, 22);
  assert.equal(s.from, "2026-08-16");
  assert.equal(s.to, "2026-08-18");
  assert.equal(s.days, 3);
});

test("a day just outside either end is dropped, not folded into the edge row", () => {
  // Folding would make the first and last rows lie, and the totals row would
  // then be the sum of things the table never showed.
  const s = buildStageSeries({
    from: "2026-08-16", to: "2026-08-18",
    ops: [
      { day: "2026-08-15", stage: "CUTTING", count: 100 },
      { day: "2026-08-19", stage: "CUTTING", count: 200 },
      { day: "2026-08-17", stage: "CUTTING", count: 7 },
    ],
    cuts: [
      { day: "2026-08-15", pieces: 300 },
      { day: "2026-08-19", pieces: 400 },
    ],
  });
  assert.equal(s.totals.cutting, 7, "only the day inside the range counts");
  assert.equal(s.rows[0].cutting, 0);
  assert.equal(s.rows[2].cutting, 0);
  assert.equal(s.totals.operations, s.rows.reduce((a, r) => a + r.operations, 0));
});

test("several buckets on the same day and stage add up rather than overwrite", () => {
  const s = buildStageSeries({
    from: "2026-08-18", to: "2026-08-18",
    ops: [
      { day: "2026-08-18", stage: "POLISHING", count: 2 },
      { day: "2026-08-18", stage: "POLISHING", count: 3 },
    ],
    cuts: [
      { day: "2026-08-18", pieces: 1 },
      { day: "2026-08-18", pieces: 4 },
    ],
  });
  assert.equal(s.rows[0].polishing, 5);
  assert.equal(s.rows[0].cutting, 5);
});

/* -- What the database can hand back --------------------------------------- */

test("a bigint count and a null sum survive the trip from Postgres", () => {
  // COUNT(*) and SUM() come back as bigint unless cast, and a LEFT JOIN with no
  // matching allocation gives null. Neither may reach a screen as NaN.
  const s = buildStageSeries({
    from: "2026-08-18", to: "2026-08-18",
    ops:  [{ day: "2026-08-18", stage: "CUTTING", count: 5n as unknown as number }],
    cuts: [{ day: "2026-08-18", pieces: null as unknown as number }],
  });
  assert.equal(s.rows[0].cutting, 5);
  assert.equal(s.rows[0].operations, 5);
  assert.ok(Number.isFinite(s.totals.operations));
});

test("no buckets at all, from a failed or empty query, is an empty-but-shaped series", () => {
  const s = buildStageSeries({ from: "2026-08-17", to: "2026-08-18" });
  assert.equal(s.rows.length, 2);
  assert.equal(s.totals.operations, 0);
  // `operations`, not `total` — the field counts STAGE COMPLETIONS, and the
  // old name let the screen print it under "Total" where it read as pieces.
  assert.deepEqual(Object.keys(s.totals).sort(),
    ["cutting", "fabrication", "operations", "packaging", "polishing", "sinkCutting"]);
});

test("the series covers the default window end to end when driven by resolveRange", () => {
  // The two halves used together, the way the route uses them.
  const range = resolveRange({ anchor: "2026-08-18" });
  const s = buildStageSeries({ ...range, ops: [{ day: "2026-08-05", stage: "CUTTING", count: 1 }] });
  assert.equal(s.days, DEFAULT_RANGE_DAYS);
  assert.equal(s.rows[0].date, "2026-08-05");
  assert.equal(s.rows[0].cutting, 1, "the oldest day of the default window is inside it");
  assert.equal(s.rows[s.rows.length - 1].date, "2026-08-18");
});

test("OPERATIONS IS NOT A PIECE COUNT — the same piece is counted at every stage", () => {
  // The dashboard on 25 Aug: 238 cut, 3 polished, 3 sink, 3 fab, 3 packed. The
  // column headed "Total" showed 250 and everyone read it as 250 pieces. There
  // were 238, three of which went all the way through.
  const s = buildStageSeries({
    from: "2026-08-18", to: "2026-08-18",
    ops: [
      { day: "2026-08-18", stage: "CUTTING",      count: 238 },
      { day: "2026-08-18", stage: "POLISHING",    count: 3 },
      { day: "2026-08-18", stage: "SINK_CUTTING", count: 3 },
      { day: "2026-08-18", stage: "FABRICATION",  count: 3 },
      { day: "2026-08-18", stage: "PACKAGING",    count: 3 },
    ],
  });
  assert.equal(s.totals.operations, 250);
  // The piece count is the CUT column — a piece is cut exactly once.
  assert.equal(s.totals.cutting, 238);
  assert.ok(s.totals.operations > s.totals.cutting,
    "operations exceeds pieces whenever anything moved past cutting");
  // And the three that finished are counted five times between them.
  const beyondCut = s.totals.operations - s.totals.cutting;
  assert.equal(beyondCut, 12, "3 pieces x 4 later stages");
});
