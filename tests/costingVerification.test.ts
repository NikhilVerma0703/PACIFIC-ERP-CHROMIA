import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canVerifyCosts, canVerifyWeights, costsFingerprint, isBatchVerifier, isVerifySide,
  readableSides, signableSides, verifyMarks, verifyState, weightsFingerprint,
  weightsVerifiers,
  type PricedShape, type VerificationRow, type WeighedShape,
} from "../src/lib/costing/verification.ts";

// Two people sign a batch off — and since 2026-08-18 each of them signs BOTH
// halves, one mark per person. The rules that matter are the ones a browser
// cannot demonstrate: that a sign-off lapses when the numbers move, that one
// person's mark lapsing does not unsay the other's, that an unset env var
// locks the door rather than opening it, and that an admin who can see both
// halves can still sign neither.

const weighed = (over: Partial<WeighedShape> = {}): WeighedShape => ({
  resinKg: 41873,
  fillerKg: 12000,
  mixerCharges: 279,
  gritUnresolvedKg: 0,
  gritCharges: [
    { silo: "S1", band: "0.6-1.2", kg: 900 },
    { silo: "S2", band: "1.2-2.5", kg: 400 },
  ],
  ...over,
});

const priced = (over: Partial<PricedShape> = {}): PricedShape => ({
  lines: [{ item: "silane", seq: 0, qty: null, rate: 1.21 }],
  cardRates: { silane: 1.21, cobalt: 0.0857 },
  resinBySupplier: { Aypols: 161 },
  ...over,
});

test("the same weights fingerprint the same, whatever order the grit arrives in", () => {
  const a = weightsFingerprint(weighed());
  const b = weightsFingerprint(weighed({
    gritCharges: [
      { silo: "S2", band: "1.2-2.5", kg: 400 },
      { silo: "S1", band: "0.6-1.2", kg: 900 },
    ],
  }));
  assert.equal(a, b);
});

test("a corrected mixer weight changes the weights fingerprint", () => {
  assert.notEqual(weightsFingerprint(weighed()), weightsFingerprint(weighed({ resinKg: 41874 })));
  assert.notEqual(weightsFingerprint(weighed()), weightsFingerprint(weighed({ mixerCharges: 280 })));
  assert.notEqual(weightsFingerprint(weighed()), weightsFingerprint(weighed({ gritUnresolvedKg: 5 })));
});

test("a grit charge moving between silos changes it, even at the same tonnage", () => {
  const moved = weighed({
    gritCharges: [
      { silo: "S1", band: "0.6-1.2", kg: 400 },
      { silo: "S2", band: "1.2-2.5", kg: 900 },
    ],
  });
  assert.notEqual(weightsFingerprint(weighed()), weightsFingerprint(moved));
});

test("the card is part of the cost fingerprint, not just the batch's own lines", () => {
  // The point: a batch that prices nothing itself is costed entirely at the
  // card, so a plant-wide revision changes its cost without touching a row that
  // belongs to it.
  const before = costsFingerprint(priced({ lines: [] }));
  const after = costsFingerprint(priced({ lines: [], cardRates: { silane: 1.4, cobalt: 0.0857 } }));
  assert.notEqual(before, after);
});

test("resin's per-supplier rates are in the cost fingerprint too", () => {
  assert.notEqual(
    costsFingerprint(priced()),
    costsFingerprint(priced({ resinBySupplier: { Aypols: 161, "3n Composits": 145 } })),
  );
});

test("cost fingerprints do not depend on key order or line order", () => {
  const a = costsFingerprint(priced({
    lines: [
      { item: "silane", seq: 0, qty: null, rate: 1.21 },
      { item: "cobalt", seq: 0, qty: 10, rate: 0.09 },
    ],
    cardRates: { silane: 1.21, cobalt: 0.0857 },
  }));
  const b = costsFingerprint(priced({
    lines: [
      { item: "cobalt", seq: 0, qty: 10, rate: 0.09 },
      { item: "silane", seq: 0, qty: null, rate: 1.21 },
    ],
    cardRates: { cobalt: 0.0857, silane: 1.21 },
  }));
  assert.equal(a, b);
});

