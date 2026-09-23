// WHAT SALESFORCE IS TOLD WE HAVE — the rules, run against the org as it
// actually was on 2026-09-14 (docs/salesforce-link/DISCOVERY.md §3).
//
// The fixtures below are not invented. The twelve product codes and their
// counts are the twelve biggest matches DISCOVERY recorded from the live org
// and the live yard; the misspellings are real rows in fg_finished_slab; the
// thickness spellings are the real distribution, including the 440 cut-downs
// and the 25 slabs written "10 mm".
//
// Pure: node --test loads stock-rules.ts bare. Nothing here touches Salesforce.
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  THICKNESS_MM, thicknessMmFor, canonicalDesign, qzCode, isKnownDesign,
  buildStockLines, productPayloads, diffMirror, payloadHash, summarise, PRODUCT_WRITABLE_KEYS,
  isSellableProduct, SELLABLE_FAMILY, hasProductAtAnyThickness,
  foldDesignName, isNotSellable, NOT_SELLABLE_CANONICALS,
  diffProducts, productMirrorKey, productPayloadHash,
  slabRows, sampleRow, finishRow, unitRow,
  slabKey, parseSlabKey, slabKeyStillResolves, keySegment, finishValue, gradeValue,
  seriesIndex, seriesFor, slabName, clampTo, GRADE_MAX, NAME_MAX, ERP_KEY_MAX, FINISH_MAX, SERIES_MAX,
  splitProfile,
  slabKeyCode, planTransition, remainderRow, shapeEverAccepted, retirementRow, yardGroups,
  probeWave, remaindersDue, verifiedKeys, sendChunks, partitionByNewField,
  type StockGroup, type ProductRow, type StockRow, type MirrorEntry,
} from "../src/lib/salesforce/stock-rules.ts";
import {
  WRITABLE_OBJECTS, READABLE_OBJECTS, mayWrite, mayDelete,
  REQUEST_WRITABLE_FIELDS, mayWriteRequestField, refusePackForApproval, isFieldServiceObject,
  mayApprove, forbiddenPath, DAILY_CALL_BUDGET, FORBIDDEN_PATHS,
  orgNearlyOut, overOwnBudget, ORG_RESERVE_FRACTION,
} from "../src/lib/salesforce/limits.ts";

// ── the twelve biggest matches, DISCOVERY §3 ─────────────────────────────────
const TWELVE: Array<[string, string, number]> = [
  ["Arva White", "QZ-ARVAWHITE-20", 417],
  ["Cappuccino", "QZ-CAPPUCCINO-20", 396],
  ["Super White", "QZ-SUPERWHITE-20", 329],
  ["Aureate", "QZ-AUREATE-20", 218],
  ["Latte Luxe", "QZ-LATTELUXE-20", 170],
  ["Brilliant White", "QZ-BRILLIANTWHITE-20", 157],
  ["Oasis", "QZ-OASIS-20", 151],
  ["Hazel Gold", "QZ-HAZELGOLD-20", 145],
  ["Astral Mist", "QZ-ASTRALMIST-20", 131],
  ["Antonio", "QZ-ANTONIO-20", 106],
  ["Star Cluster", "QZ-STARCLUSTER-20", 100],
  ["Sakura", "QZ-SAKURA-20", 99],
];

const CANONICALS = new Set(TWELVE.map(([design]) => design));
const PRODUCT_CODES = new Set(TWELVE.map(([, code]) => code));
const NO_ALIASES = new Map<string, string>();

// ── the code scheme ─────────────────────────────────────────────────────────

test("the code scheme is a function of (design, thickness) — all twelve, exactly", () => {
  // DISCOVERY §1 proved this deterministic across all 110 active products:
  // where ERP_SKU__c is filled it is IDENTICAL to ProductCode. So there is no
  // lookup table to ask the owner for, and never was.
  for (const [design, code] of TWELVE) {
    assert.equal(qzCode(design, 20), code, design);
  }
  // Non-alphanumerics are stripped, not replaced: the org's own codes have no
  // separators inside the name.
  assert.equal(qzCode("Astral Mist Kreos Trail-2", 20), "QZ-ASTRALMISTKREOSTRAIL2-20");
  assert.equal(qzCode("arva white", 30), "QZ-ARVAWHITE-30");
});

// ── thickness ───────────────────────────────────────────────────────────────

test("four thicknesses are a number; everything else is not, and is never counted", () => {
  assert.deepEqual(THICKNESS_MM, { "7 mm": 7, "1.2 cm": 12, "2 cm": 20, "3 cm": 30 });
  assert.equal(thicknessMmFor("2 cm"), 20);
  assert.equal(thicknessMmFor("2cm"), 20, "the yard's other spelling folds");
  assert.equal(thicknessMmFor("3 cm"), 30);
  assert.equal(thicknessMmFor("3cm"), 30);
  assert.equal(thicknessMmFor("1.2 cm"), 12);
  assert.equal(thicknessMmFor("7 mm"), 7);

  // "10 mm" IS NOT 10 mm HERE, and that is the point of asserting it. 25 slabs
  // carry it; canonThickness reads it as 1.0 cm, matches none of its four
  // bands and hands the literal back. Unmapped is the honest answer — folding
  // it into 12 mm would publish stock at a thickness nobody wrote down.
  assert.equal(thicknessMmFor("10 mm"), null);

  // A CUT-DOWN IS NOT A THICKNESS. 440 slabs say "3 cm to 2 cm": the slab WAS
  // one and IS the other, and no single number is true of it. Counting it as
  // 3 cm would promise a customer a slab that no longer exists at 3 cm.
  assert.equal(thicknessMmFor("3 cm to 2 cm"), null);
  assert.equal(thicknessMmFor("2cm to 12mm"), null);
  assert.equal(thicknessMmFor(""), null);
  assert.equal(thicknessMmFor(null), null);
});

// ── THE PUBLISH RULE ────────────────────────────────────────────────────────

test("a design nobody has settled on is REFUSED, however much stock is behind it", () => {
  // The rule this whole file exists for. The yard types the design by hand and
  // there are 455 spellings for perhaps 70 designs. Deriving a code from raw
  // text would put QZ-ASTALMIST-20 into Salesforce as a product nobody sells,
  // against stock that is really Astral Mist — and a rep searching for Astral
  // Mist would be told there is none.
  for (const bad of ["Astal Mist", "Alabester White", "Artermis", "Arno Robo", "Astral Mist Kreos Trail-2"]) {
    assert.equal(isKnownDesign(bad, CANONICALS, PRODUCT_CODES), false, bad);
  }
  // Known two ways, and either is evidence.
  assert.equal(isKnownDesign("Astral Mist", CANONICALS, PRODUCT_CODES), true, "a canonical in the alias table");
  assert.equal(isKnownDesign("Sakura", new Set<string>(), PRODUCT_CODES), true, "or a code Salesforce already sells");
  assert.equal(isKnownDesign("", CANONICALS, PRODUCT_CODES), false);
});

test("a misspelling is unmapped WITH its slab count, which is what makes it a worklist", () => {
  const groups: StockGroup[] = [
    { design: "Astral Mist", slabThickness: "2 cm", available: 131 },
    { design: "Astal Mist", slabThickness: "2 cm", available: 18 },
    { design: "Alabester White", slabThickness: "2 cm", available: 40 },
  ];
  const out = buildStockLines(groups, NO_ALIASES, CANONICALS, PRODUCT_CODES);

  // PUBLISHED AND REPORTED, since 2026-09-17: the misspellings now go out as
  // stock lines of their own with no product behind them, because Pacific's
  // Salesforce administrator asked that a rep be able to SEE yard stock that
  // cannot yet be quoted. They stay on the worklist at the same time — the two
  // are not alternatives, and it is the worklist that gets them a product.
  assert.deepEqual(out.lines.map((l) => [l.code, l.available, l.productMissing]), [
    ["QZ-ALABESTERWHITE-20", 40, true],
    ["QZ-ASTALMIST-20", 18, true],
    ["QZ-ASTRALMIST-20", 131, false],
  ]);
  // Sorted by how much stock is hidden behind each, so the alias job is worked
  // by value rather than alphabetically.
  assert.deepEqual(out.unmapped.map((u) => [u.design, u.available, u.reason]), [
    ["Alabester White", 40, "UNKNOWN_DESIGN"],
    ["Astal Mist", 18, "UNKNOWN_DESIGN"],
  ]);
});

test("ALIASING IS THE FIX, and it needs no Salesforce change at all", () => {
  // The same three rows, once an admin has said Astal Mist IS Astral Mist.
  const aliases = new Map([["Astal Mist", "Astral Mist"]]);
  const groups: StockGroup[] = [
    { design: "Astral Mist", slabThickness: "2 cm", available: 131 },
    { design: "Astal Mist", slabThickness: "2 cm", available: 18 },
  ];
  const out = buildStockLines(groups, aliases, CANONICALS, PRODUCT_CODES);
  // Folded into one line — two spellings of one design are one product, and
  // publishing them separately would show a rep two products where there is one.
  assert.deepEqual(out.lines.map((l) => [l.code, l.available]), [["QZ-ASTRALMIST-20", 149]]);
  assert.equal(out.unmapped.length, 0);
});

test("the THICKNESS is asked first now, because it is the one that still blocks a line", () => {
  // THIS RULE FLIPPED ON 2026-09-17, and it flipped because the meaning of
  // "unmapped" changed under it. While an unrecognised design was WITHHELD,
  // design-first was right: fixing the thickness alone left a name we still
  // refused to publish, so naming THICKNESS sent somebody to the wrong screen.
  // Now an unrecognised design publishes as an unlinked line, so fixing the
  // thickness alone DOES get the slabs in front of a rep, while fixing the
  // design alone leaves a row with no code to send. The blocking fix is the
  // thickness, so that is the one the row names.
  const out = buildStockLines(
    [{ design: "Astal Mist", slabThickness: "3 cm to 2 cm", available: 5 }],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  );
  assert.equal(out.unmapped[0]!.reason, "THICKNESS");
  assert.equal(out.lines.length, 0, "no thickness, no code, no line");

  // A KNOWN design at an unusable thickness is the other case.
  const out2 = buildStockLines(
    [
      { design: "Arva White", slabThickness: "3 cm to 2 cm", available: 12 },
      { design: "Arva White", slabThickness: "10 mm", available: 25 },
    ],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  );
  assert.equal(out2.lines.length, 0);
  assert.deepEqual(out2.unmapped.map((u) => u.reason), ["THICKNESS", "THICKNESS"]);
});

test("30 mm stock is published even though Salesforce sells the design at 20 only", () => {
  // The largest single body of stock in the yard — 10,391 slabs — and 59
  // designs / 4,202 slabs of it are designs Salesforce lists at 20 or 12 only.
  // Requiring a product AT THE SAME THICKNESS would silently drop every one.
  // That Arva White 30 mm has no product is a fact to publish, not a reason to
  // hide the slabs.
  const out = buildStockLines(
    [
      { design: "Arva White", slabThickness: "2 cm", available: 417 },
      { design: "Arva White", slabThickness: "3 cm", available: 118 },
    ],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  );
  assert.deepEqual(out.lines.map((l) => [l.code, l.available]), [
    ["QZ-ARVAWHITE-20", 417],
    ["QZ-ARVAWHITE-30", 118],
  ]);
  assert.equal(out.unmapped.length, 0);

  // And the row says so on its own face rather than leaving it to be inferred
  // from a null lookup.
  const thirty = out.lines.find((l) => l.mm === 30)!;
  // No polish or grade in these groups, so ONE row with both blank — and the
  // Name a rep searches by is exactly what it was before the key split.
  const [row, ...more] = slabRows(thirty, null);
  assert.equal(more.length, 0);
  assert.equal(row!.key, "SLAB|QZ-ARVAWHITE-30|-|-");
  assert.equal(row!.name, "Arva White 30 mm", "what a rep actually types into search");
  assert.equal(row!.fields.Product_Missing__c, true);
  assert.equal(slabRows(out.lines[0]!, "01t000000000001")[0]!.fields.Product_Missing__c, false);
});

// ── every product hears about itself, every run ─────────────────────────────

