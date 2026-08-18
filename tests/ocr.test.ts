import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCanRead, meanOf, toLines, OcrUnsupportedError,
} from "../src/lib/ocr/types.ts";

// The one that matters. A bill's confidence decides whether a human looks at
// it, so "the provider does not measure confidence" and "the provider measured
// zero confidence" must never collapse into the same value.
test("no confidence is null, not zero", () => {
  assert.equal(meanOf([]), null);
  assert.equal(meanOf([{ text: "TOTAL", confidence: null }]), null);

  // Zero is a real score and must survive as a number.
  assert.equal(meanOf([{ text: "???", confidence: 0 }]), 0);
});

test("meanOf averages the scores that exist and ignores the ones that do not", () => {
  const words = [
    { text: "a", confidence: 1 },
    { text: "b", confidence: 0.5 },
    { text: "c", confidence: null },
  ];
  // 0.75, not 0.5 - the unscored word must not be counted as a zero.
  assert.equal(meanOf(words), 0.75);
});

test("toLines drops blanks and trims, keeping reading order", () => {
  assert.deepEqual(
    toLines("  CAFE COFFEE DAY \r\n\n  TOTAL 240.00  \n \n"),
    ["CAFE COFFEE DAY", "TOTAL 240.00"],
  );
  assert.deepEqual(toLines(""), []);
});

const classical = { name: "tesseract-wasm", readsHandwriting: false };
const vision = { name: "claude", readsHandwriting: true };
const png = { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };

test("a classical engine refuses handwriting rather than inventing figures", () => {
  assert.throws(
    () => assertCanRead(classical, { ...png, handwritten: true }),
    (e: Error) => e instanceof OcrUnsupportedError && /manual entry/.test(e.message),
  );
});

test("the same engine is fine with printed bills", () => {
  assert.doesNotThrow(() => assertCanRead(classical, { ...png, handwritten: false }));
  // The hint is optional; absent must not be read as "handwritten".
  assert.doesNotThrow(() => assertCanRead(classical, png));
});

test("a vision engine accepts handwriting", () => {
  assert.doesNotThrow(() => assertCanRead(vision, { ...png, handwritten: true }));
});
