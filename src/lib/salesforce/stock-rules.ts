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
  const name = String(canonical ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `QZ-${name}-${mm}`;
}

// ── the publish rule ────────────────────────────────────────────────────────

export type UnmappedReason = "UNKNOWN_DESIGN" | "THICKNESS";

export interface StockGroup {
  design: string;
  slabThickness: string;
  available: number;
}

export interface PublishedLine {
  canonical: string;
  mm: number;
  code: string;
  available: number;
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
  const unmapped: UnmappedLine[] = [];

  for (const g of groups ?? []) {
    const available = Math.max(0, Math.trunc(Number(g?.available) || 0));
    const canonical = canonicalDesign(g?.design, aliases);
    const known = isKnownDesign(canonical, canonicalNames, productCodes);
    const mm = thicknessMmFor(g?.slabThickness);

    // THE DESIGN IS ASKED ABOUT FIRST. A cut-down slab of a design nobody
    // recognises is an unknown design, not a thickness problem: fixing the
    // thickness would still leave a name we refuse to publish, and reporting
    // it as THICKNESS would send somebody to the wrong screen.
    if (!known) {
      unmapped.push({ design: String(g?.design ?? ""), canonical, slabThickness: String(g?.slabThickness ?? ""), available, reason: "UNKNOWN_DESIGN" });
      continue;
    }
    if (mm === null) {
      unmapped.push({ design: String(g?.design ?? ""), canonical, slabThickness: String(g?.slabThickness ?? ""), available, reason: "THICKNESS" });
      continue;
    }

    const code = qzCode(canonical, mm);
    const seen = byCode.get(code);
    if (seen) seen.available += available;
    else byCode.set(code, { canonical, mm, code, available });
  }

  return {
    lines: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    unmapped: unmapped.sort((a, b) => b.available - a.available || a.design.localeCompare(b.design)),
  };
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

/** `SLAB|QZ-ARVAWHITE-20` → "Arva White 30 mm". */
export function slabRow(line: PublishedLine, productId: string | null): StockRow {
  return {
    key: `SLAB|${line.code}`,
    kind: "Slab",
    name: `${line.canonical} ${line.mm} mm`,
    available: line.available,
    retired: false,
    fields: {
      Design__c: line.canonical,
      Thickness_mm__c: line.mm,
      Product__c: productId,
      // The 30 mm story, said on the row itself rather than inferred from a
      // null lookup: 4,202 slabs of 59 designs Salesforce sells at 20/12 only.
      Product_Missing__c: productId === null,
    },
  };
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
export function payloadHash(row: StockRow): string {
  const flat: Record<string, unknown> = {
    kind: row.kind,
    name: row.name,
    available: row.available,
    retired: row.retired,
    ...row.fields,
  };
  const stable = Object.keys(flat)
    .sort()
    .map((k) => `${k}=${String(flat[k] ?? "")}`)
    .join("|");
  // A short, dependency-free FNV-1a. This is a change detector, not a
  // security primitive: it decides whether to spend an API call.
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i += 1) {
    h ^= stable.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ── the summary the run records ─────────────────────────────────────────────

export interface RunSummary {
  matched: number;
  notAtThickness: number;
  noErpDesign: number;
  publishedLines: number;
  publishedSlabs: number;
  unmappedSpellings: number;
  unmappedSlabs: number;
  unclassifiedThickness: number;
  thirtyMmWithoutProduct: number;
}

export function summarise(
  result: PublishResult,
  payloads: ReadonlyArray<ProductPayload>,
  productCodes: ReadonlySet<string>,
): RunSummary {
  const unknown = result.unmapped.filter((u) => u.reason === "UNKNOWN_DESIGN");
  const thickness = result.unmapped.filter((u) => u.reason === "THICKNESS");
  return {
    matched: payloads.filter((p) => p.ERP_Match__c === "Matched").length,
    notAtThickness: payloads.filter((p) => p.ERP_Match__c === "Not at this thickness").length,
    noErpDesign: payloads.filter((p) => p.ERP_Match__c === "No ERP design").length,
    publishedLines: result.lines.length,
    publishedSlabs: result.lines.reduce((n, l) => n + l.available, 0),
    unmappedSpellings: new Set(unknown.map((u) => u.design)).size,
    unmappedSlabs: unknown.reduce((n, u) => n + u.available, 0),
    unclassifiedThickness: thickness.reduce((n, u) => n + u.available, 0),
    // The 59 designs / 4,202 slabs DISCOVERY counted: real stock with no
    // product to show it against, listed so the admin can create them.
    thirtyMmWithoutProduct: result.lines.filter((l) => l.mm === 30 && !productCodes.has(l.code)).length,
  };
}
