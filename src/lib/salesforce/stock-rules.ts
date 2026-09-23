// WHAT SALESFORCE IS TOLD WE HAVE — the pure half (the owner, 2026-09-14: "we
// have to connect our erp to salesforce to show inventory", then "should be
// able to see active stock too" and "the stock search should have both slab and
// sample option").
//
// DIRECTION IS ONE WAY, ALWAYS. The product MASTER is Salesforce's; the STOCK
// is the ERP's. Nothing here reads a Salesforce number and believes it.
//
// No Prisma, no Next, no auth, no `@/` alias: `node --test` loads this bare and
// tests/salesforceStock.test.ts runs every rule below against the fixtures in
// docs/salesforce-link/DISCOVERY.md §3. The sync job does the I/O and makes no
// decisions.
//
// ── THE ONE RULE THAT MATTERS ───────────────────────────────────────────────
//
// A LINE IS PUBLISHED ONLY WHEN ITS DESIGN IS KNOWN. The yard types
// `fg_finished_slab.design` by hand and there are 455 distinct spellings for
// perhaps 70 real designs: "Alabester White", "Astal Mist", "Artermis",
// "Arno Robo", "Astral Mist Kreos Trail-2". Deriving a product code straight
// from that text would put QZ-ASTALMIST-20 into Salesforce as a product nobody
// sells, against stock that is really Astral Mist — and the rep would search
// for Astral Mist and be told there is none.
//
// So a (design, thickness) line reaches Salesforce only when the canonical
// design is KNOWN: it is a canonical value in fg_design_alias, or its derived
// code matches an active Quartz Slab product at ANY thickness. Everything else
// is recorded as unmapped WITH ITS SLAB COUNT, which turns the alias backlog
// into a worklist sorted by how much stock is hidden behind it. Aliasing
// "Astal Mist" → "Astral Mist" folds its count into QZ-ASTRALMIST-20 on the
// next run with no Salesforce change at all.
//
// This is refused HERE, in a tested function, and not by convention in the job.
import { canonThickness } from "../thickness.ts";
import { canonicalFinish } from "../catalogue/colours.ts";
import { canonicalGrade, gradeBlocksDispatch } from "../inventory/grading.ts";

// ── thickness ───────────────────────────────────────────────────────────────

/**
 * The four thicknesses that are a NUMBER, and therefore can be half of a
 * product code. canonThickness folds the spellings it recognises into these
 * four labels and passes everything else through unchanged.
 *
 * "10 mm" IS NOT HERE, AND THAT IS NOT AN OVERSIGHT. canonThickness reads it
 * as 1.0 cm, which matches none of its four bands, so it comes back as the
 * literal "10 mm" — verified, not assumed. 25 slabs carry it. Nor are the
 * cut-downs: "3 cm to 2 cm" (440 slabs) and "2cm to 12mm" describe a slab that
 * WAS one thickness and IS another, and no single number is true of them.
 * Every one of these is thickness-unmapped and is never counted against a
 * product — a cut-down counted as 3 cm would promise a customer a slab that no
 * longer exists at that thickness.
 */
export const THICKNESS_MM: Readonly<Record<string, number>> = Object.freeze({
  "7 mm": 7,
  "1.2 cm": 12,
  "2 cm": 20,
  "3 cm": 30,
});

/** The millimetre number for a yard thickness, or null when there is not one. */
export function thicknessMmFor(slabThickness: unknown): number | null {
  const label = canonThickness(slabThickness);
  const mm = THICKNESS_MM[label];
  return mm === undefined ? null : mm;
}

// ── the design and its code ─────────────────────────────────────────────────

/**
 * The canonical spelling, through the alias table the ERP already keeps — read
 * fresh every run, exactly as inventory-bridge.aliasMap() does and for the
 * same reason: designs get merged while the app is running, and a memoised map
 * would keep publishing under a name an admin has just retired.
 */
export function canonicalDesign(design: unknown, aliases: ReadonlyMap<string, string>): string {
  const raw = String(design ?? "").trim();
  if (!raw) return "";
  return aliases.get(raw) ?? aliases.get(raw.toLowerCase()) ?? raw;
}

/**
 * QZ-<NAME uppercased, non-alphanumerics stripped>-<mm>, the scheme
 * DISCOVERY §1 proved deterministic across all 110 active products: where
 * ERP_SKU__c is filled it is identical to ProductCode, so there is no lookup
 * table to ask anybody for.
 */
export function qzCode(canonical: string, mm: number): string {
  return `QZ-${foldDesignName(canonical)}-${mm}`;
}

/**
 * THE ONE NORMALISATION — uppercase, non-alphanumerics stripped.
 *
 * It was inline in qzCode and nowhere else, which is precisely how the defect
 * below happened: the CODE branch of isKnownDesign folded case and spacing
 * while the NAME branch compared the string as typed, so "Pebble ice" missed
 * the canonical "Pebble Ice" and 235 sellable slabs of four designs we already
 * publish were withheld as unknown. Two comparisons of the same thing have to
 * be the same comparison, so both now call this.
 */
export function foldDesignName(name: unknown): string {
  return String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The folded view of a canonical-name set, memoised per set object. The set is
 *  read fresh every run and has ~68 members; folding it once per run rather
 *  than once per yard group keeps isKnownDesign O(1) without making the
 *  function impure — same input, same answer, cache or no cache. */
const FOLDED_NAMES = new WeakMap<object, Set<string>>();
function foldedNames(names: ReadonlySet<string>): Set<string> {
  const hit = FOLDED_NAMES.get(names as object);
  if (hit) return hit;
  const built = new Set<string>();
  for (const n of names) {
    const f = foldDesignName(n);
    if (f) built.add(f);
  }
  FOLDED_NAMES.set(names as object, built);
  return built;
}

/**
 * DESIGNS THAT ARE NOT STOCK, whatever the alias table says.
 *
 * "Trial" is a canonical in fg_design_alias with 133 variants mapped onto it —
 * Blue Kreos, Black Vein, Arva White Kreos Trail and the rest of the plant's
 * experiments. Being a canonical made it pass the publish rule, so the first
 * live run would have offered reps 740 slabs of experimental material as
 * sellable stock (QZ-TRIAL-12, -20 and -30), and our own handoff asked
 * Pacific's Salesforce administrator to create a product for the 30 mm slice of
 * it. The org has no trial product at any thickness, and should not.
 *
 * Withheld HERE rather than by deleting the canonical, because the alias row is
 * doing useful work in the ERP: it collapses 133 experimental names into one
 * bucket for the yard. It is only Salesforce that must never see it.
 */
export const NOT_SELLABLE_CANONICALS: ReadonlySet<string> = Object.freeze(new Set(["TRIAL"]));

/**
 * A YARD NAME THAT SAYS "TRIAL" ON ITSELF, which the canonical test alone does
 * not catch. "Pebble Ice - Trial" aliases to the real design Pebble Ice, so its
 * canonical is perfectly sellable while the four slabs behind it are not.
 * Pacific's administrator asked us to keep the rule for these (his words:
 * `"… trial"`, `"Trail …"`).
 *
 * WORD BOUNDARIES, NOT A SUBSTRING. "Industrial" ends in the letters t-r-i-a-l
 * and is a real design; a bare `includes("trial")` would withhold it. The
 * marker has to be a word of its own at one end of the name, and the yard's
 * habitual misspelling "trail" counts as the same word.
 */
const TRIAL_MARKER = /(^|[\s\-])(trial|trail)([\s\-]|$)/i;

/** Does the org sell a product under THIS exact name, at any thickness? */
export function hasProductAtAnyThickness(name: unknown, productCodes: ReadonlySet<string>): boolean {
  const n = String(name ?? "").trim();
  if (!n) return false;
  for (const mm of Object.values(THICKNESS_MM)) if (productCodes.has(qzCode(n, mm))) return true;
  return false;
}

/**
 * Is this stock the ERP deliberately never publishes?
 *
 * A PRODUCT BEATS THE MARKER, and this clause is the whole reason the function
 * takes productCodes. The org really sells "Astral Mist Kreos Trail-2" as
 * QZ-ASTRALMISTKREOSTRAIL2-20 — a design whose NAME contains the word Trail and
 * which is not a trial of anything. Withholding it because of its spelling was
 * the Arena/Arlina mistake in another costume: a string test cannot outrank the
 * org's own catalogue. So the marker only decides names Salesforce has never
 * heard of — "Trial" itself (a bucket of 133 experiments, no product at any
 * thickness) and "Pebble Ice - Trial" (a trial batch of a real design, which
 * resolves to no product of its own).
 */
export function isNotSellable(canonical: unknown, rawDesign?: unknown, productCodes?: ReadonlySet<string>): boolean {
  const raw = String(rawDesign ?? "");
  if (productCodes && raw && hasProductAtAnyThickness(raw, productCodes)) return false;
  if (NOT_SELLABLE_CANONICALS.has(foldDesignName(canonical))) return true;
  return raw ? TRIAL_MARKER.test(raw) : false;
}

// ── the publish rule ────────────────────────────────────────────────────────

// ── finish, grade, and the key that now carries them ─────────────────────────
//
// Salesforce asked (their REPLY-10, 2026-09-23) for polish, grade and series on
// every slab line, and asked which of two things is true: are polish and grade
// attributes of the whole (design, thickness) line, or can one line hold several
// at once? The second. QC writes polish_type and grade per SLAB, so a design at
// one thickness is routinely in the yard as Polished A and Polished B together.
// Keyed by design and thickness alone, those runs would overwrite each other in
// the upsert and the split would never be visible — so the key extends.

/** A value that says nothing — blank, or only dashes and dots. The yard types
 *  "-" to mean "none", and Salesforce asked for blank there, not a value. */
function saysNothing(t: string): boolean {
  return /^[\s\-\u2013\u2014.]*$/.test(t);
}

/**
 * What goes in Finish__c.
 *
 * THE OWNER'S FOUR WORDS WHEN WE RECOGNISE THE SPELLING, the yard's own text
 * when we do not. canonicalFinish is the ERP's vocabulary, not Salesforce's —
 * it is what the sample rows on this same object already send — so this is not
 * the mapping Salesforce asked us to avoid ("don't map them to anything of
 * ours" means theirs). And it is needed for the KEY: the yard types both
 * "Polish" and "Polished", and without folding them one shelf would publish as
 * two lines. An unrecognised spelling is sent exactly as typed, never dropped
 * and never guessed at.
 */
export function finishValue(raw: unknown): string | null {
  const t = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (saysNothing(t)) return null;
  // A TRAILING "finish" IS THE WORD, NOT A DIFFERENT FINISH. Production's first
  // dry run found "Leathered finish" on 3 rows beside "Leathered" on 43 — one
  // shelf, two values in Salesforce's filter. Only the generic suffix is dropped,
  // and only when what is left is one of the four: "Leather polish" names two
  // finishes and "No Polish" names none, so both still go out exactly as typed.
  return canonicalFinish(t) ?? canonicalFinish(t.replace(/ finish$/i, "")) ?? t;
}

/**
 * What goes in Grade__c: the yard's word, through the SAME normalisation QC's
 * own writes and the dispatch rule use (canonicalGrade, lib/inventory/grading).
 *
 * That is not a mapping onto anything of Salesforce's; it undoes two habits of
 * the grade column itself. QC writes "Not graded yet" for no grade — sent as a
 * grade it would read "Grade: Not graded yet", which is precisely the invented
 * value Salesforce asked us not to send — and "C (Reject)" for C, which would
 * otherwise make C two rows. Everything else goes out as QC typed it, case
 * included ("A2", "Printing").
 */
export function gradeValue(raw: unknown): string | null {
  const g = canonicalGrade(String(raw ?? "").replace(/\s+/g, " "));
  return g === null || saysNothing(g) ? null : g;
}

/**
 * One segment of the key. Uppercased, so "Printing" and "PRINTING" are one row
 * rather than twins; whitespace to "_" and the separator "|" to "/", so a
 * segment can never split the key; and "-" when there is no value at all.
 *
 * "-" cannot collide with a real value: saysNothing() turns a typed "-" into
 * null before it gets here, which is the same answer.
 */
export function keySegment(value: string | null | undefined): string {
  const v = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "_").replace(/\|/g, "/");
  return v || "-";
}

