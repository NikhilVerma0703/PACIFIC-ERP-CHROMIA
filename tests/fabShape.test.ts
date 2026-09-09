import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PIECE_SHAPES, DEFAULT_SHAPE, RECT_EDGES, ROUND_EDGE,
  UNPRICEABLE_SHAPES, FAB_SHAPE_TYPE_VALUES, isUnpriceableShape,
  parseShape, isRound, hasEdgeWork, edgeDimensionsMissing,
  ovalPerimeterInches, circlePerimeterInches, edgeInchesPerPiece,
  boundingSqInPerPiece, trueSqInPerPiece, describeShapeSize, dimensionLabels,
} from "../src/lib/fab/shape.ts";

// WHAT SHAPE A PIECE IS, AND HOW LONG ITS EDGE IS.
//
// The owner: "regarding the cost, now it's like polish side only for a squares
// or rect, need to include circle, oval as well. Default is rect shape fine."
// And on entry: "let the manager or anyone who uploads the PO mention the dia;
// if it's oval enter a, b — long length and long width."
//
// Everything here answers one question: how many inches of finished edge does
// ONE piece have. That number times the count times the rate is the hand edge
// polish charge, and it is the only reason the module exists.

test("the shape list is the one the enum and the UI both read", () => {
  assert.deepEqual([...PIECE_SHAPES], ["RECTANGLE", "CIRCLE", "OVAL"]);
  assert.equal(DEFAULT_SHAPE, "RECTANGLE");
  assert.deepEqual([...RECT_EDGES], ["front", "back", "left", "right"]);
  assert.equal(ROUND_EDGE, "round");
});

test("parseShape: ROUND is a CIRCLE, and anything unrecognised is a RECTANGLE", () => {
  // ROUND is the spelling FabShapeType shipped with, before circles were
  // priced. A row written then must not quietly become a rectangle and be
  // charged a perimeter it does not have.
  assert.equal(parseShape("ROUND"), "CIRCLE");
  assert.equal(parseShape("round"), "CIRCLE");
  assert.equal(parseShape("CIRCLE"), "CIRCLE");
  assert.equal(parseShape(" circle "), "CIRCLE");
  assert.equal(parseShape("OVAL"), "OVAL");
  assert.equal(parseShape("ELLIPSE"), "OVAL");

  // L_SHAPE, CURVE and CUSTOM are real FabShapeType values with no perimeter
  // formula, and parseShape STILL FLATTENS THEM TO RECTANGLE — deliberately, and
  // unchanged. "What shape is this" and "can this be charged" are two questions,
  // and only the second one refuses: isUnpriceableShape answers it, priceRow
  // reports SHAPE, and everything that merely needs a shape to draw or to label
  // with keeps the answer it always had. Splitting the questions is what let the
  // refusal be added without touching a single caller.
  for (const s of ["L_SHAPE", "CURVE", "CUSTOM", "", "  ", null, undefined, 7, {}, []]) {
    assert.equal(parseShape(s), "RECTANGLE", String(s));
  }

  assert.equal(isRound("CIRCLE"), true);
  assert.equal(isRound("OVAL"), true);
  assert.equal(isRound("ROUND"), true);
  assert.equal(isRound("RECTANGLE"), false);
  assert.equal(isRound(null), false);
});

test("RAMANUJAN II DEGENERATES EXACTLY TO THE CIRCLE — the property it was chosen for", () => {
  // An ellipse has no closed-form perimeter. Accuracy was not what decided this
  // approximation: a circle IS an oval whose axes agree, and a costing model
  // where those two disagree by a rupee is one somebody has to explain to a
  // customer. Asserted to nine decimals, not to the 2dp the money rounds at.
  for (const d of [1, 6, 12, 18, 24, 30, 36, 47.5, 96]) {
    const oval = ovalPerimeterInches(d, d);
    const circle = circlePerimeterInches(d);
    assert.ok(
      Math.abs(oval - circle) < 1e-9,
      `oval ${d}×${d} = ${oval}, circle ⌀${d} = ${circle}`,
    );
  }
});

