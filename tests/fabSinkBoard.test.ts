import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSinkQuantity, describeSlabSinkRow, plainColumnRows, planSinkAssignment, resolveSinkRow,
  resolveSlabSinkRow, sinkColumnRows, sinkColumnVisible,
  slabPlainColumnRows, slabSinkColumnRows, slabSinkColumnVisible,
} from "../src/lib/fab/sinkBoard.ts";
import { resolveSinkQuantity } from "../src/lib/fab/requirement-derive.ts";

// The sink board. One column of piece rows; clicking or dragging a row sends it
// right, where a Sink column APPEARS to hold it. It saves on every click, it
// undoes, and when the Sink column empties it is gone again.
//
// Everything it stores is fab_requirement.sink_quantity:
//   NULL   not looked at yet      0      looked at, no sinks
//   n      n of the row's pieces  = qty  all of them
//
// NULL and 0 route identically, which is exactly why the difference has to be
// tested rather than assumed: nothing downstream will ever complain about
// getting one when it expected the other.

/* -- Full quantity is the default ------------------------------------------ */

test("a row moved across takes its whole quantity", () => {
  // The owner's rule: full quantity by default, a partial split is what he
  // types. A board that defaulted to 1 would need ten clicks per row.
  assert.equal(defaultSinkQuantity(10), 10);
  assert.equal(defaultSinkQuantity(1), 1);

  const plan = planSinkAssignment({ requested: defaultSinkQuantity(10), orderedQuantity: 10 });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.sinkQuantity, 10);

  const row = resolveSinkRow({ requirementId: "r1", quantity: 10, sinkQuantity: 10 });
  assert.equal(row.sinkQuantity, 10);
  assert.equal(row.plainQuantity, 0);
  // Not a split: the whole row is on the right, so the left column drops it.
  assert.equal(row.split, false);
});

/* -- A partial split ------------------------------------------------------- */

test("3 of the 10 splits the row across both columns", () => {
  const plan = planSinkAssignment({ requested: 3, orderedQuantity: 10 });
  assert.equal(plan.ok, true);

  const row = resolveSinkRow({ requirementId: "r1", quantity: 10, sinkQuantity: 3 });
  assert.equal(row.sinkQuantity, 3);
  assert.equal(row.plainQuantity, 7);
  assert.equal(row.split, true);

  // And it is visible on BOTH sides — that is what "the row visibly splits"
  // means, and a row that only appeared on one side would look like seven
  // pieces had gone missing.
  const rows = [{ requirementId: "r1", quantity: 10, sinkQuantity: 3 }];
  assert.deepEqual(sinkColumnRows(rows).map(r => [r.requirementId, r.sinkQuantity]), [["r1", 3]]);
  assert.deepEqual(plainColumnRows(rows).map(r => [r.requirementId, r.plainQuantity]), [["r1", 7]]);
});

/* -- Back to zero ---------------------------------------------------------- */

test("a row dragged back to the left keeps nothing, and says so deliberately", () => {
  const plan = planSinkAssignment({ requested: 0, orderedQuantity: 10 });
  // 0 is a legitimate answer, not an error: it is how a row comes back from the
  // Sink column and how he says "none of these".
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.sinkQuantity, 0);

  const row = resolveSinkRow({ requirementId: "r1", quantity: 10, sinkQuantity: 0 });
  assert.equal(row.sinkQuantity, 0);
  assert.equal(row.plainQuantity, 10);
  assert.equal(row.split, false);
  // Touched, though — "he looked and said none" is a different fact from
  // "nobody has looked at this row", and the column is nullable to hold it.
  assert.equal(row.decided, true);
  assert.equal(resolveSinkRow({ requirementId: "r1", quantity: 10, sinkQuantity: null }).decided, false);
});

/* -- Rejecting more than were ordered -------------------------------------- */

