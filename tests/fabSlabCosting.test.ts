import { test } from "node:test";
import assert from "node:assert/strict";
import { costPerSlab, type CostedRow } from "../src/lib/fab/slabCosting.ts";

// WHAT IS THIS SLAB WORTH.
//
// The owner: "in the ceo dashboard, show per slab whats the cost as we
// calculate."
//
// THE TEST THAT MATTERS IS THE RECONCILIATION. Every slab plus the pieces not
// yet on stone must equal the project total, on every fixture. A per-slab panel
// whose figures do not add up to the number printed above it is worse than no
// panel: somebody will spend an afternoon on the difference and find a rounding
// bug rather than a business fact.

/** Row A of PO 10026, priced: 60 pieces, four edges, 30 sinks, 2 cm.
 *  505 ft → ₹7,575 edge + ₹6,900 sink = ₹14,475. */
function rowA(allocations: CostedRow["allocations"]): CostedRow {
  return {
    requirementId: "req-a", rowLetter: "A", quantity: 60,
    edgeCost: 7575, sinkCost: 6900,
    chargePieces: 60, sinkPieces: 30,
    unpriced: false, allocations,
  };
}

const S1 = { slabId: "s1", slabCode: "155765", colour: "Desert Silk" };
const S2 = { slabId: "s2", slabCode: "155766", colour: "Desert Silk" };
const S3 = { slabId: "s3", slabCode: "155767", colour: "Desert Silk" };

test("a row spread over three slabs splits by the pieces on each", () => {
  const c = costPerSlab([rowA([
    { ...S1, allocatedQuantity: 22 },
    { ...S2, allocatedQuantity: 18 },
    { ...S3, allocatedQuantity: 20 },
  ])]);

  assert.equal(c.slabs.length, 3);
  assert.equal(c.unallocated.pieces, 0, "60 of 60 are on stone");

  // EDGE IS EXACT: ₹7,575 / 60 = ₹126.25 a piece.
  const s1 = c.slabs.find((s) => s.slabId === "s1")!;
  assert.equal(s1.pieces, 22);
  assert.equal(s1.edgeCost, 2777.5);           // 22 × 126.25
  // SINK IS APPORTIONED: 22/60 of ₹6,900 = ₹2,530.
  assert.equal(s1.sinkCost, 2530);
  assert.equal(s1.total, 5307.5);
  assert.equal(s1.sinkEstimated, true, "this slab holds an unknown number of the 30 sinks");

  // AND IT ALL ADDS UP.
  const summed = c.slabs.reduce((n, s) => n + s.total, 0) + c.unallocated.total;
  assert.equal(Math.round(summed * 100) / 100, 14475);
  assert.equal(c.total, 14475);
});

test("THE RECONCILIATION HOLDS WHEN HALF THE ROW IS NOT ON STONE YET", () => {
  // A project mid-planning. Most of its money SHOULD read as not yet allocated,
  // and dropping the remainder would make the panel quietly fail to add up.
  const c = costPerSlab([rowA([{ ...S1, allocatedQuantity: 25 }])]);

  assert.equal(c.slabs[0].pieces, 25);
  assert.equal(c.unallocated.pieces, 35);
  assert.equal(c.unallocated.rows, 1);

  assert.equal(c.slabs[0].edgeCost, 3156.25);        // 25 × 126.25
  assert.equal(c.unallocated.edgeCost, 4418.75);     // 35 × 126.25
  assert.equal(c.slabs[0].edgeCost + c.unallocated.edgeCost, 7575);

  const summed = c.slabs.reduce((n, s) => n + s.total, 0) + c.unallocated.total;
  assert.equal(Math.round(summed * 100) / 100, 14475);
});

test("a slab holding a WHOLE row's sinks is not flagged as an estimate", () => {
  // 60 of 60 on one slab: every one of the 30 sinks is on it. Nothing is
  // approximated, so the screen must not caveat it.
  const c = costPerSlab([rowA([{ ...S1, allocatedQuantity: 60 }])]);
  assert.equal(c.slabs[0].sinkEstimated, false);
  assert.equal(c.slabs[0].total, 14475);
  assert.equal(c.unallocated.total, 0);
});

