import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSlabLoss, sqftFromSqMm, sqftFromInches,
  STANDARD_SLAB_INCHES, STANDARD_SLAB_MM, SQ_MM_PER_SQ_FT, INCH_TO_MM,
} from "../src/lib/fab/slabLoss.ts";

// FabRequirement.length/width are INCHES. FabSlab.length/width are MILLIMETRES.
// Nothing in the schema says so, and multiplying one by the other produces a
// number 25.4x too small — which reads as a slab that is 96% wasted, plausible
// enough that nobody would question it. These tests exist for that.

/* -- The conversion itself -------------------------------------------------- */

test("a square foot is 92,903.04 mm², and the standard slab is 75.16 sqft", () => {
  assert.equal(SQ_MM_PER_SQ_FT, INCH_TO_MM * INCH_TO_MM * 144);
  assert.equal(Math.round(SQ_MM_PER_SQ_FT * 100) / 100, 92903.04);

  // 137 x 79 inches, the standard Pacific slab, however you spell it.
  assert.equal(STANDARD_SLAB_MM.lengthMm, 3479.8);
  assert.equal(STANDARD_SLAB_MM.widthMm, 2006.6);
  const fromInches = sqftFromInches(STANDARD_SLAB_INCHES.lengthIn, STANDARD_SLAB_INCHES.widthIn);
  const fromMm = sqftFromSqMm(STANDARD_SLAB_MM.lengthMm * STANDARD_SLAB_MM.widthMm);
  assert.ok(Math.abs(fromInches - fromMm) < 1e-9, `${fromInches} vs ${fromMm}`);
  assert.equal(Math.round(fromInches * 100) / 100, 75.16);
});

test("the slab comes out the same size whether it is given in mm or its inch equivalent", () => {
  const pieces = [{ lengthIn: 25, widthIn: 22.5, quantity: 10 }];

  const asStored = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces,
  });
  assert.equal(asStored.slabAreaSqft, 75.16);

  // THE LANDMINE. Handing the inch numbers straight to a mm parameter — the
  // mistake three route files are one copy-paste away from — does not produce a
  // slightly wrong answer, it produces a slab the size of a dinner plate.
  const mistaken = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_INCHES.lengthIn,
    slabWidthMm: STANDARD_SLAB_INCHES.widthIn,
    pieces,
  });
  assert.equal(mistaken.slabAreaSqft, 0.12);
  assert.ok(mistaken.overCommitted, "which is why the result says so out loud");
  // Out by exactly 25.4² = 645.16, measured before rounding flattens it.
  const ratio =
    sqftFromInches(STANDARD_SLAB_INCHES.lengthIn, STANDARD_SLAB_INCHES.widthIn) /
    sqftFromSqMm(STANDARD_SLAB_INCHES.lengthIn * STANDARD_SLAB_INCHES.widthIn);
  assert.ok(Math.abs(ratio - 645.16) < 1e-9, `${ratio}`);
});

test("the 3200 x 1600 mm slab allocate-requirement actually writes is 55.11 sqft", () => {
  const out = computeSlabLoss({ slabLengthMm: 3200, slabWidthMm: 1600, pieces: [] });
  assert.equal(out.slabAreaSqft, 55.11);
  assert.equal(out.usedAreaSqft, 0);
  assert.equal(out.remainingAreaSqft, 55.11);
  assert.equal(out.totalWastagePct, 100);
  assert.equal(out.trueScrapPct, 100);
});

/* -- The sum ---------------------------------------------------------------- */

