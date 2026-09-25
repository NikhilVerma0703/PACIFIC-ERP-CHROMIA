import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import {
  hourlyProduction,
  placeSlabs,
  runBounds,
  runScope,
  absToDateTime,
  type HourlySlab,
} from "../src/lib/robo/hourlyProduction.ts";
import { d1432, D1432_CHARTED_31_AUG, D1432_REAL_31_AUG, D1432_SLIPPED } from "./fixtures/roboD1432.ts";

/* "Production Rate per Hour" across ONE batch's own run.

   Each slab is placed on its OWN stored production date (the date the operator
   entered — never reconstructed from a serial-number order). In = date + In time;
   Out = date + Out time, rolled to the next day only when Out precedes In (a slab
   that crossed midnight). The timeline runs from the earliest In to the latest
   Out, one bucket per hour (empty hours included), each slab counted in the hour
   of its Out Time, each bucket carrying the calendar date its hour belongs to.

   One exception, pinned in the second half of this file (2026-09-25): a slab the
   records put EXACTLY one day away from where the slabs made around it show it
   was made — a production date one day off, or an Out the midnight rule pushed a
   day on — is drawn where it was made. Nothing else ever moves: a run's dates are
   the dates its slabs carry, and the same records always draw the same chart. */

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
  // the real batch stays visible and the stray falls outside the window. The cap
  // is eight days since 2026-09-25 (four cut off D-1449, a real six-day run).
  const s = hourlyProduction([
    { productionDate: "2026-09-01", inTime: "11:00", outTime: "11:30" }, // the real run
    { productionDate: "2030-01-01", inTime: "10:00", outTime: "10:30" }, // stray, far ahead
  ]);
  assert.ok(s.length <= 8 * 24, `expected ≤ 192 buckets, got ${s.length}`);
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

test("a run of under five slabs is drawn exactly as stored — no majority to go on", () => {
  // THIS TEST USED TO SAY every mis-dated slab is shown on its stored date. Since
  // 2026-09-25 a slab one day off from the slabs made around it is drawn where it
  // was made (see the tests below) — but only when there IS a clear majority of
  // neighbours to say so. Three slabs cannot outvote each other: here the third
  // slab may be mis-stored as 01 Sep or may really be the next day, and nothing
  // in three rows can tell, so the records are drawn as they stand.
  const s = hourlyProduction([
    { productionDate: "2026-08-31", inTime: "09:00", outTime: "09:40" },
    { productionDate: "2026-08-31", inTime: "10:00", outTime: "10:30" },
    { productionDate: "2026-09-01", inTime: "11:00", outTime: "11:30" },
  ]);
  const dates = [...new Set(s.map((b) => b.date))];
  assert.deepEqual(dates, ["2026-08-31", "2026-09-01"]);
  assert.equal(sum(s), 3); // every slab counted once, none dropped or duplicated
});

/* ══ TWO RECORDING SLIPS, DRAWN WHERE THE SLAB WAS MADE (2026-09-25) ══════════
   The owner's report: batch D-1432 ran on 31 Aug only, 11:20 → 22:31, yet the
   chart drew two of its last-hour slabs 24 hours later — 1 Sep 21:00–22:00 → 1,
   22:00–23:00 → 1 — and the KPIs read 34 hours 40 minutes and 3.6 slabs/hour;
   the same in 1426, 1411, 1410, 1404 and 1384. The cause is in the records, and
   it comes in two forms that chart identically: a production date one day off
   (the entry form's carried-forward working date), or an Out typed a few minutes
   before its own In, which the midnight rule then puts on the next day. Either
   way the slab sits EXACTLY one day from the slabs made around it — and that
   signature, in production (slab-number) order, is all placeSlabs acts on. */

