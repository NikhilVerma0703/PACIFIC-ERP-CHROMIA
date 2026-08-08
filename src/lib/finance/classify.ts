// Ledger classification - five signals, no LLM. Ported from
// automation/app/classify.py.
//
//     Signal 1  Vendor memory        weight 0.42, short-circuits
//     Signal 2  Person memory        weight 0.14
//     Signal 3  Fuzzy string match   weight 0.18
//     Signal 4  TF-IDF cosine        weight 0.16
//     Signal 5  Char n-gram cosine   weight 0.10
//
// Why several rather than one: they fail in different places. Fuzzy matching
// handles transposition and OCR noise but treats every word as equally
// important, so "Charges" (in 15 ledger names) counts as much as "Fumigation"
// (in one). TF-IDF fixes exactly that through inverse document frequency, but
// needs whole words to survive OCR. Character n-grams need only fragments, so
// they hold up when whole words do not, but they also match on coincidental
// letter overlap. Averaging them cancels the individual failure modes.
//
// Vendor memory outranks the text signals because it is not a guess. If this
// vendor's bills went to this ledger the last five times, that is a fact about
// your business, and no amount of text similarity should overrule it.
//
// The output is always a ranked list with scores and a human-readable reason -
// never a single silent answer. An auditor asking "why is this coded to
// Boarding & Lodging?" gets "vendor HOTEL SITARA GRAND matched 5 previous
// bills", which is a real answer.
//
// The Python leans on scikit-learn (TfidfVectorizer, cosine_similarity) and
// rapidfuzz. Both are re-implemented by hand below, matching their exact
// numerics: the confidence bands and every threshold in this file were tuned
// against those libraries' scores, and a "roughly similar" replacement would
// shift all of them by an unknown amount, silently.

import type { Ledger } from "./ledgers";

// ---------------------------------------------------------------------------
// Duplicated helpers (normalise / tokenise, and the rapidfuzz ratios also
// found in dedupe.ts).
//
// Duplicated rather than imported because `node --test` resolves ESM strictly:
// a relative import with no .ts extension fails at runtime, and adding the
// extension fights the Next build. Every tested module in this repo is
// self-contained for the same reason - only *type* imports (erased before
// node ever sees them) may cross files. These MUST stay in sync with
// ledgers.ts; the test suite exercises both sides against the same inputs.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a/c", "ac", "account", "accounts", "and", "the", "of", "for", "to",
  "&", "-", "expenses", "expense", "charges", "charge",
]);

function normalise(text: string | null | undefined): string {
  if (!text) return "";
  let t = text.replace(/_x000D_/g, " ").replace(/\r/g, " ").replace(/\n/g, " ");
  t = t.toLowerCase();
  t = t.replace(/[^a-z0-9\s/&.-]/g, " ");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

function tokenise(text: string | null | undefined): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t) && t.length > 2 && !/^\d+$/.test(t));
}

/** Length of the longest common subsequence. Two rows, not the full table. */
function lcsLength(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length];
}

/** rapidfuzz.fuzz.ratio - normalised Indel similarity, 0..100. */
function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  if (!a.length || !b.length) return 0;
  return (200 * lcsLength(a, b)) / (a.length + b.length);
}

/** rapidfuzz.fuzz.token_set_ratio - order-insensitive and forgiving of one
 *  string carrying extra words, which is what a whole bill vs a short ledger
 *  name needs. */
function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (!ta.size && !tb.size) return 100;
  const inter = [...ta].filter((t) => tb.has(t)).sort();
  const onlyA = [...ta].filter((t) => !tb.has(t)).sort();
  const onlyB = [...tb].filter((t) => !ta.has(t)).sort();
  const t0 = inter.join(" ");
  const t1 = [...inter, ...onlyA].join(" ").trim();
  const t2 = [...inter, ...onlyB].join(" ").trim();
  return Math.max(ratio(t0, t1), ratio(t0, t2), ratio(t1, t2));
}

// ---------------------------------------------------------------------------
// Hand-rolled TF-IDF, numerically identical to sklearn's TfidfVectorizer with
// the exact options the Python uses (sublinear_tf=True, smooth_idf default,
// l2 norm default, min_df=1):
//
//   tf'   = 1 + ln(count)                      sublinear: a word repeating 40
//                                              times in a long bill must not
//                                              swamp the signal
//   idf   = ln((1 + nDocs) / (1 + df)) + 1     smoothed, never zero
//   value = tf' * idf, then L2-normalised      so cosine = plain dot product
//
// Queries are transformed with the corpus vocabulary; unseen terms vanish,
// exactly as sklearn's transform() does.
// ---------------------------------------------------------------------------

