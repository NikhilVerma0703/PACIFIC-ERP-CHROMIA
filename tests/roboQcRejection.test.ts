// QC Rejection Analysis — the counting rules.
//
// The figures here are read by an analyst deciding whether the Robo line caused
// a batch's rejects, so the ways they can quietly be wrong are the point: a
// rate against the wrong denominator, a downgrade counted as a rejection, or a
// slab with two faults counted as two slabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summariseRejections, REJECT_GRADE, DOWNGRADE_GRADE, type QcRow,
} from "../src/lib/robo/qcRejection.ts";

const row = (grade: string | null, ...issues: string[]): QcRow =>
  ({ qualityGrade: grade, qualityIssue: issues });

test("only C (Reject) is a rejection — B is a downgrade and is reported apart", () => {
  const s = summariseRejections([
    row("A"), row("A2"),
    row(DOWNGRADE_GRADE, "Pinhole"), row(DOWNGRADE_GRADE, "Chipout"),
    row(REJECT_GRADE, "Crack"),
  ], 10);
  assert.equal(s.rejected, 1);
  assert.equal(s.downgraded, 2);
  // The B faults must NOT appear in the reasons table — those slabs still sell.
  assert.deepEqual(s.reasons.map((r) => r.reason), ["Crack"]);
});

test("the rate is of INSPECTED, not of produced", () => {
  // The trap this guards: QC lags the line. A batch of 344 with 77 inspected
  // and 2 rejected is 2.6% of what QC has seen, not 0.6% of the batch — and
  // the second number would read as a far better batch than it is.
  const rows = [
    ...Array.from({ length: 75 }, () => row("A")),
    row(REJECT_GRADE, "Crack"), row(REJECT_GRADE, "Pinhole"),
  ];
  const s = summariseRejections(rows, 344);
  assert.equal(s.produced, 344);
  assert.equal(s.inspected, 77);
  assert.equal(s.rejected, 2);
  assert.equal(s.rejectRatePct, 2.6);
});

test("a slab with two faults is ONE slab on two reason rows", () => {
  const s = summariseRejections([
    row(REJECT_GRADE, "Crack", "Pinhole"),
    row(REJECT_GRADE, "Crack"),
  ], 2);
  assert.equal(s.rejected, 2);
  const byReason = Object.fromEntries(s.reasons.map((r) => [r.reason, r.slabs]));
  assert.deepEqual(byReason, { Crack: 2, Pinhole: 1 });
  // Percentages are of REJECTED SLABS, so they may sum past 100. That is the
  // data being honest, not an arithmetic error.
  assert.equal(s.reasons.find((r) => r.reason === "Crack")!.pct, 100);
  assert.equal(s.reasons.find((r) => r.reason === "Pinhole")!.pct, 50);
});

test("the same fault listed twice on one slab counts once", () => {
  const s = summariseRejections([row(REJECT_GRADE, "Crack", "Crack")], 1);
  assert.equal(s.reasons.length, 1);
  assert.equal(s.reasons[0].slabs, 1);
});

test("reasons are NOT folded together — three pattern faults stay three", () => {
  // QC's master really does carry "Pattern Variation", "pattern Blur" and
  // "pattern problem" as separate entries meaning different things. Folding
  // them on case would invent a category the plant does not have.
  const s = summariseRejections([
    row(REJECT_GRADE, "Pattern Variation"),
    row(REJECT_GRADE, "pattern Blur"),
    row(REJECT_GRADE, "pattern problem"),
  ], 3);
  assert.equal(s.reasons.length, 3);
});

test("a rejected slab with no fault recorded is counted, not dropped", () => {
  // Otherwise the table silently fails to explain part of the reject total and
  // nobody can tell whether the gap is missing data or a bug here.
  const s = summariseRejections([
    row(REJECT_GRADE, "Crack"),
    row(REJECT_GRADE),
    row(REJECT_GRADE, ""),
  ], 3);
  assert.equal(s.rejected, 3);
  assert.equal(s.rejectedWithoutReason, 2);
  assert.equal(s.reasons.reduce((n, r) => n + r.slabs, 0), 1);
});

test("a batch QC has not reached yet reports zeroes, not a rate", () => {
  const s = summariseRejections([], 120);
  assert.equal(s.produced, 120);
  assert.equal(s.inspected, 0);
  assert.equal(s.rejected, 0);
  assert.equal(s.rejectRatePct, null, "no denominator means no rate, not 0%");
  assert.deepEqual(s.reasons, []);
});

test("reasons sort biggest first, ties alphabetical, so the order is stable", () => {
  const s = summariseRejections([
    row(REJECT_GRADE, "Zebra"), row(REJECT_GRADE, "Alpha"),
    row(REJECT_GRADE, "Beta"), row(REJECT_GRADE, "Beta"),
  ], 4);
  assert.deepEqual(s.reasons.map((r) => r.reason), ["Beta", "Alpha", "Zebra"]);
});

test("grades are matched after trimming, and an unknown grade is neither", () => {
  const s = summariseRejections([
    row(` ${REJECT_GRADE} `, "Crack"),
    row("Not graded yet"),
    row(null),
  ], 3);
  assert.equal(s.rejected, 1);
  assert.equal(s.downgraded, 0);
  assert.equal(s.inspected, 3, "everything QC has a row for counts as inspected");
});
