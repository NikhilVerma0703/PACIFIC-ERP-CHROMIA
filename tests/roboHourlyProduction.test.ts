import test from "node:test";
import assert from "node:assert/strict";

import { hourlyProduction } from "../src/lib/robo/hourlyProduction.ts";

/* "Production Rate per Hour" across ONE batch's own run.

   Each slab is placed on its OWN stored production date (the date the operator
   entered — trusted, never reconstructed from a serial-number order). In = date +
   In time; Out = date + Out time, rolled to the next day only when Out precedes In
   (a slab that crossed midnight). The timeline runs from the earliest In to the
   latest Out, one bucket per hour (empty hours included), each slab counted in the
   hour of its Out Time, each bucket carrying the calendar date its hour belongs to.

   These tests pin the behaviour the Reports audit asked for: no slab is ever
   shifted to another date or hour, a run's dates are exactly the dates its slabs
   carry, and the same records always draw the same chart. */

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
  // Every hour carries the slabs' own date.
  assert.ok(s.every((b) => b.date === "2026-09-01"));
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

test("a batch past midnight follows each slab's own date, labels wrapping", () => {
  // Later slabs carry the next day's production date (the app's normal case for a
  // run past midnight) — that is what makes 00:10 the day AFTER 23:50.
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
  // The two dates land where their slabs say — 01 Sep then 02 Sep, no gap.
  assert.deepEqual(s.map((b) => b.date), ["2026-09-01", "2026-09-01", "2026-09-02", "2026-09-02"]);
});

test("a single slab whose Out Time is before its In Time crossed midnight itself", () => {
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "23:50", outTime: "00:10" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [23, 0]); // 23:50 start → 00:10 completion next day
  assert.deepEqual(s.map((b) => b.slabs), [0, 1]); // completion counts in 00:00–01:00
  // The 23:00 hour is the slab's own date; the 00:00 hour is the next day.
  assert.deepEqual(s.map((b) => b.date), ["2026-09-01", "2026-09-02"]);
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

test("order of the rows does not change the chart (each slab is self-dating)", () => {
  // The same four slabs delivered in two different orders draw the identical chart —
  // there is no serial-number walk, so array order is irrelevant.
  const rows = [
    { productionDate: "2026-08-21", inTime: "19:10", outTime: "19:55" },
    { productionDate: "2026-08-21", inTime: "23:30", outTime: "23:55" },
    { productionDate: "2026-08-22", inTime: "00:20", outTime: "00:50" },
    { productionDate: "2026-08-22", inTime: "13:40", outTime: "14:20" },
  ];
  const shuffled = [rows[2], rows[0], rows[3], rows[1]];
  assert.deepEqual(hourlyProduction(shuffled), hourlyProduction(rows));
});

test("the same records always give the same chart (deterministic, no clock)", () => {
  const rows = [
    { productionDate: "2026-08-21", inTime: "19:10", outTime: "19:55" },
    { productionDate: "2026-08-22", inTime: "13:40", outTime: "14:20" },
  ];
  assert.deepEqual(hourlyProduction(rows), hourlyProduction(rows));
});

test("a stray far-off (future) date can't drag the timeline across empty weeks", () => {
  // One row mis-dated years ahead must not stretch the chart over thousands of
  // empty hours. The timeline is anchored on the batch START (the real earliest
  // In, which a forward-mis-dated row never precedes) and its length is capped, so
  // the real batch stays visible and the stray falls outside the window.
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "11:00", outTime: "11:30" }, // the real run
    { productionDate: "2030-01-01", inTime: "10:00", outTime: "10:30" }, // stray, far ahead
  ]);
  assert.ok(s.length <= 4 * 24, `expected ≤ 96 buckets, got ${s.length}`);
  assert.equal(s[0].date, "2026-09-01"); // the window opens on the real batch
  assert.equal(s[0].hour, 11);
  assert.equal(sum(s), 1); // only the real completion is counted; the stray is out of range
});

/* ── The two cases the report specifies ─────────────────────────────────────── */