test("used, remaining and wastage for a normally-loaded slab", () => {
  // 10 pieces of 25 x 22.5 in = 39.06 sqft off a 75.16 sqft slab.
  const out = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [{ lengthIn: 25, widthIn: 22.5, quantity: 10 }],
  });

  assert.equal(out.slabAreaSqft, 75.16);
  assert.equal(out.usedAreaSqft, 39.06);          // 25 * 22.5 * 10 / 144 = 39.0625
  assert.equal(out.remainingAreaSqft, 36.1);      // 75.16 - 39.06
  assert.equal(out.totalWastagePct, 48.03);       // 36.1 / 75.16
  assert.equal(out.trueScrapPct, 48.03);          // nothing reclaimed, so identical
  assert.equal(out.overCommitted, false);

  // used + remaining is the whole slab, with no rounding leak.
  assert.equal(out.usedAreaSqft + out.remainingAreaSqft, out.slabAreaSqft);
});

test("several piece types on one slab add up, and quantity multiplies", () => {
  const out = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [
      { lengthIn: 25, widthIn: 22.5, quantity: 10 }, // 39.0625
      { lengthIn: 25, widthIn: 4, quantity: 10 },    //  6.9444
      { lengthIn: 43, widthIn: 4, quantity: 5 },     //  5.9722
    ],
  });
  assert.equal(out.usedAreaSqft, 51.98);
  assert.equal(out.remainingAreaSqft, 23.18);
  assert.equal(out.totalWastagePct, 30.84);

  // The order pieces were assigned in cannot change the answer — the sum is
  // taken at full precision and rounded once, at the end.
  const reordered = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [
      { lengthIn: 43, widthIn: 4, quantity: 5 },
      { lengthIn: 25, widthIn: 22.5, quantity: 10 },
      { lengthIn: 25, widthIn: 4, quantity: 10 },
    ],
  });
  assert.deepEqual(reordered, out);

  // Rounding ONCE is the point: 39.0625 + 6.9444 + 5.9722 = 51.9792 -> 51.98,
  // whereas rounding each row first gives 39.06 + 6.94 + 5.97 = 51.97. A caller
  // that wants a per-row breakdown and a total must take the total from here,
  // not add up the rows it displayed.
  assert.equal(Math.round((39.06 + 6.94 + 5.97) * 100) / 100, 51.97);
  assert.equal(out.usedAreaSqft, 51.98);
});

test("an empty slab is 100% wasted, and a full one is 0%", () => {
  const empty = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm, slabWidthMm: STANDARD_SLAB_MM.widthMm, pieces: [],
  });
  assert.equal(empty.usedAreaSqft, 0);
  assert.equal(empty.totalWastagePct, 100);

  // One piece the exact size of the slab: 137 x 79 inches.
  const full = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [{ lengthIn: 137, widthIn: 79, quantity: 1 }],
  });
  assert.equal(full.usedAreaSqft, 75.16);
  assert.equal(full.remainingAreaSqft, 0);
  assert.equal(full.totalWastagePct, 0);
  assert.equal(full.overCommitted, false, "exactly full is not over-committed");
});

/* -- Reclaimed offcuts, and the difference between wastage and scrap --------- */

test("a reclaimed offcut is wastage but not scrap", () => {
  const base = {
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [{ lengthIn: 25, widthIn: 22.5, quantity: 10 }],
  };

  // 20 of the 36.1 leftover sqft go back on the rack as a residual piece.
  const out = computeSlabLoss({ ...base, reclaimedAreaSqft: 20 });
  assert.equal(out.totalWastagePct, 48.03, "the slab still only yielded 39.06 sqft of product");
  assert.equal(out.trueScrapPct, 21.42, "but only 16.1 sqft actually went in the bin");
  assert.equal(out.reclaimedAreaSqft, 20);
  assert.ok(out.trueScrapPct < out.totalWastagePct);

  // Reclaiming everything leaves no scrap at all.
  const allBack = computeSlabLoss({ ...base, reclaimedAreaSqft: 36.1 });
  assert.equal(allBack.trueScrapPct, 0);
  assert.equal(allBack.totalWastagePct, 48.03);

  // Nothing reclaimed — the default — means the two are the same number.
  for (const reclaimed of [undefined, null, 0, -5]) {
    const o = computeSlabLoss({ ...base, reclaimedAreaSqft: reclaimed });
    assert.equal(o.trueScrapPct, o.totalWastagePct, `reclaimed=${reclaimed}`);
    assert.equal(o.reclaimedAreaSqft, 0);
  }
});

