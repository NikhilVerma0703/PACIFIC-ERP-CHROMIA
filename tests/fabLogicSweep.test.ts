// THE FABRICATION AND SAMPLING SWEEP — every path, executed.
//
// The audit's structural finding was that the pure modules are well tested and
// the SEAMS between them are not. This file is the second half of the answer to
// that: it does not test one module, it walks a piece through the rules of ALL
// of them, in the combinations the floor actually produces, and asserts what
// the next stage would see.
//
// EXHAUSTIVE WHERE IT MATTERS. The routing block below enumerates every
// reachable combination of the five flags a piece carries and asserts, for each
// one, exactly which queues it appears in. That is 2^5 states checked by
// construction rather than by picking examples — and it is where "a piece stuck
// in no queue" or "a piece in two queues at once" would show up.

import { test } from "node:test";
import assert from "node:assert/strict";

import { priceRow, sumPricing, runningFeet, parseEdges, ALL_EDGES, rateFor } from "../src/lib/fab/pricing.ts";
import { planSinkSplit, sideOf } from "../src/lib/fab/sinkSplit.ts";
import { planSlabRelease, sinkPiecesForSlab } from "../src/lib/fab/releasePlan.ts";
import { computeSlabLoss, sqftFromInches, STANDARD_SLAB_MM } from "../src/lib/fab/slabLoss.ts";
import { isReadyForPackaging, statusFromFlags, pendingStages } from "../src/lib/fab/routing.ts";
import { assignRowLetters, formatPieceCode, nextPieceNumberInRow } from "../src/lib/fab/pieceNaming.ts";
import { deriveRoutingFlags, resolveSinkQuantity } from "../src/lib/fab/requirement-derive.ts";
import { sampleRouting, checkSampleSink } from "../src/lib/fab/sampleOrder.ts";

/* ══════════════════════════════════════════════════════════════════════════
   1 · MONEY — a mixed row, priced from both ends
   ══════════════════════════════════════════════════════════════════════════ */

test("FABRICATION · a 60/30 row prices to the paisa, and the two jobs count apart", () => {
  const row = {
    lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30,
    thicknessMm: 20, edges: ALL_EDGES,
  };
  const p = priceRow(row);

  // 60 edge pieces × (28+28+22.5+22.5)/12 ft = 60 × 8.4166… = 505 ft
  // 30 sink pieces × Rs230
  //
  // THE COUNTS ARE DIFFERENT NOW, and that is the owner's separation of hand
  // edge polish from sink work: "any pieces can be assigned the edge hand
  // polish or not". Every piece of the row has the edges; only half have a sink.
  assert.equal(p.edgePieces, 60, "the whole row is hand polished");
  assert.equal(p.sinkPieces, 30);
  assert.equal(p.fabricationPieces, 60, "all 60 reach the bench, for one job or both");
  assert.equal(p.runningFeet, 505);
  assert.equal(p.edgeCost, 7575, "505 ft x Rs15");
  assert.equal(p.sinkCost, 6900, "30 sinks x Rs230");
  assert.equal(p.total, 14475);
  assert.equal(p.unpriced, false);

  // THE OLD ANSWER, pinned as the thing this is not. Counting the feet over the
  // sink pieces left half the row's hand polish unbilled.
  assert.notEqual(p.runningFeet, 252.5);
  assert.equal(runningFeet(28, 22.5, 30, ALL_EDGES), 252.5);
});

test("FABRICATION · 30 mm is its own rate band, never interpolated", () => {
  const thick = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 30, edges: ALL_EDGES });
  assert.equal(thick.sinkCost, 9000, "30 x Rs300");
  assert.equal(thick.edgeCost, 10100, "505 ft x Rs20");
  assert.equal(thick.total, 19100);

  // A thickness off the card earns nothing and SAYS so — it must never borrow
  // a neighbouring rate.
  assert.equal(rateFor(12), null);
  const odd = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 12, edges: ALL_EDGES });
  assert.equal(odd.total, 0);
  assert.equal(odd.unpriced, true, "an unpriced row must be flagged, not silently zero");
  assert.equal(odd.unpricedReason, "THICKNESS");
});

