import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE_SOURCE, INTAKE_SOURCES, REASON_LABEL,
  isIntakeSource, offersReason,
  slabSourceRef, slabQcId, requireSlabSource,
  thicknessPrefill, matchColourName,
} from "../src/lib/sampling/fabIntake.ts";

// A SAMPLE MUST BE TRACEABLE TO THE STONE IT CAME OFF.
//
// Sample stock leaves the shop floor and does not come back. Once the slab is
// cut and gone, the only record of where a piece came from is what was written
// at intake — so a blank reference is not a small gap, it is the whole answer
// missing, permanently, with nothing left to reconstruct it from.
//
// The bridge is deliberately TWO values:
//   sourceRef  the slab number as the floor says it — what a person reads;
//   qcId       polish_qc.id — what survives a re-typed number, and what
//              "every sample cut off this slab" actually joins on.
// The readable one is required; the link is allowed to be absent, because a
// slab can be on the board without a QC record behind it.

const SLAB = { slabCode: "154700", colour: "Arva White", thicknessMm: 20, pacificQcId: "qc_abc" };

test("intake source: the enum values are named once, here", () => {
  assert.equal(INTAKE_SOURCE.SPECIAL_CUT, "SAMPLE_CUTTING");
  assert.equal(INTAKE_SOURCE.OFFCUT, "FAB_OFFCUT");
  // Every reason maps to a real enum value, and nothing else is accepted.
  for (const v of Object.values(INTAKE_SOURCE)) assert.ok(isIntakeSource(v), v);
  assert.deepEqual([...INTAKE_SOURCES].sort(), ["FAB_OFFCUT", "SAMPLE_CUTTING"]);
  for (const bad of ["", "sample_cutting", "OFFCUT", "SPECIAL_CUT", null, undefined, 0]) {
    assert.equal(isIntakeSource(bad), false, String(bad));
  }
  // Both controls have a label, so neither screen can invent its own wording.
  assert.equal(typeof REASON_LABEL.SPECIAL_CUT, "string");
  assert.equal(typeof REASON_LABEL.OFFCUT, "string");
});

test("intake source: the two controls are mutually exclusive on any one slab", () => {
  // Falls out of the physical fact: a slab that has not gone to the saw has no
  // leftovers, and one that has is no longer the supervisor's to re-purpose.
  for (const sent of [true, false]) {
    const slab = { sent };
    assert.notEqual(offersReason("SPECIAL_CUT", slab), offersReason("OFFCUT", slab));
  }
  assert.equal(offersReason("SPECIAL_CUT", { sent: false }), true);
  assert.equal(offersReason("OFFCUT", { sent: false }), false);
  assert.equal(offersReason("SPECIAL_CUT", { sent: true }), false);
  assert.equal(offersReason("OFFCUT", { sent: true }), true);
  // A slab we know nothing about offers the pre-cut control only — it cannot
  // have leftovers it has not been proven to have.
  assert.equal(offersReason("OFFCUT", null), false);
  assert.equal(offersReason("OFFCUT", undefined), false);
  assert.equal(offersReason("OFFCUT", {}), false);
});

test("trace: the readable reference is the slab number", () => {
  assert.equal(slabSourceRef(SLAB), "154700");
  assert.equal(slabSourceRef({ slabCode: "  154700  " }), "154700");
  // Blank is null, never "" — an empty string in the column would read as a
  // reference that exists and says nothing.
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(slabSourceRef({ slabCode: v }), null, JSON.stringify(v));
  }
  assert.equal(slabSourceRef(null), null);
  assert.equal(slabSourceRef(undefined), null);
});

test("trace: the QC link is an id or nothing", () => {
  assert.equal(slabQcId(SLAB), "qc_abc");
  assert.equal(slabQcId({ pacificQcId: "  qc_abc  " }), "qc_abc");
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(slabQcId({ pacificQcId: v }), null, JSON.stringify(v));
  }
  assert.equal(slabQcId(null), null);
});

test("trace: A SLAB WITH NO NUMBER CANNOT BECOME SAMPLE STOCK", () => {
  // The defect this exists to stop: the control handed `?? ""` to a LOCKED
  // field and the route accepted null, so the intake succeeded and the pieces
  // became untraceable — with no way to notice and no way to repair it, because
  // the field could not be typed into and the slab was gone.
  for (const slab of [null, undefined, {}, { slabCode: "" }, { slabCode: "  " }, { pacificQcId: "qc_1" }]) {
    const got = requireSlabSource(slab);
    assert.equal(got.ok, false, JSON.stringify(slab));
    if (!got.ok) {
      // The refusal has to say what to DO, not just that it refused.
      assert.match(got.reason, /slab number/i);
      assert.match(got.reason, /QC/);
    }
  }
  // A QC id alone is NOT enough: the number is what a person reads on the
  // intake list and argues about on the floor.
  const idOnly = requireSlabSource({ pacificQcId: "qc_1" });
  assert.equal(idOnly.ok, false);
});

test("trace: a numbered slab passes, and carries both halves", () => {
  const got = requireSlabSource(SLAB);
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.sourceRef, "154700");
    assert.equal(got.qcId, "qc_abc");
  }
});

test("trace: a numbered slab with NO QC record is still traceable", () => {
  // Legitimate: a slab can reach the board without a polish_qc row behind it.
  // The readable number is the record; the link is simply absent, not faked.
  const got = requireSlabSource({ slabCode: "MANUAL-7", pacificQcId: null });
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.sourceRef, "MANUAL-7");
    assert.equal(got.qcId, null);
  }
});

test("prefill: thickness arrives WITH ITS UNIT or not at all", () => {
  // A bare "20" is refused by parseThicknessMm — 2 is 2 cm to the man cutting
  // it — so a unitless prefill would look complete and then fail.
  assert.equal(thicknessPrefill(20), "20 mm");
  assert.equal(thicknessPrefill(19.8), "20 mm");   // gauge reading, rounded
  assert.equal(thicknessPrefill(30), "30 mm");
  for (const v of [null, undefined, 0, -5, NaN, Infinity]) {
    assert.equal(thicknessPrefill(v as number), "", String(v));
  }
});

test("prefill: the colour refuses to guess", () => {
  const names = ["Arva White", "Cappuccino", "Cappuccino Dark", "Artemis Grey/Deepwave"];
  assert.equal(matchColourName(names, "Arva White"), "Arva White");
  assert.equal(matchColourName(names, "  arva   white "), "Arva White");
  assert.equal(matchColourName(names, "Artemis Grey / Deepwave"), "Artemis Grey/Deepwave");
  // The trap: a prefix match would file Cappuccino under Cappuccino Dark.
  assert.equal(matchColourName(names, "Cappuccino"), "Cappuccino");
  assert.equal(matchColourName(names, "Capp"), null);
  assert.equal(matchColourName(names, "White"), null);
  // Ambiguity is not a near-miss.
  assert.equal(matchColourName(["Grey", "grey"], "GREY"), null);
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(matchColourName(names, v), null, JSON.stringify(v));
  }
});
