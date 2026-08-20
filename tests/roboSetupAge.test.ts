import test from "node:test";
import assert from "node:assert/strict";

import {
  SETUP_EDIT_WINDOW_DAYS,
  daysBetween,
  describeAge,
  isIsoDate,
  isSetupStale,
  plantDate,
  setupDate,
} from "../src/lib/robo/setupAge.ts";

/* The age warning on Edit setup. It never blocks the edit — see setupAge.ts —
   so what is tested here is that the sentence is right, not that a door is
   shut. */

test("what counts as a date this can age from", () => {
  assert.equal(isIsoDate("2026-08-20"), true);
  assert.equal(isIsoDate("2026-2-3"), false, "not zero-padded");
  assert.equal(isIsoDate("20-08-2026"), false, "the register's other convention");
  assert.equal(isIsoDate("2026-02-31"), false, "Date.parse would roll this to March 3");
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate(""), false);
  assert.equal(isIsoDate(null), false);
  assert.equal(isIsoDate(undefined), false);
});

test("the production date the operator typed wins over the shift's own", () => {
  // The whole point of the field: a run entered late belongs to the day it was
  // produced, not the day it was typed.
  assert.equal(setupDate("2026-07-04", "2026-07-05"), "2026-07-04");
});

test("a setup saved before the production date existed falls back to its shift", () => {
  assert.equal(setupDate(null, "2026-07-05"), "2026-07-05");
  assert.equal(setupDate("", "2026-07-05"), "2026-07-05");
  assert.equal(setupDate("not a date", "2026-07-05"), "2026-07-05");
});

test("a setup with no readable date anywhere has no date", () => {
  assert.equal(setupDate(null, null), null);
  assert.equal(setupDate("", ""), null);
});

test("days are counted whole, from midnight to midnight", () => {
  assert.equal(daysBetween("2026-08-20", "2026-08-20"), 0);
  assert.equal(daysBetween("2026-08-19", "2026-08-20"), 1);
  assert.equal(daysBetween("2026-07-20", "2026-08-20"), 31);
  assert.equal(daysBetween("2026-05-20", "2026-08-20"), 92);
});

test("a clock change inside the range does not shift the count", () => {
  // Both sides are anchored at UTC midnight. Read locally these spans contain
  // a DST transition in most of the northern hemisphere; the answer must not
  // come out as 30.96 days and round down.
  assert.equal(daysBetween("2026-02-28", "2026-03-31"), 31);
  assert.equal(daysBetween("2026-10-01", "2026-11-01"), 31);
});

test("an unreadable date on either side is no answer, not zero", () => {
  assert.equal(daysBetween(null, "2026-08-20"), null);
  assert.equal(daysBetween("2026-08-20", null), null);
  assert.equal(daysBetween("yesterday", "2026-08-20"), null);
});

test("the age is taken from whichever date the setup actually carries", () => {
  // How the Edit setup screen works it out: setupDate picks the date, then
  // daysBetween counts to today.
  assert.equal(daysBetween(setupDate("2026-07-04", "2026-07-05"), "2026-08-20"), 47);
  assert.equal(daysBetween(setupDate(null, "2026-07-05"), "2026-08-20"), 46);
  assert.equal(daysBetween(setupDate(null, null), "2026-08-20"), null);
});

test("a setup dated in the future is negative, not clamped to nothing", () => {
  // A run dated next week is a typo worth seeing on the screen.
  assert.equal(daysBetween(setupDate("2026-08-27", null), "2026-08-20"), -7);
  assert.equal(isSetupStale(-7), false);
});

test("one month is the line, and the boundary day itself is inside it", () => {
  assert.equal(SETUP_EDIT_WINDOW_DAYS, 31);
  assert.equal(isSetupStale(0), false);
  assert.equal(isSetupStale(30), false);
  assert.equal(isSetupStale(31), false, "31 days is still the reporting period");
  assert.equal(isSetupStale(32), true);
  assert.equal(isSetupStale(400), true);
});

test("an unknown age is not stale", () => {
  // Warning on a setup that simply carries no date would train people to click
  // past the warning that means something.
  assert.equal(isSetupStale(null), false);
});

test("today means today at the plant, not on the server", () => {
  // 20:00 UTC is 01:30 the next morning in Coimbatore. A server asked for its
  // own date here would answer the 19th while the night shift is writing the
  // 20th on the tablet.
  assert.equal(plantDate(new Date("2026-08-19T20:00:00Z")), "2026-08-20");
  assert.equal(plantDate(new Date("2026-08-19T18:29:00Z")), "2026-08-19");
  assert.equal(plantDate(new Date("2026-08-19T18:31:00Z")), "2026-08-20");
  // and it is a shape isIsoDate accepts, since that is what consumes it
  assert.equal(isIsoDate(plantDate(new Date("2026-01-05T00:00:00Z"))), true);
  assert.equal(plantDate(new Date("2026-01-05T00:00:00Z")), "2026-01-05");
});

test("the age reads as a person would say it", () => {
  assert.equal(describeAge(0), "today");
  assert.equal(describeAge(1), "yesterday");
  assert.equal(describeAge(47), "47 days ago");
  assert.equal(describeAge(null), "an unrecorded date");
  assert.equal(describeAge(-1), "a date 1 day in the future");
  assert.equal(describeAge(-7), "a date 7 days in the future");
});