test("a null qty is not the same as a zero qty", () => {
  const rest = costsFingerprint(priced({ lines: [{ item: "silane", seq: 0, qty: null, rate: 1.21 }] }));
  const zero = costsFingerprint(priced({ lines: [{ item: "silane", seq: 0, qty: 0, rate: 1.21 }] }));
  assert.notEqual(rest, zero);
});

test("no row means unverified; a matching row means verified", () => {
  const fp = weightsFingerprint(weighed());
  assert.deepEqual(verifyState(undefined, fp), { status: "unverified" });

  const row: VerificationRow = {
    side: "WEIGHTS", fingerprint: fp, verifiedBy: "satyadev", verifiedAt: "2026-08-18T06:00:00Z",
  };
  assert.deepEqual(verifyState(row, fp), {
    status: "verified", by: "satyadev", at: "2026-08-18T06:00:00Z",
  });
});

test("a sign-off goes stale when the numbers move under it, and keeps who signed", () => {
  const row: VerificationRow = {
    side: "WEIGHTS",
    fingerprint: weightsFingerprint(weighed()),
    verifiedBy: "satyadev",
    verifiedAt: "2026-08-18T06:00:00Z",
  };
  const state = verifyState(row, weightsFingerprint(weighed({ resinKg: 41999 })));
  assert.equal(state.status, "stale");
  // Who signed the old numbers is exactly what somebody chasing the change
  // needs; dropping it would leave "needs re-checking" with nobody to ask.
  assert.equal(state.status === "stale" && state.by, "satyadev");
});

test("an unset WEIGHTS_VERIFIER_EMAILS admits nobody", () => {
  assert.deepEqual(weightsVerifiers(undefined), []);
  assert.deepEqual(weightsVerifiers(""), []);
  assert.deepEqual(weightsVerifiers("   "), []);
  assert.equal(canVerifyWeights("satyadev@thepacific.group", undefined), false);
  assert.equal(canVerifyWeights("anyone@thepacific.group", ""), false);
});

test("the allowlist is comma-separated, trimmed and case-insensitive", () => {
  const raw = " Satyadev@thepacific.group , second@thepacific.group ";
  assert.deepEqual(weightsVerifiers(raw), ["satyadev@thepacific.group", "second@thepacific.group"]);
  assert.equal(canVerifyWeights("SATYADEV@THEPACIFIC.GROUP", raw), true);
  assert.equal(canVerifyWeights("satyadev@thepacific.group", raw), true);
  assert.equal(canVerifyWeights("someone.else@thepacific.group", raw), false);
});

test("a blank or missing email never matches, even against a populated list", () => {
  const raw = "satyadev@thepacific.group";
  assert.equal(canVerifyWeights("", raw), false);
  assert.equal(canVerifyWeights(null, raw), false);
  assert.equal(canVerifyWeights(undefined, raw), false);
  assert.equal(canVerifyWeights("   ", raw), false);
});

test("the store incharge is a verifier by role; no other role is", () => {
  assert.equal(canVerifyCosts("STORE"), true);
  for (const r of ["ADMIN", "LINE_MANAGER", "INCHARGE", "OPERATOR", "FINANCE", null, undefined]) {
    assert.equal(canVerifyCosts(r), false, `${r} must not be a verifier by role`);
  }
});

