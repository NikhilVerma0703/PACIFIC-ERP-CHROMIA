import { test } from "node:test";
import assert from "node:assert/strict";
import {
  offcutRemaining, decideOffcutTake, takeAreaSqft, oneTakeSqft,
} from "../src/lib/sampling/slabOffcut.ts";

// TAKING SAMPLES OUT OF A SLAB'S OFFCUT, UNTIL IT EMPTIES.
//
// The owner: "not all the wastage to samples — only wastage taken to samples by
// the sample guy. He should see slab wastage on used slab, then he can click the
// slab and enter the size and quantity, then take from that until it empties."
//
// The rule these tests hold: a slab can never give more stone than it has, and
// what is CREDITED as sampled is only what was actually taken — the rest stays
// wastage. The draw-down did not exist before this module: the intake route
// checked that the source slab existed and wrote whatever quantity it was given.

/** A standard slab, 137 x 79 in = 75.16 sqft, with 60 sqft on the order. */
const SLAB = { slabAreaSqft: 75.16, usedAreaSqft: 60, sampledAreaSqft: 0 };

test("what is left is the slab minus the order minus what was ALREADY taken", () => {
  assert.deepEqual(offcutRemaining(SLAB).availableSqft, 15.16);

  // Take 5 sqft and the remaining figure moves by exactly that — not by the
  // whole wastage, which is the distinction the owner is drawing.
  const after = offcutRemaining({ ...SLAB, sampledAreaSqft: 5 });
  assert.equal(after.availableSqft, 10.16);
  assert.equal(after.empty, false);
});

test("a 12 x 12 take is 1 sqft a piece, and the arithmetic is the slab's own", () => {
  assert.equal(oneTakeSqft(12, 12, 1), 1);
  assert.equal(oneTakeSqft(12, 12, 10), 10);
  // 8 x 6 in = 0.333 sqft; six of them is 2 sqft.
  assert.equal(takeAreaSqft([{ lengthIn: 8, widthIn: 6, quantity: 6 }]), 2);
});

test("A TAKE THAT FITS IS ALLOWED, and says what is left afterwards", () => {
  const d = decideOffcutTake(SLAB, [{ lengthIn: 12, widthIn: 12, quantity: 10 }]);
  assert.equal(d.ok, true);
  assert.equal(d.takeSqft, 10);
  assert.equal(d.availableSqft, 15.16);
  assert.equal(d.remainingAfterSqft, 5.16);
  assert.equal(d.error, null);
});

test("A TAKE THAT EMPTIES THE SLAB EXACTLY IS ALLOWED — that is the point", () => {
  // Refusing this would leave a sliver nobody can ever book.
  const state = { slabAreaSqft: 75.16, usedAreaSqft: 60, sampledAreaSqft: 5.16 };
  const d = decideOffcutTake(state, [{ lengthIn: 12, widthIn: 12, quantity: 10 }]);
  assert.equal(d.ok, true);
  assert.equal(d.remainingAfterSqft, 0);
  assert.equal(offcutRemaining({ ...state, sampledAreaSqft: 15.16 }).empty, true);
});

test("THE BUG THIS CLOSES: 40 pieces booked against 15 sqft of offcut", () => {
  // What /api/sampling/intake used to accept. 40 x (12 x 12) is 40 sqft on a
  // slab with 15.16 left — the stone was reported consumed twice over.
  const d = decideOffcutTake(SLAB, [{ lengthIn: 12, widthIn: 12, quantity: 40 }]);
  assert.equal(d.ok, false);
  assert.equal(d.reason, "TOO_LARGE");
  assert.match(d.error ?? "", /24\.84 sqft too much/);
  assert.match(d.error ?? "", /only 15\.16 sqft is left/);
});

test("an empty slab gives nothing, and says so as a different refusal", () => {
  const spent = { slabAreaSqft: 75.16, usedAreaSqft: 75.16, sampledAreaSqft: 0 };
  const d = decideOffcutTake(spent, [{ lengthIn: 12, widthIn: 12, quantity: 1 }]);
  assert.equal(d.ok, false);
  assert.equal(d.reason, "EMPTY");
  assert.equal(offcutRemaining(spent).availableSqft, 0);
});

test("AN OVER-COMMITTED SLAB IS FLOORED AT ZERO, never shown as a credit", () => {
  const over = { slabAreaSqft: 75.16, usedAreaSqft: 80, sampledAreaSqft: 0 };
  const r = offcutRemaining(over);
  assert.equal(r.availableSqft, 0, "a negative available figure reads as a credit");
  assert.equal(r.overCommitted, true);
  assert.equal(r.empty, true);

  const d = decideOffcutTake(over, [{ lengthIn: 12, widthIn: 12, quantity: 1 }]);
  assert.equal(d.ok, false);
  assert.equal(d.reason, "OVER_COMMITTED", "named apart from EMPTY — a different person fixes it");
});

test("a slab with no size recorded refuses rather than inventing an area", () => {
  const d = decideOffcutTake(
    { slabAreaSqft: 0, usedAreaSqft: 0, sampledAreaSqft: 0 },
    [{ lengthIn: 12, widthIn: 12, quantity: 1 }],
  );
  assert.equal(d.ok, false);
  assert.equal(d.reason, "NO_SLAB_AREA");
  assert.equal(offcutRemaining({ slabAreaSqft: 0, usedAreaSqft: 0, sampledAreaSqft: 0 }).availablePct, null,
    "no denominator means null, not 0%");
});

test("nothing typed is not a take", () => {
  for (const t of [
    [{ lengthIn: 12, widthIn: 12, quantity: 0 }],
    [{ lengthIn: 0, widthIn: 12, quantity: 5 }],
    [],
  ]) {
    const d = decideOffcutTake(SLAB, t);
    assert.equal(d.ok, false);
    assert.equal(d.reason, "NOTHING_TAKEN");
  }
});

