import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowLetter, rowLetterIndex, nextRowLetter, assignRowLetters,
  formatPieceCode, parsePieceCode, nextPieceNumberInRow,
  comparePieceCodes, rowLabel,
} from "../src/lib/fab/pieceNaming.ts";

// {projectCode}-{rowLetter}-{n}  —  PRJ1-A-1
//
// One letter per ordered row, one number per piece. The tests that matter are
// not the happy path but the two facts that break a naive implementation:
//
//   1. REAL ORDERS RUN PAST Z. The Kerasom sheet is 28 rows, PO 10026 is 23.
//   2. A ROW IS NOT CUT IN ONE GO. 28 pieces can be 12 on one slab and 16 on
//      the next, and piece_code is @unique GLOBALLY — so restarting at 1 does
//      not mislabel, it fails to insert.

test("letters: A-Z is the first 26 rows", () => {
  assert.equal(rowLetter(0), "A");
  assert.equal(rowLetter(1), "B");
  assert.equal(rowLetter(25), "Z");
  const first26 = Array.from({ length: 26 }, (_, i) => rowLetter(i));
  assert.equal(first26.join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
});

test("letters: PAST Z IT CONTINUES, bijectively — Z is followed by AA", () => {
  // Ordinary base-26 would produce "BA" here (or need a zero digit). Bijective
  // base-26 is what spreadsheet columns use, and it is the only scheme where
  // every index has exactly one label with no gaps and no repeats.
  assert.equal(rowLetter(26), "AA");
  assert.equal(rowLetter(27), "AB");
  assert.equal(rowLetter(51), "AZ");
  assert.equal(rowLetter(52), "BA");
  assert.equal(rowLetter(701), "ZZ");
  assert.equal(rowLetter(702), "AAA");
});

test("letters: THE KERASOM SHEET'S 28 ROWS ALL GET A DISTINCT LABEL", () => {
  // 28 rows is the case that breaks a 26-letter implementation, and it is a
  // real order sitting in the inbox.
  const labels = Array.from({ length: 28 }, (_, i) => rowLetter(i));
  assert.equal(labels.length, new Set(labels).size, "two rows share a letter");
  assert.equal(labels[25], "Z");
  assert.equal(labels[26], "AA");
  assert.equal(labels[27], "AB");
});

test("letters: no index anywhere near a real order collides", () => {
  // Exhaustive over four times the largest sheet we have seen.
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const l = rowLetter(i);
    assert.ok(!seen.has(l), `${l} repeated at index ${i}`);
    seen.add(l);
    assert.equal(rowLetterIndex(l), i, `${l} does not map back to ${i}`);
  }
});

test("letters: junk indexes clamp instead of throwing", () => {
  // This runs inside an import loop. One malformed row must not take the whole
  // purchase order down.
  for (const v of [-1, -99, NaN, Infinity, 1.7]) {
    const l = rowLetter(v as number);
    assert.match(l, /^[A-Z]+$/, String(v));
  }
  assert.equal(rowLetter(1.7), "B", "fractional indexes floor");
});

test("letters: only A-Z parses back — a legacy label is recognised, not guessed", () => {
  assert.equal(rowLetterIndex("A"), 0);
  assert.equal(rowLetterIndex(" aa "), 26);
  for (const v of ["Row 3", "2B", "", "   ", "A1", "3", null, undefined, "A-B"]) {
    assert.equal(rowLetterIndex(v as string), null, JSON.stringify(v));
  }
});

test("letters: the next one CONTINUES PAST THE MAXIMUM, it does not fill gaps", () => {
  // A deleted row must not hand its letter to a different size later —
  // somewhere there is a cut sheet or a piece of stone still carrying it.
  assert.equal(nextRowLetter([]), "A");
  assert.equal(nextRowLetter(["A", "B", "C"]), "D");
  assert.equal(nextRowLetter(["A", "C"]), "D", "B was deleted and must stay retired");
  assert.equal(nextRowLetter(["Z"]), "AA");
  // Legacy labels contribute nothing rather than being mis-parsed.
  assert.equal(nextRowLetter(["Row 3", "2B", null, undefined, ""]), "A");
  assert.equal(nextRowLetter(["Row 3", "B"]), "C");
});

test("letters: a whole import is lettered in ONE call, so two rows cannot share", () => {
  assert.deepEqual(assignRowLetters([], 3), ["A", "B", "C"]);
  assert.deepEqual(assignRowLetters(["A", "B"], 2), ["C", "D"]);
  // The 28-row sheet imported into an empty project.
  const all = assignRowLetters([], 28);
  assert.equal(all.length, 28);
  assert.equal(new Set(all).size, 28);
  assert.equal(all[27], "AB");
  // A second purchase order on the same project continues, never restarts.
  const second = assignRowLetters(all, 3);
  assert.deepEqual(second, ["AC", "AD", "AE"]);
  assert.equal(all.filter((l) => second.includes(l)).length, 0);
  assert.deepEqual(assignRowLetters([], 0), []);
  assert.deepEqual(assignRowLetters([], -5), []);
});

test("code: the format is projectCode-LETTER-n", () => {
  assert.equal(formatPieceCode("PRJ1", "A", 1), "PRJ1-A-1");
  assert.equal(formatPieceCode("PRJ1", "A", 12), "PRJ1-A-12");
  assert.equal(formatPieceCode("PRJ1", "AB", 7), "PRJ1-AB-7");
  // Not zero-padded — the owner's spelling. See comparePieceCodes for the cost.
  assert.equal(formatPieceCode("PRJ1", "A", 2), "PRJ1-A-2");
  // Defensive: a code is never built with a number below 1.
  assert.equal(formatPieceCode("PRJ1", "A", 0), "PRJ1-A-1");
  assert.equal(formatPieceCode("PRJ1", "a", 3), "PRJ1-A-3");
  assert.equal(formatPieceCode(" PRJ1 ", " b ", 3), "PRJ1-B-3");
});

