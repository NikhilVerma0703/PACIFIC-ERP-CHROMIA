import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIM_UNITS, CM_PER_INCH, parseDimUnit, inchesToCm, cmToInches,
  formatDimension, orderedSizeLabel,
} from "../src/lib/fab/dimensions.ts";
import { describeShapeSize } from "../src/lib/fab/shape.ts";
import { priceRow } from "../src/lib/fab/pricing.ts";

// SHOW THE SIZE THE CUSTOMER WROTE; CHARGE THE FEET THE SAW CUT.
//
// The owner, on PI SAL-ORD/25-26/01200: "show like in the po and calculate the
// feet correctly, that's it."
//
// Those are two separate promises and this file keeps them apart:
//
//   1. every size on that purchase order reads back EXACTLY as printed
//   2. the money does not move by one paisa when a row is marked 'CM'
//
// The second is the one worth having a test for. dim_unit is a display hint and
// nothing else, and the day somebody "helpfully" makes pricing read it is the
// day a 500-piece row goes out at 2.54x.

// ── 1 · the unit ────────────────────────────────────────────────────────────

test("the two spellings, and nothing else", () => {
  assert.deepEqual([...DIM_UNITS], ["IN", "CM"]);
  assert.equal(CM_PER_INCH, 2.54);           // exact by definition since 1959
});

test("NULL is INCHES, and that is not the same as unknown", () => {
  // Every row written before scripts/0068 is an inch row. If NULL resolved to
  // anything else, every historical order would restate itself on screen the
  // moment 0068 ran.
  assert.equal(parseDimUnit(null), "IN");
  assert.equal(parseDimUnit(undefined), "IN");
  assert.equal(parseDimUnit(""), "IN");
  assert.equal(parseDimUnit("   "), "IN");
  assert.equal(parseDimUnit("IN"), "IN");
  assert.equal(parseDimUnit(0), "IN");
  assert.equal(parseDimUnit(false), "IN");
});

test("only a clean CM opts in", () => {
  assert.equal(parseDimUnit("CM"), "CM");
  assert.equal(parseDimUnit("cm"), "CM");
  assert.equal(parseDimUnit("  Cm "), "CM");
  // Near misses stay inches rather than guessing. The database refuses these
  // anyway (fab_requirement_dim_unit_ck), so this is the second lock.
  assert.equal(parseDimUnit("CMS"), "IN");
  assert.equal(parseDimUnit("centimetre"), "IN");
  assert.equal(parseDimUnit("MM"), "IN");
});

test("the conversion is a true round trip", () => {
  assert.equal(cmToInches(2.54), 1);
  assert.equal(inchesToCm(1), 2.54);
  // Lossy in floating point, which is exactly why display rounds.
  assert.notEqual(inchesToCm(cmToInches(103)), 103);
  assert.ok(Math.abs(inchesToCm(cmToInches(103)) - 103) < 1e-9);
});

// ── 2 · every size on PI 1200, exactly as the PO prints it ──────────────────

// The 36 lines of PI SAL-ORD/25-26/01200, in the document's own order. These
// are CENTIMETRES — established from the invoice's own SQMT column, which only
// reconciles to 544.681 on that reading (103 x 3 x 500 = 15.45 m2, and the PI
// states 15.450).
const PI1200_CM: Array<[number, number]> = [
  [120, 12], [120, 7],
  [103, 3], [103, 4], [103, 5], [103, 6], [103, 7], [103, 8], [103, 9],
  [103, 10], [103, 11], [103, 11.5], [103, 12], [103, 13], [103, 14],
  [88, 19.5], [101, 19.5], [126, 19.5], [151, 19.5], [176, 19.5], [220, 19.5],
  [220, 15],
  [88, 25], [101, 25], [126, 25], [151, 25], [176, 25], [220, 25],
  [88, 30], [101, 30], [126, 30], [151, 30], [220, 30],
  [220, 40], [220, 60],
  [220, 15],
];

test("all 36 PI 1200 sizes read back the way the customer wrote them", () => {
  for (const [cmL, cmW] of PI1200_CM) {
    // What the loader stores: centimetres converted to inches, 4dp — the same
    // rounding scripts/data-PI1200-desert-silk.sql applies.
    const lin = Math.round(cmToInches(cmL) * 1e4) / 1e4;
    const win = Math.round(cmToInches(cmW) * 1e4) / 1e4;

    const label = orderedSizeLabel(lin, win, "CM");
    assert.equal(
      label,
      `${cmL} × ${cmW} cm`,
      `stored ${lin} × ${win} in should read back as ${cmL} × ${cmW} cm`,
    );
  }
});

test("the awkward ones specifically", () => {
  // 103 cm -> 40.5512 in -> 103.000048 cm. Raw, that prints "103.000048 cm",
  // which is worse than the inches were.
  assert.equal(formatDimension(40.5512, "CM"), "103");
  // 3 cm -> 1.1811 in -> 2.999994 cm. Rounds UP to 3, not down to 2.99.
  assert.equal(formatDimension(1.1811, "CM"), "3");
  // A genuine half — must keep its decimal, not be flattened to 12 or 20.
  assert.equal(formatDimension(4.5276, "CM"), "11.5");
  assert.equal(formatDimension(7.6772, "CM"), "19.5");
  // The widest piece on the order.
  assert.equal(formatDimension(23.622, "CM"), "60");
});

