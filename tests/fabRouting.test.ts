import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isReadyForPackaging, pendingStages, statusFromFlags,
} from "../src/lib/fab/routing.ts";
import {
  deriveRoutingFlags, resolveSinkQuantity, inchToMm, INCH_TO_MM,
} from "../src/lib/fab/requirement-derive.ts";
import { normalizeLabel, buildValidLabels, snapLabel } from "../src/lib/fab/labelMatch.ts";

// The fabrication module had no tests at all. These cover the rules that decide
// where a piece goes and what it is called when it gets there — the ones a wrong
// answer strands a piece on.

const piece = (o: Partial<Parameters<typeof isReadyForPackaging>[0]> = {}) => ({
  polishRequired: false, polishingCompleted: false,
  hasSink: false, sinkCompleted: false,
  fabricationRequired: false, fabricationCompleted: false,
  ...o,
});

test("isReadyForPackaging: a stage never required is not a blocker", () => {
  // The plain piece: cut, nothing else asked for. Ready immediately.
  assert.equal(isReadyForPackaging(piece()), true);

  // Required and outstanding blocks; required and done does not. If this ever
  // reads `completed` alone, a piece with no sink waits forever for a sink cut
  // nobody is going to make.
  assert.equal(isReadyForPackaging(piece({ polishRequired: true })), false);
  assert.equal(isReadyForPackaging(piece({ polishRequired: true, polishingCompleted: true })), true);
  assert.equal(isReadyForPackaging(piece({ hasSink: true })), false);
  assert.equal(isReadyForPackaging(piece({ hasSink: true, sinkCompleted: true })), true);
  assert.equal(isReadyForPackaging(piece({ fabricationRequired: true })), false);
  assert.equal(isReadyForPackaging(piece({ fabricationRequired: true, fabricationCompleted: true })), true);

  // Every stage at once — the real sink piece, which per deriveRoutingFlags
  // always carries fabrication too.
  const all = { polishRequired: true, hasSink: true, fabricationRequired: true };
  assert.equal(isReadyForPackaging(piece(all)), false);
  assert.equal(isReadyForPackaging(piece({ ...all, polishingCompleted: true, sinkCompleted: true })), false);
  assert.equal(isReadyForPackaging(piece({
    ...all, polishingCompleted: true, sinkCompleted: true, fabricationCompleted: true,
  })), true);

  // A completed flag on a stage that was never required cannot make a piece
  // that IS blocked look ready.
  assert.equal(isReadyForPackaging(piece({ hasSink: true, polishingCompleted: true })), false);
});

test("pendingStages: names what a piece is still waiting on, in route order", () => {
  assert.deepEqual(pendingStages(piece()), []);
  assert.deepEqual(
    pendingStages(piece({ polishRequired: true, hasSink: true, fabricationRequired: true })),
    ["POLISHING", "SINK_CUTTING", "FABRICATION"],
  );
  assert.deepEqual(
    pendingStages(piece({ polishRequired: true, polishingCompleted: true, hasSink: true })),
    ["SINK_CUTTING"],
  );
  // Empty is exactly the ready condition — the two must never disagree.
  for (const p of [piece(), piece({ hasSink: true }), piece({ hasSink: true, sinkCompleted: true })])
    assert.equal(pendingStages(p).length === 0, isReadyForPackaging(p));
});

test("statusFromFlags: the furthest stage still ticked, never a regression", () => {
  assert.equal(statusFromFlags({ polishingCompleted: false, sinkCompleted: false, fabricationCompleted: false }), "CUT");
  assert.equal(statusFromFlags({ polishingCompleted: true, sinkCompleted: false, fabricationCompleted: false }), "POLISHED");
  assert.equal(statusFromFlags({ polishingCompleted: false, sinkCompleted: true, fabricationCompleted: false }), "SINK_CUT");
  assert.equal(statusFromFlags({ polishingCompleted: false, sinkCompleted: false, fabricationCompleted: true }), "FABRICATED");

  // THE BUG THIS EXISTS FOR. Stations do not run in route order. A piece whose
  // fabrication was already done, finishing its sink cut second, used to be
  // pinned back to SINK_CUT by the sink station — losing the fabrication. The
  // furthest stage must win however the flags arrived.
  assert.equal(statusFromFlags({ polishingCompleted: true, sinkCompleted: true, fabricationCompleted: true }), "FABRICATED");
  assert.equal(statusFromFlags({ polishingCompleted: true, sinkCompleted: true, fabricationCompleted: false }), "SINK_CUT");
});

