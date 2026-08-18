// GSTIN extraction and OCR repair, ported from automation/app/extract.py.
//
// GSTIN is the most valuable field on a bill — it is the exact vendor identity,
// so it drives both duplicate detection and vendor memory. It is also the field
// most worth fighting for, because it has two properties nothing else on a bill
// has: a rigid positional format, and a check digit.
//
// That means OCR damage is genuinely repairable rather than merely guessable.
// Positions constrain each character to digit or letter, which resolves most
// confusions outright; where one is still ambiguous (B could be 6 or 8) the
// alternatives are enumerated and the check digit decides. A repaired GSTIN
// that passes the checksum is right with probability ~35/36 — not a guess.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/g;
const GSTIN_FULL = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

// Ambiguous OCR readings, by target type.
const AS_DIGIT: Record<string, string> = {
  O: "0", Q: "0", D: "0", I: "1", L: "1", T: "7",
  Z: "2", S: "5", A: "4", G: "6", C: "3", E: "8",
};
const AS_DIGIT_ALT: Record<string, string[]> = { B: ["8", "6"], G: ["6", "9"], S: ["5", "8"] };
const AS_ALPHA: Record<string, string> = {
  "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G",
  "4": "A", "7": "T", "3": "E", "9": "G",
};

const DIGIT_POS = new Set([0, 1, 7, 8, 9, 10]);   // state code + PAN digits
const ALPHA_POS = new Set([2, 3, 4, 5, 6, 11]);   // PAN letters + entity letter

/** Characters OCR confuses with each other, for the free positions (12, 14)
 *  where either a digit or a letter is legal. */
const AMBIGUOUS = ["0OQD", "1IL", "2Z", "5S", "6G", "8B", "7T", "4A", "3E"].map((g) => new Set(g));

const MAX_EDITS = 6;
const MAX_COMBOS = 20_000;

/** Official GSTIN check character: base-36, alternating weights 1 and 2. */
export function gstinChecksum(first14: string): string {
  let total = 0;
  for (let i = 0; i < first14.length; i++) {
    const v = ALPHABET.indexOf(first14[i]);
    const p = v * (i % 2 ? 2 : 1);
    total += Math.floor(p / 36) + (p % 36);
  }
  return ALPHABET[(36 - (total % 36)) % 36];
}

export function isValidGstin(s: string, requireChecksum = true): boolean {
  if (!GSTIN_FULL.test(s)) return false;
  const state = Number(s.slice(0, 2));
  if (!(state >= 1 && state <= 38)) return false;
  return requireChecksum ? gstinChecksum(s.slice(0, 14)) === s[14] : true;
}

function alternatives(ch: string): string[] {
  for (const group of AMBIGUOUS) {
    if (group.has(ch)) return [ch, ...[...group].filter((c) => c !== ch).sort()];
  }
  return [ch];
}

/** Plausible repairs of a 15-character window. Null when the window cannot be
 *  a GSTIN at all, or when the search would be too wide to be meaningful. */
export function gstinCandidates(window: string): Array<{ candidate: string; edits: number }> | null {
  const opts: string[][] = [];
  for (let i = 0; i < window.length; i++) {
    const ch = window[i];
    if (i === 13) {
      opts.push(["Z"]);
    } else if (DIGIT_POS.has(i)) {
      if (/\d/.test(ch)) opts.push([ch]);
      else if (AS_DIGIT_ALT[ch]) opts.push(AS_DIGIT_ALT[ch]);
      else if (AS_DIGIT[ch]) opts.push([AS_DIGIT[ch]]);
      else return null;
    } else if (ALPHA_POS.has(i)) {
      if (/[A-Z]/.test(ch)) opts.push([ch]);
      else if (AS_ALPHA[ch]) opts.push([AS_ALPHA[ch]]);
      else return null;
    } else {
      opts.push(alternatives(ch)); // positions 12 and 14
    }
  }

  let total = 1;
  for (const o of opts) total *= o.length;
  if (total > MAX_COMBOS) return null;

  const out: Array<{ candidate: string; edits: number }> = [];
  const build = (i: number, acc: string, edits: number) => {
    if (edits > MAX_EDITS) return;
    if (i === opts.length) { out.push({ candidate: acc, edits }); return; }
    for (const c of opts[i]) build(i + 1, acc + c, edits + (c === window[i] ? 0 : 1));
  };
  build(0, "", 0);
  return out;
}

