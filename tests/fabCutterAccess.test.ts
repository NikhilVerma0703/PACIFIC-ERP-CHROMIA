import { test } from "node:test";
import assert from "node:assert/strict";
// tier.ts, not access.ts — access.ts reaches the Prisma client through
// currentUser() and `node --test` cannot import it. The rule was lifted out for
// exactly this, so these exercise the function every fabGate runs rather than a
// copy that has to be kept in step by hand.
import { fabTierOf, fabTierMeets, TIER_RANK } from "../src/lib/fab/tier.ts";
import { isFabStockContributor, samplingCan } from "../src/lib/sampling/actions.ts";

// THE CUTTER DOES HIS OWN SLAB ALLOCATION NOW.
//
// The owner: "we have slab allocation page made for supervisor, that need to be
// included to the cutter as well — but the flow is click +slab and enter the
// rows and quantity and cut, and rest is same as now." And on samples: "when
// it's sample, sampling guy send request to supervisor, where hereafter no need
// of send to cutter — it queued to cutter where he choose a slab and starts
// working. He sees the project CTS or sampling, then inside he add slab and
// start working."
//
// Four routes were widened from SUPERVISOR to EMPLOYEE to allow it:
//
//   GET  /api/fab/supervisor/board             what is waiting for stone
//   POST/PATCH/DELETE .../slab-assignment      put the slab up, fill it
//   POST /api/fab/approve-slab                 put it on the saw
//   GET  /api/fab/whoami                       (new) which job the viewer holds
//
// This file pins the SHAPE of that decision — who the widened tier lets in, and
// just as importantly WHO IT DOES NOT, because two boundaries deliberately did
// not move with it and a later edit that "tidies them up" would be a leak.
//
// It cannot test a route (that needs a session and a database). It tests the
// pure rules the routes gate on, which is where the mistake would actually be.

const OPERATOR   = { role: "OPERATOR",     branch: "FABRICATION" };
const INCHARGE   = { role: "INCHARGE",     branch: "FABRICATION" };
const MANAGER    = { role: "LINE_MANAGER", branch: "FABRICATION" };
const ADMIN      = { role: "ADMIN",        branch: "OFFICE" };
const OUTSIDER   = { role: "OPERATOR",     branch: "OFFICE" };
const SAMPLING   = { role: "SAMPLING",     branch: null };

test("EMPLOYEE ADMITS THE CUTTER — and everyone above him, which is the point of a minimum", () => {
  // fabGate(min) compares tiers on one ladder, so widening a gate to EMPLOYEE
  // does not take it away from the supervisor who had it before. That is worth
  // pinning: a gate changed to an equality check would silently lock out the
  // very people the board was built for.
  assert.equal(fabTierOf(OPERATOR), "EMPLOYEE");
  assert.equal(fabTierOf(INCHARGE), "SUPERVISOR");
  assert.equal(fabTierOf(MANAGER), "MANAGER");
  assert.equal(fabTierOf(ADMIN), "ADMIN", "admins span every department");

  // THE FOUR WIDENED GATES, as fabGate compares them. Every one of these four
  // people can now put a slab on the saw; that is the change.
  for (const who of [OPERATOR, INCHARGE, MANAGER, ADMIN]) {
    assert.equal(fabTierMeets(who, "EMPLOYEE"), true, JSON.stringify(who));
  }
  // And the ladder is a ladder — not four equality checks that could drift.
  assert.ok(TIER_RANK.EMPLOYEE < TIER_RANK.SUPERVISOR);
  assert.ok(TIER_RANK.SUPERVISOR < TIER_RANK.MANAGER);
  assert.ok(TIER_RANK.MANAGER < TIER_RANK.ADMIN);
});

test("AND IT IS STILL A CLOSED DOOR — 'EMPLOYEE' is not 'anybody signed in'", () => {
  // The whole reason widening these four routes is safe: fabTierOf returns null
  // for anyone outside the FABRICATION branch, so the tier floor was never what
  // was keeping the public out. An office operator, a sampling login and a
  // signed-out request are all refused at exactly the same place they were.
  assert.equal(fabTierOf(OUTSIDER), null, "same role, wrong department");
  assert.equal(fabTierOf(SAMPLING), null, "a capped role with no fab branch");
  assert.equal(fabTierOf(null), null);
  assert.equal(fabTierOf(undefined), null);
  assert.equal(fabTierOf({}), null);
  assert.equal(fabTierOf({ role: "OPERATOR" }), null, "no branch at all");
  assert.equal(fabTierOf({ role: "", branch: "FABRICATION" }), null, "in the branch, no role rank");

  // A null tier clears NO minimum, including the lowest one — which is what
  // makes the widened gates a door rather than an opening.
  for (const who of [OUTSIDER, SAMPLING, null, undefined, {}]) {
    assert.equal(fabTierMeets(who, "EMPLOYEE"), false, JSON.stringify(who ?? null));
  }
});

