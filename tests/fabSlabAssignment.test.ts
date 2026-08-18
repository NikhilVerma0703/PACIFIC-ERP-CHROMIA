import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocatedTotal, assignedPieceCount, decideAllocation, decideSendToCutting,
  remainingQuantity, slabLossPieces,
} from "../src/lib/fab/slabAssignment.ts";
import { computeSlabLoss, STANDARD_SLAB_MM } from "../src/lib/fab/slabLoss.ts";

// The slab-first board's arithmetic. Two things are being pinned here:
//
//   1. THE SUM OF allocated_quantity ACROSS SLABS NEVER EXCEEDS THE ORDER.
//      Over-allocating does not overproduce — buildReleasePlan caps the piece
//      count at the ordered quantity — it silently DROPS the excess, so a
//      cutter standing at the second slab is handed pieces that were never
//      created. Nothing downstream notices; the shortfall surfaces at the
//      packing bench.
//   2. THE LOSS FIGURES, which are what gets frozen into fab_slab_job when the
//      slab is sent to cutting. Slab in millimetres, pieces in inches.

/* -- Remaining quantity across several slabs ------------------------------- */

test("remaining is the order minus every slab it is already split across", () => {
  // One piece row of 10, spread over three slabs as a real CLO plan would.
  const allocations = [
    { id: "a1", allocatedQuantity: 4 },
    { id: "a2", allocatedQuantity: 3 },
    { id: "a3", allocatedQuantity: 1 },
  ];
  assert.equal(allocatedTotal(allocations), 8);
  assert.equal(remainingQuantity(10, allocations), 2);
});

test("the row being edited is not counted against itself", () => {
  // THE BUG THIS PREVENTS. A row fully allocated 4-and-6; the supervisor opens
  // the 4 and types 5. Counting all allocations makes that look like a request
  // for 15 of 10 and refuses a change that is obviously fine. Excluding the row
  // under the cursor is what makes an adjustment possible at all.
  const allocations = [
    { id: "a1", allocatedQuantity: 4 },
    { id: "a2", allocatedQuantity: 6 },
  ];
  assert.equal(remainingQuantity(10, allocations), 0);
  // With a1 set aside, 6 are spoken for and 4 is the room a1 is allowed.
  assert.equal(remainingQuantity(10, allocations, "a1"), 4);

  // Holding it where it is: allowed, even though the row is full.
  assert.equal(
    decideAllocation({
      orderedQuantity: 10, existing: allocations, allocationId: "a1",
      requestedQuantity: 4, label: "PO 10026 Row 7",
    }).ok,
    true,
  );
  // Raising it past what the other slab holds: refused, and the refusal knows
  // the other slab is the reason.
  const raised = decideAllocation({
    orderedQuantity: 10, existing: allocations, allocationId: "a1",
    requestedQuantity: 5, label: "PO 10026 Row 7",
  });
  assert.equal(raised.ok, false);
  assert.equal(raised.ok === false && raised.remaining, 4);
});

test("an already over-allocated row reads as nothing left, never as headroom", () => {
  // Legacy data: a CLO import that put 12 against an order of 10. A signed
  // remainder would be -2, and `wanted <= remaining` would then reject
  // everything including a correction — but it must also never come out
  // POSITIVE by some later arithmetic and let another piece through.
  const allocations = [{ id: "a1", allocatedQuantity: 12 }];
  assert.equal(remainingQuantity(10, allocations), 0);
});

test("junk quantities in the ledger are floored, not trusted", () => {
  // A fractional or negative allocated_quantity is data damage. Counting -3 as
  // -3 would manufacture three pieces of head-room out of a corrupt row.
  const allocations = [
    { id: "a1", allocatedQuantity: -3 },
    { id: "a2", allocatedQuantity: 2.9 },
    { id: "a3", allocatedQuantity: Number.NaN },
  ];
  assert.equal(allocatedTotal(allocations), 2);
  assert.equal(remainingQuantity(5, allocations), 3);
});

/* -- The refusal, exactly at the boundary ---------------------------------- */

test("the last piece is allowed and the one after it is refused", () => {
  const existing = [
    { id: "a1", allocatedQuantity: 4 },
    { id: "a2", allocatedQuantity: 3 },
  ];
  const base = { orderedQuantity: 10, existing, allocationId: null, label: "PO 10026 Row 7" };

  // Exactly the remainder: allowed, and nothing is left afterwards.
  const exact = decideAllocation({ ...base, requestedQuantity: 3 });
  assert.equal(exact.ok, true);
  assert.equal(exact.ok && exact.allocatedQuantity, 3);
  assert.equal(exact.ok && exact.remainingAfter, 0);

  // One more than the remainder: refused. THE BOUNDARY. An off-by-one here is
  // an eleventh piece allocated against an order of ten, which release then
  // drops on the floor.
  const over = decideAllocation({ ...base, requestedQuantity: 4 });
  assert.equal(over.ok, false);
  assert.equal(over.ok === false && over.remaining, 3);
});

