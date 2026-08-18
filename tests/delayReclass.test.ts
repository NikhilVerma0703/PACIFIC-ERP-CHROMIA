// Rules for reclassifying a logged delay — moving minutes between the four MIS
// delay buckets. These are not style tests: the breakdown and power-out buckets
// feed the uptime in src/lib/shiftScore.ts, which ranks the electrical and
// mechanical incharges for their share of the monthly incentive pool. Every
// assertion below is guarding either a payout or the 60-minutes-in-an-hour
// invariant that src/app/tables/actions.ts enforces on the same four columns.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planReclass,
  prepareReclass,
  validateReclassReason,
  describeReclass,
  describeReclassRecord,
  originalBuckets,
  reconstructionSound,
  isDelayKey,
  DELAY_KEYS,
  DELAY_COL,
  RECLASS_REASON_MIN,
  type DelayBuckets,
  type ReclassRecord,
} from "../src/lib/delayReclass.ts";

/** A typical wrongly-classified hour: 20 minutes of a cleaning changeover filed
 *  as a maintenance breakdown, which is the exact complaint that prompted this. */
const HOUR = { process: 0, cleaning: 0, breakdown: 20, powerout: 5 };

const total = (b: DelayBuckets) => DELAY_KEYS.reduce((a, k) => a + b[k], 0);

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

test("the delay vocabulary is the four MIS buckets, taken from downtimeShared", () => {
  assert.deepEqual([...DELAY_KEYS], ["process", "cleaning", "breakdown", "powerout"]);
  assert.ok(isDelayKey("breakdown"));
  assert.equal(isDelayKey("Breakdown"), false);
  assert.equal(isDelayKey("maintenance"), false);
  assert.equal(isDelayKey(null), false);
  // The next agent writes these column names onto the Mis row; a typo here is a
  // silent no-op update, so pin them.
  assert.equal(DELAY_COL.breakdown, "breakdownDelayDurationMechanicalOrElectricalMinutes");
  assert.equal(DELAY_COL.cleaning, "cleaningDelayDurationMinutes");
  assert.equal(DELAY_COL.process, "processDelayDurationMinutes");
  assert.equal(DELAY_COL.powerout, "poweroutDelayDurationMinutes");
});

// ---------------------------------------------------------------------------
// a valid move
// ---------------------------------------------------------------------------

test("a valid move shifts the minutes and leaves the other buckets alone", () => {
  const p = planReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes: 20 });
  assert.ok(p.ok, p.ok ? "" : p.message);
  assert.deepEqual(p.next, { process: 0, cleaning: 20, breakdown: 0, powerout: 5 });
  assert.deepEqual(p.before, HOUR);
  assert.equal(p.minutes, 20);
  assert.equal(p.from, "breakdown");
  assert.equal(p.to, "cleaning");
});

test("a partial move leaves the remainder where it was", () => {
  const p = planReclass({ current: HOUR, from: "breakdown", to: "process", minutes: 12 });
  assert.ok(p.ok);
  assert.deepEqual(p.next, { process: 12, cleaning: 0, breakdown: 8, powerout: 5 });
});

test("the hour's TOTAL is unchanged by a valid move — the 60-min cap cannot be dodged", () => {
  // A full hour, right at the cap that tables/actions.ts enforces. Whatever moves
  // where, the row must still satisfy it afterwards.
  const full: DelayBuckets = { process: 10, cleaning: 15, breakdown: 30, powerout: 5 };
  for (const from of DELAY_KEYS) {
    for (const to of DELAY_KEYS) {
      if (from === to) continue;
      const p = planReclass({ current: full, from, to, minutes: Math.min(3, full[from]) || 1 });
      if (!p.ok) continue; // buckets holding nothing are covered separately below
      assert.equal(total(p.next), 60, `${from}->${to} changed the hour's total`);
      assert.equal(p.total, 60);
    }
  }
});

test("an hour already over 60 minutes stays correctable", () => {
  // Three such rows exist in the live table. A validator that refused to touch
  // them would lock the only people who can fix them out of doing so, and the
  // move does not make the row any worse — the total is identical after it.
  const bad: DelayBuckets = { process: 0, cleaning: 0, breakdown: 75, powerout: 0 };
  const p = planReclass({ current: bad, from: "breakdown", to: "cleaning", minutes: 75 });
  assert.ok(p.ok, p.ok ? "" : p.message);
  assert.equal(total(p.next), 75);
  assert.deepEqual(p.next, { process: 0, cleaning: 75, breakdown: 0, powerout: 0 });
});

