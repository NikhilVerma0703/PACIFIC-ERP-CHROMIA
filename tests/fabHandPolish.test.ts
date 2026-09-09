import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceRow, sumPricing, ALL_EDGES, formatRupees,
  parsePricingMode, describePricingMode, PRICING_MODES,
} from "../src/lib/fab/pricing.ts";
import {
  faceEdgesFromLegacy, faceSideCounts, faceEdgeInchesPerPiece, describeFaceEdges,
  serializeFaceEdges, parseFaceEdges, faceEdgesUnset, POLISH_FACES,
} from "../src/lib/fab/shape.ts";
import {
  rowShares, pieceChargeWithHand, handPieceCharge, prefillFrom, mayFreeze,
} from "../src/lib/fab/pieceCharge.ts";

// HAND POLISH STOPS HAVING ONE PRICE — scripts/0067.
//
// The owner: "some pieces will be fully hand polished — side is also hand
// polished, top and bottom edges too, on all four sides, and price is not fixed
// on common, so each time it should be asked how much." And: "some will be
// priced on number of piece." And: "always have a custom free field for total,
// so when system feels heavy they call and enter the amount."
//
// Row A of PO 10026 is the row every figure here is checked against:
// 60 pieces of 28 x 22.5 in, all four edges, 30 with sinks, 2 cm stone.
const A = {
  lengthIn: 28, widthIn: 22.5, quantity: 60,
  sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES,
};

test("NOTHING ALREADY QUOTED MOVES BY A PAISA — the whole compatibility story", () => {
  // Every combination of the two legacy columns, priced through the new
  // three-face engine, must give the figure it gives in production today. If
  // one line of this fails, an invoice somebody has already sent has changed.
  const cases: Array<[unknown, number, number]> = [
    // edge_faces      feet    edge cost
    [null,             505,    7575],   // NULL means TOP
    ["TOP",            505,    7575],
    ["BOTTOM",         505,    7575],
    ["BOTH",          1010,   15150],   // the same line walked twice
    ["nonsense",       505,    7575],   // junk falls back to TOP, as it always did
  ];
  for (const [face, feet, cost] of cases) {
    const p = priceRow({ ...A, edgeFace: face });
    assert.equal(p.runningFeet, feet, `edge_faces=${String(face)} feet`);
    assert.equal(p.edgeCost, cost, `edge_faces=${String(face)} cost`);
    assert.equal(p.sinkCost, 6900, "and the sink never moves");
    assert.equal(p.unpriced, false);
    assert.equal(p.rateSource, "CARD");
  }

  // A round row, both faces — 2 x pi x 24.
  const c = priceRow({
    lengthIn: 24, widthIn: 24, quantity: 10, sinkQuantity: 0,
    thicknessMm: 20, shape: "CIRCLE", edges: { round: true }, edgeFace: "BOTH",
  });
  assert.equal(c.runningFeet, 125.67);
  assert.equal(c.edgeCost, 1885.05);

  // And a row with no edges marked stays free, not "unpriced".
  const none = priceRow({ ...A, edges: {} });
  assert.equal(none.edgeCost, 0);
  assert.equal(none.unpriced, false);
  assert.equal(none.total, 6900, "the sink alone");
});

test("EVERY COLUMN COMES OUT OF POSTGRES AS NULL, AND NULL IS NOT ZERO", () => {
  // THE BUG THIS TEST EXISTS FOR, caught by running the module rather than
  // reading it: `Number(null)` is 0, so a naive rate check read every absent
  // value as a rate of zero. Since edge_rate and edge_total_override are NULL
  // on every row in the database — that is what "nobody typed a rate" looks
  // like — row A's hand polish would have priced at NOTHING, silently, with
  // unpriced:false, on the day 0067 landed.
  const fromDb = priceRow({
    ...A, rate: null, pricingMode: null, edgeTotalOverride: null, faceEdges: null,
  });
  assert.equal(fromDb.edgeCost, 7575, "a row of NULLs is an ordinary row");
  assert.equal(fromDb.rateSource, "CARD");
  assert.equal(fromDb.edgeOverridden, false);

  // Undefined, empty string and false must behave the same way.
  for (const v of [undefined, "", "   ", false]) {
    assert.equal(priceRow({ ...A, rate: v as never }).edgeCost, 7575, JSON.stringify(v));
    assert.equal(priceRow({ ...A, edgeTotalOverride: v as never }).edgeOverridden, false, JSON.stringify(v));
  }

  // A REAL ZERO IS STILL HONOURED. A customer genuinely not being charged for
  // edge work is a real customer, and this is the line that keeps that possible.
  const freeEdges = priceRow({ ...A, rate: 0 });
  assert.equal(freeEdges.edgeCost, 0);
  assert.equal(freeEdges.rateSource, "ROW", "zero came from the row, not the card");
  assert.equal(freeEdges.unpriced, false);
  const freeTotal = priceRow({ ...A, edgeTotalOverride: 0 });
  assert.equal(freeTotal.edgeOverridden, true);
  assert.equal(freeTotal.edgeCost, 0);
  assert.equal(freeTotal.calculatedEdgeCost, 7575, "and what it would have been is kept");
});

