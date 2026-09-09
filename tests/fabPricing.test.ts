import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDGES, ALL_EDGES, ROUND_ALL, RATE_CARD, PRICED_THICKNESS_MM, INCHES_PER_FOOT,
  rateFor, thicknessLabel, edgeInchesPerPiece, runningFeet, edgeCount, edgeCapacity,
  allEdgesFor, priceRow, sumPricing, formatRupees,
  serializeEdges, parseEdges, describeEdges,
  edgeFaceCount, describeEdgeFace,
} from "../src/lib/fab/pricing.ts";

// THE RATE CARD, from the owner:
//   sink cutting   PER PIECE        2 cm ₹230, 3 cm ₹300
//   edge work      PER RUNNING FOOT 2 cm ₹15,  3 cm ₹20
//
// The unit is the thing to get right. A running foot is a length of finished
// EDGE — not an area, not a piece. Charging edge work per piece or per square
// foot is out by an order of magnitude in either direction, and it is the sort
// of error that looks plausible on an invoice.
//
// ─────────────────────── WHAT CHANGED, AND WHY THESE TESTS DID ──────────────
// These tests used to pin the opposite rule, and the inversion is deliberate.
//
// The old rule was `fabricationRequired = sinkRequired`: edge work was read as
// the hand-polish that comes WITH a sink cutout, so the feet were counted over
// the sink pieces and a plain row earned nothing however its edges were marked.
//
// The owner separated them: "we choose the sink, there itself we need to choose
// the edge polish, which is NOT the polish of the operator — this edge polish is
// by hand, where we need the running foot length and charge by thickness", and
// "any pieces can be assigned the edge hand polish or not". Sink POLISH is still
// implied by the sink cut and priced inside it. Hand EDGE polish is a separate
// choice on any row.
//
// So a row of 60 with 30 sinks and all four edges is now 60 pieces of edge work
// and 30 of sink — and a plain row with polished edges earns ₹7,575 where it
// used to earn nothing. The tests below are the record of that.
//
// AND A ROW IS HOMOGENEOUS. "Let them be group itself — if in a row only a few
// have sink, that's a new group or row." So the edge count is never a fraction
// of the row: it is the whole quantity or zero, and that is why there is no
// edge_quantity to pass in.

test("the card is the owner's, to the rupee", () => {
  assert.equal(RATE_CARD[20].sinkPerPiece, 230);
  assert.equal(RATE_CARD[20].edgePerFoot, 15);
  assert.equal(RATE_CARD[30].sinkPerPiece, 300);
  assert.equal(RATE_CARD[30].edgePerFoot, 20);
  assert.deepEqual([...PRICED_THICKNESS_MM], [20, 30]);
  assert.deepEqual([...EDGES], ["front", "back", "left", "right"]);
  assert.equal(INCHES_PER_FOOT, 12);
});

test("thickness: a GAUGE READING still finds its rate, a different product does not", () => {
  // Stone sold as 2 cm measures 19.8 or 20.2 off a gauge.
  for (const t of [19, 19.8, 20, 20.2, 21]) assert.equal(rateFor(t)?.nominalMm, 20, String(t));
  for (const t of [29, 29.5, 30, 31])       assert.equal(rateFor(t)?.nominalMm, 30, String(t));
  // 12 mm is NOT 2 cm priced slightly wrong — it is a product this card does
  // not cover, and a wrong figure that looks right is worse than a gap.
  for (const t of [8, 12, 15, 25, 40, 0, -20, NaN, null, undefined]) {
    assert.equal(rateFor(t as number), null, String(t));
  }
  assert.equal(thicknessLabel(20), "2 cm");
  assert.equal(thicknessLabel(30.2), "3 cm");
  assert.equal(thicknessLabel(12), "12 mm");
  assert.equal(thicknessLabel(null), "—");
});

test("edges: front and back run the LENGTH, left and right run the WIDTH", () => {
  // The mapping that a boolean array would get silently wrong on a reorder.
  assert.equal(edgeInchesPerPiece(28, 22.5, { front: true }), 28);
  assert.equal(edgeInchesPerPiece(28, 22.5, { back: true }), 28);
  assert.equal(edgeInchesPerPiece(28, 22.5, { left: true }), 22.5);
  assert.equal(edgeInchesPerPiece(28, 22.5, { right: true }), 22.5);
  // All four: the full perimeter.
  assert.equal(edgeInchesPerPiece(28, 22.5, ALL_EDGES), 28 + 28 + 22.5 + 22.5);
  assert.equal(edgeInchesPerPiece(28, 22.5, ALL_EDGES), 101);
  // A vanity top with only the front edge finished — the common real case.
  assert.equal(edgeInchesPerPiece(28, 22.5, { front: true }), 28);
  // Nothing selected is nothing charged, not a default of "all".
  assert.equal(edgeInchesPerPiece(28, 22.5, {}), 0);
  assert.equal(edgeInchesPerPiece(28, 22.5, null), 0);
  assert.equal(edgeCount(ALL_EDGES), 4);
  assert.equal(edgeCount({ front: true, left: true }), 2);
  assert.equal(edgeCount(null), 0);
});