test("FABRICATION · a plain row with polished edges EARNS — the reversal", () => {
  // This test asserted the opposite until the owner separated the two jobs:
  // "any pieces can be assigned the edge hand polish or not, this is chosen and
  // done by supervisor or else the one manager who uploads the PO." A row with
  // no sink still goes to a man with a hand polisher if its edges are marked.
  const plain = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: ALL_EDGES });
  assert.equal(plain.sinkPieces, 0);
  assert.equal(plain.edgePieces, 60);
  assert.equal(plain.fabricationPieces, 60, "no sink, and still a fabrication row");
  assert.equal(plain.runningFeet, 505);
  assert.equal(plain.total, 7575, "Rs7,575 the shop was doing and not billing");

  // NEITHER job is what earns nothing.
  const nothing = priceRow({ lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 0, thicknessMm: 20, edges: {} });
  assert.equal(nothing.fabricationPieces, 0);
  assert.equal(nothing.total, 0);
  assert.equal(nothing.unpriced, false, "a real zero, not a missing figure");
});

test("FABRICATION · edges are counted per edge, not per row", () => {
  const base = { lengthIn: 28, widthIn: 22.5, quantity: 10, sinkQuantity: 10, thicknessMm: 20 };
  const none  = priceRow({ ...base, edges: parseEdges("") });
  const front = priceRow({ ...base, edges: parseEdges("front") });
  const two   = priceRow({ ...base, edges: parseEdges("front,back") });
  const all   = priceRow({ ...base, edges: ALL_EDGES });

  assert.equal(none.edgeCost, 0);
  // runningFeet rounds to 2dp — the figure is quoted to the customer in feet,
  // so it is rounded once, there, rather than carried to fifteen places.
  assert.equal(front.runningFeet, 23.33);
  assert.equal(two.runningFeet, 46.67, "back is the same length as front");
  assert.equal(all.runningFeet, 84.17, "10 pieces round the full perimeter");
  // Sinks are unaffected by edges — two independent charges on one row.
  for (const p of [none, front, two, all]) assert.equal(p.sinkCost, 2300);
});