test("a sold-out product reads 0, never last week's number", () => {
  // The fix for the failure mode that matters most: writing only the products
  // we HAVE stock for leaves the old number standing on everything that
  // emptied, and a rep reads it as today's.
  const products: ProductRow[] = [
    { id: "01t1", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: "QZ-ARVAWHITE-20", isActive: true, family: "Quartz Slab" },
    { id: "01t2", name: "Sakura", productCode: "QZ-SAKURA-20", erpSku: null, isActive: true, family: "Quartz Slab" },
  ];
  const lines = buildStockLines(
    [{ design: "Arva White", slabThickness: "2 cm", available: 417 }],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  ).lines;

  const payloads = productPayloads(products, lines, CANONICALS, PRODUCT_CODES);
  assert.equal(payloads.length, 2, "EVERY product gets a payload, not just the stocked one");
  assert.equal(payloads[0]!.ERP_Available_Slabs__c, 417);
  assert.equal(payloads[0]!.ERP_Match__c, "Matched");
  assert.equal(payloads[1]!.ERP_Available_Slabs__c, 0, "Sakura is sold out and says so");

  // ERP_SKU__c is written back where it was blank, so the 55 empty ones fill
  // on run one and the match key is the same field for every product after.
  assert.equal(payloads[1]!.ERP_SKU__c, "QZ-SAKURA-20");
});

test("a product whose stock is all at another thickness says which", () => {
  const products: ProductRow[] = [
    { id: "01t1", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: true, family: "Quartz Slab" },
  ];
  const lines = buildStockLines(
    [{ design: "Arva White", slabThickness: "3 cm", available: 118 }],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  ).lines;
  const [p] = productPayloads(products, lines, CANONICALS, PRODUCT_CODES);
  assert.equal(p!.ERP_Available_Slabs__c, 0, "none at 20 mm, and that is the honest number");
  assert.equal(p!.ERP_Match__c, "Not at this thickness");
  assert.equal(p!.ERP_Other_Thickness_Stock__c, "30 mm: 118", "so the rep can ask rather than give up");
});

test("a product the ERP has never heard of is marked, not quietly zeroed", () => {
  // 35 of the 110 products have no ERP design at all. "No ERP design" and
  // "sold out" are different facts: one is a data gap for the admin, the other
  // is a sales fact for the rep.
  const [p] = productPayloads(
    [{ id: "01t9", name: "Something Else", productCode: "QZ-SOMETHINGELSE-20", erpSku: null, isActive: true, family: "Quartz Slab" }],
    [], CANONICALS, PRODUCT_CODES,
  );
  assert.equal(p!.ERP_Match__c, "No ERP design");
  assert.equal(p!.ERP_Available_Slabs__c, 0);
  assert.equal(p!.ERP_Other_Thickness_Stock__c, "");
});

// ── the search object ───────────────────────────────────────────────────────

test("the four kinds of searchable row, keyed so a re-run updates rather than twins", () => {
  assert.equal(sampleRow("ss1", "Cappuccino (Polished) 4 × 4 in · 20 mm", 12).key, "SAMPLE|ss1");
  assert.equal(finishRow("pcf1", "Cappuccino (Leather)").key, "FINISH|pcf1");
  assert.equal(unitRow("sut_floor_stand", "Floor Stand", "STAND", 3).key, "UNIT|sut_floor_stand");
  assert.equal(unitRow("sut_sample_kit_box", "Sample Kit Box", "BOX", 11).kind, "Box");

  // "NONE LEFT" AND "NEVER CUT" STAY DIFFERENT ANSWERS, as they are in the
  // ERP: a shelf at zero is still a shelf, and a colour+finish nobody has ever
  // cut is not. Flattening them would have a rep ask the desk for something
  // that has never existed.
  const empty = sampleRow("ss2", "Oasis (Polished) 4 × 4 in · 20 mm", 0);
  assert.equal(empty.available, 0);
  assert.equal(empty.fields.Never_Stocked__c, undefined);
  assert.equal(finishRow("pcf2", "Oasis (Leather)").fields.Never_Stocked__c, true);
});

// ── sold out is not retired ─────────────────────────────────────────────────

test("sold out stays searchable; retired is written once and dropped", () => {
  const [arva] = slabRows({ canonical: "Arva White", mm: 20, code: "QZ-ARVAWHITE-20", available: 417 } as never, "01t1");
  const [sakura] = slabRows({ canonical: "Sakura", mm: 20, code: "QZ-SAKURA-20", available: 0 } as never, "01t2");

  const mirror = new Map<string, MirrorEntry>([
    [arva!.key, { key: arva!.key, payloadHash: payloadHash(arva!) }],
    [sakura!.key, { key: sakura!.key, payloadHash: "stale" }],
    // A design an admin merged away since the last run.
    ["SLAB|QZ-ASTALMIST-20|POLISHED|A", { key: "SLAB|QZ-ASTALMIST-20|POLISHED|A", payloadHash: "whatever" }],
    // A shelf row that no longer exists.
    ["SAMPLE|gone", { key: "SAMPLE|gone", payloadHash: "whatever" }],
  ]);

  const stillResolves = (key: string) => key === arva!.key || key === sakura!.key;
  const diff = diffMirror([arva!, sakura!], mirror, stillResolves);

  assert.equal(diff.unchanged, 1, "Arva White is identical and costs no API call");
  assert.deepEqual(diff.toPush.map((r) => r.key), [sakura!.key], "changed payload goes out");

  // The two that no longer mean anything are retired ONCE, and nothing is ever
  // deleted: a sample request line pointing at a retired row must still
  // resolve, and deleting it would break a record somebody is looking at.
  assert.deepEqual(diff.toRetire.map((r) => r.key).sort(), ["SAMPLE|gone", "SLAB|QZ-ASTALMIST-20|POLISHED|A"]);
  for (const r of diff.toRetire) {
    assert.equal(r.retired, true);
    assert.equal(r.available, 0);
  }
});

test("a line that emptied is pushed to zero WITHOUT being retired", () => {
  // "Do you have Arva White 20 mm" deserves "yes, none right now" rather than
  // silence, so a key that still resolves is sold out and stays.
  const mirror = new Map<string, MirrorEntry>([["SLAB|QZ-ARVAWHITE-20", { key: "SLAB|QZ-ARVAWHITE-20", payloadHash: "old" }]]);
  const diff = diffMirror([], mirror, () => true);
  assert.equal(diff.toRetire.length, 0);
  assert.deepEqual(diff.toPush.map((r) => [r.key, r.available, r.retired]), [["SLAB|QZ-ARVAWHITE-20", 0, false]]);
});

test("the change detector is stable, or the first refactor pushes all 500 rows", () => {
  const a: StockRow = { key: "SLAB|X", kind: "Slab", name: "X 20 mm", available: 3, retired: false, fields: { Design__c: "X", Thickness_mm__c: 20 } };
  const b: StockRow = { key: "SLAB|X", kind: "Slab", name: "X 20 mm", available: 3, retired: false, fields: { Thickness_mm__c: 20, Design__c: "X" } };
  assert.equal(payloadHash(a), payloadHash(b), "field order is not a change");
  assert.notEqual(payloadHash(a), payloadHash({ ...a, available: 4 }), "a count is");
  assert.notEqual(payloadHash(a), payloadHash({ ...a, retired: true }));
});

// ── the run's own summary ───────────────────────────────────────────────────