test("running feet: ONE PIECE'S EDGE × THE QUANTITY, converted once", () => {
  // Row A of PO 10026: 28 × 22.5, sixty pieces, all four edges.
  //   101 in per piece × 60 = 6,060 in = 505 ft
  assert.equal(runningFeet(28, 22.5, 60, ALL_EDGES), 505);
  // Front edge only: 28 × 60 / 12 = 140 ft.
  assert.equal(runningFeet(28, 22.5, 60, { front: true }), 140);
  // Junk cannot invent feet.
  assert.equal(runningFeet(28, 22.5, 0, ALL_EDGES), 0);
  assert.equal(runningFeet(28, 22.5, -5, ALL_EDGES), 0);
  assert.equal(runningFeet(28, 22.5, 1.9, ALL_EDGES), round2(101 / 12));
  assert.equal(runningFeet(null, 22.5, 60, ALL_EDGES), round2((22.5 * 2 * 60) / 12));
  assert.equal(runningFeet(28, 22.5, 60, {}), 0);
  function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
});

test("A ROW PRICED END TO END — row A of PO 10026 in 2 cm", () => {
  // 60 pieces of 28 × 22.5, all four edges hand polished, 30 of them with a sink.
  // The two jobs are counted over their own pieces:
  //   edge    505 ft × ₹15  = ₹7,575     (all 60 — every piece has the edges)
  //   sink     30 pcs × ₹230 = ₹6,900    (only the 30 that have a sink)
  //                            ₹14,475
  const p = priceRow({
    lengthIn: 28, widthIn: 22.5, quantity: 60,
    sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES,
  });
  assert.equal(p.runningFeet, 505);
  assert.equal(p.edgeCost, 7575);
  assert.equal(p.sinkPieces, 30);
  assert.equal(p.edgePieces, 60);
  // The bench sees all 60 — 30 for a sink, and all of them for their edges.
  assert.equal(p.fabricationPieces, 60);
  assert.equal(p.sinkCost, 6900);
  assert.equal(p.total, 14475);
  assert.equal(p.rate?.nominalMm, 20);
  assert.equal(p.unpriced, false);
  assert.equal(p.unpricedReason, null);
  // THE OLD ANSWER, pinned as the thing this is not. Counting the feet over the
  // sink pieces gave ₹3,787.50 and left half the row's hand polish unbilled.
  assert.notEqual(p.runningFeet, 252.5);
  assert.notEqual(p.edgeCost, 3787.5);
});

test("A PLAIN ROW WITH POLISHED EDGES EARNS — the reversal, stated plainly", () => {
  // The owner: "any pieces can be assigned the edge hand polish or not." A row
  // with no sink at all still goes to a man with a hand polisher if its edges
  // are marked, and that work is charged by the running foot like any other.
  const p = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: ALL_EDGES });
  assert.equal(p.edgePieces, 60);
  assert.equal(p.sinkPieces, 0);
  assert.equal(p.fabricationPieces, 60, "no sink, but it is a fabrication row");
  assert.equal(p.runningFeet, 505);
  assert.equal(p.edgeCost, 7575);
  assert.equal(p.sinkCost, 0);
  assert.equal(p.total, 7575);
  assert.equal(p.unpriced, false);

  // NULL sink — the supervisor has not decided — changes nothing about the edges.
  const q = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: null, thicknessMm: 20, edges: ALL_EDGES });
  assert.equal(q.edgeCost, 7575);
  assert.equal(q.sinkCost, 0);
});

test("A ROW WITH NEITHER JOB IS NOT A FABRICATION ROW — and is not 'unpriced' either", () => {
  // No sink and no edges marked: cut, machine-polished, shipped. It never
  // reaches the fabricator's bench and nothing is owed.
  const p = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: {} });
  assert.equal(p.edgePieces, 0);
  assert.equal(p.fabricationPieces, 0);
  assert.equal(p.runningFeet, 0);
  assert.equal(p.total, 0);
  // NOTHING IS OWED is not the same as NOTHING IS KNOWN. unpriced means a figure
  // is missing; this row is complete and worth zero.
  assert.equal(p.unpriced, false);
  assert.equal(p.unpricedReason, null);
  assert.equal(p.rate?.nominalMm, 20);
});

test("the same row in 3 cm costs more, on both charges", () => {
  const two = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES });
  const three = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 30, edges: ALL_EDGES });
  assert.equal(three.edgeCost, 10100);   // 505 × 20
  assert.equal(three.sinkCost, 9000);    //  30 × 300
  assert.equal(three.total, 19100);
  assert.ok(three.edgeCost > two.edgeCost);
  assert.ok(three.sinkCost > two.sinkCost);
  // Same stone, same edges, same sink count — only the rate moved.
  assert.equal(three.runningFeet, two.runningFeet);
});

