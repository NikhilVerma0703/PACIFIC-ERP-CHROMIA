// BOXES AND STANDS — the rules, run (scripts/0086; the owner, 2026-09-14:
// "we want to add to track sample boxes and stands in the sampling modules").
//
// Pure imports only, as the rest of this module's tests are: node --test loads
// unit-rules.ts bare, no Prisma, no Next, no auth. Everything asserted here is
// a decision a route delegates rather than makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unitNeeded, unitAvailability, checkUnitRelease, checkPackage,
  proposeSerial, checkSerialTransition, adjustmentIssue, ledgerDrift,
  UNIT_SERIAL_NEXT,
} from "../src/lib/sampling/unit-rules.ts";
import { SAMPLING_ACTIONS, SAMPLING_ACTORS } from "../src/lib/sampling/actions.ts";

// ───────────────────── what a request actually consumes ──────────────────────

test("unitNeeded: three answers, not two — and the top-up is the one that matters", () => {
  // A Sample Kit goes out IN something.
  assert.deepEqual(unitNeeded("Sample Kit"), { kind: "BOX", standType: "Sample Kit Box", needsChoice: false });

  // A New Stand consumes the variant the rep asked for.
  assert.deepEqual(unitNeeded("New Stand", "Wall Display"), { kind: "STAND", standType: "Wall Display", needsChoice: false });

  // NEVER A SILENT FLOOR STAND. When the rep left the variant blank the answer
  // is "a stand, nobody has said which" and the incharge picks at pack — a
  // Floor Stand is the most expensive of the three and the easiest to send by
  // accident.
  const blank = unitNeeded("New Stand", "");
  assert.equal(blank.kind, "STAND");
  assert.equal(blank.standType, null);
  assert.equal(blank.needsChoice, true, "somebody must choose; the code must not");
  assert.deepEqual(unitNeeded("New Stand", null), blank);
  assert.deepEqual(unitNeeded("New Stand", "   "), blank);

  // THE TOP-UP REFILLS A STAND THE CUSTOMER ALREADY HAS. Decrementing one
  // would consume an asset that never leaves the building; refusing it at zero
  // stands on hand would block a request that needs none. Both failures are
  // silent, which is why this is a named function with its own test.
  for (const t of ["Stand Top-up", "Loose Samples", "Replacement"]) {
    assert.deepEqual(unitNeeded(t), { kind: null, standType: null, needsChoice: false }, t);
  }

  // Case and padding are Salesforce's to vary, not ours to depend on.
  assert.equal(unitNeeded("  sample kit  ").kind, "BOX");
  assert.equal(unitNeeded("NEW STAND", "Floor Stand").kind, "STAND");

  // An unknown type consumes nothing: the pieces still go out, and nobody
  // loses a stand to a word the ERP had not been told about.
  assert.deepEqual(unitNeeded("Something Salesforce Added Later"), { kind: null, standType: null, needsChoice: false });
  assert.deepEqual(unitNeeded(null), { kind: null, standType: null, needsChoice: false });
  assert.deepEqual(unitNeeded(undefined), { kind: null, standType: null, needsChoice: false });
});

// ───────────────────── how many are really available ─────────────────────────

test("unitAvailability: on hand less what older open requests already claim", () => {
  assert.deepEqual(unitAvailability(5, 2, 2), { onHand: 5, committed: 2, available: 3, low: false });
  // Below the type's own floor, the card goes red.
  assert.deepEqual(unitAvailability(5, 4, 2), { onHand: 5, committed: 4, available: 1, low: true });
  // Never negative: more committed than on hand means none available, not -3.
  assert.deepEqual(unitAvailability(2, 5, 1), { onHand: 2, committed: 5, available: 0, low: true });
  // Junk in, honest zero out.
  assert.deepEqual(unitAvailability(NaN as unknown as number, -4, 0), { onHand: 0, committed: 0, available: 0, low: false });
  assert.equal(unitAvailability(3.7, 0, 1).onHand, 3, "half a stand is not a stand");
});

test("checkUnitRelease: the shortfall reads like a piece shortfall, because the incharge reads both", () => {
  assert.deepEqual(checkUnitRelease("Floor Stand", 2, 1), { ok: true, shortfall: 0, reason: null });
  const short = checkUnitRelease("Sample Kit Box", 0, 1);
  assert.equal(short.ok, false);
  assert.equal(short.shortfall, 1);
  assert.equal(short.reason, "Sample Kit Box: 0 of 1 available");
  assert.equal(checkUnitRelease("Floor Stand", 5, 0).ok, false, "a package consumes at least one");
});

test("checkPackage: all or nothing, and the pieces are named before the box", () => {
  const pieces = [
    { label: "Cappuccino (Polished) 4 × 4 in · 20 mm", onHand: 12, quantity: 20 },
    { label: "Aureate (Polished) 4 × 4 in · 20 mm", onHand: 30, quantity: 5 },
  ];
  const out = checkPackage(pieces, { label: "Sample Kit Box", onHand: 0, quantity: 1 });
  assert.equal(out.ok, false);
  assert.equal(out.shortfalls.length, 2);
  // THE PIECES COME FIRST — that is the part the incharge can do something
  // about; the box is somebody else's order to place.
  assert.match(out.shortfalls[0]!, /Cappuccino/);
  assert.match(out.shortfalls[1]!, /Sample Kit Box/);

  // Enough of both, and no unit at all, both pass.
  assert.deepEqual(checkPackage([{ label: "x", onHand: 5, quantity: 5 }], { label: "Box", onHand: 1, quantity: 1 }), { ok: true, shortfalls: [] });
  assert.deepEqual(checkPackage([{ label: "x", onHand: 5, quantity: 5 }], null), { ok: true, shortfalls: [] });
});

