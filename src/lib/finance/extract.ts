// Field extraction from OCR text — ported from automation/app/extract.py.
// (The GSTIN find/repair half of that file already lives in ./gstin.ts.)
//
// Rule-based, no model. Indian commercial bills follow strong conventions —
// GSTIN has a checksummable 15-character format, tax lines are labelled CGST/
// SGST/IGST, totals are labelled, dates come in a handful of formats — and
// those conventions carry far more signal than any general-purpose extractor.
//
// Design principles, both learned from the sample bills:
//
//   1. Every field carries its own confidence and the OCR span it came from.
//      A bill is rarely uniformly readable; the total may be crisp while the
//      invoice number is mush. Per-field confidence lets the UI highlight
//      exactly what needs checking instead of flagging the whole bill.
//
//   2. Cross-field arithmetic is a confidence signal, not just a validation.
//      If taxable + cgst + sgst + round_off == net, all four numbers are
//      almost certainly right even when OCR confidence was mediocre. This
//      recovers a lot of accuracy on bad photos and is the cheapest check in
//      the file.
//
// Pure logic: no Prisma, no fs, no network. Callers own storage.

import { cleanAmount, findGstin } from "./gstin.ts";

// ---------------------------------------------------------------------------
// Field / Extraction shapes
//
// These mirror the Python dataclasses byte for byte in their JSON form: the
// office UI and the voucher builder were written against exactly these keys,
// so the port keeps the snake_case names rather than "improving" them.
// ---------------------------------------------------------------------------

export interface Field<T = unknown> {
  value: T | null;
  confidence: number;
  /** The OCR text this came from. */
  source: string;
  /** Which rule fired. */
  method: string;
}

export function makeField<T>(
  value: T | null = null, confidence = 0, source = "", method = "",
): Field<T> {
  return { value, confidence, source, method };
}

/** Python's `Field.__bool__`: a field counts only when it holds a value.
 *  Confidence 0 with a value is still "present"; confidence 0.9 on a null
 *  value is nothing. */
export function hasValue<T>(f: Field<T>): f is Field<T> & { value: T } {
  return f.value !== null && f.value !== undefined;
}

