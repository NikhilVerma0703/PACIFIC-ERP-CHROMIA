import { test } from "node:test";
import assert from "node:assert/strict";
import { priceRow, ALL_EDGES } from "../src/lib/fab/pricing.ts";
import { costPerSlab, type CostedRow } from "../src/lib/fab/slabCosting.ts";

// THE PRICE FOR THAT PARTICULAR WORK — scripts/0071.
//
// The owner, on the supervisor's hand-polish card: "now it's like showing the
// full quantity price at below when doing this — no, I need the price only for
// that particular quantity, because sometimes price differs, we may enter
// different prices."
//
// And on the CEO board: "as we have project and slab wise, I need to see the
// slab-wise cost and the subdivisions also. Be precise."
//
// Both are the same complaint: a total is the wrong feedback when the thing
// being checked is one rate on one face, or one slab out of five. So priceRow
// returns its buckets and costPerSlab returns its shares.
//
// THE TEST THAT MATTERS IN BOTH IS THE RECONCILIATION. A breakdown that does
// not add up to the line above it is worse than no breakdown — somebody spends
// an afternoon on the difference and finds a rounding bug rather than a fact.
// Every case below asserts the sum.

/** Row A of PO 10026: 60 pieces of 28 x 22.5 in, all four edges, 2 cm stone.
 *  Perimeter 101 in a piece; 505 ft over 60 pieces on one face. */
const A = {
  lengthIn: 28, widthIn: 22.5, quantity: 60,
  sinkQuantity: 0, thicknessMm: 20, edges: ALL_EDGES,
};

/** Every bucket added up. What the card prints down the panel. */
function linesTotal(lines: Array<{ cost: number }>): number {
  return Math.round(lines.reduce((t, l) => t + l.cost, 0) * 100) / 100;
}

test("the buckets add up to the charge — one rate, every face, the old path", () => {
  // ALL THREE FACE RATES NULL is every row in the database: they fall back to
  // the row rate and then to the card, priceRow takes its single-multiplication
  // branch, and the buckets are rounded separately. They must still sum.
  const p = priceRow({
    ...A,
    faceEdges: { top: ALL_EDGES, bottom: ALL_EDGES, side: ALL_EDGES },
  });
  assert.equal(p.unpriced, false);
  assert.ok(p.edgeLines.length > 0, "three faces on four sides is not nothing");
  assert.equal(linesTotal(p.edgeLines), p.edgeCost,
    "the panel under the boxes must equal the charge at the foot of the card");
});

test("a 10-piece circle on both faces — the fifteen-paise case, reconciled", () => {
  // The rounding drift the pricing module documents: 125.67 ft x Rs15 is not
  // 62.83 ft x Rs30. Whichever the charge takes, the buckets follow it.
  const p = priceRow({
    lengthIn: 48, widthIn: 48, quantity: 10, sinkQuantity: 0, thicknessMm: 20,
    shape: "CIRCLE",
    faceEdges: { top: { round: true }, bottom: { round: true } },
  });
  assert.equal(p.unpriced, false);
  assert.equal(linesTotal(p.edgeLines), p.edgeCost);
});

test("a rate per face — each bucket carries its OWN rate, and they still sum", () => {
  const p = priceRow({
    ...A,
    faceEdges: { top: ALL_EDGES, bottom: { front: true, back: true }, side: ALL_EDGES },
    rateTop: 20, rateBottom: 8, rateSide: 5,
  });
  assert.equal(p.unpriced, false);
  assert.equal(linesTotal(p.edgeLines), p.edgeCost);

  const byKey = new Map(p.edgeLines.map((l) => [l.key, l]));
  // front and back are on BOTH faces, so they are the PAIR bucket, charged once
  // at top + bottom. left and right are top-only.
  assert.equal(byKey.get("PAIR")?.rate, 28, "no pair rate typed, so the two are added");
  assert.equal(byKey.get("TOP")?.rate, 20);
  assert.equal(byKey.get("SIDE")?.rate, 5);
  assert.equal(byKey.get("BOTTOM"), undefined,
    "nothing is bottom-only here — front and back are shared and paired");
});

