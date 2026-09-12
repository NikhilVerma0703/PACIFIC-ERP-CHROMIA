// Round four, answers 2 and 3: one barcode per article, the customer's own
// series, and the label that fits the edge of a 2 cm slab.
//
// The numbers are the owner's own. `Desert Silk Crate BARCODE.docx` carries
// nine codes under GS1 prefix 8720847 with item references 17222 to 17232 —
// consecutive except for 17227, which is missing — and his article file carries
// 8720847172266 on BOTH 220x19.5x2 and 220x15x2, which is the duplicate that
// makes answer 2 necessary. Both appear below as they appear in his files, so a
// change that breaks his data breaks a test rather than a container.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  articleName, claimEan, barcodeBlockFor, planEanAllocation, parseEanSource,
  crateLabels, edgeLabelFor, edgeLabels, EDGE_LABEL_DEFAULTS, LABEL_KINDS, parseLabelKind,
  EAN_SOURCES, eanSourceForSave,
} from "../src/lib/commercial/articles-rules.ts";
import { edgeLabelLayout, ean13WidthMm } from "../src/lib/commercial/barcode.ts";
import { DEFAULT_SETTINGS } from "../src/lib/commercial/settings-defaults.ts";
import { leafIssue } from "../src/lib/commercial/settings-rules.ts";

/** His sheet, in order, with the gap at 17227 exactly where he left it. */
const HIS_CODES = [
  "8720847172228", "8720847172235", "8720847172242", "8720847172259",
  "8720847172266", "8720847172280", "8720847172303", "8720847172310",
  "8720847172327",
];
const PREFIX = "8720847";

const article = (over: Record<string, unknown> = {}) => ({
  id: "a1", design: "Desert Silk", itemCode: null as string | null,
  lengthCm: 220, widthCm: 19.5, thicknessCm: 2,
  ean: null as string | null, eanSource: null as string | null, eanBlockedReason: null as string | null,
  ...over,
});

// ───────────────────────── what a row is called ─────────────────────────────

test("articleName: the item code when there is one, the design and the SIZE when there is not", () => {
  assert.equal(articleName({ design: "Desert Silk", itemCode: "CQBE 220x19.5x2" }), "CQBE 220x19.5x2");
  // The item code without the size in it still prints the size: his collision
  // is between two sizes of one design, so a name without one names nothing.
  assert.equal(articleName({ design: "Desert Silk", itemCode: "CQBE", lengthCm: 220, widthCm: 15, thicknessCm: 2 }), "CQBE 220x15x2");
  assert.equal(articleName({ design: "Desert Silk", lengthCm: 220, widthCm: 19.5, thicknessCm: 2 }), "Desert Silk 220x19.5x2");
});

// ───────────────────── the duplicate, refused at entry ──────────────────────

test("claimEan refuses a code another article owns, and NAMES that article", () => {
  const claim = claimEan({
    ean: "8720847172266",
    self: { design: "Desert Silk", lengthCm: 220, widthCm: 15, thicknessCm: 2 },
    owner: { id: "a-first", label: "220x19.5x2" },
  });

  assert.equal(claim.refused, true);
  assert.match(claim.message ?? "", /8720847172266/);
  assert.match(claim.message ?? "", /220x19\.5x2/);
  assert.match(claim.message ?? "", /Desert Silk 220x15x2/);
  assert.match(claim.message ?? "", /before any barcode for this client is generated or printed/);

  // THE ROW IS STILL STORABLE. Answer 2 refuses the duplicate, not the article:
  // no code, no source, and the sentence in the column that stops the labels.
  assert.equal(claim.ean, null);
  assert.equal(claim.eanSource, null);
  assert.equal(claim.eanBlockedReason, claim.message);
});

