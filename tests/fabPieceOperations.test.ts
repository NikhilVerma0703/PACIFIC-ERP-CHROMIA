import { test } from "node:test";
import assert from "node:assert/strict";
import { planPieceOperations } from "../src/lib/fab/pieceOperations.ts";
import { describeRequirement, describeUnresolvedRequirements } from "../src/lib/fab/releasePlan.ts";

// The release route, the cutting complete-job handler and admin/fix-cascade each
// built a piece's route sheet inline, and two of them advanced `sequence` only
// inside the sink branch. FabPieceOperation has no @@unique([pieceId, sequence]),
// so the duplicate numbering was written silently. These lock the numbering.

const seqs = (flags: Parameters<typeof planPieceOperations>[0]) =>
  planPieceOperations(flags).map(o => o.sequence);
const types = (flags: Parameters<typeof planPieceOperations>[0]) =>
  planPieceOperations(flags).map(o => o.operationType);

test("a bare piece is cut then packed", () => {
  assert.deepEqual(
    planPieceOperations({ polishRequired: false, sinkRequired: false, fabricationRequired: false }),
    [
      { operationType: "CUTTING", sequence: 1 },
      { operationType: "PACKAGING", sequence: 2 },
    ],
  );
});

test("polish-only: POLISHING and PACKAGING do not collide on sequence 2", () => {
  // The old code emitted POLISHING seq 2 and PACKAGING seq 2, because `seq` was
  // only incremented when sinkRequired was true. 716 of the live project's 902
  // pieces are polish-only, so this was the common case, not the edge case.
  const flags = { polishRequired: true, sinkRequired: false, fabricationRequired: false };
  assert.deepEqual(types(flags), ["CUTTING", "POLISHING", "PACKAGING"]);
  assert.deepEqual(seqs(flags), [1, 2, 3]);
});

test("polish + sink: POLISHING and SINK_CUTTING do not collide either", () => {
  const flags = { polishRequired: true, sinkRequired: true, fabricationRequired: true };
  assert.deepEqual(types(flags), ["CUTTING", "POLISHING", "SINK_CUTTING", "FABRICATION", "PACKAGING"]);
  assert.deepEqual(seqs(flags), [1, 2, 3, 4, 5]);
});

test("sink without polish still numbers 1..4", () => {
  const flags = { polishRequired: false, sinkRequired: true, fabricationRequired: true };
  assert.deepEqual(types(flags), ["CUTTING", "SINK_CUTTING", "FABRICATION", "PACKAGING"]);
  assert.deepEqual(seqs(flags), [1, 2, 3, 4]);
});

test("every combination is gap-free, duplicate-free, cut-first and pack-last", () => {
  for (const polishRequired of [false, true]) {
    for (const sinkRequired of [false, true]) {
      for (const fabricationRequired of [false, true]) {
        const ops = planPieceOperations({ polishRequired, sinkRequired, fabricationRequired });
        const s = ops.map(o => o.sequence);
        const label = JSON.stringify({ polishRequired, sinkRequired, fabricationRequired });

        assert.deepEqual(s, s.map((_, i) => i + 1), `sequence must be 1..n for ${label}`);
        assert.equal(new Set(s).size, s.length, `no duplicate sequence for ${label}`);
        assert.equal(ops[0].operationType, "CUTTING", `cut first for ${label}`);
        assert.equal(ops[ops.length - 1].operationType, "PACKAGING", `pack last for ${label}`);
        // Fabrication is the hand-finish of the sink cutout: it can never come
        // before the cut that makes the hole.
        const iSink = ops.findIndex(o => o.operationType === "SINK_CUTTING");
        const iFab = ops.findIndex(o => o.operationType === "FABRICATION");
        if (iSink >= 0 && iFab >= 0) assert.ok(iFab > iSink, `fabrication after sink for ${label}`);
      }
    }
  }
});

test("nullish flags are treated as not required", () => {
  assert.deepEqual(seqs({}), [1, 2]);
  assert.deepEqual(types({ polishRequired: null, sinkRequired: undefined }), ["CUTTING", "PACKAGING"]);
});

/* -- The two route sheets release now produces ------------------------------ */

// Polish stopped being a decision the upload makes (every piece is edge-polished)
// and the sink became a per-piece quantity the supervisor sets, so a released
// requirement now yields exactly two shapes: the first N pieces with a sink, the
// rest without. The numbering rules above are unchanged and still cover all
// eight flag combinations — these pin the two that actually get written.

test("a released piece without a sink is cut, polished, packed", () => {
  const flags = { polishRequired: true, sinkRequired: false, fabricationRequired: false };
  assert.deepEqual(types(flags), ["CUTTING", "POLISHING", "PACKAGING"]);
  assert.deepEqual(seqs(flags), [1, 2, 3]);
});

test("a released piece with a sink visits all five stations", () => {
  const flags = { polishRequired: true, sinkRequired: true, fabricationRequired: true };
  assert.deepEqual(types(flags), ["CUTTING", "POLISHING", "SINK_CUTTING", "FABRICATION", "PACKAGING"]);
  assert.deepEqual(seqs(flags), [1, 2, 3, 4, 5]);
});