// THE RULES CHANGED HERE. The old sheet carried a DE&P (edge polish) length and
// a sink-cut count per row and routing was read off them; the new flat piece
// list carries neither. Polish is now unconditional and the sink is a quantity
// the supervisor sets. The three assertions below replace the DE&P-driven and
// sinkCuts/sinkModel-driven ones that used to live here.

test("deriveRoutingFlags: every piece is polished, and fabrication follows the sink", () => {
  // Nothing asked for — and polish STILL comes out true. This is the change:
  // the old rule was polishRequired = depLength > 0, so this used to be false.
  assert.deepEqual(deriveRoutingFlags({}), {
    sinkRequired: false, polishRequired: true, fabricationRequired: false,
  });

  // A sink drags fabrication with it — fabrication here is the outsourced
  // hand-polish of the cutout, so it cannot exist without one.
  assert.deepEqual(deriveRoutingFlags({ sinkQuantity: 1, quantity: 10 }), {
    sinkRequired: true, polishRequired: true, fabricationRequired: true,
  });

  // sinkRequired is now the supervisor's quantity and nothing else. Zero, null
  // and "not looked at yet" all mean no sink.
  assert.equal(deriveRoutingFlags({ sinkQuantity: 0, quantity: 10 }).sinkRequired, false);
  assert.equal(deriveRoutingFlags({ sinkQuantity: null, quantity: 10 }).sinkRequired, false);
  assert.equal(deriveRoutingFlags({ quantity: 10 }).sinkRequired, false);
  assert.equal(deriveRoutingFlags({ sinkQuantity: 10, quantity: 10 }).sinkRequired, true);

  // Polish is never false, whatever the sink says.
  for (const sinkQuantity of [null, 0, 1, 10])
    assert.equal(deriveRoutingFlags({ sinkQuantity, quantity: 10 }).polishRequired, true);

  // fabricationRequired === sinkRequired, exhaustively. Unchanged rule, and the
  // one the packaging gate and the route sheet both depend on.
  for (const sinkQuantity of [null, 0, 1, 5, 10, 999]) {
    const f = deriveRoutingFlags({ sinkQuantity, quantity: 10 });
    assert.equal(f.fabricationRequired, f.sinkRequired, `sinkQuantity=${sinkQuantity}`);
  }
});

test("resolveSinkQuantity: whole pieces, never more than were ordered", () => {
  assert.equal(resolveSinkQuantity(3, 10), 3);
  assert.equal(resolveSinkQuantity(10, 10), 10);

  // Absent, null and zero are all "no sinks". NULL means the supervisor has not
  // looked at the row yet and 0 means he said none — a distinction the column
  // keeps and routing deliberately does not.
  assert.equal(resolveSinkQuantity(null, 10), 0);
  assert.equal(resolveSinkQuantity(undefined, 10), 0);
  assert.equal(resolveSinkQuantity(0, 10), 0);

  // A stale count left behind after someone cut the order down must not mark
  // pieces that no longer exist.
  assert.equal(resolveSinkQuantity(40, 10), 10);
  // Nothing ordered, nothing to put a sink in.
  assert.equal(resolveSinkQuantity(5, 0), 0);

  // Junk degrades to no sink rather than to NaN pieces.
  assert.equal(resolveSinkQuantity(-3, 10), 0);
  assert.equal(resolveSinkQuantity(NaN, 10), 0);
  assert.equal(resolveSinkQuantity(2.7, 10), 2);

  // No quantity given is "no cap known", not "cap of zero" — asking whether a
  // row has sinks at all must not require producing the ordered quantity.
  assert.equal(resolveSinkQuantity(3), 3);
  assert.equal(resolveSinkQuantity(3, null), 3);
});

test("the first N pieces get the sink, the rest do not, and all of them are polished", () => {
  // The rule /api/fab/supervisor/release-project applies when it expands a
  // requirement into pieces: 3 of 10 means pieces 1-3, in cut order.
  const quantity = 10;
  const sinkQuantity = resolveSinkQuantity(3, quantity);
  const pieces = Array.from({ length: quantity }, (_, i) => ({
    hasSink: i < sinkQuantity,
    polishRequired: true,
    fabricationRequired: i < sinkQuantity,
  }));

  assert.equal(pieces.filter(p => p.hasSink).length, 3);
  assert.deepEqual(pieces.map(p => p.hasSink), [
    true, true, true, false, false, false, false, false, false, false,
  ]);
  // Fabrication is welded to the sink piece by piece, not row by row.
  for (const p of pieces) assert.equal(p.fabricationRequired, p.hasSink);
  // And nothing skips polish.
  assert.ok(pieces.every(p => p.polishRequired));

  // The default when the supervisor picks a row is the whole quantity.
  assert.equal(resolveSinkQuantity(quantity, quantity), 10);
  // A row he never touched produces no sink pieces at all.
  assert.equal(resolveSinkQuantity(null, quantity), 0);
});