test("more sinks than pieces is refused, not quietly rounded down", () => {
  // A supervisor typing 12 into a row of 10 has misread something. Answering
  // "saved" while storing 10 tells him he got what he asked for.
  const plan = planSinkAssignment({ requested: 12, orderedQuantity: 10 });
  assert.equal(plan.ok, false);
  assert.match(plan.ok === false ? plan.error : "", /Only 10 piece\(s\) were ordered/);

  // Exactly the ordered quantity is the boundary and is fine.
  assert.equal(planSinkAssignment({ requested: 10, orderedQuantity: 10 }).ok, true);
});

test("negatives, junk and a row with nothing ordered are all refused", () => {
  assert.equal(planSinkAssignment({ requested: -1, orderedQuantity: 10 }).ok, false);
  assert.equal(planSinkAssignment({ requested: Number.NaN, orderedQuantity: 10 }).ok, false);
  assert.equal(planSinkAssignment({ requested: null, orderedQuantity: 10 }).ok, false);
  assert.equal(planSinkAssignment({ requested: undefined, orderedQuantity: 10 }).ok, false);
  assert.equal(planSinkAssignment({ requested: 1, orderedQuantity: 0 }).ok, false);
  // Half a sink is not a thing; a number input can still produce one.
  const fractional = planSinkAssignment({ requested: 3.7, orderedQuantity: 10 });
  assert.equal(fractional.ok, true);
  assert.equal(fractional.ok && fractional.sinkQuantity, 3);
});

test("everything it accepts is already inside the stored range", () => {
  // The route writes plan.sinkQuantity through resolveSinkQuantity, which is
  // what release-project reads the column back with. If the two ever disagreed,
  // the board would be promising something other than what gets cut — so for
  // every accepted value the pair must be a no-op.
  for (const requested of [0, 1, 3, 9, 10]) {
    const plan = planSinkAssignment({ requested, orderedQuantity: 10 });
    assert.equal(plan.ok, true);
    if (!plan.ok) continue;
    assert.equal(resolveSinkQuantity(plan.sinkQuantity, 10), plan.sinkQuantity);
  }
});

/* -- Does the Sink column exist at all? ------------------------------------ */

test("the Sink column is not there before the first assignment", () => {
  // THE BOARD STARTS EMPTY ON THE RIGHT. Every row of a freshly imported PO has
  // sink_quantity NULL, and nothing — not the piece width, not the old
  // sink_cuts column — puts a row on the right before the supervisor does.
  const fresh = [
    { requirementId: "r1", quantity: 10, sinkQuantity: null },
    { requirementId: "r2", quantity: 4, sinkQuantity: null },
    { requirementId: "r3", quantity: 1, sinkQuantity: null },
  ];
  assert.equal(sinkColumnVisible(fresh), false);
  assert.equal(sinkColumnRows(fresh).length, 0);
  assert.equal(plainColumnRows(fresh).length, 3);
});

test("one assignment brings the column into existence", () => {
  const rows = [
    { requirementId: "r1", quantity: 10, sinkQuantity: 3 },
    { requirementId: "r2", quantity: 4, sinkQuantity: null },
  ];
  assert.equal(sinkColumnVisible(rows), true);
  assert.equal(sinkColumnRows(rows).length, 1);
});

test("the column vanishes when the last row leaves it", () => {
  // The undo case, and the drag-back case. After the last row goes home the
  // board is one column again — an empty Sink column left on screen asserts
  // "these rows have no sinks" about a decision nobody made.
  const before = [{ requirementId: "r1", quantity: 10, sinkQuantity: 10 }];
  assert.equal(sinkColumnVisible(before), true);

  const after = [{ requirementId: "r1", quantity: 10, sinkQuantity: 0 }];
  assert.equal(sinkColumnVisible(after), false);
  assert.equal(sinkColumnRows(after).length, 0);

  // Undo all the way back to "not looked at" — also empty, also gone.
  const undone = [{ requirementId: "r1", quantity: 10, sinkQuantity: null }];
  assert.equal(sinkColumnVisible(undone), false);
});