/**
 * `SLAB|<code>|<FINISH>|<GRADE>` — e.g. `SLAB|QZ-ARVAWHITE-20|POLISHED|A`, or
 * `SLAB|QZ-ARVAWHITE-20|POLISHED|-` for a slab QC graded nothing.
 *
 * FOUR SEGMENTS, ALWAYS. The old key was `SLAB|<code>`, two segments, and it is
 * the shape alone that tells a legacy row from a current one — see
 * slabKeyStillResolves.
 */
export function slabKey(code: string, finish: string | null, grade: string | null): string {
  const f = keySegment(finish);
  const g = keySegment(grade);
  const full = `SLAB|${code}|${f}|${g}`;
  if (full.length <= ERP_KEY_MAX) return full;
  // ERP_Key__c is a Text(80) External ID (ADMIN-HANDOFF, DESIGN §13), and a key
  // over it is refused on every run for ever. A long segment keeps a readable
  // head and a hash of its WHOLE value, so two long grades that share a prefix
  // stay two keys — truncating would merge them into one row. Deterministic:
  // the same value gives the same key on every run.
  const short = `SLAB|${code}|${shortSegment(f)}|${shortSegment(g)}`;
  if (short.length <= ERP_KEY_MAX) return short;
  // A code so long that even two 16-character segments do not fit: both
  // segments become their hash alone, 9 characters each, which holds every
  // code up to 55 characters (5 + code + 1 + 9 + 1 + 9). The longest in the
  // org today is 27. Past 55 the
  // key is over the cap and the row is refused — counted, never silent (see
  // keysOverLimit in the run summary). The code itself is never shortened: the
  // sold-out rule and the switch-over both read it back out of the key.
  return `SLAB|${code}|${hashSegment(f)}|${hashSegment(g)}`;
}

/** ERP_Key__c: Text(80), External ID. */
export const ERP_KEY_MAX = 80;

function shortSegment(seg: string): string {
  return seg.length <= 16 ? seg : `${seg.slice(0, 7)}~${hashString(seg)}`;
}

function hashSegment(seg: string): string {
  return seg === "-" ? "-" : `~${hashString(seg)}`;
}

/** The two slab key shapes: `SLAB|<code>` (one row per design and thickness,
 *  before 2026-09-23) and `SLAB|<code>|<FINISH>|<GRADE>` (one per slice). */
export type SlabKeyShape = "legacy" | "split";

/** The shape and product code of either kind of slab key; null for anything
 *  that is not a slab key. */
export function slabKeyCode(key: unknown): { shape: SlabKeyShape; code: string } | null {
  const parts = String(key ?? "").split("|");
  if (parts[0] !== "SLAB") return null;
  if (parts.length === 2 && parts[1]) return { shape: "legacy", code: parts[1] };
  const p = parseSlabKey(key);
  return p ? { shape: "split", code: p.code } : null;
}

/** The parts of a split slab key, or null for anything else — including the
 *  two-segment `SLAB|<code>` every row carried before the split. */
export function parseSlabKey(key: unknown): { code: string; finish: string; grade: string } | null {
  const parts = String(key ?? "").split("|");
  if (parts.length !== 4 || parts[0] !== "SLAB") return null;
  const [, code, finish, grade] = parts;
  if (!code || !finish || !grade) return null;
  return { code, finish, grade };
}

/**
 * For a key Salesforce holds that this run did not produce: is it SOLD OUT (the
 * line still means something, write it to zero and keep it searchable) or
 * RETIRED (it means nothing any more, write it once and forget it)?
 *
 * The same rule as before the split, asked of the product CODE inside either
 * key shape: a code that still has stock or a product is sold out, anything
 * else is retired. Which SHAPE is retired is not decided here — that is
 * planTransition, because it depends on what Salesforce has accepted, not
 * on what the key looks like.
 */
export function slabKeyStillResolves(
  key: string,
  lineCodes: ReadonlySet<string>,
  productCodes: ReadonlySet<string>,
): boolean {
  if (!String(key).startsWith("SLAB|")) return true;
  const k = slabKeyCode(key);
  if (!k) return false;
  return lineCodes.has(k.code) || productCodes.has(k.code);
}

/**
 * THE SWITCH-OVER, one product code at a time: what becomes of each row of the
 * key shape NOT in use this run (the legacy shape once SF_SLAB_SPLIT is on; the
 * split shape if it is ever turned off again).
 *
 * THE RULE: an old row stands in for exactly the slabs of its code that
 * Salesforce does not yet hold a replacement row for. No more, so nothing is
 * counted twice. No less, so nothing disappears.
 *
 * It took two reviews to get here. The first version retired every legacy row
 * in the same call that created the split rows, so if Salesforce refused only
 * the new rows (Grade__c created that morning and not yet granted is exactly
 * that), all 328 retirements went through and Salesforce showed no slab stock.
 * The second version retired a legacy row once ANY of its replacements was
 * accepted. A code with Polished A accepted and Polished B refused then lost
 * Polished B's slabs entirely, because the row that had been carrying them was
 * gone. Freezing the old row is no answer either: it double-counts every slice
 * that WAS accepted.
 *
 * So, for each old-shape key, given the rows of the current shape this run
 * wants for its code and the keys Salesforce holds (`present`):
 *
 *  · RETIRE: every replacement is present. Written once, zero and retired.
 *  · REMAINDER: some replacements are missing. The single legacy row is
 *    written as the full legacy row it always was (name, design, thickness,
 *    product, product-missing, all current) with the sum of the MISSING slices
 *    as its count. When nothing has been accepted, that is the whole line, and
 *    the row is byte-identical to the one written before the switch, so a
 *    blanket refusal costs no extra write and changes nothing a rep sees.
 *  · HOLD: some replacements are missing, and there are SEVERAL old rows for the
 *    code. That only happens when switching back, from split rows to one legacy
 *    row. A remainder cannot be divided among several old rows, so they are
 *    left untouched until the legacy row is accepted, and then retired.
 *
 * WHAT COUNTS AS A REPLACEMENT SALESFORCE HOLDS depends on the direction, and
 * the difference is the third review's finding. Going forward, a split row's
 * key in `present` is enough: it can only be a split row. Switching back, the
 * one replacement is the legacy row, and its key may be in the mirror holding a
 * REMAINDER from the forward switch-over — three slabs where the line is
 * eight. Retiring the split rows against that would leave three. So the HOLD
 * branch asks `verified` instead: accepted in this run, or in the mirror with
 * exactly the payload this run wants. `verified` defaults to `present`.
 *  · KEEP: this run wants no rows of the current shape for the code at all. The
 *    product is sold out at the switch, or the design has been merged away. The
 *    ordinary diff decides it: a product still sold stays a searchable "none
 *    right now" row under its old key, and a design merged away is retired.
 *
 * Pure, and called twice a run. First with what the mirror held before any
 * write, to know which keys to take out of the ordinary diff. Then again with
 * that plus what Salesforce accepted in the first write, to decide the old rows
 * themselves.
 */