type Analyzer = (text: string) => string[];

/** sklearn word analyzer: lowercase, token_pattern \b\w\w+\b, plus bigrams
 *  (ngram_range=(1,2)) joined with a single space. */
function wordNgrams(text: string): string[] {
  const toks = text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  const out: string[] = [...toks];
  for (let i = 0; i + 1 < toks.length; i++) out.push(toks[i] + " " + toks[i + 1]);
  return out;
}

/** sklearn char_wb analyzer, ngram_range=(3,5): each word is padded with one
 *  space per side and n-grams never cross word boundaries. A word shorter
 *  than n is emitted once, whole - the `offset === 0` break reproduces
 *  sklearn's exact (slightly quirky) rule for that. This is the OCR-noise
 *  backstop: it needs only fragments of words to survive. */
function charWbNgrams(text: string): string[] {
  const doc = text.toLowerCase().replace(/\s+/g, " ");
  const out: string[] = [];
  for (const word of doc.split(" ")) {
    if (!word) continue;
    const w = " " + word + " ";
    const wLen = w.length;
    for (let n = 3; n <= 5; n++) {
      let offset = 0;
      out.push(w.slice(0, n));
      while (offset + n < wLen) {
        offset += 1;
        out.push(w.slice(offset, offset + n));
      }
      if (offset === 0) break; // count a short word (wLen < n) only once
    }
  }
  return out;
}

class TfidfIndex {
  private vocab = new Map<string, number>();
  private idf: number[] = [];
  /** Inverted index: feature -> [docIndex, l2-normalised weight] pairs. */
  private postings: Array<Array<[number, number]>> = [];
  private nDocs: number;
  private analyzer: Analyzer;