test("claimEan: the row that already owns the code is not refused its own code", () => {
  const claim = claimEan({
    ean: "8720847172266",
    self: { id: "a-first", design: "Desert Silk", lengthCm: 220, widthCm: 19.5, thicknessCm: 2 },
    owner: { id: "a-first", label: "220x19.5x2" },
  });
  assert.equal(claim.refused, false);
  assert.equal(claim.ean, "8720847172266");
  assert.equal(claim.eanSource, "CUSTOMER");
});

test("claimEan: a code taken is a block cleared; an ordinary save keeps it; clearBlock clears it", () => {
  const stored = "8720847172266 is on both 220x19.5x2 and 220x15x2. One of them has to give it up before any barcode for this client is generated or printed.";
  const self = { id: "a2", design: "Desert Silk", lengthCm: 220, widthCm: 15, thicknessCm: 2 };

  const took = claimEan({ ean: "8720847172334", self, blockedReason: stored });
  assert.equal(took.ean, "8720847172334");
  assert.equal(took.eanBlockedReason, null);

  // Editing the notes of a blocked row does not settle the duplicate, so the
  // sentence — and the stop on this customer's labels — survives the save.
  const edited = claimEan({ ean: null, self, blockedReason: stored });
  assert.equal(edited.eanBlockedReason, stored);
  assert.equal(edited.refused, false);

  const settled = claimEan({ ean: null, self, blockedReason: stored, clearBlock: true });
  assert.equal(settled.eanBlockedReason, null);
});

test("claimEan: the source is the customer's unless the allocator says otherwise", () => {
  assert.equal(claimEan({ ean: HIS_CODES[0], self: {} }).eanSource, "CUSTOMER");
  assert.equal(claimEan({ ean: HIS_CODES[0], self: {}, source: "GENERATED" }).eanSource, "GENERATED");
  // A blank article has no source at all — the column says where a CODE came
  // from, and there is no code.
  assert.equal(claimEan({ ean: null, self: {} }).eanSource, null);
  assert.deepEqual([...EAN_SOURCES], ["CUSTOMER", "GENERATED"]);
  assert.equal(parseEanSource(" generated "), "GENERATED");
  assert.equal(parseEanSource("OURS"), null);
});

test("claimEan: a code the row already holds keeps the source it was stored with", () => {
  // The code our allocator minted for his 220x15x2, and the row it sits on.
  const OURS = "8720847172334";
  const self = { id: "a1", design: "Desert Silk", lengthCm: 220, widthCm: 15, thicknessCm: 2 };

  // An ordinary edit — somebody fixed a typo in the description — arrives
  // saying CUSTOMER, because the form has no field for the source and says
  // CUSTOMER with every save, and so does any caller that omits it. The code
  // did not change, so nothing has been learned about where it came from and
  // the row's own answer stands.
  const edited = claimEan({ ean: OURS, source: "CUSTOMER", self, prior: { ean: OURS, source: "GENERATED" } });
  assert.equal(edited.ean, OURS);
  assert.equal(edited.eanSource, "GENERATED");

  // The same code as it comes back off his sheet, with Excel's apostrophe and
  // the spaces of a code read aloud, is the same code and not a new one.
  const pasted = claimEan({ ean: OURS, source: "CUSTOMER", self, prior: { ean: "'8720847 17233 4", source: "GENERATED" } });
  assert.equal(pasted.eanSource, "GENERATED");

  // A DIFFERENT code typed over ours is new provenance, and the save's word
  // is what there is to go on: this one did come off the customer's file.
  const retyped = claimEan({ ean: HIS_CODES[0], source: "CUSTOMER", self, prior: { ean: OURS, source: "GENERATED" } });
  assert.equal(retyped.ean, HIS_CODES[0]);
  assert.equal(retyped.eanSource, "CUSTOMER");

  // A create has no prior at all, so there is nothing to preserve.
  assert.equal(claimEan({ ean: OURS, source: "CUSTOMER", self: {} }).eanSource, "CUSTOMER");
});

