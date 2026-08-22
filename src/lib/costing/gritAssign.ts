/**
 * The row key for grit the mixer weighed against no silo.
 *
 * A sentinel and not "": an empty string reads as missing data everywhere it
 * lands, and this is a real bucket of real kilograms that somebody has to
 * price. It cannot collide with a silo number, which is always numeric.
 */
export const NO_SILO = "(no silo)";
// Grit assigned silo by silo: the comparison rules, and nothing else.
//
// NO IMPORTS, deliberately — the same reason lib/roles.ts, lib/costing/verification.ts
// and lib/costing/gritBand.ts have none. Everything here is reachable from
// `node --test` without the "@/" alias, without Prisma and without a database,
// which is the only way rules about money get exercised at all.
//
// TWO THINGS THIS MODULE IS NOT ALLOWED TO BE:
//
//   * It never decides that a save is refused. Every function here either
//     reports a comparison or lists an ABSENCE. A disagreement between what the
//     verifier entered and what the bag records say is a FLAG, and a flag stops
//     nothing, ever — the entered value is what the batch is costed at. The
//     return types carry no `blocking` field precisely so that cannot drift.
//   * It never names, shapes or produces anything a Silo row could be written
//     from. It reports `entered` and `recorded` and no third thing. Whatever a
//     caller does with a mismatch, it cannot be "apply it back to the silo",
//     because nothing here hands it a patch.

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/**
 * Canonical size key — A COMPARISON KEY ONLY, NEVER A CATALOGUE KEY.
 *
 * bandOf() in gritBand.ts does two jobs with one string: it normalises a size
 * AND produces the rate-card item key. That conflation is what made batch 1414
 * ask for a rate called 'grit-Grit' — a lookup nothing can satisfy and no screen
 * can set. sizeKey does only the first job, so sizeKey("Grit") === "grit" is a
 * perfectly good comparison key that can never become a catalogue item.
 *
 * bandOf is left alone. The two are allowed to disagree: one answers "are these
 * the same size", the other answers "which rate row is this".
 */
export function sizeKey(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    // The dash family. GRIT_BAND_LABELS renders bands with a literal EN DASH
    // ("Grit 0.1 – 0.4"), so one arrives here by copy-paste sooner or later.
    .replace(/[‐-―−﹘﹣－]/g, "-")
    // A COMMA BETWEEN DIGITS IS A DECIMAL POINT. This one is not a near-miss
    // like the others below — left alone, "0,1-0,4" normalises to "1-4", which
    // is not a failure to match but a DIFFERENT, entirely legitimate-looking
    // band. A silent wrong answer beats a visible miss every time, so it is
    // handled before anything else can strip the comma as punctuation.
    .replace(/(\d),(\d)/g, "$1.$2")
    // Separators people type instead of a hyphen. Bounded by digits on both
    // sides on purpose: an unbounded "to" would eat the letters out of any word
    // containing it, and these are comparison keys, not display strings.
    .replace(/(\d)\s*(?:to|[x×*/~])\s*(\d)/g, "$1-$2")
    .replace(/#/g, " ")
    // Units, glued or spaced. No word boundary — "0.1-0.4mm" is written without
    // one at least as often as with.
    .replace(/(mm|mesh|micron|sm|pm)/g, " ")
    .replace(/[^a-z0-9.\-]+/g, " ")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-{2,}/g, "-")        // "0.1--0.4"
    .replace(/^-+|-+$/g, "")       // a stray hyphen at either end
    // Precision folded LAST, once the string is otherwise canonical:
    //   "0.10-0.40" -> "0.1-0.4",  ".5" -> "0.5",  "8-16" -> "8-16"
    .replace(/\d*\.?\d+/g, (n) => String(Number(n)));
}

export type SizeVerdict = "match" | "match-of-conflict" | "mismatch" | "no-silo-value" | "no-entry";

export interface SizeMatch {
  verdict: SizeVerdict;
  entered: string;
  recorded: readonly string[];
  key: string;
  recordedKeys: readonly string[];
}

