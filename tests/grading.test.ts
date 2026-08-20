import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalGrade, gradeBlocksDispatch, TRANSITIONS, DEFAULT_RESERVATION_DAYS } from "../src/lib/inventory/grading.ts";

test("canonicalGrade normalizes QC grades", () => {
  assert.equal(canonicalGrade("A"), "A");
  assert.equal(canonicalGrade("A2"), "A2");
  assert.equal(canonicalGrade("C (Reject)"), "C");
  assert.equal(canonicalGrade("c (reject)"), "c");
  assert.equal(canonicalGrade("  B  "), "B");
  assert.equal(canonicalGrade("Not graded yet"), null);
  assert.equal(canonicalGrade("not graded"), null);
  assert.equal(canonicalGrade(""), null);
  assert.equal(canonicalGrade(null), null);
  assert.equal(canonicalGrade(undefined), null);
  assert.equal(canonicalGrade(42), null);
  assert.equal(canonicalGrade("CTS"), "CTS");
  assert.equal(canonicalGrade("Printing"), "Printing");
});

test("status transitions: every action lands where the lifecycle says", () => {
  assert.equal(TRANSITIONS.reserve.to, "RESERVED");
  assert.equal(TRANSITIONS.release.to, "AVAILABLE");
  assert.equal(TRANSITIONS.pack.to, "PACKED");
  assert.equal(TRANSITIONS.dispatch.to, "DISPATCHED");
  assert.equal(TRANSITIONS.return.to, "RETURNED");
});

test("status transitions: forbidden moves stay forbidden", () => {
  assert.ok(!TRANSITIONS.dispatch.from.includes("DISPATCHED"), "no double dispatch");
  assert.ok(!TRANSITIONS.reserve.from.includes("DISPATCHED"), "can't reserve dispatched stock");
  assert.ok(!TRANSITIONS.reserve.from.includes("PACKED"), "packed stock is spoken for");
  assert.ok(!TRANSITIONS.return.from.includes("AVAILABLE"), "only dispatched slabs return");
  assert.deepEqual(TRANSITIONS.return.from, ["DISPATCHED"]);
});

test("returned slabs can re-enter the cycle", () => {
  for (const a of ["reserve", "release", "pack"] as const)
    assert.ok(TRANSITIONS[a].from.includes("RETURNED"), `${a} accepts RETURNED`);
});

test("default reservation hold is 7 days", () => {
  assert.equal(DEFAULT_RESERVATION_DAYS, 7);
});

test("CTS is a dead end with exactly one way out", () => {
  // The invariant the whole design rests on. CTS is deliberately NOT dispatchable -- a
  // slab being cut does not ship as a full slab -- which makes the exit load-bearing.
  // Commercial can apply cts but is refused `release`, so if uncts ever disappears they
  // could strand stock in a state only Finance can clear.
  assert.equal(TRANSITIONS.cts.to, "CTS");
  assert.ok(!TRANSITIONS.dispatch.from.includes("CTS"), "a slab being cut is not shipped whole");
  assert.deepEqual(TRANSITIONS.uncts.from, ["CTS"], "uncts applies to CTS and nothing else");
  assert.equal(TRANSITIONS.uncts.to, "AVAILABLE");
  assert.ok(TRANSITIONS.release.from.includes("CTS"), "Finance/Admin can release it too");
});

test("CTS cannot be reached from a shipped or returned slab", () => {
  assert.ok(!TRANSITIONS.cts.from.includes("DISPATCHED"), "a dispatched slab is gone; CTS would put it back on the books");
  assert.ok(!TRANSITIONS.cts.from.includes("RETURNED"), "a returned slab is released first");
  assert.deepEqual(TRANSITIONS.cts.from, TRANSITIONS.dispatch.from, "cts mirrors dispatch's entry points");
});

test("every action lands on a real SlabStatus", () => {
  // The enum in prisma/schema.prisma. A typo here writes a value Postgres rejects at
  // runtime with 22P02, which no typecheck would catch -- TRANSITIONS values are strings.
  const STATUSES = ["AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED", "CTS"];
  for (const [action, t] of Object.entries(TRANSITIONS)) {
    assert.ok(STATUSES.includes(t.to), `${action} lands on a real status (${t.to})`);
    for (const f of t.from) assert.ok(STATUSES.includes(f), `${action} accepts a real status (${f})`);
  }
});

// --- CTS is not dispatchable, by GRADE as well as by status -----------------
//
// The status has never been dispatchable (it is absent from dispatch.from). The
// grade was the hole: QC writes it on every pass, the status is a separate manual
// action, and nothing read the grade at dispatch time — so a slab the floor had
// already graded cut-to-size shipped as a full slab whenever nobody remembered to
// also apply the status.

test("a slab graded CTS is refused dispatch, whatever its case", () => {
  assert.equal(gradeBlocksDispatch("CTS"), true);
  assert.equal(gradeBlocksDispatch("cts"), true);
  assert.equal(gradeBlocksDispatch("Cts"), true);
  assert.equal(gradeBlocksDispatch("  CTS  "), true);
});

test("every other grade still dispatches", () => {
  for (const g of ["A", "A2", "B", "C", "C (Reject)", "c (reject)", "Printing"]) {
    assert.equal(gradeBlocksDispatch(g), false, `${g} must remain dispatchable`);
  }
});

test("an ungraded slab is not blocked — absence of a grade is not a CTS grade", () => {
  for (const g of [null, undefined, "", "   ", "Not graded yet", "not graded", 7, {}]) {
    assert.equal(gradeBlocksDispatch(g), false, `${JSON.stringify(g)} must not block`);
  }
});

test("the CTS status remains a dead end, independently of grade", () => {
  // Belt and braces: the two signals are separate and both must hold.
  assert.equal(TRANSITIONS.dispatch.from.includes("CTS"), false);
  assert.equal(TRANSITIONS.uncts.from.includes("CTS"), true);
  assert.equal(TRANSITIONS.uncts.to, "AVAILABLE");
});
