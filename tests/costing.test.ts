// Pins src/lib/costing/compute.ts to the Simply White costing sheet - the
// 747-slab batch costed at ₹1,57,11,096 in August 2026. Every derived figure
// below is the sheet's PRINTED number, so a change that shifts any of them is
// a change to the costing method, not a refactor.
//
// Line quantities are the sheet's, and each line's rate is derived as
// amount ÷ quantity rather than copied, because the sheet's own amounts embed
// unrounded source quantities (26,831 kg × ₹161 is ₹4,319,791, but the sheet
// prints ₹43,19,871 - its true quantity had decimals the PDF does not show).
// Deriving the rate reproduces the amounts exactly, which is what makes the
// whole downstream chain - allocation, conversion, USD - assertable to the
// paisa instead of "roughly".

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeSheet, varianceLines, type ConversionBasis, type MaterialLine, type OutputSplit,
} from "../src/lib/costing/compute.ts";

const line = (
  group: MaterialLine["group"], item: string, basis: string,
  qty: number, unit: "kg" | "t", amount: number, estimated = false,
): MaterialLine => ({ group, item, basis, qty, unit, rate: amount / qty, estimated });

// The sheet's material table, amount-exact (see header).
const MATERIALS: MaterialLine[] = [
  line("resin", "Resin", "Aypols — 66 of 103 cycles", 26831, "kg", 4319871, true),
  line("resin", "Resin", "3n Composits (Orson) — 37 cycles", 15042, "kg", 2181076, true),
  line("pigment", "TiO₂", "9.14 kg × 279 mixer-cycles", 2549, "kg", 790230),
  line("chemical", "Silane", "dosed on resin", 508.46, "kg", 213553),
  line("chemical", "Cobalt", "dosed on resin", 35.89, "kg", 13100),
  line("chemical", "Catalyst", "1% of resin weight", 418.73, "kg", 224023),
  line("grit", "Grit 0.1 – 0.4 sm", "silos 103, 202", 107.943, "t", 1151478),
  line("grit", "Grit 0.3 – 0.7 sm", "silo 102", 43.495, "t", 477575),
  line("grit", "Grit 0.6 – 1.2 pm", "silo 104", 91.141, "t", 1347064),
  line("grit", "Grit 1.2 – 2.5 pm", "silos 204, 205", 14.442, "t", 213095),
  line("filler", "Filler 400# pm", "Filler A · Buffer B", 125.543, "t", 1569156),
];

const OUTPUT: OutputSplit = { slabs3cm: 514, slabs2cm: 233, runHours: 60 };

const BASIS: ConversionBasis = {
  manpowerPerMonth: 9_000_000,
  electricityPerMonth: 6_000_000,
  polishPerSqft: 10,
  packingPerSqft: 25,
  sqftPerSlab: 75,
  inrPerUsd: 95,
  daysPerMonth: 30,
};

test("costing: material sub-totals and total match the sheet", () => {
  const s = computeSheet(MATERIALS, OUTPUT, BASIS);
  assert.equal(s.material.resinAndChemicalsTotal, 7_741_853);
  assert.equal(s.material.gritAndFillerTotal, 4_758_368);
  assert.equal(s.material.total, 12_500_221);
  assert.equal(s.material.gritAndFillerTonnes, 382.56);
});

test("costing: group shares match the sheet's percentages", () => {
  const s = computeSheet(MATERIALS, OUTPUT, BASIS);
  const byLabel = Object.fromEntries(s.material.shares.map((x) => [x.label, x]));
  assert.equal(byLabel["Resin (both suppliers)"].amount, 6_500_947);
  assert.equal(byLabel["Resin (both suppliers)"].pct, 52.01);
  assert.equal(byLabel["Grit (four sizes)"].amount, 3_189_212);
  assert.equal(byLabel["Filler 400#"].amount, 1_569_156);
  assert.equal(byLabel["TiO2 (pigment)"].amount, 790_230);
  assert.equal(byLabel["Catalyst, silane, cobalt"].amount, 450_676);
  const pctSum = s.material.shares.reduce((t, x) => t + x.pct, 0);
  assert.ok(Math.abs(pctSum - 100) < 0.1, `shares sum to ${pctSum}`);
});

