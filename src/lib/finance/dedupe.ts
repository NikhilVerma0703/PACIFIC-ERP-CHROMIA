// Duplicate detection — the decision layer, ported from
// automation/app/dedupe.py.
//
// A duplicate bill that reaches Tally becomes a duplicate payment, so this is
// the most expensive error the system can make. The Python module has three
// layers; this ports the one that matters:
//
//   Layer 1  file sha256      at upload, BLOCKING   same file, byte for byte
//   Layer 2  perceptual hash  at upload, warning    same bill photographed twice
//   Layer 3  business key     after extraction      same invoice, any image
//
// Layers 1 and 2 only see pixels — a clerk who photographs the same bill from a
// slightly different angle defeats both. Layer 3 compares what the bill says,
// and is the only one whose logic is subtle enough to be worth porting apart
// from its storage. Layer 1 is a sha256 the caller can compute; layer 2 needs a
// perceptual hash library and is a warning either way.
//
// Everything except layer 1 is a WARNING WITH OVERRIDE, never a hard block. Two
// genuinely different bills from one vendor on one day for one amount do happen
// — two identical taxi fares — and a system that cannot be overridden will be
// worked around, usually by not using it.

// ---------------------------------------------------------------------------
// rapidfuzz equivalents.
//
// Ported rather than pulled from npm because duplicate detection decides
// whether a bill can be paid twice, and the scores here have to match the
// Python engine's for the same pair of strings. A package with slightly
// different normalisation would shift every threshold below by an unknown
// amount, silently. All three return 0..100, as rapidfuzz does.
//
// They sit in this file rather than their own because `node --test` resolves
// ESM strictly — a relative import with no .ts extension fails, and adding the
// extension fights the Next build. Every tested module in this repo is
// self-contained for the same reason.
// ---------------------------------------------------------------------------

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

/** rapidfuzz.fuzz.ratio — normalised Indel similarity. Indel distance is
 *  len(a)+len(b)-2·LCS, so the similarity reduces to 2·LCS/(len(a)+len(b)). */
export function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  if (!a.length || !b.length) return 0;
  return (200 * lcsLength(a, b)) / (a.length + b.length);
}

/** rapidfuzz.fuzz.partial_ratio — best ratio of the shorter string against any
 *  equal-length window of the longer one. */
export function partialRatio(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === long.length) return ratio(short, long);
  let best = 0;
  for (let i = 0; i + short.length <= long.length; i++) {
    best = Math.max(best, ratio(short, long.slice(i, i + short.length)));
    if (best === 100) break;
  }
  return best;
}

function tokens(s: string): string[] {
  return s.split(/\s+/).map((t) => t.trim()).filter(Boolean);
}

/** rapidfuzz.fuzz.token_set_ratio — order-insensitive and forgiving of one
 *  string carrying extra words, which is what vendor names need. */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size && !tb.size) return 100;
  const inter = [...ta].filter((t) => tb.has(t)).sort();
  const onlyA = [...ta].filter((t) => !tb.has(t)).sort();
  const onlyB = [...tb].filter((t) => !ta.has(t)).sort();
  const t0 = inter.join(" ");
  const t1 = [...inter, ...onlyA].join(" ").trim();
  const t2 = [...inter, ...onlyB].join(" ").trim();
  return Math.max(ratio(t0, t1), ratio(t0, t2), ratio(t1, t2));
}

/** Weights sum to 1.0. GSTIN and invoice number carry most of it because they
 *  identify the document; amount and date corroborate but do not identify. */
export const WEIGHTS = { gstin: 0.30, invoiceNo: 0.35, amount: 0.20, date: 0.15 } as const;
export const FLAG_THRESHOLD = 0.72;

export interface BillFacts {
  vendorGstin?: string | null;
  vendorName?: string | null;
  invoiceNo?: string | null;
  netAmount?: number | null;
  /** ISO yyyy-mm-dd; anything longer is truncated to the date part. */
  invoiceDate?: string | null;
}

export interface DuplicateVerdict {
  /** 0..1. Above FLAG_THRESHOLD the bill is flagged for a human. */
  score: number;
  flagged: boolean;
  /** Human-readable reasons, in the order they were found. */
  why: string[];
}

/**
 * Strip everything that varies between two readings of the same number.
 *
 * "INV-0074/26", "inv 74/26" and "INV74/26" are the same invoice. Leading
 * zeros go too, because OCR drops and invents them freely.
 */