/**
 * Size is normalised-exact, never fuzzy, and that is a deliberate asymmetry
 * with the supplier matcher next door.
 *
 * A similarity score on sizes is actively harmful: "0.1-0.4" and "0.3-0.7" are
 * 71% similar as strings and are different materials at different prices, and
 * "0.1-0.4" against "0.6-1.2" is a 35% pricing error. The problem with sizes was
 * never similarity — it is one band written five ways, which is what a
 * normaliser solves and a threshold cannot.
 */
export function matchSize(entered: string, recorded: readonly string[]): SizeMatch {
  const key = sizeKey(entered);
  const recordedKeys = [...new Set(recorded.map(sizeKey).filter(Boolean))];
  if (!key) return { verdict: "no-entry", entered, recorded, key, recordedKeys };
  if (!recordedKeys.length) return { verdict: "no-silo-value", entered, recorded, key, recordedKeys };
  if (!recordedKeys.includes(key)) return { verdict: "mismatch", entered, recorded, key, recordedKeys };
  // He picked one of the sizes the bags record. When they record more than one,
  // that is the bad-data case — a silo runs one size in a batch — and picking
  // correctly from a contradiction is worth saying out loud rather than
  // silently treating as a clean match.
  return {
    verdict: recordedKeys.length > 1 ? "match-of-conflict" : "match",
    entered, recorded, key, recordedKeys,
  };
}

/**
 * The size list offered on every batch.
 *
 * Derived, never administered — the suggestedSuppliers() precedent. Seeded with
 * the five bands the rate card knows so the dropdown is useful on the very first
 * batch, then everything anybody has ever assigned, then whatever the bags on
 * THIS batch happen to record.
 *
 * Deduped by sizeKey so a typo that normalises to an existing size does not
 * appear beside it as a second option — which is the whole failure this replaces.
 */
export function mergeSizeCatalogue(
  everAssigned: readonly string[],
  knownBands: readonly string[],
  recordedOnThisBatch: readonly string[],
): string[] {
  const byKey = new Map<string, string>();
  for (const raw of [...knownBands, ...everAssigned, ...recordedOnThisBatch]) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const k = sizeKey(v);
    if (!k || byKey.has(k)) continue;   // first spelling wins — bands are seeded first
    byKey.set(k, v);
  }
  // Low end of the band first where there is one, then lexically, so the list
  // reads in the order the plant thinks about grit rather than alphabetically.
  const low = (s: string): number => {
    const m = sizeKey(s).match(/^(\d*\.?\d+)/);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  return [...byKey.values()].sort((a, b) => low(a) - low(b) || a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

/** Legal and generic tails that carry no identity. "minerals"/"industries" are
 *  in here because the plant writes the same supplier with and without them. */
const SUPPLIER_STOPWORDS = new Set([
  "pvt", "private", "ltd", "limited", "llp", "inc", "co", "company", "corp",
  "corporation", "industries", "enterprises", "traders", "trading", "minerals",
  "and",
]);

/**
 * Canonical supplier key.
 *
 * Extends the IDEA of supKey in app/store/actions.ts, NOT the function: that one
 * sits on a write path into resin storage, and importing it would hand this
 * module an edge into a mutation — which is exactly what the containment rule
 * exists to prevent.
 *
 * STEP ORDER IS LOAD-BEARING:
 *   1. lowercase, strip diacritics
 *   2. "&" -> " and " BEFORE the stoplist, so "A&A" and "A & A" collapse alike
 *   3. drop the Airtable truncation tail ("Pristine Quartz Pri..." -> the words)
 *   4. punctuation -> space, then drop stopwords
 *   5. SINGLETON GLUE, LAST: a one-character token joins the token after it,
 *      so "3 n composites" -> "3n composites" and "supreme g 2" -> "supreme g2".
 *      Without it, "3n Composits" vs "3N Composites" — a pair the rate card
 *      itself ships (RESIN_TANK_SUPPLIER, STARTER_RATES) — reads as a mismatch.
 */
export function supKey(v: unknown): string {
  const base = String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\.\.\.+$/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!base) return "";
  const kept = base.split(/\s+/).filter((t) => t && !SUPPLIER_STOPWORDS.has(t));
  const glued: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].length === 1 && i + 1 < kept.length) { glued.push(kept[i] + kept[i + 1]); i++; }
    else glued.push(kept[i]);
  }
  return glued.join(" ");
}

