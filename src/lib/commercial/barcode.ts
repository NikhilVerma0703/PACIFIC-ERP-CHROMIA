// EAN-13: the customer's barcode, checked, allocated, drawn and sized to the
// label it goes on. PURE — no Prisma, no Next, no library — so `node --test`
// loads it bare and so the label PDF can draw the bars as plain rectangles with
// nothing installed for it.
//
// Round four added the other half of the subject to the bottom of this file:
// where a NEW code comes from (answer 2 — the customer's GS1 prefix, the next
// item reference, the computed check digit, and the duplicate that stops all of
// it) and how big a label can be when it is pasted on the edge of a 2 cm slab
// (answer 3). Both are arithmetic over the same thirteen digits and the same
// module, which is why they live beside the check and the bars rather than in
// the route or the PDF that calls them.
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

// ─────────────── the customer's series: prefix, reference, next ──────────────
// WHERE A NEW BARCODE COMES FROM (round four, answer 2: "how are barcodes made?
// make in similar way only. autogenerate"). Every code on the customer's sheet
// is built of the same three parts —
//
//     8720847 17222 8      8720847  the CUSTOMER'S GS1 company prefix
//     8720847 17223 5        17222  the item reference, one per article
//     8720847 17224 2            8  the check digit, computed and never typed
//
// — so a code we allocate is those parts with the next reference in the middle,
// and the series he sent simply continues.
//
// NOTHING HERE MAY ASSUME SEVEN DIGITS OF PREFIX. GS1 issues company prefixes
// between six and eleven digits, and the length says how big the company is, so
// the next customer's will not be the same length as this one's. The item
// reference therefore takes whatever is left of the twelve data digits: five
// under a seven-digit prefix, three under a nine-digit one. A hard-coded five
// would produce a thirteen-digit string for the next customer that is not their
// code at all, and it would be discovered at their gate.

/** Digits of an EAN-13 that carry data; the thirteenth is the check digit. */
export const EAN13_DATA_DIGITS = 12;

/** What GS1 issues, and what scripts/0082's CHECK allows on gs1_prefix. */
export const GS1_PREFIX_MIN_DIGITS = 6;
export const GS1_PREFIX_MAX_DIGITS = 11;

export interface Gs1PrefixVerdict {
  ok: boolean;
  /** The tidied prefix, or null when nothing was typed. */
  value: string | null;
  /** Digits left for the item reference. 0 when the prefix is unusable. */
  refWidth: number;
  /** How many articles that leaves room for: references 0 to capacity - 1. */
  capacity: number;
  /** What to show the person who typed it, or null when ok. */
  message: string | null;
}

/**
 * Judge a client's GS1 company prefix and say how much room it leaves.
 *
 * A BLANK PREFIX IS NOT OK HERE, unlike a blank barcode. An article may live
 * without a code and its crate simply prints without bars, but there is only
 * one reason to ask for a prefix — to build a code out of it — so "none on
 * file" is an answer somebody has to be shown rather than a quiet zero.
 *
 * The prefix is tidied by normaliseEan because it arrives from the same
 * spreadsheets the codes do, apostrophe and all.
 */
export function describeGs1Prefix(raw: unknown): Gs1PrefixVerdict {
  const s = normaliseEan(raw);
  if (!s) {
    return {
      ok: false, value: null, refWidth: 0, capacity: 0,
      message: "This client has no GS1 company prefix on file, so there is no series to allocate a barcode from.",
    };
  }
  if (!isDigits(s)) {
    const bad = Array.from(s).find((c) => !/[0-9]/.test(c));
    return {
      ok: false, value: s, refWidth: 0, capacity: 0,
      message: `A GS1 company prefix is digits only — "${bad}" is not one of them.`,
    };
  }
  if (s.length < GS1_PREFIX_MIN_DIGITS || s.length > GS1_PREFIX_MAX_DIGITS) {
    return {
      ok: false, value: s, refWidth: 0, capacity: 0,
      message: `A GS1 company prefix is ${GS1_PREFIX_MIN_DIGITS} to ${GS1_PREFIX_MAX_DIGITS} digits and this one has ${s.length} — the item reference takes the rest of the twelve.`,
    };
  }
  const refWidth = EAN13_DATA_DIGITS - s.length;
  return { ok: true, value: s, refWidth, capacity: 10 ** refWidth, message: null };
}