test("THE THREE MODES, and the sink is in none of them", () => {
  assert.deepEqual([...PRICING_MODES], ["RUNNING_FOOT", "PER_PIECE", "LUMP_SUM"]);
  assert.equal(parsePricingMode(null), "RUNNING_FOOT", "absent means per foot");
  assert.equal(parsePricingMode("per_piece"), "PER_PIECE");
  assert.equal(parsePricingMode("HOURLY"), "RUNNING_FOOT", "junk falls back, never throws");
  assert.equal(describePricingMode("PER_PIECE").rateLabel, "Rs per piece");

  const foot  = priceRow({ ...A, rate: 22 });
  const piece = priceRow({ ...A, pricingMode: "PER_PIECE", rate: 40 });
  const lump  = priceRow({ ...A, pricingMode: "LUMP_SUM", rate: 9999 });

  assert.equal(foot.edgeCost, 11110,  "505 ft x Rs22");
  assert.equal(piece.edgeCost, 2400,  "60 pieces x Rs40");
  assert.equal(lump.edgeCost, 9999,   "one figure for the row");

  // THE SINK IS FIXED AND UNTOUCHED IN ALL THREE. The owner has said so twice,
  // and it is the one thing in this file that no mode, rate or override moves.
  for (const p of [foot, piece, lump]) {
    assert.equal(p.sinkCost, 6900, "30 sinks x Rs230, whatever the edge mode");
    assert.equal(p.total, p.edgeCost + 6900);
  }

  // A LUMP SUM IS NEVER FILLED IN FROM THE CARD. "One figure for the row" that
  // nobody typed is not a figure; it is a blank, and it says so.
  const noLump = priceRow({ ...A, pricingMode: "LUMP_SUM" });
  assert.equal(noLump.unpriced, true);
  // THE REASON CHANGED, AND DELIBERATELY. This used to report "THICKNESS",
  // which sent people to argue about the rate card when the actual problem was
  // an empty rate box on a row whose thickness (2 cm) is on the card perfectly
  // well. "RATE" names the box somebody has to type in. Same refusal, same
  // money, a reason that points at the person who can fix it.
  assert.equal(noLump.unpricedReason, "RATE", "the rate box is empty — not the card's fault");
  assert.equal(noLump.sinkCost, 6900, "and the sink is still owed");

  // AND PER PIECE BEHAVES THE SAME WAY NOW, which it did not before: it used to
  // quietly take the card's Rs15 A FOOT and charge it AS A PER-PIECE RATE.
  const noPiece = priceRow({ ...A, pricingMode: "PER_PIECE" });
  assert.equal(noPiece.unpriced, true);
  assert.equal(noPiece.unpricedReason, "RATE");
  assert.notEqual(noPiece.edgeCost, 900, "60 x Rs15/ft misread as Rs15 a piece");
});

test("TOP ON FOUR, BOTTOM ON TWO, SIDE ON FOUR — summed, never multiplied", () => {
  // The shape of question edge_faces could not ask. Three independent
  // selections; the feet are their sum.
  const full = { top: ALL_EDGES, bottom: { front: true, back: true }, side: ALL_EDGES };
  const p = priceRow({ ...A, faceEdges: full });

  // The counts are the numbers the owner asked to choose, and the picker prints.
  assert.deepEqual(p.faceCounts, { top: 4, bottom: 2, side: 4 });
  // 101 in (top) + 56 in (bottom: two lengths) + 101 in (side) = 258 in a piece.
  assert.equal(faceEdgeInchesPerPiece("RECTANGLE", { lengthIn: 28, widthIn: 22.5 }, full), 258);
  assert.equal(p.runningFeet, 1290, "258 in x 60 / 12");
  assert.equal(p.edgeCost, 19350);

  // NOT A MULTIPLIER. Three faces on four sides each would be 3 x 101 = 303 in;
  // this row is 258 because the bottom is only on two of them. The old model
  // could not express the difference at all.
  assert.notEqual(p.runningFeet, round2((303 * 60) / 12));

  // The three-face spec WINS over the legacy pair when both are present.
  const both = priceRow({ ...A, edgeFace: "BOTH", faceEdges: full });
  assert.equal(both.runningFeet, 1290, "the new spec decides, not edge_faces");

  assert.equal(describeFaceEdges("RECTANGLE", full), "top all four · bottom front + back · side all four");
  function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
});

test("the stored form round-trips, and an EMPTY FACE is not an ABSENT one", () => {
  const full = { top: ALL_EDGES, bottom: { front: true }, side: { round: true } };
  const stored = serializeFaceEdges(full);
  assert.equal(stored.top, "front,back,left,right");
  assert.equal(stored.bottom, "front");
  assert.equal(stored.side, "round");
  assert.deepEqual(parseFaceEdges(stored), {
    top: { front: true, back: true, left: true, right: true },
    bottom: { front: true },
    side: { round: true },
  });

  // THE DISTINCTION THE FALLBACK TURNS ON. All three NULL means "this row has
  // no new-style spec, read the legacy columns". An empty string is a real
  // answer — asked, and this face gets nothing — and must NOT send the reader
  // back to finished_edges, or a row deliberately cleared would silently
  // resurrect its old selection.
  assert.equal(faceEdgesUnset({ top: null, bottom: null, side: null }), true);
  assert.equal(faceEdgesUnset({ top: "", bottom: null, side: null }), false);
  assert.equal(faceEdgesUnset({}), true);
  assert.deepEqual(parseFaceEdges({ top: "", bottom: null, side: null }), {});
});

