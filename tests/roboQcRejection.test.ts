// QC Rejection Analysis — the counting rules for Robo-line rejections.
//
// The figures here are read by a manager deciding how many QC rejections the
// Robo line caused, so the ways they can quietly be wrong are the point: an
// unrelated fault counted against the Robo line, a near-miss fault name
// ("Pattern Variation") mistaken for a Robo one, a rate against the wrong
// denominator, a downgrade counted as a rejection, or a slab with two Robo
// faults counted as two slabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summariseRejections, roboReasonOf, ROBO_REJECTION_REASONS,
  REJECT_GRADE, DOWNGRADE_GRADE, type QcRow,
} from "../src/lib/robo/qcRejection.ts";

const SPILL = "Spillage";
const PATTERN = "Pattern Problem in QC Line";

const row = (grade: string | null, ...issues: string[]): QcRow =>
  ({ qualityGrade: grade, qualityIssue: issues });
const rows = (n: number, grade: string | null, ...issues: string[]): QcRow[] =>
  Array.from({ length: n }, () => row(grade, ...issues));
const slabsOf = (s: ReturnType<typeof summariseRejections>, reason: string) =>
  s.reasons.find((r) => r.reason === reason)!.slabs;
const pctOf = (s: ReturnType<typeof summariseRejections>, reason: string) =>
  s.reasons.find((r) => r.reason === reason)!.pct;

test("the owner's example: 250 produced, 20 Robo-line rejects → Rejection Rate 8%", () => {
  // 30 slabs rejected for Crack sit in the same batch. They are QC rejections,
  // but not the Robo line's — counting them would read 50/250 = 20%.
  const s = summariseRejections([
    ...rows(12, REJECT_GRADE, "Spillage"),
    ...rows(8, REJECT_GRADE, "pattern problem"),
    ...rows(30, REJECT_GRADE, "Crack"),
    ...rows(180, "A"),
  ], 250);
  assert.equal(s.produced, 250);
  assert.equal(s.inspected, 230);
  assert.equal(s.roboRejected, 20, "only Spillage + Pattern Problem count");
  assert.equal(s.rejectionRatePct, 8, "20 / 250 × 100");
  assert.equal(slabsOf(s, SPILL), 12);
  assert.equal(slabsOf(s, PATTERN), 8);
  assert.equal(pctOf(s, SPILL), 60, "12 of the 20 Robo-line rejects");
  assert.equal(pctOf(s, PATTERN), 40, "8 of the 20 Robo-line rejects");
});

test("every other QC fault is excluded — from the count AND the table", () => {
  const s = summariseRejections([
    row(REJECT_GRADE, "Crack"), row(REJECT_GRADE, "Pinhole"),
    row(REJECT_GRADE, "Oil Dot"), row(REJECT_GRADE, "Chipout"),
  ], 10);
  assert.equal(s.roboRejected, 0, "none of these is the Robo line's");
  assert.equal(s.rejectionRatePct, 0);
  assert.deepEqual(s.reasons.map((r) => r.reason), [SPILL, PATTERN], "nothing else is ever listed");
  assert.ok(s.reasons.every((r) => r.slabs === 0 && r.pct === 0));
});

test("near-miss pattern faults are NOT the Robo line's: Pattern Variation / pattern Blur stay out", () => {
  // QC's master carries these as separate faults meaning different things. A
  // loose match on "pattern" would pull them in and overstate the Robo line.
  const s = summariseRejections([
    row(REJECT_GRADE, "Pattern Variation"),
    row(REJECT_GRADE, "pattern Blur"),
    row(REJECT_GRADE, "Pattern Variations"),
    row(REJECT_GRADE, "pattern problem"),
  ], 4);
  assert.equal(s.roboRejected, 1, "only the pattern problem slab");
  assert.equal(slabsOf(s, PATTERN), 1);
  assert.equal(roboReasonOf("Pattern Variation"), null);
  assert.equal(roboReasonOf("pattern Blur"), null);
  assert.equal(roboReasonOf("Vein Spillage"), null, "a different fault name, not Spillage");
});

test("QC's free-text spellings of the two faults are all recognised", () => {
  for (const v of ["Spillage", "spillage", "SPILLAGE", "  Spillage  ", "Spillage.", "spillage;"]) {
    assert.equal(roboReasonOf(v), SPILL, `"${v}" is Spillage`);
  }
  for (const v of [
    "Pattern Problem in QC Line", "pattern problem in qc line", "Pattern  Problem in QC  line",
    "pattern problem", "Pattern Problem", "pattern-problem", "Pattern_Problem.",
  ]) {
    assert.equal(roboReasonOf(v), PATTERN, `"${v}" is Pattern Problem in QC Line`);
  }
  for (const v of ["", "   ", null, undefined]) assert.equal(roboReasonOf(v), null);
});