test("costing: 3 cm equivalents and the allocation check", () => {
  const s = computeSheet(MATERIALS, OUTPUT, BASIS);
  assert.equal(s.output.totalSlabs, 747);
  assert.equal(s.output.equivalent3cm, 669.33);
  assert.equal(s.output.materialPerEquivalent, 18_675.63);
  assert.equal(s.output.materialPer2cm, 12_450.42);
  // The sheet prints these truncated to whole rupees (95,99,273 / 29,00,948);
  // the paise here are the untruncated values that tie back exactly.
  assert.equal(s.output.allocatedTo3cm, 9_599_273.3);
  assert.equal(s.output.allocatedTo2cm, 2_900_947.7);
  // The tie-back: allocation must return the material total, bar rounding.
  assert.ok(Math.abs(s.output.allocationGap) < 1, `gap ₹${s.output.allocationGap}`);
});

test("costing: conversion heads absorb the mixer run length", () => {
  const s = computeSheet(MATERIALS, OUTPUT, BASIS);
  assert.equal(s.conversion.runDays, 2.5);
  const byHead = Object.fromEntries(s.conversion.heads.map((h) => [h.head, h.perSlab]));
  assert.equal(byHead.Polishing, 750);
  assert.equal(byHead.Packing, 1875);
  assert.equal(byHead.Manpower, 1_004.02);
  assert.equal(byHead.Electricity, 669.34);
  assert.equal(s.conversion.perSlab, 4_298.36);
});

test("costing: final per-slab, per-sqft and USD figures match the sheet", () => {
  const s = computeSheet(MATERIALS, OUTPUT, BASIS);
  assert.equal(s.final.perSlab3cm, 22_973.99);
  assert.equal(s.final.perSlab2cm, 16_748.78);
  assert.equal(s.final.perSqft3cm, 306.32);
  assert.equal(s.final.perSqft2cm, 223.32);
  assert.equal(s.final.perSqftUsd3cm, 3.2244);
  assert.equal(s.final.perSqftUsd2cm, 2.3507);
  assert.equal(s.final.conversionTotal, 3_210_874.92);
  assert.equal(s.final.batchTotal, 15_711_095.92);
});

test("costing: estimated lines keep their flag through pricing", () => {
  const s = computeSheet(MATERIALS, OUTPUT, BASIS);
  const resin = s.material.resinAndChemicals.filter((l) => l.group === "resin");
  assert.equal(resin.length, 2);
  assert.ok(resin.every((l) => l.estimated), "resin split is an estimate and must say so");
  assert.ok(!s.material.resinAndChemicals.find((l) => l.item === "TiO₂")?.estimated);
});

test("variance: the silo-swap signature - quantity moves, net stays put", () => {
  // The sheet's own catch: 2.81 t booked to 0.1-0.4 that the mixer records
  // put under 0.3-0.7, because silos 103 and 102 swapped slots mid-run.
  const v = varianceLines([
    { item: "Grit 0.1 – 0.4", primaryQty: 107.943, checkQty: 105.130, unit: "t", rate: 10_955 },
    { item: "Grit 0.3 – 0.7", primaryQty: 43.495, checkQty: 46.308, unit: "t", rate: 10_980 },
    { item: "Grit 0.6 – 1.2", primaryQty: 91.141, checkQty: 91.141, unit: "t", rate: 14_780 },
  ]);
  assert.equal(v.lines.length, 2, "the untouched size must not appear");
  assert.equal(v.lines[0].delta, -2.81);
  assert.equal(v.lines[1].delta, 2.81);
  // Moved between lines, not lost: net delta is zero tonnes.
  assert.ok(Math.abs(v.netDeltaTonnes) < 0.01);
  assert.ok(v.totalAbsEffect > 0);
});

test("variance: sub-threshold rounding noise is not a finding", () => {
  const v = varianceLines([
    { item: "Filler", primaryQty: 125.543, checkQty: 125.549, unit: "t", rate: 12_499 },
  ]);
  assert.equal(v.lines.length, 0);
});

test("costing: zero output does not divide by zero", () => {
  const s = computeSheet(MATERIALS, { slabs3cm: 0, slabs2cm: 0, runHours: 0 }, BASIS);
  assert.equal(s.output.materialPerEquivalent, 0);
  assert.equal(s.conversion.heads.find((h) => h.head === "Manpower")?.perSlab, 0);
  assert.equal(s.final.batchTotal, s.material.total);
});