test("a generated code survives an edit as OURS, so the allocator keeps telling the truth about it", () => {
  const OURS = "8720847172334";
  const self = { id: "a1", design: "Desert Silk", lengthCm: 220, widthCm: 15, thicknessCm: 2 };
  const saved = claimEan({ ean: OURS, source: "CUSTOMER", self, prior: { ean: OURS, source: "GENERATED" } });

  // The sentence the allocator skips it with is the visible end of the same
  // column: relabelled CUSTOMER it would say the customer's own file sent us a
  // code we minted, which is the one thing eanSource is for.
  const plan = planEanAllocation({
    prefix: PREFIX,
    rows: [article({ id: "a1", ean: saved.ean, eanSource: saved.eanSource })],
  });
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, "Desert Silk 220x19.5x2 already carries 8720847172334.");
  assert.doesNotMatch(plan.skipped[0].reason, /customer's own file/);
});

test("eanSourceForSave: the row's own answer for a code it already held, the saver's for a new one", () => {
  const OURS = "8720847172334";
  const prior = { ean: OURS, source: "GENERATED" };

  // The claim loses to the record. Every entry form says CUSTOMER, because
  // that is what a code TYPED into a form is, and on an edit the code was not
  // typed — it was pre-filled out of the row a moment earlier.
  assert.equal(eanSourceForSave({ ean: OURS, prior }), "GENERATED");
  assert.equal(eanSourceForSave({ ean: OURS, prior, claimed: "CUSTOMER" }), "GENERATED");
  // Excel's apostrophe and the spaces of a code read aloud do not make it a
  // different code, so they do not make it a different provenance either.
  assert.equal(eanSourceForSave({ ean: OURS, prior: { ean: "'8720847 17233 4", source: "GENERATED" } }), "GENERATED");

  // A code that IS new to the row is the saver's to speak for, and one off the
  // customer's sheet is the only way a new code reaches this form.
  assert.equal(eanSourceForSave({ ean: HIS_CODES[0], prior }), "CUSTOMER");
  assert.equal(eanSourceForSave({ ean: OURS }), "CUSTOMER");
  // A row stored before the column existed has nothing recorded against its
  // code, so there is nothing to preserve and the old default stands.
  assert.equal(eanSourceForSave({ ean: OURS, prior: { ean: OURS, source: null } }), "CUSTOMER");
  // No code, no provenance: the column says where a CODE came from.
  assert.equal(eanSourceForSave({ ean: "", prior }), null);
});

// ─────────────── "don't generate barcodes till it's fixed" ───────────────────

test("barcodeBlockFor: a stored reason stops the customer, and the sentence names the articles", () => {
  const reason = "8720847172266 is on both 220x19.5x2 and 220x15x2. One of them has to give it up before any barcode for this client is generated or printed.";
  const clean = barcodeBlockFor([
    { id: "a1", label: "220x19.5x2", ean: "8720847172266" },
    { id: "a2", label: "126x25x2", ean: "8720847172297" },
  ]);
  assert.equal(clean.blocked, false);
  assert.equal(clean.message, null);

  const block = barcodeBlockFor([
    { id: "a1", label: "220x19.5x2", ean: "8720847172266" },
    { id: "a2", label: "220x15x2", ean: null, eanBlockedReason: reason },
  ]);
  assert.equal(block.blocked, true);
  assert.equal(block.articles.length, 1);
  assert.equal(block.articles[0].label, "220x15x2");
  assert.match(block.message ?? "", /220x19\.5x2/);
  assert.match(block.message ?? "", /220x15x2/);
});

test("barcodeBlockFor also catches two rows holding one code, index or no index", () => {
  // The unique index makes this unreachable through the routes today. It is
  // checked anyway because the index is the ONLY thing preventing it, and a
  // bulk load with the index dropped must stop the printer rather than print
  // two crates the same.
  const block = barcodeBlockFor([
    { id: "a1", label: "220x19.5x2", ean: "8720847172266" },
    { id: "a2", label: "220x15x2", ean: "8720847172266" },
  ]);
  assert.equal(block.blocked, true);
  assert.equal(block.articles.length, 2);
  assert.match(block.message ?? "", /8720847172266 is on both 220x19\.5x2 and 220x15x2/);
});

