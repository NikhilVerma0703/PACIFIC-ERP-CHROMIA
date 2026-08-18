import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeAlreadyReleasedRows,
  formatPieceCode,
  nextPieceNumber,
  planSlabRelease,
  sinkPiecesForSlab,
  type SlabReleaseRow,
} from "../src/lib/fab/releasePlan.ts";

// SENDING A SLAB TO THE CUTTER IS WHERE PIECES ARE BORN NOW.
//
// The supervisor works one slab at a time, so release cannot be the
// project-scoped thing it used to be: on slab 1 of 5, four fifths of the order
// legitimately has no slab yet. What this file pins down is the arithmetic of
// doing it slab by slab, because two of the three numbers involved are shared
// with slabs that have not been sent yet and one of them is shared with slabs
// that already have.
//
//   1. THE SINK COUNT IS PER ORDER ROW, NOT PER SLAB. "30 of these 60 get a
//      sink" is one decision that spans every slab the row is split across. Read
//      per slab it becomes 30 sinks on EACH of them, and the shop cuts thirty
//      holes nobody ordered. The rule is a top-up against what already exists.
//   2. THE PIECE CODE IS PER PROJECT. fab_piece.piece_code is @unique globally,
//      so a counter that restarts at 1 on the second slab collides with the
//      first one's work and the whole transaction rolls back.
//   3. SENDING TWICE MUST NOT DOUBLE THE WORK. The plan is a function of what
//      already exists, so feeding it the state left by its own first run leaves
//      it nothing to do.

/* -- A shop floor, reduced to the two numbers the planner reads ------------- */

/** What the database holds between two sends, as approve-slab's transaction
 *  reads it back: the piece codes this project has used, and per requirement how
 *  many pieces exist and how many of them carry a sink. */
function makeShop(projectCode: string) {
  const codes: string[] = [];
  const made = new Map<string, { pieces: number; sinks: number }>();

  return {
    codes,
    counts(requirementId: string) {
      return made.get(requirementId) ?? { pieces: 0, sinks: 0 };
    },
    /** Send one slab: plan it against what exists, then write the plan back the
     *  way the route's transaction does. */
    send(rows: Omit<SlabReleaseRow, "piecesAlreadyCreated" | "sinksAlreadyCreated">[]) {
      const plan = planSlabRelease({
        projectCode,
        startNumber: nextPieceNumber(projectCode, codes),
        rows: rows.map(r => ({
          ...r,
          piecesAlreadyCreated: made.get(r.requirementId)?.pieces ?? 0,
          sinksAlreadyCreated: made.get(r.requirementId)?.sinks ?? 0,
        })),
      });
      for (const p of plan.pieces) {
        codes.push(p.pieceCode);
        const t = made.get(p.requirementId) ?? { pieces: 0, sinks: 0 };
        t.pieces += 1;
        if (p.hasSink) t.sinks += 1;
        made.set(p.requirementId, t);
      }
      return plan;
    },
  };
}

/** One requirement row on one slab. The counts are supplied by makeShop. */
function row(over: Partial<SlabReleaseRow> = {}): Omit<SlabReleaseRow, "piecesAlreadyCreated" | "sinksAlreadyCreated"> {
  return {
    requirementId: "r1",
    name: "PO 10026 Row 7",
    orderedQuantity: 60,
    allocatedOnThisSlab: 12,
    sinkQuantity: 30,
    ...over,
  };
}

const sinks = (plan: { pieces: { hasSink: boolean }[] }) => plan.pieces.filter(p => p.hasSink).length;

/* -- The sink top-up across successive slabs -------------------------------- */

