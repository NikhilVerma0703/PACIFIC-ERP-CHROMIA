// SUGGESTING A DESIGN NAME, and the three examples that define the whole rule.
//
// The owner gave them on 2026-09-17 while looking at the inventory dropdown:
//
//   "Antique Greya"  IS  "Antique Grey"   — 1 character apart
//   "Arlina Chromia" IS  "Arlina"         — a line name on the end
//   "Arena"          IS NOT "Arlina"      — 2 characters apart, both real
//
// The last one is the test that matters. Every merge tool that has ever caused
// damage did so by being confident about a pair like Arena/Arlina, so it gets
// its own test and the floor is set by it rather than by what looks tidy.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldName, stripLineWords, editDistance, suggestDesigns, isResolved, LINE_WORDS,
  buildDesignResolver,
} from "../src/lib/inventory/designSuggest.ts";

// A small stand-in for the colour chart, using real Pacific names.
const KNOWN = ["Antique Grey", "Alpine Winter", "Arlina", "Arena", "Arva White",
  "Pebbles Ice", "Carrara Cloud", "Taj Mahal", "Cemento", "Galactic Halo"];

// ── the three examples ───────────────────────────────────────────────────────

test("\"Antique Greya\" is offered \"Antique Grey\", top, as one character", () => {
  const s = suggestDesigns("Antique Greya", KNOWN);
  assert.equal(s[0]?.candidate, "Antique Grey");
  assert.equal(s[0]?.kind, "ONE_CHARACTER");
  assert.match(s[0]!.because, /One character different/);
});

test("\"Arlina Chromia\" is offered \"Arlina\", because Chromia is a line, not a colour", () => {
  const s = suggestDesigns("Arlina Chromia", KNOWN);
  assert.equal(s[0]?.candidate, "Arlina");
  assert.equal(s[0]?.kind, "LINE_WORD");
});

test("ARENA IS NEVER OFFERED ARLINA — the one that must not merge", () => {
  // Two characters in a six-letter name. Both are real designs the plant makes.
  const forArena = suggestDesigns("Arena", KNOWN).map((x) => x.candidate);
  assert.equal(forArena.includes("Arlina"), false, "Arena must not be offered Arlina");
  const forArlina = suggestDesigns("Arlina", KNOWN).map((x) => x.candidate);
  assert.equal(forArlina.includes("Arena"), false, "and not the other way round either");
});

// ── the fold ─────────────────────────────────────────────────────────────────

test("case and punctuation are not a difference", () => {
  assert.equal(foldName("Pebble ice"), "PEBBLEICE");
  assert.equal(foldName("  taj-mahal "), "TAJMAHAL");
  assert.equal(foldName(null), "");
  // an identical name is not a suggestion — there is nothing to decide
  assert.equal(suggestDesigns("ARVA WHITE", KNOWN).some((s) => s.candidate === "Arva White"), false);
});

// ── the line words ───────────────────────────────────────────────────────────

test("a line word comes off either end, and only from an end", () => {
  assert.equal(stripLineWords("Arlina Chromia"), "ARLINA");
  assert.equal(stripLineWords("Chromia Arlina"), "ARLINA");
  assert.equal(stripLineWords("Arva White Kreos"), "ARVAWHITE");
  // an inner word is part of the name
  assert.equal(stripLineWords("Blue Chromia Special"), "BLUECHROMIASPECIAL");
  // never strip a name down to nothing
  assert.equal(stripLineWords("Chromia"), "CHROMIA");
  assert.equal(stripLineWords("Robo"), "ROBO");
});

test("TRIAL IS NOT A LINE WORD, or the Salesforce trial rule would be undone here", () => {
  // "Pebble Ice - Trial" is a trial batch, deliberately withheld from Salesforce.
  // Folding it into Pebbles Ice in the inventory tool would publish it by the
  // back door, so the matcher leaves it to be judged on screen.
  assert.equal(LINE_WORDS.includes("TRIAL"), false);
  assert.equal(LINE_WORDS.includes("TRAIL"), false);
  assert.equal(stripLineWords("Pebble Ice - Trial"), "PEBBLEICETRIAL");
});