test("code: it round-trips, and a project code MAY CONTAIN HYPHENS", () => {
  // Anchored on the last two segments for this reason — "PAC-2026-1" is a
  // plausible project code and splitting on the first hyphen would break it.
  assert.deepEqual(parsePieceCode("PRJ1-A-1"), { projectCode: "PRJ1", letter: "A", n: 1 });
  assert.deepEqual(parsePieceCode("PAC-2026-1-AB-42"), { projectCode: "PAC-2026-1", letter: "AB", n: 42 });
  for (const bad of [
    "PRJ1-0007",                 // the retired release-project format
    "PRJ1-2B-003-9f1c",          // the retired cutting-queue format
    "", "PRJ1", "PRJ1-A", "PRJ1-A-0", "PRJ1-A-x", null, undefined,
  ]) {
    assert.equal(parsePieceCode(bad as string), null, JSON.stringify(bad));
  }
});

test("numbering: A ROW SPLIT ACROSS SLABS CONTINUES, it does not restart", () => {
  // The defect this exists to stop. Row A is 28 pieces: 12 go on slab 154700
  // today, 16 on slab 154660 next week. piece_code is @unique GLOBALLY, so a
  // restart at 1 is not a mislabel — it is a failed insert on the second slab.
  const slabOne = Array.from({ length: 12 }, (_, i) => formatPieceCode("PRJ1", "A", i + 1));
  assert.equal(slabOne[0], "PRJ1-A-1");
  assert.equal(slabOne[11], "PRJ1-A-12");

  assert.equal(nextPieceNumberInRow("PRJ1", "A", slabOne), 13);
  const slabTwo = Array.from({ length: 16 }, (_, i) => formatPieceCode("PRJ1", "A", 13 + i));
  assert.equal(slabTwo[0], "PRJ1-A-13");
  assert.equal(slabTwo[15], "PRJ1-A-28");

  const all = [...slabOne, ...slabTwo];
  assert.equal(new Set(all).size, 28, "no duplicate code across the two slabs");
});

test("numbering: each row counts independently", () => {
  const rowA = [formatPieceCode("PRJ1", "A", 1), formatPieceCode("PRJ1", "A", 2)];
  const rowB = [formatPieceCode("PRJ1", "B", 1)];
  assert.equal(nextPieceNumberInRow("PRJ1", "A", [...rowA, ...rowB]), 3);
  assert.equal(nextPieceNumberInRow("PRJ1", "B", [...rowA, ...rowB]), 2);
  assert.equal(nextPieceNumberInRow("PRJ1", "C", [...rowA, ...rowB]), 1);
  // Another project's pieces never advance this one's counter.
  assert.equal(nextPieceNumberInRow("PRJ2", "A", [...rowA, ...rowB]), 1);
  assert.equal(nextPieceNumberInRow("PRJ1", "A", []), 1);
});

test("numbering: the two RETIRED formats cannot advance the counter", () => {
  // Ignored rather than parsed. "PRJ1-0007" has no letter and
  // "PRJ1-2B-003-9f1c" has a tail; guessing at either would mint a code that
  // collides with a real one.
  const legacy = ["PRJ1-0007", "PRJ1-0012", "PRJ1-2B-003-9f1c"];
  assert.equal(nextPieceNumberInRow("PRJ1", "A", legacy), 1);
  // Mixed old and new: only the new format counts.
  assert.equal(nextPieceNumberInRow("PRJ1", "A", [...legacy, "PRJ1-A-4"]), 5);
});

test("numbering: a gap does not let a number be reused", () => {
  // max + 1, not first-free — the same rule as the letters, for the same reason.
  assert.equal(nextPieceNumberInRow("PRJ1", "A", ["PRJ1-A-1", "PRJ1-A-5"]), 6);
});

test("sorting: pieces sort by NUMBER, because the code is not padded", () => {
  // A plain string sort reads A-10 < A-2. That is the price of the owner's
  // unpadded format, and it is paid here rather than on the shop floor.
  const codes = ["PRJ1-A-10", "PRJ1-A-2", "PRJ1-B-1", "PRJ1-A-1", "PRJ1-AA-1", "PRJ1-Z-3"];
  assert.deepEqual(
    [...codes].sort(comparePieceCodes),
    ["PRJ1-A-1", "PRJ1-A-2", "PRJ1-A-10", "PRJ1-B-1", "PRJ1-Z-3", "PRJ1-AA-1"],
  );
  // Proof the naive sort really is wrong, so nobody "simplifies" this away.
  assert.notDeepEqual([...codes].sort(), [...codes].sort(comparePieceCodes));
});

test("display: a row with no letter yet shows its imported label, not a made-up one", () => {
  // Every requirement created before scripts/0054 has no letter. Showing "Row 3"
  // is honest; inventing "A" would put a name on screen that no stone carries.
  assert.equal(rowLabel("A"), "A");
  assert.equal(rowLabel("ab"), "AB");
  assert.equal(rowLabel(null, "Row 3"), "Row 3");
  assert.equal(rowLabel("", "Row 3"), "Row 3");
  assert.equal(rowLabel("Row 3", "Row 3"), "Row 3", "a legacy value is not a letter");
  assert.equal(rowLabel(null, null), "—");
  assert.equal(rowLabel(null, "   "), "—");
});