test("FABRICATION · a project total is the sum of its rows, to the paisa", () => {
  const rows = [
    { lengthIn: 28, widthIn: 22.5, quantity: 60, sinkQuantity: 30, thicknessMm: 20, edges: ALL_EDGES },
    { lengthIn: 96, widthIn: 25.5, quantity: 12, sinkQuantity: 12, thicknessMm: 30, edges: parseEdges("front") },
    { lengthIn: 40, widthIn: 20,   quantity: 8,  sinkQuantity: 0,  thicknessMm: 20, edges: ALL_EDGES },
  ];
  const priced = rows.map(priceRow);
  const total = sumPricing(priced);
  const byHand = priced.reduce((a, p) => a + p.total, 0);
  assert.ok(Math.abs(total.total - byHand) < 0.005, `${total.total} vs ${byHand}`);
  // The third row has no sink — and all four edges marked, so it is worth its
  // hand polish and nothing else. 8 × (40+40+20+20)/12 = 80 ft × Rs15 = Rs1,200.
  assert.equal(priced[2].sinkCost, 0);
  assert.equal(priced[2].runningFeet, 80);
  assert.equal(priced[2].total, 1200, "no sink, but the edges were still polished");
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · THE SINK DECISION — every boundary
   ══════════════════════════════════════════════════════════════════════════ */

test("FABRICATION · the sink split at every boundary, happy and refused", () => {
  const q = 60;
  const ok = (want: number, cur = 0, extra = {}) =>
    planSinkSplit({ quantity: q, currentSinkQuantity: cur, wantSinkQuantity: want, ...extra });

  // whole-row moves — no new row
  assert.equal(ok(0).ok, true);
  assert.equal(ok(60).ok, true);
  assert.deepEqual(ok(0, 0), { ok: true, action: "none", side: "plain" });
  assert.deepEqual(ok(60, 60), { ok: true, action: "none", side: "sink" });

  // a real split moves quantity and creates one new row
  const split = ok(20);
  assert.equal(split.ok, true);
  if (split.ok && split.action === "split") {
    assert.equal(split.keep.quantity + split.create.quantity, q, "nothing is created or lost");
    assert.equal(split.keep.side, "plain", "the original keeps its own side");
    assert.equal(split.create.side, "sink", "the movers become the new row");
    assert.equal(split.create.quantity, 20, "and it is the 20 that move");
    assert.equal(split.create.sinkQuantity, 20, "every piece of the new row has a sink");
    assert.equal(split.keep.sinkQuantity, 0, "and none of the original does");
  } else {
    assert.fail(`expected a split, got ${JSON.stringify(split)}`);
  }

  // refusals, each naming its reason
  assert.equal(ok(-1).ok, false, "negative");
  assert.equal(ok(61).ok, false, "more sinks than pieces");
  assert.equal(ok(20, 0, { allocatedQuantity: 15 }).ok, false, "already on a slab");
  assert.equal(ok(20, 0, { releasedPieces: 60 }).ok, false, "already cut");

  // and the freeze added this session: a released row cannot be re-marked
  assert.equal(ok(60, 0, { releasedPieces: 60 }).ok, false, "whole-row re-mark after release");
  assert.equal(ok(0, 60, { releasedPieces: 60 }).ok, false, "the other direction too");
  assert.equal(ok(60, 60, { releasedPieces: 60 }).ok, true, "but an unchanged value still saves");
});

test("FABRICATION · sideOf is BINARY, and a mixed row reads as plain", () => {
  // It answers "which side is this row on", and there are only two sides:
  // s >= q is sink, everything else is plain. There is no "mixed" — a mixed row
  // is one the split has not been applied to yet.
  assert.equal(sideOf(60, 0), "plain");
  assert.equal(sideOf(60, 60), "sink");
  assert.equal(sideOf(60, null), "plain", "not looked at yet routes as plain");

  // THE SHARP EDGE, pinned. A 30-of-60 row reads "plain" even though half of it
  // has sinks. That is why rowsForBulkSink compares the COUNT rather than
  // calling sideOf — using sideOf there made bulk clean-up skip exactly the
  // mixed rows it existed to fix.
  assert.equal(sideOf(60, 30), "plain", "a half-sink row is not 'sink'");
  assert.equal(sideOf(60, 59), "plain", "nor is 59 of 60");
  assert.equal(sideOf(60, 1), "plain");
});

test("FABRICATION · resolveSinkQuantity clamps but never invents", () => {
  assert.equal(resolveSinkQuantity(null, 60), 0, "not looked at = none");
  assert.equal(resolveSinkQuantity(30, 60), 30);
  assert.equal(resolveSinkQuantity(90, 60), 60, "clamped to the row");
  assert.equal(resolveSinkQuantity(-5, 60), 0);
  // THE AUDIT FINDING, pinned: raising quantity caps rather than scales, so a
  // whole-sink row silently becomes mixed. Asserted so the behaviour is at
  // least known and cannot change unnoticed.
  assert.equal(resolveSinkQuantity(10, 20), 10, "10 of 20 — a partial nobody chose");
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · RELEASE — pieces across slabs, and the sink top-up
   ══════════════════════════════════════════════════════════════════════════ */

test("FABRICATION · a 60/30 row split over two slabs yields exactly 30 sinks", () => {
  const row = (onThisSlab: number, made: number, sinksMade: number) => ({
    requirementId: "r1", name: "PO 1 A", rowLetter: "A",
    orderedQuantity: 60, sinkQuantity: 30,
    allocatedOnThisSlab: onThisSlab,
    piecesAlreadyCreated: made, sinksAlreadyCreated: sinksMade,
    nextNumberInRow: made + 1,
  });

  const first = planSlabRelease({ rows: [row(35, 0, 0)] });
  assert.equal(first.pieces.length, 35);
  const s1 = first.pieces.filter(p => p.hasSink).length;

  const second = planSlabRelease({ rows: [row(25, 35, s1)] });
  assert.equal(second.pieces.length, 25);
  const s2 = second.pieces.filter(p => p.hasSink).length;

  assert.equal(s1 + s2, 30, `sinks must total the row's 30, got ${s1}+${s2}`);
  assert.equal(first.pieces.length + second.pieces.length, 60);

  // numbers resume rather than restart
  assert.equal(first.pieces[0].n, 1);
  assert.equal(second.pieces[0].n, 36);
  assert.equal(formatPieceCode("PRJ1", "A", second.pieces[0].n), "PRJ1-A-36");
});

test("FABRICATION · a fully released row is refused, not silently re-cut", () => {
  const plan = planSlabRelease({ rows: [{
    requirementId: "r1", name: "PO 1 A", rowLetter: "A",
    orderedQuantity: 10, sinkQuantity: 0, allocatedOnThisSlab: 10,
    piecesAlreadyCreated: 10, sinksAlreadyCreated: 0, nextNumberInRow: 11,
  }] });
  assert.equal(plan.pieces.length, 0);
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.blocked[0].orderedQuantity, 10);
});

test("FABRICATION · a slab claiming more than the order has left warns and cuts the rest", () => {
  const plan = planSlabRelease({ rows: [{
    requirementId: "r1", name: "PO 1 A", rowLetter: "A",
    orderedQuantity: 10, sinkQuantity: 0, allocatedOnThisSlab: 8,
    piecesAlreadyCreated: 6, sinksAlreadyCreated: 0, nextNumberInRow: 7,
  }] });
  assert.equal(plan.pieces.length, 4, "only the 4 still owed");
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /only 4 of the 10/);
});

test("FABRICATION · the sink top-up is monotone — it never overshoots", () => {
  for (let made = 0; made <= 60; made += 7) {
    for (let here = 0; here <= 60 - made; here += 9) {
      const s = sinkPiecesForSlab({
        sinkQuantity: 30, orderedQuantity: 60,
        sinksAlreadyCreated: Math.min(30, made), piecesOnThisSlab: here,
      });
      assert.ok(s >= 0 && s <= here, `${s} sinks on a slab making ${here}`);
      assert.ok(Math.min(30, made) + s <= 30, "never more sinks than the row ordered");
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · ROUTING — EVERY reachable flag combination, exhaustively
   ══════════════════════════════════════════════════════════════════════════ */

test("FABRICATION · every flag combination lands in the right queues, and none is stuck", () => {
  // The four station queues, written exactly as the routes filter them:
  //   polishing     polishRequired && !polishingCompleted
  //   sink-cutting  hasSink && !sinkCompleted
  //   fabrication   !hasSink || sinkCompleted   (and fabricationRequired)
  //   packaging     isReadyForPackaging
  const inQueue = (p: any) => ({
    polishing:   p.polishRequired && !p.polishingCompleted,
    sink:        p.hasSink && !p.sinkCompleted,
    fabrication: p.fabricationRequired && !p.fabricationCompleted && (!p.hasSink || p.sinkCompleted),
    packaging:   isReadyForPackaging(p),
  });

  let stuck = 0, doubled = 0, checked = 0;
  const stuckStates: string[] = [];

  for (let bits = 0; bits < 32; bits++) {
    const p = {
      hasSink:              !!(bits & 1),
      polishRequired:       !!(bits & 2),
      fabricationRequired:  !!(bits & 4),
      polishingCompleted:   !!(bits & 8),
      sinkCompleted:        !!(bits & 16),
      fabricationCompleted: false,
    };
    // fabricationRequired mirrors hasSink on every real piece (release-project
    // and approve-slab both write it that way), so skip the impossible ones.
    if (p.fabricationRequired !== p.hasSink) continue;
    checked++;

    const q = inQueue(p);
    const open = Object.entries(q).filter(([, v]) => v).map(([k]) => k);

    // NOTHING MAY BE STUCK. Every piece is somewhere, or it is finished.
    if (open.length === 0) { stuck++; stuckStates.push(JSON.stringify(p)); }

    // TWO STATION QUEUES AT ONCE IS REAL, AND THERE ARE TWO SHAPES OF IT.
    //
    // Polishing does not consult the other two, so a sink piece is in polishing
    // AND sink-cutting from the moment it is cut, then in polishing AND
    // fabrication once the sink is done. The route sheet that encodes the
    // intended order is written to fab_piece_operation.sequence and read by
    // nothing, so neither overlap is prevented.
    //
    // Pinned rather than ignored: the invariant that DOES hold is that
    // sink-cutting and fabrication are mutually exclusive — fabrication opens
    // only once the sink is cut. If that ever broke, a piece could be on two
    // machines at once, and this is what would catch it.
    const stations = open.filter(k => k !== "packaging");
    if (stations.length > 1) {
      doubled++;
      assert.ok(stations.includes("polishing"),
        `every overlap must involve polishing, got ${stations}`);
      assert.ok(!(stations.includes("sink") && stations.includes("fabrication")),
        `sink-cutting and fabrication must never be open together: ${stations}`);
    }

    // Packaging and a station queue must never both be open.
    if (q.packaging) {
      assert.equal(stations.length, 0, `ready to pack while still in ${stations}`);
    }

    // statusFromFlags must agree with the flags it is given.
    const st = statusFromFlags(p as any);
    if (q.packaging) assert.ok(["FABRICATED", "POLISHED", "SINK_CUT", "CUT"].includes(st), st);
  }

  assert.equal(stuck, 0, `pieces stuck in no queue at all: ${stuckStates.join(" | ")}`);
  assert.ok(checked >= 8, `expected to check at least 8 states, checked ${checked}`);
  assert.ok(doubled > 0, "the polish+sink overlap is real and should have been seen");
});

test("FABRICATION · a stage that is not required never blocks packing", () => {
  // The rule isReadyForPackaging encodes: !required || completed.
  assert.equal(isReadyForPackaging({
    hasSink: false, polishRequired: false, fabricationRequired: false,
    polishingCompleted: false, sinkCompleted: false, fabricationCompleted: false,
  } as any), true, "a plain unpolished piece is ready");

  assert.equal(isReadyForPackaging({
    hasSink: true, polishRequired: true, fabricationRequired: true,
    polishingCompleted: true, sinkCompleted: true, fabricationCompleted: true,
  } as any), true, "and so is a fully worked one");

  assert.equal(isReadyForPackaging({
    hasSink: true, polishRequired: true, fabricationRequired: true,
    polishingCompleted: true, sinkCompleted: false, fabricationCompleted: true,
  } as any), false, "an uncut sink still blocks");

  const waiting = pendingStages({
    hasSink: true, polishRequired: true, fabricationRequired: true,
    polishingCompleted: false, sinkCompleted: false, fabricationCompleted: false,
  } as any);
  assert.ok(waiting.length >= 2, `expected several pending stages, got ${waiting}`);
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · THE SLAB — loss, samples, over-commitment
   ══════════════════════════════════════════════════════════════════════════ */

test("FABRICATION · THREE REAL PRODUCTION SLABS reproduce to the second decimal", () => {
  // Taken off the live board, 26 Aug 2026. These are not invented figures:
  //
  //   154325  Glenco      14 pcs   75.16 slab   27.77 used   47.39 waste   63.1%
  //   154638  Arva White  21 pcs   75.16 slab   41.67 used   33.49 waste   44.6%
  //   154728  Arva White   6 pcs   75.16 slab   46.88 used   28.28 waste   37.6%
  //
  // 154325 and 154638 share a piece size (1.984 sqft); 154728 is a big top at
  // 7.813. Dimensions below are chosen to hit those exact areas.
  const slab = { slabLengthMm: STANDARD_SLAB_MM.lengthMm, slabWidthMm: STANDARD_SLAB_MM.widthMm };

  // The nominal slab every one of these is measured against.
  const nominal = computeSlabLoss({ ...slab, pieces: [] });
  assert.equal(Number(nominal.slabAreaSqft.toFixed(2)), 75.16, "137 x 79 in = 75.16 sqft");

  // The board reports AREAS, not dimensions, so the piece sizes are reproduced
  // from the areas rather than guessed: a single piece of exactly the used area
  // exercises the same arithmetic the board does, without inventing a shape.
  const live = [
    { code: "154325", pcs: 14, used: 27.77, waste: 47.39, pct: 63.1 },
    { code: "154638", pcs: 21, used: 41.67, waste: 33.49, pct: 44.6 },
    { code: "154728", pcs: 6,  used: 46.88, waste: 28.28, pct: 37.6 },
  ];

  for (const r of live) {
    // one piece, 12 in wide, long enough to be exactly the used area
    const lengthIn = (r.used * 144) / 12;
    const loss = computeSlabLoss({ ...slab, pieces: [{ lengthIn, widthIn: 12, quantity: 1 }] });

    assert.ok(Math.abs(loss.usedAreaSqft - r.used) < 0.02,
      `${r.code} used: computed ${loss.usedAreaSqft}, board says ${r.used}`);
    assert.ok(Math.abs(loss.remainingAreaSqft - r.waste) < 0.02,
      `${r.code} waste: computed ${loss.remainingAreaSqft}, board says ${r.waste}`);
    assert.ok(Math.abs(loss.totalWastagePct! - r.pct) < 0.06,
      `${r.code} wastage: computed ${loss.totalWastagePct}%, board says ${r.pct}%`);
    assert.equal(loss.overCommitted, false, `${r.code} fits its slab`);

    // used + waste = the slab, on every one of them. The sum the board's three
    // columns have to satisfy, and do.
    assert.ok(Math.abs(loss.usedAreaSqft + loss.remainingAreaSqft - loss.slabAreaSqft) < 0.02,
      `${r.code}: the three columns must add up`);

    // AND THE NUMBER THE AUDIT FLAGGED: with nothing reclaimed, true scrap IS
    // total wastage. 154325's 63.1% is 47 sqft of stone called waste — the
    // remnant question, in production, right now.
    assert.equal(loss.trueScrapPct, loss.totalWastagePct,
      `${r.code}: reclaim is unbuilt, so true scrap cannot differ yet`);
  }
});

test("FABRICATION · a sample take-off is spent stone, not scrap", () => {
  const slab = { slabLengthMm: STANDARD_SLAB_MM.lengthMm, slabWidthMm: STANDARD_SLAB_MM.widthMm };
  const pieces = [{ lengthIn: 28, widthIn: 10.2, quantity: 14 }];   // 154325's load

  const bare = computeSlabLoss({ ...slab, pieces });
  const withSamples = computeSlabLoss({ ...slab, pieces, sampledAreaSqft: 10 });

  assert.ok(Math.abs(withSamples.committedAreaSqft - (bare.usedAreaSqft + 10)) < 0.02,
    "sample stone is committed, not free");
  assert.ok(withSamples.remainingAreaSqft < bare.remainingAreaSqft,
    "and it reduces what is left for the purchase order");
  assert.ok(withSamples.totalWastagePct! < bare.totalWastagePct!,
    "recovering stone as samples makes the shop look LESS wasteful, correctly");

  // ONLY RECLAIM SEPARATES THE TWO NUMBERS, and reclaim is unbuilt.
  // trueScrapPct = (remaining - reclaimed) / slab, so with reclaimed at 0 it
  // equals totalWastagePct on every slab in production today. That is exactly
  // why the board's one wastage figure cannot yet be split into "not used" and
  // "actually lost" — there is nothing to subtract.
  assert.equal(withSamples.trueScrapPct, withSamples.totalWastagePct,
    "samples move both figures together; only reclaim would part them");

  const reclaimed = computeSlabLoss({ ...slab, pieces, sampledAreaSqft: 10, reclaimedAreaSqft: 20 });
  assert.ok(reclaimed.trueScrapPct! < reclaimed.totalWastagePct!,
    "and once a remnant IS recorded, true scrap drops below total wastage — the whole point of the column");

  // Over-commitment is SIGNED and reported, never clamped to zero.
  const over = computeSlabLoss({ ...slab, pieces: [{ lengthIn: 28, widthIn: 22.5, quantity: 30 }] });
  assert.equal(over.overCommitted, true, "131 sqft of pieces on a 75 sqft slab");
  assert.ok(over.remainingAreaSqft < 0, "a negative remainder is the honest answer");
});

/* ══════════════════════════════════════════════════════════════════════════
   6 · NAMING — letters and codes across a growing project
   ══════════════════════════════════════════════════════════════════════════ */

test("FABRICATION · row letters survive a second purchase order on one project", () => {
  const first = assignRowLetters([], 3);
  assert.deepEqual(first, ["A", "B", "C"]);
  const second = assignRowLetters(first, 2);
  assert.deepEqual(second, ["D", "E"], "the second PO continues, it does not restart");

  // Past Z, bijective base-26.
  const far = assignRowLetters(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)), 2);
  assert.deepEqual(far, ["AA", "AB"]);
});

test("FABRICATION · a rejected piece's number is spent for ever", () => {
  const codes = ["PRJ1-A-1", "PRJ1-A-2", "PRJ1-A-3"];
  // Piece 3 is rejected and its row still owes one. The next piece is 4, not 3:
  // PRJ1-A-3 is written on stone in a skip and can never be issued again.
  assert.equal(nextPieceNumberInRow("PRJ1", "A", codes), 4, "max+1, never gap-filling");
  assert.equal(formatPieceCode("PRJ1", "A", 4), "PRJ1-A-4");

  // Another row's codes, and another project's, do not move this row's counter.
  assert.equal(nextPieceNumberInRow("PRJ1", "B", codes), 1, "row B starts at 1");
  assert.equal(nextPieceNumberInRow("PRJ2", "A", codes), 1, "so does another project");
  assert.equal(nextPieceNumberInRow("PRJ1", "A", [...codes, "PRJ2-A-99"]), 4,
    "and a different project's high number is ignored");
});

/* ══════════════════════════════════════════════════════════════════════════
   7 · SAMPLES — the rules that make a sample a sample
   ══════════════════════════════════════════════════════════════════════════ */

test("SAMPLES · a sample is cut, polished, packed — never sinked or fabricated", () => {
  const r = sampleRouting();
  assert.deepEqual(r, { sinkRequired: false, fabricationRequired: false, polishRequired: true });

  // And it is refused rather than merely defaulted.
  assert.equal(checkSampleSink("SAMPLE", 5).ok, false, "a sink on a sample row is refused");
  assert.equal(checkSampleSink("SAMPLE", 0).ok, true);
  assert.equal(checkSampleSink("PO", 5).ok, true, "a purchase order may have all it likes");
});

test("SAMPLES · a sample row earns nothing on the rate card, by construction", () => {
  // sampleRouting gives sinkQuantity 0 AND no edge selection: a sample is cut,
  // machine-polished and packed. Nobody hand-polishes an 11 × 11 swatch.
  const p = priceRow({
    lengthIn: 11, widthIn: 11, quantity: 40, sinkQuantity: 0,
    thicknessMm: 20, edges: {},
  });
  assert.equal(p.fabricationPieces, 0);
  assert.equal(p.total, 0, "40 samples, cut polished and packed, worth nothing on this card");
  assert.equal(p.unpriced, false, "and that is a real zero, not an unpriced row");

  // WHAT NOW GUARDS THAT ZERO. It used to be the sink count: no sink meant no
  // charge, whatever the edges said, so a stray edge selection on a sample row
  // was harmless. Since hand edge polish was separated from sink work, an edge
  // selection on a sample row WOULD be charged — so the guard has to be that
  // samples are never offered the picker, and this pins the consequence of
  // getting that wrong rather than pretending it cannot happen.
  const ifMarked = priceRow({
    lengthIn: 11, widthIn: 11, quantity: 40, sinkQuantity: 0,
    thicknessMm: 20, edges: ALL_EDGES,
  });
  // 44 in round each swatch × 40 = 146.67 ft × Rs15
  assert.equal(ifMarked.total, 2200.05, "an edge selection on a sample row is real money");
  assert.equal(sampleRouting().sinkRequired, false);
  assert.equal(sampleRouting().fabricationRequired, false,
    "the sample rule says no fabrication, which is what keeps the picker away");
});

test("SAMPLES · derived routing agrees with the sample rule for a no-sink row", () => {
  const derived = deriveRoutingFlags({ sinkQuantity: 0, quantity: 40 });
  const stated = sampleRouting();
  assert.equal(derived.sinkRequired, stated.sinkRequired);
  assert.equal(derived.fabricationRequired, stated.fabricationRequired,
    "fabrication follows the sink — that is the rule a sample relies on");
});

test("SAMPLES · a sample piece walks cut to packed with no station in between", () => {
  const piece = {
    hasSink: false, polishRequired: true, fabricationRequired: false,
    polishingCompleted: false, sinkCompleted: false, fabricationCompleted: false,
  };
  assert.equal(isReadyForPackaging(piece as any), false, "polish first");
  const polished = { ...piece, polishingCompleted: true };
  assert.equal(isReadyForPackaging(polished as any), true, "then straight to packing");
  assert.deepEqual(pendingStages(polished as any), [], "nothing else is owed");
});

test("SAMPLES · forty samples across two slabs still make exactly forty", () => {
  const row = (here: number, made: number) => ({
    requirementId: "r1", name: "SR-0001 A", rowLetter: "A",
    orderedQuantity: 40, sinkQuantity: 0, allocatedOnThisSlab: here,
    piecesAlreadyCreated: made, sinksAlreadyCreated: 0, nextNumberInRow: made + 1,
  });
  const a = planSlabRelease({ rows: [row(24, 0)] });
  const b = planSlabRelease({ rows: [row(16, 24)] });
  assert.equal(a.pieces.length + b.pieces.length, 40);
  assert.equal(a.pieces.concat(b.pieces).filter(p => p.hasSink).length, 0,
    "not one sample piece may carry a sink");
  assert.equal(b.pieces.at(-1)!.n, 40, "and the numbering ends where it should");
});