export interface TransitionPlan {
  retire: string[];
  remainder: StockRow[];
  hold: string[];
  keep: string[];
}

export function planTransition(
  otherShapeKeys: Iterable<string>,
  desiredCurrent: ReadonlyArray<StockRow>,
  present: ReadonlySet<string>,
  verified: ReadonlySet<string> = present,
): TransitionPlan {
  const wanted = new Map<string, StockRow[]>();
  for (const r of desiredCurrent) {
    const k = slabKeyCode(r.key);
    if (!k) continue;
    const list = wanted.get(k.code) ?? [];
    list.push(r);
    wanted.set(k.code, list);
  }
  const olds = new Map<string, string[]>();
  for (const key of otherShapeKeys) {
    const k = slabKeyCode(key);
    if (!k) continue;
    const list = olds.get(k.code) ?? [];
    list.push(key);
    olds.set(k.code, list);
  }

  const plan: TransitionPlan = { retire: [], remainder: [], hold: [], keep: [] };
  for (const [code, keys] of olds) {
    const replacements = wanted.get(code) ?? [];
    if (!replacements.length) { plan.keep.push(...keys); continue; }
    const singleLegacy = keys.length === 1 && slabKeyCode(keys[0])?.shape === "legacy";
    const held = singleLegacy ? present : verified;
    const missing = replacements.filter((r) => !held.has(r.key));
    if (!missing.length) { plan.retire.push(...keys); continue; }
    if (singleLegacy) {
      const slabs = missing.reduce((n, r) => n + Math.max(0, Math.trunc(Number(r.available) || 0)), 0);
      plan.remainder.push(remainderRow(keys[0]!, slabs, replacements[0]!));
    } else {
      plan.hold.push(...keys);
    }
  }
  plan.retire.sort();
  plan.hold.sort();
  plan.keep.sort();
  plan.remainder.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return plan;
}

/**
 * The legacy row, whole and current, carrying only the slabs its replacements
 * do not yet cover.
 *
 * Built from a replacement row, which carries everything the legacy row does:
 * the design, the thickness, the product and whether it is missing. Its name
 * is rebuilt the way slabRows(…, false) builds it. So when the remainder is the
 * whole line, this is the pre-switch row exactly, same hash and no extra write.
 * It is not a count-only patch: an earlier version sent no fields, and a
 * product created in Salesforce during the switch-over then never reached the
 * row carrying the stock.
 */
export function remainderRow(key: string, available: number, replacement: StockRow): StockRow {
  const f = replacement.fields ?? {};
  return {
    key,
    kind: "Slab",
    name: `${String(f.Design__c ?? "")} ${Number(f.Thickness_mm__c)} mm`,
    available,
    retired: false,
    fields: {
      Design__c: f.Design__c,
      Thickness_mm__c: f.Thickness_mm__c,
      Product__c: f.Product__c ?? null,
      Product_Missing__c: f.Product_Missing__c,
    },
  };
}

/**
 * THE PROBE, as a decision rather than as inline code. Until Salesforce has
 * accepted a single row of the current shape, only the first `limit` NEW rows
 * of that shape go out (`firstWave` carries them together with every other row:
 * samples, restamps, retirements and sold-outs are never held back). The rest
 * wait in `heldBack` until a probe row is accepted. Once one row of the shape
 * has been accepted, nothing is held back again.
 */
export function probeWave(
  rows: ReadonlyArray<StockRow>,
  mirrorKeys: ReadonlySet<string>,
  shape: SlabKeyShape,
  limit: number,
): { firstWave: StockRow[]; heldBack: StockRow[]; probe: string[] } {
  const isNew = (r: StockRow) => !r.retired && !mirrorKeys.has(r.key) && slabKeyCode(r.key)?.shape === shape;
  const fresh = rows.filter(isNew);
  if (shapeEverAccepted(mirrorKeys, shape) || fresh.length <= limit) {
    return { firstWave: [...rows], heldBack: [], probe: fresh.map((r) => r.key) };
  }
  const later = new Set(fresh.slice(limit).map((r) => r.key));
  return {
    firstWave: rows.filter((r) => !later.has(r.key)),
    heldBack: rows.filter((r) => later.has(r.key)),
    probe: fresh.slice(0, limit).map((r) => r.key),
  };
}

/**
 * Which remainder rows go out this run: one whose payload changed, or whose
 * last push is older than the re-stamp window. The old row must never read
 * Stale__c while it is the row still carrying the stock.
 */
export function remaindersDue(
  remainders: ReadonlyArray<StockRow>,
  mirror: ReadonlyMap<string, { payloadHash: string; pushedAt?: Date | null }>,
  staleCutoff: Date,
): StockRow[] {
  return remainders.filter((r) => {
    const seen = mirror.get(r.key);
    return !seen || seen.payloadHash !== payloadHash(r) || !seen.pushedAt || seen.pushedAt < staleCutoff;
  });
}

/** One Salesforce answer per record, as compositePatch returns them. */
export interface RowAnswer {
  success: boolean;
  errors?: Array<{ message?: string }>;
}

/**
 * WRITE IN CHUNKS, AND ACT ON EACH ANSWER AS IT ARRIVES.
 *
 * compositePatch loops over its own 200-row chunks and throws on the first bad
 * response. When it throws, the answers to the chunks Salesforce had ALREADY
 * committed are lost with it. Those rows are live in Salesforce and missing from
 * the mirror. If one of them then sells out before the next run, nothing ever
 * touches it again, because the diff only walks what the mirror holds. It stays
 * in Salesforce, counting stock that is gone, for good. So the chunks are sent
 * here one at a time, and `onAnswer` records each one before the next is sent.
 *
 * A REQUEST-LEVEL REFUSAL IS A REFUSAL, NOT A CRASH. When a field is hidden from
 * the integration user, as Grade__c is until someone grants it, Salesforce
 * rejects the whole request as naming a field that does not exist. It does not
 * refuse row by row. `absorb` names the errors to treat that way: every row in
 * the chunk is marked refused with the reason, and the run carries on. Any other
 * error is rethrown, after every chunk before it has been recorded.
 */
export async function sendChunks(
  rows: ReadonlyArray<StockRow>,
  size: number,
  send: (chunk: StockRow[]) => Promise<RowAnswer[]>,
  onAnswer: (chunk: StockRow[], answers: RowAnswer[]) => Promise<void>,
  absorb: (error: unknown) => string | null,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    let answers: RowAnswer[];
    try {
      answers = await send(chunk);
    } catch (e) {
      const why = absorb(e);
      if (why === null) throw e;
      answers = chunk.map(() => ({ success: false, errors: [{ message: why }] }));
    }
    await onAnswer(chunk, answers);
  }
}

/**
 * ROWS CARRYING Grade__c GO IN CHUNKS OF THEIR OWN. The field was created the day
 * Salesforce asked for it. If the integration user cannot see it, every request
 * that names it is refused whole (see sendChunks), and a sample row or an old
 * slab row in the same chunk would be refused with it. Kept apart, a missing
 * permission costs the new rows and nothing else.
 */
export function partitionByNewField(rows: ReadonlyArray<StockRow>): { plain: StockRow[]; withGrade: StockRow[] } {
  const plain: StockRow[] = [];
  const withGrade: StockRow[] = [];
  for (const r of rows) (Object.prototype.hasOwnProperty.call(r.fields ?? {}, "Grade__c") ? withGrade : plain).push(r);
  return { plain, withGrade };
}

/**
 * Keys Salesforce holds with EXACTLY the payload this run wants: accepted in
 * this run, or already in the mirror under the same hash. The proof the HOLD
 * branch of planTransition needs before it retires several rows for one.
 */
export function verifiedKeys(
  desired: ReadonlyArray<StockRow>,
  mirror: ReadonlyMap<string, { payloadHash: string }>,
  acceptedThisRun: ReadonlySet<string>,
): Set<string> {
  const out = new Set(acceptedThisRun);
  for (const r of desired) {
    const seen = mirror.get(r.key);
    if (seen && seen.payloadHash === payloadHash(r)) out.add(r.key);
  }
  return out;
}

/**
 * Whether ANY row of the current shape has ever been accepted — the gate on the
 * probe. Until one has, the new rows go out 200 at a time and stop at the first
 * batch refused whole; see syncStock.
 */
export function shapeEverAccepted(mirrorKeys: Iterable<string>, shape: SlabKeyShape): boolean {
  for (const k of mirrorKeys) if (slabKeyCode(k)?.shape === shape) return true;
  return false;
}

// ── the yard's groups, from one grouped read ───────────────────────────────