// ── 3 · an inch row must not move at all ────────────────────────────────────

test("an inch row renders byte-identically to the old template literal", () => {
  // What the station screens did before 0068 was `${length} × ${width}`, which
  // is String() on each. Anything else here is a change to every existing order.
  for (const [l, w] of [[28, 22.5], [40.5512, 1.1811], [0.5, 100], [7, 7]]) {
    assert.equal(orderedSizeLabel(l, w, null), `${l} × ${w}`);
    assert.equal(orderedSizeLabel(l, w, "IN"), `${l} × ${w}`);
    assert.equal(orderedSizeLabel(l, w, undefined), `${l} × ${w}`);
  }
});

test("no unit is named on an inch row, and 'cm' is named on a cm row", () => {
  assert.equal(orderedSizeLabel(28, 22.5, "IN"), "28 × 22.5");
  assert.ok(orderedSizeLabel(40.5512, 1.1811, "CM")?.endsWith(" cm"));
});

test("the screen keeps its own glyph and its own placeholder", () => {
  // The project page prints "x", the queues print "×". Unifying them would be a
  // cosmetic diff across six files inside a change about money.
  assert.equal(orderedSizeLabel(28, 22.5, "IN", "x"), "28 x 22.5");
  // Null, not a dash — the callers disagree on em dash vs hyphen, so each keeps
  // the one it already showed.
  assert.equal(orderedSizeLabel(null, 22.5, "CM"), null);
  assert.equal(orderedSizeLabel(28, null, "CM"), null);
  assert.equal(orderedSizeLabel(undefined, undefined, "IN"), null);
  assert.equal(orderedSizeLabel(NaN, 5, "CM"), null);
  assert.equal(orderedSizeLabel(Infinity, 5, "CM"), null);
  // A string that Number() would swallow is still not a number.
  assert.equal(orderedSizeLabel("28", "22.5", "IN"), null);
});

// ── 4 · describeShapeSize keeps its old behaviour and gains the unit ────────

test("describeShapeSize with no unit is exactly what it always was", () => {
  assert.equal(describeShapeSize("RECTANGLE", { lengthIn: 28, widthIn: 22.5 }), "28 × 22.5 in");
  assert.equal(describeShapeSize("CIRCLE", { lengthIn: 24, widthIn: 24 }), "⌀ 24 in");
  assert.equal(describeShapeSize("OVAL", { lengthIn: 36, widthIn: 24 }), "36 × 24 in oval");
  assert.equal(describeShapeSize("RECTANGLE", { lengthIn: null, widthIn: null }), "—");
  assert.equal(describeShapeSize("CIRCLE", { lengthIn: null, widthIn: null }), "⌀ —");
});

test("describeShapeSize speaks centimetres when told to", () => {
  assert.equal(
    describeShapeSize("RECTANGLE", { lengthIn: 40.5512, widthIn: 1.1811 }, "CM"),
    "103 × 3 cm",
  );
  assert.equal(describeShapeSize("CIRCLE", { lengthIn: 19.685, widthIn: 19.685 }, "CM"), "⌀ 50 cm");
  assert.equal(
    describeShapeSize("OVAL", { lengthIn: 39.3701, widthIn: 19.685 }, "CM"),
    "100 × 50 cm oval",
  );
  // A missing dimension is still a dash, not "0 cm".
  assert.equal(describeShapeSize("RECTANGLE", { lengthIn: null, widthIn: null }, "CM"), "—");
  assert.equal(describeShapeSize("RECTANGLE", { lengthIn: 40.5512, widthIn: 0 }, "CM"), "—");
});

// ── 5 · THE MONEY DOES NOT MOVE ─────────────────────────────────────────────

test("dim_unit is display only — the feet and the rupees are identical", () => {
  // Row C of PI 1200: 500 thresholds, 103 x 3 cm, all four edges, 2 cm stone.
  const row = {
    lengthIn: 40.5512, widthIn: 1.1811,
    quantity: 500, sinkQuantity: 0,
    thicknessMm: 20, shape: "RECTANGLE",
    edges: { front: true, back: true, left: true, right: true },
  };

  const priced = priceRow(row);

  // The perimeter is 2 x (40.5512 + 1.1811) = 83.4646 in = 6.9554 ft a piece.
  // Had the CENTIMETRES been stored in those columns instead, it would be
  // 2 x (103 + 3) = 212 in = 17.667 ft — 2.54x — and Rs1,32,500 rather than
  // Rs52,165 on this one row. That is the whole reason the columns stay inches.
  assert.ok(
    Math.abs(priced.runningFeet - 3477.69) < 0.5,
    `expected about 3477.69 running feet, got ${priced.runningFeet}`,
  );
  assert.ok(priced.edgeCost > 52000 && priced.edgeCost < 52400, `edge cost ${priced.edgeCost}`);
  assert.equal(priced.unpriced, false);

  // priceRow takes no unit and must never take one. Marking the row 'CM' is a
  // fact about the SCREEN. If this ever fails, somebody has taught the pricer
  // about units and a row of stone is about to be billed 2.54x.
  assert.ok(!("dimUnit" in row));
  assert.deepEqual(priceRow({ ...row }), priced);
});