test("the perimeters are the numbers on the quote", () => {
  // ⌀ 24 in -> π × 24
  assert.ok(Math.abs(circlePerimeterInches(24) - 75.39822368615503) < 1e-9);
  // 36 × 24 oval, Ramanujan II
  assert.ok(Math.abs(ovalPerimeterInches(36, 24) - 95.19255) < 1e-4);

  // Ramanujan II is accurate to about one part in ten million at the ratios
  // stone is cut at — four orders of magnitude finer than the 2dp the money is
  // rounded to. Bracketed rather than pinned: the point is that it is between
  // the two figures every schoolbook approximation agrees it must lie between.
  const a = 36, b = 24;
  const lower = Math.PI * (a + b) / 2;                        // Ramanujan I floor
  const upper = Math.PI * Math.sqrt(2 * ((a / 2) ** 2 + (b / 2) ** 2)) * 2 / Math.SQRT2;
  const p = ovalPerimeterInches(a, b);
  assert.ok(p > lower, `${p} must exceed the mean-diameter circle ${lower}`);
  assert.ok(p < upper, `${p} must be under ${upper}`);

  // Junk cannot invent a perimeter.
  for (const v of [0, -5, NaN, null, undefined, "x"]) {
    assert.equal(circlePerimeterInches(v as number), 0, String(v));
    assert.equal(ovalPerimeterInches(v as number, 24), 0, String(v));
    assert.equal(ovalPerimeterInches(24, v as number), 0, String(v));
  }
});

test("edge inches: a rectangle sums the sides chosen, a round shape is all or nothing", () => {
  // front and back run the LENGTH; left and right run the WIDTH. The mapping a
  // boolean array would get silently wrong on a reorder.
  const d = { lengthIn: 28, widthIn: 22.5 };
  assert.equal(edgeInchesPerPiece("RECTANGLE", d, { front: true }), 28);
  assert.equal(edgeInchesPerPiece("RECTANGLE", d, { back: true }), 28);
  assert.equal(edgeInchesPerPiece("RECTANGLE", d, { left: true }), 22.5);
  assert.equal(edgeInchesPerPiece("RECTANGLE", d, { right: true }), 22.5);
  assert.equal(edgeInchesPerPiece("RECTANGLE", d, { front: true, back: true, left: true, right: true }), 101);
  assert.equal(edgeInchesPerPiece("RECTANGLE", d, {}), 0);
  assert.equal(edgeInchesPerPiece("RECTANGLE", d, null), 0);

  // A ROUND SHAPE HAS ONE EDGE. The four side names mean nothing to it — and
  // that is a refusal, not a fallback: charging a circle for "front" would be
  // charging it for a side it does not have.
  const c = { lengthIn: 24, widthIn: 24 };
  assert.equal(edgeInchesPerPiece("CIRCLE", c, { round: true }), 75.4);
  assert.equal(edgeInchesPerPiece("CIRCLE", c, { front: true, back: true, left: true, right: true }), 0);
  assert.equal(edgeInchesPerPiece("OVAL", { lengthIn: 36, widthIn: 24 }, { round: true }), 95.19);
  assert.equal(edgeInchesPerPiece("OVAL", { lengthIn: 36, widthIn: 24 }, { front: true }), 0);

  // A CIRCLE READS ITS DIAMETER FROM `length` and ignores width entirely, so a
  // row whose width was never written still prices.
  assert.equal(edgeInchesPerPiece("CIRCLE", { lengthIn: 24, widthIn: null }, { round: true }), 75.4);
});

test("hasEdgeWork asks the shape's own question", () => {
  assert.equal(hasEdgeWork("RECTANGLE", { front: true }), true);
  assert.equal(hasEdgeWork("RECTANGLE", {}), false);
  assert.equal(hasEdgeWork("RECTANGLE", null), false);
  assert.equal(hasEdgeWork("CIRCLE", { round: true }), true);
  // A side name on a circle is not edge work — it is a screen with the wrong
  // shape for the row, and treating it as work would bill a rectangle's
  // perimeter for a circle.
  assert.equal(hasEdgeWork("CIRCLE", { front: true }), false);
  assert.equal(hasEdgeWork("OVAL", { round: true }), true);
});