  constructor(docs: string[], analyzer: Analyzer) {
    this.analyzer = analyzer;
    this.nDocs = docs.length;
    const docCounts: Array<Map<number, number>> = [];
    const df = new Map<number, number>();

    for (const doc of docs) {
      const counts = new Map<number, number>();
      for (const feat of this.analyzer(doc)) {
        let idx = this.vocab.get(feat);
        if (idx === undefined) {
          idx = this.vocab.size;
          this.vocab.set(feat, idx);
        }
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
      for (const idx of counts.keys()) df.set(idx, (df.get(idx) ?? 0) + 1);
      docCounts.push(counts);
    }

    this.idf = new Array(this.vocab.size);
    for (let f = 0; f < this.vocab.size; f++) {
      this.idf[f] = Math.log((1 + this.nDocs) / (1 + (df.get(f) ?? 0))) + 1;
    }

    this.postings = Array.from({ length: this.vocab.size }, () => []);
    docCounts.forEach((counts, d) => {
      let normSq = 0;
      const entries: Array<[number, number]> = [];
      for (const [f, c] of counts) {
        const v = (1 + Math.log(c)) * this.idf[f];
        entries.push([f, v]);
        normSq += v * v;
      }
      const norm = Math.sqrt(normSq);
      if (norm > 0) {
        for (const [f, v] of entries) this.postings[f].push([d, v / norm]);
      }
    });
  }

  /** Cosine similarity of the query against every fitted document. */
  scores(text: string): Float64Array {
    const counts = new Map<number, number>();
    for (const feat of this.analyzer(text)) {
      const idx = this.vocab.get(feat);
      if (idx !== undefined) counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
    const out = new Float64Array(this.nDocs);
    let normSq = 0;
    const q: Array<[number, number]> = [];
    for (const [f, c] of counts) {
      const v = (1 + Math.log(c)) * this.idf[f];
      q.push([f, v]);
      normSq += v * v;
    }
    const norm = Math.sqrt(normSq);
    if (norm === 0) return out;
    for (const [f, v] of q) {
      const qv = v / norm;
      for (const [d, w] of this.postings[f]) out[d] += qv * w;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Weights and bands
// ---------------------------------------------------------------------------

// "person" exists because it is free intelligence: the claimant is chosen at
// upload, so this signal exists BEFORE the bill is read. A driver claims fuel
// and tolls; a salesperson claims travel and hotels. Over a few hundred claims
// that habit is a strong prior.
//
// Its weight is deliberately modest. A person's history narrows the field, it
// does not decide - anyone can occasionally claim something unusual, and a
// person signal strong enough to override the bill text would code every one
// of their claims to their most common ledger.
export const WEIGHTS: Record<string, number> = {
  memory: 0.42, person: 0.14, fuzzy: 0.18, tfidf: 0.16, ngram: 0.10,
};

// How often a ledger is really used is NOT one of the weighted signals. It
// was, briefly, and that was wrong: as an additive term it let a ledger with
// zero text relevance score 28% on popularity alone. "RoDTEP Receivable"
// (1,804 uses, an export-incentive account) started appearing as the second
// suggestion for restaurant bills.
//
// Usage is a TIE-BREAKER. It multiplies a score the text already supports,
// within a deliberately narrow band, so it can reorder near-equal candidates
// but can never promote something nothing else points at.
export const USAGE_FLOOR = 0.78;   // never used in any journal
export const USAGE_CEILING = 1.10; // among the most-used ledgers

export const BANDS: Array<[number, string]> = [[0.85, "high"], [0.60, "medium"], [0.35, "low"]];

// Confirmations of the same vendor->ledger pair before memory is treated as
// near-certain. One confirmation could be a clerk clicking through
// carelessly; three is a pattern.
export const MEMORY_TRUST_COUNT = 3;

export interface Suggestion {
  ledger: string;
  score: number;
  band: string;
  reasons: string[];
  signals: Record<string, number>;
}

export interface BandThresholds {
  high?: number;
  medium?: number;
  low?: number;
}

export function bandFor(score: number, bands?: BandThresholds | null): string {
  // Python treats an empty dict as "no config" (`if bands:`), so an empty
  // object must fall through to the built-in thresholds too.
  if (bands && Object.keys(bands).length > 0) {
    for (const name of ["high", "medium", "low"] as const) {
      const t = bands[name];
      if (t !== undefined && score >= t) return name;
    }
    return "none";
  }
  for (const [threshold, name] of BANDS) {
    if (score >= threshold) return name;
  }
  return "none";
}

// --------------------------------------------------------------------------
// Query construction
//
// Feeding the raw OCR dump to the matchers does not work. A receipt is ~300
// tokens of address, phone numbers, GST registration, table numbers, "Thank
// you visit again" - and perhaps four tokens that say what was actually
// bought. A ledger name is two or three words. Cosine similarity between a
// long noisy document and a short label is tiny no matter how good the match
// is, which compressed every real score into the 0.05-0.16 range and made the
// confidence bands meaningless.
//
// So the bill is reduced to the words that carry purchase meaning before any
// matching happens. Same algorithms, an order of magnitude better separation.
// --------------------------------------------------------------------------
export const BOILERPLATE = new Set(`
total amount net gross sub subtotal gst cgst sgst igst utgst cess tax taxable
invoice bill number date time qty quantity rate item items description desc
inr rupees rupee cash card upi paid due balance change round off amt
thank you thanks visit again please welcome come customer name address
phone mobile contact tel fax email www http com pin code state city road
street floor colony nagar layout main cross opp near behind
gstin fssai licence license reg regn cin pan tin
table covers cashier user assign counter token kot bill no sno srno
terms conditions optional service charges are computer generated signature
original duplicate triplicate recipient copy jurisdiction subject
`.split(/\s+/).filter(Boolean));

export const STOPWORDS_EXTRA = new Set([
  "the", "and", "for", "with", "from", "this", "that", "was",
  "are", "not", "all", "your", "our", "has", "have",
]);

/**
 * Reduce a bill to the words that indicate what was purchased.
 *
 * The vendor name is repeated because it is the strongest single clue on a
 * small bill - 'HOTEL SITARA GRAND' says more about the correct ledger than
 * the entire rest of the receipt.
 */
export function buildQueryText(
  ocrText: string,
  vendorName?: string | null,
  lineItems?: Array<{ description?: string | null } | null> | null,
  maxTokens = 60,
): string {
  const parts: string[] = [];

  if (vendorName) {
    const v = normalise(vendorName);
    parts.push(v, v, v);
  }

  // Line items are literally a description of what was bought.
  for (const it of lineItems ?? []) {
    const desc = it && typeof it === "object" ? it.description : null;
    if (desc) parts.push(normalise(desc));
  }

  const kept: string[] = [];
  for (const tok of tokenise(ocrText)) {
    if (BOILERPLATE.has(tok) || STOPWORDS_EXTRA.has(tok)) continue;
    if (/\d/.test(tok)) continue;
    if (tok.length < 3) continue;
    kept.push(tok);
    if (kept.length >= maxTokens) break;
  }
  parts.push(...kept);

  return parts.filter(Boolean).join(" ");
}

/**
 * Does this ledger appear to be named after the claimant?
 *
 * PESPL has per-person expense ledgers - "Fuel Expenses - Varun Mundra",
 * "Fuel Expenses - Hemanth". Matching them to the claimant is one of the
 * highest-value cheap wins available, because the person is known at upload.
 *
 * Returns the NUMBER of matching name tokens, not a yes/no, because a
 * forename alone is ambiguous in a real chart of accounts. PESPL has both
 * "Fuel Expenses - Varun Mundra" and "Fuel Expenses - Varun Somani": matching
 * on "varun" alone picked the wrong colleague's ledger, which would post one
 * person's fuel against another's account. Counting tokens lets a two-word
 * match outrank a one-word match.
 *
 * Matching is per token rather than on the whole string because Tally ledgers
 * are often abbreviated relative to the party name - the ledger reads "Fuel
 * Expenses - Hemanth" while the claimant is "HEMANTH KUMAR REDDY". Tokens
 * must be at least 4 characters, so initials and short words cannot match.
 */
export function nameMatchPerson(ledgerName: string, person: string): number {
  if (!ledgerName || !person) return 0;
  const led = new Set(normalise(ledgerName).split(" "));
  let n = 0;
  for (const tok of new Set(normalise(person).split(" "))) {
    if (tok.length >= 4 && led.has(tok)) n++;
  }
  return n;
}

/**
 * Stable identity for a vendor.
 *
 * GSTIN is preferred whenever present: it is exact, it survives OCR noise in
 * the trading name, and it does not drift when a vendor rebrands. Falling
 * back to a normalised name means 'HOTEL SITARA GRAND' and 'Hotel Sitara
 * Grand.' collapse to the same key.
 */
export function vendorKey(vendorName?: string | null, gstin?: string | null): string {
  if (gstin && gstin.length === 15) return `gstin:${gstin.toUpperCase()}`;
  if (vendorName) {
    let n = normalise(vendorName);
    n = n.replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|and|the)\b/g, " ");
    n = n.replace(/\s+/g, " ").trim();
    if (n) return `name:${n}`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Memory - the self-learning part.
//
// Learning happens on CONFIRMATION only - never on suggestion. The system
// learns from what a human accepted or corrected, not from what it guessed.
//
// Two main structures:
//   vendorMemory  vendor -> ledger -> count. Specific and strong.
//   tokenWeights  token  -> ledger -> weight. Generalises across vendors, so
//                 'biryani' eventually points at the right ledger no matter
//                 which restaurant issued the bill.
//
// Corrections decay the previous mapping rather than merely adding to the new
// one. Without decay a wrong mapping learned early keeps competing forever.
//
// The Python backs this with SQLite; here the same rows live in an injected
// plain-object store, and loading/persisting that object is entirely the
// caller's problem (Prisma, a JSON column, a file - the logic cannot tell).
// ---------------------------------------------------------------------------

export interface VendorMemoryEntry { count: number; lastSeen: string }
export interface PersonMemoryEntry { count: number; lastSeen: string; source: string }
export interface CorrectionEntry {
  field: string;
  suggested: string | null;
  chosen: string;
  vendorKey: string;
  createdBy: string;
  createdAt: string;
}

export interface MemoryStore {
  /** vendor_key -> ledger -> row, mirroring the vendor_memory table. */
  vendorMemory: Record<string, Record<string, VendorMemoryEntry>>;
  /** person -> ledger -> row, mirroring the person_memory table. */
  personMemory: Record<string, Record<string, PersonMemoryEntry>>;
  /** token -> ledger -> weight, mirroring the token_weights table. */
  tokenWeights: Record<string, Record<string, number>>;
  /** Append-only audit trail, mirroring the corrections table. */
  corrections: CorrectionEntry[];
}

export function emptyMemoryStore(): MemoryStore {
  return { vendorMemory: {}, personMemory: {}, tokenWeights: {}, corrections: [] };
}

const now = () => new Date().toISOString();

export class Memory {
  static readonly DECAY = 0.55;

  readonly store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  vendorScores(vkey: string): {
    scores: Record<string, number>;
    counts: Record<string, number>;
  } {
    const rows = this.store.vendorMemory[vkey];
    if (!rows || Object.keys(rows).length === 0) return { scores: {}, counts: {} };
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [led, row] of Object.entries(rows)) {
      counts[led] = row.count;
      total += row.count;
    }
    // Saturating score: 1 confirmation ~0.55, 3 ~0.79, 6 ~0.90. Combined with
    // share of this vendor's history, so a contested vendor scores lower than
    // a consistent one.
    const scores: Record<string, number> = {};
    for (const [led, c] of Object.entries(counts)) {
      scores[led] = (1 - Math.exp(-0.8 * c)) * (0.5 + (0.5 * c) / total);
    }
    return { scores, counts };
  }

  /**
   * Which ledgers this person's claims have gone to.
   *
   * Normalised by the person's own total rather than saturating like the
   * vendor signal, because the useful information is the SHARE: "70% of
   * Vijay's claims are fuel" is a prior worth acting on, whereas the raw
   * count only says he claims a lot.
   */
  personScores(person: string): {
    scores: Record<string, number>;
    counts: Record<string, number>;
  } {
    const rows = this.store.personMemory[person.trim()];
    if (!rows || Object.keys(rows).length === 0) return { scores: {}, counts: {} };
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [led, row] of Object.entries(rows)) {
      counts[led] = row.count;
      total += row.count;
    }
    total = total || 1;
    // Damped by total history so a person with 2 claims does not look as
    // certain as one with 200.
    const confidence = Math.min(1, total / 12.0);
    const scores: Record<string, number> = {};
    for (const [led, c] of Object.entries(counts)) {
      scores[led] = (c / total) * confidence;
    }
    return { scores, counts };
  }

  learnPerson(person: string, ledger: string, source = "confirmed", weight = 1): void {
    if (!person || !ledger) return;
    const p = person.trim();
    const rows = (this.store.personMemory[p] ??= {});
    const row = rows[ledger];
    if (row) {
      row.count += weight;
      row.lastSeen = now();
    } else {
      rows[ledger] = { count: weight, lastSeen: now(), source };
    }
  }

  tokenScores(tokens: string[]): Record<string, number> {
    if (!tokens.length) return {};
    // SQL's IN-list matches each stored row once however often a token
    // repeats in the query, so duplicates are collapsed first.
    const sums: Record<string, number> = {};
    for (const tok of new Set(tokens)) {
      const rows = this.store.tokenWeights[tok];
      if (!rows) continue;
      for (const [led, w] of Object.entries(rows)) {
        sums[led] = (sums[led] ?? 0) + w;
      }
    }
    const values = Object.values(sums);
    if (!values.length) return {};
    const top = Math.max(...values) || 1.0;
    const out: Record<string, number> = {};
    for (const [led, w] of Object.entries(sums)) out[led] = Math.min(1, w / top);
    return out;
  }

  /** Record a confirmed classification. */
  learn(
    vkey: string,
    ledger: string,
    billText: string,
    suggested?: string | null,
    user = "system",
    person?: string | null,
  ): void {
    if (person) this.learnPerson(person, ledger);

    if (vkey) {
      const rows = (this.store.vendorMemory[vkey] ??= {});
      const row = rows[ledger];
      if (row) {
        row.count += 1;
        row.lastSeen = now();
      } else {
        rows[ledger] = { count: 1, lastSeen: now() };
      }
      // A correction means the old mapping was wrong here. Decay it so it
      // stops competing, but do not delete it - the vendor may genuinely use
      // two ledgers and the counts should reflect the real split.
      if (suggested && suggested !== ledger) {
        const old = rows[suggested];
        if (old) {
          // SQL: MAX(1, CAST(count * DECAY AS INTEGER)) - CAST truncates.
          old.count = Math.max(1, Math.trunc(old.count * Memory.DECAY));
        }
      }
    }

    for (const tok of new Set(tokenise(billText))) {
      const rows = (this.store.tokenWeights[tok] ??= {});
      rows[ledger] = (rows[ledger] ?? 0) + 1.0;
      if (suggested && suggested !== ledger && rows[suggested] !== undefined) {
        rows[suggested] *= Memory.DECAY;
      }
    }

    if (suggested && suggested !== ledger) {
      this.store.corrections.push({
        field: "ledger",
        suggested,
        chosen: ledger,
        vendorKey: vkey,
        createdBy: user,
        createdAt: now(),
      });
    }
  }

  learnedMappings(): Array<{ vendorKey: string; ledger: string; count: number; lastSeen: string }> {
    const out: Array<{ vendorKey: string; ledger: string; count: number; lastSeen: string }> = [];
    for (const [vk, rows] of Object.entries(this.store.vendorMemory)) {
      for (const [led, row] of Object.entries(rows)) {
        out.push({ vendorKey: vk, ledger: led, count: row.count, lastSeen: row.lastSeen });
      }
    }
    return out.sort(
      (a, b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0),
    );
  }

  /** Admin override. Everything the system infers must be undoable. */
  forget(vkey: string, ledger: string): void {
    const rows = this.store.vendorMemory[vkey];
    if (rows) delete rows[ledger];
  }
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export interface ClassifierOptions {
  /** Overrides merged over WEIGHTS, as config.yaml does for the Python. */
  weights?: Record<string, number>;
  bands?: BandThresholds;
  memoryTrustCount?: number;
  /** ledger name -> journal-line count, from Tally's Journal Register. */
  usage?: Record<string, number>;
}

export interface ClassifyOptions {
  natureFilter?: Set<string>;
  topK?: number;
  person?: string | null;
}

export class LedgerClassifier {
  readonly allLedgers: Ledger[];
  readonly memory: Memory | null;
  readonly weights: Record<string, number>;
  readonly bands: BandThresholds;
  readonly memoryTrustCount: number;
  readonly usage: Record<string, number>;
  private usageScore: Record<string, number>;
  private candidates: Ledger[];
  private corpus: string[];
  private wordIndex: TfidfIndex;
  private charIndex: TfidfIndex;

  constructor(ledgers: Ledger[], memory: Memory | null = null, opts: ClassifierOptions = {}) {
    this.allLedgers = ledgers;
    this.memory = memory;
    // Weights and bands come from config when supplied. They used to be
    // module constants while the config carried its own copy - so tuning the
    // config changed nothing, which is worse than having no setting at all.
    this.weights = { ...WEIGHTS, ...(opts.weights ?? {}) };
    this.bands = opts.bands ?? {};
    this.memoryTrustCount = opts.memoryTrustCount || MEMORY_TRUST_COUNT;

    // How often each ledger is really used, from Tally's Journal Register.
    // Log-scaled: the gap between 0 and 50 uses matters enormously, the gap
    // between 500 and 4,000 barely at all - both are simply "live".
    this.usage = opts.usage ?? {};
    this.usageScore = {};
    const usageValues = Object.values(this.usage);
    if (usageValues.length) {
      const top = Math.log1p(Math.max(...usageValues));
      for (const [k, v] of Object.entries(this.usage)) {
        this.usageScore[k] = Math.log1p(v) / top;
      }
    }

    this.candidates = ledgers.filter((l) => l.isPostable);
    this.corpus = this.candidates.map((l) => l.searchText);

    // Word-level TF-IDF (unigrams + bigrams), and character n-grams as the
    // OCR-noise backstop.
    this.wordIndex = new TfidfIndex(this.corpus, wordNgrams);
    this.charIndex = new TfidfIndex(this.corpus, charWbNgrams);
  }

  /** Bounded tie-breaker on how often this ledger is really used. */
  private usageMultiplier(name: string): number {
    if (!Object.keys(this.usage).length) return 1.0;
    const frac = this.usageScore[name] ?? 0.0;
    return USAGE_FLOOR + (USAGE_CEILING - USAGE_FLOOR) * frac;
  }

  classify(
    billText: string,
    vendorName?: string | null,
    gstin?: string | null,
    opts: ClassifyOptions = {},
  ): Suggestion[] {
    const text = normalise(billText);
    if (!text) return [];

    const topK = opts.topK ?? 5;
    const person = opts.person ?? null;

    // Restrict to plausible natures first. A food bill should never be able
    // to reach an equity ledger, and removing those candidates up front
    // improves both accuracy and speed.
    const natureFilter =
      opts.natureFilter && opts.natureFilter.size
        ? opts.natureFilter
        : new Set(["expense", "asset"]);
    let allowed = this.candidates
      .map((l, i) => (natureFilter.has(l.nature) ? i : -1))
      .filter((i) => i >= 0);
    if (!allowed.length) allowed = this.candidates.map((_, i) => i);

    const tfidf = this.wordIndex.scores(text);
    const ngram = this.charIndex.scores(text);
    // token_set_ratio ignores word order and duplicate words, which is what
    // we want when comparing a whole bill against a short ledger name.
    const fuzzy = this.corpus.map((c) => tokenSetRatio(text, c) / 100.0);

    const vkey = vendorKey(vendorName, gstin);
    let memScores: Record<string, number> = {};
    let memCounts: Record<string, number> = {};
    if (this.memory && vkey) {
      ({ scores: memScores, counts: memCounts } = this.memory.vendorScores(vkey));
    }

    let personScores: Record<string, number> = {};
    let personCounts: Record<string, number> = {};
    if (this.memory && person) {
      ({ scores: personScores, counts: personCounts } = this.memory.personScores(person));
    }

    const tokenScores = this.memory ? this.memory.tokenScores(tokenise(billText)) : {};

    const results: Suggestion[] = [];
    for (const i of allowed) {
      const ledger = this.candidates[i];
      const name = ledger.name;
      const sig: Record<string, number> = {
        memory: memScores[name] ?? 0.0,
        person: personScores[name] ?? 0.0,
        fuzzy: fuzzy[i],
        tfidf: tfidf[i],
        ngram: ngram[i],
      };
      let score = 0;
      for (const [k, v] of Object.entries(sig)) score += (this.weights[k] ?? 0.0) * v;
      sig.memory_count = memCounts[name] ?? 0;

      // Tie-break on real usage. Multiplicative and bounded, so it never
      // invents relevance.
      const mult = this.usageMultiplier(name);
      score *= mult;
      if (mult !== 1.0) sig.usage_x = mult;

      // PERSON-NAMED LEDGERS.
      //
      // PESPL tracks fuel per claimant: "Fuel Expenses - Varun Mundra",
      // "Fuel Expenses - Hemanth", "Fuel Expenses - Pravin". When Varun
      // submits a fuel bill, the answer is HIS ledger, not a generic one -
      // and the generic "FUEL EXPENSES VEHICLE" has never been used at all.
      //
      // The claimant is known at upload, so this is free and close to
      // certain. It only fires when the text signals already point at this
      // ledger, so a person-named ledger cannot win on the name alone.
      if (person && sig.tfidf + sig.fuzzy > 0.35) {
        const matched = nameMatchPerson(name, person);
        if (matched) {
          // Two matching name tokens is near-certain identity; one is
          // suggestive but could be a colleague sharing a forename, so it
          // gets a much smaller nudge.
          score = Math.min(1.0, score * (matched >= 2 ? 1.55 : 1.12));
          sig.person_named = matched;
        }
      }

      // Learned token associations act as a bonus rather than a sixth
      // weighted signal, so they can lift a ledger the text signals missed
      // but cannot on their own promote something nothing else supports.
      const tok = tokenScores[name] ?? 0.0;
      if (tok) {
        score += 0.15 * tok;
        sig.tokens = tok;
      }

      const reasons: string[] = [];
      const pcnt = personCounts[name] ?? 0;
      if (pcnt >= 2 && person) {
        reasons.push(`${person} has claimed this ledger ${pcnt} times before`);
      }
      const cnt = memCounts[name] ?? 0;
      if (cnt) {
        reasons.push(`This vendor was coded here ${cnt} time${cnt !== 1 ? "s" : ""} before`);
      }
      const used = this.usage[name] ?? 0;
      if (Object.keys(this.usage).length && !used) {
        reasons.push("Never used in your Tally journals");
      }
      if (sig.tfidf > 0.25) {
        reasons.push(`Bill wording matches this ledger (${(sig.tfidf * 100).toFixed(0)}% similarity)`);
      }
      if (sig.fuzzy > 0.75 && !reasons.length) {
        reasons.push(`Ledger name closely matches the bill text (${(sig.fuzzy * 100).toFixed(0)}%)`);
      }
      const hit = ledger.aliases.find((a) => text.includes(a));
      if (hit !== undefined) {
        reasons.push(`Bill mentions '${hit}'`);
        score += 0.08;
      }
      if (tok) reasons.push("Similar past bills were coded here");

      score = Math.min(1.0, score);
      results.push({
        ledger: name,
        score,
        band: bandFor(score),
        reasons: reasons.length ? reasons : ["Weak text similarity"],
        signals: sig,
      });
    }

    results.sort((a, b) => b.score - a.score);
    calibrate(results, this.bands, this.memoryTrustCount);
    if (results.length && Object.keys(this.usage).length) {
      const used = this.usage[results[0].ledger] ?? 0;
      if (used >= 25) {
        results[0].reasons.push(`Used ${used} times in your Tally journals`);
      }
    }

    // Short-circuit: a well-established vendor mapping wins outright.
    const memEntries = Object.entries(memCounts);
    if (memEntries.length) {
      let best = memEntries[0];
      for (const e of memEntries) if (e[1] > best[1]) best = e;
      if (best[1] >= this.memoryTrustCount) {
        const idx = results.findIndex((r) => r.ledger === best[0]);
        if (idx >= 0) {
          const r = results[idx];
          r.score = Math.max(r.score, 0.93);
          // DIVERGENCE? Faithful to the Python, which re-bands here with the
          // DEFAULT thresholds while _calibrate honours the configured ones
          // (classify.py line 404 calls band_for without self.bands). With
          // custom bands a short-circuited result can carry a band no other
          // suggestion could get. Ported as-is.
          r.band = bandFor(r.score);
          r.reasons.unshift(
            `Confirmed mapping - this vendor has gone to ${best[0]} ${best[1]} times`,
          );
          results.splice(idx, 1);
          results.unshift(r);
        }
      }
    }

    return results.slice(0, topK);
  }
}

// ---------------------------------------------------------------------------
// Calibration
//
// Raw ensemble scores are not probabilities and do not span 0-1. Even a
// clearly correct match lands around 0.30-0.45, because a short ledger name
// can only overlap so much with a bill. Handing those numbers to a clerk as
// "16% confident" is both wrong and destroys trust in the tool.
//
// Two things actually indicate a reliable answer:
//
//   absolute strength  - how strong is the top match on its own
//   margin             - how much better is it than the runner-up
//
// Margin matters as much as strength. A top score of 0.30 with the next
// candidate at 0.05 is a confident answer; 0.30 with the next at 0.28 is a
// coin flip, and the clerk should be told so.
//
// STRONG_RAW is the raw score treated as fully convincing. It is deliberately
// conservative and should be re-tuned once a few hundred confirmations exist:
// compare the raw score of confirmed-correct suggestions against corrected
// ones and set it near the crossover.
// ---------------------------------------------------------------------------
export const STRONG_RAW = 0.42;

// Confidence ceiling by how many times this vendor->ledger pair has been
// confirmed. Without this, a SINGLE confirmation produces a 100% "high"
// suggestion - the memory signal dominates the ensemble and the margin over
// the runner-up becomes enormous.
//
// That is not acceptable. One confirmation could be a clerk clicking through
// carelessly, and a system that treats one click as certainty will propagate
// that mistake to every future bill from the vendor. Evidence has to
// accumulate before the tool is allowed to sound certain, so the ceiling
// rises with the count and only reaches the "high" band at
// MEMORY_TRUST_COUNT.
export const MEMORY_CONFIDENCE_CEILING: Record<number, number> = { 0: 1.00, 1: 0.70, 2: 0.82 };

// Python's round() is banker's rounding; the difference from Math.round only
// exists on exact .0005 ties, which the float scores here never hit.
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function calibrate(
  results: Suggestion[],
  bands?: BandThresholds | null,
  trustCount: number = MEMORY_TRUST_COUNT,
): void {
  if (!results.length) return;
  const rawTop = results[0].score;
  const rawSecond = results.length > 1 ? results[1].score : 0.0;

  results.forEach((r, i) => {
    const raw = r.score;
    r.signals.raw = round3(raw);
    const absolute = Math.min(1.0, raw / STRONG_RAW);
    let conf: number;
    if (i === 0) {
      const margin = rawTop > 1e-6 ? (rawTop - rawSecond) / rawTop : 0.0;
      conf = 0.60 * absolute + 0.40 * Math.min(1.0, margin * 1.6);
    } else {
      // Runners-up are scored on strength alone; they have no margin.
      conf = absolute * 0.75;
    }

    const count = Math.trunc(r.signals.memory_count ?? 0);
    if (count < trustCount) {
      const ceiling = MEMORY_CONFIDENCE_CEILING[count] ?? 1.0;
      if (conf > ceiling) {
        conf = ceiling;
        if (count) {
          r.reasons.push(
            `Confidence capped until this vendor has been confirmed ` +
            `${trustCount} times (${count} so far)`,
          );
        }
      }
    }

    r.score = round3(Math.min(1.0, conf));
    r.band = bandFor(r.score, bands);
  });
}