/** Levenshtein distance. Small strings; the simple DP is the right one here. */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0-100 similarity. */
function ratio(a: string, b: string): number {
  if (!a && !b) return 100;
  const m = Math.max(a.length, b.length);
  return m ? ((1 - lev(a, b) / m) * 100) : 100;
}

/** Order-insensitive: "grit vinayaka" and "vinayaka grit" are one supplier. */
function tokenSortRatio(a: string, b: string): number {
  const sort = (x: string) => [...new Set(x.split(" ").filter(Boolean))].sort().join(" ");
  return ratio(sort(a), sort(b));
}

/**
 * Subset-tolerant similarity — the one that matters here.
 *
 * The plant qualifies a supplier with the material: "Grit Vinayaka" IS
 * "Vinayaka". A sort-ratio scores that pair 61.5 and flags it, which is a false
 * alarm on one of the commonest spellings in the data. Comparing the shared
 * tokens against each side's remainder scores it 100, because one name's tokens
 * are wholly contained in the other's.
 *
 * The grade override still holds afterwards: "Supreme G2" vs "Supreme" scores
 * 100 here and is then pinned to 80 for having a discriminator on one side only.
 */
function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).sort().join(" ");
  const restA = [...ta].filter((t) => !tb.has(t)).sort().join(" ");
  const restB = [...tb].filter((t) => !ta.has(t)).sort().join(" ");
  const t1 = (inter + " " + restA).trim();
  const t2 = (inter + " " + restB).trim();
  return Math.max(ratio(inter, t1), ratio(inter, t2), ratio(t1, t2));
}

/** A token carrying a digit is a GRADE, not a name — "G2" against "G3" is two
 *  products of one mineral at two prices. Leading zeros stripped so "g02" and
 *  "g2" are one discriminator. */
function discriminators(key: string): string[] {
  return key.split(" ")
    .filter((t) => /\d/.test(t))
    .map((t) => t.replace(/\b0+(\d)/g, "$1"))
    .sort();
}

export const SUPPLIER_THRESHOLD = 85;

export type SupplierVerdict = "exact" | "match" | "mismatch" | "no-silo-value" | "no-entry";

export interface SupplierMatch {
  verdict: SupplierVerdict;
  entered: string;
  recorded: readonly string[];
  score: number;
  against: string | null;
  reason: "variant-token" | "variant-token-one-sided" | null;
}

/**
 * Supplier IS fuzzy, because the plant genuinely spells one supplier several
 * ways — "Vinayaka" / "Grit Vinayaka" / "VINAYAKA", and the rate card itself
 * ships "3n Composits" as load-bearing production data.
 *
 * THE VARIANT-TOKEN OVERRIDE IS THE POINT, not the threshold. "Supreme G2"
 * scores 90 against "Supreme G3" and 100 against "Supreme" on a token-set
 * comparison — grades of one mineral at different prices, and the most expensive
 * error this could make. So when two names' digit-bearing tokens disagree the
 * score is pinned below the threshold no matter how similar the letters are.
 */
