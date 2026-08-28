import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_STATES, DISPATCH_STATES, TRANSITIONS, STATE_STAMP,
  canTransition, checkTransition, nextState, isSampleState,
  checkRelease, checkIntake, planRelease,
} from "../src/lib/sampling/lifecycle.ts";

// Two rules live in this module and both are about not lying to a customer:
// a package cannot claim to be delivered before it has been dispatched, and a
// shelf cannot give away more pieces than it has. Neither is enforceable in
// the UI — the same endpoints are reachable with a fetch from any signed-in
// session — so they are pinned here and called from the route.

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

test("the lifecycle is the owner's four states, in his order", () => {
  assert.deepEqual(SAMPLE_STATES, ["IN_STOCK", "RELEASED", "DISPATCHED", "DELIVERED"]);
});

test("IN_STOCK is not a dispatch status — it is the absence of a dispatch", () => {
  // sampling_dispatch.status only holds the last three. A piece that is in
  // stock is a sampling_stock quantity with no dispatch line against it, so
  // storing IN_STOCK on a dispatch row would describe a package that does not
  // exist yet.
  assert.deepEqual(DISPATCH_STATES, ["RELEASED", "DISPATCHED", "DELIVERED"]);
  assert.ok(!DISPATCH_STATES.includes("IN_STOCK"));
  // Every storable status has somewhere to record who moved it and when.
  for (const s of DISPATCH_STATES) {
    assert.ok(STATE_STAMP[s], `${s} must stamp a time and a user`);
    assert.ok(STATE_STAMP[s].at.length > 0 && STATE_STAMP[s].by.length > 0);
  }
  assert.equal(STATE_STAMP.IN_STOCK, undefined);
});

test("the three legal transitions are exactly the three the owner described", () => {
  assert.deepEqual(TRANSITIONS.map((t) => `${t.from}->${t.to}`), [
    "IN_STOCK->RELEASED", "RELEASED->DISPATCHED", "DISPATCHED->DELIVERED",
  ]);
  for (const t of TRANSITIONS) assert.ok(canTransition(t.from, t.to));
});

test("a transition cannot skip a state", () => {
  // "Delivered" on a package that was never dispatched is a customer being
  // told their samples arrived while they are still on the shelf.
  assert.ok(!canTransition("IN_STOCK", "DISPATCHED"));
  assert.ok(!canTransition("IN_STOCK", "DELIVERED"));
  assert.ok(!canTransition("RELEASED", "DELIVERED"));
  assert.match(checkTransition("RELEASED", "DELIVERED").ok ? "" : checkTransition("RELEASED", "DELIVERED").reason!, /skips DISPATCHED/);
});

test("a transition cannot go backwards, and nothing follows DELIVERED", () => {
  // Nothing the owner has decided authorises an undo, and an undo is not a
  // missing line of code — it is an unanswered question about the stock that
  // was already pulled off the shelf.
  assert.ok(!canTransition("DELIVERED", "DISPATCHED"));
  assert.ok(!canTransition("DISPATCHED", "RELEASED"));
  assert.ok(!canTransition("RELEASED", "IN_STOCK"));
  assert.equal(nextState("DELIVERED"), null);
  const back = checkTransition("DISPATCHED", "RELEASED");
  assert.match(back.ok ? "" : back.reason, /backwards/);
});

test("a state cannot transition to itself", () => {
  for (const s of SAMPLE_STATES) {
    assert.ok(!canTransition(s, s));
    const r = checkTransition(s, s);
    assert.match(r.ok ? "" : r.reason, /already/);
  }
});

test("an unknown state fails closed rather than landing somewhere", () => {
  assert.ok(!canTransition("PACKED", "DISPATCHED"));
  assert.ok(!canTransition("RELEASED", "SHIPPED"));
  assert.ok(!canTransition(null, "RELEASED"));
  assert.ok(!canTransition(undefined, undefined));
  assert.ok(!isSampleState("PACKED"));
  assert.ok(!isSampleState(""));
  assert.match(checkTransition("PACKED", "DISPATCHED").ok ? "" : checkTransition("PACKED", "DISPATCHED").reason, /not a sample state/);
});

