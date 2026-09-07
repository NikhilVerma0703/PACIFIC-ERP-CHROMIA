import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeCredit, polishCredit, canonPerson, shiftRange, shiftWeight,
  scaleQuality, scaleUptime, scalePolish,
  QUALITY_FLOOR, QUALITY_TARGET, UPTIME_FLOOR, POLISH_FLOOR, MIN_RUNNING_SHIFT,
  oeeOf, oeeTotal, misDiscipline, TARGET_SLABS_PER_SHIFT,
  stdMultiplier, SLOW_STD_MAX, SLOW_STD_MULTIPLIER,
  slabsDeclared, rangeImpossible, MAX_SLABS_PER_HOUR,
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

  // THE MAINTENANCE IN-CHARGES, confirmed by the owner 2026-09-02: one person,
  // several spellings, and the leading name is the one that shows. The
  // mechanical board was ranking "Joseph" (380 rows) and "Manikya" (40) as two
  // men, and "Narayanan" (132) beside "Arun" (172) with 124 more rows naming
  // both for the same shift.
  for (const v of ["Joseph", "joseph", "JOSEPH", "Josep", "Jose", "Manikya", " manikya "]) {
    assert.equal(canonPerson(v), "Manikya", `${v} is Manikya`);
  }
  for (const v of ["Arun", "arun", "Narayanan", "narayana", "NARAYANAN"]) {
    assert.equal(canonPerson(v), "Narayanan", `${v} is Narayanan`);
  }
  for (const v of ["Kumar", "kumar", "Ram", "Ramarasan", "ramarasan"]) {
    assert.equal(canonPerson(v), "Kumar", `${v} is Kumar`);
  }
  // APPALARAJU IS MA RAJU, renamed by the owner 2026-09-06. scripts/0078
  // rewrote his 852 rows, but a backfill is a moment and the old spelling keeps
  // arriving: the production-incharge field is typeable, and submitted_by is
  // stamped from a session token that caches users.name for up to 8 hours. One
  // such row was filed within the hour after that script ran. The alias is what
  // makes the rename hold, so the board cannot rank him twice.
  for (const v of ["Appalaraju", "appalaraju", "APPALARAJU", " Appalaraju ", "MA Raju", "ma raju", "MA RAJU"]) {
    assert.equal(canonPerson(v), "MA Raju", `${v} is MA Raju`);
  }
  // ...and his capitals survive the title-case fallback, as SivaPrakash's do.
  // Neither entry merges anybody: both map a spelling of one man onto itself.
  assert.equal(canonPerson("SivaPrakash"), "SivaPrakash");
  assert.equal(canonPerson("sivaprakash"), "SivaPrakash");
  // The mechanic's fold is UNCHANGED by either rename — "Joseph" still scores
  // as "Manikya", which is why a SivaPrakash who turns out to be that same man
  // needs a decision here rather than a new roster entry.
  assert.equal(canonPerson("Joseph"), "Manikya");
  assert.notEqual(canonPerson("SivaPrakash"), canonPerson("Manikya"));

  // And the long production names that CONTAIN "Kumar" are untouched by it:
  // they are keyed whole and never reach the stand-alone entry.
  assert.equal(canonPerson("Satish Kumar"), "Satish");
  assert.equal(canonPerson("Madhan Kumar"), "Madhan");
  assert.equal(canonPerson("Sukantha Kumar"), "Sukanta");
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

/* ------------------------------------------- slow products count double */

// A shift on a 15-an-hour design and a shift on a 7-an-hour one were paid the
// same per slab, so the hard design paid barely half as much for the same hour
// of work — and nobody wanted to run it. A product whose STANDARD is 10 an hour
// or less now counts each good slab twice.
//
// The threshold is on the STANDARD, never on what the shift achieved: it is a
// property of the product the plant chose to run, so a shift cannot earn the
// multiplier by working slowly.

test("a standard of 10 an hour or less doubles the slab; 11 and above does not", () => {
  for (const std of [3, 5, 7, 8, 9, 10]) {
    assert.equal(stdMultiplier(std), 2, `std ${std} should double`);
  }
  for (const std of [11, 12, 13, 14, 15, 16, 60]) {
    assert.equal(stdMultiplier(std), 1, `std ${std} should not double`);
  }
});

