import { test } from "node:test";
import assert from "node:assert/strict";
// tier.ts, not access.ts — access.ts reaches the Prisma client through
// currentUser() and `node --test` cannot import it. The rule was lifted out for
// exactly this, so these exercise the function every fabGate runs rather than a
// copy that has to be kept in step by hand.
import { fabTierOf, fabTierMeets, TIER_RANK } from "../src/lib/fab/tier.ts";
import { isFabStockContributor, samplingCan } from "../src/lib/sampling/actions.ts";
// middleware.ts cannot be IMPORTED here — it calls NextAuth() at module scope,
// which needs the edge runtime — so its fab-OPERATOR allowlist is read out of
// the source, the same way tests/publicAssets.test.ts reads the matcher string.
// Reading the real file is the point: a copy of the list in this test would be
// the second copy that lib/routeCaps.ts exists to abolish.
import { readFileSync } from "node:fs";
import { operatorMayVisit } from "../src/lib/routeCaps.ts";
// The rate card, for the one fact the slab-thickness guard rests on: 2 cm and
// 3 cm stone are different money, so which slab a row sits on IS a price.
import { rateFor } from "../src/lib/fab/pricing.ts";

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

// ---------------------------------------------------------------------------
// AND HE CAN ACTUALLY OPEN THE BOARD.
//
// Everything above pins WHO the widened gates admit. It was all true, and the
// feature was still dead in production: the branch widened five API gates and
// added two links to /fab/supervisor/slabs, and nobody added the PAGE to the
// fab-OPERATOR allowlist in middleware.ts — an opt-IN list, so every click on
// "Pick a slab & cut" or on a "Waiting for a slab" card redirected the cutter
// to /no-access and not one of the five gates was ever reached from the UI.
//
// A widened API gate is not access. These tests hold the two halves together:
// the page list must open the board, must still refuse the rest of the
// supervisor's screens, and every fab link the cutter's own components render
// must be a path this list opens.
// ---------------------------------------------------------------------------

const MIDDLEWARE = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");