test("SINKS ARE PER PIECE AND EDGES PER FOOT — swapping them is the expensive mistake", () => {
  // Charging edge work per PIECE instead of per foot on this row:
  //   wrong  60 × ₹15 =   ₹900
  //   right 505 × ₹15 = ₹7,575
  const p = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES });
  assert.notEqual(p.edgeCost, 60 * 15);
  assert.equal(p.edgeCost, 505 * 15);
  // And charging sinks per foot instead of per piece:
  const q = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: {} });
  assert.equal(q.edgeCost, 0, "no edges selected, so no edge charge");
  assert.equal(q.sinkCost, 30 * 230, "sinks are per piece and do not depend on edges");
});

test("THE TWO CHARGES ARE INDEPENDENT — neither gates the other", () => {
  const dims = { lengthIn: 28, widthIn: 22.5, quantity: 60, thicknessMm: 20 } as const;
  const both  = priceRow({ ...dims, sinkQuantity: 60, edges: ALL_EDGES });
  const edge  = priceRow({ ...dims, sinkQuantity: 0,  edges: ALL_EDGES });
  const sink  = priceRow({ ...dims, sinkQuantity: 60, edges: {} });
  const plain = priceRow({ ...dims, sinkQuantity: 0,  edges: {} });

  // Every combination is reachable and priced on its own merits.
  assert.equal(edge.edgeCost, 7575);
  assert.equal(edge.sinkCost, 0);
  assert.equal(sink.edgeCost, 0);
  assert.equal(sink.sinkCost, 13800);
  assert.equal(plain.total, 0);
  // And the two together are exactly the sum of the two alone — no interaction.
  assert.equal(both.total, edge.total + sink.total);
});

test("a stale sink count cannot charge for pieces that do not exist", () => {
  // sink_quantity larger than the order — the same clamp planSlabRelease applies.
  const p = priceRow({ lengthIn: 28, widthIn: 4, quantity: 60, sinkQuantity: 90, thicknessMm: 20, edges: ALL_EDGES });
  assert.equal(p.sinkPieces, 60, "capped at the order, not 90");
  assert.equal(p.sinkCost, 60 * 230);
  // The EDGE count no longer rides on the sink count at all — it is the row.
  assert.equal(p.edgePieces, 60);
  assert.equal(p.runningFeet, runningFeet(28, 4, 60, ALL_EDGES));
});

test("AN UNPRICED THICKNESS IS SAID OUT LOUD, not charged at a neighbour's rate", () => {
  const p = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 12, edges: ALL_EDGES });
  assert.equal(p.unpriced, true);
  assert.equal(p.unpricedReason, "THICKNESS");
  assert.equal(p.rate, null);
  assert.equal(p.edgeCost, 0);
  assert.equal(p.sinkCost, 0);
  assert.equal(p.total, 0);
  assert.equal(p.edgePieces, 60, "the pieces still reach the bench — the work is real");

  // THE FEET ARE ZERO, AND THIS LINE ASSERTED 505 UNTIL AN AUDIT LOOKED AT IT.
  //
  // The old reasoning was "the work happened, only the rate is missing", which
  // reads well and is wrong where it matters: sumPricing adds runningFeet across
  // the project, so a row reporting feet it is not charging for made the CEO
  // board's "run ft" tile disagree with the revenue tile beside it, by 55% on
  // one row, with nothing on screen to explain the gap. Feet that no money
  // corresponds to are not a measurement, they are a discrepancy.
  //
  // All four refusals now agree on this. The work is still counted — in
  // edgePieces, which is what the bench reads.
  assert.equal(p.runningFeet, 0);

  // AND THE EDGE IS PAID IF THE ROW CAN RATE IT. scripts/0067: a row may carry
  // its own figure, so 12 mm stone with an agreed Rs22/ft prices its edge
  // perfectly well — only the SINK needs the card, and only the sink is lost.
  // Withholding both would turn one unknown into two, which is the exact
  // mistake the DIMENSIONS branch had to be fixed for.
  const rated = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 12, edges: ALL_EDGES, rate: 22 });
  assert.equal(rated.unpricedReason, "THICKNESS", "the sink is still unpriceable");
  assert.equal(rated.edgeCost, 11110, "505 ft x Rs22");
  assert.equal(rated.runningFeet, 505, "and NOW the feet are real, because they are charged");
  assert.equal(rated.sinkCost, 0);
  assert.equal(rated.total, 11110);

  // With no sink on the row there is nothing the card was needed for at all.
  const clean = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0, thicknessMm: 12, edges: ALL_EDGES, rate: 22 });
  assert.equal(clean.unpriced, false);
  assert.equal(clean.total, 11110);
  assert.equal(clean.rateSource, "ROW");
});