/* -- The awkward inputs ----------------------------------------------------- */

test("over-committing a slab is reported, not clamped away", () => {
  // 40 pieces of 25 x 22.5 is 156.25 sqft — more than twice the slab.
  const out = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [{ lengthIn: 25, widthIn: 22.5, quantity: 40 }],
  });
  assert.equal(out.usedAreaSqft, 156.25);
  assert.equal(out.overCommitted, true);
  // Signed on purpose. Clamping at 0 would turn "you assigned twice what fits"
  // into "this slab was fully used", which is a lie that outlives the mistake.
  assert.ok(out.remainingAreaSqft < 0, `${out.remainingAreaSqft}`);
  assert.ok((out.totalWastagePct ?? 0) < 0);
});

test("no slab dimensions means the percentages are unknown, not zero", () => {
  for (const slab of [
    { slabLengthMm: null, slabWidthMm: null },
    { slabLengthMm: 3479.8, slabWidthMm: 0 },
    { slabLengthMm: undefined, slabWidthMm: 2006.6 },
    { slabLengthMm: NaN, slabWidthMm: 2006.6 },
    { slabLengthMm: -3479.8, slabWidthMm: 2006.6 },
  ]) {
    const out = computeSlabLoss({ ...slab, pieces: [{ lengthIn: 25, widthIn: 22.5, quantity: 10 }] });
    assert.equal(out.slabAreaSqft, 0, JSON.stringify(slab));
    assert.equal(out.totalWastagePct, null, JSON.stringify(slab));
    assert.equal(out.trueScrapPct, null, JSON.stringify(slab));
    assert.equal(out.overCommitted, false, "unknown is not over-committed");
    // The used area is still knowable and still reported.
    assert.equal(out.usedAreaSqft, 39.06);
  }
});

test("missing and junk piece values contribute nothing rather than NaN", () => {
  const out = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [
      { lengthIn: 25, widthIn: 22.5, quantity: 10 },
      { lengthIn: null, widthIn: 22.5, quantity: 10 },
      { lengthIn: 25, widthIn: undefined, quantity: 10 },
      { lengthIn: 25, widthIn: 22.5, quantity: null },
      { lengthIn: NaN, widthIn: 22.5, quantity: 10 },
      { lengthIn: -25, widthIn: 22.5, quantity: 10 },
    ],
  });
  assert.equal(out.usedAreaSqft, 39.06, "only the one real row counts");
  assert.ok(Number.isFinite(out.totalWastagePct ?? NaN));
});

/* -- What gets persisted ---------------------------------------------------- */

test("the result maps one-for-one onto the three fab_slab_job columns", () => {
  const out = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [{ lengthIn: 25, widthIn: 22.5, quantity: 10 }],
    reclaimedAreaSqft: 20,
  });

  // used_area_sqft, total_wastage_pct, true_scrap_pct — three nullable Floats
  // that nothing in the app writes today. Nothing is written here either; this
  // pins the shape so the write is a one-liner when the UI exists.
  const row = {
    usedAreaSqft: out.usedAreaSqft,
    totalWastagePct: out.totalWastagePct,
    trueScrapPct: out.trueScrapPct,
  };
  assert.deepEqual(row, { usedAreaSqft: 39.06, totalWastagePct: 48.03, trueScrapPct: 21.42 });

  // Every value is a Float or null — no strings, no undefined, nothing Prisma
  // would reject or quietly store as null.
  for (const [k, v] of Object.entries(row)) {
    assert.ok(v === null || typeof v === "number", `${k} is ${typeof v}`);
    if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} is ${v}`);
  }

  // 2dp everywhere: the shop quotes wastage to one decimal and the column is a
  // Float, so more precision than this is float noise pretending to be data.
  for (const v of Object.values(row)) {
    if (typeof v === "number") assert.equal(v, Math.round(v * 100) / 100);
  }
});