test("60 ordered, 30 with sinks, cut 12 to a slab: 12 sinks, 12, then 6 of 12", () => {
  // THE BUG THIS PREVENTS. sink_quantity is a column on fab_requirement, so the
  // obvious per-slab reading is "this row wants 30 sinks" and every slab it
  // touches marks its first 30 — 12, 12, 12, 12, 12 = sixty sink cutouts on an
  // order for thirty. The top-up counts what is already marked and stops.
  const shop = makeShop("PS-101");

  const slab1 = shop.send([row()]);
  assert.equal(slab1.pieces.length, 12);
  assert.equal(sinks(slab1), 12);

  const slab2 = shop.send([row()]);
  assert.equal(slab2.pieces.length, 12);
  assert.equal(sinks(slab2), 12);

  // The interesting one: the balance runs out halfway through this slab.
  const slab3 = shop.send([row()]);
  assert.equal(slab3.pieces.length, 12);
  assert.equal(sinks(slab3), 6);
  // And they are the FIRST six of the twelve, not six scattered through it.
  assert.deepEqual(
    slab3.pieces.map(p => p.hasSink),
    [true, true, true, true, true, true, false, false, false, false, false, false],
  );

  const slab4 = shop.send([row()]);
  const slab5 = shop.send([row()]);
  assert.equal(sinks(slab4), 0);
  assert.equal(sinks(slab5), 0);

  // The whole order, and exactly the sinks that were asked for.
  assert.equal(shop.counts("r1").pieces, 60);
  assert.equal(shop.counts("r1").sinks, 30);
});

test("the top-up is the same rule whatever the slab sizes are", () => {
  // Uneven splits are the normal case — a slab takes what fits. 7 + 20 + 33.
  const shop = makeShop("PS-101");
  shop.send([row({ allocatedOnThisSlab: 7 })]);
  shop.send([row({ allocatedOnThisSlab: 20 })]);
  const last = shop.send([row({ allocatedOnThisSlab: 33 })]);

  assert.equal(shop.counts("r1").pieces, 60);
  assert.equal(shop.counts("r1").sinks, 30);
  // 7 + 20 = 27 marked already, so this slab owes 3 and no more.
  assert.equal(sinks(last), 3);
});

test("sinks already made by a project-wide release are counted, not repeated", () => {
  // release-project is still in the tree and still creates pieces if anyone
  // calls it. A slab sent afterwards must see its sinks.
  const plan = planSlabRelease({
    projectCode: "PS-101",
    startNumber: 41,
    rows: [{
      requirementId: "r1",
      name: "PO 10026 Row 7",
      orderedQuantity: 60,
      allocatedOnThisSlab: 12,
      sinkQuantity: 30,
      piecesAlreadyCreated: 40,
      sinksAlreadyCreated: 28,
    }],
  });
  assert.equal(plan.pieces.length, 12);
  assert.equal(sinks(plan), 2);
});

/* -- Sink quantity 0, NULL, and all of them --------------------------------- */

test("sink quantity 0 and NULL both mean no sink, on every slab", () => {
  // The column is nullable so "he has not looked at this row" and "he looked and
  // said none" are not forced to be the same value. They route identically.
  for (const sinkQuantity of [0, null, undefined] as const) {
    const shop = makeShop("PS-101");
    const slab1 = shop.send([row({ sinkQuantity })]);
    const slab2 = shop.send([row({ sinkQuantity })]);
    assert.equal(sinks(slab1), 0, `sinkQuantity ${String(sinkQuantity)}`);
    assert.equal(sinks(slab2), 0, `sinkQuantity ${String(sinkQuantity)}`);
    assert.equal(shop.counts("r1").pieces, 24);
    assert.equal(shop.counts("r1").sinks, 0);
  }
});

test("sink quantity equal to the order: every piece of every slab carries one", () => {
  const shop = makeShop("PS-101");
  for (let i = 0; i < 5; i++) {
    const slab = shop.send([row({ sinkQuantity: 60 })]);
    assert.equal(slab.pieces.length, 12);
    assert.equal(sinks(slab), 12);
    assert.ok(slab.pieces.every(p => p.hasSink));
  }
  assert.equal(shop.counts("r1").sinks, 60);
});

test("a stale sink quantity larger than the order cannot mark pieces that do not exist", () => {
  // Someone cut the order from 60 to 10 and left sink_quantity at 30.
  // resolveSinkQuantity caps it, so the top-up never runs past the order.
  const shop = makeShop("PS-101");
  const slab = shop.send([row({ orderedQuantity: 10, allocatedOnThisSlab: 10, sinkQuantity: 30 })]);
  assert.equal(slab.pieces.length, 10);
  assert.equal(sinks(slab), 10);
});