test("a row deliberately set to zero does not keep the column alive", () => {
  // 0 means he looked and said none, so that row belongs on the left with
  // everything else. Only a row with pieces in it holds the column open.
  const rows = [
    { requirementId: "r1", quantity: 10, sinkQuantity: 0 },
    { requirementId: "r2", quantity: 4, sinkQuantity: 0 },
  ];
  assert.equal(sinkColumnVisible(rows), false);
  assert.equal(plainColumnRows(rows).length, 2);
});

test("a partial split holds the column open, and emptying it closes it", () => {
  const split = [
    { requirementId: "r1", quantity: 10, sinkQuantity: 3 },
    { requirementId: "r2", quantity: 4, sinkQuantity: 0 },
  ];
  assert.equal(sinkColumnVisible(split), true);
  // Both columns hold r1; only the left holds r2.
  assert.equal(sinkColumnRows(split).length, 1);
  assert.equal(plainColumnRows(split).length, 2);

  const emptied = split.map(r => ({ ...r, sinkQuantity: 0 }));
  assert.equal(sinkColumnVisible(emptied), false);
});

/* -- Stale data ------------------------------------------------------------ */

test("a sink count left behind by a reduced order is shown as the order, not as more", () => {
  // sink_quantity is written by this board and quantity by the PO import. A
  // quantity reduced afterwards leaves a sink count larger than the row it
  // belongs to. "12 of 10 have sinks" is worse than 10, and release clamps the
  // same way — the board must not disagree with what will be cut.
  const row = resolveSinkRow({ requirementId: "r1", quantity: 10, sinkQuantity: 12 });
  assert.equal(row.sinkQuantity, 10);
  assert.equal(row.plainQuantity, 0);
  assert.equal(row.split, false);
  assert.equal(resolveSinkQuantity(12, 10), 10);
});

/* -- The same board, scoped to ONE SLAB ------------------------------------ */

// The board moved under the slab's piece rows: same two columns, same click,
// same stored column, but the rows it holds are the ones on the slab in front
// of him. What changes is that TWO quantities are now on screen at once, and
// only one of them is what a click writes.

test("a row on a slab shows this slab's share and the ordered quantity, and they are different numbers", () => {
  // 60 tops, cut 12 to a slab. He is looking at 12; his click writes 60.
  const row = resolveSlabSinkRow({
    requirementId: "r1", quantity: 60, sinkQuantity: null, onThisSlab: 12,
  });
  assert.equal(row.onThisSlab, 12);
  assert.equal(row.quantity, 60);
  // Untouched: nothing is pre-filled on the right.
  assert.equal(row.sinkQuantity, 0);
  assert.equal(row.decided, false);
  assert.equal(row.plainQuantity, 60);
});

test("marking it writes the FULL ordered quantity, not the slab's share", () => {
  // The failure this guards: a card reading 12 while the click writes 60. The
  // default a click sends is the ordered quantity, and the server accepts it.
  assert.equal(defaultSinkQuantity(60), 60);
  const plan = planSinkAssignment({ requested: defaultSinkQuantity(60), orderedQuantity: 60 });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.sinkQuantity, 60);

  const marked = resolveSlabSinkRow({
    requirementId: "r1", quantity: 60, sinkQuantity: 60, onThisSlab: 12,
  });
  assert.equal(marked.sinkQuantity, 60);
  assert.equal(marked.plainQuantity, 0);
  // 60 marked, 12 of them here: the decision reaches past this slab and the
  // card has to say so, because his next click changes all 60.
  assert.equal(marked.appliesBeyondThisSlab, true);
});

test("the caption carries both numbers, in these words", () => {
  // Pinned deliberately. The failure is silent: a card that reads 12 while the
  // click writes 60 looks perfectly reasonable and is wrong, so the wording
  // that makes the two impossible to confuse is a test and not a template.
  assert.equal(
    describeSlabSinkRow({ requirementId: "r1", quantity: 60, sinkQuantity: 60, onThisSlab: 12 }),
    "12 on this slab · 60 ordered · sink 60/60",
  );
  assert.equal(
    describeSlabSinkRow({ requirementId: "r1", quantity: 60, sinkQuantity: null, onThisSlab: 12 }),
    "12 on this slab · 60 ordered · sink 0/60",
  );
});