test("splitting a requirement 3-of-10 gives 3 five-stop sheets and 7 three-stop ones", () => {
  const quantity = 10;
  const sinkQuantity = 3;
  const sheets = Array.from({ length: quantity }, (_, i) =>
    planPieceOperations({
      polishRequired: true,
      sinkRequired: i < sinkQuantity,
      fabricationRequired: i < sinkQuantity,
    }),
  );

  assert.equal(sheets.filter(s => s.length === 5).length, 3);
  assert.equal(sheets.filter(s => s.length === 3).length, 7);
  // POLISHING is on every sheet and always sequence 2 — the station cannot be
  // skipped, and its number cannot move depending on the sink.
  for (const s of sheets) {
    const polish = s.find(o => o.operationType === "POLISHING");
    assert.ok(polish, "every piece is polished");
    assert.equal(polish.sequence, 2);
    assert.equal(s[0].operationType, "CUTTING");
    assert.equal(s[s.length - 1].operationType, "PACKAGING");
    assert.deepEqual(s.map(o => o.sequence), s.map((_, i) => i + 1));
  }
  // Sink work only ever appears on the first three.
  const hasSinkWork = sheets.map(s => s.some(o => o.operationType === "SINK_CUTTING"));
  assert.deepEqual(hasSinkWork, [true, true, true, false, false, false, false, false, false, false]);
});

/* -- The blocked-release message ------------------------------------------- */

// "7 requirement(s) have no slab" on a 198-line board is a scavenger hunt. The
// server already knows which rows they are.

test("a blocked requirement is named by drawing and piece label", () => {
  assert.equal(describeRequirement({ drawingNumber: "D-101", pieceLabel: "2B" }), "D-101 piece 2B");
});

test("naming falls back through description, then drawing, then a placeholder", () => {
  assert.equal(
    describeRequirement({ drawingNumber: "D-101", pieceLabel: null, description: "Island top" }),
    "D-101 piece Island top",
  );
  assert.equal(describeRequirement({ drawingNumber: "D-101" }), "drawing D-101");
  assert.equal(describeRequirement({ pieceLabel: "2B" }), "piece 2B");
  assert.equal(describeRequirement({}), "an unnamed piece type");
  // Whitespace-only is not a name.
  assert.equal(describeRequirement({ drawingNumber: "  ", pieceLabel: " " }), "an unnamed piece type");
});

test("the message names the offenders and keeps the true count", () => {
  const msg = describeUnresolvedRequirements([
    { drawingNumber: "D-101", pieceLabel: "2B" },
    { drawingNumber: "D-101", pieceLabel: "3A" },
  ]);
  assert.match(msg, /^2 piece types have no slab: D-101 piece 2B, D-101 piece 3A\./);
  assert.match(msg, /default slab/);
});

test("one blocked requirement reads as singular", () => {
  const msg = describeUnresolvedRequirements([{ drawingNumber: "D-9", pieceLabel: "1" }]);
  assert.match(msg, /^1 piece type has no slab: D-9 piece 1\./);
});

test("a long list is capped but still reports how many there really are", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ drawingNumber: "D-1", pieceLabel: String(i + 1) }));
  const msg = describeUnresolvedRequirements(rows);
  assert.match(msg, /^30 piece types have no slab:/);
  assert.match(msg, /and 22 more/);
  // Named up to the cap, and no further.
  assert.ok(msg.includes("D-1 piece 8"), "should name the 8th");
  assert.ok(!msg.includes("D-1 piece 9,"), "should not name the 9th");
});

// A requirement that came off a PO PDF has drawing_id NULL — there is no
// drawing to name it by, and the drawing-default escape hatch the message used
// to offer does not exist for it. Its handle is the customer's PO number and
// the PDF row number.

test("a PO row is named by its purchase order, not left as a bare row number", () => {
  assert.equal(describeRequirement({ poNumber: "10026", pieceLabel: "Row 7" }), "PO 10026 Row 7");
  assert.equal(describeRequirement({ poNumber: "10026" }), "PO 10026");
  // A project holds several POs, so "piece Row 7" on its own names one row per
  // purchase order and points at none of them.
  assert.notEqual(describeRequirement({ poNumber: "10026", pieceLabel: "Row 7" }), "piece Row 7");
  // A drawing still wins if a row somehow carries both, so nothing about the
  // old intake's wording changes.
  assert.equal(
    describeRequirement({ drawingNumber: "D-101", poNumber: "10026", pieceLabel: "2B" }),
    "D-101 piece 2B",
  );
});

test("blocked release on a PO project does not offer the drawing default", () => {
  const msg = describeUnresolvedRequirements([
    { poNumber: "10026", pieceLabel: "Row 7" },
    { poNumber: "10026", pieceLabel: "Row 8" },
    { poNumber: "10031", pieceLabel: "Row 2" },
  ]);
  assert.match(msg, /^3 piece types have no slab: PO 10026 Row 7, PO 10026 Row 8, PO 10031 Row 2\./);
  // There is no drawing on any of these rows, so sending him to look for a
  // drawing's default slab is sending him to a screen that cannot help.
  assert.doesNotMatch(msg, /default slab/);
  assert.match(msg, /slab board/);
});

test("a project with drawings still gets the drawing-default advice", () => {
  const msg = describeUnresolvedRequirements([
    { drawingNumber: "D-101", pieceLabel: "2B" },
    { poNumber: "10026", pieceLabel: "Row 7" },
  ]);
  assert.match(msg, /default slab/);
});