test("a blocked customer gets NOTHING allocated, in the same words the printer refuses with", () => {
  const reason = "8720847172266 is on both 220x19.5x2 and 220x15x2. One of them has to give it up before any barcode for this client is generated or printed.";
  const rows = [
    article({ id: "a1", label: "220x19.5x2", ean: "8720847172266", eanSource: "CUSTOMER" }),
    article({ id: "a2", label: "220x15x2", eanBlockedReason: reason }),
    article({ id: "a3", label: "126x25x2" }),
  ];

  const plan = planEanAllocation({ prefix: PREFIX, rows });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.allocations, []);
  assert.equal(plan.nextFloor, null);
  // ONE HELPER, NOT TWO COPIES OF THE CONDITION: the sentence the allocate
  // route refuses with is the sentence the labels route refuses with, because
  // it is the same function's answer.
  assert.equal(plan.message, barcodeBlockFor(rows).message);
});

// ───────────────────────── the allocator ────────────────────────────────────

test("the allocator continues his series, never reusing the gap at 17227", () => {
  const rows = HIS_CODES.map((ean, i) => article({ id: `a${i}`, ean, eanSource: "CUSTOMER" }))
    .concat([article({ id: "blank", itemCode: "CQBE 126x25x2", ean: null })]);

  const plan = planEanAllocation({ prefix: PREFIX, rows });
  assert.equal(plan.ok, true);
  assert.equal(plan.allocations.length, 1);
  // 17232 is the highest in use, so the next is 17233 — NOT 17227, which is a
  // code the customer has most likely spent somewhere we cannot see.
  assert.equal(plan.allocations[0].ean, "8720847172334");
  assert.equal(plan.allocations[0].ref, 17233);
  assert.equal(plan.nextFloor, 17234);
  assert.equal(plan.allocations[0].id, "blank");
});