const DAY_MIN = 1440;
const pad2 = (n: number) => String(n).padStart(2, "0");
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const isoOf = (abs: number) => new Date(Math.floor(abs / DAY_MIN) * 86_400_000).toISOString().slice(0, 10);
const clockOf = (abs: number) => { const m = ((abs % DAY_MIN) + DAY_MIN) % DAY_MIN; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
const at = (iso: string, hhmm: string) => dayOf(iso) * DAY_MIN + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Each slab its own run: no neighbours to consult, so exactly the stored
 *  places — what the chart drew before 2026-09-25. */
const alone = <T extends HourlySlab>(rows: T[]) => rows.map((r, i) => ({ ...r, runKey: `alone:${i}` }));
/** [slab, whole days moved] for every slab placeSlabs moved. */
const movedDays = (rows: HourlySlab[]) => {
  const p = placeSlabs(rows);
  return rows.flatMap((r, i) => (p[i].dayShift ? [[r.slabNumber, p[i].dayShift]] : []));
};
/** The slabs whose next-day Out was taken back to the In's day. */
const outsBack = (rows: HourlySlab[]) => {
  const p = placeSlabs(rows);
  return rows.flatMap((r, i) => (p[i].outOnInDay ? [r.slabNumber] : []));
};
const hoursOf = (s: { date: string | null; hour: number; slabs: number }[]) => s.map((b) => `${b.date} ${pad2(b.hour)}`);

/** The real register rows in tests/fixtures (Slab No., stored date, In, Out). */
const REGISTER = JSON.parse(readFileSync(new URL("./fixtures/robo-register-d1448-d1449.json", import.meta.url), "utf8")) as
  Record<string, [string, string, string, string][]>;
const register = (batch: string): HourlySlab[] =>
  REGISTER[batch].map(([slabNumber, productionDate, inTime, outTime]) => ({ slabNumber, productionDate, inTime, outTime }));

test("BATCH D-1432 as the owner saw it: the records as stored draw 1 Sep 21:00 and 22:00", () => {
  // The fixture is faithful to the screen: drawn from the stored places alone,
  // both forms of the slip give exactly the chart the owner reported.
  for (const slip of ["date", "out"] as const) {
    const s = hourlyProduction(alone(d1432(slip)));
    assert.deepEqual(
      s.filter((b) => b.date === "2026-08-31" && b.hour >= 11 && b.hour <= 22).map((b) => b.slabs),
      D1432_CHARTED_31_AUG,
      `${slip}: 31 Aug as charted`,
    );
    assert.deepEqual(
      s.filter((b) => b.date === "2026-09-01" && b.slabs > 0).map((b) => [b.hour, b.slabs]),
      [[21, 1], [22, 1]],
      `${slip}: the two slabs a day late`,
    );
  }
});

test("BATCH D-1432 — a production date one day off: one date, 11:00 … 22:00, every slab in its real hour", () => {
  const rows = d1432("date");
  const s = hourlyProduction(rows);
  assert.deepEqual(s.map((b) => b.hour), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  assert.ok(s.every((b) => b.date === "2026-08-31"), "no 1 Sep anywhere — no second 24-hour timeline");
  assert.deepEqual(s.map((b) => b.slabs), D1432_REAL_31_AUG, "21:00 → 14 and 22:00 → 5, the two back in their hours");
  assert.equal(sum(s), 126, "every slab in exactly one bucket");
  // Exactly the two slabs stored on 1 Sep moved, one day back — nothing else.
  assert.deepEqual(movedDays(rows), D1432_SLIPPED.map((n) => [n, -1]));
  assert.deepEqual(outsBack(rows), []);
});

test("BATCH D-1432 — an Out typed before its In: the same chart, the Out back on the In's day", () => {
  const rows = d1432("out");
  const s = hourlyProduction(rows);
  assert.ok(s.every((b) => b.date === "2026-08-31"));
  assert.deepEqual(s.map((b) => b.slabs), D1432_REAL_31_AUG);
  assert.equal(sum(s), 126);
  // The dates were right all along; only the two Outs move, and only back to
  // the day of their own In.
  assert.deepEqual(movedDays(rows), []);
  assert.deepEqual(outsBack(rows), D1432_SLIPPED);
});

test("BATCH D-1432 — the run is 31/08/2026 11:20 → 31/08/2026 22:31: the subtitle's two instants", () => {
  for (const slip of ["date", "out"] as const) {
    const { firstIn, lastOut } = runBounds(d1432(slip));
    assert.deepEqual(absToDateTime(firstIn as number), { date: "2026-08-31", time: "11:20" }, `${slip}: first slab In`);
    assert.deepEqual(absToDateTime(lastOut as number), { date: "2026-08-31", time: "22:31" }, `${slip}: last slab Out`);
  }
  // As stored, the "last Out" was the late slab on 1 Sep — the 34h 40m.
  const { lastOut } = runBounds(alone(d1432("date")));
  assert.deepEqual(absToDateTime(lastOut as number), { date: "2026-09-01", time: "22:00" });
});

test("REAL REGISTER D-1448 — 160534–160535, made 18 Sep 00:22–00:46 but stored 17 Sep, are drawn on the 18th", () => {
  // The other direction, from a real export: the working date re-seeded to the
  // new setup's 17 Sep just after midnight, for two slabs, before the operator
  // moved it on. As stored, the chart opened at 17 Sep 00:00 — twenty hours
  // before the batch began.
  const rows = register("D-1448");
  assert.equal(rows.length, 60);
  const asStored = hourlyProduction(alone(rows));
  assert.deepEqual(hoursOf(asStored)[0], "2026-09-17 00");

  assert.deepEqual(movedDays(rows), [["160534", 1], ["160535", 1]]);
  assert.deepEqual(outsBack(rows), [], "its three real midnight crossings keep their next-day Out");
  const s = hourlyProduction(rows);
  assert.equal(hoursOf(s)[0], "2026-09-17 20");
  assert.equal(hoursOf(s).at(-1), "2026-09-18 02");
  assert.equal(sum(s), 60);
  const { firstIn, lastOut } = runBounds(rows);
  assert.deepEqual([absToDateTime(firstIn as number), absToDateTime(lastOut as number)], [
    { date: "2026-09-17", time: "20:13" },
    { date: "2026-09-18", time: "02:40" },
  ]);
});

test("REAL REGISTER D-1449 — 631 slabs over seven days: exactly one slab moves, every pause and midnight stays", () => {
  // The register that proves the check leaves real production alone: four
  // pauses of 6 to 60 hours, seven slabs that crossed midnight, one slab
  // (161281) stored 21 Sep 07:46 between slabs made on 22 Sep at 07:40 and 07:51.
  const rows = register("D-1449");
  assert.equal(rows.length, 631);
  assert.deepEqual(movedDays(rows), [["161281", 1]]);
  assert.deepEqual(outsBack(rows), []);

  const placed = placeSlabs(rows);
  const crossed = rows.flatMap((r, i) => ((r.outTime as string) < (r.inTime as string) ? [placed[i]] : []));
  assert.equal(crossed.length, 7);
  for (const c of crossed) {
    const minutes = (c.outAbs as number) - (c.inAbs as number);
    assert.ok(minutes > 0 && minutes < 60, `a midnight crossing stays a short slab, not ${minutes} min`);
  }

  // Every slab in exactly one bucket, first In to last Out — the eight-day cap
  // holds all seven days (the old four-day cap stopped this chart on 21 Sep).
  const s = hourlyProduction(rows);
  assert.equal(sum(s), 631);
  assert.equal(hoursOf(s)[0], "2026-09-17 04");
  assert.equal(hoursOf(s).at(-1), "2026-09-23 21");
  // The 60-hour pause is still there, as empty hours, not closed up.
  let longest = 0;
  let run = 0;
  for (const b of s) { run = b.slabs === 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  assert.ok(longest >= 59, `the 60-hour pause stays empty, longest gap ${longest}h`);
});

/* ── the shapes the other named batches have ── */

/** A steady multi-day run like D-1426 — 205 slabs, 25 Aug 22:45 → 27 Aug 01:55,
 *  through two midnights, the date moved on at each midnight as the operator
 *  does — with the last `late` slabs stored a day late. */
function run1426(late = 0): HourlySlab[] {
  const first = at("2026-08-25", "22:45");
  return Array.from({ length: 205 }, (_, k) => {
    const inAbs = first + Math.round((k * (1630 - 18)) / 204);
    const outAbs = inAbs + 18;
    const slipped = k >= 205 - late;
    return {
      slabNumber: String(156367 + k),
      productionDate: isoOf(inAbs + (slipped ? DAY_MIN : 0)),
      inTime: clockOf(inAbs),
      outTime: clockOf(outAbs),
    };
  });
}

test("BATCH 1426 shape — a two-midnight run whose last slabs were stored a day late ends on 27 Aug 01:00", () => {
  const clean = hourlyProduction(run1426());
  assert.deepEqual([...new Set(clean.map((b) => b.date))], ["2026-08-25", "2026-08-26", "2026-08-27"]);
  for (const late of [1, 2, 3]) {
    const rows = run1426(late);
    // As stored: a second timeline on 28 Aug.
    assert.equal(hoursOf(hourlyProduction(alone(rows))).at(-1), "2026-08-28 01", `${late}: as stored`);
    const s = hourlyProduction(rows);
    assert.deepEqual(s, clean, `${late} late slab(s): the chart is the clean run's, exactly`);
    assert.equal(sum(s), 205);
    assert.equal(movedDays(rows).length, late);
    const { firstIn, lastOut } = runBounds(rows);
    assert.equal((lastOut as number) - (firstIn as number), 1630, "25 Aug 22:45 → 27 Aug 01:55 = 27h 10m");
  }
});

test("BATCH 1426 shape — the last slab's Out typed before its In ends on 27 Aug too", () => {
  const rows = run1426();
  const last = rows[rows.length - 1];
  rows[rows.length - 1] = { ...last, inTime: "02:00" }; // Out 01:55 < In 02:00 → the midnight rule fires
  assert.equal(hoursOf(hourlyProduction(alone(rows))).at(-1), "2026-08-28 01", "as stored: 28 Aug");
  assert.deepEqual(outsBack(rows), ["156571"]);
  const s = hourlyProduction(rows);
  assert.equal(hoursOf(s).at(-1), "2026-08-27 01");
  assert.equal(sum(s), 205);
});

test("the first slabs of a run stored a day early are drawn on the run's day", () => {
  // A head slip — the date left on the day before for the first two slabs.
  const rows = run1426();
  rows[0] = { ...rows[0], productionDate: "2026-08-24" };
  rows[1] = { ...rows[1], productionDate: "2026-08-24" };
  assert.equal(hoursOf(hourlyProduction(alone(rows)))[0], "2026-08-24 22", "as stored: a day early");
  assert.deepEqual(movedDays(rows), [["156367", 1], ["156368", 1]]);
  assert.equal(hoursOf(hourlyProduction(rows))[0], "2026-08-25 22");
});

/* ── what must NOT move ── */

test("slabs that really crossed midnight keep their next-morning Out, among any number of neighbours", () => {
  // 40 slabs through midnight, each In → Out 18 minutes, several of them In
  // before midnight and Out after — the Out rightly the next day.
  const first = at("2026-09-10", "22:30");
  const rows: HourlySlab[] = Array.from({ length: 40 }, (_, k) => {
    const inAbs = first + 3 * k;
    return { slabNumber: String(1000 + k), productionDate: isoOf(inAbs), inTime: clockOf(inAbs), outTime: clockOf(inAbs + 18) };
  });
  assert.ok(rows.some((r) => (r.outTime as string) < (r.inTime as string)), "the fixture has midnight crossings");
  assert.deepEqual(movedDays(rows), []);
  assert.deepEqual(outsBack(rows), []);
  const s = hourlyProduction(rows);
  // First In 22:30, last Out 00:45: 22:00, 23:00 on the 10th, 00:00 on the 11th.
  assert.deepEqual(hoursOf(s), ["2026-09-10 22", "2026-09-10 23", "2026-09-11 00"]);
  assert.equal(sum(s), 40);
});

test("a slab held in the line past midnight is not mistaken for a mistyped Out", () => {
  // In 20:00, Out 14:00 the next afternoon — an 18-hour hold. Its Out is nowhere
  // near its neighbours', but taking it back to the In's day (14:00, six hours
  // BEFORE they came out) is nowhere near them either: no majority, no move.
  const first = at("2026-09-10", "18:00");
  const rows: HourlySlab[] = Array.from({ length: 20 }, (_, k) => {
    const inAbs = first + 9 * k;
    return { slabNumber: String(2000 + k), productionDate: isoOf(inAbs), inTime: clockOf(inAbs), outTime: clockOf(inAbs + 20) };
  });
  rows[13] = { ...rows[13], inTime: "20:00", outTime: "14:00" };
  assert.deepEqual(outsBack(rows), []);
  const p = placeSlabs(rows);
  assert.equal((p[13].outAbs as number) - (p[13].inAbs as number), 18 * 60, "still an 18-hour hold");
});

test("a real restart the next day is left where it was recorded", () => {
  // 30 slabs on 10 Sep 08:00–11:00, the line down for a day, 30 more on
  // 11 Sep from 08:30. The second block has company where it is stored — it
  // is the next day, as recorded.
  const rows: HourlySlab[] = [];
  for (let k = 0; k < 30; k++) {
    const a = at("2026-09-10", "08:00") + 6 * k;
    rows.push({ slabNumber: String(3000 + k), productionDate: isoOf(a), inTime: clockOf(a), outTime: clockOf(a + 20) });
  }
  for (let k = 0; k < 30; k++) {
    const a = at("2026-09-11", "08:30") + 6 * k;
    rows.push({ slabNumber: String(3030 + k), productionDate: isoOf(a), inTime: clockOf(a), outTime: clockOf(a + 20) });
  }
  assert.deepEqual(movedDays(rows), []);
  assert.deepEqual([...new Set(hourlyProduction(rows).map((b) => b.date))], ["2026-09-10", "2026-09-11"]);
});

test("the order the rows arrive in does not matter — production order is the slab number", () => {
  // The database hands rows back in no particular order; the checks must read
  // the run in the plant's slab-number order whatever order they are given.
  for (const [batch, moved] of [["D-1448", [["160534", 1], ["160535", 1]]], ["D-1449", [["161281", 1]]]] as const) {
    const rows = register(batch);
    const shuffled = rows.map((r, i) => ({ r, key: (i * 7919) % rows.length })).sort((a, b) => a.key - b.key).map((x) => x.r);
    assert.notDeepEqual(shuffled.map((r) => r.slabNumber), rows.map((r) => r.slabNumber));
    assert.deepEqual(movedDays(shuffled).sort(), moved, `${batch}: the same slabs move`);
    assert.deepEqual(hourlyProduction(shuffled), hourlyProduction(rows), `${batch}: the same chart`);
    assert.deepEqual(runBounds(shuffled), runBounds(rows));
  }
});

test("where a slip and a real restart look the same, the records stand: four slabs a day later end the run as recorded", () => {
  // Four slabs at the end of a run, one day after the rest at the same clock
  // times, are exactly what a batch finished off after a day's stop looks like
  // — each has three others right beside it. Up to three are too few to be a
  // run of their own and are drawn with the batch (the 1426-shape tests);
  // from four, what was recorded is drawn.
  const rows = run1426(4);
  assert.deepEqual(movedDays(rows), []);
  assert.equal(hoursOf(hourlyProduction(rows)).at(-1), "2026-08-28 01");
});

test("slabs of one batch never judge another's (runKey)", () => {
  // Batch A ran 10 Sep 09:00–11:00; batch B three slabs on 11 Sep at the same
  // clock times. As two runs, B stands on its own dates. Taken as ONE run, B
  // would look like three slabs a day late — which is why the Reports KPI
  // passes each slab's batch, and the chart only ever gets one batch.
  const a = Array.from({ length: 20 }, (_, k) => {
    const t = at("2026-09-10", "09:00") + 6 * k;
    return { runKey: "A", slabNumber: String(4000 + k), productionDate: "2026-09-10", inTime: clockOf(t), outTime: clockOf(t + 15) };
  });
  const b = ["10:40", "10:46", "10:52"].map((t, k) => (
    { runKey: "B", slabNumber: String(4100 + k), productionDate: "2026-09-11", inTime: t, outTime: clockOf(at("2026-09-11", t) + 15) }
  ));
  assert.deepEqual(movedDays([...a, ...b]), []);
  const oneRun = [...a, ...b].map(({ runKey: _, ...r }) => r);
  assert.equal(movedDays(oneRun).length, 3, "the same rows as one run would be pulled back");
});

test("absToDateTime reads back the date and clock time a slab was recorded with", () => {
  assert.deepEqual(absToDateTime(at("2026-08-31", "11:20")), { date: "2026-08-31", time: "11:20" });
  assert.deepEqual(absToDateTime(at("2026-08-31", "23:59") + 6), { date: "2026-09-01", time: "00:05" });
  assert.equal(absToDateTime(Number.NaN), null);
});

/* ── properties over many realistic runs ── */

/** A small deterministic PRNG, so every run of the suite checks the same runs. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A realistic run: a slab in every 2–13 minutes, 8–47 minutes in the line,
 *  dated by its In as the operator dates it, with real pauses now and then —
 *  never within three hours of exactly one day, which no rule can tell from a
 *  date typed a day off. Returns the true In/Out alongside the rows. */
function realRun(rnd: () => number, n: number, pauses: boolean) {
  const truth: { inAbs: number; outAbs: number }[] = [];
  let t = at("2026-08-01", "00:00") + Math.floor(rnd() * DAY_MIN);
  for (let k = 0; k < n; k++) {
    if (k > 0) t += 2 + Math.floor(rnd() * 12);
    if (pauses && k > 0 && rnd() < 0.04) {
      t += rnd() < 0.5 ? 60 + Math.floor(rnd() * 19 * 60) : 28 * 60 + Math.floor(rnd() * 42 * 60);
    }
    truth.push({ inAbs: t, outAbs: t + 8 + Math.floor(rnd() * 40) });
  }
  const rows: HourlySlab[] = truth.map((x, k) => ({
    slabNumber: String(500000 + k), productionDate: isoOf(x.inAbs), inTime: clockOf(x.inAbs), outTime: clockOf(x.outAbs),
  }));
  return { rows, truth };
}

test("PROPERTY — on clean records nothing ever moves (pauses, midnights, any length)", () => {
  const rnd = prng(20260925);
  for (let r = 0; r < 400; r++) {
    const { rows } = realRun(rnd, 1 + Math.floor(rnd() * 90), true);
    const p = placeSlabs(rows);
    const moved = p.filter((x) => x.dayShift !== 0 || x.outOnInDay).length;
    assert.equal(moved, 0, `run ${r}: ${moved} slab(s) moved on clean records`);
  }
});

test("PROPERTY — an isolated slip of either kind is always put back, and once back stays put", () => {
  const rnd = prng(1432);
  for (let r = 0; r < 300; r++) {
    const n = 5 + Math.floor(rnd() * 80);
    const { rows, truth } = realRun(rnd, n, false);
    // Slips at least 17 slabs apart, so no slip is inside another's window.
    const slips = new Map<number, "early" | "late" | "out">();
    for (let k = Math.floor(rnd() * 5); k < n; k += 17 + Math.floor(rnd() * 10)) {
      const x = truth[k];
      // An Out typed 1–30 minutes before its In, on the In's own day — the case
      // the midnight rule misreads. (Just after midnight such a typo would read
      // as a later Out the same day, not a midnight crossing; that is not this.)
      const typo = 1 + Math.floor(rnd() * 30);
      let kind = (["early", "late", "out"] as const)[Math.floor(rnd() * 3)] as "early" | "late" | "out";
      if (kind === "out" && (x.inAbs % DAY_MIN) - typo < 0) kind = "late";
      slips.set(k, kind);
      if (kind === "out") {
        rows[k] = { ...rows[k], outTime: clockOf(x.inAbs - typo) };
      } else {
        rows[k] = { ...rows[k], productionDate: isoOf(x.inAbs + (kind === "late" ? DAY_MIN : -DAY_MIN)) };
      }
    }
    const p = placeSlabs(rows);
    rows.forEach((_, k) => {
      const kind = slips.get(k);
      const want = kind === "late" ? -1 : kind === "early" ? 1 : 0;
      assert.equal(p[k].dayShift, want, `run ${r} slab ${k} (${kind ?? "clean"}): day shift`);
      assert.equal(p[k].outOnInDay, kind === "out", `run ${r} slab ${k} (${kind ?? "clean"}): Out`);
      assert.equal(p[k].inAbs, truth[k].inAbs, `run ${r} slab ${k}: drawn where it went in`);
    });
    // Written back as corrected, the records are clean: nothing moves again.
    const fixed = rows.map((row, k) => (p[k].dayShift ? { ...row, productionDate: isoOf(p[k].inAbs as number) } : row));
    assert.ok(placeSlabs(fixed).every((x, k) => x.dayShift === 0 && x.outOnInDay === (slips.get(k) === "out")), `run ${r}: stable`);
  }
});

test("PROPERTY — whatever the records, a slab moves at most one day and none is lost", () => {
  const rnd = prng(1449);
  for (let r = 0; r < 300; r++) {
    const { rows } = realRun(rnd, 1 + Math.floor(rnd() * 70), rnd() < 0.5);
    // Scatter slips of every kind, blocks included, anywhere.
    rows.forEach((row, k) => {
      const u = rnd();
      if (u < 0.06) rows[k] = { ...row, productionDate: isoOf(dayOf(row.productionDate as string) * DAY_MIN + (u < 0.03 ? DAY_MIN : -DAY_MIN)) };
      else if (u < 0.09) rows[k] = { ...row, outTime: clockOf(at("2026-01-01", row.inTime as string) - 5) };
    });
    const stored = placeSlabs(alone(rows));
    const p = placeSlabs(rows);
    p.forEach((x, k) => {
      assert.ok(Math.abs(x.dayShift) <= 1, `run ${r} slab ${k}: at most one day`);
      const s = stored[k];
      assert.equal(x.inAbs, s.inAbs === null ? null : s.inAbs + x.dayShift * DAY_MIN);
      assert.equal(x.outAbs, s.outAbs === null ? null : s.outAbs + x.dayShift * DAY_MIN - (x.outOnInDay ? DAY_MIN : 0));
      if (x.outOnInDay) assert.ok((rows[k].outTime as string) < (rows[k].inTime as string), "only a midnight-rule Out goes back");
    });
    // In production order the run never gets LESS consistent than as stored.
    const jumps = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.slice(1).filter((x, i) => x < v[i] - 180).length;
    };
    assert.ok(jumps(p.map((x) => x.inAbs ?? x.outAbs)) <= jumps(stored.map((x) => x.inAbs ?? x.outAbs)), `run ${r}: guard`);
    // Every completed slab is counted exactly once (when the run fits the chart).
    const { firstIn, lastOut } = runBounds(rows);
    if (firstIn !== null && lastOut !== null && lastOut - firstIn < 7 * DAY_MIN) {
      assert.equal(sum(hourlyProduction(rows)), rows.filter((x) => x.outTime).length, `run ${r}: none lost`);
    }
  }
});

/* ── the subtitle, and the wiring that keeps chart, subtitle and KPI one rule ── */

test("the subtitle names the run's first In and last Out: 'Batch D-1432 · 31/08/2026 (11:20) → 31/08/2026 (22:31) — …'", () => {
  const { firstIn, lastOut } = runBounds(d1432("date"));
  const run = { start: absToDateTime(firstIn as number), end: absToDateTime(lastOut as number) };
  assert.equal(runScope(run), "31/08/2026 (11:20) → 31/08/2026 (22:31)");
  // Exactly the sentence the owner asked for, as the Reports page composes it.
  assert.equal(
    `Batch D-1432 · ${runScope(run)} — slabs completed each hour, by Out Time, across the batch's run`,
    "Batch D-1432 · 31/08/2026 (11:20) → 31/08/2026 (22:31) — slabs completed each hour, by Out Time, across the batch's run",
  );
  // A run over midnight names both dates; a run with nothing completed has no
  // last Out, and the page falls back to the chart's dates.
  assert.equal(
    runScope({ start: { date: "2026-08-25", time: "22:45" }, end: { date: "2026-08-27", time: "01:55" } }),
    "25/08/2026 (22:45) → 27/08/2026 (01:55)",
  );
  assert.equal(runScope({ start: { date: "2026-08-25", time: "22:45" }, end: null }), "");
  assert.equal(runScope(null), "");
});

test("the chart route, the Reports KPI and the page all go through the one placement", () => {
  // Source-level, because the way this breaks is a caller quietly dropping the
  // production order (then the one-day checks read the rows in database order)
  // or computing its own first-In/last-Out.
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const route = src("app/api/robo/reports/hourly/route.ts");
  const summary = src("lib/robo/reportSummary.ts");
  for (const [name, code, row] of [["hourly route", route, "s"], ["reportSummary", summary, "r"]] as const) {
    for (const field of ["slabNumber: true", "createdAt: true", "id: true"]) {
      assert.ok(code.includes(field), `${name} must select ${field}`);
    }
    for (const passed of [`slabNumber: ${row}.slabNumber`, `createdAtMs: ${row}.createdAt.getTime()`, `id: ${row}.id`]) {
      assert.ok(code.includes(passed), `${name} must pass ${passed}`);
    }
  }
  assert.match(route, /runBounds\(rows\)/, "the subtitle's two instants come from runBounds");
  assert.match(route, /NextResponse\.json\(\{ series, run \}\)/);
  assert.match(summary, /runKey: batchIds !== null\s*\? "batch"/, "a batch filter is one run, as the chart draws it");
  const page = src("components/robo/reports/ReportsClient.tsx");
  assert.match(page, /runScope\(hourlyRun\)/);
  assert.ok(page.includes("— slabs completed each hour, by Out Time, across the batch's run"));
});
