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

/* ── The two cases the report specifies ─────────────────────────────────────── */

test("CASE 1 — same-day batch 1428 (In 11:20 → Out 19:35): 11:00 … 19:00 only", () => {
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-08-24", inTime: "11:20", outTime: "12:05" },
    { serialNumber: 2, productionDate: "2026-08-24", inTime: "12:05", outTime: "15:40" },
    { serialNumber: 3, productionDate: "2026-08-24", inTime: "15:40", outTime: "19:35" },
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
  assert.equal(s.reduce((a, b) => a + b.slabs, 0), 3);
});

// CASE 2 — a batch 21 Aug 19:10 → 22 Aug 14:20, continuous across midnight, no gap.
const CASE2_TIMES = [
  { inTime: "19:10", outTime: "19:55" }, // out 19:00–20:00, 21 Aug
  { inTime: "23:30", outTime: "23:55" }, // out 23:00–00:00, 21 Aug
  { inTime: "00:20", outTime: "00:50" }, // out 00:00–01:00, 22 Aug
  { inTime: "13:40", outTime: "14:20" }, // out 14:00–15:00, 22 Aug
];

test("CASE 2 — crossing midnight flows 23:00 → 00:00 with both dates and no gap", () => {
  // Later slabs re-dated to the 22nd (the app's normal case).
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-08-21", ...CASE2_TIMES[0] },
    { serialNumber: 2, productionDate: "2026-08-21", ...CASE2_TIMES[1] },
    { serialNumber: 3, productionDate: "2026-08-22", ...CASE2_TIMES[2] },
    { serialNumber: 4, productionDate: "2026-08-22", ...CASE2_TIMES[3] },
  ]);
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
  assert.equal(s.reduce((a, b) => a + b.slabs, 0), 4);
});

test("CASE 2 (root cause) — a cross-midnight batch NOT re-dated gives the SAME chart", () => {
  // Every slab still carries the START date (operator never bumped it at
  // midnight). The old logic folded the second half back before the start and
  // lost it; the sequence-based unwrap now places it on the 22nd, identically.
  const notReDated = hourlyProduction(
    CASE2_TIMES.map((t, i) => ({ serialNumber: i + 1, productionDate: "2026-08-21", ...t })),
  );
  const reDated = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-08-21", ...CASE2_TIMES[0] },
    { serialNumber: 2, productionDate: "2026-08-21", ...CASE2_TIMES[1] },
    { serialNumber: 3, productionDate: "2026-08-22", ...CASE2_TIMES[2] },
    { serialNumber: 4, productionDate: "2026-08-22", ...CASE2_TIMES[3] },
  ]);
  assert.deepEqual(notReDated, reDated);
  // And it really did reconstruct both dates from the times alone.
  assert.ok(notReDated.some((b) => b.date === "2026-08-22"));
  assert.equal(notReDated.reduce((a, b) => a + b.slabs, 0), 4);
});

test("register order, not array order, defines the sequence", () => {
  // Same four slabs delivered shuffled but carrying their serialNumber — the
  // result must match the in-order run.
  const shuffled = hourlyProduction([
    { serialNumber: 3, productionDate: "2026-08-21", ...CASE2_TIMES[2] },
    { serialNumber: 1, productionDate: "2026-08-21", ...CASE2_TIMES[0] },
    { serialNumber: 4, productionDate: "2026-08-21", ...CASE2_TIMES[3] },
    { serialNumber: 2, productionDate: "2026-08-21", ...CASE2_TIMES[1] },
  ]);
  const inOrder = hourlyProduction(
    CASE2_TIMES.map((t, i) => ({ serialNumber: i + 1, productionDate: "2026-08-21", ...t })),
  );
  assert.deepEqual(shuffled, inOrder);
});

test("minor out-of-order logging does NOT trip a false midnight crossing", () => {
  // Two adjacent slabs a few minutes out of order stay on the same day.
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-08-24", inTime: "10:05", outTime: "10:12" },
    { serialNumber: 2, productionDate: "2026-08-24", inTime: "10:00", outTime: "10:20" },
  ]);
  assert.ok(s.every((b) => b.date === "2026-08-24"));
  assert.ok(!s.some((b) => b.hour === 0), "a 5-minute backstep is not a midnight crossing");
});

test("the same records always give the same chart (deterministic, no clock)", () => {
  const rows = CASE2_TIMES.map((t, i) => ({ serialNumber: i + 1, productionDate: "2026-08-21", ...t }));
  assert.deepEqual(hourlyProduction(rows), hourlyProduction(rows));
});

test("BATCH 1432 — late slabs mis-dated to the next day stay in their real hour", () => {
  // 31 Aug, 11:20 → 22:50. Six slabs complete in 22:00–23:00; two of them wrongly
  // carry 01 Sep. They must all count in 22:00–23:00 on 31 Aug — none 24h later,
  // and NO empty next-day timeline after 22:00–23:00.
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-08-31", inTime: "11:20", outTime: "12:00" },
    { serialNumber: 2, productionDate: "2026-08-31", inTime: "20:00", outTime: "21:30" },
    { serialNumber: 3, productionDate: "2026-08-31", inTime: "21:35", outTime: "22:05" }, // 22:00–23:00
    { serialNumber: 4, productionDate: "2026-08-31", inTime: "22:05", outTime: "22:20" }, // 22:00–23:00
    { serialNumber: 5, productionDate: "2026-08-31", inTime: "22:20", outTime: "22:30" }, // 22:00–23:00
    { serialNumber: 6, productionDate: "2026-08-31", inTime: "22:30", outTime: "22:40" }, // 22:00–23:00
    { serialNumber: 7, productionDate: "2026-09-01", inTime: "22:40", outTime: "22:45" }, // mis-dated → still 22:00–23:00
    { serialNumber: 8, productionDate: "2026-09-01", inTime: "22:45", outTime: "22:50" }, // mis-dated → still 22:00–23:00
  ]);
  // 11:00 … 22:00 only — 12 hours, and it ends at 22:00–23:00.
  assert.deepEqual(s.map((b) => b.hour), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  assert.equal(s[s.length - 1].hour, 22);
  // Not one bucket rolls to 01 Sep, and there is no extra next-day timeline.
  assert.ok(s.every((b) => b.date === "2026-08-31"), "every hour stays on 31 Aug");
  // All SIX real slabs of the last hour are counted there — the two mis-dated
  // ones did NOT jump ~24h forward.
  assert.equal(s.find((b) => b.hour === 22)!.slabs, 6);
  assert.equal(s.reduce((a, b) => a + b.slabs, 0), 8); // every slab once, none duplicated
});