test("the allocator never overwrites a code, and says which kind it is leaving alone", () => {
  const rows = [
    article({ id: "theirs", itemCode: "CQBE 101x19.5x2", ean: HIS_CODES[0], eanSource: "CUSTOMER" }),
    article({ id: "ours", itemCode: "CQBE 103x11x2", ean: HIS_CODES[1], eanSource: "GENERATED" }),
    article({ id: "blank", itemCode: "CQBE 126x25x2" }),
  ];

  const plan = planEanAllocation({ prefix: PREFIX, rows });
  assert.deepEqual(plan.allocations.map((a) => a.id), ["blank"]);
  assert.equal(plan.skipped.length, 2);
  assert.match(plan.skipped[0].reason, /came off the customer's own file — their codes are never overwritten/);
  assert.match(plan.skipped[1].reason, /already carries 8720847172235/);
});

test("asking for ONE customer's code by id leaves the rest of their articles alone", () => {
  const rows = [
    article({ id: "theirs", itemCode: "CQBE 101x19.5x2", ean: HIS_CODES[0], eanSource: "CUSTOMER" }),
    article({ id: "blank-1", itemCode: "CQBE 126x25x2" }),
    article({ id: "blank-2", itemCode: "CQBE 220x15x2" }),
  ];

  // The row's own button: one id, one code, and blank-2 still blank.
  const one = planEanAllocation({ prefix: PREFIX, rows, ids: ["blank-2"] });
  assert.deepEqual(one.allocations.map((a) => a.id), ["blank-2"]);
  assert.equal(one.allocations[0].ean, "8720847172235");

  // Naming the customer's own code refuses it rather than quietly doing
  // nothing, so the screen can say why the button did not work.
  const refused = planEanAllocation({ prefix: PREFIX, rows, ids: ["theirs"] });
  assert.equal(refused.ok, false);
  assert.equal(refused.allocations.length, 0);
  assert.match(refused.skipped[0].reason, /never overwritten/);
  assert.match(refused.message ?? "", /already has a barcode/);
});

test("a run of blank articles walks the floor forward without re-reading anything", () => {
  const rows = ["b1", "b2", "b3"].map((id) => article({ id, itemCode: id }));
  const plan = planEanAllocation({ prefix: PREFIX, rows, floor: 17233 });
  assert.deepEqual(plan.allocations.map((a) => a.ref), [17233, 17234, 17235]);
  assert.equal(plan.nextFloor, 17236);
  // Every code is different and every one is a real EAN-13 under his prefix.
  assert.equal(new Set(plan.allocations.map((a) => a.ean)).size, 3);
  for (const a of plan.allocations) assert.ok(a.ean.startsWith(PREFIX));
});

test("the floor is a FLOOR: the higher of it and what is in use wins, both ways round", () => {
  const used = article({ id: "used", ean: "8720847172327", eanSource: "CUSTOMER" });   // ref 17232

  // A floor left behind by a hand-entered code does not hand that code out again.
  const behind = planEanAllocation({ prefix: PREFIX, rows: [used, article({ id: "b" })], floor: 5 });
  assert.equal(behind.allocations[0].ref, 17233);

  // A floor moved ahead — a block of references reserved with the customer —
  // is respected even though nothing has been issued up to it.
  const ahead = planEanAllocation({ prefix: PREFIX, rows: [used, article({ id: "b" })], floor: 40000 });
  assert.equal(ahead.allocations[0].ref, 40000);
});

test("a code held under this prefix by somebody else's row is stepped over, not collided with", () => {
  // The unique index is global. A code filed against another client — or
  // against one of our own rows — would fail the insert, so the allocator is
  // told about it and goes above it.
  const plan = planEanAllocation({
    prefix: PREFIX,
    rows: [article({ id: "b" })],
    otherEans: ["8720847172327"],
  });
  assert.equal(plan.allocations[0].ref, 17233);
});

test("no prefix, no codes: the refusal says so rather than inventing thirteen digits", () => {
  const plan = planEanAllocation({ prefix: null, rows: [article({ id: "b" })] });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.allocations, []);
  assert.match(plan.message ?? "", /no GS1 company prefix on file/);
});

test("a series at its end stops, keeps what it allocated, and says what to do", () => {
  // An eleven-digit prefix leaves one digit: references 0 to 9, and this one is
  // at 8. Two blank articles, one code left.
  const plan = planEanAllocation({
    prefix: "12345678901",
    rows: [article({ id: "b1" }), article({ id: "b2" })],
    floor: 9,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.allocations.length, 1);
  assert.match(plan.message ?? "", /reached the end/);
  assert.match(plan.message ?? "", /second company prefix from GS1/);
});

// ───────────── the label on the edge of a 2 cm slab (answer 3) ───────────────

test("the settings' edge label IS barcode.edgeLabelLayout while the settings stand at their defaults", () => {
  for (const t of [13, 18, 20, 25, 30, 40.875, 60]) {
    assert.deepEqual(edgeLabelFor(t), edgeLabelLayout(t), `thickness ${t}`);
  }
  // And the defaults are the constants the symbol's own module keeps, not a
  // second copy of them typed into the settings file.
  assert.deepEqual(DEFAULT_SETTINGS.labels.edge, EDGE_LABEL_DEFAULTS);
});

test("a 20 mm edge: 18.0 mm tall, 13.4 mm of bars, 59% of nominal, deliberately", () => {
  const r = edgeLabelFor(20);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.label.heightMm, 18);
  assert.equal(r.label.barHeightMm, 13.4);
  assert.equal(r.label.digitsHeightMm, 2.6);
  assert.equal(r.label.marginMm, 1);
  assert.equal(r.label.percentOfNominalHeight, 59);
  assert.equal(r.label.truncated, true);
  // The length is free, and is whatever the symbol and its quiet zones need.
  assert.equal(r.label.lengthMm, Math.round((ean13WidthMm(1.5) + 2) * 1000) / 1000);
  assert.ok(r.label.heightMm < 20, "the label has to fit inside the edge it is pasted on");
});