/** One row of the grouped yard read: a design, thickness, polish and grade,
 *  its slabs, and how many of them are on the sales-unapproved list. */
export interface YardRow {
  design: string | null;
  slab_thickness: string | null;
  polish_type: string | null;
  grade: string | null;
  n: number;
  hidden: number;
}

/**
 * The yard read, turned into the groups the lines are built from. Pure, so the
 * two things it decides can be tested without a database:
 *
 *  · UNAPPROVED SLABS ARE SUBTRACTED per group, from the count taken in the
 *    same statement. It was never more than the group holds.
 *  · A CUT GRADE IS EXCLUDED by DISPATCH'S OWN RULE, gradeBlocksDispatch, and
 *    not by an approximation of it in SQL. The previous version compared
 *    upper(btrim(grade)) in the query, and btrim strips spaces only. Dispatch
 *    strips all whitespace and a "(Reject)" suffix, so "CTS (Reject)", which
 *    dispatch refuses, would still have reached a rep as "Grade CTS". The
 *    query already groups by grade, so asking here costs nothing and cannot
 *    drift from dispatch.
 *
 * `raw` keeps its meaning — every AVAILABLE whole-marked slab, before either
 * filter — and the two filters are reported beside it, never folded in silently.
 */
export function yardGroups(rows: ReadonlyArray<YardRow>): {
  groups: StockGroup[]; raw: number; hidden: number; cutGradeExcluded: number;
} {
  const groups: StockGroup[] = [];
  let raw = 0;
  let hidden = 0;
  let cutGradeExcluded = 0;
  for (const r of rows ?? []) {
    const n = Math.max(0, Math.trunc(Number(r?.n) || 0));
    const h = Math.min(n, Math.max(0, Math.trunc(Number(r?.hidden) || 0)));
    raw += n;
    if (gradeBlocksDispatch(r?.grade)) { cutGradeExcluded += n; continue; }
    hidden += h;
    const available = n - h;
    if (available > 0) {
      groups.push({
        design: r?.design ?? "",
        slabThickness: r?.slab_thickness ?? "",
        polishType: r?.polish_type ?? null,
        grade: r?.grade ?? null,
        available,
      });
    }
  }
  return { groups, raw, hidden, cutGradeExcluded };
}

// ── series, which belongs to the design ────────────────────────────────────

/**
 * Folded colour name -> series name, from the colour chart (product_colour ->
 * product_series).
 *
 * product_colour.name is unique across every series precisely so that a place
 * that names a colour without its series — QC's design field is one — resolves
 * to exactly one. Folded the way designs are folded (foldDesignName), so case
 * and spacing never decide it.
 *
 * THE CHART IS THE OWNER'S COLOUR CHART — 129 colours in 7 series — not the
 * whole design list.
 * Carrara Cloud, Calacatta Gold, Taj Mahal and most 30 mm designs are not on it
 * at all and get no series: there is none in the ERP to send. And it spells
 * some designs differently from the alias canonicals ("Pebbles Ice" where the
 * ERP says "Pebble Ice"), which seriesFor answers through the alias variants.
 *
 * TWO COLOURS THAT FOLD TOGETHER BUT SIT IN DIFFERENT SERIES give NO answer, not
 * the first one read: Postgres returns rows in no promised order, and a series
 * that flipped between runs would re-push every row of that design each time.
 * Such a key maps to "" — "the chart lists this name and cannot say" — which
 * seriesFor keeps apart from a name the chart does not list at all.
 */
export function seriesIndex(
  colours: ReadonlyArray<{ name?: string | null; series?: { name?: string | null } | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const c of colours ?? []) {
    const k = foldDesignName(c?.name);
    const series = String(c?.series?.name ?? "").trim();
    if (!k || !series || ambiguous.has(k)) continue;
    const seen = out.get(k);
    if (seen === undefined) out.set(k, series);
    else if (seen !== series) { out.set(k, ""); ambiguous.add(k); }
  }
  return out;
}

/**
 * The series of a canonical design.
 *
 * THE DESIGN'S OWN NAME FIRST. If the chart lists the canonical itself, that is
 * its series, whatever its alias spellings say. The first production dry run
 * found why this matters: the alias table maps "Ultima White" onto "Brilliant
 * White", and the chart lists Ultima White as a colour of its own in Aurora while
 * Brilliant White is in Solids. Weighing the two equally made Brilliant White —
 * 349 slabs, on the chart by name — ambiguous, and sent it blank.
 *
 * THE ALIAS SPELLINGS ONLY WHEN THE CHART DOES NOT LIST THE NAME. Then every
 * yard spelling the alias table maps onto it is tried, so "Pebble Ice" finds the
 * chart's "Pebbles Ice" if anyone has aliased one to the other. The alias table
 * is the ERP's own record that two names are one design, so this is not a guess;
 * and if the spellings land in different series, nothing is sent.
 *
 * A name the chart lists AMBIGUOUSLY (seriesIndex's "") gives no answer, and the
 * aliases are not asked to break the tie.
 */
export function seriesFor(
  canonical: unknown,
  index: ReadonlyMap<string, string>,
  variants: Iterable<string> = [],
): string | null {
  const own = index.get(foldDesignName(canonical));
  if (own !== undefined) return own || null;
  const found = new Set<string>();
  for (const name of variants) {
    const s = index.get(foldDesignName(name));
    if (s) found.add(s);
  }
  return found.size === 1 ? [...found][0]! : null;
}

export type UnmappedReason = "UNKNOWN_DESIGN" | "THICKNESS" | "NOT_SELLABLE";

export interface StockGroup {
  design: string;
  slabThickness: string;
  available: number;
  /**
   * fg_finished_slab.polish_type and .grade, AS TYPED. Both are properties of
   * the SLAB, not of the design — QC writes them per slab on every pass — so a
   * single design and thickness can be in the yard in several finishes and
   * grades at once. That is why they split a line (see slabKey) where Series
   * does not: series belongs to the design and is the same for every slab of it.
   *
   * Optional, so a caller that groups by design and thickness alone still
   * builds: it gets one unsplit row per line, exactly as before this existed.
   */
  polishType?: string | null;
  grade?: string | null;
}

/**
 * One finish-and-grade slice of a published line — one ERP_Stock__c row.
 *
 * `finish` and `grade` are the VALUES Salesforce is sent, null when the yard
 * gave none. Salesforce asked for blank rather than a guess ("blank reads as
 * not given, which is honest; an invented value is not"), so null is never
 * replaced with a default here or anywhere downstream.
 */
export interface StockSplit {
  finish: string | null;
  grade: string | null;
  available: number;
}

export interface PublishedLine {
  canonical: string;
  mm: number;
  code: string;
  available: number;
  /**
   * THE DESIGN IS NOT IN ANY PRODUCT LIST, and the line is published anyway.
   *
   * Until 2026-09-17 a design we could not match was withheld entirely: the
   * slabs existed in the yard and did not exist in Salesforce. Pacific's
   * administrator asked for the opposite and gave the reason — a rep needs to
   * SEE what is in the yard even when it cannot yet be quoted, because quoting
   * needs a product and looking does not. So the line goes out with
   * `Product__c` blank and `Product_Missing__c` true, and the same design stays
   * on the unmapped worklist until somebody creates the product.
   */
  productMissing: boolean;
  /**
   * The same slabs, divided by finish and grade. `available` above is their
   * sum, and stays the number every PRODUCT is told about itself: a product is
   * a design at a thickness, and splitting its stock by polish must not change
   * how much of it there is. Only the ERP_Stock__c rows expand this.
   *
   * Optional for the same reason as StockGroup's fields: absent means one
   * unsplit slice carrying the whole line.
   */
  splits?: StockSplit[];
}

export interface UnmappedLine {
  design: string;
  canonical: string;
  slabThickness: string;
  available: number;
  reason: UnmappedReason;
}

export interface PublishResult {
  lines: PublishedLine[];
  unmapped: UnmappedLine[];
}

/**
 * Is this canonical design one we are willing to name in Salesforce?
 *
 * TWO WAYS TO BE KNOWN, and the second is what makes the first sufficient. A
 * canonical value in fg_design_alias is a name an admin has deliberately
 * settled on. A code matching an active product is Salesforce's own word for
 * the same thing. Either is evidence; raw yard text is not.
 *
 * MATCHED AT ANY THICKNESS. Salesforce sells 20 mm and 12 mm only, and the
 * largest body of ERP stock is 30 mm — 10,391 slabs. Requiring a product at
 * the SAME thickness would silently drop every one of them. "Arva White" is a
 * real design because QZ-ARVAWHITE-20 exists; that its 30 mm stock has no
 * product is a fact to publish, not a reason to hide the slabs.
 */
export function isKnownDesign(
  canonical: string,
  canonicalNames: ReadonlySet<string>,
  productCodes: ReadonlySet<string>,
): boolean {
  const name = String(canonical ?? "").trim();
  if (!name) return false;
  if (canonicalNames.has(name) || canonicalNames.has(name.toLowerCase())) return true;
  // FOLDED, like the code branch below. Without this the two branches disagreed
  // about what "the same design" means: "Pebble ice" is the canonical "Pebble
  // Ice", "Tajmahal" is "Taj Mahal", and both were refused by a set lookup that
  // an uppercase or a missing space defeated.
  const folded = foldDesignName(name);
  if (folded && foldedNames(canonicalNames).has(folded)) return true;
  for (const mm of Object.values(THICKNESS_MM)) {
    if (productCodes.has(qzCode(name, mm))) return true;
  }
  return false;
}

