// EAN-13: the customer's barcode, checked and drawn. PURE — no Prisma, no
// Next, no library — so `node --test` loads it bare and so the label PDF can
// draw the bars as plain rectangles with nothing installed for it.
//
// WHY THE CHECK LIVES HERE AND NOT ONLY IN THE DATABASE (round three, answer
// 4). scripts/0081 puts `CHECK (ean ~ '^[0-9]{13}$')` on the column, which
// stops a code of the wrong shape and says nothing about which of the thirteen
// digits is wrong. A barcode is copied off a customer's sheet by hand, and the
// mistake is almost always ONE digit — so the useful sentence is "the check
// digit should be 8, not 3", which needs the arithmetic, not a regex. A code
// refused at entry costs a retype; the same code refused at the customer's
// gate costs the container.
//
// WHY THE BARS ARE MODULES AND NOT AN IMAGE. The label is a pdfmake document
// (lib/commercial/pdf/labels.ts) and pdfmake draws rectangles. 95 zeroes and
// ones is the whole of EAN-13's geometry; a barcode-image dependency would add
// a package, a raster step and a font, and would still produce these 95 bars.

/** An EAN-13 is thirteen digits: twelve of data and the check digit. */
export const EAN13_LENGTH = 13;

/** Start guard + 6 left digits + centre guard + 6 right digits + end guard. */
export const EAN13_MODULES = 95;

/**
 * Tidy a code as it was typed or pasted before judging it.
 *
 * THE APOSTROPHE IS REAL, NOT DEFENSIVE. The owner's article file carries
 * `126x25x2` as `'8720847172297` — Excel's text prefix, which stops the sheet
 * turning a thirteen-digit code into 8.72085E+12 and which has leaked onto the
 * printed label. Anyone re-pasting from that sheet pastes the apostrophe with
 * it, so it is stripped here rather than being refused as "not a digit"
 * thirteen times a day. Whitespace goes for the same reason: a code read aloud
 * and typed back arrives as "8720 8471 7222 8".
 *
 * Nothing else is stripped. A hyphen or a letter is a different kind of code,
 * not a dirty EAN, and quietly deleting it would hide the real mistake.
 */