test("inchToMm: Excel is inches, production is mm, and 0 is not missing", () => {
  assert.equal(inchToMm(1), INCH_TO_MM);
  assert.equal(inchToMm(10), 254);
  // Rounded to 2dp so float noise never reaches the database.
  assert.equal(inchToMm(25.5), 647.7);
  assert.equal(inchToMm(1 / 3), 8.47);
  // 0 is a real measurement and must survive; absent is undefined.
  assert.equal(inchToMm(0), 0);
  assert.equal(inchToMm(null), undefined);
  assert.equal(inchToMm(undefined), undefined);
});

test("normalizeLabel: one canonical spelling for the dashes OCR invents", () => {
  assert.equal(normalizeLabel("1-2a"), "1-2A");
  assert.equal(normalizeLabel(" 1 - 2A "), "1-2A");
  // en dash, em dash, minus sign and underscore all mean hyphen here
  for (const d of ["‐", "–", "—", "−", "_"])
    assert.equal(normalizeLabel(`1${d}2A`), "1-2A");
  assert.equal(normalizeLabel("1--2A"), "1-2A");
  assert.equal(normalizeLabel("-1-2A-"), "1-2A");
  assert.equal(normalizeLabel(null), "");
});

test("buildValidLabels: drawing number joined to piece label, blanks dropped", () => {
  const labels = buildValidLabels([
    { drawingNumber: "1", requirements: [{ pieceLabel: "2A" }, { pieceLabel: "2B" }] },
    { drawingNumber: "2", requirements: [{ pieceLabel: "1" }, { pieceLabel: null }, { pieceLabel: "  " }] },
  ]);
  assert.deepEqual(labels.sort(), ["1-2A", "1-2B", "2-1"]);
});

test("snapLabel: correct the OCR, but refuse to guess between two equals", () => {
  const valid = ["1-2A", "1-2B", "2-15", "3-7"];

  // Verbatim, and verbatim-after-normalisation.
  assert.equal(snapLabel("1-2A", valid).confidence, "exact");
  assert.equal(snapLabel(" 1 – 2a ", valid).label, "1-2A");

  // The classic confusions: O for 0, I for 1, S for 5, B for 8.
  const o = snapLabel("I-2A", valid);
  assert.equal(o.label, "1-2A");
  assert.ok(o.confidence === "corrected" || o.confidence === "fuzzy");

  // Nothing printed, or nothing close: null, and never a wrong guess.
  assert.equal(snapLabel("", valid).confidence, "none");
  assert.equal(snapLabel("-", valid).confidence, "none");
  assert.equal(snapLabel("ZZZZZZ", valid).label, null);

  // AMBIGUOUS IS A FEATURE. "1-2" sits one insertion from both 1-2A and 1-2B,
  // so there is no right answer and a human has to look. Returning either one
  // would silently cut the wrong panel.
  const amb = snapLabel("1-2", valid);
  assert.equal(amb.label, null);
  assert.equal(amb.confidence, "ambiguous");
  assert.deepEqual(amb.candidates.sort(), ["1-2A", "1-2B"]);

  // ...unless the panel's own dimension settles it.
  const byDim = snapLabel("1-2", valid, {
    dim: "25.5x102",
    dimByLabel: new Map([["1-2A", { w: 25.5, d: 102 }], ["1-2B", { w: 60, d: 30 }]]),
  });
  assert.equal(byDim.label, "1-2A");
  assert.equal(byDim.confidence, "corrected");

  // Dimensions match either way round — OCR does not know width from depth.
  const flipped = snapLabel("1-2", valid, {
    dim: "102x25.5",
    dimByLabel: new Map([["1-2A", { w: 25.5, d: 102 }], ["1-2B", { w: 60, d: 30 }]]),
  });
  assert.equal(flipped.label, "1-2A");

  // A dimension that fits BOTH candidates settles nothing — still ambiguous.
  const bothFit = snapLabel("1-2", valid, {
    dim: "25.5x102",
    dimByLabel: new Map([["1-2A", { w: 25.5, d: 102 }], ["1-2B", { w: 25.5, d: 102 }]]),
  });
  assert.equal(bothFit.label, null);
  assert.equal(bothFit.confidence, "ambiguous");

  // A single valid label has no second place to tie with.
  assert.equal(snapLabel("1-2A", ["1-2A"]).label, "1-2A");
});