// ── the distance ─────────────────────────────────────────────────────────────

test("editDistance is the ordinary one", () => {
  assert.equal(editDistance("ARENA", "ARENA"), 0);
  assert.equal(editDistance("", "ABC"), 3);
  assert.equal(editDistance("ABC", ""), 3);
  assert.equal(editDistance("ARENA", "ARLINA"), 2);
  assert.equal(editDistance("ANTIQUEGREYA", "ANTIQUEGREY"), 1);
});

test("a short name is judged more strictly than a long one", () => {
  // Two characters out of six is a different design; two out of twenty is a typo.
  // The floor is RELATIVE for exactly that reason.
  const short = suggestDesigns("Arena", ["Arlina"]);
  assert.equal(short.length, 0);
  const long = suggestDesigns("Bianco Cristallo Extra", ["Bianco Cristallo Extre"]);
  assert.equal(long.length, 1);
});

test("nothing plausible means nothing offered — silence is an answer", () => {
  assert.deepEqual(suggestDesigns("Zzzqqq Nonsense", KNOWN), []);
  assert.deepEqual(suggestDesigns("", KNOWN), []);
  assert.deepEqual(suggestDesigns(null, KNOWN), []);
});

test("suggestions come back best first and are capped", () => {
  const s = suggestDesigns("Arva Whit", KNOWN, 2);
  assert.ok(s.length <= 2);
  for (let i = 1; i < s.length; i += 1) assert.ok(s[i - 1]!.score >= s[i]!.score);
});

// ── the backlog test ─────────────────────────────────────────────────────────

test("isResolved: a known design, or one already merged away, is not backlog", () => {
  const known = new Set(KNOWN);
  const merged = new Set(["Pebble ice", "Pebble Ice - Trial"]);
  assert.equal(isResolved("Arva White", known, merged), true, "on the chart");
  assert.equal(isResolved("arva white", known, merged), true, "on the chart, spelt loosely");
  assert.equal(isResolved("Pebble ice", known, merged), true, "already merged");
  assert.equal(isResolved("Antique Greya", known, merged), false, "this is the backlog");
  assert.equal(isResolved("", known, merged), true, "blank is not a decision anybody can make");
});

// ── the two Alabaster Noir columns ──────────────────────────────────────────

test("A CASE TWIN OF A KNOWN DESIGN IS THE SAME COLUMN — the two Alabaster Noirs", () => {
  // 350 slabs under "Alabaster Noir" and 1 under "Alabaster noir" appeared as
  // two columns in Slabs by design, because the fold was an exact alias lookup.
  const resolve = buildDesignResolver([], ["Alabaster Noir", "Alabaster"]);
  assert.equal(resolve("Alabaster Noir"), "Alabaster Noir");
  assert.equal(resolve("Alabaster noir"), "Alabaster Noir", "one lowercase letter is not a design");
  assert.equal(resolve("ALABASTER NOIR"), "Alabaster Noir");
  assert.equal(resolve("alabaster-noir"), "Alabaster Noir");
  // ...and a genuinely different design keeps its own column
  assert.equal(resolve("Alabaster"), "Alabaster");
});

test("AN EXPLICIT MERGE ALWAYS WINS — somebody decided it", () => {
  const resolve = buildDesignResolver(
    [{ variant: "Alabester White", canonical: "Alabaster" }],
    ["Alabaster", "Alabaster Noir"],
  );
  assert.equal(resolve("Alabester White"), "Alabaster", "the merge, not the fold");
});

test("it never invents a canonical from two unknown spellings", () => {
  // "Simply white" and "Simply White" are both off the chart. Folding them
  // together here would pick a winner nobody chose; that is the worklist's job.
  const resolve = buildDesignResolver([], ["Alabaster Noir"]);
  assert.equal(resolve("Simply white"), "Simply white");
  assert.equal(resolve("Simply White"), "Simply White");
});

test("blank and junk pass through untouched", () => {
  const resolve = buildDesignResolver([], ["Alabaster Noir"]);
  assert.equal(resolve(""), "");
  assert.equal(resolve(null), "");
  assert.equal(resolve("Zzz"), "Zzz");
});