/** The fab-OPERATOR page allowlist, read out of middleware.ts itself. */
function queuePages(): string[] {
  const lit = /const QUEUE_PAGES = \[([\s\S]*?)\];/.exec(MIDDLEWARE);
  assert.ok(lit, "middleware.ts must declare the fab-OPERATOR allowlist as `const QUEUE_PAGES = [...]`");
  const paths = [...lit[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 0, "QUEUE_PAGES must not be empty");
  return paths;
}

/**
 * The rule middleware runs for a FABRICATION operator, rebuilt from the file.
 *
 * The `ok` line is asserted verbatim rather than assumed, so this stays a test
 * OF middleware and not of a stale paraphrase: change the shape of that rule
 * and this fails loudly instead of passing against a copy that no longer
 * describes the gate.
 */
function fabOperatorMayOpen(p: string): boolean {
  assert.ok(
    MIDDLEWARE.includes('const ok = QUEUE_PAGES.includes(p) || p === "/fab/session";'),
    "the fab-OPERATOR page rule changed shape — update this test to match middleware.ts"
  );
  return queuePages().includes(p) || p === "/fab/session";
}

test("THE CUTTER CAN REACH THE SLAB BOARD — the page gate, not just the API gates", () => {
  // The one path the five widened gates are worked from. Without this entry the
  // whole widening is unreachable: this is the assertion that was missing.
  assert.equal(fabOperatorMayOpen("/fab/supervisor/slabs"), true,
    "a fab OPERATOR must be able to OPEN the board the widened gates serve");

  // His five station queues and the machine session, unchanged by the carve-out.
  for (const p of ["/fab/cutting", "/fab/polishing", "/fab/sink-cutting",
                   "/fab/fabrication", "/fab/packaging", "/fab/downtime", "/fab/session"]) {
    assert.equal(fabOperatorMayOpen(p), true, p);
  }
});

test("...AND THE REST OF THE SUPERVISOR'S SCREENS ARE STILL SHUT", () => {
  // The carve-out is ONE EXACT PATH. Written as a "/fab/supervisor" prefix it
  // would have handed the shared floor login the planning board and the
  // people/attendance screen in the same motion — which is the change somebody
  // makes while "simplifying" this list, so it is pinned rather than assumed.
  for (const p of [
    "/fab/supervisor",            // the planning board
    "/fab/supervisor/people",     // names and attendance
    "/fab/supervisor/samples",
    "/fab/supervisor/downtime",
    "/fab/manager", "/fab/ceo", "/fab/projects",
    "/fab/supervisor/slabs/anything",   // a sub-route added later is NOT opened
    "/fab/supervisor/slabs-admin",      // nor a near-miss sibling
  ]) {
    assert.equal(fabOperatorMayOpen(p), false, `${p} must stay closed to a fab OPERATOR`);
  }

  // Exactly one supervisor path is open to him, so a second one added to the
  // list has to be a deliberate edit to this test as well.
  const supervisorPaths = queuePages().filter((p) => p.startsWith("/fab/supervisor"));
  assert.deepEqual(supervisorPaths, ["/fab/supervisor/slabs"]);
});

test("THE CUTTER'S OWN LINKS POINT AT PAGES HE MAY OPEN", () => {
  // The defect stated as the user saw it: a button on his screen that answers
  // /no-access. Both components are read from disk, so adding a link to a page
  // nobody opened fails here rather than on the shop floor.
  const COMPONENTS = [
    "../src/components/fab/OperatorQueueNav.tsx",  // "Pick a slab & cut"
    "../src/app/fab/cutting/page.tsx",             // the "Waiting for a slab" cards
  ];
  let checked = 0;
  for (const rel of COMPONENTS) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    // href="…", href: "…", href={`…`} and the local floorLink("…") helper. The
    // path is cut at "?" and at a template hole, because middleware matches a
    // PATHNAME — which is also why the ?projectId=… card link is admitted by an
    // exact entry.
    for (const m of src.matchAll(/(?:href\s*[:=]\s*\{?\s*|floorLink\(\s*)["'`]([^"'`]+)/g)) {
      const path = m[1].split("?")[0].split("${")[0];
      if (!path.startsWith("/fab")) continue;
      checked++;
      assert.equal(fabOperatorMayOpen(path), true,
        `${rel} renders a link to ${path}, which middleware.ts refuses to a fab OPERATOR`);
    }
  }
  // The scan itself has to have found something — a regex that silently matched
  // nothing would make this test pass for the wrong reason.
  assert.ok(checked >= 7, `expected the cutter's fab links to be found, saw ${checked}`);
});

test("THE PAGE IS OPENED FOR THE FAB OPERATOR ONLY — not for the man on the line", () => {
  // /fab/supervisor/slabs is granted by the FABRICATION BRANCH block, which
  // returns before the role caps. operatorMayVisit is the SHOP-FLOOR operator's
  // cap and must not have grown a fab path: that would open a fabrication
  // screen to the production line and would give the cutter nothing, since his
  // login never reaches that function.
  assert.equal(operatorMayVisit("/fab/supervisor/slabs"), false);
  assert.equal(operatorMayVisit("/fab/cutting"), false);
  assert.equal(operatorMayVisit("/entry"), true, "his own cap is untouched");
});

// ---------------------------------------------------------------------------
// WHAT THE WIDENING DOES NOT INCLUDE: THE MONEY.
//
// Two of the widened routes carried a price with the act, and that is the part
// the owner never widened. Both are frozen figures once scripts/0066 stamps a
// packed piece — written once, never rewritten — so a floor login moving one is
// not a typo somebody corrects later, it is what the project earned.
//
//   send-to-hand        the ACT is his (the machine broke, he is standing at
//                       it); the RATE, the three per-face rates, the pricing
//                       mode and the agreed total are the supervisor's.
//   slab-assignment     placing rows on a slab is his; but a row's rate card is
//                       keyed on MAX(fab_slab.thickness) across its
//                       allocations, so allocating onto stone of another
//                       thickness reprices every piece on the row.
//
// Neither rule can be imported (both files reach Prisma), so they are read out
// of the routes in the style of the middleware tests above.
// ---------------------------------------------------------------------------

const HAND = readFileSync(new URL("../src/app/api/fab/send-to-hand/route.ts", import.meta.url), "utf8");
const SLAB_ASSIGN = readFileSync(
  new URL("../src/app/api/fab/supervisor/slab-assignment/route.ts", import.meta.url), "utf8");

/** The columns that decide what a hand-polished piece earned. */
const PRICE_COLUMNS = [
  "hand_rate", "hand_pair_rate", "hand_rate_top", "hand_rate_bottom", "hand_rate_side",
  "hand_pricing_mode", "hand_total_override",
];

test("SEND-TO-HAND: THE CUTTER MOVES THE WORK, THE SUPERVISOR SETS THE PRICE", () => {
  // The act stays his — that is what the owner asked for and it must not be
  // "tidied" back to SUPERVISOR while fixing the price half.
  assert.ok(/export async function POST[\s\S]*?fabGate\("EMPLOYEE"\)/.test(HAND),
    "sending a piece to the bench must still be reachable by the man at the machine");

  // And the price half is the SUPERVISOR line, on the one ladder every fab gate
  // compares — not a role name spelled out again here.
  assert.ok(HAND.includes("TIER_RANK[g.tier as FabTier] >= TIER_RANK.SUPERVISOR"),
    "the pricing test must be the same >= SUPERVISOR comparison fabGate makes");
  assert.equal(fabTierMeets(OPERATOR, "SUPERVISOR"), false, "which the cutter does not clear");
  assert.equal(fabTierMeets(INCHARGE, "SUPERVISOR"), true);

  // TWO WRITES, AND ONLY ONE OF THEM NAMES THE MONEY. The floor's statement
  // must not mention the price columns at all — not even to NULL them, which
  // would drop a rate the supervisor had already agreed on those pieces and
  // send them back to the rate card.
  const write = /const n = mayPrice\s*\?\s*await prisma\.\$executeRaw`([\s\S]*?)`\s*:\s*await prisma\.\$executeRaw`([\s\S]*?)`;/
    .exec(HAND);
  assert.ok(write, "the send-to-hand write changed shape — check the split still exists, then update this test");
  const [, pricedWrite, floorWrite] = write!;
  for (const col of PRICE_COLUMNS) {
    assert.ok(pricedWrite.includes(col), `a supervisor's send must still store ${col}`);
    assert.ok(!floorWrite.includes(col), `a floor login's send must not write ${col}`);
  }
  // What he DOES write: the flag and the faces, which is the whole act.
  assert.ok(/polish_by_hand\s*=\s*true/.test(floorWrite));
  for (const col of ["hand_edges_top", "hand_edges_bottom", "hand_edges_side"]) {
    assert.ok(floorWrite.includes(col), `the cutter chooses the faces — ${col} is his`);
  }
  // Packed and rejected pieces are out of reach on both paths: one is charged
  // and closed, the other is not work anybody is doing.
  for (const half of [pricedWrite, floorWrite]) {
    assert.ok(half.includes("status NOT IN ('PACKAGED','REJECTED')"));
  }
  // And the reply says which happened, so the screen can tell him his figure
  // was not stored rather than closing on a price he believes was agreed.
  assert.ok(HAND.includes("priceAccepted"), "the reply must say whose figure was stored");
});

test("SLAB ASSIGNMENT: PLACING A ROW IS HIS, REPRICING IT IS NOT", () => {
  // Same ladder, same comparison, passed into assign() as `mayReprice` — the
  // gate itself stays EMPLOYEE, because picking a slab and cutting is the whole
  // point of the widening.
  assert.ok(/export async function POST[\s\S]*?fabGate\("EMPLOYEE"\)/.test(SLAB_ASSIGN),
    "the cutter must still be able to put rows on a slab");
  assert.ok(SLAB_ASSIGN.includes('assign(body, TIER_RANK[g.tier as FabTier] >= TIER_RANK.SUPERVISOR)'),
    "the reprice test must be the same >= SUPERVISOR comparison fabGate makes");

  // The guard runs INSIDE the transaction, before anything is written, and only
  // bites when the row already has a thickness to be repriced away from AND the
  // incoming slab has one to compare. A slab whose thickness nobody recorded is
  // an unknown, not a mismatch: the row is priced from the MAXIMUM thickness
  // allocated and a null never wins that, so refusing it would have blocked an
  // ordinary allocation over a field left blank at intake.
  assert.ok(
    /if \(!mayReprice && rowThickness !== null && slab\.thickness != null && !pricesTheSame\(slab\.thickness, rowThickness\)\)/
      .test(SLAB_ASSIGN),
    "the thickness guard changed shape — check it still refuses, then update this test");
  assert.ok(SLAB_ASSIGN.indexOf("kind: \"thickness\"") < SLAB_ASSIGN.indexOf("fabRequirementAllocation.create"),
    "the refusal must come before the allocation is written");

  // WHY IT IS A PRICE AND NOT A MEASUREMENT — the fact the guard rests on, from
  // the rate card itself. 2 cm and 3 cm stone are different money on both jobs;
  // a gauge reading 19.8 for 2 cm stone is not.
  assert.notEqual(rateFor(20)!.sinkPerPiece, rateFor(30)!.sinkPerPiece);
  assert.notEqual(rateFor(20)!.edgePerFoot, rateFor(30)!.edgePerFoot);
  assert.equal(rateFor(19.8)!.nominalMm, rateFor(20)!.nominalMm, "the same stone, read by a gauge");
  assert.equal(rateFor(35), null, "off the card entirely — a row on it cannot be priced at all");
});
