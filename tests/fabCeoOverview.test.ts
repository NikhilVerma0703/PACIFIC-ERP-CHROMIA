import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupByProject, overviewTotals, sqftFromSqMm,
  SQ_MM_PER_SQ_FT, HIGH_WASTE_PCT,
  type CeoSlabWastage,
} from "../src/lib/fab/ceoOverview.ts";

// The four rows on the dashboard on 25 Aug 2026, exactly as /api/fab/ceo
// reported them. Slab 146837 appears TWICE, on two different projects — the
// same stone assigned to both, which is what made the flat table look like it
// held a duplicate.
const SQFT = SQ_MM_PER_SQ_FT;
const slab = (
  slabCode: string, projectCode: string, pieceCount: number,
  areaSqft: number, usedSqft: number,
): CeoSlabWastage => ({
  slabId: `${projectCode}:${slabCode}:${pieceCount}`,
  slabCode, projectCode, pieceCount,
  slabAreaMm2: areaSqft * SQFT,
  piecesAreaMm2: usedSqft * SQFT,
  wastePct: 0,   // recomputed from area — never trusted
});

const LIVE: CeoSlabWastage[] = [
  slab("146837", "1001", 20, 75.16, 65.07),   // 13.4%
  slab("146838", "TEst", 65, 75.16, 68.54),   //  8.8%
  slab("146837", "TEst", 17, 75.16, 74.38),   //  1.0%
  slab("146820", "1001", 17, 75.16, 74.38),   //  1.0%
];

test("area: mm² converts once, here, not in a template", () => {
  assert.equal(SQ_MM_PER_SQ_FT, 92903.04);
  assert.equal(Math.round(sqftFromSqMm(75.16 * SQFT) * 100) / 100, 75.16);
  for (const v of [0, -1, NaN, Infinity, null, undefined]) {
    assert.equal(sqftFromSqMm(v as number), 0, String(v));
  }
});

test("THE SAME SLAB ON TWO PROJECTS IS TWO ENTRIES, not a duplicate", () => {
  // 146837 is on 1001 (20 pcs) and on TEst (17 pcs). Deduplicating by slab code
  // would hide one project's consumption inside the other's.
  const projects = groupByProject(LIVE);
  assert.deepEqual(projects.map(p => p.projectCode).sort(), ["1001", "TEst"]);

  const p1001 = projects.find(p => p.projectCode === "1001")!;
  const pTest = projects.find(p => p.projectCode === "TEst")!;
  assert.ok(p1001.slabs.some(s => s.slabCode === "146837"));
  assert.ok(pTest.slabs.some(s => s.slabCode === "146837"));
  assert.equal(p1001.slabCount, 2);
  assert.equal(pTest.slabCount, 2);
  // Every slab survives the grouping — nothing is merged away.
  assert.equal(projects.reduce((n, p) => n + p.slabCount, 0), LIVE.length);
});

test("per-slab figures match what the flat table showed", () => {
  const p1001 = groupByProject(LIVE).find(p => p.projectCode === "1001")!;
  const worst = p1001.slabs[0];
  assert.equal(worst.slabCode, "146837");
  assert.equal(worst.slabAreaSqft, 75.16);
  assert.equal(worst.usedSqft, 65.07);
  assert.equal(worst.wasteSqft, 10.09);
  assert.equal(worst.wastePct, 13.4);
  assert.equal(worst.highWaste, false, "13.4% is under the 20% line");
});

test("AVG WASTAGE: the two averages COINCIDE while every slab is the same size", () => {
  // Worth pinning, because it is why nobody has noticed the difference yet.
  // All four live slabs are 75.16 sqft, so weighting by area changes nothing:
  //   mean of percentages  (13.4 + 8.8 + 1 + 1) / 4        = 6.1%
  //   waste over area      18.27 / 300.64                  = 6.1%
  const totals = overviewTotals(groupByProject(LIVE));
  assert.equal(totals.meanSlabWastePct, 6.1);
  assert.equal(totals.wastePct, 6.1);

  // And the area figures add up, because they are summed before rounding.
  assert.equal(totals.slabAreaSqft, 300.64);
  assert.equal(totals.usedSqft, 282.37);
  assert.equal(totals.wasteSqft, 18.27);
  assert.equal(Math.round((totals.usedSqft + totals.wasteSqft) * 100) / 100, totals.slabAreaSqft);
});