test("THE SAME AGREED FIGURE ON ALL THREE FACES IS CHARGED, NOT THE RATE CARD", () => {
  // The customer agreed Rs12 a foot and the supervisor typed it into all three
  // boxes. "All three faces agree" is also what an untouched row looks like, so
  // the single-multiplication branch took it — and multiplied by the CARD.
  // Row A on 2 cm stone billed 505 ft x Rs15 = Rs7,575 against an agreed
  // Rs6,060: Rs1,515 the customer never accepted, on one row.
  const agreed = priceRow({
    ...A, faceEdges: { top: ALL_EDGES },
    rateTop: 12, rateBottom: 12, rateSide: 12,
  });
  assert.equal(agreed.runningFeet, 505);
  assert.equal(agreed.rateSource, "CARD", "no ROW rate — the card is still the fallback");
  assert.equal(agreed.edgeRate, 15, "…and it is still reported, unchanged");
  assert.equal(agreed.edgeCost, 6060, "505 ft x the agreed Rs12, not the card's Rs15");
  assert.equal(agreed.unpriced, false);
  // The panel beside the boxes shows the figure that was typed AND the money it
  // bought. Before the fix it printed Rs12 against a cost of Rs7,575.
  assert.equal(linesTotal(agreed.edgeLines), agreed.edgeCost);
  assert.equal(agreed.edgeLines.find((l) => l.key === "TOP")?.rate, 12);

  // AND THE ROW NOBODY HAS TOUCHED CANNOT MOVE. Every face empty falls back to
  // the same card figure, which is the identical multiplication as before.
  const untouched = priceRow({ ...A, faceEdges: { top: ALL_EDGES } });
  assert.equal(untouched.edgeCost, 7575, "505 ft x Rs15 — no quote already sent moves");
  assert.equal(untouched.rateTop, 15);
});

test("A ROW PRICED ONLY PER FACE STILL SHOWS ITS BUCKETS — off the card is not off the panel", () => {
  // 35 mm stone, or simply a row not on a slab yet: there is no card rate and no
  // row rate, so edgeRate is null while the top face carries Rs18 somebody
  // typed. The charge went through the per-face path and the breakdown did not:
  // an empty panel beside the box that priced it, and lines summing to 0 against
  // a charge of Rs9,090 — the invariant this whole file tests.
  const p = priceRow({ ...A, thicknessMm: 35, faceEdges: { top: ALL_EDGES }, rateTop: 18 });
  assert.equal(p.edgeRate, null, "no row rate and no card");
  assert.equal(p.rateTop, 18);
  assert.equal(p.edgeCost, 9090, "505 ft x Rs18");
  assert.equal(p.unpriced, false);
  assert.equal(p.edgeLines.length, 1);
  assert.equal(p.edgeLines[0].key, "TOP");
  assert.equal(p.edgeLines[0].rate, 18);
  assert.equal(linesTotal(p.edgeLines), p.edgeCost);
});

test("A SHARED SIDE APPEARS IN BOTH FACES' PANELS, because it belongs to both", () => {
  const p = priceRow({
    ...A,
    faceEdges: { top: ALL_EDGES, bottom: ALL_EDGES },
  });
  const pair = p.edgeLines.find((l) => l.key === "PAIR");
  assert.ok(pair, "all four sides on both faces is four shared sides");
  // The card filters the lines by face. A bucket priced once cannot be charged
  // to one of the two faces without inventing a figure, so it shows in either.
  assert.deepEqual([...pair!.faces].sort(), ["bottom", "top"]);
});

test("a pair rate replaces the sum on the shared bucket and nowhere else", () => {
  const p = priceRow({
    ...A,
    faceEdges: { top: ALL_EDGES, bottom: { front: true, back: true } },
    rate: 10, pairRate: 15,
  });
  const byKey = new Map(p.edgeLines.map((l) => [l.key, l]));
  assert.equal(byKey.get("PAIR")?.rate, 15, "the quoted pair figure, not 10 + 10");
  assert.equal(byKey.get("TOP")?.rate, 10, "left and right are one face at the ordinary rate");
  assert.equal(linesTotal(p.edgeLines), p.edgeCost);
});

test("per piece and lump sum are ONE line — they have no feet to bucket", () => {
  const perPiece = priceRow({
    ...A, faceEdges: { top: ALL_EDGES }, pricingMode: "PER_PIECE", rate: 150,
  });
  assert.equal(perPiece.edgeLines.length, 1);
  assert.equal(perPiece.edgeLines[0].key, "PIECES");
  assert.equal(perPiece.edgeLines[0].feet, 0, "a per-piece rate is not a rate per foot");
  assert.equal(linesTotal(perPiece.edgeLines), perPiece.edgeCost);

  const lump = priceRow({
    ...A, faceEdges: { top: ALL_EDGES }, pricingMode: "LUMP_SUM", rate: 5000,
  });
  assert.equal(lump.edgeLines.length, 1);
  assert.equal(lump.edgeLines[0].key, "LUMP");
  assert.equal(linesTotal(lump.edgeLines), 5000);
});