test("EDGES MARKED WITH NOTHING TO MEASURE THEM ALONG — the silent ₹0", () => {
  // The bug: a row with `left` polished and no width measured 0 in, priced at
  // ₹0 and reported unpriced:false — indistinguishable on every screen from a
  // customer who asked for raw edges. One is an answer, the other is a hole in
  // the order, and the invoice was short either way.
  const p = priceRow({ lengthIn: 28, widthIn: null, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: { left: true } });
  assert.equal(p.edgeCost, 0);
  assert.equal(p.unpriced, true);
  assert.equal(p.unpricedReason, "DIMENSIONS");
  // The rate is still reported — it is the dimension that is missing, not the
  // card, and a screen that says "no rate for 2 cm stone" sends the reader to
  // fix the wrong thing.
  assert.equal(p.rate?.nominalMm, 20);

  // PER EDGE, NOT PER ROW. front runs the LENGTH, which this row has, so the
  // same missing width is not a problem for it.
  const q = priceRow({ lengthIn: 28, widthIn: null, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: { front: true } });
  assert.equal(q.unpriced, false);
  assert.equal(q.edgeCost, 28 * 60 / 12 * 15);

  // NO EDGES MARKED, NO PROBLEM. A row with missing dimensions and nothing to
  // polish is not a pricing hole — nobody asked for anything.
  const r = priceRow({ lengthIn: null, widthIn: null, quantity: 60, sinkQuantity: 60, thicknessMm: 20, edges: {} });
  assert.equal(r.unpriced, false);
  assert.equal(r.sinkCost, 60 * 230);

  // BOTH HOLES AT ONCE reports the dimension, because that is the one somebody
  // can go and fix; the rate is a negotiation.
  const s = priceRow({ lengthIn: null, widthIn: null, quantity: 10, sinkQuantity: 0, thicknessMm: 12, edges: ALL_EDGES });
  assert.equal(s.unpricedReason, "DIMENSIONS");
});

// ────────────────────────── TOP, BOTTOM, BOTH ───────────────────────────────
// The owner: "hand edge polish have like not only 4 direction N E S W, also
// whether this on top or bottom or both as well."
//
// An edge is a band of stone with two arrises. Polishing both is the same line
// walked TWICE, so it multiplies the feet — it is not a surcharge and not a
// second line on the invoice.

test("BOTH FACES DOUBLES THE FEET — the half-invoice this closes", () => {
  const row = {
    lengthIn: 28, widthIn: 22.5, quantity: 60,
    sinkQuantity: 0, thicknessMm: 20, edges: ALL_EDGES,
  } as const;

  const top    = priceRow({ ...row, edgeFace: "TOP" });
  const bottom = priceRow({ ...row, edgeFace: "BOTTOM" });
  const both   = priceRow({ ...row, edgeFace: "BOTH" });

  assert.equal(top.runningFeet, 505);
  assert.equal(top.edgeCost, 7575);

  // BOTTOM is the same work on the other arris — one pass either way.
  assert.equal(bottom.runningFeet, 505);
  assert.equal(bottom.edgeCost, 7575);

  // BOTH is two passes of the same 505 ft.
  assert.equal(both.runningFeet, 1010);
  assert.equal(both.edgeCost, 15150);
  assert.equal(both.edgeCost, top.edgeCost * 2, "exactly double, never a fee on top");

  // The face is reported back, so a screen showing 1,010 ft on a 505 ft row can
  // say why — and so nothing downstream doubles it a second time.
  assert.equal(both.edgeFace, "BOTH");
  assert.equal(top.edgeFace, "TOP");
});

test("TOP is the default, and an unreadable face never invents a second pass", () => {
  // Every row written before faces existed was charged as one face. A blank, a
  // typo or a null must land on that same answer — the expensive direction has
  // to be chosen, never fallen into.
  const base = { lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: ALL_EDGES } as const;
  const stated = priceRow({ ...base, edgeFace: "TOP" });
  for (const f of [undefined, null, "", "  ", "top", "Top", "BOTH_SIDES", "2", 2, {}, true]) {
    const p = priceRow({ ...base, edgeFace: f });
    assert.equal(p.runningFeet, stated.runningFeet, `face ${String(f)} must not double`);
  }
  // …except the two spellings that genuinely mean it, in any case.
  for (const f of ["BOTH", "both", " Both "]) {
    assert.equal(priceRow({ ...base, edgeFace: f }).runningFeet, 1010, String(f));
  }
  assert.equal(edgeFaceCount("BOTH"), 2);
  assert.equal(edgeFaceCount("TOP"), 1);
  assert.equal(edgeFaceCount("BOTTOM"), 1);
  assert.equal(edgeFaceCount(null), 1);
  assert.equal(describeEdgeFace("BOTH"), "top & bottom");
  assert.equal(describeEdgeFace("BOTTOM"), "bottom only");
  assert.equal(describeEdgeFace(null), "top only");
});

test("faces multiply the EDGE charge and leave the sink alone", () => {
  // A sink is cut once whatever happens to the edges — the two charges are
  // independent, and this pins that the face cannot leak into the per-piece one.
  const base = { lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 60, thicknessMm: 20, edges: ALL_EDGES } as const;
  const one = priceRow({ ...base, edgeFace: "TOP" });
  const two = priceRow({ ...base, edgeFace: "BOTH" });
  assert.equal(one.sinkCost, two.sinkCost, "60 sinks either way");
  assert.equal(one.sinkCost, 13800);
  assert.equal(two.edgeCost - one.edgeCost, 7575);
  assert.equal(two.total, two.edgeCost + two.sinkCost);

  // And a round piece doubles the same way — a circle has one edge and two
  // faces, exactly like a rectangle.
  const c = { lengthIn: 24, widthIn: 24, quantity: 10, sinkQuantity: 0, thicknessMm: 20, edges: ROUND_ALL, shape: "CIRCLE" } as const;
  assert.equal(priceRow({ ...c, edgeFace: "TOP" }).runningFeet, 62.83);
  assert.equal(priceRow({ ...c, edgeFace: "BOTH" }).runningFeet, 125.67);
});

