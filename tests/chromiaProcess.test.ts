import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONABLE_STATUSES, ALL_STATUSES, canAdvance, daysBetween, dispositionAllowed,
  GRADE_DISPOSITIONS, MAX_RECALIBRATION_ATTEMPTS, nextStage, processingMinutes,
  PRODUCTION_STAGES, RECALIBRATION_OVERDUE_DAYS, recalibrationAgeing,
  recalibrationEligibility, STAGE_LABEL, STAGE_ORDER, stageSequence,
  STATUS_LABEL, TERMINAL_STATUSES, thicknessRemoved,
  type ProcessStage, type SlabStatus,
} from "../src/lib/chromia/process.ts";

// These are the rules the Excel register could not enforce, which is why the
// module exists at all: nothing in a spreadsheet stops a slab being marked
// despatched while it is out for recalibration, or being sent for a sixth pass
// when there is no surface left to remove.

test("the ten stages are in process order and each has a label", () => {
  assert.equal(STAGE_ORDER.length, 10);
  assert.equal(STAGE_ORDER[0], "INCOMING");
  assert.equal(STAGE_ORDER.at(-1), "GRADE_DECISION");
  for (const s of STAGE_ORDER) {
    assert.ok(STAGE_LABEL[s], `no label for ${s}`);
  }
  assert.equal(new Set(STAGE_ORDER).size, STAGE_ORDER.length, "no stage twice");
});

test("stageSequence is 1-based and nextStage runs off the end", () => {
  assert.equal(stageSequence("INCOMING"), 1);
  assert.equal(stageSequence("GRADE_DECISION"), 10);
  assert.equal(nextStage("INCOMING"), "INCOMING_DETAILS");
  assert.equal(nextStage("QUALITY_CHECK"), "GRADE_DECISION");
  assert.equal(nextStage("GRADE_DECISION"), null);
});

test("the six production stages are the ones inside the timing window", () => {
  // Timed as one block between in-time and out-time, which is why the cycle
  // carries a single inTime/outTime pair rather than six.
  assert.deepEqual([...PRODUCTION_STAGES],
    ["BASE_PRIMER", "PRINTING", "MOULDING", "COOLING", "POLISHING", "UV_POLISHING"]);
  // They are contiguous in the line — stages 3 to 8.
  assert.deepEqual(PRODUCTION_STAGES.map(stageSequence), [3, 4, 5, 6, 7, 8]);
});

test("a slab advances one stage at a time and never skips one", () => {
  assert.equal(canAdvance(null, "INCOMING"), true, "a new slab starts at Incoming");
  assert.equal(canAdvance(null, "PRINTING"), false);
  assert.equal(canAdvance("BASE_PRIMER", "PRINTING"), true);

  // The failure this exists to stop: an operator taps the stage they are
  // working on rather than the next one, and priming silently never happened.
  assert.equal(canAdvance("INCOMING_DETAILS", "PRINTING"), false, "skipped Base Primer");
  assert.equal(canAdvance("PRINTING", "PRINTING"), false, "same stage twice");
  assert.equal(canAdvance("PRINTING", "BASE_PRIMER"), false, "backwards");
  assert.equal(canAdvance("GRADE_DECISION", "INCOMING"), false, "wrapping round");
});

test("every stage in the line can be reached by advancing from the one before", () => {
  let current: ProcessStage | null = null;
  for (const stage of STAGE_ORDER) {
    assert.equal(canAdvance(current, stage), true, `stuck before ${stage}`);
    current = stage;
  }
  assert.equal(nextStage(current!), null);
});

// --- the lifecycle has to be completable -----------------------------------

test("every status is either terminal or actionable, and never both", () => {
  // The partition is the point. The operator board's queue was hand-written the
  // first time and left out UNDER_INSPECTION and GRADED, so the QC panel could
  // never appear and a graded slab had no screen that could record its outcome
  // — the lifecycle stopped dead at the end of processing. Deriving one list
  // from the other makes that omission impossible; this pins the derivation.
  assert.equal(new Set(ALL_STATUSES).size, ALL_STATUSES.length, "no status twice");
  for (const s of ALL_STATUSES) {
    const terminal = TERMINAL_STATUSES.includes(s);
    const actionable = ACTIONABLE_STATUSES.includes(s);
    assert.notEqual(terminal, actionable, `${s} is neither or both`);
  }
  assert.equal(
    TERMINAL_STATUSES.length + ACTIONABLE_STATUSES.length,
    ALL_STATUSES.length,
  );
});

