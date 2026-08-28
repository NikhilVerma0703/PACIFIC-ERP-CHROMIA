import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUALITY_GRADES, NON_GRADE_VALUES,
  canonicalGrade, qualityGradeOf, isRoutingGrade,
  gradeTone, gradeLabel, gradeTitle, describeGrade,
} from "../src/lib/fab/qcGrade.ts";
import { canonicalGrade as inventoryCanonical } from "../src/lib/inventory/grading.ts";

// polish_qc.quality_grade holds SIX values — A, A2, B, C, CTS, Printing — and
// they are not six points on one scale:
//
//   A A2 B C   the polishing line's VERDICT on the stone
//   CTS        cut-to-size: taken for fabrication, no longer dispatchable whole
//   Printing   routed to printing
//
// The fabrication module OVERWRITES the column with 'CTS' the moment a
// supervisor picks a slab, so on the CEO dashboard every fabrication slab reads
// CTS. A chip that colours by first letter paints that red — identical to grade
// C, the worst verdict there is — and the whole floor looks like it is cutting
// rejects. That is the bug these tests exist for.

test("a GRADE is only ever A / A2 / B / C — everything else is a mark", () => {
  assert.deepEqual([...QUALITY_GRADES], ["A", "A2", "B", "C"]);
  assert.deepEqual([...NON_GRADE_VALUES], ["CTS", "Printing", "FULL_SLAB", "SAMPLE"]);
});

test("canonicalGrade agrees with the inventory copy, spelling for spelling", () => {
  // Two copies exist because both modules import nothing. They must not drift.
  for (const g of ["A", "A2", "B", "C", "C (Reject)", "c (reject)", "CTS", "Printing",
                   "", "   ", "Not graded yet", "not graded", null, undefined, 42]) {
    assert.equal(canonicalGrade(g), inventoryCanonical(g as string), JSON.stringify(g));
  }
  assert.equal(canonicalGrade("C (Reject)"), "C");
  assert.equal(canonicalGrade("Not graded yet"), null);
  assert.equal(canonicalGrade("  B  "), "B");
});

test("CTS IS NOT A QUALITY GRADE — the whole point", () => {
  assert.equal(qualityGradeOf("CTS"), null, "asking 'how good is this stone' about CTS has no answer");
  assert.equal(isRoutingGrade("CTS"), true);
  assert.equal(gradeTone("CTS"), "routing");
  assert.notEqual(gradeTone("CTS"), gradeTone("C"), "CTS must not look like grade C");
  assert.equal(gradeTone("C"), "poor");
  // Case does not matter — the column is free text written by inspectors.
  for (const v of ["cts", "Cts", " CTS "]) {
    assert.equal(isRoutingGrade(v), true, v);
    assert.equal(gradeTone(v), "routing", v);
  }
  assert.equal(gradeLabel("cts"), "CTS", "printed in its own casing");
});

test("a MARK in the grade column does not read as a grade", () => {
  for (const v of ["FULL_SLAB", "full slab", "SAMPLE", "sample"]) {
    assert.equal(qualityGradeOf(v), null, v);
    assert.equal(isRoutingGrade(v), true, v);
    assert.equal(gradeTone(v), "routing", v);
  }
});

test("Printing is a routing state too, and does not read as a grade", () => {
  assert.equal(qualityGradeOf("Printing"), null);
  assert.equal(isRoutingGrade("Printing"), true);
  assert.equal(gradeTone("Printing"), "routing");
  assert.equal(gradeLabel("printing"), "Printing");
});

test("the four real verdicts keep their tones", () => {
  assert.equal(qualityGradeOf("A"), "A");
  assert.equal(qualityGradeOf("A2"), "A2");
  assert.equal(qualityGradeOf("b"), "B");
  assert.equal(qualityGradeOf("C (Reject)"), "C", "QC's historical spelling still reads as C");
  assert.equal(gradeTone("A"), "good");
  assert.equal(gradeTone("A2"), "good");
  assert.equal(gradeTone("B"), "fair");
  assert.equal(gradeTone("C"), "poor");
  assert.equal(gradeTone("C (Reject)"), "poor");
});

test("UNGRADED IS NOT GRADE A — it reads as a dash and its own tone", () => {
  for (const v of ["", "   ", "Not graded yet", null, undefined, 7]) {
    assert.equal(gradeLabel(v), "—", JSON.stringify(v));
    assert.equal(gradeTone(v), "unknown", JSON.stringify(v));
    assert.equal(qualityGradeOf(v), null, JSON.stringify(v));
  }
  assert.notEqual(gradeTone(null), gradeTone("A"));
});

test("an unrecognised word is shown as typed, not silently binned", () => {
  // If QC starts writing something new, the screen says what it says rather
  // than pretending it is ungraded.
  assert.equal(gradeLabel("Special"), "Special");
  assert.equal(gradeTone("Special"), "unknown");
  assert.equal(qualityGradeOf("Special"), null);
  assert.equal(isRoutingGrade("Special"), false);
});

test("the hover explains CTS, because the word means nothing on its own", () => {
  assert.match(gradeTitle("CTS"), /cut to size/i);
  assert.match(gradeTitle("CTS"), /not a quality verdict/i);
  assert.match(gradeTitle("C"), /rejected/i);
  assert.match(gradeTitle("A"), /passed/i);
  assert.match(gradeTitle(null), /not graded/i);
});

test("WHERE THE ORIGINAL VERDICT SURVIVED, both are shown", () => {
  // markQcSlabCts destroys the A/B/C. scripts/0056 preserves it first, and then
  // "A · CTS" says the stone was good AND has been cut — which is the question
  // the CEO actually asked.
  assert.equal(describeGrade("CTS", "A"), "A · CTS");
  assert.equal(describeGrade("CTS", "C (Reject)"), "C · CTS");
  // Without a preserved value there is only CTS, and no way to know what it was.
  assert.equal(describeGrade("CTS", null), "CTS");
  assert.equal(describeGrade("CTS", "Not graded yet"), "CTS");
  // A slab that was never routed shows its verdict alone, not "A · A".
  assert.equal(describeGrade("A", "A"), "A");
  assert.equal(describeGrade("B", null), "B");
  assert.equal(describeGrade(null, "A"), "—", "a preserved value cannot resurrect a missing current one");
});