test("absent and null buckets read as zero, because that is what the Mis columns store", () => {
  const p = planReclass({
    current: { breakdown: 30, cleaning: null, process: undefined },
    from: "breakdown",
    to: "cleaning",
    minutes: 30,
  });
  assert.ok(p.ok, p.ok ? "" : p.message);
  assert.deepEqual(p.next, { process: 0, cleaning: 30, breakdown: 0, powerout: 0 });
});

// ---------------------------------------------------------------------------
// refusals
// ---------------------------------------------------------------------------

test("moving more than the bucket holds is refused, and says how much is there", () => {
  const p = planReclass({ current: { breakdown: 10 }, from: "breakdown", to: "cleaning", minutes: 30 });
  assert.equal(p.ok, false);
  assert.match((p as { message: string }).message, /only logs 10m/);
});

test("moving out of an empty bucket is refused with its own wording", () => {
  const p = planReclass({ current: HOUR, from: "process", to: "breakdown", minutes: 5 });
  assert.equal(p.ok, false);
  assert.match((p as { message: string }).message, /nothing to move/i);
});

test("no bucket can be driven negative — a negative would score as bonus uptime", () => {
  for (const minutes of [21, 100, 6000]) {
    const p = planReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes });
    assert.equal(p.ok, false, `${minutes} min out of a 20 min bucket was allowed`);
  }
});

test("from === to is refused — it would mark the hour corrected with nothing behind it", () => {
  const p = planReclass({ current: HOUR, from: "breakdown", to: "breakdown", minutes: 5 });
  assert.equal(p.ok, false);
  assert.match((p as { message: string }).message, /same/i);
});

test("zero and negative minutes are refused", () => {
  for (const minutes of [0, -1, -20]) {
    const p = planReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes });
    assert.equal(p.ok, false, `${minutes} was accepted`);
    assert.match((p as { message: string }).message, /more than zero/i);
  }
});

test("non-integer and non-numeric minutes are refused", () => {
  for (const minutes of [2.5, 19.999, NaN, Infinity]) {
    const p = planReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes });
    assert.equal(p.ok, false, `${minutes} was accepted`);
  }
  const frac = planReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes: 2.5 });
  assert.match((frac as { message: string }).message, /whole number/i);
  // A string that looks like a number is still not a number: accepting it would
  // let "20" + 5 concatenate somewhere downstream.
  const str = planReclass({
    current: HOUR, from: "breakdown", to: "cleaning",
    minutes: "10" as unknown as number,
  });
  assert.equal(str.ok, false);
});

test("unknown delay types are refused rather than silently creating a fifth bucket", () => {
  assert.equal(planReclass({ current: HOUR, from: "maintenance", to: "cleaning", minutes: 5 }).ok, false);
  assert.equal(planReclass({ current: HOUR, from: "breakdown", to: "Cleaning", minutes: 5 }).ok, false);
  assert.equal(planReclass({ current: HOUR, from: "breakdown", to: "", minutes: 5 }).ok, false);
});

test("a fractional or nonsense figure already on the hour blocks the move instead of being rounded", () => {
  // Rounding would change the hour's total, which is the one thing this module
  // guarantees it never does. Refuse and tell them to fix the MIS entry.
  const frac = planReclass({ current: { breakdown: 12.5 }, from: "breakdown", to: "cleaning", minutes: 12 });
  assert.equal(frac.ok, false);
  assert.match((frac as { message: string }).message, /whole number/i);

  const neg = planReclass({ current: { breakdown: 30, cleaning: -5 }, from: "breakdown", to: "cleaning", minutes: 10 });
  assert.equal(neg.ok, false);
  assert.match((neg as { message: string }).message, /negative/i);

  const nan = planReclass({ current: { breakdown: NaN }, from: "breakdown", to: "cleaning", minutes: 10 });
  assert.equal(nan.ok, false);
});

// ---------------------------------------------------------------------------
// the reason rule
// ---------------------------------------------------------------------------

