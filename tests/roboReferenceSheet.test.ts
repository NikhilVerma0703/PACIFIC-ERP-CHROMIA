import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  designMatchKey,
  isRobotDelayCode,
  latestProduced,
  compareProduced,
  robotDelaysByDuration,
  robotDelayPie,
  PIE_MAX_SLICES,
  type RobotDelayInput,
} from "../src/lib/robo/referenceSheet.ts";

const src = (p: string) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8");

/* ── designMatchKey — match on design, not thickness ─────────────────────── */

test("thickness is stripped so 2 cm and 3 cm of one design match", () => {
  assert.equal(designMatchKey("Costa 2 cm"), "costa");
  assert.equal(designMatchKey("Costa 3 cm"), "costa");
  assert.equal(designMatchKey("Costa 2 cm"), designMatchKey("Costa 3 cm"));
  // spacing and case do not matter, mm as well as cm, a stray trailing dot
  assert.equal(designMatchKey("costa 3cm"), "costa");
  assert.equal(designMatchKey("COSTA 18mm."), "costa");
});

test("designs that differ by name, not thickness, stay different", () => {
  assert.notEqual(designMatchKey("Bellagio Green"), designMatchKey("Bellagio Grey"));
  assert.equal(designMatchKey("Bellagio Green"), "bellagio green");
  assert.equal(designMatchKey("Bellagio Grey"), "bellagio grey");
});

test("a trailing number that is not a thickness is kept", () => {
  // no cm/mm unit → not a thickness, must not be dropped
  assert.equal(designMatchKey("Statuario 5"), "statuario 5");
  assert.notEqual(designMatchKey("Statuario 5"), designMatchKey("Statuario 7"));
});

test("null/blank design keys to empty string (no run can match it)", () => {
  assert.equal(designMatchKey(null), "");
  assert.equal(designMatchKey("   "), "");
});

/* ── designMatchKey — search is case-insensitive ─────────────────────────── */

test("design search ignores capitalisation entirely — every variant the owner listed", () => {
  const key = designMatchKey("Calcatta Gold");
  for (const v of [
    "calcatta gold", "CALCATTA GOLD", "CALCATTA gold", "calcatta GOLD", "Calcatta Gold",
    "cAlCaTtA gOlD", "  Calcatta   Gold ", "CALCATTA GOLD 2 cm",
  ]) {
    assert.equal(designMatchKey(v), key, `"${v}" should match "Calcatta Gold"`);
  }
});

/* ── isRobotDelayCode — robot delays are the C-codes (Section G) ──────────── */

test("robot delays are matched by C-code, not the stored category", () => {
  // C1…C20 are robot delays, whatever their stored category says
  for (const c of ["C1", "C4", "C7", "C13", "C20", "c1", " C2"]) {
    assert.equal(isRobotDelayCode(c), true, `${c} should be a robot code`);
  }
  // every other master section uses a different letter
  for (const c of ["RM1", "L2", "D1", "S1", "P2", "M9", "G1", "T1", "", "CAT"]) {
    assert.equal(isRobotDelayCode(c), false, `${c} should NOT be a robot code`);
  }
});

/* ── latestProduced — which batch is the design's latest ─────────────────── */

const at = (productionDate: string, inTime: string | null, createdAtMs = 0, batch = "") =>
  ({ productionDate, inTime, createdAtMs, batch });

test("the latest slab is by production date, then In time, then entry order", () => {
  assert.equal(latestProduced([at("2026-09-15", "23:00"), at("2026-09-16", "01:00")])!.inTime, "01:00",
    "a later date wins even with an earlier clock time");
  assert.equal(latestProduced([at("2026-09-16", "09:00"), at("2026-09-16", "14:30")])!.inTime, "14:30");
  assert.equal(latestProduced([at("2026-09-16", "14:30", 5, "old"), at("2026-09-16", "14:30", 9, "new")])!.batch, "new",
    "same date and time: the later-entered slab");
  assert.equal(latestProduced([]), null);
});