test("HAND EDGE POLISH DID NOT WIDEN WITH THEM — the owner named who decides", () => {
  // "Any pieces can be assigned the edge hand polish or not — this is chosen and
  // done by supervisor, or else the one manager who uploads the PO."
  //
  // /api/fab/supervisor/finished-edges still gates on SUPERVISOR. The cutter's
  // board therefore leaves step 4 OUT rather than drawing a picker that answers
  // 403, and this pins the rule that makes that the right call: if the tier
  // below ever reached SUPERVISOR, hiding the step would become a bug instead of
  // a courtesy.
  const supervisorTiers = ["SUPERVISOR", "MANAGER", "ADMIN"];
  assert.ok(supervisorTiers.includes(fabTierOf(INCHARGE)!));
  assert.ok(supervisorTiers.includes(fabTierOf(MANAGER)!));
  assert.ok(!supervisorTiers.includes(fabTierOf(OPERATOR)!),
    "a cutter must NOT pass a SUPERVISOR gate — the edge decision is not his");
});

test("SAMPLING'S DID WIDEN — the cutter puts his own offcuts on the shelf", () => {
  // THIS TEST ASSERTED THE OPPOSITE, and the reversal is the owner's:
  // "I need space in cutter to add some extra pieces as well, need to select
  // from which slab, so it will be added in the sample inventory as well."
  //
  // It used to pin `isFabStockContributor` at rank >= INCHARGE, quoting
  // lib/sampling/actions.ts — "a fab OPERATOR is not included: the machine
  // operator does not decide what is worth keeping." He is the only one who can
  // SEE the offcut, which is the fact that rule missed. SampleCutControl is on
  // his slab card now rather than hidden from it.
  assert.equal(isFabStockContributor(OPERATOR), true);
  assert.equal(isFabStockContributor(INCHARGE), true);
  assert.equal(isFabStockContributor(MANAGER), true);
  assert.equal(samplingCan(OPERATOR, "addStock"), true);

  // ADD ONLY, AND THAT DID NOT MOVE. The fab side may CONTRIBUTE stock; it may
  // not browse the inventory, release, or touch a dispatch — and the cutter got
  // exactly the supervisor's one action, not a tier of his own.
  assert.equal(samplingCan(OPERATOR, "view"), false);
  assert.equal(samplingCan(OPERATOR, "dispatch"), false);
  assert.equal(samplingCan(INCHARGE, "dispatch"), false,
    "even the supervisor is add-only on this module");

  // AND THE BRANCH IS STILL THE DOOR. Same role outside fabrication is nobody,
  // which is what makes widening the rank floor safe rather than open.
  assert.equal(isFabStockContributor(OUTSIDER), false, "an office operator gets nothing");
  assert.equal(samplingCan(OUTSIDER, "addStock"), false);
});

test("HAND EDGE POLISH AND OFFCUTS DREW THEIR LINES IN DIFFERENT PLACES", () => {
  // Worth pinning together, because "tidying" one to match the other is the
  // obvious-looking change and would be wrong both ways round.
  //
  //   EDGE POLISH   supervisor or the PO manager — "this is chosen and done by
  //                 supervisor, or else the one manager who uploads the PO."
  //                 A DECISION about what the customer is paying for.
  //   OFFCUTS       the cutter as well — he is holding the stone.
  //                 An OBSERVATION about what physically exists.
  //
  // The owner separated them on purpose, and the boards follow him rather than
  // being consistent for its own sake.
  assert.equal(fabTierMeets(OPERATOR, "SUPERVISOR"), false, "edges are not the cutter's");
  assert.equal(isFabStockContributor(OPERATOR), true, "offcuts are");
});

test("WHO RELEASED IT — the shared login is why one column could not answer", () => {
  // scripts/0064 added TWO columns to fab_slab_job, and this pins the reason,
  // because "released_by_id is enough, drop the other one" is a tidy-up someone
  // will propose the first time they read the schema.
  //
  // Fabrication signs in on ONE shared operator account. The tier is the same
  // for every man on the floor, and so is the user id — which is exactly the
  // trap fab/cutting/page.tsx already documents about operatorId: "comparing
  // operatorId to currentUserId returns 'mine' for every job on the board no
  // matter who started it. The lock rendered, and could never fire."
  //
  // Two different cutters are INDISTINGUISHABLE by anything the gate knows:
  const cutterA = { ...OPERATOR };
  const cutterB = { ...OPERATOR };
  assert.equal(fabTierOf(cutterA), fabTierOf(cutterB));
  assert.deepEqual(cutterA, cutterB, "the login cannot tell them apart — the session must");

  // A supervisor is not in that position: his login is his own, which is why
  // approve-slab requires a process session from an EMPLOYEE and not from him.
  assert.equal(fabTierMeets(OPERATOR, "SUPERVISOR"), false, "an operator needs the session");
  assert.equal(fabTierMeets(INCHARGE, "SUPERVISOR"), true, "a supervisor's login is the record");
  assert.equal(fabTierMeets(MANAGER, "SUPERVISOR"), true);
  assert.equal(fabTierMeets(ADMIN, "SUPERVISOR"), true);
});

test("A SAMPLE ORDER IS THE SAME WORK, so nothing about it needs its own tier", () => {
  // "Sampling work is not a different kind of work; it is the same work for a
  // different customer" — the note at the head of /api/sampling/requests, and
  // the reason a sample becomes an ordinary fab_project rather than a new table.
  //
  // So "no need of send to cutter" required no new permission at all: the cutter
  // reaching approve-slab is what removed the handover, and it removed it for a
  // purchase order and a sample in exactly the same motion. There is deliberately
  // no isSample branch in any of the four widened gates, and this test exists to
  // say that the absence is the design rather than an oversight.
  assert.equal(fabTierOf(OPERATOR), "EMPLOYEE");
});
