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
    .replace(/[×x*]/gi, "-")
    .replace(/#/g, " ")
    .replace(/\b(mm|mesh|micron|sm|pm)\b/g, " ")
    .replace(/[^a-z0-9.\-]+/g, " ")
    .trim()
    .replace(/\s+/g, "")
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
