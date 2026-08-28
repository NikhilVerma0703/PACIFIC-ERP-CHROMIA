import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLAB_MARKS, DEFAULT_SLAB_MARK, SLAB_MARK_LABEL, SLAB_MARK_TITLE,
  parseSlabMark, slabMarkOf, checkMarkTransition, isCut, markTone,
} from "../src/lib/fab/slabMark.ts";

// The owner's model, in his words: "CTS is not a grade, it's a mark. Marks
// should be full slab, CTS, sample. That's it. Initially full slab; if
// fabrication happened, CTS; if it's pushed to sample, sample."
//
// So a slab carries TWO facts:
//   GRADE  A / A2 / B / C            how good the stone is  (qcGrade.ts)
//   MARK   FULL_SLAB / CTS / SAMPLE  what became of it      (here)
// A grade C slab cut to size is grade C AND CTS. Neither replaces the other.

test("there are exactly three marks, and one of them is where everything starts", () => {
  assert.deepEqual([...SLAB_MARKS], ["FULL_SLAB", "CTS", "SAMPLE"]);
  assert.equal(DEFAULT_SLAB_MARK, "FULL_SLAB");
  for (const m of SLAB_MARKS) {
    assert.ok(SLAB_MARK_LABEL[m], m);
    assert.ok(SLAB_MARK_TITLE[m], m);
  }
  assert.equal(SLAB_MARK_LABEL.FULL_SLAB, "Full slab");
  assert.equal(SLAB_MARK_LABEL.CTS, "CTS");
  assert.equal(SLAB_MARK_LABEL.SAMPLE, "Sample");
});

test("spelling is forgiven, membership is not", () => {
  for (const v of ["full slab", "FULL-SLAB", " full_slab ", "Full Slab"]) {
    assert.equal(parseSlabMark(v), "FULL_SLAB", v);
  }
  assert.equal(parseSlabMark("cts"), "CTS");
  assert.equal(parseSlabMark(" Sample "), "SAMPLE");
  // A word outside the three is NOT mapped to a neighbour. Guessing here would
  // file a slab as uncut on the strength of a typo.
  for (const v of ["", "  ", "FULL", "SAMPLES", "CT", "Printing", "A", null, undefined, 3]) {
    assert.equal(parseSlabMark(v as string), null, JSON.stringify(v));
  }
});

test("A SLAB WITH NO MARK IS FULL — unless the old CTS write says otherwise", () => {
  // A database without scripts/0057 has no mark column, but it does have the
  // legacy `quality_grade = 'CTS'`. Reading that keeps every already-cut slab
  // correct from the first render, instead of a floor full of "Full slab".
  assert.equal(slabMarkOf(null), "FULL_SLAB");
  assert.equal(slabMarkOf(undefined), "FULL_SLAB");
  assert.equal(slabMarkOf(""), "FULL_SLAB");
  assert.equal(slabMarkOf(null, "CTS"), "CTS", "the legacy signal is honoured");
  assert.equal(slabMarkOf(null, "cts"), "CTS");
  assert.equal(slabMarkOf(null, "A"), "FULL_SLAB", "a real grade says nothing about the mark");
  // An explicit mark always wins over the legacy guess.
  assert.equal(slabMarkOf("SAMPLE", "CTS"), "SAMPLE");
  assert.equal(slabMarkOf("FULL_SLAB", "CTS"), "FULL_SLAB");
});

test("A SLAB IS CUT ONCE — full slab is the only state anything leaves", () => {
  const ok = (from: unknown, to: unknown) => checkMarkTransition(from, to).ok;

  // The two real journeys.
  assert.ok(ok("FULL_SLAB", "CTS"),    "fabrication took it");
  assert.ok(ok("FULL_SLAB", "SAMPLE"), "sampling took it");
  assert.ok(ok(null, "CTS"),           "an unmarked slab is full, so it may be cut");

  // Cut stone does not become whole again...
  assert.equal(ok("CTS", "FULL_SLAB"), false);
  assert.equal(ok("SAMPLE", "FULL_SLAB"), false);
  // ...and the two cut states are not interchangeable: stone that went to
  // sampling did not become a customer's countertop.
  assert.equal(ok("CTS", "SAMPLE"), false);
  assert.equal(ok("SAMPLE", "CTS"), false);

  // Idempotent, so a repeated action is not an error — markQcSlabCts runs
  // again whenever a supervisor re-picks the same slab.
  assert.ok(ok("CTS", "CTS"));
  assert.ok(ok("SAMPLE", "SAMPLE"));
  assert.ok(ok("FULL_SLAB", "FULL_SLAB"));
});

test("a refusal says WHICH WAY ROUND it is", () => {
  const r = checkMarkTransition("SAMPLE", "CTS");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /already marked Sample/);
    assert.match(r.reason, /cannot become CTS/);
    assert.match(r.reason, /cut once/);
  }
  const bad = checkMarkTransition("FULL_SLAB", "MELTED");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.reason, /not a slab mark/);
});

test("isCut is what dispatch actually cares about", () => {
  // Either way of being cut stops a slab going out whole. A CTS slab and a
  // SAMPLE slab are different histories and the same answer here.
  assert.equal(isCut("CTS"), true);
  assert.equal(isCut("SAMPLE"), true);
  assert.equal(isCut("FULL_SLAB"), false);
  assert.equal(isCut(null), false, "unmarked means full, so dispatchable");
});

test("the mark's colours are NOT the grade's — a CTS slab is not a bad slab", () => {
  // The two chips sit side by side. If CTS were red like grade C, the floor
  // would read as though it were cutting rejects.
  assert.equal(markTone("FULL_SLAB"), "whole");
  assert.equal(markTone("CTS"), "fabrication");
  assert.equal(markTone("SAMPLE"), "sample");
  assert.equal(markTone(null), "whole");
  const tones = SLAB_MARKS.map(markTone);
  assert.equal(new Set(tones).size, SLAB_MARKS.length, "each mark reads distinctly");
});
