// The customer's article master and the two labels off a packing list
// (round three, answer 4), run against the shapes in the files the owner sent:
// `Desert Silk Crate BARCODE.docx` for the crate label and
// `DS - Thresholds (103 x 11) -360 PCS.docx` for the piece label.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateArticle, articleFor, articleKeyOf, sizeLabel, withSize, ddmmyyyy,
  shippingDateOf, thicknessCmOf, crateLabels, pieceLabels, missingArticles,
  missingBarcodes, parseLabelKind, LABEL_KINDS, PIECE_LABEL_MAX,
} from "../src/lib/commercial/articles-rules.ts";

const CQBE = {
  id: "a1", clientId: "cli-1", design: "Desert Silk",
  lengthCm: 101, widthCm: 19.5, thicknessCm: 2,
  itemCode: "CQBE 101x19.5x2", description: "WINDOW SILLS 101x19.5x2",
  ean: "8720847172228", notes: null,
};

// ───────────────────────── validating a row ─────────────────────────────────

test("validateArticle: design required, sizes above zero, code and description trimmed", () => {
  const ok = validateArticle({
    clientId: " cli-1 ", design: "  Desert Silk  ",
    lengthCm: "101", widthCm: "19.50", thicknessCm: 2,
    itemCode: "  CQBE 101x19.5x2 ", description: " WINDOW SILLS 101x19.5x2 ",
    ean: "'8720847172228", notes: "  from the customer's sheet ",
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.value, {
    clientId: "cli-1", design: "Desert Silk",
    lengthCm: 101, widthCm: 19.5, thicknessCm: 2,
    itemCode: "CQBE 101x19.5x2", description: "WINDOW SILLS 101x19.5x2",
    ean: "8720847172228", notes: "from the customer's sheet",
  });

  const noDesign = validateArticle({ lengthCm: 1, widthCm: 1, thicknessCm: 1 });
  assert.equal(noDesign.ok, false);
  assert.match(!noDesign.ok ? noDesign.reason : "", /design/i);

  for (const bad of [
    { design: "D", lengthCm: 0, widthCm: 1, thicknessCm: 1, word: /length/ },
    { design: "D", lengthCm: 1, widthCm: -3, thicknessCm: 1, word: /width/ },
    { design: "D", lengthCm: 1, widthCm: 1, thicknessCm: 0, word: /thickness/ },
  ]) {
    const r = validateArticle(bad as unknown as Record<string, unknown>);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : "", bad.word);
    assert.match(!r.ok ? r.reason : "", /more than zero/);
  }

  const missingSize = validateArticle({ design: "D", lengthCm: 1, widthCm: "", thicknessCm: 1 });
  assert.equal(missingSize.ok, false);
  assert.match(!missingSize.ok ? missingSize.reason : "", /width in centimetres/);
});

test("validateArticle refuses a mistyped barcode WITH the digit named", () => {
  const r = validateArticle({ design: "Desert Silk", lengthCm: 101, widthCm: 19.5, thicknessCm: 2, ean: "8720847172223" });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : "", /check digit should be 8, not 3/);
  // ...and an article with no barcode at all is perfectly legal.
  const blank = validateArticle({ design: "Desert Silk", lengthCm: 101, widthCm: 19.5, thicknessCm: 2, ean: " " });
  assert.equal(blank.ok, true);
  assert.equal(blank.ok && blank.value.ean, null);
  assert.equal(blank.ok && blank.value.clientId, null, "no client = ours, for any customer");
});

test("articleKeyOf matches the database's unique index: COALESCE(client,''), design, the three sizes", () => {
  assert.equal(articleKeyOf(CQBE), articleKeyOf({ ...CQBE, design: "DESERT SILK" }), "design is case-blind");
  assert.equal(articleKeyOf(CQBE), articleKeyOf({ ...CQBE, widthCm: 19.5 }));
  assert.notEqual(articleKeyOf(CQBE), articleKeyOf({ ...CQBE, widthCm: 15 }));
  assert.notEqual(articleKeyOf(CQBE), articleKeyOf({ ...CQBE, clientId: null }));
  assert.equal(articleKeyOf({ ...CQBE, clientId: null }), articleKeyOf({ ...CQBE, clientId: "" }), "blank and null are one key");
});