test("THE PHONE-CALL NUMBER RESCUES A ROW THE SYSTEM REFUSES TO PRICE", () => {
  // "When system feels heavy they call and enter the amount." The refusals are
  // exactly when somebody phones, so the override is checked before all of them.
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ["an L-shaped outline", { shape: "L_SHAPE" }, "SHAPE"],
    ["a blank width",       { widthIn: null },    "DIMENSIONS"],
    ["a circle with sides", { shape: "CIRCLE" },  "EDGES"],
  ];
  for (const [what, extra, reason] of refusals) {
    const refused = priceRow({ ...A, ...extra });
    assert.equal(refused.unpricedReason, reason, what);
    assert.equal(refused.edgeCost, 0);
    assert.equal(refused.sinkCost, 6900, "the sink is owed even when refused");

    const rescued = priceRow({ ...A, ...extra, edgeTotalOverride: 50000 });
    assert.equal(rescued.unpriced, false, `${what} — rescued`);
    assert.equal(rescued.edgeCost, 50000);
    assert.equal(rescued.total, 56900, "the agreed edge figure plus the fixed sink");
    assert.equal(rescued.edgeOverridden, true);
    // AND NO FEET ARE INVENTED. An L-shaped row has no perimeter here; reporting
    // a rectangle's 505 ft beside an agreed lump sum is a number nobody
    // measured, and it would be summed into the project's feet column.
    if (reason === "SHAPE") assert.equal(rescued.runningFeet, 0);
  }

  // THE CALCULATION IS KEPT BESIDE THE OVERRIDE, never destroyed. An override
  // nobody can see past is how a wrong rate card survives a year.
  const o = priceRow({ ...A, edgeTotalOverride: 4000 });
  assert.equal(o.edgeCost, 4000);
  assert.equal(o.calculatedEdgeCost, 7575);
  assert.notEqual(o.edgeCost, o.calculatedEdgeCost);

  // Overridden rows are counted in the totals, so a half-manual project total
  // says so on screen instead of looking fully calculated.
  const t = sumPricing([priceRow(A), o, priceRow({ ...A, edgeTotalOverride: 1 })]);
  assert.equal(t.overriddenRows, 2);
});

test("AN OFF-CARD THICKNESS NO LONGER TAKES THE EDGE MONEY WITH IT", () => {
  // Before 0067 the rate came only from the card, so 12 mm stone meant no edge
  // charge and no sink charge. Now a row can carry its own figure, and only the
  // SINK actually needs the card — withholding both turns one unknown into two,
  // which is the mistake the DIMENSIONS branch had to be fixed for.
  const noRate = priceRow({ ...A, thicknessMm: 12 });
  assert.equal(noRate.unpricedReason, "THICKNESS");
  assert.equal(noRate.edgeCost, 0);
  assert.equal(noRate.runningFeet, 0, "no feet reported for feet nobody was billed");

  const rated = priceRow({ ...A, thicknessMm: 12, rate: 22 });
  assert.equal(rated.edgeCost, 11110, "the edge prices perfectly well");
  assert.equal(rated.runningFeet, 505);
  assert.equal(rated.sinkCost, 0, "only the sink is lost");
  assert.equal(rated.unpricedReason, "THICKNESS", "and it says so");

  const noSink = priceRow({ ...A, thicknessMm: 12, rate: 22, sinkQuantity: 0 });
  assert.equal(noSink.unpriced, false, "nothing needed the card at all");
  assert.equal(noSink.total, 11110);
});

test("A PIECE SENT TO THE HAND BENCH IS PRICED ON ITS OWN — the group rule's one exception", () => {
  // "Already decided is also sent to hand later if machine doesn't support or
  // busy or breakdown... and this can be per piece." A machine failing at nine
  // at night takes the pieces in front of it, mid-row, and nobody renumbers an
  // order around that.
  const share = rowShares(A);
  assert.equal(share.edge, 126.25, "what an untouched piece of this row earns");

  const stone = { lengthIn: 28, widthIn: 22.5, thicknessMm: 20 };
  const spec = {
    byHand: true,
    faceEdges: { top: ALL_EDGES, bottom: { front: true, back: true }, side: ALL_EDGES },
    rate: 30,
  };

  const moved = pieceChargeWithHand(share, true, spec, stone);
  assert.equal(moved.fromHandBench, true);
  assert.equal(moved.edge, 645, "258 in / 12 = 21.5 ft x Rs30, for this piece alone");
  assert.notEqual(moved.edge, share.edge, "its row's price does not apply to it");
  assert.equal(moved.sink, 230, "THE SINK IS STILL THE ROW'S — it was cut on the saw");

  // Its own mode and its own agreed figure both work.
  assert.equal(pieceChargeWithHand(share, true, { byHand: true, faceEdges: { top: ALL_EDGES }, pricingMode: "PER_PIECE", rate: 500 }, stone).edge, 500);
  assert.equal(pieceChargeWithHand(share, true, { byHand: true, totalOverride: 900 }, stone).edge, 900);

  // EVERY PIECE THAT DID NOT MOVE KEEPS THE ROW PRICE.
  const stayed = pieceChargeWithHand(share, true, null, stone);
  assert.equal(stayed.fromHandBench, false);
  assert.equal(stayed.edge, 126.25);
  assert.equal(handPieceCharge(null, stone), null);
  assert.equal(handPieceCharge({ byHand: false }, stone), null, "the flag is what decides");
});