test("NO EDGES MARKED — the face cannot conjure a charge on its own", () => {
  // BOTH on a row nobody asked to polish is still nothing. The face is a
  // multiplier, and a multiplier on zero is zero.
  const p = priceRow({
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0,
    thicknessMm: 20, edges: {}, edgeFace: "BOTH",
  });
  assert.equal(p.runningFeet, 0);
  assert.equal(p.edgeCost, 0);
  assert.equal(p.total, 0);
  assert.equal(p.unpriced, false);
});

// ───────────────────── THINGS THE AUDIT FOUND, PINNED ───────────────────────
// Every one of these was a live defect found by reviewing the shipped code, not
// a hypothetical. They are here so the same mistake cannot be made twice.

test("A MISSING WIDTH DOES NOT CANCEL THE SINK CHARGE", () => {
  // THE BUG: the DIMENSIONS branch returned sinkCost 0 and total 0. A sink is
  // charged PER PIECE at a flat rate and has nothing to do with the row's
  // length or width — so a row with 30 real sinks and a blank width reported
  // ₹0 instead of ₹6,900, and perPieceCharge then gave those 30 packed pieces
  // a ₹0 share for good.
  const p = priceRow({
    lengthIn: 28, widthIn: null, quantity: 60, sinkQuantity: 30,
    thicknessMm: 20, edges: { left: true },
  });
  assert.equal(p.unpricedReason, "DIMENSIONS", "the EDGE half is genuinely unknown");
  assert.equal(p.edgeCost, 0, "and it is withheld");
  assert.equal(p.sinkCost, 6900, "but 30 sinks at ₹230 are owed regardless");
  assert.equal(p.total, 6900);

  // WITHOUT A RATE there is still nothing to charge — the two holes compose.
  const q = priceRow({
    lengthIn: 28, widthIn: null, quantity: 60, sinkQuantity: 30,
    thicknessMm: 12, edges: { left: true },
  });
  assert.equal(q.unpricedReason, "DIMENSIONS");
  assert.equal(q.sinkCost, 0, "12 mm is not on the card, so not even the sink prices");
  assert.equal(q.total, 0);
});

test("EVERY SCREEN THAT PRICES A ROW MUST PASS THE FACE", () => {
  // THE BUG: the CEO Overview board and the supervisor's slab card both called
  // priceRow WITHOUT edgeFace, so a BOTH row showed ₹7,575 there while the
  // period report on the same page charged ₹15,150 — one dashboard, two numbers
  // 2× apart for one row.
  //
  // This pins the CONSEQUENCE of forgetting, so the size of the mistake is
  // written down even though a test cannot reach into a component.
  const args = {
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0,
    thicknessMm: 20, edges: ALL_EDGES,
  } as const;
  const forgotten = priceRow({ ...args });                   // no edgeFace
  const passed    = priceRow({ ...args, edgeFace: "BOTH" });
  assert.equal(forgotten.edgeCost, 7575);
  assert.equal(passed.edgeCost, 15150);
  assert.equal(passed.edgeCost - forgotten.edgeCost, 7575,
    "forgetting the face on ONE row of ONE order loses ₹7,575");
  // The face comes back on the result so a screen can NAME it — the only way a
  // reader can tell 1,010 ft on a 505 ft row from an arithmetic error.
  assert.equal(passed.edgeFace, "BOTH");
  assert.equal(forgotten.edgeFace, "TOP");
});

test("BOTH is double for a RECTANGLE, and within a paisa for a round shape", () => {
  // Honest about the limit. The perimeter is rounded to 2dp because feet are
  // the unit quoted to the customer, so BOTH is exactly 2× only when the
  // per-piece feet are exact. On a circle it can differ by paise, and the
  // earlier assertion "exactly double, never a fee on top" was true only for
  // the rectangle it was written against.
  const rect = {
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0,
    thicknessMm: 20, edges: ALL_EDGES,
  } as const;
  assert.equal(
    priceRow({ ...rect, edgeFace: "BOTH" }).edgeCost,
    priceRow({ ...rect, edgeFace: "TOP" }).edgeCost * 2,
    "a rectangle doubles exactly",
  );

  const circ = {
    lengthIn: 24, widthIn: 24, quantity: 10, sinkQuantity: 0,
    thicknessMm: 20, edges: ROUND_ALL, shape: "CIRCLE",
  } as const;
  const one = priceRow({ ...circ, edgeFace: "TOP" }).edgeCost;
  const two = priceRow({ ...circ, edgeFace: "BOTH" }).edgeCost;
  assert.ok(Math.abs(two - one * 2) <= 0.25,
    `a circle doubles to within a paisa or two: ${two} vs ${one * 2}`);
  assert.ok(two > one, "and it is always more, never less");
});

