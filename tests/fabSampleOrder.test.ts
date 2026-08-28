import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_KINDS, DEFAULT_PROJECT_KIND,
  parseProjectKind, projectKindOf, isSampleProject,
  sampleRouting, checkSampleSink, planSampleCredit,
  sampleOrderCode, sampleOrderNumber, nextSampleOrderCode,
} from "../src/lib/fab/sampleOrder.ts";
import { deriveRoutingFlags } from "../src/lib/fab/requirement-derive.ts";

// The owner: "sampling page, they create the request — catalogue requirement —
// and request the samples and send to supervisor. He the same way chooses the
// slab and adds pieces and quantity and sends to cutting, then polished (no sink
// and fabri in the samples) and pushed to package."
//
// So a sample order is a JOB, not a windfall — the same pipeline as a purchase
// order, minus the two stages a flat sample never sees.

test("a project is a PO unless it says otherwise", () => {
  assert.deepEqual([...PROJECT_KINDS], ["PO", "SAMPLE"]);
  assert.equal(DEFAULT_PROJECT_KIND, "PO");
  // Before scripts/0059 the column does not exist, and EVERY existing project
  // came from a purchase order — so a missing kind is a PO, not an unknown.
  assert.equal(projectKindOf(null), "PO");
  assert.equal(projectKindOf(undefined), "PO");
  assert.equal(projectKindOf(""), "PO");
  assert.equal(isSampleProject(null), false);
  assert.equal(isSampleProject("SAMPLE"), true);
  assert.equal(isSampleProject("sample"), true);
  // Strict about the set: a typo must not invent a third kind.
  assert.equal(parseProjectKind("SAMPLES"), null);
  assert.equal(parseProjectKind("po"), "PO");
  assert.equal(parseProjectKind(7), null);
  // ...and an unrecognised word reads as a PO rather than crashing a board.
  assert.equal(projectKindOf("SAMPLES"), "PO");
});

test("NO SINK AND NO FABRICATION IN A SAMPLE — cut, polish, pack", () => {
  const r = sampleRouting();
  assert.equal(r.sinkRequired, false);
  assert.equal(r.fabricationRequired, false);
  assert.equal(r.polishRequired, true, "every piece is polished, sample or not");

  // It agrees with the floor's own rule for a row with no sinks — stated flat
  // here because on a sample it is not a decision anybody makes, and this must
  // not move if deriveRoutingFlags ever does.
  const derived = deriveRoutingFlags({ sinkQuantity: 0, quantity: 40 });
  assert.deepEqual(r, derived);
});

test("A SINK ON A SAMPLE ROW IS REFUSED, and the refusal explains itself", () => {
  const no = checkSampleSink("SAMPLE", 10);
  assert.equal(no.ok, false);
  if (!no.ok) {
    assert.match(no.reason, /Samples do not have sinks/);
    assert.match(no.reason, /cut, polished and packed/);
  }
  // Zero and null are not an attempt to set one.
  assert.equal(checkSampleSink("SAMPLE", 0).ok, true);
  assert.equal(checkSampleSink("SAMPLE", null).ok, true);
  assert.equal(checkSampleSink("SAMPLE", undefined).ok, true);
  // And a purchase order is none of this module's business.
  assert.equal(checkSampleSink("PO", 30).ok, true);
  assert.equal(checkSampleSink(null, 30).ok, true);
});

test("PACKING A SAMPLE PIECE CREDITS A SHELF — colour+finish, size, count", () => {
  const c = planSampleCredit({
    colourFinishId: "cf1", samplingSizeId: "sz1", quantity: 40,
    slabCode: "146838", pacificQcId: "qc1", fabSlabId: "fs1",
  });
  assert.ok(c);
  assert.equal(c!.colourFinishId, "cf1");
  assert.equal(c!.sizeId, "sz1");
  assert.equal(c!.quantity, 40);
  // Traceable back to the stone, exactly as the offcut path is.
  assert.equal(c!.sourceRef, "146838");
  assert.equal(c!.sourceQcId, "qc1");
  assert.equal(c!.sourceSlabId, "fs1");
});

test("A ROW THAT CANNOT NAME ITS SHELF CREDITS NOTHING — it does not guess one", () => {
  // A sample requirement carries the colour+finish and the sampling size it was
  // ordered against. Without both, the piece is stone that has been cut and
  // polished and belongs on no shelf. Packing it and crediting nothing is
  // honest; guessing a shelf makes a count wrong and nobody finds out.
  assert.equal(planSampleCredit({ samplingSizeId: "sz1", quantity: 1 }), null);
  assert.equal(planSampleCredit({ colourFinishId: "cf1", quantity: 1 }), null);
  assert.equal(planSampleCredit({ colourFinishId: " ", samplingSizeId: "sz1", quantity: 1 }), null);
  assert.equal(planSampleCredit({ colourFinishId: "cf1", samplingSizeId: "sz1", quantity: 0 }), null);
  assert.equal(planSampleCredit({ colourFinishId: "cf1", samplingSizeId: "sz1", quantity: -3 }), null);
  assert.equal(planSampleCredit({}), null);

  // A piece with no slab still credits — the shelf is what matters, and an
  // untraceable sample is better than an uncounted one.
  const c = planSampleCredit({ colourFinishId: "cf1", samplingSizeId: "sz1", quantity: 1 });
  assert.ok(c);
  assert.equal(c!.sourceRef, null);
  assert.equal(c!.sourceQcId, null);
});

test("sample orders are numbered in their own series", () => {
  assert.equal(sampleOrderCode(1), "SR-0001");
  assert.equal(sampleOrderCode(7), "SR-0007");
  assert.equal(sampleOrderCode(1234), "SR-1234");
  assert.equal(sampleOrderCode(12345), "SR-12345", "it grows rather than wrapping");
  assert.equal(sampleOrderCode(0), "SR-0001", "there is no order zero");

  assert.equal(sampleOrderNumber("SR-0007"), 7);
  assert.equal(sampleOrderNumber("sr-0007"), 7);
  assert.equal(sampleOrderNumber(" SR-0007 "), 7);
  // A purchase order code is not a sample order number.
  assert.equal(sampleOrderNumber("10026"), null);
  assert.equal(sampleOrderNumber("SR-"), null);
  assert.equal(sampleOrderNumber("SR-0000"), null);
  assert.equal(sampleOrderNumber(null), null);
});

test("THE NEXT NUMBER NEVER REUSES A DELETED ONE", () => {
  // Piece codes carrying SR-0003 may still be written on stone in the yard, so
  // its number is spent even if the order is gone. Reading the maximum rather
  // than counting is the whole of that guarantee.
  assert.equal(nextSampleOrderCode([]), "SR-0001");
  assert.equal(nextSampleOrderCode(["SR-0001", "SR-0002"]), "SR-0003");
  assert.equal(nextSampleOrderCode(["SR-0001", "SR-0003"]), "SR-0004", "0002 was deleted; it stays spent");
  // Purchase-order codes in the same list are ignored, not parsed.
  assert.equal(nextSampleOrderCode(["10026", "PRJ-9", "SR-0005", null, undefined]), "SR-0006");
  assert.equal(nextSampleOrderCode(["10026", "PRJ-9"]), "SR-0001");
});