test("SENT TO HAND WITH NOTHING AGREED IS A HOLE, and it is named", () => {
  // Somebody is standing at a bench polishing this piece and no figure exists.
  // Falling through would report a clean Rs0 with unpriced:false — a piece that
  // looks like one nobody was charging for, which is what it is not.
  const stone = { lengthIn: 28, widthIn: 22.5, thicknessMm: 20 };
  const bare = handPieceCharge({ byHand: true }, stone);
  assert.equal(bare?.unpriced, true);
  assert.equal(bare?.unpricedReason, "HAND_SPEC");
  assert.equal(bare?.edge, 0);
  assert.equal(bare?.runningFeet, 0);

  const share = rowShares(A);
  assert.equal(pieceChargeWithHand(share, true, { byHand: true }, stone).unpriced, true);
  // The sink still reaches it — that charge was never in question.
  assert.equal(pieceChargeWithHand(share, true, { byHand: true }, stone).sink, 230);
});

test("THE NEXT PIECE OFF THE SAME BROKEN MACHINE OPENS PREFILLED", () => {
  // "If in same row again a piece is sent like that, same applicable and
  // prefilled for everything." The machine is still broken; the next piece
  // needs the same treatment and nobody should retype it.
  const spec = {
    byHand: true,
    faceEdges: { top: ALL_EDGES, side: { front: true } },
    rate: 30,
    pricingMode: "RUNNING_FOOT",
    totalOverride: 1200,
  };
  const next = prefillFrom(spec);
  assert.deepEqual(next?.faceEdges, spec.faceEdges);
  assert.equal(next?.rate, 30);
  assert.equal(next?.pricingMode, "RUNNING_FOOT");

  // TWO THINGS ARE DELIBERATELY NOT CARRIED.
  //
  // byHand, because prefilling the decision would mean opening the dialog had
  // already made it — the spec is a suggestion, not a reassignment.
  assert.equal("byHand" in (next ?? {}), false);
  // And the lump sum, because a figure agreed for ONE piece is by definition
  // not a figure for the next one. Carrying it would quietly bill Rs1,200 a
  // piece for a whole row nobody quoted that way.
  assert.equal(next?.totalOverride, null);

  assert.equal(prefillFrom(null), null);
});

test("A HAND-BENCH PIECE IS STILL FROZEN BY THE SAME RULE", () => {
  // mayFreeze governs the ROW's stamp and is unchanged by any of this — a row
  // that cannot be priced is never frozen, whatever happened to its pieces.
  assert.equal(mayFreeze(rowShares(A)), true);
  assert.equal(mayFreeze(rowShares({ ...A, shape: "L_SHAPE" })), false);
  assert.equal(mayFreeze(rowShares({ ...A, thicknessMm: 12 })), false);

  // A row rescued by an agreed total IS priced, and therefore freezable — which
  // is the point of the escape hatch: the phone call closes the question.
  assert.equal(mayFreeze(rowShares({ ...A, shape: "L_SHAPE", edgeTotalOverride: 5000 })), true);
});

test("faceEdgesFromLegacy never invents a SIDE pass", () => {
  // No row written before 0067 ever asked for the band to be hand polished, so
  // none of them may gain a third pass when read through the new engine. This
  // is the single line that keeps every historical figure still.
  for (const face of [null, "TOP", "BOTTOM", "BOTH", "junk"]) {
    const fe = faceEdgesFromLegacy(ALL_EDGES, face);
    assert.equal(fe.side, undefined, `edge_faces=${String(face)} must not produce a side`);
    assert.deepEqual(faceSideCounts("RECTANGLE", fe).side, 0);
  }
  assert.deepEqual(POLISH_FACES.slice(), ["top", "bottom", "side"]);
});

// ═══════════════════════════════════════════════════════════════════════════
//  FULLY HAND FABRICATED, AT A PIECE RATE
// ═══════════════════════════════════════════════════════════════════════════
//
// The owner: "for some peice group we give to the hand fabricated fully for
// peice rate. i said to have that as custom right"
//
// He had asked for it and PER_PIECE existed. It did not work, because the money
// was gated on ticked edges:
//
//     const edgePieces = hasAnyFaceWork(shape, faceEdges) ? qty : 0;
//     ... edgeRate === null || edgePieces === 0 ? 0 : ...
//
// A piece that goes to the bench WHOLE has no edges to tick — that is what
// "fully" means — so 35 pieces at Rs150 each came out as Rs0 with
// `unpriced: false`. A confident zero on an invoice.
//
// FACES DECIDE THE FEET. THEY DO NOT DECIDE WHETHER A PRICE APPLIES.

test("35 pieces fully by hand at Rs150 each is Rs5,250, with nothing ticked", () => {
  const p = priceRow({
    lengthIn: 59.4488, widthIn: 9.8425,       // row Z of PI 1200, 151 x 25 cm
    quantity: 35, sinkQuantity: 0, thicknessMm: 20, shape: "RECTANGLE",
    pricingMode: "PER_PIECE", rate: 150,
  });
  assert.equal(p.edgeCost, 5250);
  assert.equal(p.chargePieces, 35);
  assert.equal(p.unpriced, false);
  // No edges were named, so there are no feet. The money did not come from feet.
  assert.equal(p.runningFeet, 0);
  assert.equal(p.edgePieces, 0);
});

test("a lump sum for the row is the lump sum, with nothing ticked", () => {
  const p = priceRow({
    lengthIn: 59.4488, widthIn: 9.8425,
    quantity: 35, sinkQuantity: 0, thicknessMm: 20, shape: "RECTANGLE",
    pricingMode: "LUMP_SUM", rate: 5000,
  });
  assert.equal(p.edgeCost, 5000);
  assert.equal(p.unpriced, false);
});

