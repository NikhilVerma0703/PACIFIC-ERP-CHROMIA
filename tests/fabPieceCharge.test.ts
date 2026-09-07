import { test } from "node:test";
import assert from "node:assert/strict";
import { rowShares, pieceCharge, frozenCharge, mayFreeze, NO_CHARGE } from "../src/lib/fab/pieceCharge.ts";
import { ALL_EDGES } from "../src/lib/fab/pricing.ts";

// WHAT ONE PACKED PIECE EARNED — and why it has to be written down.
//
// The period report re-prices from the LIVE ordered row every time it is
// opened, so a row edited in September changed what July earned:
//
//     July      60 pieces packed, one face   ->  505 ft   ->  ₹7,575
//     September somebody sets edge_faces=BOTH
//     July      the same report, reopened    ->  1,010 ft ->  ₹15,150
//
// Nothing was re-done and nothing re-billed; a closed month simply read
// differently than it had. These are the two halves of the fix: the arithmetic
// that gets stamped onto the piece at packing (rowShares / pieceCharge) and the
// rule for reading a stamp back (frozenCharge).

// Row A of PO 10026, the row every figure in this project is checked against:
// 60 pieces of 28 × 22.5 in, all four edges, 30 with sinks, 2 cm stone.
const ROW_A = {
  lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30,
  thicknessMm: 20, edges: ALL_EDGES,
};

test("TWO DIVISORS — a mixed row pays every piece what that piece is worth", () => {
  const s = rowShares(ROW_A);
  assert.equal(s.edge, 126.25, "₹7,575 over the 60 that carry edge work");
  assert.equal(s.sink, 230, "₹6,900 over the 30 that carry a sink");
  assert.equal(s.rowHasEdgeWork, true);

  // Packing the whole row rebuilds it exactly. A sink piece earns BOTH shares;
  // a plain piece earns only the edge one.
  const sinkPiece = pieceCharge(s, true);
  const plainPiece = pieceCharge(s, false);
  assert.deepEqual(sinkPiece, { edge: 126.25, sink: 230 });
  assert.deepEqual(plainPiece, { edge: 126.25, sink: 0 });
  assert.equal(
    (sinkPiece.edge + sinkPiece.sink) * 30 + (plainPiece.edge + plainPiece.sink) * 30,
    7575 + 6900,
    "no paise lost, nothing double counted",
  );
});

test("A ROW WITH NO EDGE WORK PAYS NO EDGE SHARE, however the piece is asked", () => {
  // rowHasEdgeWork is a ROW fact, because a row is homogeneous — a row where
  // only some pieces want edge polish is split into two rows instead.
  const s = rowShares({ ...ROW_A, edges: {} });
  assert.equal(s.rowHasEdgeWork, false);
  assert.equal(s.edge, 0);
  assert.deepEqual(pieceCharge(s, true), { edge: 0, sink: 230 });
  assert.deepEqual(pieceCharge(s, false), { edge: 0, sink: 0 });
});

test("BOTH FACES DOUBLES WHAT EVERY PIECE OF THE ROW EARNED", () => {
  // The reason the freeze exists at all. Same row, one word different.
  const one = rowShares(ROW_A);
  const both = rowShares({ ...ROW_A, edgeFace: "BOTH" });
  assert.equal(both.edge, one.edge * 2, "the same line walked twice");
  assert.equal(both.sink, one.sink, "and the sink is untouched by it");
  assert.equal(both.edge, 252.5);
});

test("A PIECE WITH NO ROW EARNS NOTHING — never a guess", () => {
  // It is still counted as packed by the caller; what it is worth is simply not
  // knowable, and an invented rate is indistinguishable from a real one the
  // moment it is written.
  assert.deepEqual(pieceCharge(null, true), NO_CHARGE);
  assert.deepEqual(pieceCharge(undefined, false), NO_CHARGE);
  // …and the returned object is a copy, so a caller cannot mutate the constant.
  const c = pieceCharge(null, true);
  c.edge = 999;
  assert.equal(NO_CHARGE.edge, 0);
});

test("AN UNPRICEABLE SHAPE FREEZES THE SINK AND NOT THE EDGE", () => {
  // An L, a curve or a custom outline has no perimeter here. The sink is a flat
  // per-piece rate and is still owed; stamping the edge at a rectangle's
  // perimeter would freeze a number nobody measured — permanently.
  const s = rowShares({ ...ROW_A, shape: "L_SHAPE" });
  assert.equal(s.edge, 0);
  assert.equal(s.sink, 230);
  // The pieces still reach the bench, so the row still SAYS it has edge work —
  // it is the money that is withheld, not the polishing.
  assert.equal(s.rowHasEdgeWork, true);
  assert.deepEqual(pieceCharge(s, true), { edge: 0, sink: 230 });
});