export function normaliseInvoiceNo(s: string | null | undefined): string {
  if (!s) return "";
  let out = s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  // Zeros between a letter prefix and the digits: INV0074 -> INV74.
  out = out.replace(/(?<=[A-Z])0+(?=\d)/g, "");
  return out.replace(/^0+/, "") || out;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/**
 * Score one candidate bill against one already-known bill.
 *
 * Weighted rather than all-or-nothing, because OCR will mangle one field on
 * any given bill. Three rules keep it honest, and each exists because the
 * plain weighted sum gets that case wrong:
 *
 *   - GSTIN + invoice number agreeing is decisive on its own. Those two fields
 *     uniquely identify a tax invoice in India.
 *   - Same vendor, same amount, same day scores 0.65 on the weights and would
 *     slip through, but it is the classic double-claim: the same receipt
 *     submitted twice with OCR reading the invoice number differently each
 *     time, so the invoice signal never fires. Lifted to 0.80.
 *   - Amount + date WITHOUT a vendor match is a coincidence, not a duplicate.
 *     In a business with many small bills, flagging it would train people to
 *     click through warnings — so it is dropped outright.
 */
export function scoreAgainst(candidate: BillFacts, existing: BillFacts): DuplicateVerdict {
  const gstin = (candidate.vendorGstin ?? "").toUpperCase();
  const inv = normaliseInvoiceNo(candidate.invoiceNo);
  const vendor = (candidate.vendorName ?? "").toLowerCase();
  const amount = candidate.netAmount ?? null;
  const date = parseDate(candidate.invoiceDate);

  let score = 0;
  const why: string[] = [];

  const rGstin = (existing.vendorGstin ?? "").toUpperCase();
  const gstinHit = Boolean(gstin && rGstin && gstin === rGstin);
  if (gstinHit) {
    score += WEIGHTS.gstin;
    why.push("same GSTIN");
  } else if (vendor && existing.vendorName) {
    const sim = tokenSetRatio(vendor, existing.vendorName.toLowerCase()) / 100;
    if (sim > 0.85) {
      score += WEIGHTS.gstin * sim * 0.8;
      why.push(`vendor name ${Math.round(sim * 100)}% similar`);
    }
  }

  const rInv = normaliseInvoiceNo(existing.invoiceNo);
  let invHit = false;
  if (inv && rInv) {
    // The same invoice is routinely read two different ways — "INV-07039" one
    // time and bare "7039" the next, depending on whether OCR caught the
    // prefix. Straight ratio scores that pair around 72% and misses a real
    // duplicate, so containment of the shorter in the longer is checked too,
    // provided the shorter is long enough to mean something on its own.
    let sim = ratio(inv, rInv) / 100;
    const [short, long] = inv.length <= rInv.length ? [inv, rInv] : [rInv, inv];
    if (short.length >= 4 && long.includes(short)) {
      sim = Math.max(sim, 0.97);
    } else if (short.length >= 4) {
      sim = Math.max(sim, (partialRatio(short, long) / 100) * 0.95);
    }
    if (sim >= 0.90) {
      score += WEIGHTS.invoiceNo * sim;
      invHit = sim >= 0.95;
      why.push(`invoice no ${existing.invoiceNo}`);
    }
  }

  let amountHit = false;
  if (amount && existing.netAmount) {
    if (Math.abs(Number(amount) - Number(existing.netAmount)) <= 1.0) {
      score += WEIGHTS.amount;
      amountHit = true;
      why.push(`same amount ${Number(amount).toFixed(2)}`);
    }
  }

  let dateHit = false;
  const rDate = parseDate(existing.invoiceDate);
  if (date && rDate && daysApart(date, rDate) <= 1) {
    score += WEIGHTS.date;
    dateHit = true;
    why.push(`same date ${existing.invoiceDate}`);
  }

  if (gstinHit && invHit) {
    score = Math.max(score, 0.95);
  } else if (gstinHit && amountHit && dateHit) {
    score = Math.max(score, 0.80);
    why.push("same vendor, amount and date");
  }

  // Coincidence, not a duplicate.
  if (!gstinHit && !invHit && amountHit && dateHit) {
    return { score: 0, flagged: false, why: [] };
  }

  const final = Math.min(1, score);
  return { score: final, flagged: final >= FLAG_THRESHOLD, why };
}

/** Score against every known bill, strongest first, capped like the Python. */
export function findDuplicates<T extends BillFacts>(
  candidate: BillFacts,
  existing: T[],
  limit = 5,
): Array<{ bill: T; verdict: DuplicateVerdict }> {
  return existing
    .map((bill) => ({ bill, verdict: scoreAgainst(candidate, bill) }))
    .filter((m) => m.verdict.flagged)
    .sort((a, b) => b.verdict.score - a.verdict.score)
    .slice(0, limit);
}