test("the refusal names the row and says how many are actually left", () => {
  // A bare "409 conflict" sends the supervisor back to the board to work out
  // what happened. His next question is always "then how many can I put on?",
  // so the answer is in the sentence.
  const decision = decideAllocation({
    orderedQuantity: 10,
    existing: [{ id: "a1", allocatedQuantity: 7 }],
    allocationId: null,
    requestedQuantity: 5,
    label: "PO 10026 Row 7",
  });
  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.match(decision.error, /PO 10026 Row 7/);
  assert.match(decision.error, /only 3 of 10/);
  assert.match(decision.error, /7 already assigned/);
  assert.match(decision.error, /Reduce it to 3/);
});

test("a fully allocated row refuses everything, including one piece", () => {
  const existing = [{ id: "a1", allocatedQuantity: 6 }];
  const decision = decideAllocation({
    orderedQuantity: 6, existing, allocationId: null, requestedQuantity: 1, label: "D-101 piece 2B",
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.remaining, 0);
});

test("zero and fractions are not an allocation", () => {
  const base = {
    orderedQuantity: 10, existing: [], allocationId: null, label: "PO 10026 Row 7",
  };
  // Zero is how a row gets removed, and removal is a DELETE — writing an
  // allocation of 0 leaves a row on the slab claiming no pieces.
  assert.equal(decideAllocation({ ...base, requestedQuantity: 0 }).ok, false);
  assert.equal(decideAllocation({ ...base, requestedQuantity: -2 }).ok, false);
  assert.equal(decideAllocation({ ...base, requestedQuantity: Number.NaN }).ok, false);
  // 2.7 pieces is not a thing; it becomes 2 rather than being refused, because
  // the number arrived from a number input and the intent is unambiguous.
  const fractional = decideAllocation({ ...base, requestedQuantity: 2.7 });
  assert.equal(fractional.ok, true);
  assert.equal(fractional.ok && fractional.allocatedQuantity, 2);
});

test("a row with nothing ordered cannot be put on a slab at all", () => {
  const decision = decideAllocation({
    orderedQuantity: 0, existing: [], allocationId: null, requestedQuantity: 1, label: "PO 10026 Row 7",
  });
  assert.equal(decision.ok, false);
  assert.match(decision.ok === false ? decision.error : "", /no ordered quantity/);
});

test("filling a row across three slabs, one add at a time, lands exactly on the order", () => {
  // The whole flow, as the supervisor does it: 10 pieces, three slabs, and the
  // fourth attempt is refused because there is nothing left.
  const existing: { id: string; allocatedQuantity: number }[] = [];
  const label = "PO 10026 Row 7";
  const adds = [4, 3, 3];

  adds.forEach((n, i) => {
    const d = decideAllocation({
      orderedQuantity: 10, existing, allocationId: null, requestedQuantity: n, label,
    });
    assert.equal(d.ok, true, `add ${i + 1} of ${n} should be allowed`);
    if (d.ok) existing.push({ id: `a${i + 1}`, allocatedQuantity: d.allocatedQuantity });
  });

  assert.equal(allocatedTotal(existing), 10);
  assert.equal(remainingQuantity(10, existing), 0);
  const fourth = decideAllocation({
    orderedQuantity: 10, existing, allocationId: null, requestedQuantity: 1, label,
  });
  assert.equal(fourth.ok, false);
});

/* -- The loss on a realistic slab ------------------------------------------ */

// A kitchen off one standard Pacific slab: two island tops, three splashbacks
// and four small returns. The numbers below are what fab_slab_job stores.
const KITCHEN = [
  { lengthIn: 96, widthIn: 26, allocatedQuantity: 2 },
  { lengthIn: 36, widthIn: 26, allocatedQuantity: 3 },
  { lengthIn: 25, widthIn: 22, allocatedQuantity: 4 },
];

test("a realistic slab: 9 pieces, 69.44 sqft used of 75.16, 7.61% waste", () => {
  const loss = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: slabLossPieces(KITCHEN),
  });

  assert.equal(assignedPieceCount(KITCHEN), 9);
  assert.equal(loss.slabAreaSqft, 75.16);
  assert.equal(loss.usedAreaSqft, 69.44);
  assert.equal(loss.remainingAreaSqft, 5.72);
  assert.equal(loss.totalWastagePct, 7.61);
  // Nothing reclaimed, so every leftover square foot is scrap.
  assert.equal(loss.trueScrapPct, 7.61);
  assert.equal(loss.overCommitted, false);

  const send = decideSendToCutting({
    slabLabel: "Slab 1350",
    assignedPieceCount: assignedPieceCount(KITCHEN),
    overCommitted: loss.overCommitted,
    usedAreaSqft: loss.usedAreaSqft,
    slabAreaSqft: loss.slabAreaSqft,
  });
  assert.equal(send.ok, true);
});