test("an undated slab never outranks a dated one", () => {
  assert.equal(latestProduced([at("", "23:59", 999, "undated"), at("2026-01-01", "00:01", 1, "dated")])!.batch, "dated");
  assert.ok(compareProduced(at("", "23:59"), at("2026-01-01", "00:01")) < 0);
});

test("D-1445 shape: setups typed 'calcatta gold' and 'CALCATTA GOLD' are one design, one latest batch", () => {
  // Both setups key the same, so both are the design's, and the latest slab of
  // EITHER picks the batch — which is then taken whole (see the parity guard).
  assert.equal(designMatchKey("calcatta gold"), designMatchKey("CALCATTA GOLD"));
  const slabs = [
    at("2026-09-15", "20:00", 1, "D-1445"), // typed "CALCATTA GOLD"
    at("2026-09-16", "10:00", 2, "D-1445"), // typed "calcatta gold" — the last shift
    at("2026-08-27", "21:50", 3, "D-1428"), // an older batch of the same design
  ];
  assert.equal(latestProduced(slabs)!.batch, "D-1445");
});

/* ── robotDelaysByDuration — one row per code, longest first ─────────────── */

const delay = (code: string, minutes: number, robos: string[] = [], category: string | null = null): RobotDelayInput =>
  ({ code, description: `desc ${code}`, category, minutes, robos });

test("the owner's example: C1 25 min, C5 30 min, C8 20 min → C5, C1, C8", () => {
  const rows = robotDelaysByDuration([delay("C1", 25), delay("C5", 30), delay("C8", 20)]);
  assert.deepEqual(rows.map((r) => [r.code, r.minutes]), [["C5", 30], ["C1", 25], ["C8", 20]]);
});

test("a code logged several times is ONE row: minutes summed, entries counted, Robos unioned", () => {
  const rows = robotDelaysByDuration([
    delay("C1", 12, ["Robo4"]), delay("C1", 25, ["Robo1"]), delay("C4", 30, ["Robo2"]),
  ]);
  const c1 = rows.find((r) => r.code === "C1")!;
  assert.equal(c1.minutes, 37, "12 + 25");
  assert.equal(c1.events, 2);
  assert.deepEqual(c1.robos, ["Robo1", "Robo4"], "in machine order");
  // C1 now totals 37 > C4's 30, so it leads — ordering is by TOTAL duration.
  assert.deepEqual(rows.map((r) => r.code), ["C1", "C4"]);
});

test("equal durations fall back to code order, so the table never reshuffles", () => {
  const rows = robotDelaysByDuration([delay("C8", 20), delay("C2", 20), delay("C13", 20)]);
  assert.deepEqual(rows.map((r) => r.code), ["C2", "C8", "C13"], "numeric, not text, order");
});

test("only robot delays are rows; the ROBOT category counts even on an odd code", () => {
  const rows = robotDelaysByDuration([
    delay("C3", 10), delay("M9", 50), delay("RM1", 40), delay("X1", 5, [], "ROBOT"),
  ]);
  assert.deepEqual(rows.map((r) => r.code).sort(), ["C3", "X1"]);
});

test("a delay with no usable duration adds nothing but is still counted as logged", () => {
  const rows = robotDelaysByDuration([delay("C1", Number.NaN), delay("C1", 15)]);
  assert.equal(rows[0].minutes, 15);
  assert.equal(rows[0].events, 2);
});

/* ── robotDelayPie — 1, 2, 3 slices, or the top 3 ────────────────────────── */

const row = (code: string, minutes: number) => ({ code, description: `desc ${code}`, minutes });

test("one robot delay type → one slice at 100%", () => {
  const p = robotDelayPie([row("C5", 30)]);
  assert.deepEqual(p.slices.map((s) => [s.code, s.pct]), [["C5", 100]]);
  assert.equal(p.totalTypes, 1);
  assert.equal(p.coveragePct, 100);
});