test("TAKING REPEATEDLY DRAWS THE SLAB DOWN TO EMPTY AND NO FURTHER", () => {
  // "Take from that until it empties." Four 1-sqft takes off 3.5 sqft: three
  // land, the fourth is refused, and the slab is left with 0.5 sqft that is
  // wastage and stays wastage.
  let sampled = 0;
  const slab = { slabAreaSqft: 75.16, usedAreaSqft: 71.66 };
  const results: boolean[] = [];
  for (let i = 0; i < 4; i += 1) {
    const d = decideOffcutTake({ ...slab, sampledAreaSqft: sampled },
      [{ lengthIn: 12, widthIn: 12, quantity: 1 }]);
    results.push(d.ok);
    if (d.ok) sampled = Math.round((sampled + d.takeSqft) * 100) / 100;
  }
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(sampled, 3, "three square feet taken");
  assert.equal(offcutRemaining({ ...slab, sampledAreaSqft: sampled }).availableSqft, 0.5,
    "and half a foot left as wastage — NOT credited to samples");
});

test("AREA IS A CEILING, NOT A PROMISE — and the refusal never lies the other way", () => {
  // 3 sqft left, and a 12 x 12 wants 1 sqft. Area says yes. Whether a 2-inch
  // strip actually yields a 12-inch square is a human judgement at the stone,
  // and this module deliberately does not pretend to know.
  const d = decideOffcutTake(
    { slabAreaSqft: 75.16, usedAreaSqft: 72.16, sampledAreaSqft: 0 },
    [{ lengthIn: 12, widthIn: 12, quantity: 1 }],
  );
  assert.equal(d.ok, true);
  // What it guarantees is the direction that costs money: it can never approve
  // a take the slab cannot possibly hold.
  const tooBig = decideOffcutTake(
    { slabAreaSqft: 75.16, usedAreaSqft: 72.16, sampledAreaSqft: 0 },
    [{ lengthIn: 24, widthIn: 24, quantity: 1 }],
  );
  assert.equal(tooBig.ok, false);
});

/* -- AND THE TWO SCREENS MUST AGREE ABOUT A SLAB --------------------------- */

test("A SAMPLE TAKE IS CONSUMED ON BOTH BOARDS, not waste on one of them", async () => {
  const { computeSlabLoss } = await import("../src/lib/fab/slabLoss.ts");
  const { groupByProject } = await import("../src/lib/fab/ceoOverview.ts");

  // One slab: 137 x 79 in, 60 sqft on the order, 4 sqft taken as samples.
  const SQ_MM_PER_SQ_FT = 25.4 * 25.4 * 144;
  const slabAreaMm2 = 137 * 25.4 * (79 * 25.4);
  const piecesAreaMm2 = 60 * SQ_MM_PER_SQ_FT;

  // The supervisor's board — computeSlabLoss has always subtracted samples.
  const loss = computeSlabLoss({
    slabLengthMm: 137 * 25.4,
    slabWidthMm: 79 * 25.4,
    pieces: [{ lengthIn: 60, widthIn: 12, quantity: 12 }],   // 60 sqft
    sampledAreaSqft: 4,
  });

  // The CEO board — groupByProject, which did NOT until this change.
  const [project] = groupByProject([{
    slabId: "s1", slabCode: "146838", pacificQcId: "q1", projectCode: "PI1200",
    wastePct: 0, pieceCount: 12,
    slabAreaMm2, piecesAreaMm2,
    sampledAreaSqft: 4,
    qualityGrade: null, slabMark: null, gradeBeforeCts: null, design: null,
  }]);
  const ceo = project.slabs[0];

  assert.equal(ceo.sampledSqft, 4, "the CEO board knows 4 sqft was recovered");
  // THE INVARIANT: the same stone is not waste on one screen and consumed on
  // the other. Within a rounding step of each other on identical inputs.
  assert.ok(
    Math.abs(loss.remainingAreaSqft - ceo.wasteSqft) < 0.05,
    `supervisor says ${loss.remainingAreaSqft} sqft waste, CEO says ${ceo.wasteSqft}`,
  );
  // And it is only the TAKEN part that is credited — the rest is still waste.
  assert.ok(ceo.wasteSqft > 0, "the untaken offcut stays wastage");
});

test("NO SAMPLE TAKE-OFF LEAVES EVERY FIGURE EXACTLY WHERE IT WAS", async () => {
  const { groupByProject } = await import("../src/lib/fab/ceoOverview.ts");
  const SQ_MM_PER_SQ_FT = 25.4 * 25.4 * 144;
  const base = {
    slabId: "s1", slabCode: "146815", pacificQcId: "q1", projectCode: "PI1200",
    wastePct: 0, pieceCount: 10,
    slabAreaMm2: 137 * 25.4 * (79 * 25.4),
    piecesAreaMm2: 60 * SQ_MM_PER_SQ_FT,
    qualityGrade: null, slabMark: null, gradeBeforeCts: null, design: null,
  };
  // Absent, null and zero must all read the same as before the field existed —
  // which is every slab in the database until somebody cuts a sample.
  const a = groupByProject([{ ...base }])[0].slabs[0];
  const b = groupByProject([{ ...base, sampledAreaSqft: null }])[0].slabs[0];
  const c = groupByProject([{ ...base, sampledAreaSqft: 0 }])[0].slabs[0];
  assert.equal(a.wasteSqft, b.wasteSqft);
  assert.equal(b.wasteSqft, c.wasteSqft);
  assert.equal(a.sampledSqft, 0);
  assert.equal(a.wastePct, b.wastePct);
});