// ───────────────────────── picking the article ──────────────────────────────

test("articleFor: the client's own row first, the client-less row second, another client's never", () => {
  const ours = { ...CQBE, id: "ours", clientId: null, itemCode: "PES 101x19.5x2", ean: "8720847172235" };
  const theirs = { ...CQBE, id: "theirs", clientId: "cli-2", ean: "8720847172242" };
  const rows = [ours, theirs, CQBE];
  const key = { design: "desert silk", lengthCm: 101, widthCm: 19.5, thicknessCm: 2 };

  assert.equal(articleFor(rows, { ...key, clientId: "cli-1" })?.id, "a1");
  assert.equal(articleFor(rows, { ...key, clientId: "cli-9" })?.id, "ours", "a customer with no row of their own falls back to ours");
  assert.equal(articleFor(rows, { ...key, clientId: null })?.id, "ours");
  assert.equal(articleFor([theirs], { ...key, clientId: "cli-1" }), null, "another customer's barcode is never printed on this crate");
  assert.equal(articleFor(rows, { ...key, widthCm: 15, clientId: "cli-1" }), null, "the size is half the key");
  assert.equal(articleFor([], { ...key, clientId: "cli-1" }), null);
  assert.equal(articleFor(rows, { ...key, lengthCm: null, clientId: "cli-1" }), null, "a line with no size matches nothing");
});

// ───────────────────────── the printed strings ──────────────────────────────

test("sizeLabel / withSize: 101x19.5x2, and the size is never printed twice", () => {
  assert.equal(sizeLabel(101, 19.5, 2), "101x19.5x2");
  assert.equal(sizeLabel(101, 19.5, 2, "X"), "101X19.5X2", "the piece label writes it with a capital X");
  assert.equal(sizeLabel(220, 15, 2), "220x15x2");
  assert.equal(sizeLabel(103, 11, 2), "103x11x2");
  assert.equal(sizeLabel(null, 11, 2), "?x11x2");

  // scripts/0081 stores the item code WITH the size; DECISIONS-3 annotates the
  // line as "item code + size". Both readings print one size.
  assert.equal(withSize("CQBE 101x19.5x2", "101x19.5x2"), "CQBE 101x19.5x2");
  assert.equal(withSize("CQBE", "101x19.5x2"), "CQBE 101x19.5x2");
  assert.equal(withSize("CQBE 101X19.5X2", "101x19.5x2"), "CQBE 101X19.5X2", "case-blind");
  assert.equal(withSize("WINDOW SILLS", "101x19.5x2"), "WINDOW SILLS 101x19.5x2");
  assert.equal(withSize("", "101x19.5x2"), "101x19.5x2");
  assert.equal(withSize(null, "101x19.5x2"), "101x19.5x2");
});

test("ddmmyyyy / shippingDateOf: the label's date, and never blank when the list has any", () => {
  assert.equal(ddmmyyyy("2026-09-07"), "07-09-2026");
  assert.equal(ddmmyyyy(new Date(Date.UTC(2026, 8, 7))), "07-09-2026");
  assert.equal(ddmmyyyy("2026-09-07T11:22:33.000Z"), "07-09-2026");
  assert.equal(ddmmyyyy(null), "");
  assert.equal(ddmmyyyy("not a date"), "");
  assert.equal(shippingDateOf({ dispatchedAt: "2026-09-07", finalisedAt: "2026-09-01", createdAt: "2026-08-01" }), "07-09-2026");
  assert.equal(shippingDateOf({ finalisedAt: "2026-09-01", createdAt: "2026-08-01" }), "01-09-2026");
  assert.equal(shippingDateOf({ invoiceDate: "2026-09-05", createdAt: "2026-08-01" }), "05-09-2026");
  assert.equal(shippingDateOf({ createdAt: "2026-08-01" }), "01-08-2026");
  assert.equal(shippingDateOf({}), "");
});