export function matchSupplier(entered: string, recorded: readonly string[]): SupplierMatch {
  const key = supKey(entered);
  const cands = recorded.map((r) => ({ raw: r, key: supKey(r) })).filter((c) => c.key);
  const base = { entered, recorded, against: null as string | null, reason: null as SupplierMatch["reason"] };
  if (!key) return { ...base, verdict: "no-entry", score: 0 };
  if (!cands.length) return { ...base, verdict: "no-silo-value", score: 0 };

  let best = { score: -1, raw: null as string | null, reason: null as SupplierMatch["reason"] };
  for (const c of cands) {
    if (c.key === key) { best = { score: 100, raw: c.raw, reason: null }; break; }
    let score = Math.max(ratio(key, c.key), tokenSortRatio(key, c.key), tokenSetRatio(key, c.key));
    let reason: SupplierMatch["reason"] = null;
    const a = discriminators(key), b = discriminators(c.key);
    if (a.length && b.length && a.join(",") !== b.join(",")) { score = Math.min(score, 60); reason = "variant-token"; }
    else if (a.length !== b.length) { score = Math.min(score, 80); reason = "variant-token-one-sided"; }
    if (score > best.score) best = { score, raw: c.raw, reason };
  }

  const score = Math.round(best.score * 10) / 10;
  if (score === 100) return { ...base, verdict: "exact", score, against: best.raw, reason: null };
  return {
    ...base,
    verdict: score >= SUPPLIER_THRESHOLD ? "match" : "mismatch",
    score, against: best.raw, reason: best.reason,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation and blockers
// ---------------------------------------------------------------------------

/**
 * The mixer's own resolution, NOT completeness.ts's 0.005.
 *
 * That epsilon is applied to tonnes, so it tolerates 5 kg. This screen is in
 * kilograms, where 0.005 is five grams — and mixer weights are Floats, so a real
 * silo draws 12,480.3 kg. A split of 8,000 + 4,480 leaves 0.3 kg and would earn
 * a permanent blocker reading "12,480 kg of 12,480 kg": the same number twice,
 * with nothing on screen to show what is wrong.
 */
export const KG_EPSILON = 0.5;

const kg1 = (n: number): string =>
  (Math.round(n * 10) / 10).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function reconcileSuppliers(
  siloKg: number,
  suppliers: readonly { supplier: string; kg: number }[],
): { assigned: number; left: number; balanced: boolean; sentence: string } {
  const assigned = suppliers.reduce((a, s) => a + (Number.isFinite(s.kg) ? s.kg : 0), 0);
  const left = Math.round((siloKg - assigned) * 1000) / 1000;
  const balanced = Math.abs(left) <= KG_EPSILON;
  const sentence = balanced
    ? `${kg1(assigned)} of ${kg1(siloKg)} kg assigned`
    : left > 0
      ? `${kg1(left)} kg of silo ${""}${kg1(siloKg)} kg is not assigned to anybody`
      : `the lines add up to ${kg1(assigned)} kg but the mixer drew ${kg1(siloKg)} kg`;
  return { assigned, left, balanced, sentence };
}

export interface GritSiloLine {
  silo: string;
  /** "" until the verifier picks one. */
  size: string;
  kg: number;
  suppliers: readonly { supplier: string; kg: number }[];
}

/**
 * What is MISSING, for the sign-off gate. Never what merely disagrees.
 *
 * The distinction this must never blur: a flag blocks nothing, ever — the
 * entered value is what the batch costs at. An absence blocks a SIGN-OFF, in
 * exactly the way a missing price already does, and blocks nothing else. Saving
 * is never gated by either.
 */
export function gritAssignBlockers(rows: readonly GritSiloLine[], label?: (size: string) => string): string[] {
  const out: string[] = [];
  const name = (r: GritSiloLine): string =>
    r.size ? `${label ? label(r.size) : r.size} — silo ${r.silo}` : `Grit — silo ${r.silo}`;
  for (const r of rows) {
    if (r.kg <= 0) continue;
    if (!r.size.trim()) { out.push(`${name(r)}: no size assigned by the production verifier`); continue; }
    const named = r.suppliers.filter((s) => s.supplier.trim());
    if (!named.length) { out.push(`${name(r)}: no supplier assigned`); continue; }
    const { assigned, left, balanced } = reconcileSuppliers(r.kg, named);
    if (balanced) continue;
    out.push(left > 0
      ? `${name(r)}: suppliers cover ${kg1(assigned)} kg of ${kg1(r.kg)} kg drawn`
      : `${name(r)}: ${kg1(-left)} kg more assigned to suppliers than the mixer drew`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Keys, labels and the sentences the sheet prints
// ---------------------------------------------------------------------------

/**
 * The rate-card item key for one silo's grit on one batch.
 *
 * DELIBERATELY EXCLUDES THE SIZE. A price is typed against a silo, and the size
 * is a separate fact about that silo which the verifier can correct afterwards.
 * Folding the size into the key would orphan the price the moment he did —
 * the money would vanish from the sheet with nothing to say why.
 *
 * The cost of that choice is real and is paid elsewhere: because the key does
 * not move when the size does, nothing about the stored price changes either,
 * which is exactly why the size had to go into costsFingerprint.
 */
export const gritSiloItemKey = (silo: string) => `grit-silo-${String(silo).trim()}`;

/** How a silo's grit reads on the sheet and in a blocker. */
export function gritSiloLabel(silo: string, size: string): string {
  const s = String(size ?? "").trim();
  return s ? `Grit ${s} — silo ${silo}` : `Grit — silo ${silo}`;
}

/** The shape gritFlagSentences needs. Structural, so a loader row satisfies it
 *  without this module importing anything. */
export interface GritSiloFlagInput {
  silo: string;
  size: string;
  suppliers: readonly { supplier: string; kg: number }[];
  recordedSizes: readonly string[];
  recordedSuppliers: readonly string[];
}

/**
 * Every disagreement between what was assigned and what the bags record, in
 * words, for the sheet's assumptions block.
 *
 * REPORTS ONLY. The assigned value is what the batch is costed at, in every one
 * of these sentences — none of them is a correction, a suggestion to change the
 * silo, or a reason to refuse anything. That is the difference between a flag
 * and a blocker, and it is the rule the whole feature rests on.
 */
export function gritFlagSentences(rows: readonly GritSiloFlagInput[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const size = matchSize(r.size, r.recordedSizes);
    if (size.verdict === "mismatch") {
      out.push(
        `Silo ${r.silo}: the bags record ${r.recordedSizes.join(", ")}, and ${r.size} was assigned — ` +
        `the batch is costed at ${r.size}.`,
      );
    } else if (size.verdict === "match-of-conflict") {
      out.push(
        `Silo ${r.silo}: the bags record two sizes (${r.recordedSizes.join(", ")}), which cannot both be ` +
        `true of one silo in one batch. ${r.size} was assigned and is what the batch is costed at.`,
      );
    }
    for (const p of r.suppliers) {
      const sup = matchSupplier(p.supplier, r.recordedSuppliers);
      if (sup.verdict !== "mismatch") continue;
      out.push(
        `Silo ${r.silo}: the bags came from ${r.recordedSuppliers.join(", ")}, and ${p.supplier} was ` +
        `assigned to ${Math.round(p.kg)} kg of it.`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pricing one silo. PURE, and here rather than in report.ts because report.ts
// is server-only and `node --test` cannot load it — so arithmetic left in there
// is arithmetic nothing checks. This is the money, so it lives where it can be
// tested.
// ---------------------------------------------------------------------------

/** One split line as the costing sees it. */
export interface GritPricedLine {
  supplier: string;
  kg: number;
  /** NULL means nobody has priced it. It is never zero — see the caller. */
  ratePerT: number | null;
}

export interface GritSiloPricing {
  /** Priced lines, ready to become material rows. Tonnes, because the rate is
   *  rupees per tonne; the kg→t conversion happens HERE and nowhere else. */
  lines: Array<{ supplier: string; tonnes: number; ratePerT: number }>;
  /** What is missing, in tonnes, with the sentence that says what to do. */
  missing: Array<{ tonnes: number; needs: string }>;
  /** Whether the whole sheet must be withheld. TRUE whenever anything about
   *  this silo is unpriced — an under-reported total that looks complete is
   *  worse than no total, because nobody goes looking for the difference. */
  withhold: boolean;
}

/**
 * What one assigned silo contributes to the sheet.
 *
 * THE RULE THIS ENCODES: a silo is costed from its SPLIT LINES, each at its own
 * rupees-per-tonne, because a silo is split across suppliers precisely when the
 * supplier — and therefore the invoice and the price — differs.
 *
 * NULL IS NOT ZERO, and that is the whole of the safety here. An unpriced line
 * withholds the sheet; costing it at nothing would print a complete-looking
 * total with that grit silently missing. It would not look broken. It would
 * look like a cheap batch.
 */
export function priceGritSilo(sil: {
  silo: string;
  size: string;
  kg: number;
  suppliers: readonly GritPricedLine[];
}): GritSiloPricing {
  const out: GritSiloPricing = { lines: [], missing: [], withhold: false };
  if (sil.kg <= 0) return out;

  const split = sil.suppliers ?? [];
  if (!split.length) {
    out.withhold = true;
    out.missing.push({
      tonnes: sil.kg / 1000,
      needs: sil.size
        ? "a supplier and a price per tonne for this silo"
        : "a size, a supplier and a price per tonne for this silo",
    });
    return out;
  }

  let pricedKg = 0;
  for (const l of split) {
    if (l.ratePerT == null) {
      out.withhold = true;
      out.missing.push({
        tonnes: l.kg / 1000,
        needs: `a price per tonne for ${l.supplier || "the supplier"} on silo ${sil.silo}`,
      });
      continue;
    }
    pricedKg += l.kg;
    out.lines.push({ supplier: l.supplier, tonnes: l.kg / 1000, ratePerT: l.ratePerT });
  }

  // Tonnage the mixer drew that no line accounts for, in EITHER direction.
  //
  // Under-assigned is grit nobody has priced: reported and withheld, because a
  // sheet computed without it under-reports the batch.
  //
  // OVER-assigned is worse and used to pass silently: the lines are costed at
  // their own kilograms, so a fat-fingered 41,814 against a silo that drew
  // 17,180 prices 24 tonnes of grit that was never weighed - and the sheet
  // prints as complete. Every sibling path already defends this (splitMaterial
  // pushes a problem sentence; completeness blocks on a negative remainder) and
  // this one did not.
  const short = Math.round((sil.kg - pricedKg) * 1000) / 1000;
  if (short < -0.005) {
    out.withhold = true;
    out.missing.push({
      tonnes: short / 1000,          // negative: the sheet must not add this in
      needs: `the lines on silo ${sil.silo} add up to ${Math.round(pricedKg * 1000) / 1000} kg ` +
             `but the mixer drew ${sil.kg} kg - correct the split before this batch is costed`,
    });
  } else if (short > 0.005 && !split.some((l) => l.ratePerT == null)) {
    out.withhold = true;
    out.missing.push({
      tonnes: short / 1000,
      needs: `a supplier and a price for the remaining ${short} kg of silo ${sil.silo}`,
    });
  }
  return out;
}

/**
 * The grit facts the COSTS fingerprint needs, derived in ONE place.
 *
 * There are three callers of costsFingerprint — the report drawer, the verify
 * screen and the admin batch-rates panel — and they each build the shape by
 * hand. That is exactly how `gritSizes` came to be accepted by the function,
 * documented at length, tested, and passed by nobody: three copies drifted and
 * the newest fact never reached any of them. One helper, three spreads.
 *
 * Returns undefined for an unassigned batch rather than empty arrays, so the
 * length guards in costsFingerprint keep hashing those batches byte-identically
 * and no standing sign-off lapses on deploy.
 */
export function gritCostFacts(gritSilos: ReadonlyArray<{
  silo: string;
  size: string;
  gritType?: string;
  suppliers: ReadonlyArray<{ seq: number; ratePerT: number | null }>;
}> | null | undefined): {
  gritSizes?: Array<{ silo: string; size: string }>;
  gritTypes?: Array<{ silo: string; gritType: string }>;
  gritRates?: Array<{ silo: string; seq: number; rate: number | null }>;
} {
  if (!gritSilos?.length) return {};
  return {
    gritSizes: gritSilos.map((s) => ({ silo: s.silo, size: s.size })),
    gritTypes: gritSilos.map((s) => ({ silo: s.silo, gritType: s.gritType ?? "" })),
    // Every line, priced or not. A NULL hashes as "unpriced" inside the
    // fingerprint, so putting a first price on a blank line moves the string —
    // which is the single most important edit for this to catch.
    gritRates: gritSilos.flatMap((s) =>
      s.suppliers.map((p) => ({ silo: s.silo, seq: p.seq, rate: p.ratePerT }))),
  };
}