test("PER_PIECE NEVER falls back to the rate card, which is quoted per FOOT", () => {
  // Rs15 is Rs15 A FOOT at 2 cm. Read as a per-piece rate it becomes Rs525 for
  // 35 pieces — a plausible small number nobody agreed to. It must refuse.
  const p = priceRow({
    lengthIn: 59.4488, widthIn: 9.8425,
    quantity: 35, sinkQuantity: 0, thicknessMm: 20, shape: "RECTANGLE",
    pricingMode: "PER_PIECE",
    faceEdges: { top: { front: true, back: true, left: true, right: true } },
  });
  assert.equal(p.unpriced, true);
  assert.equal(p.unpricedReason, "RATE");
  assert.equal(p.edgeCost, 0);
  assert.notEqual(p.edgeCost, 525);
});

test("a mode chosen with no rate REFUSES rather than reading as free", () => {
  for (const mode of ["PER_PIECE", "LUMP_SUM"]) {
    const p = priceRow({
      lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0,
      thicknessMm: 20, shape: "RECTANGLE", pricingMode: mode,
    });
    assert.equal(p.unpriced, true, `${mode} should refuse`);
    assert.equal(p.unpricedReason, "RATE");
  }
});

test("THE SHARE THAT GETS FROZEN is Rs150, not Rs0", () => {
  // rowShares divides the row cost by the charged count. Divided by edgePieces
  // (0 here) perPieceCharge's `k > 0 ? cost/k : 0` guard hands back ZERO, and
  // stampPieceCharges freezes that zero permanently — charged_at is written once
  // and never rewritten. The row would read Rs5,250 and every piece under it Rs0.
  const s = rowShares({
    lengthIn: 59.4488, widthIn: 9.8425,
    quantity: 35, sinkQuantity: 0, thicknessMm: 20, shape: "RECTANGLE",
    pricingMode: "PER_PIECE", rate: 150,
  });
  assert.equal(s.edge, 150);
  assert.equal(s.rowHasEdgeWork, true);
  assert.equal(mayFreeze(s), true);
});

test("send to hand: a piece rate alone is a complete answer", () => {
  const piece = { lengthIn: 59.4488, widthIn: 9.8425, thicknessMm: 20, shape: "RECTANGLE" };
  // The whole piece, by hand, Rs150. No faces — there is nothing to name.
  const whole = handPieceCharge(
    { byHand: true, faceEdges: null, rate: 150, pricingMode: "PER_PIECE", totalOverride: null },
    piece,
  );
  assert.equal(whole?.edge, 150);
  assert.equal(whole?.unpriced, false);

  // Still refused when there is genuinely nothing: no faces, no rate, no figure.
  const nothing = handPieceCharge(
    { byHand: true, faceEdges: null, rate: null, pricingMode: null, totalOverride: null },
    piece,
  );
  assert.equal(nothing?.unpriced, true);
  assert.equal(nothing?.unpricedReason, "HAND_SPEC");
});

test("NOT ONE RUNNING-FOOT ROW MOVED — this is the regression that matters", () => {
  // Row A of PO 10026, the canonical row: 60 pieces, 28 x 22.5 in, all four
  // edges, 30 sinks, 2 cm. 505 ft, Rs7,575 edge, Rs6,900 sink, Rs14,475 total.
  // Every row in the live database is this shape — pricing_mode is NULL on all
  // of them, and NULL is RUNNING_FOOT.
  const a = priceRow({
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30,
    thicknessMm: 20, shape: "RECTANGLE",
    edges: { front: true, back: true, left: true, right: true },
  });
  assert.equal(a.runningFeet, 505);
  assert.equal(a.edgeCost, 7575);
  assert.equal(a.sinkCost, 6900);
  assert.equal(a.total, 14475);
  assert.equal(a.unpriced, false);
  // The card is still the fallback for running foot, and only for it.
  assert.equal(a.rateSource, "CARD");
  assert.equal(a.edgeRate, 15);
  // And chargePieces agrees with edgePieces here, which is the whole point:
  // the two only diverge on the modes that are not measured in feet.
  assert.equal(a.chargePieces, a.edgePieces);
  assert.equal(a.chargePieces, 60);

  // A running-foot row with no edges is still free, and still not a refusal.
  const none = priceRow({
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0,
    thicknessMm: 20, shape: "RECTANGLE",
  });
  assert.equal(none.edgeCost, 0);
  assert.equal(none.unpriced, false);
});

// ═══════════════════════════════════════════════════════════════════════════
//  ONE TRIP, FLIPPED — the price for doing top and bottom together
// ═══════════════════════════════════════════════════════════════════════════
//
// The owner: "sometime when choosen top and bottom both they get a price — if
// per feet 10 rs then doing top + bottom we will give them 15 not 20."
//
// And on the uneven case, asked and answered: pair only the sides that actually
// share both faces. Top on four with bottom on two pairs the two and charges
// the other two at the ordinary rate, because only two of them are one trip.

const ROW_A = {
  lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0,
  thicknessMm: 20, shape: "RECTANGLE",
};
const ALL4 = { front: true, back: true, left: true, right: true };
const FRONT_BACK = { front: true, back: true };