test("AVG WASTAGE: they DIVERGE the moment slab sizes differ", () => {
  // The case the weighting exists for. A 100 sqft slab half wasted beside a
  // 10 sqft offcut barely touched:
  //   mean of percentages  (50 + 10) / 2      = 30.0%   <- flatters the shop
  //   waste over area      51 / 110           = 46.4%   <- what it actually lost
  // Only the second survives being multiplied by a rate, which is why it is the
  // one that goes beside a rupee figure.
  const uneven = groupByProject([
    slab("BIG",   "P", 4, 100, 50),
    slab("SMALL", "P", 1,  10,  9),
  ]);
  const t = overviewTotals(uneven);
  assert.equal(t.meanSlabWastePct, 30);
  assert.equal(t.wastePct, 46.4);
  assert.ok(t.wastePct > t.meanSlabWastePct, "the mean understated the loss");
});

test("the tiles equal the sum of what is under them", () => {
  const projects = groupByProject(LIVE);
  const totals = overviewTotals(projects);
  assert.equal(totals.slabCount, 4);
  assert.equal(totals.pieceCount, 119, "the dashboard's Total Pieces");
  assert.equal(totals.projectCount, 2);
  // A tile that disagrees with its own tree is the bug this asserts against.
  assert.equal(totals.pieceCount, projects.reduce((n, p) => n + p.pieceCount, 0));
  assert.equal(totals.slabCount, projects.reduce((n, p) => n + p.slabs.length, 0));
  assert.equal(totals.highWasteSlabs, 0, "nothing over 20% in this data");
});

test("worst first, at both levels — that is the row a CEO opens", () => {
  const projects = groupByProject(LIVE);
  for (let i = 1; i < projects.length; i++) {
    assert.ok(projects[i - 1].wastePct >= projects[i].wastePct);
  }
  for (const p of projects) {
    for (let i = 1; i < p.slabs.length; i++) {
      assert.ok(p.slabs[i - 1].wastePct >= p.slabs[i].wastePct, p.projectCode);
    }
  }
});

test("the 20% line is ONE constant, so a tile cannot disagree with a badge", () => {
  assert.equal(HIGH_WASTE_PCT, 20);
  const bad = groupByProject([
    slab("S1", "P", 1, 100, 79),    // 21% — over
    slab("S2", "P", 1, 100, 80),    // 20% — exactly on the line, NOT over
  ]);
  assert.equal(bad[0].highWasteSlabs, 1);
  assert.equal(bad[0].slabs.filter(s => s.highWaste).length, 1);
  assert.equal(overviewTotals(bad).highWasteSlabs, 1);
});

test("an over-committed slab never produces negative waste in a total", () => {
  // Over-commitment is a real state (more assigned than the slab holds), but
  // "-3 sqft of waste" inside a sum is worse than nothing.
  const over = groupByProject([slab("S1", "P", 10, 75.16, 80)]);
  assert.equal(over[0].slabs[0].wasteSqft, 0);
  assert.equal(over[0].slabs[0].wastePct, 0);
  assert.ok(overviewTotals(over).wasteSqft >= 0);
});

test("empty and junk input produce an empty board, not a crash", () => {
  assert.deepEqual(groupByProject([]), []);
  assert.deepEqual(groupByProject(null as never), []);
  const t = overviewTotals([]);
  assert.equal(t.slabCount, 0);
  assert.equal(t.wastePct, 0);
  assert.equal(t.meanSlabWastePct, 0);
  // A slab with no project still has to appear somewhere.
  const orphan = groupByProject([slab("S1", "", 3, 75.16, 70)]);
  assert.equal(orphan[0].projectCode, "(no project)");
  assert.equal(orphan[0].pieceCount, 3);
});

test("a slab with no usable area is 0%, not a division by zero", () => {
  const zero = groupByProject([slab("S1", "P", 5, 0, 0)]);
  assert.equal(zero[0].slabs[0].wastePct, 0);
  assert.equal(zero[0].wastePct, 0);
  assert.equal(overviewTotals(zero).wastePct, 0);
});
