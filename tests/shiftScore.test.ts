import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeCredit, polishCredit, canonPerson, shiftRange,
  scaleQuality, scaleUptime, scalePolish,
  QUALITY_FLOOR, UPTIME_FLOOR, POLISH_FLOOR,
} from "../src/lib/shiftScoreMath.ts";

// These decide money. Every one of them is a bug that was live.

test("gradeCredit: CTS and Printing are excluded, not scored as rejects", () => {
  assert.equal(gradeCredit("A"), 1);
  assert.equal(gradeCredit("A2"), 1);
  assert.equal(gradeCredit("B"), 0.5);
  assert.equal(gradeCredit("C (Reject)"), 0);
  assert.equal(gradeCredit("Not graded yet"), null);
  // "CTS".startsWith("C") is true, so these fell into the reject branch and
  // each one cost a shift real points.
  assert.equal(gradeCredit("CTS"), null);
  assert.equal(gradeCredit("cts"), null);
  assert.equal(gradeCredit("Printing"), null);
  assert.equal(gradeCredit(null), null);
});

test("polishCredit: rescued work counts, open work waits, scrap is a loss", () => {
  // first pass, nothing needed
  assert.equal(polishCredit("Direct Ok", "Direct Ok"), 1);
  assert.equal(polishCredit("Direct Ok", "Polish Ok"), 1);
  // the two the polishing line is actually paid for
  assert.equal(polishCredit("RW Done Ok", "Polish Ok"), 1);
  assert.equal(polishCredit("Direct Ok", "Repolish Done"), 1);
  // lost at rework
  assert.equal(polishCredit("Can't be Reworked", "Polish Ok"), 0);
  // still open — never counted against anyone, exactly like an ungraded slab
  assert.equal(polishCredit("RW Required and ongoing", null), null);
  assert.equal(polishCredit("Direct Ok", "Repolish Required"), null);
  assert.equal(polishCredit(null, null), null);
  // the live data holds lower-case variants of both columns
  assert.equal(polishCredit("Direct Ok", "Direct ok"), 1);
});

test("scaling: each floor zeroes at or below itself and reaches 1 at 100%", () => {
  assert.equal(scaleQuality(QUALITY_FLOOR), 0);
  assert.equal(scaleQuality(0.5), 0);
  assert.equal(scaleQuality(1), 1);
  assert.equal(Math.round((scaleQuality(0.964) ?? 0) * 1000) / 1000, 0.64);
  assert.equal(scaleUptime(UPTIME_FLOOR), 0);
  assert.equal(scaleUptime(1), 1);
  assert.equal(scalePolish(POLISH_FLOOR), 0);
  assert.equal(scalePolish(1), 1);
  assert.equal(scaleQuality(null), null);
});

test("canonPerson folds case and the known one-person-two-spellings pairs", () => {
  assert.equal(canonPerson("SURESH"), "Suresh");
  assert.equal(canonPerson("  suresh  "), "Suresh");
  assert.equal(canonPerson("sundhar"), "Sundar");
  // Airtable spelling vs ERP spelling, same human
  assert.equal(canonPerson("Prasanna Venkatesan"), canonPerson("prasanna"));
  assert.equal(canonPerson("Duraipandian Ashokan"), canonPerson("duraipandain"));
  assert.equal(canonPerson("Balmukund Saw"), canonPerson("balmukund"));
  assert.equal(canonPerson("Elayaraja Mani"), canonPerson("illayaraja"));
  assert.equal(canonPerson("Mathan"), canonPerson("Madhan Kumar"));
  assert.equal(canonPerson(""), "");
  assert.equal(canonPerson(null), "");
});

test("shiftRange: 8 hours in IST, and C anchors on the day it started", () => {
  const a = shiftRange("2026-07-15", "A");
  assert.equal(a.start.toISOString(), "2026-07-15T00:30:00.000Z"); // 06:00 IST
  assert.equal(a.end.toISOString(), "2026-07-15T08:30:00.000Z");   // 14:00 IST
  const c = shiftRange("2026-07-15", "C");
  assert.equal(c.start.toISOString(), "2026-07-15T16:30:00.000Z"); // 22:00 IST
  assert.equal(c.end.toISOString(), "2026-07-16T00:30:00.000Z");   // 06:00 IST next day
  // month boundary: C on the 31st must run into the 1st
  const c2 = shiftRange("2026-07-31", "C");
  assert.equal(c2.end.toISOString(), "2026-08-01T00:30:00.000Z");
  for (const l of ["A", "B", "C"] as const) {
    const r = shiftRange("2026-07-15", l);
    assert.equal(r.end.getTime() - r.start.getTime(), 8 * 3600_000);
  }
});