export interface LineItem {
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface Extraction {
  vendor_name: Field<string>;
  vendor_gstin: Field<string>;
  invoice_no: Field<string>;
  /** ISO yyyy-mm-dd. */
  invoice_date: Field<string>;
  taxable_value: Field<number>;
  cgst: Field<number>;
  sgst: Field<number>;
  igst: Field<number>;
  round_off: Field<number>;
  net_amount: Field<number>;
  hsn_sac: Field<string>;
  line_items: LineItem[];
  arithmetic_ok: boolean;
  notes: string[];
}

export function newExtraction(): Extraction {
  return {
    vendor_name: makeField<string>(),
    vendor_gstin: makeField<string>(),
    invoice_no: makeField<string>(),
    invoice_date: makeField<string>(),
    taxable_value: makeField<number>(),
    cgst: makeField<number>(),
    sgst: makeField<number>(),
    igst: makeField<number>(),
    round_off: makeField<number>(),
    net_amount: makeField<number>(),
    hsn_sac: makeField<string>(),
    line_items: [],
    arithmetic_ok: false,
    notes: [],
  };
}

/** Weighted by how much each field matters for a voucher. */
export function overallConfidence(ex: Extraction): number {
  const weights: ReadonlyArray<readonly [keyof Extraction, number]> = [
    ["net_amount", 3.0], ["vendor_name", 2.0], ["invoice_date", 2.0],
    ["invoice_no", 1.5], ["vendor_gstin", 1.5], ["taxable_value", 1.0],
    ["cgst", 0.5], ["sgst", 0.5], ["igst", 0.5],
  ];
  let total = 0;
  let got = 0;
  for (const [k, w] of weights) {
    const f = ex[k] as Field;
    total += w;
    got += w * (hasValue(f) ? f.confidence : 0);
  }
  let base = total ? got / total : 0;
  if (ex.arithmetic_ok) base = Math.min(1.0, base + 0.15);
  return pyRound(base, 3);
}

// ---------------------------------------------------------------------------
// Python-compatibility helpers
//
// The confidences and note strings this module emits are compared (by tests
// and by clerks doing before/after checks) against the Python engine's, so
// the handful of places where Python and JS format or round differently get
// explicit shims instead of near-enough approximations.
// ---------------------------------------------------------------------------

/** Python's round(): round-half-even. Exact halves are rare on OCR-derived
 *  floats, but confidence arithmetic does land on clean halves, and a
 *  confidence that differs from the Python engine's in the third decimal
 *  would look like a porting bug forever after. */
function pyRound(x: number, digits: number): number {
  const p = 10 ** digits;
  const shifted = x * p;
  const floor = Math.floor(shifted);
  const diff = shifted - floor;
  if (diff > 0.5) return (floor + 1) / p;
  if (diff < 0.5) return floor / p;
  return (floor % 2 === 0 ? floor : floor + 1) / p;
}

/** Python's str(float): integral floats render as "2214.0", not "2214".
 *  Only used inside human-readable source/note strings; JS and CPython agree
 *  on the shortest-round-trip digits for everything non-integral. */
function pyFloatStr(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

/** Python's "{:,.2f}" — thousands separators, two decimals. */
function commaFmt2(n: number): string {
  const [int, frac] = n.toFixed(2).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + frac;
}

/** Python's "{:g}" — up to 6 significant digits, trailing zeros stripped.
 *  Only fuel rates (60–145) and volumes (1.5–400) pass through here, so the
 *  exponent branch %g switches to outside [1e-4, 1e6) is unreachable. */
function gFmt(n: number): string {
  let s = n.toPrecision(6);
  if (s.includes("e")) return s;
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** Python's str.splitlines() for the newline flavours OCR text contains:
 *  no trailing empty element for a trailing newline, [] for "". */
function splitLines(text: string): string[] {
  if (!text.length) return [];
  const parts = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\u0085\u2028\u2029]/);
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Python's str.strip(chars): shave the given characters off both ends. */
function stripChars(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function countLetters(s: string): number {
  // Python uses str.isalpha(), which is Unicode-aware — a Devanagari
  // letterhead counts as letters there, so it must here too.
  return (s.match(/\p{L}/gu) ?? []).length;
}

function countDigits(s: string): number {
  return (s.match(/\p{Nd}/gu) ?? []).length;
}

// ---------------------------------------------------------------------------
// partial_ratio, by hand
//
// The Python engine leans on rapidfuzz.fuzz.partial_ratio for label matching,
// and every threshold in TOTAL_LABELS below was tuned against that exact
// scorer. A scorer with slightly different window semantics would shift all
// of them silently, so this is a faithful reimplementation, pinned by tests
// against values taken from rapidfuzz itself.
//
// What rapidfuzz actually computes (verified empirically, 4000 random pairs,
// zero mismatches): the best Indel similarity — 2·LCS/(len_a+len_b), the same
// "ratio" dedupe.ts uses — between the needle and
//
//     * every prefix of the haystack shorter than the needle,
//     * every needle-length window of the haystack,
//     * every suffix of the haystack shorter than the needle,
//
// i.e. the needle may hang off either edge, but mid-string windows are always
// exactly needle-length. That last property matters: it is why the label
// table needs an explicit "mount:" entry — inside a long line, "amount"
// against the fragment "mount:" only ever sees 6-char windows and scores 83,
// but at the START of a line the prefix windows kick in and "amount" vs
// "mount" scores 90.9. Reproducing rapidfuzz means reproducing exactly which
// bills each label catches.
//
// The LCS inside each window is computed bit-parallel (Hyyrö's algorithm):
// labels are at most 13 characters, so the whole DP row fits in one integer
// and each window costs O(window length) bit operations. That keeps the
// pathological case — a 50k-word bill collapsed into a single line, scanned
// by 24 labels — well under a second, where a naive DP per window would take
// tens of seconds.
// ---------------------------------------------------------------------------

const MAX_BIT_LEN = 30; // bits available for the single-word LCS row

function buildMasks(s: string): Map<string, number> {
  const pm = new Map<string, number>();
  for (let i = 0; i < s.length; i++) pm.set(s[i], (pm.get(s[i]) ?? 0) | (1 << i));
  return pm;
}

/** LCS length of the pattern behind `pm` (length m ≤ 30) vs hay[start:end). */
function lcsBit(pm: Map<string, number>, m: number, hay: string, start: number, end: number): number {
  const mask = (1 << m) - 1;
  let V = mask;
  for (let j = start; j < end; j++) {
    const t = V & (pm.get(hay[j]) ?? 0);
    // V + t stays below 2^31 because m ≤ 30, so plain addition is exact.
    V = ((V + t) | (V - t)) & mask;
  }
  let zeros = 0;
  let x = ~V & mask;
  while (x) { x &= x - 1; zeros++; }
  return zeros;
}

/** Two-row DP fallback for needles too long for the bit-parallel row. */
function lcsDp(a: string, b: string, start: number, end: number): number {
  const n = end - start;
  if (!a.length || n <= 0) return 0;
  let prev = new Uint32Array(n + 1);
  let cur = new Uint32Array(n + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[start + j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[n];
}

/** rapidfuzz.fuzz.ratio — normalised Indel similarity, 0–100. */
export function indelRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  if (!a.length || !b.length) return 0;
  const l = a.length <= MAX_BIT_LEN
    ? lcsBit(buildMasks(a), a.length, b, 0, b.length)
    : lcsDp(a, b, 0, b.length);
  return (200 * l) / (a.length + b.length);
}

function partialImpl(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n === 0 ? 100 : 0;
  // 100 is achievable only by an exact occurrence (any shorter window caps
  // below 100), so indexOf doubles as both fast path and early exit.
  if (s2.includes(s1)) return 100;

  const pm = m <= MAX_BIT_LEN ? buildMasks(s1) : null;
  const lcs = (start: number, end: number): number =>
    pm ? lcsBit(pm, m, s2, start, end) : lcsDp(s1, s2, start, end);
  // Windows that end (or, for suffixes, begin) with a character the needle
  // does not contain can never beat their one-shorter neighbour, so they are
  // skipped outright — same optimisation rapidfuzz uses, and the reason a
  // label whose letters never appear in a line costs almost nothing.
  const charset = new Set(s1);
  let best = 0;
  const consider = (start: number, end: number): void => {
    const sim = (200 * lcs(start, end)) / (m + (end - start));
    if (sim > best) best = sim;
  };

  for (let i = 1; i < m; i++) if (charset.has(s2[i - 1])) consider(0, i);       // left edge
  for (let i = 0; i < n - m; i++) if (charset.has(s2[i + m - 1])) consider(i, i + m);
  for (let i = Math.max(0, n - m); i < n; i++) if (charset.has(s2[i])) consider(i, n); // right edge
  return best;
}

/** rapidfuzz.fuzz.partial_ratio — best-window Indel similarity, 0–100. */
export function partialRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  if (!a.length || !b.length) return 0;
  const [s1, s2] = a.length <= b.length ? [a, b] : [b, a];
  let best = partialImpl(s1, s2);
  // rapidfuzz quirk, kept: equal-length inputs are scored in both roles.
  if (best !== 100 && a.length === b.length) best = Math.max(best, partialImpl(s2, s1));
  return best;
}

function labelHit(lineLower: string, label: string, minScore: number): boolean {
  return partialRatio(label, lineLower) >= minScore;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const DATE_PATTERNS: ReadonlyArray<readonly [RegExp, "dmy" | "dmy2" | "ymd" | "dMy"]> = [
  [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g, "dmy"],
  [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/g, "dmy2"],
  [/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, "ymd"],
  [/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})\b/g, "dMy"],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

type AmountKey = "net_amount" | "round_off" | "taxable_value" | "cgst" | "sgst" | "igst";

// Label -> field, in priority order (most specific first), each with the
// minimum fuzzy score required to count as a hit.
//
// Fuzzy rather than exact, because OCR mangles labels constantly. Real
// examples from the sample bills: "Total Amcunt", "BillAmoun'",
// "Ttem Descrjtion", "Rounc Off". An exact regex misses every one of them;
// partial-ratio matching at 85 catches all four while still rejecting
// unrelated text.
// [label, field, min_fuzzy_score, require_decimals]
//
// require_decimals exists for the bare "amount" family. A pump printout is a
// column header row followed by a value row, and when OCR collapses them the
// label sits in a jumble of unrelated numbers:
//
//   "Societies "\MOUNT: VOLUME: RATE PRODUCT: DENSITy: NOZZLE VEHICLE INVOIce
//    NO: No 103 ye No: NO: 14 1200.00 DIESEL 8215 + 5 Noy 5 2017994 89 lL"
//
// Nothing positional can be trusted there. But of 103, 14, 1200.00, 8215,
// 2017994, 89 exactly one is written like money — 1200.00 — and that is the
// amount. So for these weak labels only a value with two decimal places
// counts. It also keeps the collided "Amount Volume : 91500. 4." case safe:
// no 2-decimal candidate, so nothing is claimed and the fuel/ceiling logic
// decides.
const TOTAL_LABELS: ReadonlyArray<readonly [string, AmountKey, number, boolean]> = [
  ["net amount", "net_amount", 86, false],
  ["bill amount", "net_amount", 86, false],
  ["grand total", "net_amount", 86, false],
  ["total amount", "net_amount", 86, false],
  ["amount payable", "net_amount", 88, false],
  ["net payable", "net_amount", 88, false],
  ["round off", "round_off", 85, false],
  ["rounded off", "round_off", 88, false],
  ["sub total", "taxable_value", 85, false],
  ["subtotal", "taxable_value", 88, false],
  ["taxable value", "taxable_value", 86, false],
  ["taxable amount", "taxable_value", 86, false],
  ["central gst", "cgst", 88, false],
  ["state gst", "sgst", 88, false],
  ["integrated gst", "igst", 88, false],
  ["cgst", "cgst", 90, false],
  ["sgst", "sgst", 90, false],
  ["igst", "igst", 90, false],
  ["total", "net_amount", 92, false],
  // Bare "amount", plus the mangled forms OCR actually produces. The leading
  // "A" is the character most often lost or turned into punctuation, so
  // "MOUNT" and "AMOUNI" are matched explicitly rather than hoped for.
  ["amount", "net_amount", 90, true],
  ["mount:", "net_amount", 90, true],
  ["amount:", "net_amount", 88, true],
  ["amt", "net_amount", 92, true],
];

// Lines whose numbers must never be read as money.
const NON_AMOUNT_LINE =
  /\b(phone|ph\b|mobile|contact|tel|fssai|gstin|gst\s*no|pan|bill\s*no|invoice\s*no|kot|table|covers|time|user|cashier|hsn|sac|fax|pin)\b/i;

const INVOICE_LABELS: readonly RegExp[] = [
  /(?:tax\s*)?invoice\s*(?:no|number|#)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})/i,
  /\bbill\s*(?:no|number|#)\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})/i,
  /\binv\s*(?:no|#)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})/i,
  /\breceipt\s*(?:no|#)\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})/i,
  /\bdoc(?:ument)?\s*(?:no|#)\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})/i,
];

const HSN_RE = /\b(?:hsn|sac)\s*(?:\/\s*sac)?\s*(?:code)?\s*[:.\-]?\s*(\d{4,8})\b/i;

const NOISE_PREFIXES = /^[^A-Za-z0-9]+/;

// A staff reimbursement above this is implausible — a meal, a tank of fuel, a
// courier docket. When the only candidate exceeds it, the right answer is to
// leave the field blank and say so, not to post a number that is wrong by
// 100x.
export const MAX_PLAUSIBLE_AMOUNT = 50_000.0;

// Below this, a 2-decimal number on a receipt is more likely a rate, a litre
// count or a tax component than the total being claimed.
export const MIN_MONEY_AMOUNT = 20.0;

// ---------------------------------------------------------------------------
// Fuel receipt triangulation
//
// Fuel bills are the worst offenders in the sample set: the pump printer
// packs Amount, Rate, Volume and Preset into narrow columns that OCR
// collapses into a single run of digits. One real page read as:
//
//     "AmountcRs) Rate(Rs/i» Votumec,y Preset Type: : : : 0014.45 01500."
//
// No label survives, so no label-matching rule can work. But fuel bills carry
// something better than a label — an ARITHMETIC IDENTITY:
//
//     amount = rate x volume
//
// and the rate is tightly bounded in practice (Indian petrol/diesel sits
// around 90–110 Rs/litre). So the three numbers can be recovered by searching
// the page's numbers for a triple that satisfies the identity. On the page
// above this finds 103.00/L x 14.45 L = 1488, matching the 1500 printed —
// recovering the real total from text where no rule could read it.
//
// This is the kind of domain knowledge that substitutes for a model: free,
// offline, explainable, and provably right when it fires.
// ---------------------------------------------------------------------------

const FUEL_HINT =
  /\b(volume|litre|liter|ltrs?|nozzle|density|preset|petrol|diesel|hsd|fuel|pump|kg\/m3|rate\s*\(rs)/gi;

const FUEL_RATE_MIN = 60.0;
const FUEL_RATE_MAX = 145.0;    // Rs per litre, generously wide
const FUEL_VOLUME_MIN = 1.5;
const FUEL_VOLUME_MAX = 400.0;  // litres in one transaction
const FUEL_AMOUNT_MIN = 100.0;
const FUEL_TOLERANCE = 0.025;   // 2.5% — covers rounding + OCR

/** Two or more pump-specific words. One could be coincidence. */
export function looksLikeFuel(text: string): boolean {
  const seen = new Set<string>();
  for (const m of text.matchAll(FUEL_HINT)) seen.add(m[0].toLowerCase());
  return seen.size >= 2;
}

/**
 * Find amount = rate x volume among the numbers on a fuel bill.
 *
 * Returns the LARGEST satisfying triple, or null. Largest because a fuel
 * receipt's biggest figure is the amount charged, and small triples like
 * 103 x 1.00 = 103 are just the rate restated.
 */
export function triangulateFuelAmount(
  numbers: number[],
): { amount: number; explanation: string } | null {
  const uniq = [...new Set(numbers.map((n) => pyRound(n, 2)))].sort((a, b) => a - b);
  const rates = uniq.filter((n) => n >= FUEL_RATE_MIN && n <= FUEL_RATE_MAX);
  const volumes = uniq.filter((n) => n >= FUEL_VOLUME_MIN && n <= FUEL_VOLUME_MAX);
  if (!rates.length || !volumes.length) return null;

  let best: { amount: number; explanation: string } | null = null;
  for (const rate of rates) {
    for (const vol of volumes) {
      const product = rate * vol;
      if (product < FUEL_AMOUNT_MIN) continue;
      for (const amount of uniq) {
        if (amount < FUEL_AMOUNT_MIN || amount > MAX_PLAUSIBLE_AMOUNT) continue;
        if (Math.abs(amount - product) <= Math.max(2.0, product * FUEL_TOLERANCE)) {
          if (!best || amount > best.amount) {
            best = {
              amount,
              explanation: `${gFmt(rate)}/litre x ${gFmt(vol)} litres ` +
                `= ${commaFmt2(product)}, matching ${commaFmt2(amount)}`,
            };
          }
        }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** `lines` should be the grouped OCR lines from the OCR provider. */
export function extract(text: string, lines?: string[] | null, ocrConf = 60.0): Extraction {
  const ex = newExtraction();
  const ls = lines && lines.length ? lines : splitLines(text);
  const base = Math.max(0.30, Math.min(0.95, ocrConf / 100.0));

  extractGstinField(ex, text, base);
  extractInvoiceNo(ex, ls, base);
  extractDate(ex, text, base);
  extractAmounts(ex, ls, base);
  extractHsn(ex, text, base);
  extractVendor(ex, ls, base);
  extractLineItems(ex, ls);

  const pageAmounts: number[] = [];
  for (const line of ls) pageAmounts.push(...lineAmounts(line));
  checkArithmetic(ex, 1.5, pageAmounts);
  return ex;
}

function extractGstinField(ex: Extraction, text: string, base: number): void {
  const hit = findGstin(text);
  if (!hit) return;
  let conf: number;
  if (hit.method === "gstin_exact") {
    conf = Math.min(0.98, base + 0.25);
  } else if (hit.method === "gstin_repaired_checksum") {
    // Confidence falls as more characters had to be changed.
    conf = Math.max(0.45, Math.min(0.92, base + 0.15) - 0.06 * hit.edits);
  } else {
    conf = base * 0.45;
  }

  ex.vendor_gstin = makeField(hit.gstin, pyRound(conf, 3), hit.source, hit.method);
  if (hit.method === "gstin_repaired_checksum") {
    ex.notes.push(
      `GSTIN read as '${hit.source}', repaired to ${hit.gstin} ` +
      `(${hit.edits} character${hit.edits !== 1 ? "s" : ""} corrected, check digit verified)`,
    );
  } else if (hit.method === "gstin_format_only") {
    ex.notes.push(
      `Possible GSTIN ${hit.gstin} - correct format but the check digit fails, ` +
      "so please verify it against the bill",
    );
  }
}

function extractInvoiceNo(ex: Extraction, lines: string[], base: number): void {
  for (const rx of INVOICE_LABELS) {
    for (const line of lines) {
      const m = rx.exec(line);
      if (!m) continue;
      const val = stripChars(m[1], " .:-/");
      // Guard against swallowing a date or a bare tax rate.
      if (val.length < 2 || /^\d{1,2}[-/.]\d{1,2}$/.test(val)) continue;
      if (["no", "number", "date"].includes(val.toLowerCase())) continue;
      ex.invoice_no = makeField(val, base * 0.9, line.trim(), "label_match");
      return;
    }
  }
}

/** Prefer a date sitting next to a 'date' label; fall back to any plausible date. */
function extractDate(ex: Extraction, text: string, base: number): void {
  let best: { iso: string; score: number; src: string } | null = null;
  const maxYear = new Date().getFullYear() + 1;
  for (const [rx, kind] of DATE_PATTERNS) {
    for (const m of text.matchAll(rx)) {
      const d = parseDateGroups(m[1], m[2], m[3], kind);
      if (!d) continue;
      // Bills are recent; a 1998 date is an OCR artefact.
      if (!(d.y >= 2015 && d.y <= maxYear)) continue;
      const idx = m.index ?? 0;
      const window = text.slice(Math.max(0, idx - 30), idx).toLowerCase();
      const score = base * (window.includes("date") || window.includes("dt") ? 1.0 : 0.75);
      if (!best || score > best.score) {
        const iso = `${String(d.y).padStart(4, "0")}-${String(d.mo).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
        best = { iso, score, src: m[0] };
      }
    }
  }
  if (best) ex.invoice_date = makeField(best.iso, Math.min(0.95, best.score), best.src, "date_regex");
}

function daysInMonth(y: number, mo: number): number {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
}

function parseDateGroups(
  g1: string, g2: string, g3: string, kind: "dmy" | "dmy2" | "ymd" | "dMy",
): { y: number; mo: number; d: number } | null {
  let d: number;
  let mo: number;
  let y: number;
  if (kind === "dmy") {
    d = Number(g1); mo = Number(g2); y = Number(g3);
  } else if (kind === "dmy2") {
    d = Number(g1); mo = Number(g2); y = 2000 + Number(g3);
  } else if (kind === "ymd") {
    y = Number(g1); mo = Number(g2); d = Number(g3);
  } else {
    d = Number(g1);
    mo = MONTHS[g2.slice(0, 3).toLowerCase()] ?? 0;
    y = Number(g3);
    if (y < 100) y += 2000;
  }
  if (!mo) return null;
  // Year OCR repair: "30/06/7026" should be 2026. A 4-digit year outside the
  // plausible range but whose last two digits are plausible is almost always
  // a corrupted leading '2'.
  const maxYear = new Date().getFullYear() + 1;
  if ((kind === "dmy" || kind === "ymd") && !(y >= 2015 && y <= maxYear)) {
    if (y >= 1000 && y <= 9999 && 2000 + (y % 100) >= 2015 && 2000 + (y % 100) <= maxYear) {
      y = 2000 + (y % 100);
    }
  }
  // Indian bills are day-first. If the "day" cannot be a day but the "month"
  // can, they were swapped.
  if (d > 31 || mo > 12) {
    if (mo <= 31 && d <= 12) [d, mo] = [mo, d];
    else return null;
  }
  // Python's datetime() raises on impossible dates (29 Feb 2025); reproduce
  // that as a validity check so the caller falls through to "no date".
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, mo, d };
}

const NUM_TOKEN = /\d[\d,]*(?:\.\d{1,3})?/g;

/**
 * Every money-looking number on a line, left to right.
 *
 * Two OCR repairs live here, both from the sample bills:
 *
 *   "Total Amcunt 2108 28"  — the decimal point was lost. A trailing 2-digit
 *                             group separated only by whitespace is folded
 *                             back in, giving 2108.28.
 *   "BillAmoun' :1486.060"  — a spurious third decimal. Truncated to 2.
 *
 * Numbers with 6+ digits and no decimals are dropped: on a receipt those are
 * phone numbers, FSSAI licences and bill numbers, never money. Without this
 * the largest-amount fallback confidently returns a phone number as the
 * total, which is exactly what it did before this guard existed.
 */
export function lineAmounts(text: string): number[];
export function lineAmounts(text: string, withFlags: false): number[];
export function lineAmounts(text: string, withFlags: true): Array<[number, boolean]>;
export function lineAmounts(text: string, withFlags = false): number[] | Array<[number, boolean]> {
  const toks = [...text.matchAll(NUM_TOKEN)];
  const out: Array<[number, boolean]> = [];
  let i = 0;
  while (i < toks.length) {
    let raw = toks[i][0];
    let merged = false;
    if (!raw.includes(".") && i + 1 < toks.length) {
      const nxt = toks[i + 1];
      const gap = text.slice((toks[i].index ?? 0) + raw.length, nxt.index ?? 0);
      if (/^\s{1,3}$/.test(gap) && /^\d{2}$/.test(nxt[0])) {
        raw = raw + "." + nxt[0];
        merged = true;
      }
    }
    const v = cleanAmount(raw);
    if (v !== null) {
      const digits = raw.replace(/,/g, "").split(".")[0];
      if (!(digits.length >= 6 && !raw.includes("."))) {
        // The flag means "printed like money", so a decimal point this code
        // inserted itself does not count. Without that distinction
        // "AMOUNT: 103 14 8215" merges to 103.14 and gets treated as a
        // genuine 2-decimal total.
        out.push([v, raw.includes(".") && !merged]);
      }
    }
    i += merged ? 2 : 1;
  }
  return withFlags ? out : out.map(([v]) => v);
}

/**
 * Match labelled amounts line by line, taking the rightmost number.
 *
 * Rightmost matters: "State GST @ 2.5% 52.72" contains both 2.5 and 52.72,
 * and on a receipt the amount is always the last column.
 */
function extractAmounts(ex: Extraction, lines: string[], base: number): void {
  const found = new Map<AmountKey, [number, string, number]>();
  let unreadableTotal = false;
  for (const line of lines) {
    const l = line.toLowerCase().trim();
    if (!l) continue;

    // The identifier veto ("phone", "invoice no", "fssai"...) exists to stop
    // those numbers being read as money. But on a collapsed pump printout the
    // amount shares a line with "INVOIce NO:", and vetoing the whole line
    // threw away the total along with the noise. So the veto only applies
    // when the line carries no amount label at all — and the labels that can
    // fire on such a line require money formatting anyway, which an invoice
    // number or phone number does not have.
    //
    // (Hit results are computed once per line rather than Python's
    // any-then-rescan; same outcomes, half the scoring work.)
    const hits = TOTAL_LABELS.map(([label, , minScore]) => labelHit(l, label, minScore));
    const labelled = hits.includes(true);
    if (NON_AMOUNT_LINE.test(l) && !labelled) continue;

    for (let t = 0; t < TOTAL_LABELS.length; t++) {
      if (!hits[t]) continue;
      const [, target, , needsDecimals] = TOTAL_LABELS[t];

      if (needsDecimals) {
        // Weak label in a jumble of numbers: only money-formatted values
        // count, and the largest of them is the total.
        const decimals = lineAmounts(l, true)
          .filter(([v, had]) => had && v >= MIN_MONEY_AMOUNT && v <= MAX_PLAUSIBLE_AMOUNT)
          .map(([v]) => v);
        if (!decimals.length) {
          // The label IS there, but no value on the line is written like
          // money. That means the total is genuinely unreadable, so the
          // largest-number fallback must not step in and offer the density
          // or the nozzle number instead.
          unreadableTotal = true;
          break;
        }
        const val = Math.max(...decimals);
        const conf = base * 0.85;
        const prev = found.get(target);
        if (!prev || conf > prev[2]) found.set(target, [val, line.trim(), conf]);
        break;
      }

      const nums = lineAmounts(l);
      if (!nums.length) break;
      let val = nums[nums.length - 1];
      // Tax lines print the rate before the amount ("CGST 2.5% 35.17").
      // If the rightmost number is a bare small rate, step left.
      if ((target === "cgst" || target === "sgst" || target === "igst") &&
          nums.length > 1 && val <= 30 && l.includes("%")) {
        val = nums[nums.length - 1] > nums[nums.length - 2]
          ? nums[nums.length - 1]
          : nums[nums.length - 2];
      }
      const conf = base * (target === "net_amount" ? 1.0 : 0.95);
      const prev = found.get(target);
      if (!prev || conf > prev[2]) found.set(target, [val, line.trim(), conf]);
      break;
    }
  }

  for (const [k, [val, src, conf]] of found) {
    ex[k] = makeField<number>(val, Math.min(0.95, conf), src, "label_amount");
  }

  if (unreadableTotal && !hasValue(ex.net_amount)) {
    ex.notes.push(
      "Found the 'Amount' label on the bill but no value next to it was " +
      "written like money, so the total has been left blank rather than " +
      "guessed. Please type it from the bill.",
    );
  }

  // Fuel bills: recover the amount arithmetically before falling back to
  // guessing, because the pump's columns rarely survive OCR intact.
  if (!hasValue(ex.net_amount)) {
    const full = lines.join("\n");
    if (looksLikeFuel(full)) {
      const allNums: number[] = [];
      for (const line of lines) allNums.push(...lineAmounts(line));
      const hit = triangulateFuelAmount(allNums);
      if (hit) {
        ex.net_amount = makeField(hit.amount, Math.min(0.85, base + 0.30),
          hit.explanation, "fuel_triangulated");
        ex.notes.push(`Fuel bill: amount confirmed by ${hit.explanation}`);
      }
    }
  }

  // Fallback: no labelled total. Skipped when a label WAS found but its value
  // could not be read — in that case any other number on the page is noise.
  if (!hasValue(ex.net_amount) && !unreadableTotal) {
    let bestV = -Infinity;
    let bestSrc = "";
    for (const line of lines) {
      if (NON_AMOUNT_LINE.test(line)) continue;
      for (const v of lineAmounts(line)) {
        if (v >= 1 && v < 1e7 && v > bestV) {
          bestV = v;
          bestSrc = line.trim();
        }
      }
    }
    if (bestV !== -Infinity) {
      if (bestV > MAX_PLAUSIBLE_AMOUNT) {
        // Refuse to guess. On a fuel bill whose Amount and Volume columns
        // collided, the largest number was 91,500 for a 915-rupee purchase.
        // Silently posting that is far worse than asking — a blank field
        // gets typed in; a wrong one gets confirmed.
        ex.notes.push(
          `Could not read the total. The largest number on the page ` +
          `is ${commaFmt2(bestV)}, which is too large to be a staff claim, so it ` +
          `has been left blank rather than guessed. Please enter it.`,
        );
      } else {
        ex.net_amount = makeField(bestV, base * 0.45, bestSrc, "largest_amount_fallback");
        ex.notes.push(
          "No total label was found - used the largest amount on the " +
          "page. Please check this.",
        );
      }
    }
  }
}

function extractHsn(ex: Extraction, text: string, base: number): void {
  const m = HSN_RE.exec(text);
  if (m) ex.hsn_sac = makeField(m[1], base * 0.9, m[0], "hsn_label");
}

const CAPS_WORD = /^[A-Z][A-Z&.'-]+$/;
const CAPS_EXCLUDE = new Set(["GST", "GSTIN", "NO", "PH", "FSSAI"]);

/**
 * Vendor name comes from the letterhead in the first few lines.
 *
 * The naive version — "pick the most uppercase line" — returns whole lines
 * including OCR debris, which on the sample bills produced things like
 * "A Unita y : ek Obits) SITARA GRAND Z".
 *
 * What actually works is looking for the longest RUN of consecutive
 * all-capitals words within the top lines and keeping only that run. Trading
 * names are set in caps on essentially every Indian bill, and OCR debris is
 * almost never several capitalised words in a row. That extracts
 * "SITARA GRAND" and "URBAN MAYABAZAR" cleanly from the same lines.
 */
function extractVendor(ex: Extraction, lines: string[], base: number): void {
  let bestRun: { score: number; text: string; line: string } | null = null;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const words = lines[i].replace(NOISE_PREFIXES, "").split(/\s+/).filter(Boolean);
    let run: string[] = [];
    const runs: string[][] = [];
    for (const w of words) {
      const cw = stripChars(w, ".,:;|()[]");
      if (CAPS_WORD.test(cw) && !CAPS_EXCLUDE.has(cw)) {
        run.push(cw);
      } else {
        if (run.length) runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    for (const r of runs) {
      const joined = r.join(" ");
      const letters = countLetters(joined);
      if (letters < 5) continue;
      const score = r.length * 2.0 + letters / 10.0 - i * 0.4;
      if (!bestRun || score > bestRun.score) {
        bestRun = { score, text: joined, line: lines[i].trim() };
      }
    }
  }

  if (bestRun) {
    ex.vendor_name = makeField(bestRun.text, base * 0.8, bestRun.line, "caps_run");
    return;
  }

  // Fallback: most letter-dense early line.
  let best: { score: number; s: string } | null = null;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const s = lines[i].replace(NOISE_PREFIXES, "").trim();
    const letters = countLetters(s);
    if (letters < 5 || s.length > 60) continue;
    const digits = countDigits(s);
    if (digits > letters * 0.4) continue;
    const score = letters / 30.0 - i * 0.15;
    if (!best || score > best.score) best = { score, s };
  }
  if (best) {
    const name = stripChars(best.s.replace(/\s{2,}/g, " "), " .,:-|");
    ex.vendor_name = makeField(name, base * 0.55, best.s, "letterhead_heuristic");
  }
}

const ITEM_RE = new RegExp(
  "^\\s*(?:(\\d{1,2})\\s+)?" +                   // optional serial no
  "([A-Za-z][A-Za-z0-9 .,'&/()\\-]{2,45}?)" +    // description
  "\\s+(\\d{1,3})\\s+" +                          // qty
  "([\\d,]+\\.?\\d{0,2})\\s+" +                   // rate
  "([\\d,]+\\.?\\d{0,2})\\s*$",                   // amount
);

/**
 * Parse qty/rate/amount rows.
 *
 * Kept deliberately strict — it only accepts rows where rate * qty is close
 * to the stated amount. A loose line-item parser produces junk rows that a
 * clerk then has to delete, which is worse than producing none. For expense
 * vouchers the line items are informational anyway; the ledger posting uses
 * the totals.
 */
function extractLineItems(ex: Extraction, lines: string[]): void {
  for (const line of lines) {
    const m = ITEM_RE.exec(line.trim());
    if (!m) continue;
    const desc = m[2].trim();
    const qty = cleanAmount(m[3]);
    const rate = cleanAmount(m[4]);
    const amt = cleanAmount(m[5]);
    if (qty === null || rate === null || amt === null || amt === 0) continue;
    if (Math.abs(qty * rate - amt) > Math.max(1.0, amt * 0.02)) continue;
    if (desc.length < 3 || ["total", "sub total", "amount"].includes(desc.toLowerCase())) continue;
    ex.line_items.push({ description: desc, qty, rate, amount: amt });
  }
}

function fieldNum(f: Field<number>): number {
  return hasValue(f) ? Number(f.value) : 0.0;
}

/**
 * Detect that the captured "total" was actually the pre-tax total.
 *
 * Receipts commonly print:
 *
 *     Total Amount     2108.28     <- pre-tax
 *     State GST @2.5%    52.72
 *     Central GST @2.5%  52.72
 *     Round Off           0.28
 *     Net Amount       2214.00     <- the real total
 *
 * If the "Net Amount" line is unreadable (on the sample bill it collided with
 * the KOT line and became "KOT NO Net : 13625,' Amount 3629 ___ 2214.00"),
 * the label matcher lands on "Total Amount" and the voucher would be posted
 * 2214 - 2108 = 105.72 short.
 *
 * The fix is arithmetic rather than textual: add the taxes to the captured
 * total and see whether that number appears elsewhere on the page. If it
 * does, the labels were misread and the roles are swapped. This does not
 * depend on reading the net label at all.
 */
function promoteNetIfPretax(ex: Extraction, pageAmounts: number[], tolerance = 1.5): boolean {
  const net = fieldNum(ex.net_amount);
  const taxes = fieldNum(ex.cgst) + fieldNum(ex.sgst) + fieldNum(ex.igst);
  if (!net || !taxes || fieldNum(ex.taxable_value)) return false;

  const implied = net + taxes + fieldNum(ex.round_off);
  for (const amt of pageAmounts) {
    if (Math.abs(amt - implied) <= tolerance && amt > net) {
      ex.taxable_value = makeField(net, ex.net_amount.confidence,
        ex.net_amount.source, "reclassified_pretax");
      ex.net_amount = makeField(pyRound(amt, 2), 0.85,
        `derived: ${pyFloatStr(net)} + taxes = ${pyFloatStr(amt)}`,
        "arithmetic_promoted");
      ex.arithmetic_ok = true;
      ex.notes.push(
        `The labelled total (${net.toFixed(2)}) is the pre-tax amount; ` +
        `net of ${amt.toFixed(2)} confirmed by adding the taxes`,
      );
      return true;
    }
  }
  return false;
}

/**
 * Verify taxable + taxes + round-off == net, and repair a single hole.
 *
 * When the sum checks out, every number involved is corroborated — that is
 * stronger evidence than any individual OCR confidence, so the fields get
 * promoted. When exactly one number is missing, it can be derived, which
 * routinely recovers the taxable value on receipts that only print a total.
 */
function checkArithmetic(ex: Extraction, tolerance = 1.5, pageAmounts?: number[]): void {
  let net = fieldNum(ex.net_amount);
  if (!net) return;

  if (pageAmounts && pageAmounts.length && promoteNetIfPretax(ex, pageAmounts, tolerance)) return;

  net = fieldNum(ex.net_amount);
  const parts = fieldNum(ex.taxable_value) + fieldNum(ex.cgst) + fieldNum(ex.sgst) +
    fieldNum(ex.igst) + fieldNum(ex.round_off);
  if (fieldNum(ex.taxable_value) && Math.abs(parts - net) <= tolerance) {
    ex.arithmetic_ok = true;
    for (const f of [ex.net_amount, ex.taxable_value, ex.cgst, ex.sgst, ex.igst]) {
      if (hasValue(f)) f.confidence = Math.min(0.98, f.confidence + 0.20);
    }
    return;
  }

  // Derive the taxable value if it is the only thing missing.
  if (!hasValue(ex.taxable_value) && (fieldNum(ex.cgst) || fieldNum(ex.sgst) || fieldNum(ex.igst))) {
    const derived = net - fieldNum(ex.cgst) - fieldNum(ex.sgst) - fieldNum(ex.igst) -
      fieldNum(ex.round_off);
    if (derived > 0) {
      ex.taxable_value = makeField(pyRound(derived, 2), 0.75,
        "derived: net - taxes", "arithmetic_derived");
      ex.arithmetic_ok = true;
      ex.notes.push("Taxable value derived from net minus taxes");
      return;
    }
  }

  if (fieldNum(ex.taxable_value)) {
    ex.notes.push(
      `Amounts do not reconcile: parts sum to ${parts.toFixed(2)} but net is ${net.toFixed(2)}`,
    );
  }
}