// A GSTIN is only ever looked for immediately after a GST label. Without that
// constraint the repair search is actively harmful: scanning every window of the
// page and trying thousands of substitutions will eventually produce a string
// that passes the check digit by chance — roughly 1 in 36 per candidate — and in
// the Python engine's own testing it did, "finding" 15HFIAA5004A5Z0 in a line of
// OCR noise. A fabricated GSTIN that validates is far worse than no GSTIN,
// because it becomes the vendor's identity for duplicate detection and memory.
const GST_LABEL_RE = /(?:GSTIN|GSTNO|GSTREGNO|GSTREGISTRATIONNO|GST)/g;
const LABEL_SEARCH_SPAN = 8;

export type GstinMethod = "gstin_exact" | "gstin_repaired_checksum" | "gstin_format_only";

export interface GstinFind {
  gstin: string;
  method: GstinMethod;
  /** The raw window it came from, for showing a clerk what was repaired. */
  source: string;
  edits: number;
}

export function findGstin(text: string): GstinFind | null {
  const up = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (up.length < 15) return null;

  // An unambiguous match anywhere on the page needs no label context.
  //
  // DELIBERATE DIVERGENCE FROM extract.py. The Python runs this scan over the
  // separator-stripped text, where `\b` can only match at the very start or end
  // of the page — every boundary in between has been removed, so the fast path
  // it documents almost never fires and a perfectly readable GSTIN on a bill
  // with no "GST" label is missed entirely. Scanning the uppercased text with
  // its separators intact restores the documented behaviour.
  //
  // This can only ADD finds, never wrong ones: the path requires a full
  // checksum-valid match with zero repairs, so there is nothing to fabricate.
  for (const m of text.toUpperCase().matchAll(GSTIN_RE)) {
    if (isValidGstin(m[1])) {
      return { gstin: m[1], method: "gstin_exact", source: m[1], edits: 0 };
    }
  }
  // Then the stripped text, which catches a GSTIN printed with spaces or
  // hyphens inside it — the case stripping exists for.
  for (const m of up.matchAll(GSTIN_RE)) {
    if (isValidGstin(m[1])) {
      return { gstin: m[1], method: "gstin_exact", source: m[1], edits: 0 };
    }
  }

  let bestChecksum: GstinFind | null = null;
  let formatHit: GstinFind | null = null;

  for (const lm of up.matchAll(GST_LABEL_RE)) {
    const from = (lm.index ?? 0) + lm[0].length;
    for (let start = from; start < Math.min(from + LABEL_SEARCH_SPAN, up.length - 14); start++) {
      const window = up.slice(start, start + 15);
      for (const { candidate, edits } of gstinCandidates(window) ?? []) {
        if (isValidGstin(candidate)) {
          if (!bestChecksum || edits < bestChecksum.edits) {
            bestChecksum = { gstin: candidate, method: "gstin_repaired_checksum", source: window, edits };
          }
        } else if (!formatHit && isValidGstin(candidate, false)) {
          // Right shape, wrong check digit — at least one character is still
          // wrong. Worth showing at low confidence for a clerk to confirm,
          // never worth trusting silently.
          formatHit = { gstin: candidate, method: "gstin_format_only", source: window, edits };
        }
      }
    }
  }

  return bestChecksum ?? formatHit;
}

/** Amounts as OCR reads them: thousands separators, and O/l/I/S read for
 *  digits inside numbers. */
export function cleanAmount(s: string | null | undefined): number | null {
  if (!s) return null;
  let t = s.replace(/,/g, "").replace(/ /g, "").replace(/^\.+|\.+$/g, "");
  t = t.replace(/[OoLlIS]/g, (c) => ({ O: "0", o: "0", l: "1", I: "1", S: "5", L: "1" }[c] ?? c));
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return v >= 0 && v < 1e9 ? v : null;
}