test("EDGES MARKED WITH NOTHING TO MEASURE THEM ALONG — reported, not zeroed", () => {
  // The silent-loss case. A row with `left` polished and a NULL width measures
  // 0 in, prices at ₹0, and reads on every screen as "no edge charge" — which
  // is indistinguishable from a customer who asked for raw edges.
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: 28, widthIn: null }, { left: true }), true);
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: 28, widthIn: null }, { right: true }), true);

  // PER EDGE, NOT PER ROW. front runs the LENGTH, which this row has.
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: 28, widthIn: null }, { front: true }), false);
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: null, widthIn: 22.5 }, { left: true }), false);
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: null, widthIn: 22.5 }, { front: true }), true);

  // NOTHING ASKED FOR IS NOT A HOLE. A row with no dimensions and no edges
  // marked is not a pricing problem — nobody wanted anything polished.
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: null, widthIn: null }, {}), false);
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: null, widthIn: null }, null), false);

  // A circle needs its diameter; an oval needs BOTH axes, because one does not
  // describe it.
  assert.equal(edgeDimensionsMissing("CIRCLE", { lengthIn: null, widthIn: null }, { round: true }), true);
  assert.equal(edgeDimensionsMissing("CIRCLE", { lengthIn: 24, widthIn: null }, { round: true }), false);
  assert.equal(edgeDimensionsMissing("OVAL", { lengthIn: 36, widthIn: null }, { round: true }), true);
  assert.equal(edgeDimensionsMissing("OVAL", { lengthIn: 36, widthIn: 24 }, { round: true }), false);
});

test("THE SLAB LOSES THE BOUNDING BOX; THE CUSTOMER GETS THE TRUE AREA", () => {
  // A 24 in circle is cut from a 24 × 24 square and the corners are dust.
  assert.equal(boundingSqInPerPiece("CIRCLE", { lengthIn: 24, widthIn: 24 }), 576);
  assert.equal(trueSqInPerPiece("CIRCLE", { lengthIn: 24, widthIn: 24 }), 452.39);

  // The gap is real stone that went in the bin: π/4 of the square, so 21.5%.
  const lost = 1 - 452.39 / 576;
  assert.ok(Math.abs(lost - 0.2146) < 0.001, `${lost}`);

  // Using the true area for the slab would make every round job look like it
  // left a fifth more room than it did, and would weaken the over-commitment
  // check that stops a supervisor filling a slab past its capacity.
  assert.ok(boundingSqInPerPiece("CIRCLE", { lengthIn: 24, widthIn: 24 })
          > trueSqInPerPiece("CIRCLE", { lengthIn: 24, widthIn: 24 }));

  // An old circle row with a null width still squares off its diameter.
  assert.equal(boundingSqInPerPiece("CIRCLE", { lengthIn: 24, widthIn: null }), 576);

  // An oval: a × b bounding, π·a·b/4 true.
  assert.equal(boundingSqInPerPiece("OVAL", { lengthIn: 36, widthIn: 24 }), 864);
  assert.equal(trueSqInPerPiece("OVAL", { lengthIn: 36, widthIn: 24 }), 678.58);

  // A rectangle's two areas are the same number, and must stay that way — the
  // whole point of one bounding-box rule is that it has no special case.
  for (const dims of [{ lengthIn: 28, widthIn: 22.5 }, { lengthIn: 96, widthIn: 25.5 }]) {
    assert.equal(boundingSqInPerPiece("RECTANGLE", dims), trueSqInPerPiece("RECTANGLE", dims));
  }
});

test("a size reads as the shape it is, and the form labels do not lie", () => {
  assert.equal(describeShapeSize("RECTANGLE", { lengthIn: 28, widthIn: 22.5 }), "28 × 22.5 in");
  assert.equal(describeShapeSize("CIRCLE", { lengthIn: 24, widthIn: 24 }), "⌀ 24 in");
  assert.equal(describeShapeSize("OVAL", { lengthIn: 36, widthIn: 24 }), "36 × 24 in oval");
  // Printing "24 × 24" for a circle reads as a square and makes its running
  // feet — π·24, not 4·24 — look like an arithmetic error.
  assert.notEqual(describeShapeSize("CIRCLE", { lengthIn: 24, widthIn: 24 }), "24 × 24 in");
  assert.equal(describeShapeSize("RECTANGLE", { lengthIn: null, widthIn: null }), "—");
  assert.equal(describeShapeSize("CIRCLE", { lengthIn: null, widthIn: null }), "⌀ —");

  assert.deepEqual(dimensionLabels("RECTANGLE"), { length: "Length (in)", width: "Width (in)" });
  assert.deepEqual(dimensionLabels("CIRCLE"), { length: "Diameter (in)", width: null });
  assert.deepEqual(dimensionLabels("OVAL"), { length: "Long axis a (in)", width: "Short axis b (in)" });
});