test("a reason is required and must be more than a keystroke", () => {
  assert.equal(RECLASS_REASON_MIN, 4);
  for (const bad of ["", "   ", "ok", "x", "abc", null, undefined, 42]) {
    const r = validateReclassReason(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} was accepted as a reason`);
  }
  const ok = validateReclassReason("  filter change, not a breakdown  ");
  assert.ok(ok.ok);
  assert.equal(ok.reason, "filter change, not a breakdown"); // stored trimmed
  // Exactly at the bar.
  assert.equal(validateReclassReason("wash").ok, true);
});

test("prepareReclass enforces the reason and the arithmetic together", () => {
  const noReason = prepareReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes: 20, reason: "" });
  assert.equal(noReason.ok, false);

  // The reason is checked FIRST, so a manager with both problems is not asked to
  // re-key the numbers after being bounced for the text.
  const both = prepareReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes: 999, reason: "x" });
  assert.equal(both.ok, false);
  assert.match((both as { message: string }).message, /reason/i);

  const good = prepareReclass({
    current: HOUR, from: "breakdown", to: "cleaning", minutes: 20,
    reason: "filter change, not a breakdown",
  });
  assert.ok(good.ok, good.ok ? "" : good.message);
  assert.equal(good.reason, "filter change, not a breakdown");
  assert.deepEqual(good.next, { process: 0, cleaning: 20, breakdown: 0, powerout: 5 });
});

// ---------------------------------------------------------------------------
// the colour mark and its tooltip
// ---------------------------------------------------------------------------

const REC: ReclassRecord = {
  fromType: "cleaning",
  toType: "breakdown",
  minutes: 20,
  reason: "belt snapped mid-clean",
  changedBy: "R. Kumar",
  changedAt: "2026-08-14T18:40:00.000Z",
};

test("the tooltip line reads as the owner asked it to", () => {
  assert.equal(
    describeReclassRecord(REC),
    "Cleaning 20m moved to Breakdown (mech/elec) by R. Kumar on 2026-08-14 — belt snapped mid-clean",
  );
});

test("the tooltip drops missing clauses instead of printing null", () => {
  assert.equal(
    describeReclassRecord({ fromType: "breakdown", toType: "process", minutes: 90 }),
    "Breakdown (mech/elec) 1h 30m moved to Process delay by maintenance",
  );
  assert.equal(
    describeReclassRecord({ ...REC, changedBy: "  ", reason: "   " }),
    "Cleaning 20m moved to Breakdown (mech/elec) by maintenance on 2026-08-14",
  );
});

test("the date is the stored day, not a locale re-render of it", () => {
  // Dates in this database are naive IST stored as UTC. A late-evening correction
  // must not slide to the previous day because the dev box is set to UTC.
  assert.match(describeReclassRecord({ ...REC, changedAt: "2026-08-14T23:55:00.000Z" }), / on 2026-08-14 /);
  assert.match(describeReclassRecord({ ...REC, changedAt: new Date("2026-08-14T23:55:00.000Z") }), / on 2026-08-14 /);
});

test("no rows means no mark at all", () => {
  const m = describeReclass([]);
  assert.equal(m.count, 0);
  assert.equal(m.label, "");
  assert.equal(m.tooltip, "");
  assert.deepEqual(m.netByType, { process: 0, cleaning: 0, breakdown: 0, powerout: 0 });
});

test("one row and several rows label and stack differently", () => {
  const one = describeReclass([REC]);
  assert.equal(one.count, 1);
  assert.equal(one.label, "Reclassified");
  assert.equal(one.lines.length, 1);
  assert.deepEqual(one.netByType, { process: 0, cleaning: -20, breakdown: 20, powerout: 0 });

  const two = describeReclass([REC, { ...REC, fromType: "breakdown", toType: "process", minutes: 5, reason: "material wait" }]);
  assert.equal(two.label, "Reclassified x2");
  assert.equal(two.tooltip.split("\n").length, 2);
  assert.deepEqual(two.netByType, { process: 5, cleaning: -20, breakdown: 15, powerout: 0 });
});

test("an unreadable minutes value still renders its line but poisons no figure", () => {
  const m = describeReclass([{ ...REC, minutes: NaN }]);
  assert.equal(m.count, 1);
  assert.match(m.tooltip, /Cleaning \? moved to/);
  assert.deepEqual(m.netByType, { process: 0, cleaning: 0, breakdown: 0, powerout: 0 });
});

// ---------------------------------------------------------------------------
// "what did it used to be"
// ---------------------------------------------------------------------------

test("the before-figures are reconstructible from the current row plus the log", () => {
  // Production logged 20 cleaning + 5 power-out; maintenance moved the 20 into
  // breakdown. The row now reads breakdown 20 — the log says it used to read
  // cleaning 20.
  const now: DelayBuckets = { process: 0, cleaning: 0, breakdown: 20, powerout: 5 };
  const before = originalBuckets(now, [REC]);
  assert.deepEqual(before, { process: 0, cleaning: 20, breakdown: 0, powerout: 5 });
  assert.equal(total(before), total(now)); // a move never changes the hour
  assert.ok(reconstructionSound(before));
});

test("a round trip through planReclass and back lands exactly where it started", () => {
  const p = planReclass({ current: HOUR, from: "breakdown", to: "cleaning", minutes: 20 });
  assert.ok(p.ok);
  const log: ReclassRecord[] = [{ fromType: p.from, toType: p.to, minutes: p.minutes }];
  assert.deepEqual(originalBuckets(p.next, log), HOUR);
});

test("an undo is an inverse row, and the log then nets to nothing", () => {
  // The table is append-only: reversing a correction adds a row with from/to
  // swapped rather than deleting the original, so both moves stay on the record.
  const log: ReclassRecord[] = [
    { fromType: "cleaning", toType: "breakdown", minutes: 20 },
    { fromType: "breakdown", toType: "cleaning", minutes: 20 },
  ];
  const m = describeReclass(log);
  assert.equal(m.count, 2);
  assert.deepEqual(m.netByType, { process: 0, cleaning: 0, breakdown: 0, powerout: 0 });
});

test("an impossible reconstruction is detectable, not silently shown as history", () => {
  // Production edited the hour down to 5 breakdown minutes after maintenance had
  // moved 20 in. Subtracting the log now yields -15, which never existed.
  const now: DelayBuckets = { process: 0, cleaning: 0, breakdown: 5, powerout: 0 };
  const before = originalBuckets(now, [REC]);
  assert.equal(before.breakdown, -15);
  assert.equal(reconstructionSound(before), false);
  assert.equal(reconstructionSound({ process: 0, cleaning: 20, breakdown: 0, powerout: 5 }), true);
});

// ---------------------------------------------------------------------------
// Breakdown trade attribution (classifyBreakdownTrade)
// ---------------------------------------------------------------------------
// MIS stores ONE breakdown minutes column; the trade is attributed from the
// hour's typed reasons. These pin the vocabulary the live data actually uses.
import { classifyBreakdownTrade } from "../src/lib/downtimeShared.ts";

test("the live reason vocabulary lands on the right trade", () => {
  assert.equal(classifyBreakdownTrade(["ELECTRICAL - MACHINE FAILURE"]), "electrical");
  assert.equal(classifyBreakdownTrade(["ELECTRICAL - SUPPLY ISSUE"]), "electrical");
  assert.equal(classifyBreakdownTrade(["HMI ISSUE"]), "electrical");
  assert.equal(classifyBreakdownTrade(["MECHANICAL - MACHINE ISSUE"]), "mechanical");
  assert.equal(classifyBreakdownTrade(["MECHANICAL - BELT ISSUE"]), "mechanical");
});

test("both trades on one hour is mixed — one figure cannot be split honestly", () => {
  assert.equal(
    classifyBreakdownTrade(["ELECTRICAL - MACHINE FAILURE", "MECHANICAL - MACHINE ISSUE"]),
    "mixed",
  );
});

test("no trade-naming reason is unknown, not a silent default", () => {
  assert.equal(classifyBreakdownTrade([]), "unknown");
  assert.equal(classifyBreakdownTrade(["FILM DAMAGE"]), "unknown");
  assert.equal(classifyBreakdownTrade(["PROCESS DELAY"]), "unknown");
});

test("a trade reason plus an unrelated reason still attributes cleanly", () => {
  assert.equal(classifyBreakdownTrade(["ELECTRICAL - MACHINE FAILURE", "PROCESS DELAY"]), "electrical");
  assert.equal(classifyBreakdownTrade(["MECHANICAL - MACHINE ISSUE", "Robo 4"]), "mechanical");
});
