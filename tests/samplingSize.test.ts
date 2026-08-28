import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSampleSize, parseEdgeInches, parseThicknessMm,
  sampleSizeKey, sampleSizeLabel, sameSampleSize,
} from "../src/lib/sampling/size.ts";

// There are no standard sample sizes: a size is typed the first time it is
// used and becomes a pick-list option forever, and nobody curates the list.
// So every one of these is really the same test — "does a second typing of a
// size land on the row it already has, or does it split the stock into two
// half-counts nobody reconciles?" — and the refusals matter as much as the
// matches, because a wrong size saved once is permanent.

const size = (input: string | { length: unknown; width: unknown; thickness: unknown }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = parseSampleSize(input as any);
  assert.ok(r.ok, `expected ${JSON.stringify(input)} to parse, got: ${r.ok ? "" : r.reason}`);
  return r.ok ? r.size : null!;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const refusal = (input: any) => {
  const r = parseSampleSize(input);
  assert.equal(r.ok, false, `expected ${JSON.stringify(input)} to be refused`);
  return r.ok ? "" : r.reason;
};

// ---------------------------------------------------------------------------
// The same size, typed twice
// ---------------------------------------------------------------------------

test("whitespace is not part of a size", () => {
  assert.ok(sameSampleSize("  4 x 4 x 2 cm  ", "4x4x2cm"));
  assert.ok(sameSampleSize({ length: " 4 ", width: "4", thickness: " 2 cm" }, "4x4x20mm"));
});

test("trailing zeros are not a different size", () => {
  assert.ok(sameSampleSize("4 x 4 x 2cm", "4.0 x 4.00 x 2cm"));
  assert.ok(sameSampleSize("4.5 x 6 x 2cm", "4.50 x 6.0 x 2cm"));
  // The stored value is the compared value: NUMERIC(10,2) in sampling_size.
  assert.equal(size("4.0 x 6.00 x 2cm").lengthIn, 6);
  assert.equal(size("4.50 x 6 x 2cm").widthIn, 4.5);
});

test("4x6 AND 6x4 ARE THE SAME SIZE — the longer edge is the length", () => {
  // A sample piece is a loose rectangle in a box: it has no orientation, and
  // the man pulling stock turns it round without thinking. Two rows would mean
  // two half-counts of one pile. (A countertop is different, which is why
  // fab_requirement keeps length and width exactly as given.)
  assert.ok(sameSampleSize("4 x 6 x 2cm", "6 x 4 x 2cm"));
  const s = size("4 x 6 x 2cm");
  assert.equal(s.lengthIn, 6);
  assert.equal(s.widthIn, 4);
  assert.equal(sampleSizeKey(s), sampleSizeKey(size("6 x 4 x 2cm")));
});

test("THICKNESS IS PART OF THE SIZE — 2 cm and 3 cm are different stock", () => {
  assert.ok(!sameSampleSize("4 x 4 x 2cm", "4 x 4 x 3cm"));
  assert.equal(size("4 x 4 x 2cm").thicknessMm, 20);
  assert.equal(size("4 x 4 x 3cm").thicknessMm, 30);
  // Same thickness, two units.
  assert.ok(sameSampleSize("4 x 4 x 2cm", "4 x 4 x 20mm"));
  assert.ok(sameSampleSize("4 x 4 x 1.2cm", "4 x 4 x 12mm"));
});

test("the separator is not part of the size either", () => {
  assert.ok(sameSampleSize("4x6x2cm", "4 × 6 × 2 cm"));
  assert.ok(sameSampleSize("4x6x2cm", "4 by 6 by 2cm"));
  assert.ok(sameSampleSize("4x6x2cm", "4*6*2cm"));
  assert.ok(sameSampleSize('4" x 6in x 2cm', "4 x 6 x 20 mm"));
});

test("a different size is a different size", () => {
  assert.ok(!sameSampleSize("4 x 4 x 2cm", "4 x 5 x 2cm"));
  assert.ok(!sameSampleSize("4 x 4 x 2cm", "4.5 x 4 x 2cm"));
});

// ---------------------------------------------------------------------------
// The refusals — where a guess would become permanent
// ---------------------------------------------------------------------------

test("THICKNESS WITHOUT A UNIT IS REFUSED, not guessed", () => {
  // "2" is 2 cm to the man cutting it and 2 mm to a parser, and both are
  // numbers this field could legitimately hold. Guessing wrong writes a size
  // that stays in the pick-list forever.
  assert.match(refusal("4 x 4 x 2"), /thickness needs a unit/);
  assert.match(refusal({ length: 4, width: 4, thickness: 20 }), /thickness needs a unit/);
  assert.equal(parseThicknessMm("2").ok, false);
  assert.equal(parseThicknessMm("2cm").ok, true);
});

test("MILLIMETRES ON AN EDGE ARE REFUSED, not converted", () => {
  // 100 mm converts to 3.94 in, which would sit next to 4 in in the pick-list
  // forever and split the stock. Refusing is the only answer that does not
  // create a near-duplicate.
  assert.match(refusal("100mm x 100mm x 2cm"), /length and width are inches/);
  assert.match(refusal("10cm x 4 x 2cm"), /length and width are inches/);
  assert.equal(parseEdgeInches("4").ok, true);
  assert.equal(parseEdgeInches('4"').ok, true);
  assert.equal(parseEdgeInches("4 inches").ok, true);
});

test("a fractional millimetre is a typo, not a thickness", () => {
  assert.match(refusal("4 x 4 x 12.5mm"), /whole millimetre/);
  assert.match(refusal("4 x 4 x 0.25cm"), /whole millimetre/);
  // ...but 1.2 cm is exactly 12 mm and must survive the float multiplication.
  assert.equal(parseThicknessMm("1.2cm").ok, true);
});

test("nothing, zero, negatives and nonsense are refused", () => {
  assert.match(refusal(""), /has \d+ part/);
  assert.match(refusal("4 x 4"), /length x width x thickness/);
  assert.match(refusal("4 x 4 x 2cm x 3"), /length x width x thickness/);
  assert.match(refusal("0 x 4 x 2cm"), /positive/);
  assert.match(refusal("-4 x 4 x 2cm"), /not a measurement/);
  assert.match(refusal("four x 4 x 2cm"), /not a measurement/);
  assert.match(refusal({ length: null, width: 4, thickness: "2cm" }), /length: missing/);
  assert.match(refusal({ length: 4, width: 4, thickness: null }), /thickness: missing/);
});

test("a size bigger than a slab, or a thickness that is not quartz, is refused", () => {
  // The bound exists because the list is never curated: "444 x 4" typed once
  // is a pick-list entry for good.
  assert.match(refusal("444 x 4 x 2cm"), /larger than a slab/);
  assert.match(refusal("4 x 4 x 200mm"), /outside 1-100 mm/);
  assert.equal(parseSampleSize("137 x 79 x 2cm").ok, true, "a whole slab is still a legal size");
});

test("A PIECE NO SLAB CAN PRODUCE IS REFUSED — the pair, not each edge", () => {
  // 99 in is a legal length. 99 in is a legal width. 99 x 99 is a piece that
  // does not exist, and it passed every per-edge check: it saved itself as a
  // permanent pick-list size and went onto the supervisor's board to wait for
  // a slab that could never be found.
  assert.match(refusal("99 x 99 x 20mm"), /does not come off a slab/);
  assert.match(refusal("99 x 99 x 20mm"), /137 x 79 in/);

  // Legal right up to the slab's own edges, either way round…
  assert.equal(parseSampleSize("137 x 79 x 20mm").ok, true);
  assert.equal(parseSampleSize("79 x 137 x 20mm").ok, true, "orientation does not matter");
  // …and one inch past either of them is not.
  assert.equal(parseSampleSize("138 x 79 x 20mm").ok, false);
  assert.equal(parseSampleSize("137 x 80 x 20mm").ok, false);

  // A sliver stays legal. It is a daft thing to cut, but it is cuttable, and
  // this module refuses the impossible rather than the unwise.
  assert.equal(parseSampleSize("77 x 3 x 20mm").ok, true);
});

test("an unreadable size is never equal to anything, including itself", () => {
  // "I could not read either of these" is not a match, and treating it as one
  // would silently merge two sizes nobody has actually agreed on.
  assert.ok(!sameSampleSize("nonsense", "nonsense"));
  assert.ok(!sameSampleSize("4 x 4 x 2", "4 x 4 x 2"));
});

// ---------------------------------------------------------------------------
// How a size is written down
// ---------------------------------------------------------------------------

test("the key is the unique index, and the label is what a person reads", () => {
  const s = size("4 x 6 x 2cm");
  assert.equal(sampleSizeKey(s), "6x4x20");
  assert.equal(sampleSizeLabel(s), "6 × 4 in · 20 mm");
  // Same size, same key, whatever was typed.
  assert.equal(sampleSizeKey(size("6x4x20mm")), "6x4x20");
});