export function normaliseEan(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .trim()
    .replace(/^['`‘’]+/, "")   // Excel's text prefix, straight or curly
    .replace(/\s+/g, "")
    .trim();
}

const isDigits = (s: string): boolean => /^[0-9]+$/.test(s);

/**
 * The thirteenth digit for the first twelve: odd positions once, even
 * positions three times, then up to the next ten.
 *
 * Returns -1 when the input is not exactly twelve digits, so a caller that
 * skipped normaliseEan cannot get a plausible-looking answer from rubbish.
 */
export function eanCheckDigit(first12: string): number {
  const s = String(first12 ?? "");
  if (s.length !== 12 || !isDigits(s)) return -1;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    // Position 1 is weight 1, position 2 is weight 3, alternating.
    sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** Thirteen digits whose last one is the check digit of the first twelve. */
export function isValidEan13(raw: unknown): boolean {
  const s = normaliseEan(raw);
  if (s.length !== EAN13_LENGTH || !isDigits(s)) return false;
  return eanCheckDigit(s.slice(0, 12)) === Number(s[12]);
}

export interface EanVerdict {
  /** True when there is nothing to complain about — INCLUDING a blank code:
   *  an article need not have a barcode, and a crate of one simply prints
   *  without bars (answer 4). */
  ok: boolean;
  /** The tidied code, or null when nothing was typed. */
  value: string | null;
  /** What to show the person who typed it, or null when ok. */
  message: string | null;
}

/**
 * Judge a code and SAY WHAT IS WRONG WITH IT.
 *
 * This sentence is the reason the check is in code at all. "Invalid barcode"
 * sends someone back to the customer's sheet to compare thirteen digits by
 * eye; "the check digit should be 8, not 3" points at the digit.
 */
export function describeEan(raw: unknown): EanVerdict {
  const s = normaliseEan(raw);
  if (!s) return { ok: true, value: null, message: null };

  if (!isDigits(s)) {
    const bad = Array.from(s).find((c) => !/[0-9]/.test(c));
    return {
      ok: false, value: s,
      message: `A barcode is thirteen digits — "${bad}" is not one of them.`,
    };
  }

  if (s.length !== EAN13_LENGTH) {
    // Twelve digits is the common paste: the sheet's column was cut before the
    // check digit. Work it out and offer the whole code rather than counting.
    if (s.length === 12) {
      const d = eanCheckDigit(s);
      return {
        ok: false, value: s,
        message: `A barcode is thirteen digits and this one has twelve — the missing check digit is ${d}, so the full code is ${s}${d}.`,
      };
    }
    return {
      ok: false, value: s,
      message: `A barcode is thirteen digits and this one has ${s.length}.`,
    };
  }

  const want = eanCheckDigit(s.slice(0, 12));
  const got = Number(s[12]);
  if (want !== got) {
    return {
      ok: false, value: s,
      message: `The check digit should be ${want}, not ${got} — ${s.slice(0, 12)}${want} is the code these twelve digits make.`,
    };
  }
  return { ok: true, value: s, message: null };
}

// ────────────────────────────── the bars ─────────────────────────────────────
// EAN-13's three alphabets. L and G carry the left half, R the right; the
// FIRST digit is not drawn at all — it is carried by which of the left six use
// G, which is why an EAN-13 fits in the same 95 modules as a UPC-A.

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];

/** Which of the left six digits are drawn in G, per the leading digit. */
const PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

export const EAN13_GUARD = "101";
export const EAN13_CENTRE = "01010";

const push = (out: number[], bits: string): void => { for (const b of bits) out.push(b === "1" ? 1 : 0); };

/**
 * The 95 modules of an EAN-13, left to right, 1 = bar and 0 = space.
 *
 * Null when the code is not a valid EAN-13 — the caller then prints the label
 * without bars rather than printing bars that scan as something else. A wrong
 * barcode on a crate is worse than no barcode on a crate: no barcode is read
 * by a human, a wrong one is read by a machine at the customer's gate.
 */
export function ean13Bars(raw: unknown): number[] | null {
  const s = normaliseEan(raw);
  if (!isValidEan13(s)) return null;
  const digits = Array.from(s, Number);
  const parity = PARITY[digits[0]];
  const out: number[] = [];
  push(out, EAN13_GUARD);
  for (let i = 0; i < 6; i++) push(out, (parity[i] === "L" ? L : G)[digits[i + 1]]);
  push(out, EAN13_CENTRE);
  for (let i = 0; i < 6; i++) push(out, R[digits[i + 7]]);
  push(out, EAN13_GUARD);
  return out;
}

/**
 * The code split the way it is printed under the bars: the leading digit
 * outside the guard, then the two groups of six.
 */
export function ean13Text(raw: unknown): { lead: string; left: string; right: string } | null {
  const s = normaliseEan(raw);
  if (!isValidEan13(s)) return null;
  return { lead: s.slice(0, 1), left: s.slice(1, 7), right: s.slice(7) };
}

// ─────────────────────── how big the bars are printed ────────────────────────
// AN EAN-13 IS A SPECIFIED SIZE, NOT A PICTURE THAT SCALES. Its nominal module
// is 0.33 mm and the symbol is only specified between magnification 0.80 and
// 2.00 of that. Printed outside the band a scanner may refuse to acquire it —
// and the refusal happens at the CUSTOMER'S gate, where nobody here can see it
// or fix it. A wrong-sized barcode is the same failure as a wrong barcode,
// arriving a fortnight later.
//
// This lives here, with the modules, rather than in pdf/labels.ts, because it
// is a property of the symbol and not of the page — and because it is then
// pure, so `node --test` can pin it.

/** One module at magnification 1.00, in millimetres. */
export const EAN13_MODULE_MM = 0.33;

/** The band the symbol is specified for. */
export const EAN13_MAGNIFICATION_MIN = 0.8;
export const EAN13_MAGNIFICATION_MAX = 2.0;

/**
 * What the crate label prints at.
 *
 * WHY 1.5 AND NOT 1.0. This label is read off a wooden crate in a yard by a
 * hand scanner held at arm's length, not at a supermarket till: the wider
 * module survives a scuffed sleeve, a dusty lens and a bit of distance. It is
 * comfortably inside the band, unlike the 2.24× the first cut of the label
 * printed (a flat 2.1 pt module), which was over the top of it.
 */
export const EAN13_LABEL_MAGNIFICATION = 1.5;

/** The clear paper the symbol needs on each side. Without it the scanner
 *  cannot tell where the code begins and reads a short code or none — so the
 *  quiet zones are drawn as part of the symbol, never borrowed from whatever
 *  margin the page happens to have. */
export const EAN13_QUIET_LEFT_MODULES = 11;
export const EAN13_QUIET_RIGHT_MODULES = 7;

/** Modules of paper a drawn symbol occupies: quiet zone, bars, quiet zone. */
export const EAN13_DRAWN_MODULES = EAN13_QUIET_LEFT_MODULES + EAN13_MODULES + EAN13_QUIET_RIGHT_MODULES;

/** Is this magnification one the symbol is specified at? */
export function isEan13Magnification(m: unknown): boolean {
  const n = Number(m);
  return Number.isFinite(n) && n >= EAN13_MAGNIFICATION_MIN && n <= EAN13_MAGNIFICATION_MAX;
}

/** One module in millimetres at a magnification. */
export function ean13ModuleMm(magnification: number = EAN13_LABEL_MAGNIFICATION): number {
  return EAN13_MODULE_MM * magnification;
}

/** Millimetres of paper the symbol needs INCLUDING both quiet zones — what a
 *  label layout has to have room for before it prints one. */
export function ean13WidthMm(magnification: number = EAN13_LABEL_MAGNIFICATION): number {
  return EAN13_DRAWN_MODULES * ean13ModuleMm(magnification);
}