test("THE BOUNDARY IS 10 INCLUSIVE — the rule as it was written", () => {
  assert.equal(stdMultiplier(10), 2);
  assert.equal(stdMultiplier(10.0001), 1);
  assert.equal(stdMultiplier(11), 1);
});

test("a missing standard is not a slow one", () => {
  // 100 of August's 736 MIS rows carry no standard at all. Absent is unknown,
  // and unknown must never pay double.
  for (const v of [null, undefined, "", NaN, 0, -5]) {
    assert.equal(stdMultiplier(v as number | null), 1, `${String(v)} must not double`);
  }
});

test("a standard arriving as a string still reads as a number", () => {
  // MIS columns have arrived as text before; a numeric string must not silently
  // fall through to 1 and quietly halve a shift's pay.
  assert.equal(stdMultiplier("8" as unknown as number), 2);
  assert.equal(stdMultiplier("15" as unknown as number), 1);
});

test("the multiplier multiplies the GRADE credit, so a B on a slow line is one slab", () => {
  // The two rules compose: B is half a slab, a slow product doubles it, so a B
  // grade on a 7-an-hour design is worth exactly one ordinary A.
  assert.equal(gradeCredit("B") * stdMultiplier(7), 1);
  assert.equal(gradeCredit("A") * stdMultiplier(7), 2);
  // And a reject is worth nothing however slow the product was — doubling zero
  // is still zero, which is what keeps hiding a bad slab pointless.
  assert.equal(gradeCredit("C (Reject)") * stdMultiplier(7), 0);
});

test("the two constants are the rule as stated, so a doc can quote them", () => {
  assert.equal(SLOW_STD_MAX, 10);
  assert.equal(SLOW_STD_MULTIPLIER, 2);
});

/* ------------------------------------------------- the one slab-range rule */

// Three surfaces counted "slabs made" three ways and printed 329, 329 and 97
// for 30 August. This is now the one rule all three call.

test("slabsDeclared: both ends inclusive, null for no claim, null for an impossible range", () => {
  assert.equal(slabsDeclared(154962, 154973), 12);
  assert.equal(slabsDeclared(10, 10), 1);
  assert.equal(slabsDeclared(null, 5), null);
  assert.equal(slabsDeclared(5, null), null);
  assert.equal(slabsDeclared(undefined, undefined), null);
  assert.equal(slabsDeclared(150335, 15035), null, "a dropped digit is backwards, not a claim");
  assert.equal(slabsDeclared(15078, 150590), null, "the 135,513-slab hour of 26 July");
});

test("slabsDeclared: THE BOUNDARY IS THE ENTRY FORM'S — an hour of exactly 60 is accepted", () => {
  // The form and the scoreboard refuse on b - a >= MAX_SLABS_PER_HOUR, so an
  // hour of MAX slabs (b - a = MAX - 1) is allowed, and MAX + 1 is not.
  assert.equal(slabsDeclared(100, 100 + MAX_SLABS_PER_HOUR - 1), MAX_SLABS_PER_HOUR);
  assert.equal(slabsDeclared(100, 100 + MAX_SLABS_PER_HOUR), null);
});

test("slabsDeclared: numbers that arrive as strings or floats still count", () => {
  assert.equal(slabsDeclared("100", "111"), 12);
  assert.equal(slabsDeclared(100.0, 111.0), 12);
  assert.equal(slabsDeclared("abc", 5), null);
});

test("rangeImpossible: names BOTH shapes, and never a blank hour", () => {
  assert.equal(rangeImpossible(150335, 15035), true, "backwards");
  assert.equal(rangeImpossible(15078, 150590), true, "too wide");
  assert.equal(rangeImpossible(100, 100 + MAX_SLABS_PER_HOUR), true, "exactly at the refusal threshold");
  assert.equal(rangeImpossible(100, 100 + MAX_SLABS_PER_HOUR - 1), false, "an hour of 60 is fine");
  assert.equal(rangeImpossible(null, 5), false, "no claim is not an impossible claim");
  assert.equal(rangeImpossible(null, null), false);
});