test("A ROW THAT CANNOT BE PRICED AT ALL FREEZES ZEROES, not NaN", () => {
  // 12 mm stone is off the rate card. Both shares are zero and the report says
  // so; what must never happen is a NaN reaching a SUM in Postgres, which turns
  // a whole day's money into NaN and cannot be undone.
  const s = rowShares({ ...ROW_A, thicknessMm: 12 });
  assert.equal(s.edge, 0);
  assert.equal(s.sink, 0);
  for (const v of [s.edge, s.sink]) assert.ok(Number.isFinite(v));

  // And a row of junk.
  const junk = rowShares({
    lengthIn: null, widthIn: undefined, quantity: NaN,
    sinkQuantity: -5, thicknessMm: null, edges: null,
  });
  assert.ok(Number.isFinite(junk.edge) && Number.isFinite(junk.sink));
  assert.deepEqual(pieceCharge(junk, true), { edge: 0, sink: 0 });
});

test("PER-PIECE IS NOT ROUNDED — the rounding happens once, at the sum", () => {
  // ₹100 over 3 pieces is 33.333…, and three of those must still be ₹100.
  // THIS IS WHY charged_edge IS DOUBLE PRECISION AND NOT NUMERIC(12,2): storing
  // 33.33 loses a paisa here and a rupee across a project, which is how a total
  // stops equalling its own column.
  const s = rowShares({
    lengthIn: 10, widthIn: 10, quantity: 3, sinkQuantity: 0,
    thicknessMm: 20, edges: { front: true },
  });
  // 10 in × 3 pieces / 12 = 2.5 ft × ₹15 = ₹37.50, over 3 = ₹12.50 exactly — so
  // pick a count that does not divide cleanly to make the point.
  //
  // 10 in × 7 / 12 = 5.83 ft (the FEET round to 2dp, once) × ₹15 = ₹87.45, and
  // ₹87.45 over 7 pieces is ₹12.492857… — a figure with no exact 2dp form.
  const awkward = rowShares({
    lengthIn: 10, widthIn: 10, quantity: 7, sinkQuantity: 0,
    thicknessMm: 20, edges: { front: true },
  });
  assert.ok(Math.abs(s.edge * 3 - 37.5) < 1e-9);
  assert.notEqual(awkward.edge, Math.round(awkward.edge * 100) / 100);
  assert.ok(Math.abs(awkward.edge * 7 - 87.45) < 1e-9, "seven shares rebuild the row");
  // Rounding each share to the paisa and summing loses money — this is the exact
  // amount, on one row of seven pieces, that DOUBLE PRECISION exists to keep.
  assert.notEqual(Math.round(awkward.edge * 100) / 100 * 7, 87.45);
});

test("A STAMP IS READ BY ITS TIMESTAMP — because ZERO IS A REAL ANSWER", () => {
  // The whole fallback turns on this. A plain piece on a row with no sink and no
  // edge work was stamped 0/0 and must STAY zero even if somebody marks that
  // row's edges next month. There is no rupee value that can mean "never
  // asked", so charged_at carries that fact instead.
  assert.deepEqual(
    frozenCharge({ charged_at: new Date("2026-07-15"), charged_edge: 0, charged_sink: 0 }),
    { edge: 0, sink: 0 },
    "a zero stamp is a stamp",
  );
  assert.equal(
    frozenCharge({ charged_at: null, charged_edge: 126.25, charged_sink: 230 }),
    null,
    "money without a timestamp is not a stamp — re-price it live",
  );
  assert.equal(frozenCharge(null), null);
  assert.equal(frozenCharge(undefined), null);
  assert.equal(frozenCharge({}), null);

  // The real one.
  assert.deepEqual(
    frozenCharge({ charged_at: new Date(), charged_edge: 126.25, charged_sink: 230 }),
    { edge: 126.25, sink: 230 },
  );

  // Postgres hands DOUBLE PRECISION back as a number, but a driver that
  // stringifies it — or a NULL beside a present charged_at — must not become
  // NaN and poison a day's total.
  assert.deepEqual(
    frozenCharge({ charged_at: "2026-07-15T00:00:00Z", charged_edge: "126.25", charged_sink: null }),
    { edge: 126.25, sink: 0 },
  );
  assert.deepEqual(
    frozenCharge({ charged_at: new Date(), charged_edge: "oops", charged_sink: undefined }),
    { edge: 0, sink: 0 },
  );
});

test("THE STAMP AND THE LIVE PRICE AGREE ON THE DAY IT IS WRITTEN", () => {
  // They must, or the report would step the day scripts/0066 lands. Same row,
  // both paths, same answer — and then the row moves and only one of them does.
  const s = rowShares(ROW_A);
  const live = pieceCharge(s, true);
  const stamp = frozenCharge({ charged_at: new Date(), charged_edge: live.edge, charged_sink: live.sink });
  assert.deepEqual(stamp, live);

  // September: somebody sets BOTH. The live price doubles; the stamp does not.
  const after = pieceCharge(rowShares({ ...ROW_A, edgeFace: "BOTH" }), true);
  assert.equal(after.edge, 252.5);
  assert.equal(stamp!.edge, 126.25, "July does not move");
});