test("the statuses a slab passes through on its way to an outcome are all actionable", () => {
  // The happy path, end to end. If any of these ever leaves the queue, a slab
  // reaching it becomes invisible to the only screen that can move it on.
  for (const s of ["RECEIVED", "IN_PROCESS", "UNDER_INSPECTION", "GRADED"] as SlabStatus[]) {
    assert.ok(ACTIONABLE_STATUSES.includes(s), `${s} must stay on the board`);
  }
  // And so must a slab that has come back from recalibration — it has to be
  // restartable, or the return journey ends in a dead end.
  assert.ok(ACTIONABLE_STATUSES.includes("RECEIVED_FROM_RECALIBRATION"));
});

test("a slab that has left the floor is off the board", () => {
  for (const s of ["DISPATCHED", "IN_STOCK", "SAMPLE_CUT", "WASTE"] as SlabStatus[]) {
    assert.ok(TERMINAL_STATUSES.includes(s), `${s} should be finished`);
  }
  // Out for recalibration is terminal for the FLOOR: it comes back through the
  // Recalibration screen, which is a different queue with a different guard.
  assert.ok(TERMINAL_STATUSES.includes("OUT_FOR_RECALIBRATION"));
});

test("every status the app can store has a label", () => {
  // A status with no label renders as a raw enum value on the board and in the
  // register — the sort of thing nobody notices until it is in front of a user.
  for (const s of ALL_STATUSES) assert.ok(STATUS_LABEL[s], `no label for ${s}`);
});

test("every grade leads somewhere", () => {
  // A grade with no allowed disposition would strand every slab that got it.
  for (const grade of ["A", "B", "C"] as const) {
    assert.ok(GRADE_DISPOSITIONS[grade].length > 0, `grade ${grade} is a dead end`);
  }
});

test("grade decides what a slab may become", () => {
  // A premium slab is never sample-cut; a rejected one is never dispatched.
  assert.ok(dispositionAllowed("A", "DISPATCH"));
  assert.ok(dispositionAllowed("A", "STOCK"));
  assert.equal(dispositionAllowed("A", "SAMPLE_CUTTING"), false);
  assert.equal(dispositionAllowed("A", "WASTE"), false);

  assert.ok(dispositionAllowed("B", "SAMPLE_CUTTING"));
  assert.equal(dispositionAllowed("B", "DISPATCH"), false, "standard grade is not dispatched");

  assert.ok(dispositionAllowed("C", "RECALIBRATION"));
  assert.ok(dispositionAllowed("C", "WASTE"));
  assert.equal(dispositionAllowed("C", "DISPATCH"), false, "a rejected slab must not ship");
  assert.equal(dispositionAllowed("C", "STOCK"), false);
});

test("only a rejected slab is eligible for recalibration at all", () => {
  // Recalibration removes the upper surface, so it belongs to grade C alone.
  for (const grade of ["A", "B"] as const) {
    assert.ok(!GRADE_DISPOSITIONS[grade].includes("RECALIBRATION"), `grade ${grade}`);
  }
});

test("the five-attempt ceiling holds, and the sixth is refused", () => {
  const first = recalibrationEligibility(0);
  assert.equal(first.allowed, true);
  assert.equal(first.attemptNumber, 1, "the number this send will carry");
  assert.equal(first.remaining, MAX_RECALIBRATION_ATTEMPTS);

  const fifth = recalibrationEligibility(4);
  assert.equal(fifth.allowed, true);
  assert.equal(fifth.attemptNumber, 5);
  assert.equal(fifth.remaining, 1, "this is the last one");

  const sixth = recalibrationEligibility(5);
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.remaining, 0);
  assert.match(sixth.reason ?? "", /waste/i);
  // Past the limit stays refused rather than going negative.
  assert.equal(recalibrationEligibility(9).allowed, false);
  assert.equal(recalibrationEligibility(9).remaining, 0);
});