// ───────────────────── the number on the metal ───────────────────────────────

test("proposeSerial: initials and a four-digit run, and it only ever PROPOSES", () => {
  assert.equal(proposeSerial("Floor Stand", 0), "FS-0001");
  assert.equal(proposeSerial("Floor Stand", 6), "FS-0007");
  assert.equal(proposeSerial("Wall Display", 1), "WD-0002");
  assert.equal(proposeSerial("Counter Display", 10), "CD-0011");
  assert.equal(proposeSerial("Sample Kit Box", 0), "SKB-0001", "three initials at most");
  assert.equal(proposeSerial("", 0), "SU-0001", "something rather than a bare dash");
});

// ───────────────────── where a stand may go next ─────────────────────────────

test("a returned stand goes nowhere by itself — a person decides", () => {
  // Back on the shelf or out of service are the only two exits, and neither is
  // automatic: it is a question about the condition of a physical object, and
  // only somebody who has looked at it can answer. The same reason the sample
  // lifecycle has no undo.
  assert.deepEqual([...UNIT_SERIAL_NEXT.RETURNED], ["IN_STOCK", "RETIRED"]);
  assert.equal(checkSerialTransition("RETURNED", "IN_STOCK").ok, true);
  assert.equal(checkSerialTransition("RETURNED", "RETIRED").ok, true);
  assert.equal(checkSerialTransition("RETURNED", "DISPATCHED").ok, false);
});

test("checkSerialTransition owns the wording as well as the legality", () => {
  assert.equal(checkSerialTransition("IN_STOCK", "RELEASED").ok, true);
  assert.equal(checkSerialTransition("RELEASED", "DISPATCHED").ok, true);
  assert.equal(checkSerialTransition("DISPATCHED", "INSTALLED").ok, true);
  assert.equal(checkSerialTransition("INSTALLED", "RETURNED").ok, true);
  // A package unpacked before it left puts the stand back.
  assert.equal(checkSerialTransition("RELEASED", "IN_STOCK").ok, true);

  // Retired is the end of the line.
  assert.deepEqual([...UNIT_SERIAL_NEXT.RETIRED], []);
  const dead = checkSerialTransition("RETIRED", "IN_STOCK");
  assert.equal(dead.ok, false);
  assert.ok(dead.reason);

  const same = checkSerialTransition("IN_STOCK", "IN_STOCK");
  assert.equal(same.ok, false);
  assert.match(same.reason!, /already in stock/);

  const jump = checkSerialTransition("IN_STOCK", "INSTALLED");
  assert.equal(jump.ok, false);
  assert.match(jump.reason!, /cannot go straight to/);

  assert.equal(checkSerialTransition("NONSENSE", "IN_STOCK").ok, false);
});

// ───────────────────── the ledger is evidence, or it is nothing ──────────────

test("an adjustment without a reason is refused", () => {
  assert.equal(adjustmentIssue(0, "recount"), "An adjustment of zero changes nothing — say what the new count should be.");
  assert.match(adjustmentIssue(-2, "")!, /say why/i);
  assert.match(adjustmentIssue(-2, "   ")!, /say why/i);
  assert.match(adjustmentIssue(3, null)!, /say why/i);
  assert.equal(adjustmentIssue(-2, "two crushed in the store"), null);
});

test("ledgerDrift: the count against its own history", () => {
  assert.equal(ledgerDrift(10, [6, 6, -2]), 0);
  assert.equal(ledgerDrift(11, [6, 6, -2]), 1, "one more on the shelf than the ledger explains");
  assert.equal(ledgerDrift(9, [10]), -1);
  assert.equal(ledgerDrift(0, []), 0);
});

// ───────────────────── and who is allowed to touch any of it ─────────────────

test("managing units is its own action, and never the fabrication floor's", () => {
  // THE TRAP THIS AVOIDS is documented at length in actions.ts: addStock
  // admits FAB_SUPERVISOR for the floor's single errand of recording an offcut
  // that came off the saw. A box is not the floor's, and a display stand is a
  // capital asset that goes to a named customer for years — folding units into
  // addStock would hand the shared floor login the power to adjust a stand
  // count and retire an asset, for no reason beyond the two words sounding
  // alike.
  assert.ok(SAMPLING_ACTIONS.includes("manageUnits"));
  assert.deepEqual([...SAMPLING_ACTORS.manageUnits], ["SAMPLING", "ADMIN"]);
  assert.ok(SAMPLING_ACTORS.addStock.includes("FAB_SUPERVISOR"), "addStock still admits the floor, as it must");
  assert.equal(SAMPLING_ACTORS.manageUnits.includes("FAB_SUPERVISOR"), false, "and units never do");

  // Every action has an actor list — a new action with none would deny
  // everybody and read as a broken screen rather than a permission decision.
  for (const a of SAMPLING_ACTIONS) {
    assert.ok(Array.isArray(SAMPLING_ACTORS[a]) && SAMPLING_ACTORS[a].length > 0, `${a} has actors`);
  }
});