test("AN UNPRICEABLE ROW IS NEVER FROZEN — the audit finding this file exists to hold", () => {
  // THE REGRESSION, and it was found by two independent auditors on the same day.
  //
  // priceRow has THREE states, not two: priced; priced at zero because nothing
  // was ordered; and COULD NOT BE PRICED, which also returns zero but with
  // `unpriced: true`. rowShares dropped that flag at the module boundary, so the
  // packaging route stamped the third state onto the piece as though somebody
  // had agreed it — and the stamp is written once, `AND charged_at IS NULL`, so
  // nothing in the application could ever correct it.
  //
  // scripts/0061-fab-slab-thickness-repair.sql is the precedent: slab
  // thicknesses of 120 and 70 mm WERE stored in this production database and
  // repaired afterwards. A trolley packed in between would have been frozen at
  // Rs0 and the repair could never have reached it.
  const good = rowShares(ROW_A);
  assert.equal(good.unpriced, false);
  assert.equal(good.unpricedReason, null);
  assert.equal(mayFreeze(good), true, "a clean row is the only thing that freezes");

  // 12 mm stone: off the rate card. EVERYTHING is zero and none of it is agreed.
  const offCard = rowShares({ ...ROW_A, thicknessMm: 120 });
  assert.deepEqual([offCard.edge, offCard.sink], [0, 0]);
  assert.equal(offCard.unpricedReason, "THICKNESS");
  assert.equal(mayFreeze(offCard), false, "Rs21,375 would have been frozen at Rs0");

  // Blank width: the edge half is unknown, the sink half is owed. Still not
  // frozen — freezing the pair would make the missing half permanent.
  const noWidth = rowShares({ ...ROW_A, widthIn: null });
  assert.equal(noWidth.sink, 230, "the sink is still computed");
  assert.equal(noWidth.edge, 0);
  assert.equal(noWidth.unpricedReason, "DIMENSIONS");
  assert.equal(mayFreeze(noWidth), false);

  // An L, a curve, a custom outline: waiting on a human quote.
  assert.equal(mayFreeze(rowShares({ ...ROW_A, shape: "L_SHAPE" })), false);
  assert.equal(rowShares({ ...ROW_A, shape: "CURVE" }).unpricedReason, "SHAPE");

  // A circle marked with a rectangle's four sides — the two halves of the row
  // contradict each other, so neither is frozen.
  assert.equal(mayFreeze(rowShares({ ...ROW_A, shape: "CIRCLE" })), false);

  // And a piece with no row at all is never frozen, because it can never be
  // priced — now or later.
  assert.equal(mayFreeze(null), false);
  assert.equal(mayFreeze(undefined), false);

  // NOT FROZEN IS NOT LOST. Every one of these still has a live answer, and the
  // report goes on computing it until the row is fixed.
  assert.deepEqual(pieceCharge(noWidth, true), { edge: 0, sink: 230 });
});

test("A CIRCLE MARKED WITH FOUR SIDES IS UNPRICED, not silently free", () => {
  // hasEdgeWork answers each shape in its own vocabulary, so a CIRCLE carrying
  // "front,back,left,right" said "no edge work" — Rs0 with unpriced: false.
  // Four edges marked on the order, nothing charged, no flag anywhere.
  const circle = rowShares({ ...ROW_A, shape: "CIRCLE", edges: ALL_EDGES });
  assert.equal(circle.unpricedReason, "EDGES");
  assert.equal(circle.edge, 0);
  assert.equal(circle.sink, 230, "the sink is unaffected by the contradiction");

  // And the mirror: a rectangle carrying the round token.
  assert.equal(rowShares({ ...ROW_A, edges: { round: true } }).unpricedReason, "EDGES");

  // NO EDGES CHOSEN IS NOT A CONTRADICTION and must stay silent — it is the
  // ordinary case, and flagging it would put an amber box on half the shop.
  const plain = rowShares({ ...ROW_A, edges: {} });
  assert.equal(plain.unpriced, false);
  assert.equal(plain.unpricedReason, null);
  assert.equal(mayFreeze(plain), true, "a row with no edge work still freezes its sink");
  assert.equal(plain.sink, 230);

  // A circle marked round, and a rectangle marked with sides, are both fine.
  assert.equal(rowShares({ ...ROW_A, shape: "CIRCLE", edges: { round: true } }).unpriced, false);
  assert.equal(rowShares({ ...ROW_A, edges: ALL_EDGES }).unpriced, false);
});