test("CASE 1 — same-day batch 1428 (In 11:20 → Out 19:35): 11:00 … 19:00 only", () => {
  const s = hourlyProduction([
    { productionDate: "2026-08-24", inTime: "11:20", outTime: "12:05" },
    { productionDate: "2026-08-24", inTime: "12:05", outTime: "15:40" },
    { productionDate: "2026-08-24", inTime: "15:40", outTime: "19:35" },
  ]);
  // Timeline is 11:00–20:00, NOT 00:00–24:00, and stops at the ending hour.
  assert.deepEqual(s.map((b) => b.hour), [11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal(s[0].hour, 11);
  assert.equal(s[s.length - 1].hour, 19);
  assert.ok(!s.some((b) => b.hour === 0 || b.hour === 23), "must not show 00:00 or 23:00 for a mid-day run");
  // Every hour carries the batch's actual production date.
  assert.ok(s.every((b) => b.date === "2026-08-24"));
  // Counted by Out Time hour.
  assert.equal(s.find((b) => b.hour === 12)!.slabs, 1);
  assert.equal(s.find((b) => b.hour === 15)!.slabs, 1);
  assert.equal(s.find((b) => b.hour === 19)!.slabs, 1);
  assert.equal(sum(s), 3);
});

// CASE 2 — a batch 21 Aug 19:10 → 22 Aug 14:20, continuous across midnight, no gap.
// Later slabs carry the 22nd, as the app dates a run past midnight.
const CASE2 = [
  { productionDate: "2026-08-21", inTime: "19:10", outTime: "19:55" }, // out 19:00–20:00, 21 Aug
  { productionDate: "2026-08-21", inTime: "23:30", outTime: "23:55" }, // out 23:00–00:00, 21 Aug
  { productionDate: "2026-08-22", inTime: "00:20", outTime: "00:50" }, // out 00:00–01:00, 22 Aug
  { productionDate: "2026-08-22", inTime: "13:40", outTime: "14:20" }, // out 14:00–15:00, 22 Aug
];

test("CASE 2 — crossing midnight flows 23:00 → 00:00 with both dates and no gap", () => {
  const s = hourlyProduction(CASE2);
  // 19,20,21,22,23 on the 21st, then straight into 0,1,…,14 on the 22nd.
  assert.deepEqual(s.map((b) => b.hour), [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  // The 23:00 bucket sits immediately before the 00:00 bucket — no artificial gap.
  const i23 = s.findIndex((b) => b.hour === 23);
  assert.equal(s[i23 + 1].hour, 0);
  // Dates: everything up to and including 23:00 is the 21st; from 00:00 it is the 22nd.
  assert.equal(s[i23].date, "2026-08-21");
  assert.equal(s[i23 + 1].date, "2026-08-22");
  assert.ok(s.slice(0, i23 + 1).every((b) => b.date === "2026-08-21"));
  assert.ok(s.slice(i23 + 1).every((b) => b.date === "2026-08-22"));
  // Completions in the right hours.
  assert.equal(s.find((b) => b.hour === 19)!.slabs, 1);
  assert.equal(s.find((b) => b.hour === 23)!.slabs, 1);
  assert.equal(s.find((b) => b.hour === 0)!.slabs, 1);
  assert.equal(s.find((b) => b.hour === 14)!.slabs, 1);
  assert.equal(sum(s), 4);
});

test("minor out-of-order logging stays on the one date its slabs carry", () => {
  // Two adjacent slabs logged a few minutes out of order, same date — nothing
  // crosses midnight, nothing lands on another day.
  const s = hourlyProduction([
    { productionDate: "2026-08-24", inTime: "10:05", outTime: "10:12" },
    { productionDate: "2026-08-24", inTime: "10:00", outTime: "10:20" },
  ]);
  assert.ok(s.every((b) => b.date === "2026-08-24"));
  assert.ok(!s.some((b) => b.hour === 0), "a 5-minute backstep is not a midnight crossing");
  assert.equal(sum(s), 2);
});

test("SINGLE DAY — a long-held slab (late Out) does NOT spill the chart into the next day", () => {
  // S2 opens at 09:00 and only closes at 22:30 (a long hold). Every slab carries
  // 31 Aug, so the whole chart stays on 31 Aug — the late Out cannot invent a day.
  const s = hourlyProduction([
    { productionDate: "2026-08-31", inTime: "08:00", outTime: "08:30" },
    { productionDate: "2026-08-31", inTime: "09:00", outTime: "22:30" }, // 13½h hold
    { productionDate: "2026-08-31", inTime: "09:30", outTime: "10:00" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  assert.ok(s.every((b) => b.date === "2026-08-31"), "must stay entirely on 31 Aug");
  assert.equal(s.find((b) => b.hour === 8)!.slabs, 1);  // S1 completes 08:30
  assert.equal(s.find((b) => b.hour === 10)!.slabs, 1); // S3 completes 10:00, same day
  assert.equal(s.find((b) => b.hour === 22)!.slabs, 1); // S2 completes 22:30
  assert.equal(sum(s), 3);
});

/* ── The batches the audit named — each shown on the dates its slabs carry ──── */

test("BATCH 1384/1385 — 7 slabs, 19 Jul 20:00–21:00, all on 19 Jul (none spill to 20 Jul)", () => {
  // The audit's headline case: seven slabs complete in the 20:00 hour on 19 July.
  // Trusting each slab's stored date, all seven land in 20:00–21:00 on 19 Jul —
  // not six with one drifting to 20 Jul.
  const slabs = ["20:05", "20:12", "20:20", "20:29", "20:37", "20:46", "20:55"].map((out, i) => ({
    productionDate: "2026-07-19",
    inTime: `20:${String(i * 8).padStart(2, "0")}`,
    outTime: out,
  }));
  const s = hourlyProduction(slabs);
  assert.ok(s.every((b) => b.date === "2026-07-19"), "every hour is 19 Jul");
  assert.ok(!s.some((b) => b.date === "2026-07-20"), "nothing spills onto 20 Jul");
  assert.equal(s.find((b) => b.hour === 20)!.slabs, 7); // all seven in the 20:00 hour
  assert.equal(sum(s), 7);
});

test("BATCH 1440 — Bellagio Gold 8–10 Sep shows 8/9/10 Sep, never 23–25 Sep", () => {
  // The batch ran 8→10 Sep; the old reconstruction drifted it to 23–25 Sep.
  // Trusting the stored dates, its three days are exactly 8, 9 and 10 Sep.
  const s = hourlyProduction([
    { productionDate: "2026-09-08", inTime: "09:00", outTime: "09:40" },
    { productionDate: "2026-09-08", inTime: "23:30", outTime: "23:55" },
    { productionDate: "2026-09-09", inTime: "00:10", outTime: "00:45" }, // across midnight
    { productionDate: "2026-09-09", inTime: "14:00", outTime: "14:30" },
    { productionDate: "2026-09-10", inTime: "10:00", outTime: "10:30" },
    { productionDate: "2026-09-10", inTime: "11:00", outTime: "11:35" },
  ]);
  const dates = [...new Set(s.map((b) => b.date))];
  assert.deepEqual(dates, ["2026-09-08", "2026-09-09", "2026-09-10"]);
  assert.ok(!s.some((b) => (b.date ?? "") >= "2026-09-23"), "no drift into 23–25 Sep");
  assert.equal(sum(s), 6);
});

test("BATCH 1445 — a running batch (last slab open) charts 15–16 Sep, never 18–20 Sep", () => {
  // In progress on 16 Sep; the last slab has no Out yet. The timeline is 15–16 Sep,
  // the dates its slabs carry — not shifted forward to 18–20 Sep.
  const s = hourlyProduction([
    { productionDate: "2026-09-15", inTime: "20:00", outTime: "20:40" },
    { productionDate: "2026-09-15", inTime: "23:20", outTime: "23:58" },
    { productionDate: "2026-09-16", inTime: "00:15", outTime: "00:55" }, // across midnight
    { productionDate: "2026-09-16", inTime: "09:00", outTime: "09:30" },
    { productionDate: "2026-09-16", inTime: "10:00", outTime: null }, // still running
  ]);
  const dates = [...new Set(s.map((b) => b.date))];
  assert.deepEqual(dates, ["2026-09-15", "2026-09-16"]);
  assert.ok(!s.some((b) => (b.date ?? "") >= "2026-09-18"), "no drift into 18–20 Sep");
  assert.equal(sum(s), 4); // four completed; the open slab adds no completion
});

test("BATCH 1386 — a real two-day run with a long hold shows exactly two dates", () => {
  // 20 Jul 12:12 → 21 Jul 17:12, crossing midnight once. A long-held slab on the
  // 21st (In 02:00 → Out 20:00) does not invent a third day — the dates are the
  // dates the slabs carry: 20 and 21 Jul only.
  const s = hourlyProduction([
    { productionDate: "2026-07-20", inTime: "12:12", outTime: "12:30" },
    { productionDate: "2026-07-20", inTime: "23:40", outTime: "23:55" },
    { productionDate: "2026-07-21", inTime: "00:10", outTime: "00:40" }, // crosses midnight
    { productionDate: "2026-07-21", inTime: "02:00", outTime: "20:00" }, // 18h hold
    { productionDate: "2026-07-21", inTime: "02:30", outTime: "03:00" },
  ]);
  const dates = [...new Set(s.map((b) => b.date))];
  assert.deepEqual(dates, ["2026-07-20", "2026-07-21"]);
  assert.ok(!s.some((b) => b.date === "2026-07-22"), "no phantom third day");
  // The boundary flows 23:00 (20 Jul) straight into 00:00 (21 Jul), no gap.
  const i23 = s.findIndex((b) => b.hour === 23 && b.date === "2026-07-20");
  assert.equal(s[i23 + 1].hour, 0);
  assert.equal(s[i23 + 1].date, "2026-07-21");
  assert.equal(sum(s), 5);
});

test("OVERNIGHT slab (issue 3) — an Out before the In is treated as the NEXT day", () => {
  // In 23:55 on 20 Jul, Out 00:09 → that 00:09 is 21 Jul 00:09, never 20 Jul.
  // The next slab entered 00:04 was re-dated to 21 Jul, and lands there too.
  const s = hourlyProduction([
    { productionDate: "2026-07-20", inTime: "23:55", outTime: "00:09" },
    { productionDate: "2026-07-21", inTime: "00:04", outTime: "00:20" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [23, 0]);
  assert.deepEqual(s.map((b) => b.date), ["2026-07-20", "2026-07-21"]);
  // Both completions (00:09 and 00:20) count in 00:00–01:00 on 21 Jul, not on 20 Jul.
  assert.equal(s.find((b) => b.hour === 23)!.slabs, 0);
  assert.equal(s.find((b) => b.hour === 0)!.slabs, 2);
});

test("a forward-mis-dated slab is shown on the date it is stored with (fix it via Edit, not here)", () => {
  // Trust-dates is faithful: a slab stored on the wrong (later) day appears on that
  // day, making the error VISIBLE for correction in Slab Records → Edit rather than
  // being silently papered over. Here one 31-Aug slab is mis-stored as 01 Sep.
  const s = hourlyProduction([
    { productionDate: "2026-08-31", inTime: "09:00", outTime: "09:40" },
    { productionDate: "2026-08-31", inTime: "10:00", outTime: "10:30" },
    { productionDate: "2026-09-01", inTime: "11:00", outTime: "11:30" }, // mis-stored day
  ]);
  // Two dates appear because the data says so — the chart reflects the records exactly.
  const dates = [...new Set(s.map((b) => b.date))];
  assert.deepEqual(dates, ["2026-08-31", "2026-09-01"]);
  assert.equal(sum(s), 3); // every slab counted once, none dropped or duplicated
});
