import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDGES, ALL_EDGES, RATE_CARD, PRICED_THICKNESS_MM, INCHES_PER_FOOT,
  rateFor, thicknessLabel, edgeInchesPerPiece, runningFeet, edgeCount,
  priceRow, sumPricing, formatRupees,
  serializeEdges, parseEdges, describeEdges,
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
// AND THE COUNT IS THE OTHER THING TO GET RIGHT. The owner: "this part is only
// for the sink cut pieces — the fabrication, pieces only which can come to
// fabrication." Edge work IS fabrication work, and requirement-derive.ts has
// always said fabricationRequired = sinkRequired. So the feet are counted over
// the SINK pieces, not the ordered quantity: a row of 60 with 30 sinks is 30
// pieces' worth of edge, and charging all 60 bills double.

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
  // 60 pieces of 28 × 22.5, all four edges, 30 of them with a sink.
  // Only those 30 reach fabrication, so only those 30 carry edge work:
  //   edge  252.5 ft × ₹15  = ₹3,787.50
  //   sink     30 pcs × ₹230 = ₹6,900
  //                            ₹10,687.50
  const p = priceRow({
    lengthIn: 28, widthIn: 22.5, quantity: 60,
    sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES,
  });
  assert.equal(p.runningFeet, 252.5);
  assert.equal(p.edgeCost, 3787.5);
  assert.equal(p.sinkPieces, 30);
  assert.equal(p.fabricationPieces, 30);
  assert.equal(p.sinkCost, 6900);
  assert.equal(p.total, 10687.5);
  assert.equal(p.rate?.nominalMm, 20);
  assert.equal(p.unpriced, false);
  // The whole-row figure is HALF AGAIN this — the bug this test now pins.
  assert.equal(runningFeet(28, 22.5, 60, ALL_EDGES), 505);
  assert.notEqual(p.runningFeet, 505);
});

test("A ROW WITH NO SINKS IS NOT A FABRICATION ROW — and is not 'unpriced' either", () => {
  // The owner: "only the pieces which can come to fabrication." A plain piece is
  // cut, machine-polished and shipped; it never reaches the fabricator. Choosing
  // all four edges on such a row must not conjure a charge.
  const p = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: ALL_EDGES });
  assert.equal(p.fabricationPieces, 0);
  assert.equal(p.runningFeet, 0);
  assert.equal(p.edgeCost, 0);
  assert.equal(p.total, 0);
  // NOTHING IS OWED is not the same as NOTHING IS KNOWN. unpriced means the
  // thickness is off the card and a figure is missing; this row is complete.
  assert.equal(p.unpriced, false);
  assert.equal(p.rate?.nominalMm, 20);

  // NULL — the supervisor has not decided — is likewise not a fabrication row.
  const q = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: null, thicknessMm: 20, edges: ALL_EDGES });
  assert.equal(q.fabricationPieces, 0);
  assert.equal(q.edgeCost, 0);
});

test("the same row in 3 cm costs more, on both charges", () => {
  const two = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES });
  const three = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 30, edges: ALL_EDGES });
  assert.equal(three.edgeCost, 5050);    // 252.5 × 20
  assert.equal(three.sinkCost, 9000);    //    30 × 300
  assert.equal(three.total, 14050);
  assert.ok(three.edgeCost > two.edgeCost);
  assert.ok(three.sinkCost > two.sinkCost);
  // Same stone, same edges, same sink count — only the rate moved.
  assert.equal(three.runningFeet, two.runningFeet);
});

test("SINKS ARE PER PIECE AND EDGES PER FOOT — swapping them is the expensive mistake", () => {
  // Charging edge work per PIECE instead of per foot on this row:
  //   wrong    30 × ₹15 =   ₹450
  //   right 252.5 × ₹15 = ₹3,787.50
  const p = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES });
  assert.notEqual(p.edgeCost, 30 * 15);
  assert.equal(p.edgeCost, 252.5 * 15);
  // And charging sinks per foot instead of per piece:
  const q = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: {} });
  assert.equal(q.edgeCost, 0, "no edges selected, so no edge charge");
  assert.equal(q.sinkCost, 30 * 230, "sinks are per piece and do not depend on edges");
});

test("a stale sink count cannot charge for pieces that do not exist", () => {
  // sink_quantity larger than the order — the same clamp planSlabRelease applies,
  // and it now caps the EDGE charge too, because the feet ride on the same count.
  const p = priceRow({ lengthIn: 28, widthIn: 4, quantity: 60, sinkQuantity: 90, thicknessMm: 20, edges: ALL_EDGES });
  assert.equal(p.sinkPieces, 60);
  assert.equal(p.fabricationPieces, 60);
  assert.equal(p.sinkCost, 60 * 230);
  assert.equal(p.runningFeet, runningFeet(28, 4, 60, ALL_EDGES), "capped at the order, not 90");
});

test("AN UNPRICED THICKNESS IS SAID OUT LOUD, not charged at a neighbour's rate", () => {
  const p = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 12, edges: ALL_EDGES });
  assert.equal(p.unpriced, true);
  assert.equal(p.rate, null);
  assert.equal(p.edgeCost, 0);
  assert.equal(p.sinkCost, 0);
  assert.equal(p.total, 0);
  // The feet are still counted — the work happened, only the rate is missing.
  assert.equal(p.runningFeet, 252.5);
  assert.equal(p.fabricationPieces, 30);
});

test("totals: a project's charge is the sum of its rows, and says what it skipped", () => {
  // Rows A and B of PO 10026 on 2 cm stone, plus one row on unpriced 12 mm.
  // Row B and the 12 mm row have no sinks, so neither carries edge work — the
  // 12 mm row is still counted as unpriced, because its RATE is the thing
  // missing and that stays true whatever its sink count is.
  const rows = [
    priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES }),
    priceRow({ lengthIn: 28, widthIn: 4,    quantity: 60, sinkQuantity: 60, thicknessMm: 20, edges: { front: true } }),
    priceRow({ lengthIn: 34, widthIn: 22.5, quantity: 60, sinkQuantity: 0,  thicknessMm: 12, edges: ALL_EDGES }),
  ];
  const t = sumPricing(rows);
  assert.equal(t.runningFeet, 252.5 + 140 + 0);
  assert.equal(t.edgeCost, 3787.5 + 2100);
  assert.equal(t.sinkCost, 6900 + 60 * 230);
  assert.equal(t.total, 3787.5 + 2100 + 6900 + 60 * 230);
  // The skipped row is REPORTED. A total that quietly omits a row is worse
  // than one that says it did.
  assert.equal(t.unpricedRows, 1);
  // The total equals the sum of the column, to the paisa.
  assert.equal(t.total, rows.reduce((n, r) => n + r.total, 0));
  const empty = sumPricing([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.unpricedRows, 0);
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
});
