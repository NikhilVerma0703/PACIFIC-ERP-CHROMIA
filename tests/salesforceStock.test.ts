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
  isSellableProduct, SELLABLE_FAMILY,
  slabRow, sampleRow, finishRow, unitRow,
  type StockGroup, type ProductRow, type StockRow, type MirrorEntry,
} from "../src/lib/salesforce/stock-rules.ts";
import {
  WRITABLE_OBJECTS, READABLE_OBJECTS, mayWrite, mayDelete,
  REQUEST_WRITABLE_FIELDS, mayWriteRequestField, refusePackForApproval, isFieldServiceObject,
  mayApprove, forbiddenPath,
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

  assert.deepEqual(out.lines.map((l) => [l.code, l.available]), [["QZ-ASTRALMIST-20", 131]]);
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

test("the design is asked about BEFORE the thickness, so the fix named is the right one", () => {
  // A cut-down slab of a design nobody recognises is an UNKNOWN DESIGN, not a
  // thickness problem: correcting the thickness would still leave a name we
  // refuse to publish, and saying THICKNESS would send somebody to the wrong
  // screen entirely.
  const out = buildStockLines(
    [{ design: "Astal Mist", slabThickness: "3 cm to 2 cm", available: 5 }],
    NO_ALIASES, CANONICALS, PRODUCT_CODES,
  );
  assert.equal(out.unmapped[0]!.reason, "UNKNOWN_DESIGN");

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
  const row = slabRow(thirty, null);
  assert.equal(row.key, "SLAB|QZ-ARVAWHITE-30");
  assert.equal(row.name, "Arva White 30 mm", "what a rep actually types into search");
  assert.equal(row.fields.Product_Missing__c, true);
  assert.equal(slabRow(out.lines[0]!, "01t000000000001").fields.Product_Missing__c, false);
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
  const arva = slabRow({ canonical: "Arva White", mm: 20, code: "QZ-ARVAWHITE-20", available: 417 }, "01t1");
  const sakura = slabRow({ canonical: "Sakura", mm: 20, code: "QZ-SAKURA-20", available: 0 }, "01t2");

  const mirror = new Map<string, MirrorEntry>([
    [arva.key, { key: arva.key, payloadHash: payloadHash(arva) }],
    [sakura.key, { key: sakura.key, payloadHash: "stale" }],
    // A design an admin merged away since the last run.
    ["SLAB|QZ-ASTALMIST-20", { key: "SLAB|QZ-ASTALMIST-20", payloadHash: "whatever" }],
    // A shelf row that no longer exists.
    ["SAMPLE|gone", { key: "SAMPLE|gone", payloadHash: "whatever" }],
  ]);

  const stillResolves = (key: string) => key === "SLAB|QZ-ARVAWHITE-20" || key === "SLAB|QZ-SAKURA-20";
  const diff = diffMirror([arva, sakura], mirror, stillResolves);

  assert.equal(diff.unchanged, 1, "Arva White is identical and costs no API call");
  assert.deepEqual(diff.toPush.map((r) => r.key), ["SLAB|QZ-SAKURA-20"], "changed payload goes out");

  // The two that no longer mean anything are retired ONCE, and nothing is ever
  // deleted: a sample request line pointing at a retired row must still
  // resolve, and deleting it would break a record somebody is looking at.
  assert.deepEqual(diff.toRetire.map((r) => r.key).sort(), ["SAMPLE|gone", "SLAB|QZ-ASTALMIST-20"]);
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
  assert.equal(s.publishedSlabs, TWELVE.reduce((n, [, , c]) => n + c, 0) + 118);
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
  const arva = slabRow({ canonical: "Arva White", mm: 20, code: "QZ-ARVAWHITE-20", available: 0 }, "01t1");
  const first = diffMirror([], new Map([[arva.key, { key: arva.key, payloadHash: "something-else" }]]), () => true);
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