/**
 * Every grouped (design, thickness) count, sorted into what Salesforce may be
 * told and what has to be fixed in the alias table first.
 *
 * COUNTS ARE FOLDED, because two yard spellings of one design are one line:
 * "Arva White" and "arva white " both become QZ-ARVAWHITE-20 and their slabs
 * add up. Publishing them separately would show a rep two products where there
 * is one.
 */
export function buildStockLines(
  groups: ReadonlyArray<StockGroup>,
  aliases: ReadonlyMap<string, string>,
  canonicalNames: ReadonlySet<string>,
  productCodes: ReadonlySet<string>,
): PublishResult {
  const byCode = new Map<string, PublishedLine>();
  // code -> "FINISH|GRADE" -> the slice, and the spellings that fed it.
  const slices = new Map<string, Map<string, SliceTally>>();
  // code -> canonical spelling -> slabs. Two spellings that fold to one code
  // ("Arva White", "arva white") are one line, and it has to be NAMED by one of
  // them. It used to be whichever group Postgres returned first — no promised
  // order — and with the yard now read per finish and grade there are more
  // groups to come first, so the Name and Design__c of every slice would flip
  // between runs and re-push. The spelling behind most slabs, like winner().
  const canonVotes = new Map<string, Map<string, number>>();
  // THE WORKLIST STAYS ONE ENTRY PER SPELLING. The yard is now read per finish
  // and grade too, so the same misspelling arrives as several groups; they are
  // folded back here, or "Astal Mist" would appear on the administrator's list
  // once per polish it happens to be in.
  const unmappedBy = new Map<string, UnmappedLine>();
  const addUnmapped = (u: UnmappedLine) => {
    const k = JSON.stringify([u.design, u.canonical, u.slabThickness, u.reason]);
    const seen = unmappedBy.get(k);
    if (seen) seen.available += u.available;
    else unmappedBy.set(k, { ...u });
  };

  for (const g of groups ?? []) {
    const available = Math.max(0, Math.trunc(Number(g?.available) || 0));
    const canonical = canonicalDesign(g?.design, aliases);
    const known = isKnownDesign(canonical, canonicalNames, productCodes);
    const mm = thicknessMmFor(g?.slabThickness);

    // THE DESIGN IS ASKED ABOUT FIRST. A cut-down slab of a design nobody
    // recognises is an unknown design, not a thickness problem: fixing the
    // thickness would still leave a name we refuse to publish, and reporting
    // it as THICKNESS would send somebody to the wrong screen.
    // NOT SELLABLE IS ASKED FIRST, before "do we know this design". Trial
    // stock IS known — that is the whole problem — so asking `known` first
    // would publish it, and reporting it as UNKNOWN_DESIGN would put 740 slabs
    // on the administrator's worklist as designs to create products for.
    // Withheld, and said out loud as a separate reason.
    if (isNotSellable(canonical, g?.design, productCodes)) {
      addUnmapped({ design: String(g?.design ?? ""), canonical, slabThickness: String(g?.slabThickness ?? ""), available, reason: "NOT_SELLABLE" });
      continue;
    }
    // THICKNESS IS STILL FATAL TO A LINE, and it is asked before the design now.
    // An unknown DESIGN still has a code we can publish against — the design is
    // just not in anyone's product list yet. An unclassifiable THICKNESS has no
    // code at all: QZ-ARVAWHITE-undefined is not a row to send anybody.
    if (mm === null) {
      addUnmapped({ design: String(g?.design ?? ""), canonical, slabThickness: String(g?.slabThickness ?? ""), available, reason: "THICKNESS" });
      continue;
    }
    if (!known) {
      // Published AND reported: the rep sees the stock, the worklist still says
      // a product is missing. The two are not alternatives.
      addUnmapped({ design: String(g?.design ?? ""), canonical, slabThickness: String(g?.slabThickness ?? ""), available, reason: "UNKNOWN_DESIGN" });
    }

    const code = qzCode(canonical, mm);
    const votes = canonVotes.get(code) ?? new Map<string, number>();
    vote(votes, canonical, available);
    canonVotes.set(code, votes);
    const seen = byCode.get(code);
    if (seen) {
      seen.available += available;
      // one spelling known and another not folds to the same code; if ANY of
      // them resolves, the line has a product
      seen.productMissing = seen.productMissing && !productCodes.has(code);
    } else {
      byCode.set(code, { canonical, mm, code, available, productMissing: !productCodes.has(code) });
    }

    // The slice this group belongs to. Keyed by the key's own segments, so two
    // spellings that would produce the same ERP_Key__c are one slice by
    // construction and can never be sent as two rows fighting over one record.
    const finish = finishValue(g?.polishType);
    const grade = gradeValue(g?.grade);
    const sliceKey = `${keySegment(finish)}|${keySegment(grade)}`;
    const byKey = slices.get(code) ?? new Map<string, SliceTally>();
    const t = byKey.get(sliceKey) ?? { sliceKey, available: 0, finishes: new Map(), grades: new Map() };
    t.available += available;
    vote(t.finishes, finish, available);
    vote(t.grades, grade, available);
    byKey.set(sliceKey, t);
    slices.set(code, byKey);
  }

  for (const line of byCode.values()) {
    line.canonical = winner(canonVotes.get(line.code) ?? new Map()) ?? line.canonical;
    line.splits = [...(slices.get(line.code)?.values() ?? [])]
      .sort((a, b) => a.sliceKey.localeCompare(b.sliceKey))
      .map((t) => ({ finish: winner(t.finishes), grade: winner(t.grades), available: t.available }));
  }

  return {
    lines: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    unmapped: [...unmappedBy.values()].sort((a, b) => b.available - a.available || a.design.localeCompare(b.design)),
  };
}

/** One slice while it is being counted: its slabs, and how many of them each
 *  spelling of its finish and grade accounts for. */
interface SliceTally {
  sliceKey: string;
  available: number;
  finishes: Map<string, number>;
  grades: Map<string, number>;
}

function vote(tally: Map<string, number>, value: string | null, n: number): void {
  const k = value ?? "";
  tally.set(k, (tally.get(k) ?? 0) + n);
}

/**
 * THE SPELLING THAT IS SENT when several fold to one slice — "Printing" on 40
 * slabs and "PRINTING" on 3 are one row, and it has to say something. The one
 * behind the most slabs, then the alphabetically first: never "whichever the
 * database returned first", because Postgres promises no order and a value that
 * flipped between runs would re-push the row every time.
 */
function winner(tally: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const [v, n] of tally) {
    // `<`, not localeCompare: this picks a VALUE that is hashed, and
    // localeCompare's answer depends on the runtime's ICU locale. Code-unit
    // order is the same on every machine.
    if (n > bestN || (n === bestN && best !== null && v < best)) {
      best = v;
      bestN = n;
    }
  }
  return best ? best : null;
}

// ── what each of the 110 products is told about itself ──────────────────────

export type MatchState = "Matched" | "Not at this thickness" | "No ERP design";

export interface ProductRow {
  id: string;
  name: string;
  productCode: string;
  erpSku: string | null;
  /** Product2.IsActive. */
  isActive: boolean;
  /** Product2.Family — "Quartz Slab" for the 110 we sell. */
  family: string | null;
}

/** The only family the ERP has stock for, spelt as the org spells it. */
export const SELLABLE_FAMILY = "Quartz Slab";

/**
 * IS THIS ONE OF THE 110 PRODUCTS WE ACTUALLY SELL?
 *
 * THIS IS NOT A TIDINESS FILTER; IT IS THE ONLY THING STANDING BETWEEN THIS JOB
 * AND A CORRUPTED PRODUCT MASTER. The Salesforce administrator counted the org
 * on 2026-09-16: there are 283 products, not 110.
 *
 *   · 110 ACTIVE, family "Quartz Slab" — ours. 55 already carry ERP_SKU__c, 55
 *     are blank and are the ones this job fills.
 *   · 55 INACTIVE, family "Quartz" (NOT "Quartz Slab"), no record type — an
 *     OLDER COPY OF THE SAME LIST. Each shares its ProductCode AND its Name
 *     with an active product above.
 *   · 30 INACTIVE with no family at all, named like "Alabaster (3cm)".
 *
 * So a match on code or on name WITHOUT this filter finds TWO products for 55
 * codes. Writing ERP_SKU__c onto the inactive twin then violates the unique
 * constraint — because its active partner already holds that value — and in an
 * all-or-none composite call that fails the entire batch.
 *
 * AND A BLANK ERP_SKU__c DOES NOT MAKE A CODE FALLBACK SAFE, which is the trap
 * worth naming: all 55 inactive copies are blank too, so "fall back to
 * ProductCode where the SKU is empty" walks straight into them. The fallback
 * needs this filter as much as the primary match does.
 *
 * The 30 in the last group have unique codes, so a write to one would NOT fail
 * — it would silently succeed. Their names are 2 cm and 3 cm variants, and our
 * largest body of stock is 30 mm, so a name matcher without this filter would
 * quietly attach real stock to a retired product and nobody would see an error.
 *
 * SALESFORCE WILL NOT CATCH ANY OF THIS. All three ERP_Match__c values are
 * available on every record type and on products with none, so a wrong match
 * saves cleanly. The filter is the whole of the protection, which is why it
 * lives here, tested, and not only in the WHERE clause of a query string.
 */
