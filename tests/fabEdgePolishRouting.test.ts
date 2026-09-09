import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasEdgeWork, hasAnyFaceWork, faceEdgesUnset, faceEdgesFromLegacy, parseFaceEdges,
} from "../src/lib/fab/shape.ts";
import { parseEdges, priceRow } from "../src/lib/fab/pricing.ts";

// A ROW CANNOT BE CHARGED FOR WORK IT IS NEVER SENT TO DO.
//
// The release route decides, per ordered row, whether its pieces go to the hand
// bench: `fabricationRequired = hasSink || hasEdgePolish`. It asked that second
// question of `finished_edges` alone — the pre-0067 column — while the
// three-face controls write edges_top / edges_bottom / edges_side and leave
// finished_edges NULL.
//
// So a row priced for hand polish through the new screens answered FALSE, took
// the plain route sheet (cut, machine polish, pack) and never reached the bench.
// The money was invoiced. The work was never scheduled. On PO 1612104578 that
// was ₹3,58,497.92.
//
// These tests pin the two halves together: whatever priceRow charges for, the
// release question must answer yes to. That is the invariant, and it is checked
// against the SAME helper the route now uses.

/** Exactly what release-project/route.ts computes for a row. */
function releaseWouldSendToBench(r: {
  shapeType?: string | null;
  finishedEdges?: string | null;
  edgeFaces?: string | null;
  edgesTop?: string | null;
  edgesBottom?: string | null;
  edgesSide?: string | null;
}): boolean {
  const stored = {
    top: r.edgesTop ?? null,
    bottom: r.edgesBottom ?? null,
    side: r.edgesSide ?? null,
  };
  const faces = faceEdgesUnset(stored)
    ? faceEdgesFromLegacy(parseEdges(r.finishedEdges ?? null), r.edgeFaces ?? null)
    : parseFaceEdges(stored);
  return hasAnyFaceWork(r.shapeType ?? null, faces);
}

/** What the row is charged, on a 2 cm slab with a rate per face. */
function chargeFor(r: {
  edgesTop?: string | null; edgesBottom?: string | null; edgesSide?: string | null;
  finishedEdges?: string | null; edgeFaces?: string | null;
}) {
  const stored = { top: r.edgesTop ?? null, bottom: r.edgesBottom ?? null, side: r.edgesSide ?? null };
  return priceRow({
    lengthIn: 40.5512, widthIn: 3.5433, quantity: 150,
    sinkQuantity: 0, thicknessMm: 20,
    edges: parseEdges(r.finishedEdges ?? null),
    edgeFace: r.edgeFaces ?? null,
    faceEdges: faceEdgesUnset(stored) ? null : parseFaceEdges(stored),
    rateTop: 10, rateBottom: 10,
  });
}

test("THE BUG: a three-face row leaves finished_edges NULL — the old check missed it", () => {
  // Row I of PO 1612104578, exactly as the polish-terms route stores it.
  const row = { finishedEdges: null, edgesTop: "left,right", edgesBottom: "left,right", edgesSide: "" };

  // What the route used to ask. This is the wrong answer, kept as the record of
  // what went wrong — it is why the work was never queued.
  assert.equal(hasEdgeWork(null, parseEdges(row.finishedEdges)), false);

  // What it asks now.
  assert.equal(releaseWouldSendToBench(row), true, "this row must reach the hand bench");
});

test("EVERY ROW THAT IS CHARGED IS ALSO SENT — the invariant, over the whole PO spec", () => {
  const ALL = "front,back,left,right";
  const LR = "left,right";
  const rows = [
    // the owner's three groups from PO 1612104578, plus the rest
    { name: "103x3 all four T+B+S", edgesTop: ALL, edgesBottom: ALL, edgesSide: ALL },
    { name: "103x6 short sides T+B", edgesTop: LR, edgesBottom: LR, edgesSide: "" },
    { name: "top only, all four", edgesTop: ALL, edgesBottom: "", edgesSide: "" },
    { name: "side band alone", edgesTop: "", edgesBottom: "", edgesSide: ALL },
    { name: "no hand polish", edgesTop: "", edgesBottom: "", edgesSide: "" },
  ];
  for (const r of rows) {
    const priced = chargeFor(r);
    const sent = releaseWouldSendToBench(r);
    if (priced.edgeCost > 0) {
      assert.equal(sent, true, `${r.name}: charged ₹${priced.edgeCost} and NOT sent to the bench`);
    } else {
      assert.equal(sent, false, `${r.name}: sent to the bench with nothing to charge`);
    }
  }
});

test("A LEGACY ROW STILL ANSWERS THE SAME AS IT ALWAYS DID", () => {
  // Nothing in the new columns: the old pair decides, exactly as before 0067.
  const legacy = { finishedEdges: "front,back", edgeFaces: "BOTH",
                   edgesTop: null, edgesBottom: null, edgesSide: null };
  assert.equal(releaseWouldSendToBench(legacy), true);
  assert.equal(hasEdgeWork(null, parseEdges(legacy.finishedEdges)), true,
    "the old check agreed on legacy rows — which is why this went unnoticed");

  const legacyNone = { finishedEdges: null, edgeFaces: null,
                       edgesTop: null, edgesBottom: null, edgesSide: null };
  assert.equal(releaseWouldSendToBench(legacyNone), false);
});

test("AN EXPLICIT 'NO HAND POLISH' IS NOT SENT — decided-none differs from undecided", () => {
  // The 26 rows of PO 1612104578 marked "rest no hand polish itself". They have
  // a specification (empty strings, not NULL), and it says no work.
  const decidedNone = { finishedEdges: null, edgesTop: "", edgesBottom: "", edgesSide: "" };
  assert.equal(faceEdgesUnset({ top: "", bottom: "", side: "" }), false,
    "empty strings are an ANSWER, not an absent specification");
  assert.equal(releaseWouldSendToBench(decidedNone), false);
  assert.equal(chargeFor(decidedNone).edgeCost, 0);
});

test("A ROUND ROW REACHES THE BENCH ON ITS RING", () => {
  const circle = { shapeType: "CIRCLE", finishedEdges: null,
                   edgesTop: "round", edgesBottom: "", edgesSide: "" };
  assert.equal(releaseWouldSendToBench(circle), true);
});