test("thicknessCmOf reads the spellings the slab rows carry", () => {
  assert.equal(thicknessCmOf("2 cm"), 2);
  assert.equal(thicknessCmOf("20mm"), 2);
  assert.equal(thicknessCmOf("2"), 2);
  assert.equal(thicknessCmOf("30"), 3, "a bare number of ten and over is millimetres");
  assert.equal(thicknessCmOf("1.2 cm"), 1.2);
  assert.equal(thicknessCmOf("7 mm"), 0.7);
  assert.equal(thicknessCmOf(""), null);
  assert.equal(thicknessCmOf(null), null);
  assert.equal(thicknessCmOf("thick"), null);
});

// ───────────────────────── the crate label ──────────────────────────────────

const CRATES = [{ id: "c1", crateNo: 1 }, { id: "c2", crateNo: 2 }];
const LIST = { finalisedAt: "2026-09-07" };

/** 35 pieces of Desert Silk 101 × 19.5 × 2, in crate 1 — the label in his file.
 *  Sizes on a cut-to-size line are MILLIMETRES (answer 5). */
const DESERT_SILK_PIECES = [
  { crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 20 },
  { crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 15 },
];

test("crateLabels: the five lines of Desert Silk Crate BARCODE.docx, exactly", () => {
  const [label, ...rest] = crateLabels({
    clientId: "cli-1", crates: CRATES, pieces: DESERT_SILK_PIECES, articles: [CQBE], list: LIST,
  });
  assert.equal(rest.length, 0, "one crate holding one article prints one label");
  assert.deepEqual(label.lines, [
    "CQBE 101x19.5x2",
    "WINDOW SILLS 101x19.5x2",
    "BARCODE: 8720847172228",
    "QUANTITY: 35",
    "SHIPPING DATE: 07-09-2026",
  ]);
  assert.equal(label.crateNo, "1");
  assert.equal(label.quantity, 35, "the crate's own pieces, summed by quantity");
  assert.equal(label.ean, "8720847172228");
  assert.equal(label.hasArticle, true);
});

test("crateLabels: a line with no article prints the design and the size and NO barcode", () => {
  const [label] = crateLabels({
    clientId: "cli-1", crates: CRATES, pieces: DESERT_SILK_PIECES, articles: [], list: LIST,
  });
  assert.deepEqual(label.lines, ["Desert Silk 101x19.5x2", "QUANTITY: 35", "SHIPPING DATE: 07-09-2026"]);
  assert.equal(label.ean, null);
  assert.equal(label.hasArticle, false);
  assert.deepEqual(missingArticles({ clientId: "cli-1", crates: CRATES, pieces: DESERT_SILK_PIECES, articles: [], list: LIST }), [
    { design: "Desert Silk", size: "101x19.5x2", crateNos: ["1"], quantity: 35 },
  ]);
  assert.deepEqual(missingArticles({ clientId: "cli-1", crates: CRATES, pieces: DESERT_SILK_PIECES, articles: [CQBE], list: LIST }), []);
});

test("crateLabels: an article whose EAN is unusable prints without bars rather than with wrong ones", () => {
  const [label] = crateLabels({
    clientId: "cli-1", crates: CRATES, pieces: DESERT_SILK_PIECES,
    articles: [{ ...CQBE, ean: "8720847172223" }], list: LIST,
  });
  assert.equal(label.ean, null);
  assert.equal(label.hasArticle, true, "the code and description still print — only the barcode is dropped");
  assert.equal(label.rejectedEan, "8720847172223", "and the label can say WHICH code it refused to draw");
  assert.deepEqual(label.lines, [
    "CQBE 101x19.5x2", "WINDOW SILLS 101x19.5x2", "QUANTITY: 35", "SHIPPING DATE: 07-09-2026",
  ]);
});

