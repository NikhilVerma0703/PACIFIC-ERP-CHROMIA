import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeCredit, polishCredit, canonPerson, shiftRange, shiftWeight,
  scaleQuality, scaleUptime, scalePolish,
  QUALITY_FLOOR, QUALITY_TARGET, UPTIME_FLOOR, POLISH_FLOOR, MIN_RUNNING_SHIFT,
  oeeOf, oeeTotal, misDiscipline, TARGET_SLABS_PER_SHIFT,
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

test("scaling: each floor zeroes at or below itself and reaches 1 at its target", () => {
  assert.equal(scaleQuality(QUALITY_FLOOR), 0);
  assert.equal(scaleQuality(0.5), 0);
  // Quality tops out at the TARGET, not at a perfect grade share: 97% and 100%
  // both score 100%. The notice on the wall says so in the same words.
  assert.equal(scaleQuality(QUALITY_TARGET), 1);
  assert.equal(scaleQuality(1), 1);
  // Midpoint of the 87-97 band.
  assert.equal(Math.round((scaleQuality(0.92) ?? 0) * 1000) / 1000, 0.5);
  // The July field (93.6% - 98.0%) now spreads 66% - 100% instead of 36% - 80%.
  assert.equal(Math.round((scaleQuality(0.936) ?? 0) * 100) / 100, 0.66);
  assert.equal(scaleQuality(0.98), 1);
  // A shift just under the floor still takes nothing from the quality pool.
  assert.equal(scaleQuality(0.869), 0);
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

test("shiftWeight: a shift is worth the time its line could run", () => {
  // clean shift — a whole shift in the divisor
  assert.equal(shiftWeight(8, 0, 100), 1);
  // 2026-08-03 C, live: down 480 of 480 minutes and pressed nothing. It must
  // count as ZERO shifts, or it halves the man's rate for a night the plant
  // was broken. This is the case the whole adjustment exists for.
  assert.equal(shiftWeight(8, 480, 0), 0);
  // half the shift stopped is half a shift
  assert.equal(shiftWeight(8, 240, 50), 0.5);
  // measured against HOURS LOGGED, not a flat 8 — an hour never entered is
  // not an hour the line was running, exactly as uptime treats it
  assert.equal(shiftWeight(4, 120, 20), 0.5);
  // a shift that DECLARED SLABS cannot be worth zero, whatever the delay
  // column says — otherwise real output divides by nothing and one bad row
  // takes the entire pool
  assert.equal(shiftWeight(8, 480, 30), MIN_RUNNING_SHIFT);
  // over-claimed stoppage clamps rather than going negative
  assert.equal(shiftWeight(8, 999, 0), 0);
  // no hours logged claims nothing
  assert.equal(shiftWeight(0, 0, 0), 0);
});

test("oeeOf: reported only, and null wherever the data cannot support a number", () => {
  // A perfect shift: never stopped, hit the target, every slab Grade A.
  const perfect = oeeOf(8, 0, TARGET_SLABS_PER_SHIFT, 1);
  assert.equal(perfect.availability, 1);
  assert.equal(perfect.performance, 1);
  assert.equal(perfect.oee, 1);

  // Half the shift lost to breakdown. Availability halves, and the 50 slabs it
  // DID make in the running half are full marks on pace — a stoppage must not
  // be charged twice, once as availability and again as performance.
  const half = oeeOf(8, 240, 50, 1);
  assert.equal(half.availability, 0.5);
  assert.equal(half.performance, 1);
  assert.equal(half.oee, 0.5);

  // Quality is the RAW grade share, not the payout's stretched score: an OEE
  // built on QUALITY_FLOOR would not be comparable with any other plant's.
  assert.equal(oeeOf(8, 0, 100, 0.95).quality, 0.95);
  assert.equal(Math.round((oeeOf(8, 0, 100, 0.95).oee ?? 0) * 100) / 100, 0.95);

  // Ungraded output: quality is unknown, so OEE is unknown — not a smaller
  // number. Availability and performance still stand on their own.
  const ungraded = oeeOf(8, 0, 100, null);
  assert.equal(ungraded.oee, null);
  assert.equal(ungraded.availability, 1);

  // Nothing logged measures nothing.
  assert.equal(oeeOf(0, 0, 0, 1).availability, null);
  assert.equal(oeeOf(0, 0, 0, 1).oee, null);

  // More than eight rows filed for one shift (a corrected hour re-entered) must
  // not inflate the expected output and understate the shift.
  assert.equal(oeeOf(10, 0, TARGET_SLABS_PER_SHIFT, 1).performance, 1);
});

test("oeeTotal: pools the inputs instead of averaging each shift's OEE", () => {
  const full = { hoursLogged: 8, breakdownMin: 0, poweroutMin: 0, points: 100 };
  const dead = { hoursLogged: 8, breakdownMin: 480, poweroutMin: 0, points: 0 };
  // One clean shift and one the plant spent broken. Availability is 50% across
  // the two, and the clean shift's pace is untouched by the dead one.
  const t = oeeTotal([full, dead], 1);
  assert.equal(t.availability, 0.5);
  assert.equal(t.performance, 1);
  assert.equal(t.oee, 0.5);
  // Averaging each shift's OEE would give (1 + 0)/2 = 0.5 here too, so use a
  // case that separates them: a two-hour shift must not weigh as much as a
  // full one. Pooled, this is 20 good slabs against 10 hours of running time.
  const stub = { hoursLogged: 2, breakdownMin: 0, poweroutMin: 0, points: 20 };
  const mixed = oeeTotal([full, stub], 1);
  assert.equal(mixed.availability, 1);
  assert.equal(Math.round((mixed.performance ?? 0) * 100) / 100, 0.96); // 120 / 125
  assert.equal(oeeTotal([], 1).oee, null);
});

test("misDiscipline: an unfiled, disputed or impossible hour shows before payday", () => {
  // eight hours filed, nothing disputed, nothing impossible
  assert.equal(misDiscipline(8, 0, 0, 200), 1);
  // half the hours never entered
  assert.equal(misDiscipline(4, 0, 0, 100), 0.5);
  // one of eight hours declared a range too wide to be real
  assert.equal(misDiscipline(8, 1, 0, 100), 0.875);
  // a quarter of the shift's slabs are claimed by another shift too
  assert.equal(misDiscipline(8, 0, 25, 100), 0.75);
  // a shift that claimed no slabs cannot have disputed any — that term is 1,
  // not 0, or an idle shift would read as a discipline failure
  assert.equal(misDiscipline(8, 0, 0, 0), 1);
  // nothing filed at all is unknown, not zero
  assert.equal(misDiscipline(0, 0, 0, 0), null);
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