test("AN UNPRICED ROW CONTRIBUTES PIECES, NEVER MONEY", () => {
  // An L-shaped outline, a blank width, an off-card thickness. The stone is on
  // the slab and is real; the figure does not exist and must not be invented.
  const c = costPerSlab([
    rowA([{ ...S1, allocatedQuantity: 60 }]),
    {
      requirementId: "req-b", rowLetter: "B", quantity: 10,
      edgeCost: 0, sinkCost: 0, chargePieces: 0, sinkPieces: 0,
      unpriced: true,
      allocations: [{ ...S1, allocatedQuantity: 10 }],
    },
  ]);

  assert.equal(c.slabs.length, 1);
  assert.equal(c.slabs[0].pieces, 70, "both rows' stone is on it");
  assert.equal(c.slabs[0].rows, 2);
  assert.equal(c.slabs[0].unpricedRows, 1, "and the screen can say which");
  assert.equal(c.slabs[0].total, 14475, "row B added nothing");
  assert.equal(c.total, 14475);
});

test("a per-piece row divides by chargePieces, not by ticked edges", () => {
  // 35 pieces fully hand fabricated at ₹150 — no edges ticked, so edgePieces is
  // 0 and chargePieces is 35. Dividing by the wrong one gives every slab ₹0
  // against a row costing ₹5,250. pieceCharge.rowShares had exactly this bug.
  const c = costPerSlab([{
    requirementId: "req-c", rowLetter: "C", quantity: 35,
    edgeCost: 5250, sinkCost: 0, chargePieces: 35, sinkPieces: 0,
    unpriced: false,
    allocations: [{ ...S2, allocatedQuantity: 20 }, { ...S3, allocatedQuantity: 15 }],
  }]);
  assert.equal(c.slabs.find((s) => s.slabId === "s2")!.edgeCost, 3000);   // 20 × 150
  assert.equal(c.slabs.find((s) => s.slabId === "s3")!.edgeCost, 2250);   // 15 × 150
  assert.equal(c.total, 5250);
});

test("slabs come back dearest first, and the order is stable on a tie", () => {
  const c = costPerSlab([rowA([
    { ...S1, allocatedQuantity: 10 },
    { ...S2, allocatedQuantity: 30 },
    { ...S3, allocatedQuantity: 20 },
  ])]);
  assert.deepEqual(c.slabs.map((s) => s.slabId), ["s2", "s3", "s1"]);
});

test("junk in the allocations cannot invent or destroy money", () => {
  // A negative allocation is corruption, not a credit. Zero-quantity rows are
  // skipped rather than creating an empty slab card.
  const c = costPerSlab([rowA([
    { ...S1, allocatedQuantity: -5 },
    { ...S2, allocatedQuantity: 0 },
    { ...S3, allocatedQuantity: 60 },
  ])]);
  assert.equal(c.slabs.length, 1, "only the real one");
  assert.equal(c.slabs[0].slabId, "s3");
  assert.equal(c.slabs[0].pieces, 60);
  assert.equal(c.unallocated.pieces, 0);
  assert.equal(c.total, 14475);
});

test("nothing at all is zero, not a crash", () => {
  for (const input of [null, undefined, []]) {
    const c = costPerSlab(input as CostedRow[] | null | undefined);
    assert.deepEqual(c.slabs, []);
    assert.equal(c.total, 0);
    assert.equal(c.unallocated.pieces, 0);
  }
});

test("MANY ROWS ON MANY SLABS STILL RECONCILE — the general case", () => {
  const rows: CostedRow[] = [
    rowA([{ ...S1, allocatedQuantity: 22 }, { ...S2, allocatedQuantity: 38 }]),
    {
      requirementId: "req-d", rowLetter: "D", quantity: 45,
      edgeCost: 3333.33, sinkCost: 1150, chargePieces: 45, sinkPieces: 5,
      unpriced: false,
      allocations: [{ ...S2, allocatedQuantity: 20 }, { ...S3, allocatedQuantity: 11 }],
    },
    {
      requirementId: "req-e", rowLetter: "E", quantity: 12,
      edgeCost: 999.99, sinkCost: 0, chargePieces: 12, sinkPieces: 0,
      unpriced: false, allocations: [],
    },
  ];
  const c = costPerSlab(rows);
  const summed = c.slabs.reduce((n, s) => n + s.total, 0) + c.unallocated.total;
  assert.equal(
    Math.round(summed * 100) / 100,
    c.total,
    "every slab plus the remainder must equal the project",
  );
  // ROUNDED, and the naive sum is not. 14475 + 3333.33 + 1150 + 999.99 is
  // 19958.320000000003 in binary float; the module rounds once at the end, and
  // that rounding is the whole reason money() exists. Asserting the raw sum
  // here would have been asserting the bug.
  assert.equal(c.total, 19958.32);
  // Row E is on no slab at all, so all of it is in the remainder.
  assert.ok(c.unallocated.pieces >= 12);
});