test("a slab already out cannot be sent again", () => {
  // Excel could not express this: one row per slab, so a second send simply
  // overwrote the first and the earlier attempt was lost.
  const v = recalibrationEligibility(1, { alreadyOut: true });
  assert.equal(v.allowed, false);
  assert.match(v.reason ?? "", /already out/i);
});

test("ageing counts from the send date and stops when the slab returns", () => {
  const sent = new Date("2026-08-01T09:00:00Z");
  const now = new Date("2026-08-17T09:00:00Z");

  const out = recalibrationAgeing({ sentDate: sent }, now);
  assert.equal(out.daysOut, 16);
  assert.equal(out.outstanding, true);

  const back = recalibrationAgeing(
    { sentDate: sent, receivedDate: new Date("2026-08-05T09:00:00Z") }, now);
  assert.equal(back.daysOut, 4, "turnaround, not days since sending");
  assert.equal(back.outstanding, false);
  assert.equal(back.overdue, false, "a returned slab is never overdue");
});

test("a slab out past the standing limit is overdue even with no promised date", () => {
  // A facility that never committed to a date must not be exempt from chasing.
  const sent = new Date("2026-08-01T09:00:00Z");
  const justInside = new Date(sent.getTime() + RECALIBRATION_OVERDUE_DAYS * 86_400_000);
  assert.equal(recalibrationAgeing({ sentDate: sent }, justInside).overdue, false);

  const past = new Date(justInside.getTime() + 86_400_000);
  const v = recalibrationAgeing({ sentDate: sent }, past);
  assert.equal(v.overdue, true);
  assert.equal(v.daysLate, 0, "no promised date to be late against");
});

test("a committed return date wins over the standing limit, both ways", () => {
  const sent = new Date("2026-08-01T09:00:00Z");

  // Promised in 3 days, now 5 days out: overdue well before the 10-day limit.
  const early = recalibrationAgeing({
    sentDate: sent, expectedReturnDate: new Date("2026-08-04T09:00:00Z"),
  }, new Date("2026-08-06T09:00:00Z"));
  assert.equal(early.overdue, true);
  assert.equal(early.daysLate, 2);

  // Promised in 30 days, now 15 out: past the standing limit but not late.
  const generous = recalibrationAgeing({
    sentDate: sent, expectedReturnDate: new Date("2026-08-31T09:00:00Z"),
  }, new Date("2026-08-16T09:00:00Z"));
  assert.equal(generous.overdue, false);
  assert.equal(generous.daysLate, 0);
});

test("a recalibration with no send date has no ageing to report", () => {
  // PENDING_DISPATCH: raised but not yet gone. Counting from nothing would show
  // it as out for as long as the epoch.
  const v = recalibrationAgeing({ sentDate: null }, new Date());
  assert.equal(v.daysOut, null);
  assert.equal(v.outstanding, false);
  assert.equal(v.overdue, false);
});

test("days are whole and floored", () => {
  const a = new Date("2026-08-01T22:00:00Z");
  const b = new Date("2026-08-02T06:00:00Z");
  assert.equal(daysBetween(a, b), 0, "sent last night, looked at this morning");
  assert.equal(daysBetween(a, new Date("2026-08-02T22:00:00Z")), 1);
});

test("thickness removed is measured, not assumed", () => {
  assert.equal(thicknessRemoved(20, 18.5), 1.5);
  // Unmeasured is null, which is not the same as nothing removed.
  assert.equal(thicknessRemoved(null, 18.5), null);
  assert.equal(thicknessRemoved(20, null), null);
  // Three decimals, matching the column.
  assert.equal(thicknessRemoved(20.0001, 18.5), 1.5);
});

test("the processing window is blank until the slab is stamped out", () => {
  const inT = new Date("2026-08-17T08:00:00Z");
  assert.equal(processingMinutes(inT, null), null, "still on the line");
  assert.equal(processingMinutes(null, inT), null);
  assert.equal(processingMinutes(inT, new Date("2026-08-17T14:30:00Z")), 390);
});

test("an out-time before the in-time reports nothing rather than a negative", () => {
  // A mistyped time should leave the duration blank; a negative one propagates
  // into every average on the summary screen.
  const inT = new Date("2026-08-17T14:00:00Z");
  const outT = new Date("2026-08-17T08:00:00Z");
  assert.equal(processingMinutes(inT, outT), null);
});