test("sinkPiecesForSlab on its own: the balance, never more than the slab makes", () => {
  const base = { orderedQuantity: 60, sinksAlreadyCreated: 0, piecesOnThisSlab: 12 };
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: 30 }), 12);
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: 30, sinksAlreadyCreated: 24 }), 6);
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: 30, sinksAlreadyCreated: 30 }), 0);
  // More already marked than were asked for — bad data, but not a negative.
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: 30, sinksAlreadyCreated: 44 }), 0);
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: null }), 0);
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: 60 }), 12);
  // Half a sink is not a thing, and a negative count is not an instruction.
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: 2.7 }), 2);
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: -5 }), 0);
  assert.equal(sinkPiecesForSlab({ ...base, sinkQuantity: NaN }), 0);
});

/* -- Piece codes across successive slabs ------------------------------------ */

test("the piece counter carries across slabs instead of restarting", () => {
  // fab_piece.piece_code is @unique GLOBALLY. Numbering from 1 on the second
  // slab duplicates the first slab's codes, P2002 aborts the transaction, and
  // the supervisor is told the send failed with the slab still on the board.
  const shop = makeShop("PS-101");

  const slab1 = shop.send([row({ allocatedOnThisSlab: 3 })]);
  assert.deepEqual(slab1.pieces.map(p => p.pieceCode), ["PS-101-0001", "PS-101-0002", "PS-101-0003"]);

  const slab2 = shop.send([row({ allocatedOnThisSlab: 2 })]);
  assert.deepEqual(slab2.pieces.map(p => p.pieceCode), ["PS-101-0004", "PS-101-0005"]);

  assert.equal(new Set(shop.codes).size, shop.codes.length, "a code was minted twice");
});

test("two piece rows on one slab share the project's counter", () => {
  const shop = makeShop("PS-101");
  const slab = shop.send([
    row({ requirementId: "r1", allocatedOnThisSlab: 2 }),
    row({ requirementId: "r2", name: "PO 10026 Row 9", allocatedOnThisSlab: 2 }),
  ]);
  assert.deepEqual(
    slab.pieces.map(p => `${p.requirementId}:${p.pieceCode}`),
    ["r1:PS-101-0001", "r1:PS-101-0002", "r2:PS-101-0003", "r2:PS-101-0004"],
  );
});

test("nextPieceNumber resumes past what exists and ignores the retired format", () => {
  assert.equal(nextPieceNumber("PS-101", []), 1);
  assert.equal(nextPieceNumber("PS-101", ["PS-101-0001", "PS-101-0007", "PS-101-0003"]), 8);
  // The cutting queue used to mint `{projectCode}-{label}-{NNN}-{slabSuffix}`.
  // Those are not numbers this counter can continue, and reading "2B" as one
  // would either throw or restart the sequence on top of live work.
  assert.equal(nextPieceNumber("PS-101", ["PS-101-2B-003-9f1c", "PS-101-0002"]), 3);
  // Another project's codes are not this project's business.
  assert.equal(nextPieceNumber("PS-101", ["PS-999-0044"]), 1);
  assert.equal(formatPieceCode("PS-101", 42), "PS-101-0042");
  // A project past 9,999 pieces gets a longer number rather than a wrapped one.
  assert.equal(formatPieceCode("PS-101", 12345), "PS-101-12345");
});

/* -- Sending the same slab twice -------------------------------------------- */

test("sending a slab twice creates one set of pieces, not two", () => {
  // The route holds a row lock and checks for pieces on the slab before it
  // plans; this is the arithmetic behind that check. Whatever order the two
  // requests arrive in, the second one is planning against the first one's
  // result and has nothing left to give.
  const shop = makeShop("PS-101");

  const first = shop.send([row({ allocatedOnThisSlab: 60 })]);
  assert.equal(first.pieces.length, 60);
  assert.equal(first.blocked.length, 0);

  const second = shop.send([row({ allocatedOnThisSlab: 60 })]);
  assert.equal(second.pieces.length, 0, "the retry minted a second set of pieces");
  assert.deepEqual(second.blocked, [{ name: "PO 10026 Row 7", orderedQuantity: 60 }]);

  assert.equal(shop.counts("r1").pieces, 60);
  assert.equal(shop.counts("r1").sinks, 30);
  assert.equal(shop.codes.length, 60);
  assert.equal(new Set(shop.codes).size, 60);
});

