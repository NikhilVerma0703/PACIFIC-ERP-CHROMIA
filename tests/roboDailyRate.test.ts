import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  lineMinutesByDate,
  dailySlabsPerHour,
  dailyRateYAxis,
  QUIET_LIMIT_MINUTES,
  type DatedSlab,
} from "../src/lib/robo/dailyRate.ts";

/* Daily Slabs / Hour Trend — DATE-based, never batch-based:

     slabs produced on that date ÷ hours the Robo line ran on that date

   The owner's rules (2026-09-25): a line that ran all 24 hours divides by 24;
   one that ran 07:00 → 20:00 divides by 13, not 24; delays are not subtracted;
   the slabs are the ones Slab Records lists for that Production Date. It used
   to divide by the open time of the date's shift rows and read 19/09 as
   279.3 slabs/hour. */

const pad2 = (n: number) => String(n).padStart(2, "0");
const clock = (m: number) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
/** `n` slabs at a steady pace between `from` and `to` (HH:MM, same date), each
 *  in the line `inLine` minutes, the last one coming out exactly at `to`. */
function steady(date: string, from: string, to: string, n: number, inLine = 20): DatedSlab[] {
  const [a, b] = [from, to].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
  return Array.from({ length: n }, (_, k) => {
    const inM = a + Math.round((k * (b - inLine - a)) / Math.max(1, n - 1));
    return { productionDate: date, inTime: clock(inM), outTime: clock(inM + inLine) };
  });
}
const hours = (m: Map<string, number>, date: string) => (m.get(date) ?? 0) / 60;
const count = (slabs: DatedSlab[], date: string) => slabs.filter((s) => s.productionDate === date).length;
const rateOn = (slabs: DatedSlab[], date: string) => dailySlabsPerHour(count(slabs, date), lineMinutesByDate(slabs).get(date) ?? 0);

/* ── the owner's two rules ── */

test("a line that ran the whole day divides by 24", () => {
  // 193 slabs from 00:00 to midnight, the last one out at 23:59, one more slab
  // of the run coming out just after midnight on the next date.
  const slabs = [
    ...steady("2026-09-20", "00:00", "23:59", 193),
    { productionDate: "2026-09-20", inTime: "23:50", outTime: "00:08" },
  ];
  const m = lineMinutesByDate(slabs);
  assert.equal(m.get("2026-09-20"), 24 * 60, "exactly 24 hours — never more, even with a slab running past midnight");
  assert.equal(rateOn(slabs, "2026-09-20"), 8.1, "194 ÷ 24");
  assert.equal(dailySlabsPerHour(193, 24 * 60), 8, "193 ÷ 24 = 8.04");
});

test("the owner's example: 110 slabs, the line ran 07:00 → 20:00 → 110 ÷ 13 = 8.5, not ÷ 24", () => {
  const slabs = steady("2026-09-21", "07:00", "20:00", 110);
  assert.equal(hours(lineMinutesByDate(slabs), "2026-09-21"), 13);
  assert.equal(rateOn(slabs, "2026-09-21"), 8.5); // 8.46, one decimal like every Robo rate
  assert.notEqual(rateOn(slabs, "2026-09-21"), dailySlabsPerHour(110, 24 * 60), "the 11 stopped hours are not divided by");
});

test("delays are not subtracted: a slab held through a delay, or a short wait with the line empty, still counts", () => {
  const base = steady("2026-09-21", "07:00", "20:00", 110);
  // A 45-minute wait with nothing going in or out, mid-morning.
  const wait = base.map((s) => {
    const m = Number(s.inTime!.slice(0, 2)) * 60 + Number(s.inTime!.slice(3, 5));
    return m >= 10 * 60 && m < 10 * 60 + 45 ? null : s;
  }).filter((s): s is DatedSlab => s !== null);
  assert.equal(hours(lineMinutesByDate(wait), "2026-09-21"), 13, "a 45-minute empty-line delay is still running time");
  // A delay while slabs sat in the line: one slab held 1h 30m.
  const held = [...base, { productionDate: "2026-09-21", inTime: "12:00", outTime: "13:30" }];
  assert.equal(hours(lineMinutesByDate(held), "2026-09-21"), 13);
});