test("totals: a project's charge is the sum of its rows, and says what it skipped", () => {
  // Rows A and B of PO 10026 on 2 cm stone, plus one row on unpriced 12 mm.
  const rows = [
    priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES }),
    priceRow({ lengthIn: 28, widthIn: 4,    quantity: 60, sinkQuantity: 60, thicknessMm: 20, edges: { front: true } }),
    priceRow({ lengthIn: 34, widthIn: 22.5, quantity: 60, sinkQuantity: 0,  thicknessMm: 12, edges: ALL_EDGES }),
  ];
  const t = sumPricing(rows);
  //  row A  505 ft   row B  140 ft   row C  0 ft
  //
  // ROW C CONTRIBUTES NO FEET, and this assertion said 565 until an audit
  // pointed out what that does to the footer: the feet column stopped
  // reconciling with the money column beside it, because 565 of those feet were
  // never charged for. An unpriceable row reports its PIECES (they are on the
  // bench) and no feet (nothing was billed along them).
  assert.equal(t.runningFeet, 505 + 140);
  assert.equal(t.edgeCost, 7575 + 2100);
  assert.equal(t.sinkCost, 6900 + 60 * 230);
  assert.equal(t.total, 7575 + 2100 + 6900 + 60 * 230);
  assert.equal(t.edgePieces, 60 + 60 + 60);
  assert.equal(t.sinkPieces, 30 + 60 + 0);
  // The skipped row is REPORTED. A total that quietly omits a row is worse
  // than one that says it did — and it says WHICH hole, because a missing width
  // and an off-card thickness are fixed by different people.
  assert.equal(t.unpricedRows, 1);
  assert.equal(t.unpricedThickness, 1);
  assert.equal(t.unpricedDimensions, 0);
  // THE FEET COLUMN AND THE MONEY COLUMN NOW RECONCILE, which is the whole
  // point of the change above: every foot in the total is a foot somebody was
  // billed for, at the 2 cm rate the two priced rows share.
  assert.equal(t.runningFeet * 15, t.edgeCost);
  // The total equals the sum of the column, to the paisa.
  assert.equal(t.total, rows.reduce((n, r) => n + r.total, 0));
  const empty = sumPricing([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.unpricedRows, 0);
  assert.equal(empty.edgePieces, 0);
});

test("rupees are grouped the INDIAN way", () => {
  // ₹1,20,500 — not ₹120,500. An invoice that groups in thousands reads as a
  // different number to everyone who has to sign it.
  assert.equal(formatRupees(120500), "₹1,20,500.00");
  assert.equal(formatRupees(14475), "₹14,475.00");
  assert.equal(formatRupees(7575.5), "₹7,575.50");
  assert.equal(formatRupees(999), "₹999.00");
  assert.equal(formatRupees(0), "₹0.00");
  assert.equal(formatRupees(10000000), "₹1,00,00,000.00");
  assert.equal(formatRupees(-500), "-₹500.00");
  assert.equal(formatRupees(NaN as number), "₹0.00");
});

test("edges round-trip through storage, and a typo never becomes a charge", () => {
  assert.equal(serializeEdges(ALL_EDGES), "front,back,left,right");
  assert.equal(serializeEdges({ front: true, left: true }), "front,left");
  assert.equal(serializeEdges({}), "");
  assert.equal(serializeEdges(null), "");
  // Canonical order, so two identical selections are always the same string
  // and can be compared without being parsed.
  assert.equal(serializeEdges({ right: true, front: true }), "front,right");

  assert.deepEqual(parseEdges("front,back,left,right"), ALL_EDGES);
  assert.deepEqual(parseEdges("  FRONT , left "), { front: true, left: true });
  assert.deepEqual(parseEdges(""), {});
  assert.deepEqual(parseEdges(null), {});
  // An unknown word is dropped, not kept.
  assert.deepEqual(parseEdges("front,bevel,nosing"), { front: true });
  assert.deepEqual(parseEdges("frontt"), {});

  for (const e of [ALL_EDGES, { front: true }, { back: true, right: true }, {}]) {
    assert.deepEqual(parseEdges(serializeEdges(e)), e);
  }
  assert.equal(describeEdges(ALL_EDGES), "All four");
  assert.equal(describeEdges({ front: true, left: true }), "Front + Left");
  assert.equal(describeEdges({}), "None");
  assert.equal(describeEdges(null), "None");

  // ROUND SHARES THE COLUMN, in its own vocabulary. One column, one question —
  // "what edge work does this row have" — answered in the words of the shape
  // being asked about, and greppable in psql either way.
  assert.equal(serializeEdges(ROUND_ALL), "round");
  assert.deepEqual(parseEdges("round"), { round: true });
  assert.deepEqual(parseEdges(serializeEdges(ROUND_ALL)), ROUND_ALL);
  // A contradiction — a circle has no sides — resolves to round, so the stored
  // value always describes a shape that exists.
  assert.equal(serializeEdges({ round: true, front: true }), "round");
  assert.deepEqual(parseEdges("round,front"), { round: true });
  assert.equal(describeEdges(ROUND_ALL, "CIRCLE"), "All round");
  assert.equal(describeEdges({}, "CIRCLE"), "None");
});