export function isSellableProduct(p: Pick<ProductRow, "isActive" | "family">): boolean {
  return Boolean(p?.isActive) && String(p?.family ?? "").trim() === SELLABLE_FAMILY;
}

export interface ProductPayload {
  Id: string;
  ERP_SKU__c: string;
  ERP_Available_Slabs__c: number;
  ERP_Match__c: MatchState;
  ERP_Other_Thickness_Stock__c: string;
  /** When this count was true. Passed in rather than read from a clock, so the
   *  function stays pure and every product in one run carries the same stamp. */
  ERP_Stock_As_Of__c: string;
}

/**
 * EVERY KEY THE ERP MAY PUT IN A Product2 PAYLOAD — `Id`, which addresses the
 * record rather than writing a field, and nothing else that is not an `ERP_`
 * field.
 *
 * NOT A STYLE RULE. The Salesforce administrator added a validation rule,
 * `ERP_writes_ERP_fields_only` (2026-09-16), because Products are Public
 * Read/Write in that org and Edit on Product2 would otherwise let this job
 * rename a product or deactivate it. The rule REJECTS an ERP write to Name,
 * Active, Record Type, Currency, Family, Product Code, Description, SKU, Unit
 * of Measure, Display URL or External ID. A payload that strays outside this
 * list does not silently do the wrong thing — it fails the whole composite
 * call, and every product in the batch with it.
 */
export const PRODUCT_WRITABLE_KEYS: readonly string[] = Object.freeze([
  "Id",
  "ERP_SKU__c",
  "ERP_Available_Slabs__c",
  "ERP_Match__c",
  "ERP_Other_Thickness_Stock__c",
  "ERP_Stock_As_Of__c",
]);

/**
 * EVERY PRODUCT GETS A PAYLOAD EVERY RUN, and that is the whole fix for a
 * sold-out product. Writing only the products we have stock for leaves last
 * week's number standing on everything that emptied, and a rep reads it as
 * today's. Zero is an answer; silence is not.
 *
 * ERP_In_Stock__c is deliberately NOT here: it is a formula on
 * ERP_Available_Slabs__c > 0, so the flag a rep filters on cannot drift from
 * the count it claims to describe. Writing to it would not merely be redundant,
 * it would fail — Salesforce refuses a write to a formula field.
 */
export function productPayloads(
  products: ReadonlyArray<ProductRow>,
  lines: ReadonlyArray<PublishedLine>,
  canonicalNames: ReadonlySet<string>,
  productCodes: ReadonlySet<string>,
  /** ISO-8601 instant this run read the yard. One value for the whole run, so
   *  every product agrees about when the count was taken — and passed in, never
   *  read from a clock here, so the same inputs always give the same output. */
  asOf = "",
): ProductPayload[] {
  // EVERY PRODUCT GETS A PAYLOAD — but only the ones we sell are products at
  // all. Anything inactive, or in another family, is dropped HERE rather than
  // relied upon to have been excluded by the caller's WHERE clause: see
  // isSellableProduct for what writing to the other 173 would do.
  const sellable = (products ?? []).filter(isSellableProduct);
  const byCode = new Map(lines.map((l) => [l.code, l]));

  // STOCK OF THE SAME DESIGN AT THICKNESSES SALESFORCE DOES NOT SELL, grouped
  // by the CODE STEM and not by the canonical string.
  //
  // Grouping by the string was wrong in a way that hid real stock. isKnownDesign
  // deliberately tolerates case — it asks canonicalNames.has(name.toLowerCase())
  // — and qzCode strips every non-alphanumeric, so "Arva White" and "arva white"
  // publish as ONE product code and TWO different `canonical` strings. Keyed on
  // the string, the two never met: with the 20 mm rows typed "Arva White" and
  // the 30 mm rows typed "arva white", the product's other-thickness note came
  // out EMPTY and, once the 20 mm stock sold out, the product read "No ERP
  // design" — over 118 real slabs.
  //
  // That is exactly where it would bite. The 30 mm body is the largest in the
  // yard (10,391 slabs) and is precisely where unaliased spellings live; a rep
  // would read "No ERP design" as a design we have never held.
  //
  // The stem is what the two share, so the stem is the key.
  const byStem = new Map<string, PublishedLine[]>();
  for (const l of lines) {
    const stem = codeStem(l.code);
    const list = byStem.get(stem) ?? [];
    list.push(l);
    byStem.set(stem, list);
  }

  return sellable.map((p) => {
    // Match on ERP_SKU__c when filled, else ProductCode — identical by
    // DISCOVERY, and the job writes the SKU back in the same PATCH so the 55
    // blanks fill on run one.
    const key = (p.erpSku && p.erpSku.trim()) || p.productCode;
    const line = byCode.get(key);
    const mm = Number(String(key).split("-").pop());

    const siblings = (byStem.get(codeStem(key)) ?? [])
      .filter((l) => l.mm !== mm && l.available > 0)
      .sort((a, b) => a.mm - b.mm);

    const match: MatchState = line
      ? "Matched"
      : siblings.length > 0
        ? "Not at this thickness"
        : "No ERP design";

    return {
      Id: p.id,
      ERP_SKU__c: key,
      ERP_Available_Slabs__c: line?.available ?? 0,
      ERP_Match__c: match,
      // Text(255) in Salesforce, and a save that exceeds it FAILS — taking the
      // whole composite batch with it. Four thicknesses exist, so three
      // siblings is the most this can ever hold and it cannot realistically
      // reach the limit; clamped anyway, because a silent truncation here is
      // cheaper than a red run, and the cost of being wrong is asymmetric.
      ERP_Other_Thickness_Stock__c: clamp255(siblings.map((s) => `${s.mm} mm: ${s.available}`).join(", ")),
      ERP_Stock_As_Of__c: asOf,
    };
  });
}

/** Salesforce Text(255): longer and the save fails, so never send longer. */
function clamp255(s: string): string {
  return s.length <= 255 ? s : `${s.slice(0, 252)}...`;
}

/**
 * `QZ-ARVAWHITE-20` -> `QZ-ARVAWHITE`: a product code without its thickness.
 *
 * This is what two spellings of one design have in common, and therefore the
 * only safe key for "the same design at another thickness". Anchored on a
 * trailing run of digits so a design whose NAME ends in a number — the org has
 * "Astral Mist Kreos Trail-2", which folds to ...TRAIL2 — keeps its digits and
 * loses only the thickness.
 */
function codeStem(code: string): string {
  return String(code ?? "").replace(/-\d+$/, "");
}

// ── ERP_Stock__c, the thing a rep actually searches ─────────────────────────

export type StockKind = "Slab" | "Sample" | "Box" | "Stand";

export interface StockRow {
  key: string;
  kind: StockKind;
  /**
   * NULL MEANS "LEAVE THE NAME ALONE", and it is not a nicety.
   *
   * A row that has dropped out of the desired set is written to zero — sold
   * out, or retired — and by then the line is gone and we no longer know what
   * it was called. Building that row with `name: key` put the literal string
   * "SLAB|QZ-ARVAWHITE-20" into the Name of a record a rep searches by name,
   * replacing "Arva White 20 mm". The caller omits Name from the payload when
   * this is null, so the update touches only the quantity and the flag.
   */
  name: string | null;
  available: number;
  retired: boolean;
  /** Extra columns the object carries for this kind. */
  fields: Record<string, unknown>;
}

/**
 * The ERP_Stock__c rows for one published line: ONE PER FINISH AND GRADE.
 *
 * `SLAB|QZ-ARVAWHITE-20|POLISHED|A` -> "Arva White 20 mm · Polished · Grade A".
 *
 * Every slice carries the same design, thickness, product and series — those
 * belong to the line — and its own finish, grade and count. A line with no
 * `splits` (a caller that never read polish or grade) comes out as one slice
 * with both blank, so it is still one row, under the new key shape.
 *
 * `series` is passed in rather than looked up, because it comes from the colour
 * chart and this module reads nothing. Null means the chart does not list the
 * design, and is sent as blank.
 */
export function slabRows(
  line: PublishedLine,
  productId: string | null,
  series: string | null = null,
  /**
   * FALSE WRITES THE ROW EXACTLY AS BEFORE THE SPLIT — same key, same name, the
   * same four fields and not one more. Byte-identical is the point: payloadHash
   * hashes every field NAME, so even a Finish__c of null would change every
   * row's hash and re-push the whole object for nothing. This is what lets the
   * code be deployed, and dry-run against production, before Salesforce has
   * said go; SF_SLAB_SPLIT turns the split on.
   */
  split = true,
): StockRow[] {
  if (!split) {
    return [{
      key: `SLAB|${line.code}`,
      kind: "Slab",
      name: `${line.canonical} ${line.mm} mm`,
      available: line.available,
      retired: false,
      fields: {
        Design__c: line.canonical,
        Thickness_mm__c: line.mm,
        Product__c: productId,
        Product_Missing__c: productId === null,
      },
    }];
  }
  const slices: StockSplit[] = line.splits && line.splits.length
    ? line.splits
    : [{ finish: null, grade: null, available: line.available }];
  return slices.map((sl) => ({
    key: slabKey(line.code, sl.finish, sl.grade),
    kind: "Slab" as const,
    name: slabName(line.canonical, line.mm, sl.finish, sl.grade),
    available: Math.max(0, Math.trunc(Number(sl.available) || 0)),
    retired: false,
    fields: {
      Design__c: line.canonical,
      Thickness_mm__c: line.mm,
      Product__c: productId,
      // The 30 mm story, said on the row itself rather than inferred from a
      // null lookup: 4,202 slabs of 59 designs Salesforce sells at 20/12 only.
      Product_Missing__c: productId === null,
      // The org's own caps, as their REPLY-17 corrected them (Finish 40, Grade
      // 40, Series 60). Longer and the save is refused, so never longer — the
      // KEY is built from the full value, so clamping here cannot merge rows.
      Finish__c: clampTo(sl.finish, FINISH_MAX),
      Grade__c: clampTo(sl.grade, GRADE_MAX),
      Series__c: clampTo(series, SERIES_MAX),
    },
  }));
}