// THE THREE REASONS A CRATE PRINTS WITHOUT BARS send the packer to three
// different people, so `ean === null` is not one answer. The label used to say
// "no article on file" over an item code and a description that had come OFF
// an article, and the screen's list said nothing at all about that line.
test("crateLabels tells a missing article apart from a missing barcode and a bad one", () => {
  const input = (article: Record<string, unknown> | null) => ({
    clientId: "cli-1", crates: CRATES, pieces: DESERT_SILK_PIECES,
    articles: article ? [article as typeof CQBE] : [], list: LIST,
  });

  const none = crateLabels(input(null))[0];
  assert.equal(none.hasArticle, false);
  assert.equal(none.rejectedEan, null);

  const blank = crateLabels(input({ ...CQBE, ean: null }))[0];
  assert.equal(blank.hasArticle, true, "the row exists; the customer has not sent the code");
  assert.equal(blank.ean, null);
  assert.equal(blank.rejectedEan, null);

  const bad = crateLabels(input({ ...CQBE, ean: "8720847172223" }))[0];
  assert.equal(bad.hasArticle, true);
  assert.equal(bad.rejectedEan, "8720847172223", "somebody mistyped a digit");

  const good = crateLabels(input(CQBE))[0];
  assert.equal(good.ean, "8720847172228");
  assert.equal(good.rejectedEan, null, "a code that draws is never also 'rejected'");
});

test("missingBarcodes names the rows that HAVE an article and still print no bars", () => {
  const input = (article: Record<string, unknown> | null) => ({
    clientId: "cli-1", crates: CRATES, pieces: DESERT_SILK_PIECES,
    articles: article ? [article as typeof CQBE] : [], list: LIST,
  });

  // No article at all: the first list owns it, the second says nothing —
  // there is no barcode to chase until somebody adds the row.
  assert.equal(missingArticles(input(null)).length, 1);
  assert.deepEqual(missingBarcodes(input(null)), []);

  // The row exists with no barcode: the first list is silent (which is how a
  // half-entered article used to disappear), the second names it.
  assert.deepEqual(missingArticles(input({ ...CQBE, ean: null })), []);
  assert.deepEqual(missingBarcodes(input({ ...CQBE, ean: null })), [{
    design: "Desert Silk", size: "101x19.5x2", crateNos: ["1"], quantity: 35,
    itemCode: "CQBE 101x19.5x2", rejectedEan: null,
  }]);

  // A code that fails its own check digit is named WITH the code, so the desk
  // can compare it against the customer's sheet.
  assert.deepEqual(missingBarcodes(input({ ...CQBE, ean: "8720847172223" })), [{
    design: "Desert Silk", size: "101x19.5x2", crateNos: ["1"], quantity: 35,
    itemCode: "CQBE 101x19.5x2", rejectedEan: "8720847172223",
  }]);

  // A good code: neither list has anything to say.
  assert.deepEqual(missingBarcodes(input(CQBE)), []);
  assert.deepEqual(missingArticles(input(CQBE)), []);
});

test("missingBarcodes merges the same article across crates, as missingArticles does", () => {
  const both = {
    clientId: "cli-1", crates: CRATES,
    pieces: [
      { crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 2 },
      { crateId: "c2", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 3 },
    ],
    articles: [{ ...CQBE, ean: null }], list: LIST,
  };
  assert.deepEqual(missingBarcodes(both), [{
    design: "Desert Silk", size: "101x19.5x2", crateNos: ["1", "2"], quantity: 5,
    itemCode: "CQBE 101x19.5x2", rejectedEan: null,
  }]);
});

test("crateLabels: one label per article, so a crate of two sizes cannot print one barcode over both", () => {
  const wide = { ...CQBE, id: "a2", widthCm: 15, itemCode: "CQBE 101x15x2", description: "WINDOW SILLS 101x15x2", ean: "8720847172259" };
  const labels = crateLabels({
    clientId: "cli-1", crates: CRATES,
    pieces: [
      { crateId: "c2", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 4 },
      { crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 150, thicknessMm: 20, quantity: 6 },
      { crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 2 },
    ],
    articles: [CQBE, wide], list: LIST,
  });
  assert.deepEqual(labels.map((l) => [l.crateNo, l.size, l.quantity, l.ean]), [
    ["1", "101x15x2", 6, "8720847172259"],
    ["1", "101x19.5x2", 2, "8720847172228"],
    ["2", "101x19.5x2", 4, "8720847172228"],
  ], "crate order, then as met");
});