test("re-sending one slab of several leaves the other slabs' work alone", () => {
  const shop = makeShop("PS-101");
  shop.send([row({ allocatedOnThisSlab: 12 })]);   // slab 1
  shop.send([row({ allocatedOnThisSlab: 12 })]);   // slab 2
  const retry = shop.send([row({ allocatedOnThisSlab: 12 })]);  // slab 2 again

  // The retry is indistinguishable from slab 3 at this level — the route is
  // what knows one slab from another, by the pieces already carrying its
  // slab_id. What is pinned here is that the ORDER is never overrun: 60 is 60.
  assert.equal(retry.pieces.length, 12);
  shop.send([row({ allocatedOnThisSlab: 12 })]);
  shop.send([row({ allocatedOnThisSlab: 12 })]);
  const overrun = shop.send([row({ allocatedOnThisSlab: 12 })]);
  assert.equal(overrun.pieces.length, 0);
  assert.equal(shop.counts("r1").pieces, 60);
});

/* -- Rows with nothing left to give ----------------------------------------- */

test("a slab claiming more than the order has left releases the balance and says so", () => {
  const plan = planSlabRelease({
    projectCode: "PS-101",
    startNumber: 9,
    rows: [{
      requirementId: "r1",
      name: "PO 10026 Row 7",
      orderedQuantity: 10,
      allocatedOnThisSlab: 5,
      sinkQuantity: 0,
      piecesAlreadyCreated: 8,
      sinksAlreadyCreated: 0,
    }],
  });
  assert.equal(plan.pieces.length, 2);
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.warnings.length, 1);
  // Named, with the numbers — a bare "over-allocated" sends someone hunting.
  assert.match(plan.warnings[0], /PO 10026 Row 7/);
  assert.match(plan.warnings[0], /claims 5 piece\(s\)/);
  assert.match(plan.warnings[0], /only 2 of the 10 ordered/);
});

test("the blocked rows are named with their quantities, not counted", () => {
  const message = describeAlreadyReleasedRows("Slab A-42", [
    { name: "PO 10026 Row 7", orderedQuantity: 60 },
    { name: "PO 10026 Row 9", orderedQuantity: 4 },
  ]);
  assert.match(message, /Slab A-42/);
  assert.match(message, /PO 10026 Row 7 \(all 60 already released\)/);
  assert.match(message, /PO 10026 Row 9 \(all 4 already released\)/);
  assert.match(message, /Nothing was sent/);
});

test("a long list of blocked rows is capped, and still says how many there are", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ name: `PO 10026 Row ${i + 1}`, orderedQuantity: 3 }));
  const message = describeAlreadyReleasedRows("Slab A-42", rows);
  assert.match(message, /and 4 more/);
  assert.ok(!message.includes("Row 9 ("), "capped list should stop at eight rows");
});

/* -- Junk in ---------------------------------------------------------------- */

test("junk quantities cannot spin the loop or mint stray pieces", () => {
  const plan = planSlabRelease({
    projectCode: "PS-101",
    startNumber: 1,
    rows: [
      { requirementId: "a", name: "A", orderedQuantity: 5, allocatedOnThisSlab: -3, sinkQuantity: 1, piecesAlreadyCreated: 0, sinksAlreadyCreated: 0 },
      { requirementId: "b", name: "B", orderedQuantity: 5, allocatedOnThisSlab: 1.9, sinkQuantity: 1, piecesAlreadyCreated: 0, sinksAlreadyCreated: 0 },
      { requirementId: "c", name: "C", orderedQuantity: Number.NaN, allocatedOnThisSlab: 2, sinkQuantity: 1, piecesAlreadyCreated: 0, sinksAlreadyCreated: 0 },
    ],
  });
  // A negative allocation is not a row; 1.9 is one whole piece; a requirement
  // with no usable quantity has no headroom and is blocked rather than released.
  assert.deepEqual(plan.pieces.map(p => p.requirementId), ["b"]);
  assert.deepEqual(plan.blocked.map(b => b.name), ["C"]);
  assert.equal(plan.nextNumber, 2);
});

test("a slab with no rows on it plans nothing and blocks nothing", () => {
  const plan = planSlabRelease({ projectCode: "PS-101", startNumber: 1, rows: [] });
  assert.deepEqual(plan.pieces, []);
  assert.deepEqual(plan.blocked, []);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.nextNumber, 1);
});