test("A ROW THAT CANNOT BE PRICED HAS NO BUCKETS — the feet rule, itemised", () => {
  // An L outline. The card must not print "280 ft of top at Rs15" beside a
  // charge of nothing: that is the same reconciliation trap the zeroed feet
  // exist to avoid.
  const p = priceRow({ ...A, shape: "L_SHAPE", faceEdges: { top: ALL_EDGES } });
  assert.equal(p.unpriced, true);
  assert.equal(p.unpricedReason, "SHAPE");
  assert.deepEqual(p.edgeLines, []);
  assert.equal(p.edgeCostPerPiece, 0);
});

test("an agreed total keeps the calculation's buckets beside it, not instead of it", () => {
  const p = priceRow({ ...A, faceEdges: { top: ALL_EDGES }, edgeTotalOverride: 4000 });
  assert.equal(p.edgeCost, 4000);
  assert.equal(p.edgeOverridden, true);
  // The buckets describe the CALCULATION, which is what the struck-through
  // figure beside the box shows. An override nobody can see past is how a wrong
  // rate card survives a year.
  assert.equal(linesTotal(p.edgeLines), p.calculatedEdgeCost);
  assert.notEqual(p.calculatedEdgeCost, 4000);
});

test("AN AGREED TOTAL ON A ROW WITH NO SIDES TICKED IS WORTH SOMETHING PER PIECE", () => {
  // The override exists precisely so nobody has to tick anything: an L-shaped
  // 60-piece row the module refuses to price, and a figure agreed on the phone.
  // Under RUNNING_FOOT the divisor was edgePieces — zero here — so the row read
  // Rs50,000 with every piece worth NOTHING, and packing froze that zero.
  const p = priceRow({
    ...A, shape: "L_SHAPE", edges: {}, faceEdges: {}, edgeTotalOverride: 50000,
  });
  assert.equal(p.edgeCost, 50000);
  assert.equal(p.unpriced, false, "a figure a human agreed beats a gap");
  assert.equal(p.edgePieces, 0, "no side is ticked — there are no feet to measure");
  assert.equal(p.chargePieces, 60, "the agreed total covers the ORDERED pieces");
  assert.equal(p.edgeCostPerPiece, 833.33);
  // Sixty shares rebuild the agreed figure, which is the whole point of the
  // divisor: what is frozen onto the pieces must add back up to what was agreed.
  assert.ok(Math.abs((50000 / p.chargePieces) * 60 - 50000) < 1e-9);
});

test("what one piece earned — the divisor is chargePieces, not the sink count", () => {
  const p = priceRow({
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30,
    thicknessMm: 20, edges: ALL_EDGES, faceEdges: { top: ALL_EDGES },
  });
  // 505 ft x Rs15 = Rs7,575 over 60 pieces.
  assert.equal(p.edgeCost, 7575);
  assert.equal(p.chargePieces, 60);
  assert.equal(p.edgeCostPerPiece, 126.25);
  // The ROW total is per ORDERED piece and includes the sinks, which only 30 of
  // them carry — two different divisors, and using one for both would misreport
  // whichever it was not.
  assert.equal(p.totalPerPiece, Math.round((p.total / 60) * 100) / 100);
  assert.notEqual(p.totalPerPiece, p.edgeCostPerPiece);
});

test("a fully hand-fabricated row still pays per piece — chargePieces, not edges", () => {
  // No edges ticked at all: the piece goes to the bench whole. Under PER_PIECE
  // that is still 60 x Rs150, and per piece is Rs150.
  const p = priceRow({
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0,
    thicknessMm: 20, pricingMode: "PER_PIECE", rate: 150,
  });
  assert.equal(p.edgeCost, 9000);
  assert.equal(p.edgeCostPerPiece, 150);
});

/* -- THE SUBDIVISIONS UNDER A SLAB ---------------------------------------- */

/** Row A, priced: 60 pieces, ₹7,575 edge + ₹6,900 sink over 30 sinks. */
function rowA(allocations: CostedRow["allocations"]): CostedRow {
  return {
    requirementId: "req-a", rowLetter: "A", quantity: 60,
    edgeCost: 7575, sinkCost: 6900,
    chargePieces: 60, sinkPieces: 30,
    unpriced: false, allocations,
  };
}
function rowB(allocations: CostedRow["allocations"]): CostedRow {
  return {
    requirementId: "req-b", rowLetter: "B", quantity: 20,
    edgeCost: 1200, sinkCost: 0,
    chargePieces: 20, sinkPieces: 0,
    unpriced: false, allocations,
  };
}

const S1 = { slabId: "s1", slabCode: "155765", colour: "Desert Silk" };
const S2 = { slabId: "s2", slabCode: "155766", colour: "Desert Silk" };