/** Digits the item reference has under this prefix; 0 when it is unusable. */
export function gs1ItemRefWidth(prefix: unknown): number {
  return describeGs1Prefix(prefix).refWidth;
}

/** A reference as it arrives: a number, Prisma's BigInt, or a typed string. */
function refNumber(v: unknown): number | null {
  if (typeof v === "bigint") {
    if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(v);
  }
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Thirteen digits, tidied, or null — the shape the column stores, which is
 *  not the same thing as a code whose check digit adds up. */
function digits13(raw: unknown): string | null {
  const s = normaliseEan(raw);
  return s.length === EAN13_LENGTH && isDigits(s) ? s : null;
}

/**
 * Prefix plus item reference plus the computed check digit.
 *
 * Null when the prefix is not a usable one or the reference does not fit the
 * digits it has left. A short reference is padded with leading zeros, but one
 * that is too long cannot be shortened without becoming a different article's
 * code, so it is refused rather than trimmed to fit.
 */
export function composeEan13(prefix: unknown, ref: number | bigint | string): string | null {
  const p = describeGs1Prefix(prefix);
  if (!p.ok || p.value === null) return null;
  const n = refNumber(ref);
  if (n === null || n >= p.capacity) return null;
  const first12 = p.value + String(n).padStart(p.refWidth, "0");
  const check = eanCheckDigit(first12);
  if (check < 0) return null;
  return `${first12}${check}`;
}

/**
 * The item reference inside a code, for a client whose prefix is known. Null
 * when the code is not under that prefix — which is how a list of every EAN in
 * the table is narrowed to one client's series before the highest is taken.
 *
 * THE CHECK DIGIT IS NOT REQUIRED TO ADD UP. The column's CHECK constraint says
 * only that there are thirteen digits, so a code copied off a customer's sheet
 * with one digit wrong is storable, and it still says which reference they
 * meant to spend. Ignoring it would let the allocator hand that reference out a
 * second time, which is the failure this whole answer exists to prevent; the
 * mistyped digit is a separate thing, for describeEan to complain about at the
 * form where it was typed.
 */
export function itemRefUnderPrefix(prefix: unknown, ean: unknown): number | null {
  const p = describeGs1Prefix(prefix);
  if (!p.ok || p.value === null) return null;
  const s = digits13(ean);
  if (s === null || !s.startsWith(p.value)) return null;
  return Number(s.slice(p.value.length, EAN13_DATA_DIGITS));
}

/** The highest reference this prefix has spent, or null when it has spent
 *  none. What "above the highest reference in use" is measured against. */
export function highestItemRefInUse(prefix: unknown, eans: Iterable<unknown>): number | null {
  let highest: number | null = null;
  for (const ean of eans) {
    const ref = itemRefUnderPrefix(prefix, ean);
    if (ref !== null && (highest === null || ref > highest)) highest = ref;
  }
  return highest;
}

export interface EanAllocationInput {
  /** commercial_client_barcode.gs1Prefix — the CUSTOMER'S own prefix. */
  prefix: unknown;
  /** Every code already stored. Codes under other prefixes are ignored, so
   *  the caller may pass the whole column rather than filtering it first. */
  inUse?: Iterable<unknown> | null;
  /** commercial_client_barcode.nextRef. A FLOOR, not a counter. */
  floor?: number | bigint | string | null;
}

export interface EanAllocation {
  ok: boolean;
  /** The code to store, or null when none could be allocated. */
  ean: string | null;
  /** The reference inside it, or null. */
  ref: number | null;
  /** What to write back to nextRef. Passing this in as the floor of the next
   *  call is what makes allocating a run of blank articles safe without
   *  re-reading the table in between. */
  nextFloor: number | null;
  /** Why there is no code, or null when there is one. */
  message: string | null;
}

/**
 * The next code for a client: their prefix, the next free item reference, the
 * computed check digit.
 *
 * IT NEVER REUSES A GAP. His series skips 17227 and the allocator does not fill
 * it. A gap is far more likely to be a code the customer allocated somewhere we
 * cannot see — printed on stock that shipped before this system existed, or
 * sold through a channel that never sent us the sheet — than a free slot, and a
 * reissued EAN is the same failure as a duplicate one, discovered at the
 * customer's gate a fortnight later. All a skipped gap costs is a number, and
 * numbers under a seven-digit prefix are not scarce.
 *
 * THE FLOOR IS A FLOOR, NOT A COUNTER. nextRef and the highest reference
 * actually in use are compared and the greater wins, so a code typed in by hand
 * above the counter cannot be handed out a second time, and deleting the last
 * article cannot rewind the series onto a number already printed on a crate.
 */
export function allocateEan13(input: EanAllocationInput): EanAllocation {
  const none = { ok: false, ean: null, ref: null, nextFloor: null };
  const p = describeGs1Prefix(input.prefix);
  if (!p.ok || p.value === null) return { ...none, message: p.message };

  const highest = highestItemRefInUse(p.value, input.inUse ?? []);
  const floor = refNumber(input.floor) ?? 0;
  const ref = Math.max(floor, highest === null ? 0 : highest + 1);

  if (ref >= p.capacity) {
    const first = "".padStart(p.refWidth, "0");
    const last = String(p.capacity - 1).padStart(p.refWidth, "0");
    return {
      ...none,
      message: `The item references under GS1 prefix ${p.value} run from ${first} to ${last} and the series has reached the end, so there is no next code to give — this client needs a second company prefix from GS1.`,
    };
  }

  const ean = composeEan13(p.value, ref);
  if (ean === null) {
    // Unreachable as the lines above stand: the prefix has just been judged and
    // the reference has just been bounded by its capacity. The branch is here
    // because composeEan13 answers null rather than throwing, and a bare `!`
    // would make this the one place where a later change to either of them
    // quietly handed a malformed code to the printer.
    return { ...none, message: `Prefix ${p.value} and reference ${ref} do not make a code.` };
  }
  return { ok: true, ean, ref, nextFloor: ref + 1, message: null };
}

export interface EanRow {
  id: string;
  ean: unknown;
  /** What to call this row in the sentence. His collision is between two sizes
   *  of one design, so "220x19.5x2" is the useful name; an item code does as
   *  well. Falls back to the id, which at least identifies a row. */
  label?: string | null;
}

export interface EanCollision {
  /** The code more than one row claims. */
  ean: string;
  /** Every row claiming it, in the order they were given. */
  rows: EanRow[];
  /** The sentence, ready to store in eanBlockedReason and to show on the
   *  screen that refuses to print. */
  message: string;
}

const rowName = (r: EanRow): string => {
  const label = r.label === null || r.label === undefined ? "" : String(r.label).trim();
  return label || String(r.id);
};

/**
 * The codes claimed by more than one article.
 *
 * HIS OWN FILE BREAKS THE RULE: 220x19.5x2 and 220x15x2 both read
 * 8720847172266. Round four, answer 2 makes the EAN unique in the database, so
 * the losing row is stored WITHOUT a code and with a sentence saying why — and
 * while any article of a client carries that sentence, none of that client's
 * barcodes are generated and none are printed. This function produces the
 * sentence, so the form that refuses an edit, the allocator's caller and the
 * label screen all name the same two articles in the same words.
 *
 * Codes are compared as normaliseEan leaves them, and validity is not required:
 * two rows carrying the same mistyped thirteen digits are the same collision as
 * two carrying the same good ones, and the database's unique index will not
 * care either. A blank code is not a claim and never collides.
 */
export function findEanCollisions(rows: Iterable<EanRow>): EanCollision[] {
  const byEan = new Map<string, EanRow[]>();
  for (const row of rows) {
    const ean = normaliseEan(row.ean);
    if (!ean) continue;
    const seen = byEan.get(ean);
    if (seen) seen.push(row);
    else byEan.set(ean, [row]);
  }

  const out: EanCollision[] = [];
  for (const [ean, claiming] of byEan) {
    if (claiming.length < 2) continue;
    const names = claiming.map(rowName);
    const on = names.length === 2
      ? `both ${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    out.push({
      ean,
      rows: claiming,
      message: `${ean} is on ${on}. One of them has to give it up before any barcode for this client is generated or printed.`,
    });
  }
  return out;
}

// ──────────────── the label pasted on the edge of a 2 cm slab ────────────────
// ROUND FOUR, ANSWER 3: "we have to paste it on a 2cm slab so lower than 2cm
// width. Length can be anything proportional." This is not the 100 x 70 crate
// label. It goes on the EDGE of the piece, so its short dimension is bounded by
// the stone's thickness — 20 mm — and its length is free.
//
// THE ARITHMETIC SAYS TRUNCATION IS FORCED, SO THE ONLY QUESTION IS HOW MUCH.
// An EAN-13 at magnification 1.00 is 22.85 mm of bars with about 2.75 mm of
// digits under them. The symbol is specified no smaller than magnification
// 0.80, and even down there it is 22.85 x 0.80 = 18.28 mm of bars plus
// 2.75 x 0.80 = 2.20 mm of digits, which is 20.48 mm — taller than the slab is
// thick, before a single millimetre of margin is allowed for. Every larger
// magnification is taller still. There is therefore NO magnification anywhere
// in the legal band at which a full-height EAN-13 fits on a 20 mm edge, and
// shrinking the module to buy height is not a trade that exists.
//
// SO THE BARS ARE SHORTENED AND THE MODULE IS NOT. Bar height is the one
// dimension of an EAN-13 that costs aiming tolerance rather than the read
// itself: a handheld scanner sweeps a line across the bars, and shorter bars
// mean the operator has to hold it straighter, not that the code fails. Module
// width is what decides whether the code can be resolved at all. Since the
// length is free there is nothing to be bought by touching it, so the
// magnification stays at 1.50, where the crate label already had it, and the
// height is cut to whatever the edge allows.
//
// This is a known deviation from the GS1 height specification, chosen on
// purpose and written down in DECISIONS-4.md, so that when a customer's scanner
// is fussy the first question asked is about magnification and quiet zones and
// not about why the bars are short.

/** Bar height of an EAN-13 at magnification 1.00, in millimetres. */
export const EAN13_BAR_HEIGHT_MM = 22.85;

/** The human-readable digits under the bars at magnification 1.00. */
export const EAN13_DIGITS_HEIGHT_MM = 2.75;

/** Stone left bare above and below the label. A label cut to the full 20 mm
 *  would have to be placed on the arris to the millimetre and would lift at its
 *  edges; 2 mm is what lets somebody paste it straight by hand. */
export const EDGE_LABEL_CLEARANCE_MM = 2;

/** White paper between the edge of the label and anything printed on it. */
export const EDGE_LABEL_MARGIN_MM = 1;

/**
 * The band the human-readable digits get on the edge label.
 *
 * WHY THEY DO NOT SCALE WITH THE MAGNIFICATION, when everything else here does.
 * At 1.50 the specified digit height is 4.13 mm, which on an 18 mm label is
 * nearly a quarter of everything there is, spent on a line of text that is read
 * only in the one case where the scanner will not read at all and somebody
 * types the thirteen digits in by hand. Every millimetre taken off it goes to
 * the bars, which is where the read actually lives, so the band is fixed at
 * 2.6 mm — a shade under the 2.75 mm nominal, and still comfortably legible.
 */
export const EDGE_LABEL_DIGITS_MM = 2.6;

/** Bars shorter than this are not printed at all. Truncation buys aiming
 *  tolerance down to a point and then stops buying anything: below roughly six
 *  millimetres a hand scanner sweeping across the symbol cannot stay inside it
 *  long enough to decode, and a label that scans as nothing is worse than a
 *  label that was never printed, because somebody trusted it. */
export const EDGE_LABEL_MIN_BAR_MM = 6;

/** Millimetres, to the thousandth. These sums run through floating point and
 *  18 mm arrives as 17.999999999999996; no printer resolves anything finer than
 *  a hundredth, so the rounding costs nothing and the parts add up to the
 *  whole, which is what the layout is checked against. */
const mm = (n: number): number => Math.round(n * 1000) / 1000;

export interface EdgeLabel {
  /** The thickness the label was laid out for, in millimetres. */
  thicknessMm: number;
  magnification: number;
  /** One module, in millimetres — what the bars are drawn from. */
  moduleMm: number;
  /** Margin, bars, digits, margin. */
  heightMm: number;
  /** Margin, symbol with both its quiet zones, margin. */
  lengthMm: number;
  marginMm: number;
  barHeightMm: number;
  digitsHeightMm: number;
  /** The symbol and its quiet zones, without the label's margins. */
  symbolWidthMm: number;
  /** The bar height this magnification is specified at. */
  fullBarHeightMm: number;
  truncated: boolean;
  /** Millimetres of bar given up against fullBarHeightMm; 0 when not cut. */
  truncatedByMm: number;
  /**
   * The bar height as a percentage of the 22.85 mm NOMINAL height — the 59%
   * DECISIONS-4.md records for the 20 mm edge, and the number a conversation
   * with GS1 or with a customer's quality desk is had in.
   *
   * It is measured against magnification 1.00 and not against this label's own
   * magnification, so on thick stock it reads over 100 while the symbol is
   * still truncated: a 30 mm edge gets 23.4 mm of bars, which is 102% of
   * nominal and still well under the 34.28 mm that 1.50 is specified at. The
   * millimetres actually given up are truncatedByMm.
   */
  percentOfNominalHeight: number;
}

export type EdgeLabelResult =
  | { ok: true; label: EdgeLabel; reason: null }
  | { ok: false; label: null; reason: string };

/**
 * Lay out the edge label for a piece of a given thickness, in millimetres.
 *
 * The height follows the stone: a 30 mm article gets a taller label and less
 * truncation without anybody choosing it, and stock thick enough to carry the
 * whole symbol — 40.875 mm at magnification 1.50 — simply stops being
 * truncated, the label then being as tall as the symbol rather than as tall as
 * the edge. The length is whatever the symbol and its quiet zones need, because
 * the answer said the length can be anything.
 *
 * It REFUSES rather than throwing, and rather than printing a stub, because a
 * caller printing the labels for a crate has to be able to say "this article is
 * too thin for an edge label, put its barcode on the crate label" in the same
 * breath as printing the rest of them.
 */
export function edgeLabelLayout(
  thicknessMm: unknown,
  magnification: number = EAN13_LABEL_MAGNIFICATION,
): EdgeLabelResult {
  const t = Number(thicknessMm);
  if (!Number.isFinite(t) || t <= 0) {
    return {
      ok: false, label: null,
      reason: "Give the thickness of the piece in millimetres — the label is pasted on its edge, so the edge is what decides the label.",
    };
  }
  if (!isEan13Magnification(magnification)) {
    return {
      ok: false, label: null,
      reason: `An EAN-13 is only specified between magnification ${EAN13_MAGNIFICATION_MIN} and ${EAN13_MAGNIFICATION_MAX}, and ${magnification} is outside that — a scanner may refuse to acquire it at all.`,
    };
  }

  const m = Number(magnification);
  const fullBar = EAN13_BAR_HEIGHT_MM * m;
  const room = t - EDGE_LABEL_CLEARANCE_MM - 2 * EDGE_LABEL_MARGIN_MM - EDGE_LABEL_DIGITS_MM;
  const bar = Math.min(room, fullBar);

  if (bar < EDGE_LABEL_MIN_BAR_MM) {
    const left = room > 0 ? `${mm(room)} mm` : "nothing at all";
    return {
      ok: false, label: null,
      reason: `A ${mm(t)} mm edge leaves ${left} for the bars once the label's clearance, margins and digits are taken off, and under ${EDGE_LABEL_MIN_BAR_MM} mm of bars an EAN-13 scans as nothing — print this one's barcode on the crate label instead of the edge.`,
    };
  }

  return {
    ok: true,
    reason: null,
    label: {
      thicknessMm: mm(t),
      magnification: m,
      moduleMm: mm(ean13ModuleMm(m)),
      heightMm: mm(bar + EDGE_LABEL_DIGITS_MM + 2 * EDGE_LABEL_MARGIN_MM),
      lengthMm: mm(ean13WidthMm(m) + 2 * EDGE_LABEL_MARGIN_MM),
      marginMm: EDGE_LABEL_MARGIN_MM,
      barHeightMm: mm(bar),
      digitsHeightMm: EDGE_LABEL_DIGITS_MM,
      symbolWidthMm: mm(ean13WidthMm(m)),
      fullBarHeightMm: mm(fullBar),
      truncated: bar < fullBar - 1e-9,
      truncatedByMm: mm(Math.max(0, fullBar - bar)),
      percentOfNominalHeight: Math.round((bar / EAN13_BAR_HEIGHT_MM) * 100),
    },
  };
}