test("A SQUARE IS A RECTANGLE — one code path, not two that must never disagree", () => {
  const sq = { lengthIn: 24, widthIn: 24 };
  assert.equal(parseShape("SQUARE"), "RECTANGLE");
  assert.equal(edgeInchesPerPiece("RECTANGLE", sq, { front: true, back: true, left: true, right: true }), 96);
  // And a 24 in SQUARE is not a 24 in CIRCLE: 96 in of edge against 75.4.
  assert.notEqual(
    edgeInchesPerPiece("RECTANGLE", sq, { front: true, back: true, left: true, right: true }),
    edgeInchesPerPiece("CIRCLE", sq, { round: true }),
  );
});

test("EVERY VALUE THE ENUM HOLDS IS EITHER PRICEABLE OR NAMED UNPRICEABLE", () => {
  // THE GUARD THIS FILE EXISTS TO HOLD. FabShapeType carries seven values and
  // this module knows five of them; the other two used to fall through
  // parseShape's default and be charged AS RECTANGLES with `unpriced: false` —
  // a number nobody had measured, in black ink, on the CEO's dashboard.
  //
  // Add a value to the enum in a migration and this fails until somebody
  // decides which side of the line it is on. That is the entire point of
  // writing the list down in two places.
  const priceable = new Set<string>([
    ...PIECE_SHAPES,
    "ROUND",   // the legacy spelling of CIRCLE — parseShape accepts it
  ]);
  for (const v of FAB_SHAPE_TYPE_VALUES) {
    const known = priceable.has(v);
    const refused = isUnpriceableShape(v);
    assert.ok(known !== refused, `${v} must be exactly one of priceable / unpriceable`);
  }
  assert.deepEqual([...UNPRICEABLE_SHAPES], ["L_SHAPE", "CURVE", "CUSTOM"]);
});

test("NULL AND A TYPO STAY RECTANGLES — only the three named ones are refused", () => {
  // The blast radius is exactly three words, and this is why it has to be.
  // EVERY row written before shape_type existed is NULL. The day this list
  // becomes "anything parseShape does not recognise" is the day those rows stop
  // being priced and the invoice goes short without a word.
  for (const v of [null, undefined, "", "   ", "RECTANGLE", "rectangle", "SQUARE", "NOPE", 7, {}, []]) {
    assert.equal(isUnpriceableShape(v), false, JSON.stringify(v) + " must price as a rectangle");
  }
  for (const v of ["L_SHAPE", "CURVE", "CUSTOM", " curve ", "Custom"]) {
    assert.equal(isUnpriceableShape(v), true, String(v));
  }

  // parseShape is UNCHANGED and still flattens them, so anything that only asks
  // "what shape is this" keeps its old answer. The refusal is a separate
  // question asked by the thing that charges money.
  assert.equal(parseShape("L_SHAPE"), "RECTANGLE");
  assert.equal(parseShape("CUSTOM"), DEFAULT_SHAPE);
});

test("an unpriceable shape reports SHAPE, never 'no size'", () => {
  // Two amber boxes racing for one row sends the reader to fix the wrong thing.
  // An L with a blank width has a shape problem, not a dimensions problem — the
  // width would change nothing.
  const all = { front: true, back: true, left: true, right: true };
  assert.equal(edgeDimensionsMissing("L_SHAPE", { lengthIn: null, widthIn: null }, all), false);
  assert.equal(edgeDimensionsMissing("RECTANGLE", { lengthIn: 28, widthIn: null }, all), true);

  // THE WORK IS STILL WORK. hasEdgeWork is untouched, so the piece still queues
  // for hand polish; it is the money that waits, not the polishing.
  assert.equal(hasEdgeWork("L_SHAPE", all), true);
  assert.equal(hasEdgeWork("L_SHAPE", {}), false);

  // And no inches, so nothing downstream can sum a rectangle's perimeter for it.
  assert.equal(edgeInchesPerPiece("L_SHAPE", { lengthIn: 28, widthIn: 22.5 }, all), 0);
  assert.equal(edgeInchesPerPiece("RECTANGLE", { lengthIn: 28, widthIn: 22.5 }, all), 101);
});
