import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTime, maskTimeInput, normaliseTime } from "../src/lib/robo/time.ts";

// The robo entry form replaced <input type="time"> with a typed field so a
// tablet operator can key a time in one motion. That only holds if the masking
// reads the digits the way a person means them, and if a half-typed time is
// still recognised as invalid — a slab saved with "9:5" in the Out column
// silently breaks every duration computed from it.

test("isValidTime accepts only complete 24-hour times", () => {
  for (const ok of ["00:00", "07:05", "09:30", "13:45", "23:59", " 09:30 "]) {
    assert.equal(isValidTime(ok), true, `${ok} should be valid`);
  }
  for (const bad of ["", "9:30", "09:5", "24:00", "23:60", "0930", "9.30", "abc", "09:3o"]) {
    assert.equal(isValidTime(bad), false, `${bad} should be invalid`);
  }
});

test("maskTimeInput puts the colon where the operator meant it", () => {
  // A leading 3-9 can only be a single-digit hour: there is no 30 o'clock.
  assert.equal(maskTimeInput("930"), "9:30");
  assert.equal(maskTimeInput("9"), "9");
  // A leading 0-2 might still be a two-digit hour, so the colon waits.
  assert.equal(maskTimeInput("0930"), "09:30");
  assert.equal(maskTimeInput("1"), "1");
  assert.equal(maskTimeInput("12"), "12");
  assert.equal(maskTimeInput("1234"), "12:34");
  // Non-digits are dropped, so typing the colon yourself changes nothing.
  assert.equal(maskTimeInput("09:30"), "09:30");
  assert.equal(maskTimeInput(""), "");
  assert.equal(maskTimeInput("abc"), "");
  // Never longer than HH:MM, however much is pasted in.
  assert.equal(maskTimeInput("0930999"), "09:30");
});

test("normaliseTime pads a short entry on blur", () => {
  assert.equal(normaliseTime("9:5"), "09:05");
  assert.equal(normaliseTime("9:30"), "09:30");
  assert.equal(normaliseTime("930"), "09:30");
  assert.equal(normaliseTime("0930"), "09:30");
  // The last two digits are always the minutes — "930" is half past nine.
  assert.equal(normaliseTime("130"), "01:30");
  assert.equal(normaliseTime("2359"), "23:59");
  assert.equal(normaliseTime(""), "");
  assert.equal(normaliseTime("  09:30  "), "09:30");
});

test("normaliseTime never invents a time out of nonsense", () => {
  // Out of range or unparseable: hand it back untouched so the field stays
  // marked invalid rather than quietly becoming a different, valid time.
  for (const bad of ["25:00", "12:75", "9999", "abc", "1", "12"]) {
    assert.equal(normaliseTime(bad), bad, `${bad} should pass through unchanged`);
  }
});

test("masking then normalising always lands on something isValidTime accepts", () => {
  // The two run in sequence on every field: mask on each keystroke, normalise
  // on blur. Every plausible full entry has to survive that round trip.
  for (const typed of ["930", "0930", "1430", "2359", "0000", "9:5", "07:05"]) {
    const settled = normaliseTime(maskTimeInput(typed));
    assert.equal(isValidTime(settled), true, `${typed} -> ${settled} should be a valid time`);
  }
});