test("the rate is of PRODUCED, not of inspected", () => {
  // 344 produced, 77 inspected, 2 Robo-line rejects: 2/344, not 2/77.
  const s = summariseRejections([
    ...rows(75, "A"),
    row(REJECT_GRADE, "Spillage"), row(REJECT_GRADE, "Pattern Problem in QC Line"),
  ], 344);
  assert.equal(s.inspected, 77);
  assert.equal(s.roboRejected, 2);
  assert.equal(s.rejectionRatePct, 0.6, "2 / 344 × 100, one decimal");
});

test("a slab with BOTH Robo faults is ONE rejected slab, on both table rows", () => {
  const s = summariseRejections([
    row(REJECT_GRADE, "Spillage", "pattern problem"),
    row(REJECT_GRADE, "Spillage"),
  ], 2);
  assert.equal(s.roboRejected, 2, "two slabs, not three");
  assert.equal(slabsOf(s, SPILL), 2);
  assert.equal(slabsOf(s, PATTERN), 1);
  // Percentages are of Robo-line rejected SLABS, so they may sum past 100.
  assert.equal(pctOf(s, SPILL), 100);
  assert.equal(pctOf(s, PATTERN), 50);
});

test("a slab rejected for a Robo fault AND an unrelated one counts once, the unrelated fault unseen", () => {
  const s = summariseRejections([row(REJECT_GRADE, "Crack", "Spillage", "Pinhole")], 5);
  assert.equal(s.roboRejected, 1);
  assert.equal(slabsOf(s, SPILL), 1);
  assert.deepEqual(s.reasons.map((r) => r.reason), [SPILL, PATTERN]);
});

test("the same fault twice — or two spellings of it — on one slab counts once", () => {
  const s = summariseRejections([
    row(REJECT_GRADE, "Spillage", "spillage "),
    row(REJECT_GRADE, "pattern problem", "Pattern Problem in QC Line"),
  ], 2);
  assert.equal(s.roboRejected, 2);
  assert.equal(slabsOf(s, SPILL), 1);
  assert.equal(slabsOf(s, PATTERN), 1);
});

test("only C (Reject) is a rejection — a B or A slab carrying Spillage is not counted", () => {
  const s = summariseRejections([
    row(DOWNGRADE_GRADE, "Spillage"), row(DOWNGRADE_GRADE, "pattern problem"),
    row("A", "Spillage"),
    row(REJECT_GRADE, "Spillage"),
  ], 10);
  assert.equal(s.roboRejected, 1, "the downgrades still sell; only the C slab is rejected");
  assert.equal(slabsOf(s, SPILL), 1);
  assert.equal(slabsOf(s, PATTERN), 0);
});

test("a rejected slab with no fault recorded is not a Robo-line rejection", () => {
  const s = summariseRejections([row(REJECT_GRADE), row(REJECT_GRADE, ""), row(REJECT_GRADE, "Spillage")], 3);
  assert.equal(s.roboRejected, 1);
});

test("no Robo-line rejections reads 0 and 0% — with both rows still shown", () => {
  const s = summariseRejections([...rows(40, "A"), row(REJECT_GRADE, "Crack")], 50);
  assert.equal(s.roboRejected, 0);
  assert.equal(s.rejectionRatePct, 0, "0 of 50 produced is 0%, not blank");
  assert.deepEqual(s.reasons, [
    { reason: SPILL, slabs: 0, pct: 0 },
    { reason: PATTERN, slabs: 0, pct: 0 },
  ]);
});

test("a batch QC has not reached yet: inspected 0, nothing rejected, rate 0% of produced", () => {
  const s = summariseRejections([], 120);
  assert.equal(s.produced, 120);
  assert.equal(s.inspected, 0);
  assert.equal(s.roboRejected, 0);
  assert.equal(s.rejectionRatePct, 0);
  assert.equal(s.reasons.length, 2);
});

test("nothing produced means no rate, not 0%", () => {
  const s = summariseRejections([row(REJECT_GRADE, "Spillage")], 0);
  assert.equal(s.rejectionRatePct, null, "no denominator");
});

test("the table is always exactly the two Robo faults, in a fixed order", () => {
  // Pattern outnumbers Spillage here; the order must not follow the counts, so
  // the table reads the same way for every batch.
  const s = summariseRejections([
    ...rows(3, REJECT_GRADE, "pattern problem"), row(REJECT_GRADE, "Spillage"),
  ], 4);
  assert.deepEqual(s.reasons.map((r) => r.reason), [SPILL, PATTERN]);
  assert.deepEqual(ROBO_REJECTION_REASONS.map((r) => r.label), [SPILL, PATTERN]);
});

test("grades are matched after trimming; an unknown grade is not a rejection; every QC row is inspected", () => {
  const s = summariseRejections([
    row(` ${REJECT_GRADE} `, "Spillage"),
    row("Not graded yet", "Spillage"),
    row(null, "pattern problem"),
  ], 3);
  assert.equal(s.roboRejected, 1);
  assert.equal(s.inspected, 3, "everything QC has a row for counts as inspected");
});
