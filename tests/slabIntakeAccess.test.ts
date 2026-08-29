import { test } from "node:test";
import assert from "node:assert/strict";
import { slabIntakeEmails, canUseSlabIntake } from "../src/lib/inventory/intakeAccess.ts";
import {
  parseSlabNumber, validateSlabDetails, cleanIssues, savedSentence,
  GRADE_OPTIONS, SLAB_STATUSES, statusesFromTransitions,
  type SlabDetailsInput,
} from "../src/lib/inventory/intakeRules.ts";

// intakeAccess.ts is imported by src/middleware.ts (the carve-out through the
// branch caps) AND by the page gate, so these exercise the one rule both run.
// The owner named three PEOPLE: the fabrication manager, the Chromia manager
// and the polishing line manager — all Line Managers, which is exactly why
// the gate must never read the rank.

const LIST = "gibin@thepacific.group, chromia@thepacific.group, polishingline1@pacific-surfaces.com";

// ---------------------------------------------------------------------------
// slabIntakeEmails — same parse discipline as WEIGHTS_VERIFIER_EMAILS
// ---------------------------------------------------------------------------

test("slabIntakeEmails: comma-separated, trimmed, lower-cased", () => {
  assert.deepEqual(slabIntakeEmails(LIST), [
    "gibin@thepacific.group", "chromia@thepacific.group", "polishingline1@pacific-surfaces.com",
  ]);
  assert.deepEqual(slabIntakeEmails("  A@B.com ,, c@D.com  "), ["a@b.com", "c@d.com"]);
});

test("slabIntakeEmails: UNSET MEANS NOBODY, never everybody", () => {
  assert.deepEqual(slabIntakeEmails(undefined), []);
  assert.deepEqual(slabIntakeEmails(null), []);
  assert.deepEqual(slabIntakeEmails(""), []);
  assert.deepEqual(slabIntakeEmails("   "), []);
  assert.deepEqual(slabIntakeEmails(",,,"), []);
});

// ---------------------------------------------------------------------------
// canUseSlabIntake — the three named people, plus admins, nobody else
// ---------------------------------------------------------------------------

test("THE THREE NAMED PEOPLE PASS, whatever the case or spacing of the env var", () => {
  assert.ok(canUseSlabIntake("LINE_MANAGER", "gibin@thepacific.group", LIST));
  assert.ok(canUseSlabIntake("LINE_MANAGER", "chromia@thepacific.group", LIST));
  assert.ok(canUseSlabIntake("LINE_MANAGER", "polishingline1@pacific-surfaces.com", LIST));
  assert.ok(canUseSlabIntake("LINE_MANAGER", "GIBIN@ThePacific.Group", LIST), "session email case must not matter");
  assert.ok(canUseSlabIntake("LINE_MANAGER", " gibin@thepacific.group ", LIST), "stray whitespace must not matter");
});

test("ADMINS PASS TOO — the owner sees the screen — even off the list, even with no list", () => {
  assert.ok(canUseSlabIntake("ADMIN", "owner@thepacific.group", LIST));
  assert.ok(canUseSlabIntake("ADMIN", "owner@thepacific.group", undefined));
  assert.ok(canUseSlabIntake("ADMIN", null, undefined));
});

test("NOBODY ELSE, WHATEVER THEIR RANK", () => {
  // a Line Manager not on the list — the rank the three happen to share buys nothing
  assert.ok(!canUseSlabIntake("LINE_MANAGER", "someoneelse@thepacific.group", LIST));
  // office roles, incharges, the lot
  for (const role of ["FINANCE", "ACCOUNTS", "INCHARGE", "OPERATOR", "STORE", "COMMERCIAL", "SALES", "CHROMIA", "SAMPLING", ""]) {
    assert.ok(!canUseSlabIntake(role, "someoneelse@thepacific.group", LIST), `${role || "(none)"} must be refused`);
  }
  // an unset variable admits nobody but admins
  assert.ok(!canUseSlabIntake("LINE_MANAGER", "gibin@thepacific.group", undefined));
  // a missing email can never match
  assert.ok(!canUseSlabIntake("LINE_MANAGER", "", LIST));
  assert.ok(!canUseSlabIntake("LINE_MANAGER", null, LIST));
});