test("EVERY SLAB'S SUBDIVISIONS ADD UP TO ITS OWN LINE", () => {
  const c = costPerSlab([
    rowA([{ ...S1, allocatedQuantity: 22 }, { ...S2, allocatedQuantity: 38 }]),
    rowB([{ ...S1, allocatedQuantity: 20 }]),
  ]);
  assert.equal(c.slabs.length, 2);
  for (const s of c.slabs) {
    const edge = Math.round(s.breakdown.reduce((t, r) => t + r.edgeCost, 0) * 100) / 100;
    const sink = Math.round(s.breakdown.reduce((t, r) => t + r.sinkCost, 0) * 100) / 100;
    const tot  = Math.round(s.breakdown.reduce((t, r) => t + r.total, 0) * 100) / 100;
    assert.equal(edge, s.edgeCost, `${s.slabCode} edge`);
    assert.equal(sink, s.sinkCost, `${s.slabCode} sink`);
    assert.equal(tot, s.total, `${s.slabCode} total`);
  }
});

test("a subdivision says how many of the row's pieces came off THAT slab", () => {
  const c = costPerSlab([
    rowA([{ ...S1, allocatedQuantity: 22 }, { ...S2, allocatedQuantity: 38 }]),
  ]);
  const s1 = c.slabs.find((s) => s.slabId === "s1")!;
  const share = s1.breakdown.find((r) => r.requirementId === "req-a")!;
  assert.equal(share.pieces, 22);
  assert.equal(share.orderedQuantity, 60, "so the screen can say 22 of 60");
  assert.equal(share.rowLetter, "A");
  // Part of a row that carries sinks: which of the 22 have the cutout is
  // settled at the bench and is not recorded, so the sink share is flagged.
  assert.equal(share.sinkEstimated, true);
  // Edge money is exact — every piece of a row carries the same edge work.
  assert.equal(share.edgeCost, Math.round((7575 / 60) * 22 * 100) / 100);
});

test("a slab holding a WHOLE row is exact and is not flagged", () => {
  const c = costPerSlab([rowA([{ ...S1, allocatedQuantity: 60 }])]);
  const share = c.slabs[0].breakdown[0];
  assert.equal(share.pieces, 60);
  assert.equal(share.sinkEstimated, false, "all 30 sinks are on this slab, counted not guessed");
  assert.equal(share.sinkCost, 6900);
});

test("the pieces still waiting for stone are subdivided the same way", () => {
  const c = costPerSlab([rowA([{ ...S1, allocatedQuantity: 22 }])]);
  assert.equal(c.unallocated.pieces, 38);
  assert.equal(c.unallocated.breakdown.length, 1);
  const left = c.unallocated.breakdown[0];
  assert.equal(left.pieces, 38);
  assert.equal(left.rowLetter, "A");
  const tot = Math.round(c.unallocated.breakdown.reduce((t, r) => t + r.total, 0) * 100) / 100;
  assert.equal(tot, c.unallocated.total);
});

test("an unpriced row contributes pieces to a slab and no money — and says so", () => {
  const c = costPerSlab([{
    requirementId: "req-l", rowLetter: "L", quantity: 10,
    edgeCost: 0, sinkCost: 0, chargePieces: 10, sinkPieces: 0,
    unpriced: true, allocations: [{ ...S1, allocatedQuantity: 10 }],
  }]);
  const share = c.slabs[0].breakdown[0];
  assert.equal(share.pieces, 10);
  assert.equal(share.total, 0);
  assert.equal(share.unpriced, true, "the screen prints 'not costed' from this");
  assert.equal(c.slabs[0].unpricedRows, 1);
});

test("two allocations of one row to one slab are ONE subdivision, summed", () => {
  // It happens: a row allocated, part released, part added back. Two rows for
  // "Row A" under one slab would read as two different rows.
  const c = costPerSlab([rowB([
    { ...S1, allocatedQuantity: 8 },
    { ...S1, allocatedQuantity: 12 },
  ])]);
  assert.equal(c.slabs.length, 1);
  assert.equal(c.slabs[0].breakdown.length, 1);
  assert.equal(c.slabs[0].breakdown[0].pieces, 20);
  assert.equal(c.slabs[0].breakdown[0].total, 1200);
});

test("subdivisions come dearest first, and a tie does not reshuffle", () => {
  const c = costPerSlab([
    rowA([{ ...S1, allocatedQuantity: 60 }]),
    rowB([{ ...S1, allocatedQuantity: 20 }]),
  ]);
  const order = c.slabs[0].breakdown.map((r) => r.rowLetter);
  assert.deepEqual(order, ["A", "B"], "Rs14,475 above Rs1,200");
});