test("nextState walks the chain and stops", () => {
  assert.equal(nextState("IN_STOCK"), "RELEASED");
  assert.equal(nextState("RELEASED"), "DISPATCHED");
  assert.equal(nextState("DISPATCHED"), "DELIVERED");
  assert.equal(nextState("nonsense"), null);
});

// ---------------------------------------------------------------------------
// Stock cannot go below zero
// ---------------------------------------------------------------------------

test("STOCK CANNOT BE RELEASED BELOW ZERO", () => {
  // A negative sampling_stock row means the shelf is lying about something
  // that was already given away, and every later count inherits the lie.
  const over = checkRelease(3, 4);
  assert.equal(over.ok, false);
  assert.match(over.ok ? "" : over.reason, /only 3 in stock, 4 requested/);
  assert.equal(checkRelease(0, 1).ok, false);
});

test("releasing exactly what is there is allowed and lands on zero", () => {
  const exact = checkRelease(4, 4);
  assert.ok(exact.ok);
  assert.equal(exact.ok ? exact.remaining : -1, 0);
  const some = checkRelease(10, 3);
  assert.equal(some.ok ? some.remaining : -1, 7);
});

test("a piece is a whole thing — fractions and zero and negatives are refused", () => {
  // A negative quantity through the release path would ADD stock, which is the
  // same bug wearing a different sign.
  assert.equal(checkRelease(10, 0).ok, false);
  assert.equal(checkRelease(10, -2).ok, false);
  assert.equal(checkRelease(10, 1.5).ok, false);
  assert.match(checkRelease(10, -2).ok ? "" : checkRelease(10, -2).reason, /at least 1/);
  assert.match(checkRelease(10, 1.5).ok ? "" : checkRelease(10, 1.5).reason, /whole number/);
});

test("an already-negative shelf is refused rather than made worse", () => {
  const r = checkRelease(-1, 1);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /already negative/);
});

test("a package is all or nothing", () => {
  // Releasing the lines that fit and dropping the one that does not sends a
  // customer a box missing a sample nobody told them about.
  const plan = planRelease([
    { label: "Cappuccino Leather 4x4 20mm", onHand: 10, quantity: 2 },
    { label: "Taj Vein 4x6 30mm", onHand: 1, quantity: 5 },
    { label: "Arva White 4x4 20mm", onHand: 0, quantity: 1 },
  ]);
  assert.equal(plan.ok, false);
  assert.equal(plan.shortfalls.length, 2);
  assert.match(plan.shortfalls[0], /Taj Vein 4x6 30mm: only 1 in stock, 5 requested/);
  assert.match(plan.shortfalls[1], /Arva White/);
});

test("a package that fits reports no shortfalls", () => {
  const plan = planRelease([
    { label: "a", onHand: 10, quantity: 2 },
    { label: "b", onHand: 2, quantity: 2 },
  ]);
  assert.deepEqual(plan, { ok: true, shortfalls: [] });
  assert.deepEqual(planRelease([]), { ok: true, shortfalls: [] });
});

test("an unlabelled line still says which one it was", () => {
  const plan = planRelease([{ onHand: 0, quantity: 1 }]);
  assert.match(plan.shortfalls[0], /^line 1:/);
});

test("intake adds, with the same whole-piece rule", () => {
  const r = checkIntake(4, 6);
  assert.equal(r.ok ? r.remaining : -1, 10);
  assert.equal(checkIntake(0, 12).ok, true);
  assert.equal(checkIntake(4, 0).ok, false);
  assert.equal(checkIntake(4, -1).ok, false);
  assert.equal(checkIntake(4, 2.5).ok, false);
  assert.equal(checkIntake(-1, 2).ok, false);
});