test("a stop longer than two hours is not running time (the 22 Sep power cut, 10:27 → 16:03)", () => {
  const slabs = [
    ...steady("2026-09-22", "07:00", "10:27", 30),
    ...steady("2026-09-22", "16:03", "20:00", 34),
  ];
  const h = hours(lineMinutesByDate(slabs), "2026-09-22");
  assert.equal(h, (10 * 60 + 27 - 7 * 60 + 20 * 60 - (16 * 60 + 3)) / 60, "3h 27m + 3h 57m, the 5h 36m cut left out");
  assert.equal(rateOn(slabs, "2026-09-22"), dailySlabsPerHour(64, 7.4 * 60));
  // The boundary itself: exactly QUIET_LIMIT_MINUTES counts, one minute more does not.
  const edge = (gap: number): DatedSlab[] => [
    { productionDate: "2026-09-22", inTime: "08:00", outTime: "08:20" },
    { productionDate: "2026-09-22", inTime: clock(8 * 60 + 20 + gap), outTime: clock(8 * 60 + 40 + gap) },
  ];
  assert.equal(lineMinutesByDate(edge(QUIET_LIMIT_MINUTES)).get("2026-09-22"), 40 + QUIET_LIMIT_MINUTES);
  assert.equal(lineMinutesByDate(edge(QUIET_LIMIT_MINUTES + 1)).get("2026-09-22"), 40);
});

/* ── dates, midnight, and the records the counts come from ── */

test("a run through midnight gives each date the hours that fell on it; slabs count on their Production Date", () => {
  // 22:00 → 02:00, the operator moving the date on at midnight as the form does.
  const slabs = [
    ...steady("2026-09-19", "22:00", "23:59", 12),
    { productionDate: "2026-09-19", inTime: "23:55", outTime: "00:10" }, // crossed midnight
    ...steady("2026-09-20", "00:05", "02:00", 12),
  ];
  const m = lineMinutesByDate(slabs);
  assert.equal(m.get("2026-09-19"), 120, "22:00 → 24:00");
  assert.equal(m.get("2026-09-20"), 120, "00:00 → 02:00 — from midnight, the line never stopped");
  assert.equal(count(slabs, "2026-09-19"), 13);
  assert.equal(rateOn(slabs, "2026-09-19"), 6.5);
  assert.equal(rateOn(slabs, "2026-09-20"), 6);
  // A single slab In 23:30, Out 00:30: its hour in the line is half on each date.
  const lone = lineMinutesByDate([{ productionDate: "2026-09-19", inTime: "23:30", outTime: "00:30" }]);
  assert.deepEqual([lone.get("2026-09-19"), lone.get("2026-09-20")], [30, 30]);
});

test("the day before the window only lends its after-midnight running time, never slabs", () => {
  // The route reads the previous day's slabs too; only their minutes past
  // midnight land on the first date, and they are not in its count.
  const eve = [{ productionDate: "2026-09-18", inTime: "23:50", outTime: "00:30" }];
  const first = steady("2026-09-19", "00:20", "06:00", 40);
  const withEve = lineMinutesByDate([...eve, ...first]).get("2026-09-19");
  const without = lineMinutesByDate(first).get("2026-09-19");
  assert.equal(withEve, 6 * 60, "00:00 → 06:00");
  assert.equal(without, 6 * 60 - 20, "00:20 → 06:00 without the eve's slab");
  assert.equal(count([...eve, ...first], "2026-09-19"), 40);
});

test("an Out typed before its In does not paint the next day as production", () => {
  // In 22:05, Out 22:00: the midnight rule reads it as coming out tomorrow at
  // 22:00. As a moment that is one isolated instant — not a day of running.
  const slabs = [
    ...steady("2026-08-31", "11:20", "22:31", 124),
    { productionDate: "2026-08-31", inTime: "22:05", outTime: "22:00" },
  ];
  const m = lineMinutesByDate(slabs);
  assert.equal(m.get("2026-08-31"), 11 * 60 + 11);
  assert.equal(m.get("2026-09-01"), undefined, "no phantom running time on 1 Sep");
});

test("a slab left in the line through a long stop does not make the stop running time", () => {
  const slabs = [
    ...steady("2026-09-10", "08:00", "12:00", 30),
    { productionDate: "2026-09-10", inTime: "11:50", outTime: "18:00" }, // held 6h through a stop
    ...steady("2026-09-10", "18:00", "20:00", 16),
  ];
  assert.equal(hours(lineMinutesByDate(slabs), "2026-09-10"), 6, "08:00–12:00 and 18:00–20:00");
});