test("the height follows the stone, and too thin is a refusal with somewhere else to put it", () => {
  const thick = edgeLabelFor(30);
  assert.equal(thick.ok, true);
  if (thick.ok) assert.ok(thick.label.barHeightMm > 13.4, "a 3 cm piece gets a taller label and less truncation");

  const thin = edgeLabelFor(12);
  assert.equal(thin.ok, false);
  if (!thin.ok) {
    assert.match(thin.reason, /scans as nothing/);
    assert.match(thin.reason, /crate label/);
  }
});

test("the owner's tunables move the label, and only the four settings do", () => {
  const edge = DEFAULT_SETTINGS.labels.edge;

  // A magnification is a parameter of the symbol's own layout, so it is handed
  // straight to it and the answer is identical.
  assert.deepEqual(edgeLabelFor(20, { ...edge, magnification: 1.2 }), edgeLabelLayout(20, 1.2));

  // Two more millimetres of clearance off the stock is two fewer of bars, and
  // a 22 mm edge under it lands exactly where a 20 mm edge lands today.
  const wider = edgeLabelFor(22, { ...edge, clearanceMm: 4 });
  const shipped = edgeLabelLayout(20);
  assert.equal(wider.ok, true);
  if (wider.ok && shipped.ok) {
    assert.equal(wider.label.barHeightMm, shipped.label.barHeightMm);
    assert.equal(wider.label.heightMm, shipped.label.heightMm);
    assert.equal(wider.label.lengthMm, shipped.label.lengthMm);
    assert.equal(wider.label.thicknessMm, 22);
  }

  // A minimum raised above what a 2 cm edge can give refuses every 2 cm piece,
  // which is exactly why the settings screen warns about it.
  const fussy = edgeLabelFor(20, { ...edge, minBarMm: 14 });
  assert.equal(fussy.ok, false);
  if (!fussy.ok) assert.match(fussy.reason, /under 14 mm of bars/);
});

test("the settings refuse a magnification the symbol is not specified at", () => {
  assert.equal(leafIssue("labels.edge.magnification", 1.5), null);
  assert.match(leafIssue("labels.edge.magnification", 2.5) ?? "", /between magnification 0\.8 and 2/);
  assert.match(leafIssue("labels.edge.marginMm", 9) ?? "", /between 0 and 5/);
  assert.equal(leafIssue("labels.edge.minBarMm", 8), null);
});

// ───────────────── the edge labels off a packing list ───────────────────────

const CQBE = {
  id: "a1", clientId: "cli-1", design: "Desert Silk",
  lengthCm: 101, widthCm: 19.5, thicknessCm: 2,
  itemCode: "CQBE 101x19.5x2", description: "WINDOW SILLS 101x19.5x2",
  ean: "8720847172228", notes: null,
};

const listInput = (over: Record<string, unknown> = {}) => ({
  clientId: "cli-1",
  crates: [{ id: "c1", crateNo: 1 }],
  pieces: [{ crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 3 }],
  articles: [CQBE],
  list: { finalisedAt: "2026-09-07" },
  ...over,
});

test("edge labels: one per PIECE, at the size the piece's own thickness allows", () => {
  const run = edgeLabels(listInput());
  assert.equal(run.labels.length, 3);
  assert.deepEqual(run.skipped, []);
  assert.equal(run.labels[0].ean, "8720847172228");
  assert.equal(run.labels[0].text, "CQBE 101x19.5x2");
  assert.equal(run.labels[0].layout.heightMm, 18);
  assert.equal(run.labels[0].layout.barHeightMm, 13.4);
});