/**
 * Finish__c Text(40), Grade__c Text(40), Series__c Text(60), Name Text(80) —
 * the field definitions as Salesforce's REPLY-17 corrected them. Their REPLY-10
 * had said 255 for Finish__c and Series__c, and these caps followed it; a value
 * between 41 and 255 characters would then have been sent whole and REFUSED,
 * because Salesforce rejects an over-length value rather than truncating it.
 */
export const FINISH_MAX = 40;
export const GRADE_MAX = 40;
export const SERIES_MAX = 60;
export const NAME_MAX = 80;

/**
 * "Arva White 20 mm · Polished · Grade A". A rep searches ERP_Stock__c by name,
 * and once a line splits, two rows called "Arva White 20 mm" would be two
 * results nobody could tell apart. A blank finish or grade is simply left out
 * of the name — "Grade (none)" would be inventing the words Salesforce asked
 * us not to invent.
 */
export function slabName(canonical: string, mm: number, finish: string | null, grade: string | null): string {
  return clampTo(fullSlabName(canonical, mm, finish, grade), NAME_MAX) ?? "";
}

/** The name before the Text(80) cap — what splitProfile measures. */
function fullSlabName(canonical: string, mm: number, finish: string | null, grade: string | null): string {
  const parts = [`${canonical} ${mm} mm`];
  if (finish) parts.push(finish);
  if (grade) parts.push(`Grade ${grade}`);
  return parts.join(" · ");
}

/**
 * WHAT THE SPLIT WILL PUT IN SALESFORCE, measured — the figures Salesforce's
 * REPLY-17 asked for before giving the go-ahead:
 *
 *  · rows: how many slab rows the object will carry (one per slice), and
 *    combos: how many distinct finish-and-grade combinations produce them.
 *    Their read cap was raised to 20,000 on the strength of this.
 *  · byGrade / byFinish: rows and slabs per value, blank included — "how many
 *    rows carry Printing" is one line of it.
 *  · longest: the longest value each field would carry BEFORE its cap, and
 *    overCap: how many rows the cap would shorten. A value over Salesforce's
 *    limit is refused, not truncated, so ours are clamped — this says whether
 *    that clamp ever does anything, which is the honest answer to "can a
 *    finish or grade exceed 40 characters, or a design name 40".
 *
 * Pure, and computed whether or not the split is on, so a dry run can answer
 * all of it before anyone flips SF_SLAB_SPLIT.
 */
export interface SplitProfile {
  rows: number;
  combos: number;
  byGrade: Array<{ value: string | null; rows: number; slabs: number }>;
  byFinish: Array<{ value: string | null; rows: number; slabs: number }>;
  longest: { finish: number; grade: number; series: number; design: number; name: number };
  overCap: { finish: number; grade: number; series: number; name: number };
}

export function splitProfile(
  lines: ReadonlyArray<PublishedLine>,
  seriesOf: (canonical: string) => string | null = () => null,
): SplitProfile {
  const combos = new Set<string>();
  const byGrade = new Map<string, { value: string | null; rows: number; slabs: number }>();
  const byFinish = new Map<string, { value: string | null; rows: number; slabs: number }>();
  const longest = { finish: 0, grade: 0, series: 0, design: 0, name: 0 };
  const overCap = { finish: 0, grade: 0, series: 0, name: 0 };
  let rows = 0;
  const tally = (m: typeof byGrade, value: string | null, slabs: number) => {
    const k = value ?? "";
    const t = m.get(k) ?? { value, rows: 0, slabs: 0 };
    t.rows += 1;
    t.slabs += slabs;
    m.set(k, t);
  };
  for (const l of lines ?? []) {
    const series = seriesOf(l.canonical);
    longest.design = Math.max(longest.design, l.canonical.length);
    const slices = l.splits && l.splits.length ? l.splits : [{ finish: null, grade: null, available: l.available }];
    for (const sl of slices) {
      rows += 1;
      combos.add(`${keySegment(sl.finish)}|${keySegment(sl.grade)}`);
      tally(byGrade, sl.grade, sl.available);
      tally(byFinish, sl.finish, sl.available);
      const name = fullSlabName(l.canonical, l.mm, sl.finish, sl.grade);
      longest.finish = Math.max(longest.finish, sl.finish?.length ?? 0);
      longest.grade = Math.max(longest.grade, sl.grade?.length ?? 0);
      longest.series = Math.max(longest.series, series?.length ?? 0);
      longest.name = Math.max(longest.name, name.length);
      if ((sl.finish?.length ?? 0) > FINISH_MAX) overCap.finish += 1;
      if ((sl.grade?.length ?? 0) > GRADE_MAX) overCap.grade += 1;
      if ((series?.length ?? 0) > SERIES_MAX) overCap.series += 1;
      if (name.length > NAME_MAX) overCap.name += 1;
    }
  }
  const order = (m: typeof byGrade) => [...m.values()].sort((a, b) =>
    b.rows - a.rows || b.slabs - a.slabs || ((a.value ?? "") < (b.value ?? "") ? -1 : (a.value ?? "") > (b.value ?? "") ? 1 : 0));
  return { rows, combos: combos.size, byGrade: order(byGrade), byFinish: order(byFinish), longest, overCap };
}

/** Never longer than the field: a save that exceeds a Salesforce text cap
 *  fails outright. Null stays null — blank is an answer, not a gap to fill. */
export function clampTo(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  return v.length <= max ? v : `${v.slice(0, max - 3)}...`;
}

/**
 * `SAMPLE|<sampling_stock.id>` — INCLUDING shelves at zero. "None left" and
 * "we have never cut this" are different answers and the sampling module keeps
 * them apart; flattening them in Salesforce would make a rep ask the desk for
 * something that does not exist.
 */
export function sampleRow(id: string, label: string, available: number, extra: Record<string, unknown> = {}): StockRow {
  return { key: `SAMPLE|${id}`, kind: "Sample", name: label, available: Math.max(0, Math.trunc(available)), retired: false, fields: extra };
}

/** `FINISH|<product_colour_finish.id>` — a colour+finish that has never been cut. */
export function finishRow(id: string, label: string, extra: Record<string, unknown> = {}): StockRow {
  return { key: `FINISH|${id}`, kind: "Sample", name: label, available: 0, retired: false, fields: { Never_Stocked__c: true, ...extra } };
}

/** `UNIT|<sampling_unit_type.id>` — the boxes and stands of Part B. */
export function unitRow(id: string, name: string, kind: "BOX" | "STAND", available: number): StockRow {
  return { key: `UNIT|${id}`, kind: kind === "BOX" ? "Box" : "Stand", name, available: Math.max(0, Math.trunc(available)), retired: false, fields: {} };
}

// ── sold out is not retired ─────────────────────────────────────────────────

export interface MirrorEntry {
  key: string;
  payloadHash: string;
}

export interface MirrorDiff {
  /** Rows whose payload changed, or that Salesforce has never seen. */
  toPush: StockRow[];
  /** Rows written once with 0 and Retired__c true, then dropped from the mirror. */
  toRetire: StockRow[];
  /** Keys that were already correct and cost no API call. */
  unchanged: number;
}

/**
 * SOLD OUT VERSUS RETIRED, kept apart deliberately, because they are different
 * facts and a rep needs both.
 *
 *  • SOLD OUT — the line still means something, we simply have none. It is
 *    written with Available_Qty__c 0 and Retired__c FALSE, and stays
 *    searchable: "do you have Arva White 20 mm" deserves "yes, none right now"
 *    rather than silence.
 *  • RETIRED — the line no longer means anything, because an admin merged the
 *    design away or the shelf row is gone. Written ONCE with 0 and Retired__c
 *    true, then dropped from the mirror so it never costs another API call.
 *
 * NOTHING IN SALESFORCE IS EVER DELETED BY THE ERP. A sample request line that
 * points at a retired row must still resolve; deleting the row would break a
 * record somebody is looking at.
 */