// ────────────────────────── ROUND PIECES ────────────────────────────────────
// The owner: "need to include circle, oval as well. Default is rect shape fine."
// And on entry: "let the manager or anyone who uploads the PO mention the dia;
// if it's oval enter a, b — long length and long width."
//
// The money is the same money — running feet at the thickness rate. Only the
// perimeter changes, and shape.ts owns that.

test("a CIRCLE is charged on its circumference, from the diameter in `length`", () => {
  // ⌀ 24 in -> π × 24 = 75.398 in -> 6.28 ft -> ₹94.20 at 2 cm, per piece.
  assert.equal(edgeInchesPerPiece(24, 24, ROUND_ALL, "CIRCLE"), 75.4);
  // The four side names mean nothing to a circle — it has one edge.
  assert.equal(edgeInchesPerPiece(24, 24, ALL_EDGES, "CIRCLE"), 0);
  assert.equal(edgeCount(ROUND_ALL, "CIRCLE"), 1);
  assert.equal(edgeCapacity("CIRCLE"), 1);
  assert.equal(edgeCapacity("RECTANGLE"), 4);
  assert.deepEqual(allEdgesFor("CIRCLE"), { round: true });
  assert.deepEqual(allEdgesFor("OVAL"), { round: true });
  assert.deepEqual(allEdgesFor("RECTANGLE"), ALL_EDGES);

  const p = priceRow({ lengthIn: 24, widthIn: 24, quantity: 10, sinkQuantity: 0, thicknessMm: 20, edges: ROUND_ALL, shape: "CIRCLE" });
  assert.equal(p.runningFeet, 62.83);   // 75.4 × 10 / 12
  assert.equal(p.edgeCost, 942.45);
  assert.equal(p.edgePieces, 10);
  assert.equal(p.unpriced, false);
});

test("ROUND is the legacy spelling of CIRCLE, and is still read as one", () => {
  // FabShapeType shipped with ROUND before circles were priced. A row written
  // then must not quietly become a rectangle and be charged a perimeter it does
  // not have — silently, and in the customer's favour or ours depending on the
  // day, which is the worst kind of wrong.
  const legacy = priceRow({ lengthIn: 24, widthIn: 24, quantity: 10, sinkQuantity: 0, thicknessMm: 20, edges: ROUND_ALL, shape: "ROUND" });
  const named  = priceRow({ lengthIn: 24, widthIn: 24, quantity: 10, sinkQuantity: 0, thicknessMm: 20, edges: ROUND_ALL, shape: "CIRCLE" });
  assert.equal(legacy.edgeCost, named.edgeCost);
});

test("an OVAL is Ramanujan, and DEGENERATES EXACTLY TO THE CIRCLE", () => {
  // 36 × 24 oval -> 95.19 in -> 7.93 ft -> ₹118.95 at 2 cm, per piece.
  assert.equal(edgeInchesPerPiece(36, 24, ROUND_ALL, "OVAL"), 95.19);

  // THE PROPERTY THAT MADE RAMANUJAN THE RIGHT CHOICE: an oval whose axes agree
  // IS a circle, and a costing model where those two disagree by a rupee is one
  // somebody has to explain to a customer.
  for (const d of [12, 18, 24, 36, 47.5]) {
    assert.equal(
      edgeInchesPerPiece(d, d, ROUND_ALL, "OVAL"),
      edgeInchesPerPiece(d, d, ROUND_ALL, "CIRCLE"),
      `oval ${d}×${d} must equal circle ⌀${d}`,
    );
  }

  const p = priceRow({ lengthIn: 36, widthIn: 24, quantity: 10, sinkQuantity: 10, thicknessMm: 30, edges: ROUND_ALL, shape: "OVAL" });
  assert.equal(p.runningFeet, 79.33);      // 95.19 × 10 / 12
  assert.equal(p.edgeCost, 1586.6);        // × ₹20
  assert.equal(p.sinkCost, 3000);          // 10 × ₹300 — sinks do not care about shape
  assert.equal(p.total, 4586.6);
});

test("a round row with no diameter is a HOLE, not a free row", () => {
  const p = priceRow({ lengthIn: null, widthIn: null, quantity: 10, sinkQuantity: 0, thicknessMm: 20, edges: ROUND_ALL, shape: "CIRCLE" });
  assert.equal(p.unpriced, true);
  assert.equal(p.unpricedReason, "DIMENSIONS");
  // An oval needs BOTH axes; one is not enough to describe it.
  const q = priceRow({ lengthIn: 36, widthIn: null, quantity: 10, sinkQuantity: 0, thicknessMm: 20, edges: ROUND_ALL, shape: "OVAL" });
  assert.equal(q.unpricedReason, "DIMENSIONS");
  // A circle, though, takes its width from its diameter — an old row with a
  // null width is complete, not broken.
  const r = priceRow({ lengthIn: 24, widthIn: null, quantity: 10, sinkQuantity: 0, thicknessMm: 20, edges: ROUND_ALL, shape: "CIRCLE" });
  assert.equal(r.unpriced, false);
  assert.equal(r.edgeCost, 942.45);
});