test("HIS EXAMPLE: Rs10 a foot, top and bottom together Rs15 — not Rs20", () => {
  const summed = priceRow({ ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 }, rate: 10 });
  const paired = priceRow({ ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 }, rate: 10, pairRate: 15 });

  // What it used to be, and still is on any row without a pair rate: two faces
  // summed, 1,010 ft at Rs10 — Rs20 a perimeter-foot, the figure he cannot quote.
  assert.equal(summed.edgeCost, 10100);
  // THE SPLIT IS ALWAYS REPORTED SINCE 0070 — the per-face arithmetic is built
  // on it, so it is no longer blanked when the pair box is empty. With no pair
  // rate a shared side costs top + bottom, and both fall back to the same Rs10:
  // 505 ft x Rs20 = Rs10,100, which is what summing the faces always charged.
  assert.equal(summed.pairedFeet, 505);
  assert.equal(summed.pairEffectiveRate, 20);

  // What he actually agreed: 505 ft of stone at Rs15.
  assert.equal(paired.edgeCost, 7575);
  assert.equal(paired.pairedFeet, 505);
  assert.equal(paired.singleFeet, 0);
  assert.equal(paired.pairRate, 15);
});

test("TOP ON FOUR, BOTTOM ON TWO — only the shared sides are discounted", () => {
  const p = priceRow({
    ...ROW_A, faceEdges: { top: ALL4, bottom: FRONT_BACK }, rate: 10, pairRate: 15,
  });
  // front + back = (28 + 28) x 60 / 12 = 280 ft, done both faces  -> Rs15
  // left + right = (22.5 + 22.5) x 60 / 12 = 225 ft, top only     -> Rs10
  assert.equal(p.pairedFeet, 280);
  assert.equal(p.singleFeet, 225);
  assert.equal(p.edgeCost, 6450);          // 4,200 + 2,250
});

test("runningFeet is PASSES; pairedFeet is STONE. They do not sum.", () => {
  // The invariant that actually holds, and the one a reader will get wrong:
  //     runningFeet === pairedFeet x 2 + singleFeet
  // A side done on both faces is ONE side and TWO trips over it.
  for (const faces of [
    { top: ALL4, bottom: ALL4 },
    { top: ALL4, bottom: FRONT_BACK },
    { top: ALL4 },
    { top: ALL4, bottom: ALL4, side: ALL4 },
  ]) {
    const p = priceRow({ ...ROW_A, faceEdges: faces, rate: 10, pairRate: 15 });
    assert.equal(
      p.pairedFeet * 2 + p.singleFeet, p.runningFeet,
      `paired x2 + single should equal runningFeet for ${JSON.stringify(faces)}`,
    );
  }
});

test("THE SIDE BAND NEVER PAIRS — it is a different surface", () => {
  const p = priceRow({
    ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4, side: ALL4 }, rate: 10, pairRate: 15,
  });
  // The perimeter pairs; the band is its own pass at the ordinary rate.
  assert.equal(p.pairedFeet, 505);
  assert.equal(p.singleFeet, 505);
  assert.equal(p.edgeCost, 505 * 15 + 505 * 10);   // 7,575 + 5,050
});

test("ONE FACE ALONE IS NEVER DISCOUNTED, whichever face it is", () => {
  for (const faces of [{ top: ALL4 }, { bottom: ALL4 }]) {
    const p = priceRow({ ...ROW_A, faceEdges: faces, rate: 10, pairRate: 15 });
    assert.equal(p.pairedFeet, 0, "nothing shares two faces here");
    assert.equal(p.edgeCost, 5050, "505 ft x Rs10, the ordinary rate");
  }
});

test("A CIRCLE PAIRS ALL OR NOTHING — one ring, no sides to compare", () => {
  const C = { lengthIn: 24, widthIn: 24, quantity: 10, sinkQuantity: 0, thicknessMm: 20, shape: "CIRCLE" };
  const ring = { round: true };
  const both = priceRow({ ...C, faceEdges: { top: ring, bottom: ring }, rate: 10, pairRate: 15 });
  const one  = priceRow({ ...C, faceEdges: { top: ring }, rate: 10, pairRate: 15 });
  assert.ok(both.pairedFeet > 0 && both.singleFeet === 0);
  assert.equal(one.pairedFeet, 0);
  // pi x 24 x 10 / 12 = 62.8333... ft. THE MONEY COMES FROM THE UNROUNDED
  // FIGURE, rounded once at the end — 62.8333 x 15 = Rs942.50, not the Rs942.45
  // that rounding the feet to 62.83 first would give. Deliberate: rounding four
  // buckets and then adding them loses paise, and this path only runs on rows
  // that actually use the new per-face rates, so there is no historical figure
  // to preserve. A row that does not use them takes the old line untouched —
  // see the uniformRate branch in priceRow.
  assert.equal(both.edgeCost, 942.5);
  assert.equal(one.edgeCost, 628.33);
});
function round2Money(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

test("A PAIR RATE MEANS NOTHING UNDER PER PIECE OR LUMP SUM", () => {
  // It is a rate per FOOT. Those modes price the piece or the row outright and
  // have no per-face arithmetic to discount, so it is ignored — and the screen
  // hides the box for the same reason.
  const perPiece = priceRow({
    ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 },
    rate: 150, pairRate: 15, pricingMode: "PER_PIECE",
  });
  assert.equal(perPiece.edgeCost, 9000, "60 x Rs150, untouched by the pair rate");
  assert.equal(perPiece.pairRate, null);
  // The FEET are still measured — they are a fact about the stone — but no rate
  // per foot is in play, so every face rate reports null.
  assert.equal(perPiece.rateTop, null);
  assert.equal(perPiece.pairEffectiveRate, null);
});