test("edge labels are SKIPPED, not printed blank, and the reason names the errand", () => {
  // No article at all.
  const none = edgeLabels(listInput({ articles: [] }));
  assert.equal(none.labels.length, 0);
  assert.equal(none.skipped.length, 1);
  assert.match(none.skipped[0].reason, /No article on file/);

  // An article with no code: the customer's to send.
  const blank = edgeLabels(listInput({ articles: [{ ...CQBE, ean: null }] }));
  assert.match(blank.skipped[0].reason, /no barcode yet/);

  // A code with a digit wrong: ours to fix, and the bars cannot be drawn.
  const wrong = edgeLabels(listInput({ articles: [{ ...CQBE, ean: "8720847172223" }] }));
  assert.match(wrong.skipped[0].reason, /not a readable EAN-13/);

  // A piece too thin to carry the symbol at all.
  const thin = edgeLabels(listInput({
    pieces: [{ crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 10, quantity: 2 }],
    articles: [{ ...CQBE, thicknessCm: 1 }],
  }));
  assert.equal(thin.labels.length, 0);
  assert.match(thin.skipped[0].reason, /scans as nothing/);
});

test("parseLabelKind: three kinds now, and nothing else", () => {
  assert.deepEqual([...LABEL_KINDS], ["crate", "piece", "edge"]);
  assert.equal(parseLabelKind(" EDGE "), "edge");
  assert.equal(parseLabelKind("sticker"), null);
});

// ─────────── the block covers every set a label prints out of ───────────────
//
// WHAT WENT WRONG AND WHY IT COULD NOT BE SEEN FROM HERE. The labels route
// asked the block question of the packing list's own customer — one equality
// filter, `where: { clientId }` — while the labels themselves are resolved by
// articleFor, which takes the customer's own row FIRST and the CLIENT-LESS row
// SECOND. So a customer with no row of their own prints the code off a row of
// OURS, and a collision sitting in the ours set was never looked at: the crate
// and edge labels went out carrying a code two articles are wearing, which is
// the one thing answer 2 says must not happen ("nothing prints half-right").
//
// The first test below is the state itself, in the owner's own numbers. The
// second reads the route's source, the way commercialPackingPieces.test.ts
// reads the dispatch route's, because the wiring lives in files that import
// Prisma and node --test cannot load them.

/** His collision, moved into the client-less set: two articles of OURS, one
 *  code between them, and the loser carrying the sentence that says so. */
const COLLISION = "8720847172266 is on both 220x19.5x2 and 220x15x2. One of them has to give it up before any barcode for this client is generated or printed.";

const OURS_A = {
  id: "ours-a", clientId: null, design: "Desert Silk",
  lengthCm: 220, widthCm: 19.5, thicknessCm: 2,
  itemCode: "PES 220x19.5x2", description: null, ean: "8720847172266", notes: null,
};
const OURS_B = { ...OURS_A, id: "ours-b", widthCm: 15, itemCode: "PES 220x15x2", ean: null };

/** The same two rows as the block question sees them (the shape
 *  articles/_lib.loadClientArticles hands it). */
const OURS_ROWS = [
  { id: "ours-a", label: "PES 220x19.5x2", ean: "8720847172266", eanBlockedReason: null },
  { id: "ours-b", label: "PES 220x15x2", ean: null, eanBlockedReason: COLLISION },
];

const OURS_LIST = {
  // A real customer of ours with no article row of their own — the common case
  // for a design we have not been sent codes for.
  clientId: "cli-9",
  crates: [{ id: "c1", crateNo: 1 }],
  pieces: [{ crateId: "c1", design: "Desert Silk", lengthMm: 2200, widthMm: 195, thicknessMm: 20, quantity: 4 }],
  articles: [OURS_A, OURS_B],
  list: { finalisedAt: "2026-09-07" },
};