test("a single forward-mis-dated slab mid-run does not open a second day", () => {
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-08-31", inTime: "09:00", outTime: "09:40" },
    { serialNumber: 2, productionDate: "2026-09-01", inTime: "09:40", outTime: "10:15" }, // wrong date, real time 10:xx
    { serialNumber: 3, productionDate: "2026-08-31", inTime: "10:15", outTime: "11:05" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [9, 10, 11]);
  assert.ok(s.every((b) => b.date === "2026-08-31"));
  assert.equal(s.reduce((a, b) => a + b.slabs, 0), 3);
});

/* ── change #2: a long-held slab must not fabricate an extra day ─────────────
   Continuity is measured IN-to-IN. A slab kept open for many hours has a late
   Out; keying the next slab's midnight check off that Out made a normal
   following slab look like a backward jump and drew a phantom next day. */

test("SINGLE DAY — a long-held slab (late Out) does NOT spill the chart into the next day", () => {
  // S2 opens at 09:00 and only closes at 22:30 (a long hold). S3 at 09:30 must
  // stay on the SAME day, not be flung 24h forward by S2's late Out.
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-08-31", inTime: "08:00", outTime: "08:30" },
    { serialNumber: 2, productionDate: "2026-08-31", inTime: "09:00", outTime: "22:30" }, // 13½h hold
    { serialNumber: 3, productionDate: "2026-08-31", inTime: "09:30", outTime: "10:00" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  assert.ok(s.every((b) => b.date === "2026-08-31"), "must stay entirely on 31 Aug");
  assert.equal(s.find((b) => b.hour === 8)!.slabs, 1);  // S1 completes 08:30
  assert.equal(s.find((b) => b.hour === 10)!.slabs, 1); // S3 completes 10:00, same day
  assert.equal(s.find((b) => b.hour === 22)!.slabs, 1); // S2 completes 22:30
  assert.equal(s.reduce((a, b) => a + b.slabs, 0), 3);
});

test("BATCH 1386 — a real two-day run with a long hold does NOT draw a phantom third day", () => {
  // 20 Jul 12:12 → 21 Jul 17:12, crossing midnight once. A long-held slab on the
  // 21st (In 02:00 → Out 20:00) must not push the slab after it onto 22 Jul.
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-07-20", inTime: "12:12", outTime: "12:30" },
    { serialNumber: 2, productionDate: "2026-07-20", inTime: "23:40", outTime: "23:55" },
    { serialNumber: 3, productionDate: "2026-07-21", inTime: "00:10", outTime: "00:40" }, // crosses midnight
    { serialNumber: 4, productionDate: "2026-07-21", inTime: "02:00", outTime: "20:00" }, // 18h hold
    { serialNumber: 5, productionDate: "2026-07-21", inTime: "02:30", outTime: "03:00" },
  ]);
  // Exactly two calendar dates — 20 and 21 July — never 22 July.
  const dates = [...new Set(s.map((b) => b.date))];
  assert.deepEqual(dates, ["2026-07-20", "2026-07-21"]);
  assert.ok(!s.some((b) => b.date === "2026-07-22"), "no phantom third day");
  // The boundary flows 23:00 (20 Jul) straight into 00:00 (21 Jul), no gap.
  const i23 = s.findIndex((b) => b.hour === 23 && b.date === "2026-07-20");
  assert.equal(s[i23 + 1].hour, 0);
  assert.equal(s[i23 + 1].date, "2026-07-21");
  assert.equal(s.reduce((a, b) => a + b.slabs, 0), 5);
});

test("OVERNIGHT slab (issue 3) — an Out before the In is treated as the NEXT day", () => {
  // In 23:55 on 20 Jul, Out 00:09 → that 00:09 is 21 Jul 00:09, never 20 Jul.
  // The next slab entered 00:04 was re-dated to 21 Jul, and lands there too.
  const s = hourlyProduction([
    { serialNumber: 1, productionDate: "2026-07-20", inTime: "23:55", outTime: "00:09" },
    { serialNumber: 2, productionDate: "2026-07-21", inTime: "00:04", outTime: "00:20" },
  ]);
  assert.deepEqual(s.map((b) => b.hour), [23, 0]);
  assert.deepEqual(s.map((b) => b.date), ["2026-07-20", "2026-07-21"]);
  // Both completions (00:09 and 00:20) count in 00:00–01:00 on 21 Jul, not on 20 Jul.
  assert.equal(s.find((b) => b.hour === 23)!.slabs, 0);
  assert.equal(s.find((b) => b.hour === 0)!.slabs, 2);
});