export function diffMirror(
  desired: ReadonlyArray<StockRow>,
  mirror: ReadonlyMap<string, MirrorEntry>,
  stillResolves: (key: string) => boolean,
): MirrorDiff {
  const toPush: StockRow[] = [];
  const toRetire: StockRow[] = [];
  let unchanged = 0;

  const wanted = new Set(desired.map((r) => r.key));
  for (const row of desired) {
    const seen = mirror.get(row.key);
    if (seen && seen.payloadHash === payloadHash(row)) unchanged += 1;
    else toPush.push(row);
  }

  for (const [key, entry] of mirror) {
    if (wanted.has(key)) continue;
    const row: StockRow = {
      key,
      kind: kindFromKey(key),
      // The line is gone, so its name is not ours to restate — see StockRow.
      name: null,
      available: 0,
      retired: !stillResolves(key),
      fields: {},
    };
    // A key still resolving is SOLD OUT: pushed to zero like any other change,
    // and then LEFT ALONE. Comparing its hash the way a desired row's is
    // compared is what stops it being re-pushed on every run for ever — at ten
    // runs an hour against a thousand-call daily budget, a few hundred
    // permanently sold-out lines would spend the budget saying nothing.
    if (row.retired) toRetire.push(row);
    else if (entry.payloadHash === payloadHash(row)) unchanged += 1;
    else toPush.push(row);
  }

  return { toPush, toRetire, unchanged };
}

/**
 * A key written once with zero and Retired__c true. Name null — the line is
 * gone and its name is not ours to restate (see StockRow) — and no fields.
 */
export function retirementRow(key: string): StockRow {
  return { key, kind: kindFromKey(key), name: null, available: 0, retired: true, fields: {} };
}

function kindFromKey(key: string): StockKind {
  const prefix = String(key).split("|")[0];
  if (prefix === "SLAB") return "Slab";
  if (prefix === "UNIT") return "Stand";
  return "Sample";
}

/**
 * What "changed" means, so a run that changes nothing costs no API calls.
 *
 * STABLE BY CONSTRUCTION: the keys are sorted before hashing, so a payload
 * built in a different field order is the same payload. Without that the first
 * refactor of a row builder would push all 500 rows for no reason.
 */
/**
 * A PRODUCT'S MIRROR KEY. `PRODUCT|<Salesforce Id>`, in the same
 * sf_stock_mirror table the stock rows use — no migration, because sf_key is an
 * unconstrained TEXT PRIMARY KEY (scripts/0087-salesforce-sync-state.sql) and
 * the prefix keeps the two key spaces apart. An earlier note in DESIGN.md said
 * a Product2 row "cannot be mirrored even in principle" for want of a `target`
 * column; that was wrong, and this is the correction.
 */
export function productMirrorKey(productId: string): string {
  return `PRODUCT|${productId}`;
}

/**
 * WHAT COUNTS AS A CHANGED PRODUCT — the three fields the administrator named,
 * plus ERP_SKU__c, which the run fills once and must not re-fill for ever.
 *
 * ERP_Stock_As_Of__c IS DELIBERATELY NOT HASHED, and this is the trade the
 * administrator has to be told about rather than discover: it carries the run
 * clock, so hashing it would make every product differ on every run and the
 * diff would save exactly nothing. Leaving it out means a product whose stock
 * has not moved stops getting a fresh as-of stamp — the stamp becomes "when
 * this count last CHANGED", which is the more useful fact anyway, and the
 * run's own freshness is a property of the run, not of 110 rows.
 *
 * The sold-out zero survives untouched: a count falling to zero changes
 * ERP_Available_Slabs__c and usually ERP_Match__c too, so the hash moves and
 * the row is sent. Only a SECOND consecutive run at an unchanged zero is
 * skipped, by which point Salesforce already holds the zero.
 */
export function productPayloadHash(p: ProductPayload): string {
  return hashString([
    `sku=${p.ERP_SKU__c ?? ""}`,
    `slabs=${p.ERP_Available_Slabs__c ?? ""}`,
    `match=${p.ERP_Match__c ?? ""}`,
    `other=${p.ERP_Other_Thickness_Stock__c ?? ""}`,
  ].join("|"));
}

export interface ProductDiff {
  toPush: ProductPayload[];
  unchanged: number;
}

/**
 * Only the products whose meaning changed.
 *
 * WHY THIS EXISTS. Every non-dry run used to PATCH all 110 active quartz
 * products, undiffed, on the grounds that 110 fits in one composite call so a
 * diff would save nothing. It saves nothing in CALLS and a great deal in
 * something we were not counting: at the ten-minute cadence that is 15,840
 * record modifications a day, which moves Last Modified on every product 144
 * times a day and destroys the only cheap way to see when a PERSON last edited
 * one. Pacific's Salesforce administrator asked for this, and he was right.
 */
export function diffProducts(
  payloads: ReadonlyArray<ProductPayload>,
  mirror: ReadonlyMap<string, MirrorEntry>,
): ProductDiff {
  const toPush: ProductPayload[] = [];
  let unchanged = 0;
  for (const p of payloads) {
    const seen = mirror.get(productMirrorKey(p.Id));
    if (seen && seen.payloadHash === productPayloadHash(p)) unchanged += 1;
    else toPush.push(p);
  }
  return { toPush, unchanged };
}

/** The FNV-1a both hashes use, so they cannot drift apart. */
function hashString(stable: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i += 1) {
    h ^= stable.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function payloadHash(row: StockRow): string {
  const flat: Record<string, unknown> = {
    kind: row.kind,
    name: row.name,
    available: row.available,
    retired: row.retired,
    ...row.fields,
  };
  // A short, dependency-free FNV-1a. This is a change detector, not a
  // security primitive: it decides whether to spend an API call.
  return hashString(
    Object.keys(flat)
      .sort()
      .map((k) => `${k}=${String(flat[k] ?? "")}`)
      .join("|"),
  );
}

// ── the summary the run records ─────────────────────────────────────────────

export interface RunSummary {
  matched: number;
  notAtThickness: number;
  noErpDesign: number;
  publishedLines: number;
  publishedSlabs: number;
  unmappedSpellings: number;
  /** The same designs counted ONCE, folded the way the matcher folds them.
   *  Pacific's Salesforce administrator read "83 designs with stock and no
   *  product" and correctly objected that DESERT SILK and Desert Silk are one
   *  design listed twice: the worklist is per SPELLING, because each spelling
   *  needs its own alias row, but the DESIGN count is the smaller, truer number
   *  and both belong in the summary. */
  unmappedDesigns: number;
  unmappedSlabs: number;
  unclassifiedThickness: number;
  /** Stock withheld on purpose because its canonical is not sellable — today
   *  that is "Trial" and nothing else. Reported rather than silently dropped:
   *  740 slabs disappearing from a total with no line explaining them is how a
   *  filter becomes a bug nobody can see. */
  notSellableSlabs: number;
  notSellableSpellings: number;
  thirtyMmWithoutProduct: number;
  /**
   * ERP_Stock__c slab ROWS — one per design, thickness, finish and grade.
   * NOT publishedLines, which counts product CODES (design and thickness). The
   * two were the same number until the rows split, and Salesforce counts rows
   * when it re-reads a run, so both are reported and neither stands in for the
   * other.
   */
  slabRows: number;
  /** Rows sent with Finish__c blank / Grade__c blank — QC gave none. Counted
   *  so "the ERP sent nothing" and "the yard recorded nothing" can be told
   *  apart when Salesforce reads the first run. */
  slabRowsWithoutFinish: number;
  slabRowsWithoutGrade: number;
}

export function summarise(
  result: PublishResult,
  payloads: ReadonlyArray<ProductPayload>,
  productCodes: ReadonlySet<string>,
): RunSummary {
  const unknown = result.unmapped.filter((u) => u.reason === "UNKNOWN_DESIGN");
  const thickness = result.unmapped.filter((u) => u.reason === "THICKNESS");
  const notSellable = result.unmapped.filter((u) => u.reason === "NOT_SELLABLE");
  // The same slices slabRows() will emit — including its fallback for a line
  // with none — so this count is the row count and cannot drift from it.
  const slices: StockSplit[] = result.lines.flatMap((l) =>
    l.splits && l.splits.length ? l.splits : [{ finish: null, grade: null, available: l.available }]);
  return {
    matched: payloads.filter((p) => p.ERP_Match__c === "Matched").length,
    notAtThickness: payloads.filter((p) => p.ERP_Match__c === "Not at this thickness").length,
    noErpDesign: payloads.filter((p) => p.ERP_Match__c === "No ERP design").length,
    publishedLines: result.lines.length,
    publishedSlabs: result.lines.reduce((n, l) => n + l.available, 0),
    unmappedSpellings: new Set(unknown.map((u) => u.design)).size,
    unmappedDesigns: new Set(unknown.map((u) => foldDesignName(u.canonical || u.design))).size,
    unmappedSlabs: unknown.reduce((n, u) => n + u.available, 0),
    unclassifiedThickness: thickness.reduce((n, u) => n + u.available, 0),
    notSellableSlabs: notSellable.reduce((n, u) => n + u.available, 0),
    notSellableSpellings: new Set(notSellable.map((u) => u.design)).size,
    // The 59 designs / 4,202 slabs DISCOVERY counted: real stock with no
    // product to show it against, listed so the admin can create them.
    thirtyMmWithoutProduct: result.lines.filter((l) => l.mm === 30 && !productCodes.has(l.code)).length,
    slabRows: slices.length,
    slabRowsWithoutFinish: slices.filter((sl) => sl.finish === null).length,
    slabRowsWithoutGrade: slices.filter((sl) => sl.grade === null).length,
  };
}