test("both verifiers read and sign BOTH halves (owner, 2026-08-18)", () => {
  const raw = "satyadev@thepacific.group";
  // The named production verifier: both sides.
  assert.deepEqual(readableSides("LINE_MANAGER", "satyadev@thepacific.group", raw), ["WEIGHTS", "COSTS"]);
  assert.deepEqual(signableSides("LINE_MANAGER", "satyadev@thepacific.group", raw), ["WEIGHTS", "COSTS"]);
  // The store incharge: both sides.
  assert.deepEqual(readableSides("STORE", "store@thepacific.group", raw), ["WEIGHTS", "COSTS"]);
  assert.deepEqual(signableSides("STORE", "store@thepacific.group", raw), ["WEIGHTS", "COSTS"]);
  // A Line Manager who is not the named person still gets nothing at all.
  assert.deepEqual(readableSides("LINE_MANAGER", "other@thepacific.group", raw), []);
  assert.deepEqual(signableSides("LINE_MANAGER", "other@thepacific.group", raw), []);
});

test("isBatchVerifier matches by role or by allowlist, and nobody else", () => {
  const raw = "satyadev@thepacific.group";
  assert.equal(isBatchVerifier("STORE", "store@thepacific.group", raw), true);
  assert.equal(isBatchVerifier("LINE_MANAGER", "satyadev@thepacific.group", raw), true);
  assert.equal(isBatchVerifier("LINE_MANAGER", "other@thepacific.group", raw), false);
  assert.equal(isBatchVerifier("ADMIN", "boss@thepacific.group", raw), false);
});

test("admin reads both halves and signs neither", () => {
  const raw = "satyadev@thepacific.group";
  assert.deepEqual(readableSides("ADMIN", "boss@thepacific.group", raw), ["WEIGHTS", "COSTS"]);
  assert.deepEqual(signableSides("ADMIN", "boss@thepacific.group", raw), []);
});

// ---- verifyMarks: one mark per person, each lapsing on its own ----

const marksFixture = (fpNow: string): VerificationRow[] => [
  { side: "WEIGHTS", fingerprint: fpNow, verifiedBy: "Satya", verifiedAt: "2026-08-18T06:00:00Z" },
  { side: "WEIGHTS", fingerprint: "old-numbers", verifiedBy: "Thiru", verifiedAt: "2026-08-17T09:00:00Z" },
  { side: "COSTS", fingerprint: fpNow, verifiedBy: "Thiru", verifiedAt: "2026-08-18T07:00:00Z" },
];

test("verifyMarks keeps both people's marks on one side, oldest first", () => {
  const fp = "current";
  const marks = verifyMarks(marksFixture(fp), "WEIGHTS", fp);
  assert.equal(marks.length, 2);
  assert.deepEqual(marks[0], { status: "stale", by: "Thiru", at: "2026-08-17T09:00:00Z" });
  assert.deepEqual(marks[1], { status: "verified", by: "Satya", at: "2026-08-18T06:00:00Z" });
});

test("one person's mark lapsing does not unsay the other's", () => {
  const fp = "current";
  const marks = verifyMarks(marksFixture(fp), "WEIGHTS", fp);
  assert.equal(marks.find((m) => m.by === "Satya")?.status, "verified");
  assert.equal(marks.find((m) => m.by === "Thiru")?.status, "stale");
});

test("verifyMarks filters by side and an unmarked side is an empty list", () => {
  const fp = "current";
  assert.deepEqual(
    verifyMarks(marksFixture(fp), "COSTS", fp),
    [{ status: "verified", by: "Thiru", at: "2026-08-18T07:00:00Z" }],
  );
  assert.deepEqual(verifyMarks([], "WEIGHTS", fp), []);
});

test("every mark lapses together when the numbers move under all of them", () => {
  const marks = verifyMarks(marksFixture("what-they-signed"), "WEIGHTS", "numbers-changed");
  assert.equal(marks.length, 2);
  for (const m of marks) assert.equal(m.status, "stale");
});

test("only the two sides are sides", () => {
  assert.equal(isVerifySide("WEIGHTS"), true);
  assert.equal(isVerifySide("COSTS"), true);
  for (const v of ["weights", "BOTH", "", null, undefined, 1]) {
    assert.equal(isVerifySide(v), false);
  }
});
