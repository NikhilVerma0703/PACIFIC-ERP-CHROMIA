// SUGGESTING WHICH DESIGN A YARD NAME MEANT — pure, and it imports nothing, so
// `node --test` loads it bare (the same reason lib/roles.ts and
// catalogue/colours.ts import nothing).
//
// WHY THIS IS A SUGGESTION AND NEVER AN ANSWER. The owner gave three examples
// on 2026-09-17 and they settle the design between them:
//
//   "Antique Greya"  IS  "Antique Grey"    — one character apart
//   "Arlina Chromia" IS  "Arlina"          — a line name stuck on the end
//   "Arena"          IS NOT "Arlina"       — two characters apart, real designs
//
// One character apart and identical; two characters apart and different. No
// distance threshold separates those, and no threshold ever will, because the
// difference is not in the strings — it is in the colour chart. So this module
// ranks candidates and says why it ranked them; a human presses the button.
// Anything that merges on its own would eventually merge Arena into Arlina and
// nobody would find out until a customer opened the crate.
//
// WHAT IT IS FOR. 149 of the 488 design names in stock are neither merged nor
// on any list, covering ~9,000 slabs. Worked by hand that is a week nobody has;
// the point of ranking is to make the obvious 80% a click each and leave the
// judgement calls standing out.

/** Uppercase, non-alphanumerics stripped — the same fold the Salesforce product
 *  codes use, so "Pebble ice" and "PEBBLE-ICE" are one name here too. */
export function foldName(name: unknown): string {
  return String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * WORDS THAT SAY WHERE A SLAB WAS MADE, NOT WHAT IT IS.
 *
 * "Arlina Chromia" is Arlina, printed on the Chromia line. "Arva White Kreos"
 * is Arva White off the Kreos press. These are the plant's own vocabulary
 * leaking into a colour name, and stripping them is what turns a 0.57 distance
 * into an exact match.
 *
 * NOT "TRIAL" OR "TRAIL". A trial batch is not the design it is a trial of —
 * the Salesforce sync withholds those deliberately — so folding them together
 * here would quietly undo that. They are left to be judged on the screen.
 */
export const LINE_WORDS: readonly string[] = Object.freeze([
  "CHROMIA", "ROBO", "KREOS", "PRESS", "LINE", "SAMPLE", "SAMPLES", "NEW", "OLD",
]);

/** The name with any line words taken off either end. Inner words are left
 *  alone: "Chromia Blue" is a colour whose name starts with the word. */
export function stripLineWords(name: unknown): string {
  const words = String(name ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  let a = 0;
  let b = words.length;
  while (b - a > 1 && LINE_WORDS.includes(words[b - 1]!)) b -= 1;
  while (b - a > 1 && LINE_WORDS.includes(words[a]!)) a += 1;
  return words.slice(a, b).join("");
}

/** Levenshtein, iterative, two rows. Short strings only — design names. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

export type SuggestionKind =
  | "SAME_AFTER_FOLDING"   // only case or punctuation differs
  | "LINE_WORD"            // a line name on the end: "Arlina Chromia" -> "Arlina"
  | "ONE_CHARACTER"        // "Antique Greya" -> "Antique Grey"
  | "CLOSE";               // near, and the reason the screen asks rather than tells

export interface Suggestion {
  /** The known design being suggested. */
  candidate: string;
  kind: SuggestionKind;
  /** 0–1, for ordering only. Never a threshold to act on by itself. */
  score: number;
  /** Shown to the admin next to the button, so the reason is on screen. */
  because: string;
}

/** How close is close enough to be worth showing at all. Two characters in a
 *  short name is Arena/Arlina, which is why the floor is relative and tight. */
const MAX_RELATIVE_DISTANCE = 0.2;

/**
 * Rank the known designs a yard name might have meant, best first.
 *
 * `known` is every name the system already accepts — the colour chart, the
 * canonicals of existing merges, the design codes. Nothing here decides; the
 * caller shows these beside the name and an admin chooses one or none.
 */
export function suggestDesigns(raw: unknown, known: Iterable<string>, limit = 5): Suggestion[] {
  const rawFold = foldName(raw);
  if (!rawFold) return [];
  const rawStripped = stripLineWords(raw);
  const out: Suggestion[] = [];

  for (const candidate of known) {
    const candFold = foldName(candidate);
    if (!candFold || candFold === rawFold) continue;        // identical is not a suggestion

    if (foldName(rawStripped) === candFold) {
      out.push({ candidate, kind: "LINE_WORD", score: 0.97,
        because: `Same name with a line word removed — "${String(raw).trim()}" is ${candidate} off a named line.` });
      continue;
    }
    const d = editDistance(rawFold, candFold);
    const rel = d / Math.max(rawFold.length, candFold.length);
    if (d === 1) {
      out.push({ candidate, kind: "ONE_CHARACTER", score: 0.9 - rel,
        because: `One character different from ${candidate}.` });
    } else if (rel <= MAX_RELATIVE_DISTANCE) {
      out.push({ candidate, kind: "CLOSE", score: 0.7 - rel,
        because: `${d} characters different from ${candidate} — check this one before merging.` });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate)).slice(0, limit);
}

/** Is this yard name already accounted for — a known design, or merged away? */
export function isResolved(raw: unknown, known: ReadonlySet<string>, mergedVariants: ReadonlySet<string>): boolean {
  const f = foldName(raw);
  if (!f) return true;                       // blank is not a backlog item
  if (mergedVariants.has(String(raw))) return true;
  for (const k of known) if (foldName(k) === f) return true;
  return false;
}