test("a customer with no row of their own prints OUR code, so OUR set is one the block has to be asked about", () => {
  const labels = crateLabels(OURS_LIST);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].ean, "8720847172266", "the code on the crate came off a row of ours, not off cli-9's");
  assert.ok(labels[0].lines.includes("BARCODE: 8720847172266"));

  const edges = edgeLabels(OURS_LIST);
  assert.equal(edges.labels.length, 4);
  assert.equal(edges.labels[0].ean, "8720847172266", "and the bars on the stone are drawn from the same row");

  // So this is the set the printed code actually came out of, and it is
  // stopped…
  const ours = barcodeBlockFor(OURS_ROWS);
  assert.equal(ours.blocked, true);
  assert.match(ours.message ?? "", /220x19\.5x2/);
  assert.match(ours.message ?? "", /220x15x2/);

  // …while the question the route used to ask — cli-9's own rows, and cli-9
  // has none — answers "nothing is stopped" and prints the code anyway.
  assert.equal(barcodeBlockFor([]).blocked, false);
});

/** The text of an `export async function name`, to its closing brace in
 *  column zero. */
function asyncFnBody(src: string, name: string): string {
  const at = src.indexOf(`export async function ${name}`);
  assert.notEqual(at, -1, `${name} is gone`);
  const rest = src.slice(at);
  const end = rest.indexOf("\n}");
  assert.notEqual(end, -1, `${name} has no closing brace`);
  return rest.slice(0, end + 2);
}

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("the labels route asks the block of both sets, and the allocator still asks it of one", () => {
  const route = read("../src/app/api/office/commercial/packing-lists/[plId]/labels/route.ts");
  const lib = read("../src/app/api/office/commercial/articles/_lib.ts");
  const allocate = read("../src/app/api/office/commercial/articles/allocate/route.ts");

  assert.match(route, /labelBarcodeBlock\(/,
    "the labels route must ask the question that covers every set a label prints out of");
  assert.doesNotMatch(route, /clientBarcodeBlock/,
    "the one-customer question is the defect: it cannot see a collision in the ours set the labels fall back to");
  assert.match(route, /block\.blocked && CARRIES_A_BARCODE\.includes\(kind\)/,
    "and the answer still has to refuse the two kinds that carry a barcode");

  const body = asyncFnBody(lib, "labelBarcodeBlock");
  assert.match(body, /loadClientArticles/,
    "it reads the articles desk's own query rather than a second copy of it");
  assert.match(body, /,\s*null\s*\]/,
    "the ours set has to be one of the sets it loads, or the fallback row is never asked about");
  assert.doesNotMatch(body, /return barcodeBlockFor\(await loadClientArticles\(/,
    "one set, filtered on the list's customer, is exactly what printed a blocked code");

  // The ALLOCATOR is deliberately not widened: it writes into one customer's
  // rows out of one customer's GS1 prefix, so the set its plan must be clean of
  // is that customer's. Printing reads the wider set, so only printing asks the
  // wider question.
  assert.match(allocate, /loadClientArticles\(clientId\)/,
    "allocation stays one customer's question");
});

test("the article form claims a source only for a code that is new to the row", () => {
  const editor = read("../src/components/commercial/articles/ArticlesEditor.tsx");

  // THE DEFECT THIS PINS: the body builder wrote `eanSource: "CUSTOMER"` into
  // every save, edits included. The form pre-fills the code the row already
  // holds, so fixing a typo in a description re-sent a code our own allocator
  // had minted under the customer's word — the row's badge flipped from "ours"
  // to "customer" and the allocator afterwards refused to touch it saying it
  // came off the customer's file. The form is read rather than imported
  // because a client component cannot be loaded without a DOM, which is the
  // style of creditNoteRoleGate.test.ts.
  assert.doesNotMatch(editor, /eanSource:\s*"CUSTOMER"/,
    "a save must not assert the customer's name over a code the form merely pre-filled");
  assert.match(editor, /eanSource:\s*eanSourceForSave\(/,
    "it asks the same rule the save route settles the source by, rather than a second copy of the comparison");

  // It can only answer that way because the form kept what the row held. A
  // form that forgets has nothing to compare the box against and is back to
  // guessing.
  assert.match(editor, /heldEan:\s*a\.ean/,
    "formOf must carry the row's own code across, not only the box the person edits");
  assert.match(editor, /heldSource:\s*a\.eanSource/,
    "and the source stored against it, which is the answer being preserved");
});