test("slabs with no times still count; a date with no running time reads 0, never a division by zero", () => {
  const slabs: DatedSlab[] = [
    ...steady("2026-09-10", "08:00", "10:00", 20),
    { productionDate: "2026-09-10", inTime: null, outTime: null },
    { productionDate: "2026-09-10", inTime: "09:30", outTime: null }, // still in the line
  ];
  assert.equal(count(slabs, "2026-09-10"), 22, "the count is every record of the date, as Slab Records lists them");
  assert.equal(hours(lineMinutesByDate(slabs), "2026-09-10"), 2);
  assert.equal(rateOn(slabs, "2026-09-10"), 11);
  assert.equal(dailySlabsPerHour(5, 0), 0);
  assert.equal(dailySlabsPerHour(0, 600), 0);
  assert.equal(dailySlabsPerHour(Number.NaN, 600), 0);
  assert.deepEqual(lineMinutesByDate([{ productionDate: null, inTime: "10:00", outTime: "10:20" }]), new Map());
});

/* ── the real registers ── */

const REGISTER = JSON.parse(readFileSync(new URL("./fixtures/robo-register-d1448-d1449.json", import.meta.url), "utf8")) as
  Record<string, [string, string, string, string][]>;
const real: DatedSlab[] = ["D-1448", "D-1449"].flatMap((b) =>
  REGISTER[b].map(([, productionDate, inTime, outTime]) => ({ productionDate, inTime, outTime })));

test("REAL REGISTERS D-1448 + D-1449: every date between 6 and 10 slabs/hour, a full day ÷ 24", () => {
  // Only these two batches' slabs — on the ERP each date also has its other
  // batches — but every figure below is what the rule gives for them.
  const m = lineMinutesByDate(real);
  const per = (date: string) => ({ slabs: count(real, date), hours: Math.round(hours(m, date) * 100) / 100, rate: rateOn(real, date) });
  assert.deepEqual(per("2026-09-20"), { slabs: 193, hours: 24, rate: 8 }, "20 Sep ran all day: 193 ÷ 24");
  assert.deepEqual(per("2026-09-21"), { slabs: 147, hours: 17.92, rate: 8.2 }, "stopped from 17:55");
  assert.deepEqual(per("2026-09-22"), { slabs: 110, hours: 15.5, rate: 7.1 }, "the 5h 36m power cut left out, the 87-minute delay kept");
  assert.deepEqual(per("2026-09-23"), { slabs: 113, hours: 13.6, rate: 8.3 }, "08:00 → 21:36");
  for (const date of ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]) {
    const r = rateOn(real, date);
    assert.ok(r >= 6 && r <= 10, `${date}: ${r} slabs/hour`);
  }
});

/* ── the axis ── */

test("the Y-axis is 0, 2, 4, 6, 8, 10 — extended in 2s only when a date really tops 10", () => {
  assert.deepEqual(dailyRateYAxis(0), { max: 10, ticks: [0, 2, 4, 6, 8, 10] });
  assert.deepEqual(dailyRateYAxis(8.5), { max: 10, ticks: [0, 2, 4, 6, 8, 10] });
  assert.deepEqual(dailyRateYAxis(10), { max: 10, ticks: [0, 2, 4, 6, 8, 10] });
  assert.deepEqual(dailyRateYAxis(11.3), { max: 12, ticks: [0, 2, 4, 6, 8, 10, 12] }, "a fast day is drawn, not cut off");
  assert.deepEqual(dailyRateYAxis(Number.NaN), { max: 10, ticks: [0, 2, 4, 6, 8, 10] });
});

/* ── the wiring ── */

test("the trends route: the rate from the slabs' own times, the other two series exactly as they were", () => {
  const src = readFileSync(new URL("../src/app/api/robo/reports/trends/route.ts", import.meta.url), "utf8");
  // The divisor is the line's running time — nothing from the shift rows.
  assert.ok(!/roboShift|shiftMinutes|nowMins/.test(src), "no shift-row time anywhere in the rate");
  assert.match(src, /slabsPerHour: dailySlabsPerHour\(b\.slabs, minutes\)/);
  assert.match(src, /lineMinutesByDate\(\s*records\.map\(\(r\) => \(\{ productionDate: productionDateOf\(r\), inTime: r\.inTime, outTime: r\.outTime \}\)\)/);
  // Daily Production Trend and Day-wise Delay Analysis: the same counting, the
  // same fields, untouched.
  assert.match(src, /const b = buckets\[productionDateOf\(r\)\];\s*if \(b\) b\.slabs \+= 1;/);
  assert.match(src, /const b = buckets\[delayProductionDateOf\(d\)\];\s*if \(b\) b\.delayMins \+= d\.durationMinutes;/);
  assert.match(src, /slabs: b\.slabs,\s*delayMins: b\.delayMins,/);
  // Delays are still read for the window's own dates only.
  assert.match(src, /\{ productionRecord: \{ productionDate: window \} \}/);
});
