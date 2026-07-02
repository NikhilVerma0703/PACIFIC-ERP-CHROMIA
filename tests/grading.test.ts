import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalGrade, TRANSITIONS, DEFAULT_RESERVATION_DAYS } from "../src/lib/inventory/grading.ts";

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