test("two types → two slices; three → three; shares of the pie add up", () => {
  const two = robotDelayPie([row("C5", 30), row("C1", 10)]);
  assert.deepEqual(two.slices.map((s) => [s.code, s.pct]), [["C5", 75], ["C1", 25]]);
  const three = robotDelayPie([row("C5", 30), row("C1", 25), row("C8", 20)]);
  assert.deepEqual(three.slices.map((s) => s.code), ["C5", "C1", "C8"]);
  assert.deepEqual(three.slices.map((s) => s.pct), [40, 33.3, 26.7]);
  assert.equal(three.coveragePct, 100, "nothing was cut");
});

test("more than three types → only the top 3 by duration, and it says how much they cover", () => {
  const rows = [row("C2", 3), row("C5", 30), row("C8", 20), row("C1", 25), row("C3", 5)];
  const p = robotDelayPie(rows);
  assert.equal(PIE_MAX_SLICES, 3);
  assert.deepEqual(p.slices.map((s) => s.code), ["C5", "C1", "C8"], "longest three, longest first");
  assert.deepEqual(p.slices.map((s) => s.pct), [40, 33.3, 26.7], "shares of the three shown");
  assert.equal(p.totalTypes, 5);
  assert.equal(p.coveragePct, 90.4, "75 of the 83 robot delay minutes");
  // The table keeps every row: the pie reads its input without reordering it.
  assert.deepEqual(rows.map((r) => r.code), ["C2", "C5", "C8", "C1", "C3"]);
});

test("a delay type with no recorded time cannot be a slice; none at all is an empty pie", () => {
  const p = robotDelayPie([row("C5", 30), row("C9", 0)]);
  assert.deepEqual(p.slices.map((s) => s.code), ["C5"]);
  assert.equal(p.totalTypes, 1);
  assert.deepEqual(robotDelayPie([]).slices, []);
});

/* ── THE PARITY GUARD — the four figures ARE Reports' figures ────────────── */
/* The owner's rule (2026-09-25): Total Slabs Produced, Total Production Time,
   Total Delays and Avg Slabs/hour on the Reference Sheet must be exactly what
   Reports shows for the batch, never a separate calculation. These read the
   source, because the way this breaks is someone adding arithmetic back in. */

test("the Reference Sheet takes its four figures from Reports' own function, for the batch", () => {
  const ref = src("lib/robo/referenceData.ts");
  assert.match(ref, /import \{ computeReportSummary \} from "@\/lib\/robo\/reportSummary"/);
  assert.match(ref, /import \{ resolveBatchRecipeIds \} from "@\/lib\/robo\/batchFilter"/,
    "the batch must be resolved by Reports' own batch filter");
  assert.match(ref, /computeReportSummary\(\{ batchIds \}\)/, "called for the batch, with no date filter");
  for (const f of ["totalSlabs", "productionTimeMinutes", "totalDelayMins", "avgSlabsPerHour"]) {
    assert.match(ref, new RegExp(`${f}: report\\.${f},`), `${f} must come straight from the Reports result`);
  }
  for (const own of ["productionSpanMinutes", "avgSlabsPerHour(", "avgSlabsPerHourNet", "mergedDelayMinutes"]) {
    assert.ok(!ref.includes(own), `referenceData.ts must not compute its own figures (found ${own})`);
  }
});

test("the Reports route and the Reference Sheet run ONE implementation", () => {
  const route = src("app/api/robo/reports/summary/route.ts");
  assert.match(route, /computeReportSummary\(\{ date, from, to, batchIds \}\)/);
  for (const inline of ["productionSpanMinutes", "roboProductionRecord.count", "avgSlabsPerHour("]) {
    assert.ok(!route.includes(inline), `the Reports route must not keep its own copy (found ${inline})`);
  }
  const shared = src("lib/robo/reportSummary.ts");
  assert.match(shared, /export async function computeReportSummary/);
  assert.match(shared, /avgSlabsPerHour\(totalSlabs, productionTimeMinutes\)/, "delays left in, as Reports defines it");
});