test("on the next slab the same row is already in the Sink column", () => {
  // He decides once, on slab 1. Slabs 2 to 5 show it on the right without
  // re-asking, because the decision is stored against the order row.
  const slabTwo = [{ requirementId: "r1", quantity: 60, sinkQuantity: 60, onThisSlab: 12 }];
  assert.equal(slabSinkColumnVisible(slabTwo), true);
  assert.deepEqual(
    slabSinkColumnRows(slabTwo).map(r => [r.requirementId, r.sinkQuantity, r.onThisSlab]),
    [["r1", 60, 12]],
  );
  // And it is off the left entirely — every ordered piece has a sink.
  assert.equal(slabPlainColumnRows(slabTwo).length, 0);
});

test("a decision that covers only this slab's share does not claim to reach further", () => {
  // 12 of the 60 marked, and 12 are here. appliesBeyondThisSlab is about the
  // count, not about the row being split — the card must not warn about other
  // slabs when nothing on them changed.
  const row = resolveSlabSinkRow({
    requirementId: "r1", quantity: 60, sinkQuantity: 12, onThisSlab: 12,
  });
  assert.equal(row.appliesBeyondThisSlab, false);
  assert.equal(row.split, true);
  assert.equal(row.plainQuantity, 48);
});

test("the Sink column appears and vanishes on the slab's own rows", () => {
  // The same rule as the project-wide board, asked of one slab: it is not
  // chrome that is always there and sometimes empty.
  const untouched = [
    { requirementId: "r1", quantity: 60, sinkQuantity: null, onThisSlab: 12 },
    { requirementId: "r2", quantity: 4, sinkQuantity: null, onThisSlab: 4 },
  ];
  assert.equal(slabSinkColumnVisible(untouched), false);
  assert.equal(slabPlainColumnRows(untouched).length, 2);

  const first = untouched.map(r => (r.requirementId === "r1" ? { ...r, sinkQuantity: 60 } : r));
  assert.equal(slabSinkColumnVisible(first), true);
  assert.equal(slabSinkColumnRows(first).length, 1);
  assert.equal(slabPlainColumnRows(first).length, 1);

  // And gone again when the last row leaves it. 0 does not hold it open.
  const emptied = first.map(r => ({ ...r, sinkQuantity: 0 }));
  assert.equal(slabSinkColumnVisible(emptied), false);
  assert.equal(slabSinkColumnRows(emptied).length, 0);
});

test("a split row is on both sides of the slab board, showing its share on each", () => {
  const rows = [{ requirementId: "r1", quantity: 60, sinkQuantity: 45, onThisSlab: 12 }];
  assert.deepEqual(
    slabSinkColumnRows(rows).map(r => [r.requirementId, r.sinkQuantity]), [["r1", 45]],
  );
  assert.deepEqual(
    slabPlainColumnRows(rows).map(r => [r.requirementId, r.plainQuantity]), [["r1", 15]],
  );
  // Both cards still say which slab they are on and what was ordered.
  assert.equal(describeSlabSinkRow(rows[0]), "12 on this slab · 60 ordered · sink 45/60");
});

test("a stale sink count is clamped on the slab board too", () => {
  // Same tolerance as the project-wide board: the ordered quantity was reduced
  // after the sink count was written. Never show more sinks than there is row.
  const row = resolveSlabSinkRow({
    requirementId: "r1", quantity: 10, sinkQuantity: 12, onThisSlab: 4,
  });
  assert.equal(row.sinkQuantity, 10);
  assert.equal(row.plainQuantity, 0);
  assert.equal(row.appliesBeyondThisSlab, true);
  assert.equal(describeSlabSinkRow({
    requirementId: "r1", quantity: 10, sinkQuantity: 12, onThisSlab: 4,
  }), "4 on this slab · 10 ordered · sink 10/10");
});