test("NULL PAIR RATE IS THE OLD BEHAVIOUR, TO THE PAISA", () => {
  // The compatibility story, and the only test that matters for the rows
  // already in the database — every one of which has pair_rate NULL.
  const faces = { top: ALL4, bottom: ALL4 };
  const before = priceRow({ ...ROW_A, sinkQuantity: 30, faceEdges: faces });
  const after  = priceRow({ ...ROW_A, sinkQuantity: 30, faceEdges: faces, pairRate: null });
  assert.deepEqual(after, before);
  // Row A on both faces at the card rate: 1,010 ft, Rs15,150 edge, Rs6,900 sink.
  assert.equal(before.runningFeet, 1010);
  assert.equal(before.edgeCost, 15150);
  assert.equal(before.total, 22050);
  // THE SPLIT IS NOW ALWAYS REPORTED — scripts/0070 prices each face from it,
  // so it is no longer zeroed when the pair box is empty. The MONEY above is
  // what must not move, and does not: with no pair rate a shared side costs
  // top + bottom, which is Rs15 + Rs15 from the card, which is the Rs30 a
  // perimeter-foot that summing the two faces always charged.
  assert.equal(before.pairedFeet, 505, "505 ft of stone, done on both faces");
  assert.equal(before.singleFeet, 0);
  assert.equal(before.pairEffectiveRate, 30, "card + card, the old sum");
  assert.equal(before.pairedFeet * 2 + before.singleFeet, before.runningFeet);
});

test("ZERO IS A REAL PAIR RATE — the second face thrown in", () => {
  const p = priceRow({ ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 }, rate: 10, pairRate: 0 });
  assert.equal(p.pairRate, 0, "zero is honoured; NULL is not zero");
  assert.equal(p.edgeCost, 0);
});

test("THE FROZEN SHARE CARRIES THE DISCOUNT", () => {
  // What packaging stamps onto each piece. Rs7,575 over 60 = Rs126.25 a piece,
  // not the Rs168.33 the undiscounted figure would have written permanently.
  const s = rowShares({ ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 }, rate: 10, pairRate: 15 });
  assert.equal(s.edge, 126.25);
  assert.equal(mayFreeze(s), true);
});

test("THE HAND BENCH IS QUOTED THE SAME WAY", () => {
  // A piece flipped once is a piece flipped once, whoever is holding it.
  const piece = { lengthIn: 28, widthIn: 22.5, thicknessMm: 20, shape: "RECTANGLE" };
  const h = handPieceCharge(
    { byHand: true, faceEdges: { top: ALL4, bottom: ALL4 }, rate: 10, pairRate: 15,
      pricingMode: null, totalOverride: null },
    piece,
  );
  // One piece: perimeter 101 in = 8.41666... ft paired, at Rs15 = Rs126.25.
  // From the UNROUNDED feet, as above; 8.42 x 15 would have been Rs126.30.
  assert.equal(h?.unpriced, false);
  assert.equal(h?.edge, 126.25);
  // And the prefill carries it to the next piece off the same broken machine.
  const pre = prefillFrom({ byHand: true, faceEdges: null, rate: 10, pairRate: 15,
                            pricingMode: null, totalOverride: 999 });
  assert.equal(pre?.pairRate, 15);
  assert.equal(pre?.totalOverride, null, "the agreed total never travels");
});


// ═══════════════════════════════════════════════════════════════════════════
//  A RATE PER FACE — scripts/0070
// ═══════════════════════════════════════════════════════════════════════════
//
// The owner: "bottom edge have diff price sometime, top have diff price
// sometime and side have different price sometime." And the rule, in his words:
//
//   "Top have their rate, bottom have their rate. If pair rate is empty use the
//    sum, if something is written use this new rate, that's it. Side is diff."
//
// scripts/0067 made the three SELECTIONS independent and left the PRICE shared,
// so all three faces were charged the same rupees per foot. Choosing
// independently and paying identically is half a feature.

test("NOTHING TYPED PRICES EXACTLY AS IT DID BEFORE 0070", () => {
  // THE ONLY TEST THAT MATTERS FOR THE LIVE DATABASE. Every row in it has all
  // three face rates NULL, so each falls back to edge_rate and then to the card
  // — and the four-way arithmetic collapses to the single multiplication that
  // priced them yesterday.
  const cases: Array<[string, Record<string, unknown>, number]> = [
    ["top on four",            { faceEdges: { top: ALL4 } },                             7575],
    ["top and bottom on four", { faceEdges: { top: ALL4, bottom: ALL4 } },              15150],
    ["all three faces",        { faceEdges: { top: ALL4, bottom: ALL4, side: ALL4 } },  22725],
    ["legacy edges, one face", { edges: ALL4 },                                          7575],
    ["legacy edges, BOTH",     { edges: ALL4, edgeFace: "BOTH" },                       15150],
  ];
  for (const [name, extra, expected] of cases) {
    const p = priceRow({ ...ROW_A, ...extra });
    assert.equal(p.edgeCost, expected, name);
    assert.equal(p.unpriced, false, name);
    // Every face fell back to the same card figure, which is why it collapses.
    assert.equal(p.rateTop, 15);
    assert.equal(p.rateBottom, 15);
    assert.equal(p.rateSide, 15);
  }
});