test("crateLabels counts slabs when the list packs slabs rather than pieces", () => {
  const labels = crateLabels({
    clientId: "cli-1", crates: CRATES,
    slabs: [
      { crateId: "c1", design: "Desert Silk", lengthCm: 101, widthCm: 19.5, thickness: "20mm" },
      { crateId: "c1", design: "Desert Silk", lengthCm: 101, widthCm: 19.5, thickness: "2 cm" },
      { crateId: "c2", design: "Desert Silk", lengthCm: 101, widthCm: 19.5, thickness: "2" },
    ],
    articles: [CQBE], list: LIST,
  });
  assert.deepEqual(labels.map((l) => [l.crateNo, l.quantity]), [["1", 2], ["2", 1]]);
  assert.equal(labels[0].ean, "8720847172228", "20mm, 2 cm and 2 are one thickness");
});

test("crateLabels: a line not yet in a crate is labelled too, and sorts last", () => {
  const labels = crateLabels({
    clientId: "cli-1", crates: CRATES,
    pieces: [
      { crateId: null, crateNo: null, design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 3 },
      { crateId: "c1", design: "Desert Silk", lengthMm: 1010, widthMm: 195, thicknessMm: 20, quantity: 1 },
    ],
    articles: [CQBE], list: LIST,
  });
  assert.deepEqual(labels.map((l) => [l.crateNo, l.quantity]), [["1", 1], ["", 3]]);
});

// ───────────────────────── the piece label ──────────────────────────────────

test("pieceLabels: the item code and the size alone, once per piece — his 360-PCS sheet", () => {
  const threshold = {
    id: "a3", clientId: "cli-1", design: "Desert Silk", lengthCm: 103, widthCm: 11, thicknessCm: 2,
    itemCode: "CQBE", description: "THRESHOLDS", ean: "8720847172266", notes: null,
  };
  const { labels, truncated } = pieceLabels({
    clientId: "cli-1", crates: CRATES,
    pieces: [{ crateId: "c1", design: "Desert Silk", lengthMm: 1030, widthMm: 110, thicknessMm: 20, quantity: 360 }],
    articles: [threshold], list: LIST,
  });
  assert.equal(labels.length, 360);
  assert.equal(truncated, 0);
  assert.equal(labels[0].text, "CQBE 103x11x2");
  assert.equal(labels[359].text, "CQBE 103x11x2");
  assert.ok(labels.every((l) => l.hasArticle));
});

test("pieceLabels falls back to the design and the size, and stops a runaway run", () => {
  const { labels } = pieceLabels({
    clientId: "cli-1", crates: CRATES,
    pieces: [{ crateId: "c1", design: "Desert Silk", lengthMm: 1030, widthMm: 110, thicknessMm: 20, quantity: 2 }],
    articles: [], list: LIST,
  });
  assert.deepEqual(labels.map((l) => l.text), ["Desert Silk 103x11x2", "Desert Silk 103x11x2"]);
  assert.equal(labels[0].hasArticle, false);

  const runaway = pieceLabels({
    clientId: "cli-1", crates: CRATES,
    pieces: [{ crateId: "c1", design: "Desert Silk", lengthMm: 1030, widthMm: 110, thicknessMm: 20, quantity: PIECE_LABEL_MAX + 500 }],
    articles: [], list: LIST,
  });
  assert.equal(runaway.labels.length, PIECE_LABEL_MAX);
  assert.equal(runaway.truncated, 500, "the caller is told, rather than the PDF quietly being short");
});

test("parseLabelKind: the two kinds and nothing else", () => {
  assert.deepEqual([...LABEL_KINDS], ["crate", "piece"]);
  assert.equal(parseLabelKind("crate"), "crate");
  assert.equal(parseLabelKind(" PIECE "), "piece");
  assert.equal(parseLabelKind("both"), null);
  assert.equal(parseLabelKind(""), null);
  assert.equal(parseLabelKind(null), null);
});