test("AN UNKNOWN shape falls back to RECTANGLE — but a NAMED unpriceable one does not", () => {
  // THIS TEST ASSERTED THE OPPOSITE FOR ALL SEVEN INPUTS, on the reasoning:
  // "a rectangle's perimeter is the honest approximation and the one the shop
  // already quotes from; returning 0 would hand the work over free."
  //
  // Half of that was right and it is the half kept below: NULL, "" and a value
  // nobody recognises must stay rectangles, because every row written before
  // shape_type existed is NULL and the day they stop being priced is the day
  // the invoice goes short.
  //
  // The other half was wrong twice over. It handed nothing over free — the
  // pieces still reach the hand bench (edgePieces is unchanged) and the sink is
  // still charged; only the edge MONEY is withheld. And "approximation" was
  // generous: a CURVE and a CUSTOM outline have no relationship to their
  // bounding box at all.
  //
  // THE ONE GOOD ARGUMENT FOR THE OLD RULE, recorded so nobody has to rediscover
  // it: a true rectilinear L — a rectangle with a rectangular notch out of one
  // corner — has EXACTLY the perimeter of its bounding box. The notch removes
  // two segments and adds two of the same lengths. So for that specific shape
  // the old answer was not an approximation, it was correct.
  //
  // It is still withheld, because nothing in the row says the L is that L, an L
  // has six sides and finished_edges can only name four of them, and a figure
  // that is exact under an assumption nobody recorded is indistinguishable from
  // one that is wrong. See UNPRICEABLE_SHAPES in lib/fab/shape.ts.
  for (const s of ["L_SHAPE", "CURVE", "CUSTOM", "l_shape", " Custom "]) {
    assert.equal(edgeInchesPerPiece(28, 22.5, ALL_EDGES, s), 0, String(s));
  }
  for (const s of ["", null, undefined, 7, "RECTANGLE", "NOT_A_SHAPE"]) {
    assert.equal(edgeInchesPerPiece(28, 22.5, ALL_EDGES, s), 101, String(s));
  }
});

test("AN L, A CURVE OR A CUSTOM OUTLINE IS UNPRICED — AND THE SINK IS STILL OWED", () => {
  // The failure this replaces: 60 L-shaped pieces, all four edges marked, priced
  // silently as rectangles at ₹7,575 with `unpriced: false`. Black ink, no
  // caveat, nobody measured it.
  const row = {
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30,
    thicknessMm: 20, edges: ALL_EDGES, shape: "L_SHAPE",
  };
  const p = priceRow(row);
  assert.equal(p.unpriced, true);
  assert.equal(p.unpricedReason, "SHAPE");
  assert.equal(p.edgeCost, 0, "no edge money on an outline nothing can measure");
  assert.equal(p.runningFeet, 0, "and no feet either — a rectangle's would be summed");

  // THE SINK IS FLAT PER PIECE and has nothing to do with the outline it sits
  // in. Withholding it would turn one unknown into two, which is the bug the
  // DIMENSIONS branch already had to be fixed for.
  assert.equal(p.sinkCost, 6900, "30 sinks at ₹230");
  assert.equal(p.total, 6900);

  // AND THE WORK IS STILL WORK. The pieces reach the hand bench exactly as they
  // would on a rectangle; it is the money that waits, not the polishing.
  assert.equal(p.edgePieces, 60);
  assert.equal(p.sinkPieces, 30);
  assert.equal(p.fabricationPieces, 60);

  // The same row as a rectangle is the number that used to be quoted for it.
  const asRect = priceRow({ ...row, shape: "RECTANGLE" });
  assert.equal(asRect.unpriced, false);
  assert.equal(asRect.edgeCost, 7575);

  // SHAPE OUTRANKS DIMENSIONS. A blank width on an L is not the manager's to
  // fix, and telling him "no size" would send him to fill in a field that
  // changes nothing.
  assert.equal(priceRow({ ...row, widthIn: null }).unpricedReason, "SHAPE");
  // …and outranks THICKNESS, which is the rate conversation the shape makes moot.
  assert.equal(priceRow({ ...row, thicknessMm: 12 }).unpricedReason, "SHAPE");
  assert.equal(priceRow({ ...row, thicknessMm: 12 }).sinkCost, 0, "no card, no sink rate");

  // Counted on its own line in the totals, because it is fixed by a different
  // person than a blank width or an off-card thickness.
  const t = sumPricing([p, asRect, priceRow({ ...row, shape: "CURVE" })]);
  assert.equal(t.unpricedShape, 2);
  assert.equal(t.unpricedDimensions, 0);
  assert.equal(t.unpricedThickness, 0);
  assert.equal(t.runningFeet, asRect.runningFeet, "only the rectangle contributed feet");
  assert.equal(t.total, 6900 + asRect.total + 6900);
});