test("the summary counts what DISCOVERY counted, so a run can be compared to it", () => {
  const groups: StockGroup[] = [
    ...TWELVE.map(([design, , n]) => ({ design, slabThickness: "2 cm", available: n })),
    { design: "Arva White", slabThickness: "3 cm", available: 118 },
    { design: "Astal Mist", slabThickness: "2 cm", available: 18 },
    { design: "Arva White", slabThickness: "3 cm to 2 cm", available: 12 },
  ];
  const result = buildStockLines(groups, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const products: ProductRow[] = TWELVE.map(([, code], i) => ({ id: `01t${i}`, name: code, productCode: code, erpSku: code, isActive: true, family: "Quartz Slab" }));
  const payloads = productPayloads(products, result.lines, CANONICALS, PRODUCT_CODES);
  const s = summarise(result, payloads, PRODUCT_CODES);

  assert.equal(s.matched, 12, "all twelve fixtures match");
  // The 18 unrecognised slabs are now PUBLISHED as an unlinked line as well as
  // reported, so they count toward publishedSlabs. unmappedSlabs still counts
  // them too: "published" and "needs a product" are different questions.
  assert.equal(s.publishedSlabs, TWELVE.reduce((n, [, , c]) => n + c, 0) + 118 + 18);
  assert.equal(s.unmappedSpellings, 1, "Astal Mist");
  assert.equal(s.unmappedSlabs, 18);
  assert.equal(s.unclassifiedThickness, 12, "the cut-down, counted but not published");
  // The 30 mm line has no product of its own — the number the admin needs to
  // decide whether to create one.
  assert.equal(s.thirtyMmWithoutProduct, 1);
});

test("canonicalDesign leans on the alias table and is never memoised across runs", () => {
  // Read fresh every run, exactly as inventory-bridge.aliasMap() is and for the
  // same reason: designs get merged while the app is running, and a cached map
  // keeps publishing under a name an admin has just retired.
  const aliases = new Map([["Astal Mist", "Astral Mist"], ["arno robo", "Arno"]]);
  assert.equal(canonicalDesign("Astal Mist", aliases), "Astral Mist");
  assert.equal(canonicalDesign("arno robo", aliases), "Arno");
  assert.equal(canonicalDesign("  Astal Mist  ", aliases), "Astral Mist", "the yard pads its text");
  assert.equal(canonicalDesign("Unknown Thing", aliases), "Unknown Thing", "passes through, and is refused later");
  assert.equal(canonicalDesign("", aliases), "");
});

// ───────── what the org will actually accept, as built on 2026-09-16 ────────

test("a Product2 payload writes Id and ERP_ fields, and nothing else the org would reject", () => {
  // THE ORG ENFORCES THIS TOO, which is why it is worth pinning here rather
  // than trusting the shape of an object literal. Products are Public
  // Read/Write in Pacific's org, so Edit on Product2 would let this job rename
  // a product or deactivate it; the administrator added a validation rule
  // (ERP_writes_ERP_fields_only) that REJECTS an ERP write to Name, Active,
  // Record Type, Currency, Family, Product Code, Description, SKU, Unit of
  // Measure, Display URL or External ID.
  //
  // A stray key therefore does not quietly do the wrong thing — it fails the
  // whole composite call and takes every product in the batch with it. Adding
  // a field here without adding it in Salesforce first breaks the run.
  const payloads = productPayloads(
    [{ id: "01t1", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: true, family: "Quartz Slab" }],
    [], CANONICALS, PRODUCT_CODES, "2026-09-16T08:00:00.000Z",
  );
  for (const p of payloads) {
    for (const key of Object.keys(p)) {
      assert.ok(PRODUCT_WRITABLE_KEYS.includes(key), `${key} is not a key the org will accept`);
      assert.ok(key === "Id" || key.startsWith("ERP_"), `${key} is neither the record id nor an ERP_ field`);
    }
  }
  // ERP_In_Stock__c is a FORMULA in Salesforce — writing it would fail, and it
  // must stay derived so the flag reps filter on cannot drift from the count.
  assert.equal(PRODUCT_WRITABLE_KEYS.includes("ERP_In_Stock__c"), false);
});

test("every product in one run carries the same as-of stamp, and it is passed in, not read", () => {
  // One value for the whole run, so two products never disagree about when the
  // yard was counted. Passed in rather than taken from a clock here: the same
  // inputs must always produce the same output, which is what lets a dry run be
  // compared with the run that follows it.
  const AT = "2026-09-16T08:00:00.000Z";
  const products: ProductRow[] = [
    { id: "01t1", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: true, family: "Quartz Slab" },
    { id: "01t2", name: "Sakura", productCode: "QZ-SAKURA-20", erpSku: null, isActive: true, family: "Quartz Slab" },
  ];
  const payloads = productPayloads(products, [], CANONICALS, PRODUCT_CODES, AT);
  assert.deepEqual([...new Set(payloads.map((p) => p.ERP_Stock_As_Of__c))], [AT]);
  // Called twice with the same arguments, the answer is identical.
  assert.deepEqual(productPayloads(products, [], CANONICALS, PRODUCT_CODES, AT), payloads);
});

// ───────── the promises made to the Salesforce administrator ────────────────

test("the ERP writes to six objects and no others — the field-service app is out of bounds", () => {
  // The integration user's profile (Salesforce API Only System Integrations)
  // grants create and edit on every CI_FST__* object: visits, beats, expenses,
  // attendance. The administrator told us rather than assuming we knew, and an
  // allowlist is the answer that survives somebody adding a feature later.
  // THESE ARE THE ORG'S REAL OBJECT NAMES, checked by the administrator on
  // 2026-09-16. An earlier version of this test named CI_FST__Visit__c,
  // CI_FST__Beat__c, CI_FST__Expense__c and CI_FST__Attendance__c — none of
  // which EXISTS. It refused four spellings nothing uses and read as though it
  // protected something. The profile grants create, edit and DELETE on 27
  // CI_FST__ objects, so the guard is a prefix now and cannot drift as objects
  // are added.
  for (const o of [
    "CI_FST__FST_Visit__c", "CI_FST__AdditionVisit__c",
    "CI_FST__FST_Beat__c", "CI_FST__FST_Beat_Customer__c", "CI_FST__Beat_Assignment__c",
    "CI_FST__Daily_Expense__c", "CI_FST__TravelConveyance__c", "CI_FST__Expense_Category__c", "CI_FST__Expense_Limit__c",
    "CI_FST__FST_Attendance__c", "CI_FST__FST_Attendance_Log__c",
    "CI_FST__Refresh_Visit_Data__e",
  ]) {
    assert.equal(mayWrite(o), false, `${o} must never be writable`);
    assert.equal(isFieldServiceObject(o), true, o);
  }
  // Salesforce object names are case-insensitive: ci_fst__fst_visit__c IS
  // CI_FST__FST_Visit__c, and a case-sensitive guard would pass while the real
  // call went through.
  assert.equal(mayWrite("ci_fst__fst_visit__c"), false);
  assert.equal(isFieldServiceObject("Ci_Fst__Anything_At_All__c"), true);
  assert.equal(isFieldServiceObject("Product2"), false);
  for (const o of ["Contact", "Lead", "Case", "Order", "Pricebook2", "PricebookEntry"]) {
    assert.equal(mayWrite(o), false, o);
  }
  // And the six that are.
  assert.deepEqual([...WRITABLE_OBJECTS].sort(), [
    "ERP_Stock__c", "Integration_Log__c", "Product2",
    // "_I" sorts before "__", so the Item object precedes its parent here.
    "Sample_Dispatch_Item__c", "Sample_Dispatch__c", "Sample_Stand__c",
  ]);
  for (const o of WRITABLE_OBJECTS) assert.equal(mayWrite(o), true, o);
  assert.equal(mayWrite(""), false);
  assert.equal(mayWrite("product2"), false, "the API name is case-sensitive; a near miss is a refusal");

  // Read-only, and Account is on it deliberately: the request pull selects
  // Account__r.Name and the pack writes the package out under it.
  assert.ok(READABLE_OBJECTS.includes("Account"));
  assert.equal(mayWrite("Account"), false);
});

test("the ERP has no delete, and the source carries none either", () => {
  // THE ORG CANNOT STOP US. At Stage 4 the integration user needs Modify All on
  // Sample_Dispatch__c — the only permission that can write to a request locked
  // by the approval process, which is the point of the feature. Salesforce's
  // Modify All INCLUDES delete and there is no narrower grant, so the
  // administrator asked whether we still wanted it knowing that. We said yes,
  // and that the promise would be checkable rather than merely stated. This is
  // where it is checked.
  for (const o of [...WRITABLE_OBJECTS, "Sample_Dispatch__c", "anything at all"]) {
    assert.equal(mayDelete(o), false, o);
  }

  // And no module under lib/salesforce may issue one. Whoever needs a delete
  // has to defeat this test deliberately, and explain why in the commit.
  const dir = fileURLToPath(new URL("../src/lib/salesforce/", import.meta.url));
  // limits.ts is excluded because it is the file that NAMES the forbidden
  // things — it must contain the strings this scan looks for, or it could not
  // refuse them. Every other module under lib/salesforce is scanned.
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "limits.ts");
  assert.ok(files.length > 0, "the folder must exist for this guard to mean anything");
  for (const f of files) {
    const src = readFileSync(dir + f, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/method:\s*["'`]DELETE["'`]/i.test(code), false, `${f} issues an HTTP DELETE`);
    assert.equal(/deleteSobject|sobjects\/[^"'`]*\/delete/i.test(code), false, `${f} calls a delete endpoint`);
    // AND NEVER APPROVES. Modify All carries three riders, not one: delete,
    // owner-change, and the right to APPROVE. The third is the worst of them —
    // a delete leaves a hole somebody notices, an owner change takes a request
    // off the desk's list, but an approval is invisible and final: the stand
    // ships and Salesforce records a clean approval against a manager who
    // never saw it.
    assert.equal(/process\/approvals/i.test(code), false, `${f} calls the approvals endpoint`);
  }
});

// ───────── the org has 283 products, not 110 (admin, 2026-09-16) ────────────

test("only ACTIVE Quartz Slab products are written — the inactive twins are the trap", () => {
  // THE FAILURE THIS PREVENTS IS NOT COSMETIC. The org holds 283 products:
  // 110 active Quartz Slab (ours), 55 INACTIVE in family "Quartz" that share
  // their ProductCode AND their Name with an active one, and 30 older inactive
  // ones with no family at all.
  //
  // Writing ERP_SKU__c onto an inactive twin violates the unique constraint,
  // because its active partner already holds that value — and in an all-or-none
  // composite call that fails the ENTIRE batch. Salesforce catches nothing
  // else: all three ERP_Match__c values are available on every record type and
  // on products with none, so a wrong match saves silently.
  const twin = { id: "01tOLD", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: false, family: "Quartz" };
  const active = { id: "01tNEW", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: true, family: "Quartz Slab" };
  const ancient = { id: "01tANC", name: "Alabaster (3cm)", productCode: "PCS-ALAB-3CM", erpSku: null, isActive: false, family: null };

  assert.equal(isSellableProduct(active), true);
  assert.equal(isSellableProduct(twin), false, "inactive, and the family is 'Quartz' not 'Quartz Slab'");
  assert.equal(isSellableProduct(ancient), false, "no family at all");
  // Active but in another family, and Quartz Slab but inactive: both refused.
  assert.equal(isSellableProduct({ isActive: true, family: "Quartz" }), false);
  assert.equal(isSellableProduct({ isActive: false, family: SELLABLE_FAMILY }), false);
  assert.equal(isSellableProduct({ isActive: true, family: " Quartz Slab " }), true, "the org's own spacing is forgiven");
  assert.equal(isSellableProduct({ isActive: true, family: "quartz slab" }), false, "but not a different spelling");

  // And the payload builder drops them itself, rather than trusting the caller
  // to have written the WHERE clause correctly.
  const payloads = productPayloads([twin, active, ancient], [], CANONICALS, PRODUCT_CODES, "2026-09-16T08:00:00.000Z");
  assert.deepEqual(payloads.map((p) => p.Id), ["01tNEW"], "one payload, for the active product only");
});

test("a blank ERP_SKU__c does not make a code fallback safe", () => {
  // The specific trap the administrator named: the fallback is "match on
  // ProductCode where ERP_SKU__c is blank", and ALL 55 inactive copies are
  // blank too — so the fallback walks straight into them unless it carries the
  // same filter the primary match does. It does, because the filter is applied
  // before the match rather than inside it.
  const blanks = [
    { id: "01tOLD", name: "Sakura", productCode: "QZ-SAKURA-20", erpSku: null, isActive: false, family: "Quartz" },
    { id: "01tNEW", name: "Sakura", productCode: "QZ-SAKURA-20", erpSku: null, isActive: true, family: "Quartz Slab" },
  ];
  const payloads = productPayloads(blanks, [], CANONICALS, PRODUCT_CODES, "2026-09-16T08:00:00.000Z");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]!.Id, "01tNEW");
  assert.equal(payloads[0]!.ERP_SKU__c, "QZ-SAKURA-20", "filled from the code, on the ACTIVE product only");
});

test("the two field limits the org will enforce on a save", () => {
  // Both named by the administrator after testing the save in production.
  // ERP_Match__c takes only its three values, spelt exactly; a fourth would be
  // refused and take the batch with it.
  const payloads = productPayloads(
    [
      { id: "a", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: true, family: "Quartz Slab" },
      { id: "b", name: "Sakura", productCode: "QZ-SAKURA-20", erpSku: null, isActive: true, family: "Quartz Slab" },
    ],
    buildStockLines([{ design: "Arva White", slabThickness: "2 cm", available: 5 }], NO_ALIASES, CANONICALS, PRODUCT_CODES).lines,
    CANONICALS, PRODUCT_CODES, "2026-09-16T08:00:00.000Z",
  );
  for (const p of payloads) {
    assert.ok(["Matched", "Not at this thickness", "No ERP design"].includes(p.ERP_Match__c), p.ERP_Match__c);
    // Text(255): longer and the save fails outright.
    assert.ok(p.ERP_Other_Thickness_Stock__c.length <= 255);
  }
});

// ───────── Stage 4, as the administrator corrected it on 2026-09-16 ─────────

test("OwnerId is never written: Modify All carries more than Delete", () => {
  // Modify All also lets the integration user CHANGE A RECORD'S OWNER, and
  // these requests belong to the PCES Sampling Desk QUEUE. Reassigning one
  // would take it off the desk's list silently — the request would simply stop
  // appearing where the people who work it look, with no error anywhere.
  assert.equal(mayWriteRequestField("OwnerId"), false);
  assert.equal(REQUEST_WRITABLE_FIELDS.includes("OwnerId"), false);
  // Nor the rep's own content, nor the approval's.
  for (const f of ["Requested_Items__c", "Account__c", "Approval_Status__c", "Approver__c", "Dispatch_Type__c", "Needed_By__c"]) {
    assert.equal(mayWriteRequestField(f), false, f);
  }
  // What it MAY write: the ERP_ fields, plus the four the design argues for.
  for (const f of ["ERP_Status__c", "ERP_Stock_Check_Note__c", "Status__c", "Blocked_Reason__c", "Sample_ETA__c", "Courier_Docket__c", "Sample_Stand__c"]) {
    assert.equal(mayWriteRequestField(f), true, f);
  }
});

test("packing is decided by the APPROVAL, never by the status or the dispatch type", () => {
  // Salesforce stops the DESK marking a Pending request Dispatched, but nothing
  // stops ERP_Status__c moving to Packed — that field is ours, so the rule has
  // to be ours too.
  assert.equal(refusePackForApproval("Approved", null), null);
  assert.equal(refusePackForApproval("Not Required", null), null, "every type but New Stand, and it is a pass not a gap");

  assert.match(refusePackForApproval("Rejected", null)!, /will not be packed/);

  // PENDING IS A REFUSAL EVEN WHEN NOBODY IS WAITING. A rep can recall a
  // pending New Stand: that unlocks the record but leaves Approval_Status__c on
  // Pending with no approval under way and nothing to resubmit it. Stock must
  // not be committed to a request that may never move again.
  const pending = refusePackForApproval("Pending", null);
  assert.ok(pending);
  assert.match(pending!, /recalled/, "and the message tells the desk what to ask for");

  // Anything unrecognised, blank or absent is a refusal, not a silent pass.
  for (const v of ["", null, undefined, "Something New"]) {
    assert.ok(refusePackForApproval(v as string | null | undefined, null), String(v));
  }
});

// ───────── "Not Required" has two meanings (admin, 2026-09-16) ──────────────

test("Not Required with an approver is a FAILED submission, not a carve-out", () => {
  // The two cases look identical on the record and mean opposite things.
  //
  // An approver is stamped only on CREATE and the submission runs straight
  // after. If that submission fails, the flow logs a Failed row and SAVES THE
  // REQUEST ANYWAY — and nothing ever submits it again, because the flow runs
  // only on create. The request then sits at Not Required with an approver on
  // it, looking exactly like the carve-out, and packing it skips a manager's
  // decision that was meant to happen.
  const failed = refusePackForApproval("Not Required", "005xx0000012345");
  assert.ok(failed, "an approver on a Not Required request means the submission failed");
  assert.match(failed!, /never submitted|submission failed/i);
  assert.match(failed!, /submit it for approval|raise it again/i, "and the desk is told what to ask for");

  // The genuine carve-outs, which DO pack: nothing to approve, so no approver.
  assert.equal(refusePackForApproval("Not Required", null), null, "a Sample Kit needs no approval");
  assert.equal(refusePackForApproval("Not Required", ""), null);
  assert.equal(refusePackForApproval("Not Required", "   "), null, "whitespace is not an approver");
  // A New Stand from a rep with no manager on file is the org's deliberate
  // carve-out and is indistinguishable here — correctly, because it IS the
  // blank-approver case.

  // ASKED OF EVERY TYPE, not only New Stand: the dispatch type can be changed
  // after the fact, so a failed submission may sit on a request that no longer
  // reads as a stand. The function never sees the type, which is the point.
  assert.equal(refusePackForApproval.length, 2, "the approver is required, not optional");

  // Approved still packs whether or not an approver is recorded.
  assert.equal(refusePackForApproval("Approved", "005xx0000012345"), null);
  assert.equal(refusePackForApproval("Approved", null), null);
});

test("the ERP never approves, and the forbidden paths are refused by name", () => {
  // The promise we made the administrator in writing (REPLY round 2, §4) and
  // had NOT enforced: Modify All grants approve as well as delete and
  // owner-change, and only our own code can decline it.
  for (const o of [...WRITABLE_OBJECTS, "Sample_Dispatch__c"]) {
    assert.equal(mayApprove(o), false, o);
  }
  for (const p of [
    "/services/data/v62.0/process/approvals",
    "/services/data/v62.0/process/approvals/",
    "/SERVICES/DATA/V62.0/PROCESS/APPROVALS",
    "/services/data/v62.0/process/rules/001xx/assignmentRules",
  ]) {
    assert.equal(forbiddenPath(p), true, p);
  }
  // The paths it legitimately uses are not caught by the filter.
  for (const p of [
    "/services/data/v62.0/composite/sobjects",
    "/services/data/v62.0/composite/sobjects/ERP_Stock__c/ERP_Key__c",
    "/services/data/v62.0/query?q=SELECT+Id+FROM+Product2",
    "/services/oauth2/token",
  ]) {
    assert.equal(forbiddenPath(p), false, p);
  }
});

// ───────── two defects an adversarial review found, both reproduced ─────────

test("a case variant at another thickness is still the same design", () => {
  // isKnownDesign tolerates case on purpose and qzCode strips punctuation, so
  // "Arva White" and "arva white" publish as ONE code and TWO canonical
  // strings. Grouping the other-thickness siblings by the STRING meant the two
  // never met: the note came out empty, and once the 20 mm stock sold out the
  // product read "No ERP design" over 118 real slabs. The 30 mm body is the
  // largest in the yard and exactly where unaliased spellings live.
  const P = [{ id: "01t1", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: true, family: "Quartz Slab" }];
  const mixed = buildStockLines(
    [{ design: "Arva White", slabThickness: "2 cm", available: 417 },
     { design: "arva white", slabThickness: "3 cm", available: 118 }],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  );
  assert.equal(mixed.lines.length, 2, "two codes, because the thicknesses differ");
  const [p] = productPayloads(P, mixed.lines, CANONICALS, PRODUCT_CODES, "T");
  assert.equal(p!.ERP_Other_Thickness_Stock__c, "30 mm: 118", "the variant's stock is still visible");
  assert.equal(p!.ERP_Match__c, "Matched");

  // And the failure that mattered: 20 mm sold out, 30 mm held under a variant.
  const onlyThirty = buildStockLines(
    [{ design: "arva white", slabThickness: "3 cm", available: 118 }],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  );
  const [q] = productPayloads(P, onlyThirty.lines, CANONICALS, PRODUCT_CODES, "T");
  assert.equal(q!.ERP_Match__c, "Not at this thickness", "NOT 'No ERP design' — we hold 118 of them");
  assert.equal(q!.ERP_Other_Thickness_Stock__c, "30 mm: 118");

  // A design whose NAME ends in a digit keeps it: the stem strips the
  // thickness only. The org really has "Astral Mist Kreos Trail-2".
  const trail = new Set(["Astral Mist Kreos Trail-2"]);
  const codes = new Set(["QZ-ASTRALMISTKREOSTRAIL2-20"]);
  const lines = buildStockLines(
    [{ design: "Astral Mist Kreos Trail-2", slabThickness: "3 cm", available: 7 }],
    NO_ALIASES, trail, codes,
  ).lines;
  const [r] = productPayloads(
    [{ id: "01t9", name: "x", productCode: "QZ-ASTRALMISTKREOSTRAIL2-20", erpSku: null, isActive: true, family: "Quartz Slab" }],
    lines, trail, codes, "T",
  );
  assert.equal(r!.ERP_Other_Thickness_Stock__c, "30 mm: 7");
});

test("a sold-out row is written to zero ONCE, and never renamed to its own key", () => {
  // Two defects in one row. The zeroing row was built with `name: key`, so
  // pushing it would put the literal "SLAB|QZ-ARVAWHITE-20" into the Name a rep
  // searches by, replacing "Arva White 20 mm". And its hash was never compared,
  // so it was re-pushed on EVERY run — at ten runs an hour against a
  // thousand-call daily budget, a few hundred permanently sold-out lines would
  // spend the budget saying nothing.
  const [arva] = slabRows({ canonical: "Arva White", mm: 20, code: "QZ-ARVAWHITE-20", available: 0 } as never, "01t1");
  const first = diffMirror([], new Map([[arva!.key, { key: arva!.key, payloadHash: "something-else" }]]), () => true);
  assert.equal(first.toPush.length, 1, "the line is gone: zero it");
  assert.equal(first.toPush[0]!.available, 0);
  assert.equal(first.toPush[0]!.retired, false, "sold out, not retired — it stays searchable");
  assert.equal(first.toPush[0]!.name, null, "and the Name is left alone, not overwritten with the key");

  // Second run, mirror now holding exactly what we pushed: nothing to do.
  const zeroed = first.toPush[0]!;
  const second = diffMirror([], new Map([[zeroed.key, { key: zeroed.key, payloadHash: payloadHash(zeroed) }]]), () => true);
  assert.deepEqual(second.toPush, [], "already zero: no second call, and no third");
  assert.equal(second.unchanged, 1);

  // A key whose design was merged away is retired once, and also unnamed.
  const gone = diffMirror([], new Map([["SLAB|QZ-ASTALMIST-20", { key: "SLAB|QZ-ASTALMIST-20", payloadHash: "x" }]]), () => false);
  assert.equal(gone.toRetire.length, 1);
  assert.equal(gone.toRetire[0]!.retired, true);
  assert.equal(gone.toRetire[0]!.name, null);
});

test("the recall is the one approval action only OUR guard can stop", () => {
  // The administrator tested it and confirmed the danger was real: with Stage 4
  // access the integration user CAN approve a pending New Stand, and Salesforce
  // records it as Approved. He is adding a trigger that refuses any change to
  // Approval_Status__c made with the ERP_Integration permission.
  //
  // THAT TRIGGER CANNOT SEE A RECALL, because a recall does not change
  // Approval_Status__c — the request simply stays Pending. So his guard covers
  // approve, reject and submit; ours covers those and the recall. Neither is
  // redundant, and the action only ours catches is the one that strands a
  // request at Pending with nothing to resubmit it.
  for (const p of [
    "/services/data/v62.0/process/approvals",            // approve
    "/services/data/v62.0/process/approvals?_HttpMethod=POST", // reject / submit
    "/services/data/v62.0/process/approvals/",           // recall — same endpoint
  ]) {
    assert.equal(forbiddenPath(p), true, p);
  }
  assert.ok(FORBIDDEN_PATHS.includes("/process/approvals"));
});

test("the daily call budget is ours, fixed, and far under the org's", () => {
  // The org allows 160,000 calls a day and had used ~3,700 when he checked, so
  // this is a ceiling we chose rather than one we are near. He asked us to keep
  // it fixed rather than grow into the headroom, which is why it is a named
  // constant with the reason beside it instead of a number in a comment.
  assert.equal(DAILY_CALL_BUDGET, 1000);
  // THE CADENCE FITS, BUT COUNT THE FIRST RUN HONESTLY. This asserted
  // 144 * 6 until 2026-09-17, a six-call bound the shipped code already broke:
  // a first run against an empty mirror is 7 — one token, one Product2 SOQL,
  // one Product2 PATCH and four upsert chunks of 200 for ~710 stock rows. A
  // green test asserting a false premise is worse than no test, so this asserts
  // the real worst case and the real steady state.
  const FIRST_RUN_CALLS = 7;     // cold token + SOQL + 1 product chunk + 4 stock chunks
  const STEADY_RUN_CALLS = 3;    // token + SOQL + at most one changed chunk
  const RUNS_PER_DAY = 144;      // the ten-minute cadence, once it is scheduled
  assert.ok(FIRST_RUN_CALLS + (RUNS_PER_DAY - 1) * STEADY_RUN_CALLS < DAILY_CALL_BUDGET,
    "a first run plus a day of steady runs stays inside our own ceiling");
  // And the pathological day — every run finding a full set of changes — does NOT
  // fit, which is the number to know before the cron is scheduled.
  assert.ok(RUNS_PER_DAY * FIRST_RUN_CALLS > DAILY_CALL_BUDGET,
    "a day of worst-case runs would breach it, and nothing in the code would stop that");
  assert.ok(DAILY_CALL_BUDGET < 160_000, "and nowhere near the org's");
});

// ── the two defects the administrator's reply uncovered, 2026-09-17 ──────────
//
// Both were found by checking his objections against the code rather than by a
// failing test, which is why they are pinned here now.

test("THE NAME BRANCH FOLDS CASE, like the code branch — 235 slabs were withheld by this", () => {
  // "Pebble ice" is the canonical "Pebble Ice"; the set holds names as typed, so
  // a set lookup that an uppercase or a missing space defeats refused four
  // designs we already publish. We were about to ask the customer to hand-write
  // alias rows to paper over it.
  const names = new Set(["Pebble Ice", "Taj Mahal", "Carrara Cloud", "Irish Grey"]);
  const none = new Set<string>();
  for (const spelling of ["Pebble ice", "PEBBLE ICE", "pebbleice", "Tajmahal", "TAJ MAHAL",
                          "Carrara cloud", "carraracloud", "Irish grey"]) {
    assert.equal(isKnownDesign(spelling, names, none), true, spelling);
  }
});

test("folding does not make DIFFERENT designs equal", () => {
  const names = new Set(["Arva White"]);
  const none = new Set<string>();
  for (const other of ["Arva Black", "Arva", "White", "Arva White 2", "ArvaWhite2"]) {
    assert.equal(isKnownDesign(other, names, none), false, other);
  }
  // ...but the exact design, however spelt, still matches.
  assert.equal(isKnownDesign("arva  white", names, none), true);
});

test("foldDesignName is the ONE normalisation, shared with qzCode", () => {
  assert.equal(foldDesignName("Pebble Ice"), "PEBBLEICE");
  assert.equal(foldDesignName("  taj-mahal "), "TAJMAHAL");
  assert.equal(foldDesignName(null), "");
  // the invariant that stops the two branches drifting apart again
  for (const n of ["Arva White", "Taj Mahal", "Simply White"]) {
    assert.equal(qzCode(n, 20), `QZ-${foldDesignName(n)}-20`);
  }
});

test("TRIAL STOCK IS WITHHELD — 740 slabs of experiments are not sellable", () => {
  // "Trial" is a canonical in fg_design_alias with 133 variants mapped onto it,
  // so it PASSED the publish rule and would have reached reps as stock.
  assert.equal(isNotSellable("Trial"), true);
  assert.equal(isNotSellable("TRIAL"), true);
  assert.equal(isNotSellable("  trial  "), true);
  assert.equal(NOT_SELLABLE_CANONICALS.has("TRIAL"), true);
  // and nothing else is caught by it
  for (const ok of ["Trial Blend", "Industrial", "Arva White", "", null]) {
    assert.equal(isNotSellable(ok), false, String(ok));
  }
});

test("a not-sellable design is REPORTED, not silently dropped", () => {
  const groups: StockGroup[] = [
    { design: "Blue Kreos", slabThickness: "2 cm", available: 401 },
    { design: "Arva White", slabThickness: "2 cm", available: 10 },
  ];
  const aliases = new Map([["Blue Kreos", "Trial"], ["Arva White", "Arva White"]]);
  const names = new Set(["Trial", "Arva White"]);
  const out = buildStockLines(groups, aliases, names, new Set<string>());
  // the trial slabs do not reach Salesforce...
  assert.equal(out.lines.some((l) => /TRIAL/.test(l.code)), false);
  // ...and they are not passed off as an unknown design the admin must fix
  const trial = out.unmapped.find((u) => u.design === "Blue Kreos");
  assert.equal(trial?.reason, "NOT_SELLABLE");
  assert.equal(trial?.available, 401);
  // the real design is unaffected
  assert.equal(out.lines.find((l) => l.code === "QZ-ARVAWHITE-20")?.available, 10);
});

// ── the administrator's point 6: stop rewriting every product every run ──────

const PAY = (id: string, slabs: number, match: string) => ({
  Id: id, ERP_SKU__c: `QZ-X-${id}`, ERP_Available_Slabs__c: slabs,
  ERP_Match__c: match as never, ERP_Other_Thickness_Stock__c: "",
  ERP_Stock_As_Of__c: "2026-09-17T00:00:00.000Z",
});

test("an unchanged product costs no modification", () => {
  const p = PAY("01t1", 12, "Matched");
  const mirror = new Map([[productMirrorKey("01t1"), { key: productMirrorKey("01t1"), payloadHash: productPayloadHash(p as never) }]]);
  const d = diffProducts([p as never], mirror);
  assert.equal(d.toPush.length, 0);
  assert.equal(d.unchanged, 1);
});

test("THE AS-OF STAMP IS NOT HASHED, or the diff would save nothing", () => {
  // It carries the run clock: hash it and all 110 products differ every run,
  // which is the behaviour we are removing.
  const a = PAY("01t1", 12, "Matched");
  const b = { ...a, ERP_Stock_As_Of__c: "2026-12-25T11:11:11.000Z" };
  assert.equal(productPayloadHash(a as never), productPayloadHash(b as never));
});

test("A SOLD-OUT ZERO STILL GOES OUT — the diff must not swallow it", () => {
  const before = PAY("01t1", 12, "Matched");
  const soldOut = { ...before, ERP_Available_Slabs__c: 0, ERP_Match__c: "Not at this thickness" };
  const mirror = new Map([[productMirrorKey("01t1"), { key: productMirrorKey("01t1"), payloadHash: productPayloadHash(before as never) }]]);
  const d = diffProducts([soldOut as never], mirror);
  assert.equal(d.toPush.length, 1, "the zero is a change and must be sent");
  assert.equal(d.unchanged, 0);
});

test("each of the three fields the administrator named moves the hash", () => {
  const base = PAY("01t1", 12, "Matched");
  for (const changed of [
    { ...base, ERP_Available_Slabs__c: 13 },
    { ...base, ERP_Match__c: "No ERP design" },
    { ...base, ERP_Other_Thickness_Stock__c: "30 mm: 4" },
    { ...base, ERP_SKU__c: "QZ-OTHER-20" },
  ]) {
    assert.notEqual(productPayloadHash(changed as never), productPayloadHash(base as never));
  }
});

test("a product Salesforce has never seen is always pushed", () => {
  const d = diffProducts([PAY("01tNEW", 5, "Matched") as never], new Map());
  assert.equal(d.toPush.length, 1);
});

test("THE TWO KEY SPACES DO NOT COLLIDE in the one mirror table", () => {
  // sf_key is an unconstrained TEXT PRIMARY KEY, so products share the stock
  // rows' table. A PRODUCT| key reaching diffMirror would be "retired" into
  // ERP_Stock__c as a phantom row, which is why stock.ts splits them first.
  assert.equal(productMirrorKey("01t1").startsWith("PRODUCT|"), true);
  for (const stockKey of ["SLAB|QZ-ARVAWHITE-20", "SAMPLE|abc", "FINISH|abc", "UNIT|abc"]) {
    assert.equal(stockKey.startsWith("PRODUCT|"), false, stockKey);
  }
});

// ── the two guards the administrator asked us to actually build, 2026-09-17 ──
//
// Both were described in comments for weeks and neither existed. He is relying
// on the org one as his second line, so these pin that they now decide.

test("we stand down below 10% of the ORG's allowance — his second line", () => {
  assert.equal(ORG_RESERVE_FRACTION, 0.1);
  // the reserve is 10% of 160,000 = 16,000 calls LEFT, not used
  assert.equal(orgNearlyOut({ used: 143_000, total: 160_000 }), false, "17,000 left, 10.6% — fine");
  assert.equal(orgNearlyOut({ used: 144_000, total: 160_000 }), false, "exactly 16,000 left is not yet under");
  assert.equal(orgNearlyOut({ used: 145_000, total: 160_000 }), true, "15,000 left, 9.4% — stand down");
  assert.equal(orgNearlyOut({ used: 160_000, total: 160_000 }), true, "nothing left");
});

test("UNKNOWN IS NOT EMPTY — a missing header must not stop the run", () => {
  // Sforce-Limit-Info is absent on some responses. Reading that as "the org is
  // out" would stand the sync down for ever on a header that never arrives.
  for (const l of [{ used: null, total: null }, { used: 5, total: null }, { used: null, total: 10 },
                   { used: 5, total: 0 }, { used: 5, total: -1 }]) {
    assert.equal(orgNearlyOut(l), false, JSON.stringify(l));
  }
});

test("our own ceiling stops the writes, counting the calls this run has ALREADY made", () => {
  assert.equal(DAILY_CALL_BUDGET, 1000);
  assert.equal(overOwnBudget(900, 2), false);
  assert.equal(overOwnBudget(998, 2), true, "998 spent plus the 2 this run reaches 1000");
  assert.equal(overOwnBudget(1200, 0), true, "already past it");
  assert.equal(overOwnBudget(0, 0), false);
  // the ceiling is a parameter so a test does not have to move the constant
  assert.equal(overOwnBudget(9, 1, 10), true);
});

test("A PRODUCT BEATS THE TRIAL MARKER, or we withhold a design the org sells", () => {
  // "Astral Mist Kreos Trail-2" is a real product. A word-boundary test for
  // "trail" caught it and withheld 7 slabs of sellable stock — the Arena/Arlina
  // mistake again: a string test cannot outrank the org's own catalogue.
  const codes = new Set(["QZ-ASTRALMISTKREOSTRAIL2-20"]);
  assert.equal(hasProductAtAnyThickness("Astral Mist Kreos Trail-2", codes), true);
  assert.equal(isNotSellable("Astral Mist Kreos Trail-2", "Astral Mist Kreos Trail-2", codes), false);
  // ...while a trial batch of a real design resolves to no product of its own
  assert.equal(isNotSellable("Pebbles Ice", "Pebble Ice - Trial", codes), true);
  // ...and the bucket itself is withheld whatever is passed
  assert.equal(isNotSellable("Trial", "Blue Kreos", codes), true);
});

test("the trial marker is a WORD, not a substring", () => {
  const none = new Set<string>();
  assert.equal(isNotSellable("Industrial", "Industrial", none), false, "Industrial ends in t-r-i-a-l");
  assert.equal(isNotSellable("Trialist", "Trialist", none), false);
  assert.equal(isNotSellable("Arva White", "Arva White trial", none), true);
  assert.equal(isNotSellable("Arva White", "Trail Arva White", none), true);
  assert.equal(isNotSellable("Arva White", "Arva White - Trial", none), true);
  assert.equal(isNotSellable("Arva White", "Arva White", none), false);
});

// ───────── Finish, grade and series on every slab row — their REPLY-10 ─────────
//
// Salesforce asked for Finish__c, Grade__c and Series__c on every ERP_Stock__c
// slab line, and asked whether ERP_Key__c must change. It must: QC writes
// polish_type and grade per SLAB, so one design at one thickness is routinely
// in the yard in several of each at once.

const ARVA_SPLIT: StockGroup[] = [
  { design: "Arva White", slabThickness: "2 cm", polishType: "Polish", grade: "A", available: 300 },
  { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "A", available: 50 },
  { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "B", available: 40 },
  { design: "Arva White", slabThickness: "2 cm", polishType: "Leather", grade: "A", available: 20 },
  { design: "Arva White", slabThickness: "2 cm", polishType: null, grade: null, available: 7 },
];

test("ONE LINE PER PRODUCT, ONE ROW PER FINISH AND GRADE — the product count does not move", () => {
  const out = buildStockLines(ARVA_SPLIT, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  assert.equal(out.lines.length, 1, "still one line: a product is a design at a thickness");
  assert.equal(out.lines[0]!.available, 417, "and its total is every slice added up");

  const rows = slabRows(out.lines[0]!, "01t1", "Aurora");
  assert.deepEqual(rows.map((r) => [r.key, r.available]), [
    ["SLAB|QZ-ARVAWHITE-20|-|-", 7],
    ["SLAB|QZ-ARVAWHITE-20|LEATHERED|A", 20],
    ["SLAB|QZ-ARVAWHITE-20|POLISHED|A", 350],
    ["SLAB|QZ-ARVAWHITE-20|POLISHED|B", 40],
  ]);
  assert.equal(rows.reduce((n, r) => n + r.available, 0), 417, "the rows add up to the line");

  // THE PRODUCT IS TOLD THE WHOLE LINE. productPayloads keys lines by code; had
  // the lines themselves been split, it would have kept only the last slice
  // and told Arva White 20 mm it had 40 slabs.
  const [p] = productPayloads(
    [{ id: "01t1", name: "Arva White", productCode: "QZ-ARVAWHITE-20", erpSku: null, isActive: true, family: "Quartz Slab" }],
    out.lines, CANONICALS, PRODUCT_CODES, "T",
  );
  assert.equal(p!.ERP_Available_Slabs__c, 417);
  assert.equal(p!.ERP_Match__c, "Matched");
});

test("each row carries its finish, grade and series, and blank stays blank", () => {
  const out = buildStockLines(ARVA_SPLIT, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const rows = slabRows(out.lines[0]!, "01t1", "Aurora");
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const a = byKey.get("SLAB|QZ-ARVAWHITE-20|POLISHED|A")!;
  assert.equal(a.fields.Finish__c, "Polished");
  assert.equal(a.fields.Grade__c, "A");
  assert.equal(a.fields.Series__c, "Aurora");
  assert.equal(a.name, "Arva White 20 mm · Polished · Grade A", "two rows a rep can tell apart");

  // "If a line genuinely has no grade, leave it blank." Not "-", not "N/A",
  // not a default — null, which the composite PATCH sends as a cleared field.
  const none = byKey.get("SLAB|QZ-ARVAWHITE-20|-|-")!;
  assert.equal(none.fields.Finish__c, null);
  assert.equal(none.fields.Grade__c, null);
  assert.equal(none.name, "Arva White 20 mm", "nothing invented in the name either");

  // Everything the line owns is on every slice.
  for (const r of rows) {
    assert.equal(r.fields.Design__c, "Arva White");
    assert.equal(r.fields.Thickness_mm__c, 20);
    assert.equal(r.fields.Product__c, "01t1");
    assert.equal(r.fields.Series__c, "Aurora");
    assert.equal(r.kind, "Slab");
    assert.equal(r.retired, false);
  }
});

test("'Polish' and 'Polished' are ONE row — the owner's word, as the sample rows already send it", () => {
  // The yard types both. Without folding, one shelf of stock would publish as
  // two lines under two keys, and a rep filtering on Polished would miss 300
  // slabs of it.
  assert.equal(finishValue("Polish"), "Polished");
  assert.equal(finishValue(" polished "), "Polished");
  assert.equal(finishValue("Honed"), "Matte");
  assert.equal(finishValue("Leather"), "Leathered");
  assert.equal(finishValue("Suede"), "Suede");
  // A spelling we do not recognise goes out EXACTLY as typed — never dropped,
  // never guessed onto one of the four.
  assert.equal(finishValue("Brushed Satin"), "Brushed Satin");
  assert.equal(finishValue("  Brushed   Satin "), "Brushed Satin", "whitespace only is tidied");
});

test("a trailing 'finish' is the word, not another finish — the three spellings production's dry run found", () => {
  assert.equal(finishValue("Leathered finish"), "Leathered", "3 rows that were a second value beside 43 of Leathered");
  assert.equal(finishValue("Polished Finish"), "Polished");
  assert.equal(finishValue("matte finish"), "Matte");
  // Not guessed: two finishes named, or none.
  assert.equal(finishValue("Leather polish"), "Leather polish");
  assert.equal(finishValue("No Polish"), "No Polish");
  assert.equal(finishValue("Finish"), "Finish", "the bare word is not a finish");
  assert.equal(finishValue("Brushed Satin finish"), "Brushed Satin finish", "an unknown finish keeps its whole spelling");
});

test("a grade is sent as the yard wrote it; nothing, or a dash, is blank", () => {
  assert.equal(gradeValue("A2"), "A2");
  assert.equal(gradeValue(" Printing "), "Printing");
  assert.equal(gradeValue("CTS"), "CTS");
  // QC's own habits, undone the way QC's writes and dispatch undo them:
  // "Not graded yet" is no grade (never "Grade: Not graded yet"), and
  // "C (Reject)" is C — otherwise C would be two rows.
  assert.equal(gradeValue("Not graded yet"), null);
  assert.equal(gradeValue("not graded"), null);
  assert.equal(gradeValue("C (Reject)"), "C");
  assert.equal(gradeValue("  C  (reject) "), "C");
  for (const nothing of [null, undefined, "", "   ", "-", "--", "—", "."]) {
    assert.equal(gradeValue(nothing), null, `${JSON.stringify(nothing)} is not a grade`);
    assert.equal(finishValue(nothing), null, `${JSON.stringify(nothing)} is not a finish`);
  }
});

test("case variants of a grade are one row, and the spelling behind MORE slabs is sent", () => {
  const out = buildStockLines([
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "Printing", available: 40 },
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "PRINTING", available: 3 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const rows = slabRows(out.lines[0]!, null);
  assert.equal(rows.length, 1, "one key — so never two rows fighting over one record");
  assert.equal(rows[0]!.key, "SLAB|QZ-ARVAWHITE-20|POLISHED|PRINTING");
  assert.equal(rows[0]!.available, 43);
  assert.equal(rows[0]!.fields.Grade__c, "Printing");
});

test("THE SPELLING SENT DOES NOT DEPEND ON THE ORDER POSTGRES RETURNED ROWS IN", () => {
  // A value that flipped between runs would change the row's hash and re-push
  // it every time. Tied counts break alphabetically, whatever order they came.
  const groups: StockGroup[] = [
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "b", available: 5 },
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "B", available: 5 },
  ];
  const one = slabRows(buildStockLines(groups, NO_ALIASES, CANONICALS, PRODUCT_CODES).lines[0]!, null);
  const two = slabRows(buildStockLines([...groups].reverse(), NO_ALIASES, CANONICALS, PRODUCT_CODES).lines[0]!, null);
  assert.deepEqual(one, two);
  assert.equal(payloadHash(one[0]!), payloadHash(two[0]!));
});

test("the key has four segments, always, and no value can break it", () => {
  assert.equal(slabKey("QZ-ARVAWHITE-20", "Polished", "A"), "SLAB|QZ-ARVAWHITE-20|POLISHED|A");
  assert.equal(slabKey("QZ-ARVAWHITE-20", null, null), "SLAB|QZ-ARVAWHITE-20|-|-");
  assert.equal(slabKey("QZ-ARVAWHITE-20", "Brushed Satin", "A+"), "SLAB|QZ-ARVAWHITE-20|BRUSHED_SATIN|A+");
  // A "|" typed into a grade must not become a fifth segment.
  assert.equal(slabKey("QZ-X-20", "Polished", "A|B"), "SLAB|QZ-X-20|POLISHED|A/B");
  assert.equal(keySegment("   "), "-");
  for (const k of [
    slabKey("QZ-ARVAWHITE-20", "Polished", "A"),
    slabKey("QZ-X-20", "Polished", "A|B"),
    slabKey("QZ-X-20", null, null),
  ]) {
    assert.equal(k.split("|").length, 4, k);
    assert.ok(parseSlabKey(k), k);
  }
  assert.deepEqual(parseSlabKey("SLAB|QZ-ARVAWHITE-20|POLISHED|A"), { code: "QZ-ARVAWHITE-20", finish: "POLISHED", grade: "A" });
});

test("both key shapes resolve by their CODE — the shape is the planner's business, not this rule's", () => {
  const lineCodes = new Set(["QZ-ARVAWHITE-20"]);
  assert.deepEqual(slabKeyCode("SLAB|QZ-ARVAWHITE-20"), { shape: "legacy", code: "QZ-ARVAWHITE-20" });
  assert.deepEqual(slabKeyCode("SLAB|QZ-ARVAWHITE-20|POLISHED|A"), { shape: "split", code: "QZ-ARVAWHITE-20" });
  assert.equal(slabKeyCode("SLAB|QZ-X-20|POLISHED"), null, "three segments is neither shape");
  assert.equal(slabKeyCode("SAMPLE|ss1"), null);
  assert.equal(parseSlabKey("SLAB|QZ-ARVAWHITE-20"), null, "the old shape is not a split key");

  // A code with stock resolves, in either shape.
  assert.equal(slabKeyStillResolves("SLAB|QZ-ARVAWHITE-20", lineCodes, new Set()), true);
  assert.equal(slabKeyStillResolves("SLAB|QZ-ARVAWHITE-20|POLISHED|B", lineCodes, new Set()), true);
  // A code with a product and no stock resolves — SOLD OUT, stays searchable.
  assert.equal(slabKeyStillResolves("SLAB|QZ-SAKURA-20", new Set(), PRODUCT_CODES), true);
  // Neither: a design merged away. Retired, in either shape.
  assert.equal(slabKeyStillResolves("SLAB|QZ-ASTALMIST-20", lineCodes, PRODUCT_CODES), false);
  assert.equal(slabKeyStillResolves("SLAB|QZ-ASTALMIST-20|POLISHED|A", lineCodes, PRODUCT_CODES), false);
  // Not a slab key: not this rule's business.
  assert.equal(slabKeyStillResolves("SAMPLE|ss1", lineCodes, PRODUCT_CODES), true);
  assert.equal(slabKeyStillResolves("UNIT|sut_floor_stand", lineCodes, PRODUCT_CODES), true);
});

// The first switch-over run, as planTransition sees it: Arva White 20 mm splits
// into four rows (7 + 20 + 350 + 40 = 417) and the legacy row is in the mirror.
const arvaSwitch = () => {
  const out = buildStockLines(ARVA_SPLIT, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  return slabRows(out.lines[0]!, "01t1", "Aurora");
};
const LEGACY_ARVA = "SLAB|QZ-ARVAWHITE-20";

test("THE DISASTER CASE: every replacement refused leaves the old row LIVE AND CORRECT — never zero, never retired", () => {
  // The first version retired every legacy row in the same call that created
  // the split rows; a refusal of only the new rows (Grade__c created that
  // morning and not granted) let every retirement through, and Salesforce showed
  // no slab stock at all.
  const desired = arvaSwitch();
  const plan = planTransition([LEGACY_ARVA], desired, new Set([LEGACY_ARVA]));
  assert.deepEqual(plan.retire, [], "not retired");
  assert.deepEqual(plan.hold, []);
  assert.deepEqual(plan.keep, []);
  assert.equal(plan.remainder.length, 1);
  const r = plan.remainder[0]!;
  // BYTE-IDENTICAL TO TODAY'S ROW: the whole line, the same name, design,
  // thickness and product — so a blanket refusal costs no extra write and a rep
  // sees nothing change. (An earlier version sent a count-only patch, and a
  // product created during the switch-over never reached the row.)
  const out = buildStockLines(ARVA_SPLIT, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const today = slabRows(out.lines[0]!, "01t1", "Aurora", false)[0]!;
  assert.deepEqual(r, today);
  assert.equal(payloadHash(r), payloadHash(today));
});

test("PARTIAL ACCEPTANCE: the old row carries EXACTLY the refused slices — nothing lost, nothing counted twice", () => {
  // The second version retired the old row once ANY replacement was accepted,
  // so with Polished A accepted and Polished B refused, Polished B's 40 slabs
  // vanished from Salesforce.
  const desired = arvaSwitch();
  const polishedA = "SLAB|QZ-ARVAWHITE-20|POLISHED|A";
  const leathered = "SLAB|QZ-ARVAWHITE-20|LEATHERED|A";
  const present = new Set([LEGACY_ARVA, polishedA, leathered]);
  const plan = planTransition([LEGACY_ARVA], desired, present);
  assert.deepEqual(plan.retire, [], "not every replacement is there, so not retired");
  assert.equal(plan.remainder[0]!.available, 40 + 7, "Polished B (40) and the blank slice (7) are still on the old row");
  assert.equal(plan.remainder[0]!.name, "Arva White 20 mm", "still the whole legacy row, just a smaller count");
  assert.equal(plan.remainder[0]!.fields.Product__c, "01t1", "with its product kept current");

  // THE INVARIANT: what Salesforce shows for the code is exactly the line.
  const shown = desired.filter((r) => present.has(r.key)).reduce((n, r) => n + r.available, 0) + plan.remainder[0]!.available;
  assert.equal(shown, 417);
});

test("every replacement accepted retires the old row — once, zero, Name left alone", () => {
  const desired = arvaSwitch();
  const present = new Set([LEGACY_ARVA, ...desired.map((r) => r.key)]);
  const plan = planTransition([LEGACY_ARVA], desired, present);
  assert.deepEqual(plan, { retire: [LEGACY_ARVA], remainder: [], hold: [], keep: [] });
  const r = retirementRow(LEGACY_ARVA);
  assert.deepEqual([r.kind, r.name, r.available, r.retired, r.fields], ["Slab", null, 0, true, {}]);
});

test("a sold-out split slice still counts as a replacement that must be accepted before retiring", () => {
  // A zero row is a real row in Salesforce ("none right now"); retiring the old
  // row before it exists would be retiring a line's only searchable row.
  const desired: StockRow[] = [
    ...slabRows({ canonical: "Sakura", mm: 20, code: "QZ-SAKURA-20", available: 0,
      splits: [{ finish: "Polished", grade: "A", available: 0 }] } as never, "01t2"),
  ];
  const plan = planTransition(["SLAB|QZ-SAKURA-20"], desired, new Set(["SLAB|QZ-SAKURA-20"]));
  assert.deepEqual(plan.remainder.map((r) => [r.key, r.available]), [["SLAB|QZ-SAKURA-20", 0]]);
  assert.deepEqual(plan.retire, []);
});

test("A PRODUCT SOLD OUT AT THE SWITCH keeps its searchable zero row — the split must not delete 'none right now'", () => {
  // Sakura has a product and no stock: no split row can be created for it.
  const plan = planTransition(["SLAB|QZ-SAKURA-20"], arvaSwitch(), new Set(["SLAB|QZ-SAKURA-20"]));
  assert.deepEqual(plan, { retire: [], remainder: [], hold: [], keep: ["SLAB|QZ-SAKURA-20"] });
  // KEEP goes through the ordinary diff: a product still sold is a live zero.
  const mirror = new Map<string, MirrorEntry>([["SLAB|QZ-SAKURA-20", { key: "SLAB|QZ-SAKURA-20", payloadHash: "had stock" }]]);
  const d = diffMirror([], mirror, (k) => slabKeyStillResolves(k, new Set(["QZ-ARVAWHITE-20"]), PRODUCT_CODES));
  assert.deepEqual(d.toPush.map((r) => [r.key, r.available, r.retired]), [["SLAB|QZ-SAKURA-20", 0, false]]);
  assert.equal(d.toRetire.length, 0);
  // A design merged away with no product is still retired, as it always was.
  const gone = diffMirror([], new Map([["SLAB|QZ-ASTALMIST-20", { key: "SLAB|QZ-ASTALMIST-20", payloadHash: "x" }]]),
    (k) => slabKeyStillResolves(k, new Set(), PRODUCT_CODES));
  assert.deepEqual(gone.toRetire.map((r) => r.key), ["SLAB|QZ-ASTALMIST-20"]);
});

test("switching BACK holds the split rows until the FULL legacy row is verified — a mirrored remainder is not proof", () => {
  // SF_SLAB_SPLIT unset after it was set. A remainder cannot be divided between
  // SEVERAL old rows, so they are held rather than guessed at.
  const legacy = slabRows({ canonical: "Arva White", mm: 20, code: "QZ-ARVAWHITE-20", available: 8 } as never, "01t1", null, false);
  const splitKeys = ["SLAB|QZ-ARVAWHITE-20|POLISHED|A", "SLAB|QZ-ARVAWHITE-20|POLISHED|B"];
  assert.deepEqual(planTransition(splitKeys, legacy, new Set(splitKeys)),
    { retire: [], remainder: [], hold: splitKeys, keep: [] });

  // THE THIRD REVIEW'S CASE. The forward switch-over left the legacy key in the
  // mirror carrying a REMAINDER of 3 (Polished B refused). Switching back, this
  // run's full legacy write (8) is refused. The key is "present" — but only as
  // the 3. Retiring the split rows against it would leave Salesforce showing 3
  // of 8. Verified presence (same payload, or accepted this run) is required.
  const mirror = new Map([[LEGACY_ARVA, { payloadHash: payloadHash({ ...legacy[0]!, available: 3 }) }]]);
  const present = new Set([...splitKeys, LEGACY_ARVA]);
  const verified = verifiedKeys(legacy, mirror, new Set());
  assert.equal(verified.has(LEGACY_ARVA), false, "the mirror holds a different payload");
  assert.deepEqual(planTransition(splitKeys, legacy, present, verified).hold, splitKeys, "held, not retired");

  // Once the full legacy row is accepted, the split rows are retired.
  const accepted = verifiedKeys(legacy, mirror, new Set([LEGACY_ARVA]));
  assert.deepEqual(planTransition(splitKeys, legacy, present, accepted).retire, splitKeys);
  // And a mirror that already holds the full row counts too.
  const same = new Map([[LEGACY_ARVA, { payloadHash: payloadHash(legacy[0]!) }]]);
  assert.deepEqual(planTransition(splitKeys, legacy, present, verifiedKeys(legacy, same, new Set())).retire, splitKeys);
});

test("the probe gate opens on the first row of the current shape Salesforce has ever accepted", () => {
  assert.equal(shapeEverAccepted(["SLAB|QZ-ARVAWHITE-20", "SAMPLE|ss1"], "split"), false);
  assert.equal(shapeEverAccepted(["SLAB|QZ-ARVAWHITE-20", "SLAB|QZ-SAKURA-20|POLISHED|A"], "split"), true);
  assert.equal(shapeEverAccepted(["SLAB|QZ-ARVAWHITE-20"], "legacy"), true);
  assert.equal(shapeEverAccepted([], "legacy"), false);
});

test("THE PROBE: until the shape has ever been accepted, only the first 200 NEW rows go out — nothing else waits", () => {
  const newRows = Array.from({ length: 450 }, (_, i) => ({
    key: `SLAB|QZ-D${i}-20|POLISHED|A`, kind: "Slab" as const, name: `D${i}`, available: 1, retired: false, fields: {},
  }));
  const others: StockRow[] = [
    { key: "SAMPLE|ss1", kind: "Sample", name: "s", available: 2, retired: false, fields: {} },
    { key: "SLAB|QZ-OLD-20", kind: "Slab", name: null, available: 0, retired: true, fields: {} },
  ];
  const rows = [...others, ...newRows];

  const cold = probeWave(rows, new Set(["SLAB|QZ-OLD-20", "SAMPLE|ss1"]), "split", 200);
  assert.equal(cold.probe.length, 200);
  assert.equal(cold.heldBack.length, 250);
  assert.ok(cold.firstWave.some((r) => r.key === "SAMPLE|ss1"), "samples are never held back");
  assert.ok(cold.firstWave.some((r) => r.key === "SLAB|QZ-OLD-20"), "nor retirements");
  assert.equal(cold.firstWave.length + cold.heldBack.length, rows.length, "nothing dropped");

  // Once a single split row has been accepted, nothing is held back again —
  // the probe guards the switch, not every run.
  const warm = probeWave(rows, new Set(["SLAB|QZ-D0-20|POLISHED|A"]), "split", 200);
  assert.equal(warm.heldBack.length, 0);
  assert.equal(warm.firstWave.length, rows.length);
});

test("a remainder is re-sent when its count changes or it is due a re-stamp — and not otherwise", () => {
  const r = { key: LEGACY_ARVA, kind: "Slab" as const, name: "Arva White 20 mm", available: 47, retired: false, fields: {} };
  const cutoff = new Date("2026-09-23T10:00:00Z");
  const fresh = new Date("2026-09-23T10:20:00Z");
  const old = new Date("2026-09-23T09:00:00Z");
  assert.deepEqual(remaindersDue([r], new Map([[LEGACY_ARVA, { payloadHash: payloadHash(r), pushedAt: fresh }]]), cutoff), [], "unchanged and fresh: free");
  assert.equal(remaindersDue([r], new Map([[LEGACY_ARVA, { payloadHash: "other", pushedAt: fresh }]]), cutoff).length, 1, "changed");
  assert.equal(remaindersDue([r], new Map([[LEGACY_ARVA, { payloadHash: payloadHash(r), pushedAt: old }]]), cutoff).length, 1,
    "stale: re-stamped, so the row carrying the stock never reads Stale__c");
  assert.equal(remaindersDue([r], new Map(), cutoff).length, 1, "never sent");
});

test("the yard's groups: unapproved subtracted per group, and CUT GRADES OUT BY DISPATCH'S OWN RULE", () => {
  const out = yardGroups([
    { design: "Arva White", slab_thickness: "2 cm", polish_type: "Polish", grade: "A", n: 10, hidden: 3 },
    { design: "Arva White", slab_thickness: "2 cm", polish_type: "Polish", grade: "B", n: 4, hidden: 4 },
    // Each of these is refused at dispatch, so none may be promised to a rep.
    // The SQL version compared upper(btrim(grade)) and let the last two through.
    { design: "Arva White", slab_thickness: "2 cm", polish_type: "Polish", grade: "CTS", n: 2, hidden: 0 },
    { design: "Arva White", slab_thickness: "2 cm", polish_type: "Polish", grade: "cts", n: 1, hidden: 0 },
    { design: "Arva White", slab_thickness: "2 cm", polish_type: "Polish", grade: "CTS (Reject)", n: 5, hidden: 1 },
    { design: "Arva White", slab_thickness: "2 cm", polish_type: "Polish", grade: "\tSAMPLE\n", n: 6, hidden: 0 },
    { design: null, slab_thickness: null, polish_type: null, grade: null, n: 2, hidden: 9 },
  ]);
  assert.deepEqual(out.groups.map((g) => [g.grade, g.available]), [["A", 7]],
    "B is wholly unapproved; the null group's hidden is clamped to what it holds; four cut grades out");
  assert.equal(out.raw, 30, "raw is before either filter");
  assert.equal(out.cutGradeExcluded, 14);
  assert.equal(out.hidden, 3 + 4 + 2, "unapproved among the slabs not already excluded as cut");
  assert.equal(out.raw - out.hidden - out.cutGradeExcluded, 7, "and what is left is exactly what is published");
});

test("SWITCH OFF WRITES EXACTLY TODAY'S ROW — same key, name, fields, hash — so deploying is not migrating", () => {
  // payloadHash hashes every field NAME, so even Finish__c: null would change
  // every row's hash and re-push the whole object before anyone said go.
  const out = buildStockLines(ARVA_SPLIT, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const rows = slabRows(out.lines[0]!, "01t1", "Aurora", false);
  const before: StockRow = {
    key: "SLAB|QZ-ARVAWHITE-20",
    kind: "Slab",
    name: "Arva White 20 mm",
    available: 417,
    retired: false,
    fields: { Design__c: "Arva White", Thickness_mm__c: 20, Product__c: "01t1", Product_Missing__c: false },
  };
  assert.deepEqual(rows, [before]);
  assert.equal(payloadHash(rows[0]!), payloadHash(before), "no re-push on deploy");
});

test("the unmapped worklist is still ONE entry per spelling, however many finishes it is in", () => {
  const out = buildStockLines([
    { design: "Astal Mist", slabThickness: "2 cm", polishType: "Polished", grade: "A", available: 10 },
    { design: "Astal Mist", slabThickness: "2 cm", polishType: "Suede", grade: "B", available: 8 },
    { design: "Arva White", slabThickness: "3 cm to 2 cm", polishType: "Polished", grade: "A", available: 7 },
    { design: "Arva White", slabThickness: "3 cm to 2 cm", polishType: "Leather", grade: null, available: 5 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  assert.deepEqual(out.unmapped.map((u) => [u.design, u.slabThickness, u.reason, u.available]), [
    ["Astal Mist", "2 cm", "UNKNOWN_DESIGN", 18],
    ["Arva White", "3 cm to 2 cm", "THICKNESS", 12],
  ]);
  // Still published as its two slices — the rep sees the stock either way.
  assert.equal(slabRows(out.lines[0]!, null).length, 2);
});

test("the summary counts ROWS beside lines, and says how many went out blank", () => {
  const result = buildStockLines(ARVA_SPLIT, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const s = summarise(result, [], PRODUCT_CODES);
  assert.equal(s.publishedLines, 1, "product codes");
  assert.equal(s.slabRows, 4, "what Salesforce will count");
  assert.equal(s.slabRowsWithoutFinish, 1);
  assert.equal(s.slabRowsWithoutGrade, 1);
  assert.equal(s.publishedSlabs, 417, "and the slab total is not changed by splitting it");

  // A caller that never reads polish or grade still gets one row per line.
  const flat = buildStockLines([{ design: "Arva White", slabThickness: "2 cm", available: 9 }], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  assert.equal(summarise(flat, [], PRODUCT_CODES).slabRows, 1);
  assert.equal(slabRows(flat.lines[0]!, null).length, 1);
});

test("series comes off the colour chart, folded like a design, and ambiguity gives no answer", () => {
  const idx = seriesIndex([
    { name: "Arva White", series: { name: "Aurora" } },
    { name: "Pebble Ice", series: { name: "Nebula" } },
    { name: "Cappuccino", series: { name: "Solid" } },
    // Two chart names that fold together but sit in different series.
    { name: "Star Dust", series: { name: "Celestia" } },
    { name: "Stardust", series: { name: "Kosmic" } },
    { name: "Nameless", series: null },
  ]);
  assert.equal(seriesFor("Arva White", idx), "Aurora");
  assert.equal(seriesFor("Pebble ice", idx), "Nebula", "the yard's case does not matter");
  assert.equal(seriesFor("ARVA  WHITE", idx), "Aurora");
  assert.equal(seriesFor("Star Dust", idx), null, "ambiguous: blank, not a coin toss");
  assert.equal(seriesFor("Nameless", idx), null);
  assert.equal(seriesFor("Not On The Chart", idx), null, "a design the chart does not list is blank");

  // Order-independent, for the same reason as the grade spelling.
  const rev = seriesIndex([
    { name: "Stardust", series: { name: "Kosmic" } },
    { name: "Star Dust", series: { name: "Celestia" } },
  ]);
  assert.equal(seriesFor("Star Dust", rev), null);
});

test("the org's field caps: ERP_Key__c 80, Grade__c 40, Name 80 — longer and the row is refused on every run", () => {
  // The longest code in the org today and the admin route's 30-character limit
  // on polish and grade — a valid yard value that would have produced a 94-char key.
  const code = "QZ-BIANCOCARRARALONGVEIN-30";
  const longest = slabKey(code, "L".repeat(30), "G".repeat(30));
  assert.ok(longest.length <= ERP_KEY_MAX, `${longest.length} > ${ERP_KEY_MAX}`);
  assert.equal(slabKeyCode(longest)?.code, code, "the code survives intact — the sold-out rule reads it");
  // Two long grades sharing a prefix stay TWO keys: truncation would merge them.
  assert.notEqual(slabKey(code, "Polished", "X".repeat(29) + "1"), slabKey(code, "Polished", "X".repeat(29) + "2"));
  // Deterministic, or the row would twin itself on the next run.
  assert.equal(slabKey(code, "L".repeat(30), "G".repeat(30)), longest);
  // A key that fits is never touched.
  assert.equal(slabKey("QZ-ARVAWHITE-20", "Polished", "A"), "SLAB|QZ-ARVAWHITE-20|POLISHED|A");
  // A product code long enough that two 16-character segments do not fit: the
  // segments become their hash alone, and every code up to 55 characters fits:
  // 5 + code + 1 + 9 + 1 + 9 = code + 25.
  for (const len of [42, 50, 55]) {
    const longCode = `QZ-${"A".repeat(len - 6)}-30`;
    assert.equal(longCode.length, len);
    const k = slabKey(longCode, "Leathered", "Printing");
    assert.ok(k.length <= ERP_KEY_MAX, `${len}-char code gave a ${k.length}-char key`);
    assert.equal(slabKeyCode(k)?.code, longCode, "the code is never shortened");
    assert.notEqual(k, slabKey(longCode, "Leathered", "A"), "and two grades are still two keys");
  }
  assert.equal(slabKey(`QZ-${"A".repeat(40)}-30`, null, null).endsWith("|-|-"), true, "no value stays '-'");

  const long = "X".repeat(60);
  const out = buildStockLines([
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: long, available: 1 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const [r] = slabRows(out.lines[0]!, null, "Aurora");
  assert.ok(r!.key.length <= ERP_KEY_MAX);
  assert.ok(String(r!.fields.Grade__c).length <= GRADE_MAX);
  assert.ok(String(r!.name).length <= NAME_MAX);
  assert.equal(clampTo(null, 40), null, "blank stays blank");
  assert.equal(clampTo("A", 40), "A");
  assert.equal(slabName("Arva White", 20, null, "A"), "Arva White 20 mm · Grade A");
});

test("A LINE'S NAME DOES NOT DEPEND ON WHICH SPELLING POSTGRES RETURNED FIRST", () => {
  // "Arva White" and "arva white" fold to one code. The line used to be named by
  // whichever group came first — no promised order, and with the yard read per
  // finish and grade there are more groups to come first — so Name and Design__c
  // of every slice would flip between runs and re-push. Most slabs wins.
  const groups: StockGroup[] = [
    { design: "arva white", slabThickness: "2 cm", polishType: "Polished", grade: "B", available: 5 },
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "A", available: 300 },
  ];
  const a = buildStockLines(groups, NO_ALIASES, CANONICALS, PRODUCT_CODES).lines[0]!;
  const b = buildStockLines([...groups].reverse(), NO_ALIASES, CANONICALS, PRODUCT_CODES).lines[0]!;
  assert.equal(a.canonical, "Arva White");
  assert.equal(b.canonical, "Arva White");
  assert.deepEqual(slabRows(a, "01t1", "Aurora"), slabRows(b, "01t1", "Aurora"));
});

test("series is found through the ALIAS VARIANTS when the chart spells a design differently", () => {
  // The chart says "Pebbles Ice"; the ERP's canonical is "Pebble Ice". The
  // alias table is the ERP's own record that the two are one design.
  const idx = seriesIndex([
    { name: "Pebbles Ice", series: { name: "Aurora" } },
    { name: "Classic Gray", series: { name: "Aurora" } },
    { name: "Oasis", series: { name: "Nebula" } },
  ]);
  assert.equal(seriesFor("Pebble Ice", idx), null, "the canonical alone misses");
  assert.equal(seriesFor("Pebble Ice", idx, ["Pebbles Ice", "pebble ice "]), "Aurora", "a variant finds it");
  // Variants landing in DIFFERENT series give nothing, not the first looked up.
  assert.equal(seriesFor("Pebble Ice", idx, ["Pebbles Ice", "Oasis"]), null);
  // A design on no chart under any name: blank, honestly.
  assert.equal(seriesFor("Carrara Cloud", idx, ["carrara cloud"]), null);
});

test("THE DESIGN'S OWN CHART ENTRY WINS over its alias spellings — Brilliant White, from the first dry run", () => {
  // Production, 2026-09-23: the alias table maps "Ultima White" onto "Brilliant
  // White"; the chart lists Brilliant White in Solids and Ultima White, a colour
  // of its own, in Aurora. Weighing them equally sent 349 slabs out blank.
  const idx = seriesIndex([
    { name: "Brilliant White", series: { name: "Solids" } },
    { name: "Ultima White", series: { name: "Aurora" } },
    { name: "Star Dust", series: { name: "Celestia" } },
    { name: "Stardust", series: { name: "Kosmic" } },
  ]);
  assert.equal(seriesFor("Brilliant White", idx, ["Ultima White", "Ultimate White", "Brilliant White/Ultima White"]), "Solids");
  // A name the chart itself lists ambiguously stays blank — no alias breaks the tie.
  assert.equal(seriesFor("Star Dust", idx, ["Brilliant White"]), null);
});

test("seriesIndex ambiguity survives a THIRD colour folding onto the same key, in any order", () => {
  const three = [
    { name: "Star Dust", series: { name: "Celestia" } },
    { name: "Stardust", series: { name: "Kosmic" } },
    { name: "STAR-DUST", series: { name: "Celestia" } },
  ];
  for (const order of [three, [...three].reverse(), [three[1]!, three[2]!, three[0]!]]) {
    assert.equal(seriesFor("Star Dust", seriesIndex(order)), null, "once ambiguous, never re-admitted");
  }
  // Agreement is not ambiguity: two spellings in the SAME series still answer.
  assert.equal(seriesFor("Star Dust", seriesIndex([three[0]!, three[2]!])), "Celestia");
});

test("the blank counts can tell a missing FINISH from a missing GRADE", () => {
  const result = buildStockLines([
    { design: "Arva White", slabThickness: "2 cm", polishType: null, grade: "A", available: 4 },
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: null, available: 3 },
    { design: "Arva White", slabThickness: "2 cm", polishType: "Suede", grade: "Not graded yet", available: 2 },
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "A", available: 1 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const s = summarise(result, [], PRODUCT_CODES);
  assert.equal(s.slabRows, 4);
  assert.equal(s.slabRowsWithoutFinish, 1);
  assert.equal(s.slabRowsWithoutGrade, 2, "a null grade and a 'Not graded yet' are both blank");
});

test("A CHUNK THAT FAILS LATER DOES NOT ERASE THE RECORD OF THE CHUNKS ALREADY COMMITTED", async () => {
  // compositePatch loops its own chunks and throws on the first bad one,
  // discarding the answers to chunks Salesforce had already committed. Those
  // rows were live and unmirrored; one that then sold out was never touched
  // again — a phantom, counting stock that is gone, for good.
  const rows = Array.from({ length: 5 }, (_, i) => ({ key: `SLAB|QZ-D${i}-20|-|-`, kind: "Slab" as const, name: `D${i}`, available: 1, retired: false, fields: {} }));
  const recorded: string[] = [];
  let calls = 0;
  await assert.rejects(
    sendChunks(rows, 2,
      async (chunk) => { calls += 1; if (calls === 3) throw new Error("socket hang up"); return chunk.map(() => ({ success: true })); },
      async (chunk, answers) => { chunk.forEach((r, i) => { if (answers[i]!.success) recorded.push(r.key); }); },
      () => null),
    /socket hang up/,
  );
  assert.deepEqual(recorded, rows.slice(0, 4).map((r) => r.key), "the two committed chunks were recorded before the third failed");
});

test("a REQUEST-LEVEL refusal refuses that chunk's rows and the run carries on", async () => {
  // A field hidden from the integration user is refused for the whole request,
  // not row by row — that is how a missing Grade__c permission arrives.
  const rows = Array.from({ length: 6 }, (_, i) => ({ key: `K${i}`, kind: "Slab" as const, name: null, available: 0, retired: false, fields: {} }));
  const answered: Array<[string, boolean, string]> = [];
  let calls = 0;
  await sendChunks(rows, 2,
    async (chunk) => { calls += 1; if (calls === 2) throw Object.assign(new Error("No such column 'Grade__c'"), { status: 400 }); return chunk.map(() => ({ success: true })); },
    async (chunk, answers) => { chunk.forEach((r, i) => answered.push([r.key, answers[i]!.success, answers[i]!.errors?.[0]?.message ?? ""])); },
    (e) => ((e as { status?: number }).status === 400 ? (e as Error).message : null));
  assert.equal(calls, 3, "the third chunk is still sent");
  assert.deepEqual(answered.map(([k, ok]) => [k, ok]), [["K0", true], ["K1", true], ["K2", false], ["K3", false], ["K4", true], ["K5", true]]);
  assert.match(answered[2]![2], /Grade__c/, "and each refused row carries the reason");
});

test("rows carrying Grade__c are written in chunks of their own, so a missing permission costs nothing else", () => {
  const out = buildStockLines(ARVA_SPLIT, NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const split = slabRows(out.lines[0]!, "01t1", "Aurora");
  const legacy = slabRows(out.lines[0]!, "01t1", null, false);
  const sample = sampleRow("ss1", "Cappuccino (Polished) 4 × 4 in · 20 mm", 3, { Series__c: "Aurora", Finish__c: "Polished" });
  const retire = retirementRow("SLAB|QZ-SAKURA-20");
  const { plain, withGrade } = partitionByNewField([...split, ...legacy, sample, retire]);
  assert.deepEqual(withGrade.map((r) => r.key), split.map((r) => r.key));
  assert.deepEqual(plain.map((r) => r.key).sort(), [legacy[0]!.key, sample.key, retire.key].sort(),
    "samples, the legacy row and retirements never share a chunk with Grade__c");
});

test("the caps are the ones Salesforce CORRECTED in REPLY-17: Finish 40, Grade 40, Series 60", () => {
  // REPLY-10 said 255 for Finish__c and Series__c. A value between 41 and 255
  // characters would then have been sent whole and refused — Salesforce rejects
  // an over-length value rather than truncating it.
  assert.equal(FINISH_MAX, 40);
  assert.equal(GRADE_MAX, 40);
  assert.equal(SERIES_MAX, 60);
  const longFinish = "Brushed Satin With A Hand Typed Note That Runs On";   // 49, unrecognised: sent as typed
  const out = buildStockLines([
    { design: "Arva White", slabThickness: "2 cm", polishType: longFinish, grade: "A", available: 2 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const [r] = slabRows(out.lines[0]!, null, "S".repeat(70));
  assert.ok(String(r!.fields.Finish__c).length <= 40, "never over the field, so never refused");
  assert.ok(String(r!.fields.Series__c).length <= 60);
  assert.ok(r!.key.includes(keySegment(longFinish).slice(0, 7)), "the key is built from the full value, not the clamped one");
});

test("the split, measured — the figures Salesforce asked for before the go-ahead", () => {
  const out = buildStockLines([
    ...ARVA_SPLIT,
    { design: "Arva White", slabThickness: "3 cm", polishType: "Polish", grade: "Printing", available: 9 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const p = splitProfile(out.lines, (c) => (c === "Arva White" ? "Aurora" : null));
  assert.equal(p.rows, 5, "four slices of 20 mm and one of 30 mm");
  assert.equal(p.combos, 5, "POLISHED|A, POLISHED|B, LEATHERED|A, -|- and POLISHED|PRINTING");
  const grade = (v: string | null) => p.byGrade.find((g) => g.value === v);
  assert.deepEqual(grade("A"), { value: "A", rows: 2, slabs: 370 });
  assert.deepEqual(grade("Printing"), { value: "Printing", rows: 1, slabs: 9 }, "the number they asked for");
  assert.deepEqual(grade(null), { value: null, rows: 1, slabs: 7 }, "blank is counted, not dropped");
  assert.equal(p.byGrade[0]!.value, "A", "heaviest first");
  assert.equal(p.byFinish.reduce((n, f) => n + f.rows, 0), p.rows);
  assert.deepEqual(p.longest, {
    finish: "Leathered".length, grade: "Printing".length, series: "Aurora".length, design: "Arva White".length,
    name: "Arva White 30 mm · Polished · Grade Printing".length,
  });
  assert.deepEqual(p.overCap, { finish: 0, grade: 0, series: 0, name: 0 }, "nothing today would be clamped");

  // And when something would be, it is counted — the honest answer to "can a
  // finish or grade exceed 40 characters, or a name its 80".
  const long = buildStockLines([
    { design: "Arva White", slabThickness: "2 cm", polishType: "X".repeat(45), grade: "G".repeat(41), available: 1 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const q = splitProfile(long.lines);
  assert.deepEqual(q.overCap, { finish: 1, grade: 1, series: 0, name: 1 });
  assert.equal(q.longest.finish, 45);

  // A COMBINATION IS NOT A ROW. Polished A on two designs is two rows and one
  // combination — the fixture above, where every row happened to be a distinct
  // combination, could not tell the two apart.
  const shared = buildStockLines([
    { design: "Arva White", slabThickness: "2 cm", polishType: "Polished", grade: "A", available: 3 },
    { design: "Sakura", slabThickness: "2 cm", polishType: "Polish", grade: "A", available: 4 },
    { design: "Sakura", slabThickness: "2 cm", polishType: "Polished", grade: "B", available: 1 },
  ], NO_ALIASES, CANONICALS, PRODUCT_CODES);
  const r = splitProfile(shared.lines);
  assert.equal(r.rows, 3);
  assert.equal(r.combos, 2, "POLISHED|A and POLISHED|B");
});