// ---------------------------------------------------------------------------
// parseSlabNumber — every refusal is a sentence that names its reason
// ---------------------------------------------------------------------------

test("parseSlabNumber accepts a plain whole number, with commas or spacing", () => {
  assert.deepEqual(parseSlabNumber("144320"), { ok: true, slab: 144320 });
  assert.deepEqual(parseSlabNumber(" 144,320 "), { ok: true, slab: 144320 });
});

test("parseSlabNumber REFUSES a decimal with the pending-decimal-slab-decision language", () => {
  const r = parseSlabNumber("144338.1");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /pending the decimal-slab decision/);
});

test("parseSlabNumber refuses the rest by name", () => {
  for (const [input, why] of [["", /Enter a slab number/], ["abc", /not a number/], ["-5", /positive/], ["999999999999", /too large/]] as const) {
    const r = parseSlabNumber(input);
    assert.equal(r.ok, false, `"${input}" must be refused`);
    if (!r.ok) assert.match(r.message, why);
  }
});

// ---------------------------------------------------------------------------
// validateSlabDetails + the vocabulary
// ---------------------------------------------------------------------------

const details = (over: Partial<SlabDetailsInput> = {}): SlabDetailsInput => ({
  design: "Sakura", grade: "A", slabThickness: "2 cm", qualityIssue: [],
  polishType: "Polish", rwStatus: null, repolishStatus: null, batchNumber: "1350",
  lengthIn: 137, widthIn: 79, bayNumber: "B1", frameNumber: null,
  status: "AVAILABLE", notes: null, ...over,
});

test("the grade vocabulary is the canonical one, Printing included", () => {
  assert.deepEqual([...GRADE_OPTIONS], ["A", "A2", "B", "C", "CTS", "SAMPLE", "Printing"]);
  for (const g of GRADE_OPTIONS) assert.equal(validateSlabDetails(details({ grade: g })), null);
  assert.equal(validateSlabDetails(details({ grade: null })), null, "not graded is a fine answer");
  assert.match(validateSlabDetails(details({ grade: "A1" })) ?? "", /not a grade/);
});

test("SLAB_STATUSES cannot drift from the lifecycle in grading.ts", () => {
  // the hand copy exists so this module stays import-free for node --test;
  // this assertion is the leash that keeps it honest.
  assert.deepEqual([...SLAB_STATUSES].sort(), statusesFromTransitions());
  assert.match(validateSlabDetails(details({ status: "SOLD" })) ?? "", /not a slab status/);
});

test("dimensions are inches, positive, slab-sized", () => {
  assert.equal(validateSlabDetails(details()), null);
  assert.equal(validateSlabDetails(details({ lengthIn: null, widthIn: null })), null);
  assert.match(validateSlabDetails(details({ lengthIn: 0 })) ?? "", /positive number of inches/);
  assert.match(validateSlabDetails(details({ widthIn: -3 })) ?? "", /positive number of inches/);
  assert.match(validateSlabDetails(details({ lengthIn: NaN })) ?? "", /positive number of inches/);
  assert.match(validateSlabDetails(details({ widthIn: 4000 })) ?? "", /inches/);
});

// ---------------------------------------------------------------------------
// cleanIssues + savedSentence
// ---------------------------------------------------------------------------

test("cleanIssues trims, drops empties, dedupes case-insensitively", () => {
  assert.deepEqual(cleanIssues([" Pinhole ", "", "pinhole", "Crack"]), ["Pinhole", "Crack"]);
  assert.deepEqual(cleanIssues(undefined), []);
  assert.deepEqual(cleanIssues("Pinhole"), [], "a bare string is not a list");
});

test("every save result is a sentence", () => {
  assert.equal(savedSentence(144320, true, []), "Slab 144320 added to finished goods.");
  assert.equal(savedSentence(144320, false, []), "Nothing changed on slab 144320 — nothing was saved.");
  assert.equal(savedSentence(144320, false, ["grade", "bayNumber"]), "Slab 144320: corrected grade, bay.");
});