test("slabLossPieces charges the ALLOCATED quantity, not the ordered one", () => {
  // THE MISTAKE THIS EXISTS TO STOP. A row of 10 split 3-and-7 across two slabs
  // must cost each slab its own share. Feeding computeSlabLoss the requirement's
  // ordered quantity charges 10 to both, and two slabs that between them hold
  // the job read as over-committed.
  const split = slabLossPieces([{ lengthIn: 96, widthIn: 26, allocatedQuantity: 3 }]);
  assert.deepEqual(split, [{ lengthIn: 96, widthIn: 26, quantity: 3 }]);

  const loss = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: split,
  });
  assert.equal(loss.usedAreaSqft, 52);
  assert.equal(loss.overCommitted, false);
});

test("over-committed: the figures go negative and the slab is refused, not clamped", () => {
  const tooMuch = [...KITCHEN, { lengthIn: 96, widthIn: 26, allocatedQuantity: 2 }];
  const loss = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: slabLossPieces(tooMuch),
  });

  assert.equal(loss.usedAreaSqft, 104.11);
  assert.equal(loss.remainingAreaSqft, -28.95);
  assert.equal(loss.totalWastagePct, -38.52);
  assert.equal(loss.overCommitted, true);

  const send = decideSendToCutting({
    slabLabel: "Slab 1350",
    assignedPieceCount: assignedPieceCount(tooMuch),
    overCommitted: loss.overCommitted,
    usedAreaSqft: loss.usedAreaSqft,
    slabAreaSqft: loss.slabAreaSqft,
  });
  // Refused. A negative wastage written into fab_slab_job outlives the mistake
  // that caused it, and clamping it to zero would send a cutter to a slab that
  // physically cannot hold the work.
  assert.equal(send.ok, false);
  if (send.ok) return;
  assert.match(send.error, /Slab 1350/);
  assert.match(send.error, /over-committed/);
  assert.match(send.error, /104\.11 sqft/);
  assert.match(send.error, /28\.95 sqft too much/);
  assert.match(send.error, /nothing was sent to the cutter/i);
});

test("an empty slab is not sent to the cutter", () => {
  const loss = computeSlabLoss({
    slabLengthMm: STANDARD_SLAB_MM.lengthMm,
    slabWidthMm: STANDARD_SLAB_MM.widthMm,
    pieces: [],
  });
  const send = decideSendToCutting({
    slabLabel: "Slab 1350",
    assignedPieceCount: assignedPieceCount([]),
    overCommitted: loss.overCommitted,
    usedAreaSqft: loss.usedAreaSqft,
    slabAreaSqft: loss.slabAreaSqft,
  });
  assert.equal(send.ok, false);
  assert.match(send.ok === false ? send.error : "", /nothing for the cutter to cut/);
});

test("a slab with no stored dimensions is still sendable, and its wastage is unknown", () => {
  // apply-slab-excel creates fab_slab rows with no length or width at all
  // (totalArea: 0). computeSlabLoss answers null rather than 0% for those, and
  // overCommitted is false — an unknown denominator is not evidence that the
  // pieces do not fit, and refusing on it would block every CLO-imported slab.
  const loss = computeSlabLoss({ slabLengthMm: null, slabWidthMm: null, pieces: slabLossPieces(KITCHEN) });
  assert.equal(loss.slabAreaSqft, 0);
  assert.equal(loss.usedAreaSqft, 69.44);
  assert.equal(loss.totalWastagePct, null);
  assert.equal(loss.trueScrapPct, null);
  assert.equal(loss.overCommitted, false);

  const send = decideSendToCutting({
    slabLabel: "Slab 1350",
    assignedPieceCount: assignedPieceCount(KITCHEN),
    overCommitted: loss.overCommitted,
    usedAreaSqft: loss.usedAreaSqft,
    slabAreaSqft: loss.slabAreaSqft,
  });
  assert.equal(send.ok, true);
});