test("HIS CASE: top Rs10, bottom Rs8, side Rs12 — three different answers", () => {
  const r = { rateTop: 10, rateBottom: 8, rateSide: 12 };
  assert.equal(priceRow({ ...ROW_A, faceEdges: { top: ALL4 }, ...r }).edgeCost, 5050);
  assert.equal(priceRow({ ...ROW_A, faceEdges: { bottom: ALL4 }, ...r }).edgeCost, 4040);
  assert.equal(priceRow({ ...ROW_A, faceEdges: { side: ALL4 }, ...r }).edgeCost, 6060);
  // The three are genuinely independent — no two of them agree.
  assert.notEqual(5050, 4040);
  assert.notEqual(4040, 6060);
});

test("PAIR BOX EMPTY USES THE SUM; WRITTEN, IT REPLACES IT", () => {
  const r = { rateTop: 10, rateBottom: 8, rateSide: 12 };
  const faces = { top: ALL4, bottom: ALL4 };

  const summed = priceRow({ ...ROW_A, faceEdges: faces, ...r });
  assert.equal(summed.pairEffectiveRate, 18, "Rs10 + Rs8");
  assert.equal(summed.edgeCost, 9090, "505 ft x Rs18");

  const quoted = priceRow({ ...ROW_A, faceEdges: faces, ...r, pairRate: 15 });
  assert.equal(quoted.pairEffectiveRate, 15, "the typed figure wins outright");
  assert.equal(quoted.edgeCost, 7575, "505 ft x Rs15");
});

test("THE UNEVEN CASE, WITH THREE RATES AND A BAND", () => {
  // Top on four, bottom on front+back only, side band on four.
  //   front+back  280 ft shared      -> Rs18 (10 + 8)  = 5,040
  //   left+right  225 ft top only    -> Rs10           = 2,250
  //   the band    505 ft             -> Rs12           = 6,060
  const p = priceRow({
    ...ROW_A,
    faceEdges: { top: ALL4, bottom: FRONT_BACK, side: ALL4 },
    rateTop: 10, rateBottom: 8, rateSide: 12,
  });
  assert.equal(p.pairedFeet, 280);
  assert.equal(p.topOnlyFeet, 225);
  assert.equal(p.bottomOnlyFeet, 0);
  assert.equal(p.sideBandFeet, 505);
  assert.equal(p.edgeCost, 13350);
});

test("A FACE LEFT EMPTY FALLS BACK — row rate first, then the card", () => {
  // Only the bottom is quoted; top and side take the row's own Rs20.
  const p = priceRow({
    ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4, side: ALL4 },
    rate: 20, rateBottom: 5,
  });
  assert.equal(p.rateTop, 20, "falls back to the row rate, not the card");
  assert.equal(p.rateBottom, 5, "its own");
  assert.equal(p.rateSide, 20);
  //   505 shared x (20 + 5) = 12,625
  //   505 band   x 20       = 10,100
  assert.equal(p.edgeCost, 22725);
});

test("THE SIDE BAND NEVER SHARES A RATE WITH A FLAT FACE", () => {
  // Two rows identical but for the band's rate. Only the band's money moves.
  const base = { ...ROW_A, faceEdges: { top: ALL4, side: ALL4 }, rateTop: 10 };
  const cheap = priceRow({ ...base, rateSide: 2 });
  const dear  = priceRow({ ...base, rateSide: 40 });
  assert.equal(cheap.topOnlyFeet, dear.topOnlyFeet);
  assert.equal(cheap.edgeCost, 505 * 10 + 505 * 2);
  assert.equal(dear.edgeCost,  505 * 10 + 505 * 40);
});

test("ZERO IS A REAL FACE RATE — the underside thrown in", () => {
  const p = priceRow({ ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 }, rateTop: 10, rateBottom: 0 });
  assert.equal(p.rateBottom, 0, "zero is honoured; NULL would have fallen back to the card");
  assert.equal(p.pairEffectiveRate, 10);
  assert.equal(p.edgeCost, 5050);
});

test("FACE RATES ARE IGNORED UNDER PER PIECE AND LUMP SUM", () => {
  // They are rupees per FOOT. Those modes price the piece or the row outright.
  const p = priceRow({
    ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 },
    rate: 150, rateTop: 10, rateBottom: 8, rateSide: 12, pricingMode: "PER_PIECE",
  });
  assert.equal(p.edgeCost, 9000, "60 x Rs150");
  assert.equal(p.rateTop, null, "not applicable, and reported as such");
});

test("THE FROZEN SHARE AND THE HAND BENCH BOTH CARRY THE FACE RATES", () => {
  const s = rowShares({
    ...ROW_A, faceEdges: { top: ALL4, bottom: ALL4 }, rateTop: 10, rateBottom: 8,
  });
  assert.equal(s.edge, 151.5, "Rs9,090 over 60 pieces");

  const h = handPieceCharge(
    { byHand: true, faceEdges: { top: ALL4, bottom: ALL4 },
      rate: null, pairRate: null, rateTop: 10, rateBottom: 8, rateSide: null,
      pricingMode: null, totalOverride: null },
    { lengthIn: 28, widthIn: 22.5, thicknessMm: 20, shape: "RECTANGLE" },
  );
  assert.equal(h?.unpriced, false);
  // 101 in / 12 = 8.41666... ft x Rs18 = Rs151.50, from the unrounded feet.
  assert.equal(h?.edge, 151.5);

  const pre = prefillFrom({ byHand: true, faceEdges: null, rate: null, pairRate: 15,
                            rateTop: 10, rateBottom: 8, rateSide: 12,
                            pricingMode: null, totalOverride: 999 });
  assert.equal(pre?.rateTop, 10);
  assert.equal(pre?.rateSide, 12);
  assert.equal(pre?.totalOverride, null, "the agreed total still never travels");
});
