// Proforma-invoice rules, RUN against the real reference document: how an order
// becomes the snapshot a PI prints, how a line is composed, how the totals and
// the amount in words are derived, what a draft edit may touch, which status
// may move where, and every string the PDF puts in a cell.
//
// The reference is the 1404 PI (Surfaces by Pacific, 10-07-2026):
//   VGWT10301A-Polish-Super Jumbo-30mm-Premium / CARRARA ROYALE-…
//   43 slabs, HSN 68101990, Square Foot, 3208.273 × 5.4 = 17324.657
// — and 3208.273 × 5.4 is 17324.6742, NOT 17324.657, which is the whole reason
// a stored amount is printed and never recomputed.
//
// proforma-rules imports only sibling pure modules by path, so node --test
// loads it bare: no Next, no Prisma, no session.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  printable, round3, printThickness, unitLabel, trimNumber, fmtQty, fmtAmount, fmtRate, fmtSlabs,
  formatPiDate, isoDate, validUntilFor, piFilename, piLabel, printedNumber,
  buildItemCode, buildDescription, buildLine, sanitiseLine, recomputeTotals,
  clientParty, exporterParty, buildProformaSnapshot, applyDraftPatch, piBank, piAmountInWords,
  nextRevision, canEditDraft, canIssue, canAccept, canCancel, refuseIssue, supersededIds,
  statusTone, pageArgs, parseProformaStatus, partyBlock, piTableHeader, piRow, piTotalRow,
  piPrintFields, orderWarnings,
  EDITABLE_TEXT_FIELDS,
  type SnapshotOrderInput, type SnapshotItemInput,
} from "../src/lib/commercial/proforma-rules.ts";
import { DEFAULT_SETTINGS } from "../src/lib/commercial/settings-defaults.ts";
import type { ProformaSnapshot } from "../src/lib/commercial/types.ts";

const S = DEFAULT_SETTINGS;

// The reference PI's two lines: a quartz line and the free trade samples that
// carry slabs but no money.
const quartzLine: SnapshotItemInput = {
  lineNo: 1,
  design: "Carrara Royale",
  customerSku: "VGWT10301A",
  thickness: "3 cm",
  finish: "Polish",
  sizeLabel: "Super Jumbo",
  gradeLabel: "Premium",
  qtySlabs: 43,
  qty: 3208.273,
  uom: "SQFT",
  rate: 5.4,
  amount: 17324.657,
  hsn: "68101990",
};
const sampleLine: SnapshotItemInput = {
  lineNo: 2,
  design: "Carrara Royale",
  description: "FREE TRADE SAMPLES",
  thickness: "3 cm",
  qtySlabs: 25,
  qty: 0,
  uom: "NOS",
  rate: 0,
  amount: 0,
  isSample: true,
};

const exportOrder: SnapshotOrderInput = {
  number: "SAL-ORD/26-27/01642",
  kind: "EXPORT",
  currency: "usd",
  customerPoNumber: "PO-4068622",
  deliveryTerms: "FOB CHENNAI",
  paymentTerms: "50% Advance, 50% Against Scanned BL",
  portOfDischarge: "HOUSTON",
  finalDestination: "DALLAS, TX",
  countryOfDestination: null,
  client: {
    name: "Surfaces by Pacific",
    address: "4141 Blue Star Street",
    city: "Dallas, TX 75201",
    country: "USA",
    email: "orders@surfacesbypacific.example",
    commercialExt: { customerCode: "USA-041", shippingAddress: null, billingAddress: null, notifyParty: null },
  },
  items: [quartzLine, sampleLine],
};

const domesticOrder: SnapshotOrderInput = {
  number: "SAL-ORD/26-27/01700",
  kind: "DOMESTIC",
  currency: "INR",
  client: { name: "JB Homes", address: "No 4, Race Course Road", city: "Coimbatore", country: "India", commercialExt: { gstin: "33AABCJ1234K1Z5", stateCode: "33" } },
  items: [{ lineNo: 1, design: "Statuario Bianco", thickness: "2 cm", qtySlabs: 6, qty: 784.887, uom: "SQFT", rate: 210, amount: 164826.27, hsn: "68101990" }],
};

const opts = { revision: 0, date: "2026-07-10", validUntil: null };

// ───────────────────────────── printing primitives ───────────────────────────

test("printable: a blank, a null, and the strings a careless serialiser leaves behind all print as nothing", () => {
  assert.equal(printable("Kotak"), "Kotak");
  assert.equal(printable("  Kotak  "), "Kotak");
  assert.equal(printable(null), "");
  assert.equal(printable(undefined), "");
  assert.equal(printable(""), "");
  assert.equal(printable("   "), "");
  // A customer-facing document must never carry Python's None or JS's null.
  assert.equal(printable("None"), "");
  assert.equal(printable("null"), "");
  assert.equal(printable("undefined"), "");
  assert.equal(printable(0), "0", "zero is a value, not a blank");
});

test("printThickness: millimetres on an export PI, CM on a domestic one", () => {
  assert.equal(printThickness("3 cm", "EXPORT"), "30mm");
  assert.equal(printThickness("2 cm", "EXPORT"), "20mm");
  assert.equal(printThickness("1.2 cm", "EXPORT"), "12mm");
  assert.equal(printThickness("7 mm", "EXPORT"), "7mm");
  assert.equal(printThickness("3 cm", "DOMESTIC"), "3 CM");
  assert.equal(printThickness("2 cm", "DOMESTIC"), "2 CM");
  assert.equal(printThickness("7 mm", "DOMESTIC"), "7 MM");
  // canonThickness normalises whatever was typed before either style is applied
  assert.equal(printThickness("30mm", "EXPORT"), "30mm");
  assert.equal(printThickness("2cm", "DOMESTIC"), "2 CM");
  assert.equal(printThickness("20", "EXPORT"), "20mm");
  assert.equal(printThickness(null, "EXPORT"), null);
  assert.equal(printThickness("", "EXPORT"), null);
  assert.equal(printThickness("odd size", "EXPORT"), "odd size", "an unknown spelling passes through");
});

test("unitLabel: the printed unit per UOM code, from settings", () => {
  assert.equal(unitLabel("SQFT", "EXPORT", S), "Square Foot");
  assert.equal(unitLabel("Square Foot", "EXPORT", S), "Square Foot");
  assert.equal(unitLabel("sqft", "DOMESTIC", S), "SQFT", "the DTA style keeps the code");
  assert.equal(unitLabel("SQMT", "EXPORT", S), "Square Metre");
  assert.equal(unitLabel("SQM", "DOMESTIC", S), "Square Metre");
  assert.equal(unitLabel("NOS", "EXPORT", S), "Nos");
  assert.equal(unitLabel("PCS", "EXPORT", S), "Nos");
  assert.equal(unitLabel("Box", "EXPORT", S), "Box", "anything else prints as typed");
  assert.equal(unitLabel(null, "EXPORT", S), "");
});

test("numbers: quantity and amount at 3 dp, the rate exactly as typed, slabs whole", () => {
  assert.equal(fmtQty(3208.273), "3208.273");
  assert.equal(fmtQty(3208.2), "3208.200");
  assert.equal(fmtAmount(17324.657), "17324.657");
  assert.equal(fmtRate(5.4), "5.4", "not 5.4000");
  assert.equal(fmtRate(55.9728), "55.9728");
  assert.equal(fmtRate(5), "5");
  assert.equal(trimNumber(30), "30");
  assert.equal(fmtSlabs(43), "43");
  assert.equal(fmtSlabs(null), "");
  assert.equal(fmtQty(null), "");
  assert.equal(fmtAmount(undefined), "");
  assert.equal(round3(17324.6574), 17324.657);
  assert.equal(round3(0.1 + 0.2), 0.3);
});

test("dates: stored YYYY-MM-DD, printed DD-MM-YYYY, blank stays blank", () => {
  assert.equal(formatPiDate("2026-07-10"), "10-07-2026");
  assert.equal(formatPiDate("2026-07-10T09:30:00.000Z"), "10-07-2026", "an ISO timestamp prints as its day");
  assert.equal(formatPiDate(null), "");
  assert.equal(formatPiDate(""), "");
  assert.equal(formatPiDate("None"), "");
  assert.equal(isoDate(new Date("2026-07-10T23:45:00.000Z")), "2026-07-10");
});

test("validUntilFor: the issue day plus the settings' validity, in whole days", () => {
  const issued = new Date("2026-07-10T09:30:00.000Z");
  assert.equal(validUntilFor(issued, 30), "2026-08-09");
  assert.equal(validUntilFor(issued, S.piValidityDays), "2026-08-09", "the default is 30 days (OPEN-QUESTIONS §24)");
  assert.equal(validUntilFor(issued, 0), "2026-07-10");
  assert.equal(validUntilFor(new Date("2026-02-27T00:00:00.000Z"), 3), "2026-03-02", "no leap day in 2026");
});

test("piFilename / piLabel / printedNumber: a slash is not a filename, a revision is a suffix", () => {
  assert.equal(piFilename("SAL-ORD/26-27/01642", 0), "SAL-ORD-26-27-01642-R0.pdf");
  assert.equal(piFilename("SAL-ORD/26-27/01642", 2), "SAL-ORD-26-27-01642-R2.pdf");
  assert.equal(piFilename("", 0), "proforma-R0.pdf");
  assert.equal(piLabel("SAL-ORD/26-27/01642", 1), "SAL-ORD/26-27/01642-R1");
  // The printed invoice number keeps the order number; only a revision is suffixed.
  assert.equal(printedNumber("SAL-ORD/26-27/01642", 0), "SAL-ORD/26-27/01642");
  assert.equal(printedNumber("SAL-ORD/26-27/01642", 1), "SAL-ORD/26-27/01642-R1");
});

// ───────────────────────────── lines ─────────────────────────────────────────

test("buildItemCode: the SKU alone, or composed with finish, size, thickness and grade", () => {
  assert.equal(buildItemCode(quartzLine, "EXPORT"), "VGWT10301A-Polish-Super Jumbo-30mm-Premium");
  assert.equal(buildItemCode(quartzLine, "DOMESTIC"), "VGWT10301A-Polish-Super Jumbo-3 CM-Premium");
  assert.equal(buildItemCode({ customerSku: "VGWT10301A" }, "EXPORT"), "VGWT10301A");
  assert.equal(buildItemCode({ customerSku: "VGWT10301A", thickness: "3 cm" }, "EXPORT"), "VGWT10301A", "thickness alone does not compose a code");
  assert.equal(buildItemCode(sampleLine, "EXPORT"), null, "no SKU, no item code");
});

test("buildDescription: what was typed wins; otherwise the design in caps with the same parts", () => {
  assert.equal(buildDescription(quartzLine, "EXPORT"), "CARRARA ROYALE-Polish-Super Jumbo-30mm-Premium");
  assert.equal(buildDescription(sampleLine, "EXPORT"), "FREE TRADE SAMPLES");
  assert.equal(buildDescription({ design: "carrara royale" }, "EXPORT"), "CARRARA ROYALE");
  assert.equal(buildDescription({}, "EXPORT"), "");
});

test("buildLine: the STORED amount is printed, never qty × rate", () => {
  const l = buildLine(quartzLine, 0, "EXPORT", S);
  assert.equal(l.lineNo, 1);
  assert.equal(l.itemCode, "VGWT10301A-Polish-Super Jumbo-30mm-Premium");
  assert.equal(l.description, "CARRARA ROYALE-Polish-Super Jumbo-30mm-Premium");
  assert.equal(l.thickness, "30mm");
  assert.equal(l.slabs, 43);
  assert.equal(l.hsn, "68101990");
  assert.equal(l.unit, "Square Foot");
  assert.equal(l.qty, 3208.273);
  assert.equal(l.rate, 5.4);
  assert.equal(l.amount, 17324.657);
  assert.notEqual(l.amount, round3(3208.273 * 5.4), "the reference's own arithmetic does not close at printed precision");
  assert.equal(round3(3208.273 * 5.4), 17324.674);
  assert.equal(l.isSample, false);
});

test("buildLine: a sample keeps its slabs and its zero", () => {
  const l = buildLine(sampleLine, 1, "EXPORT", S);
  assert.equal(l.slabs, 25);
  assert.equal(l.amount, 0);
  assert.equal(l.unit, "Nos");
  assert.equal(l.isSample, true);
  assert.equal(l.itemCode, null);
  assert.equal(l.hsn, S.company.hsnQuartz, "a line with no HSN falls back to the quartz code");
});

test("buildLine: strings from a JSON body are numbers by the time they are printed", () => {
  const l = buildLine({ qty: "3208.2734", rate: "5.4", amount: "17324.657", qtySlabs: 43 }, 0, "EXPORT", S);
  assert.equal(l.qty, 3208.273);
  assert.equal(l.rate, 5.4);
  assert.equal(l.amount, 17324.657);
  const junk = buildLine({ qty: "abc", rate: null, amount: undefined, qtySlabs: null }, 0, "EXPORT", S);
  assert.equal(junk.qty, 0);
  assert.equal(junk.rate, 0);
  assert.equal(junk.amount, 0);
  assert.equal(junk.slabs, null);
});

test("sanitiseLine: a client-supplied line is coerced, junk is dropped", () => {
  const l = sanitiseLine({ lineNo: "2", itemCode: " ABC ", description: "X", slabs: "4", hsn: "68101990", unit: "Nos", qty: "1.2345", rate: "2", amount: "2.4690", isSample: 1 }, 0);
  assert.ok(l);
  assert.equal(l!.lineNo, 2);
  assert.equal(l!.itemCode, "ABC");
  assert.equal(l!.slabs, 4);
  assert.equal(l!.qty, 1.235);
  assert.equal(l!.amount, 2.469);
  assert.equal(l!.isSample, true);
  assert.equal(sanitiseLine(null, 0), null);
  assert.equal(sanitiseLine("nonsense", 0), null);
  assert.equal(sanitiseLine({}, 3)!.lineNo, 4, "a line with no number takes its position");
});

// ───────────────────────────── totals ────────────────────────────────────────

test("recomputeTotals: slabs include the samples, the discount comes off, the words follow", () => {
  const s = buildProformaSnapshot(exportOrder, S, opts);
  assert.equal(s.totalSlabs, 68, "43 + 25 — the reference's Total row counts the sample slabs");
  assert.equal(s.totalAmount, 17324.657);
  assert.equal(s.amountInWords, "USD Seventeen Thousand, Three Hundred And Twenty Four and Sixty Six Cent only.");
  const discounted = recomputeTotals({ ...s, discount: 324.657 });
  assert.equal(discounted.totalAmount, 17000);
  assert.equal(discounted.amountInWords, "USD Seventeen Thousand only.");
  assert.equal(s.totalAmount, 17324.657, "recomputeTotals returns a new snapshot and does not touch the old one");
});

// A PI states its total twice — in figures and in words — and the two must be
// ONE number. These read the words back into a number so the test is about the
// agreement, not about a string that happens to look right.
const WORD_VALUE: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
function readIndian(words: string): number {
  let total = 0, run = 0;
  for (const w of words.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (WORD_VALUE[w] !== undefined) run += WORD_VALUE[w];
    else if (w === "hundred") run *= 100;
    else if (w === "thousand") { total += run * 1000; run = 0; }
    else if (w === "lakh") { total += run * 100000; run = 0; }
    else if (w === "crore") { total += run * 10000000; run = 0; }
    else if (w === "zero") run += 0;
    else if (w !== "and") throw new Error(`unreadable word: ${w}`);
  }
  return total + run;
}
/** "One Lakh … Rupees and Twenty Five Paise Only." → 138686.25 */
function rupeesFromWords(s: string): number {
  const m = s.match(/^(.*?)\s*Rupees(?:\s+and\s+(.*?)\s+Paise)?\s+Only\.$/i);
  assert.ok(m, `not the INR words style: ${s}`);
  return readIndian(m![1]) + (m![2] ? readIndian(m![2]) / 100 : 0);
}

test("a domestic PI's total in words is the figure it prints — paise and all", () => {
  // The bug this pins: whole-rupee words under a 3-dp figure both LOSE the
  // paise ("138686.250" over "…Eighty Six Rupees Only") and can round the
  // words ABOVE the figure ("138686.750" over "…Eighty Seven Rupees Only"),
  // so one PI would state two different totals.
  const of = (amount: number) =>
    buildProformaSnapshot({ ...domesticOrder, items: [{ ...domesticOrder.items![0], amount }] }, S, { revision: 0, date: "2026-07-12" });

  for (const amount of [138686.25, 138686.75, 138686.5, 164826.27, 6000, 0.05, 12345678.9]) {
    const s = of(amount);
    const f = piPrintFields(s);
    assert.equal(rupeesFromWords(f.amountInWords), Number(f.totalAmount), `words vs figure at ${amount}`);
    assert.ok(rupeesFromWords(f.amountInWords) <= Number(f.totalAmount) + 1e-9, "the words may never exceed the printed figure");
  }
  assert.equal(of(138686.25).amountInWords, "One Lakh Thirty Eight Thousand Six Hundred Eighty Six Rupees and Twenty Five Paise Only.");
  assert.equal(of(138686.75).amountInWords, "One Lakh Thirty Eight Thousand Six Hundred Eighty Six Rupees and Seventy Five Paise Only.");
  assert.equal(of(6000).amountInWords, "Six Thousand Rupees Only.", "a round total still reads as whole rupees");
  assert.equal(piPrintFields(of(138686.25)).totalAmount, "138686.250");
});

test("piAmountInWords: rupees name their paise, a foreign currency keeps the PI's own style", () => {
  assert.equal(piAmountInWords(138686.25, "INR"), "One Lakh Thirty Eight Thousand Six Hundred Eighty Six Rupees and Twenty Five Paise Only.");
  assert.equal(piAmountInWords(138686.25, "inr"), piAmountInWords(138686.25, "INR"), "the currency is not case-sensitive");
  assert.equal(piAmountInWords(6000, "INR"), "Six Thousand Rupees Only.");
  assert.equal(piAmountInWords(17324.657, "USD"), "USD Seventeen Thousand, Three Hundred And Twenty Four and Sixty Six Cent only.");
  assert.equal(piAmountInWords(0, "INR"), "Zero Rupees Only.");
});

test("an INR total is money at paise precision, so figure and words can agree at all", () => {
  const s = buildProformaSnapshot({
    ...domesticOrder,
    items: [{ ...domesticOrder.items![0], amount: 100.126 }, { ...domesticOrder.items![0], lineNo: 2, amount: 0.13 }],
  }, S, { revision: 0, date: "2026-07-12" });
  assert.equal(s.totalAmount, 100.26, "100.126 + 0.13 = 100.256 → 100.26; a rupee has two decimals, not three");
  assert.equal(rupeesFromWords(s.amountInWords), 100.26);
  // an export PI keeps the document's 3 dp
  const usd = recomputeTotals({ ...buildProformaSnapshot(exportOrder, S, opts), lines: [{ ...buildLine(quartzLine, 0, "EXPORT", S), amount: 100.1264 }] });
  assert.equal(usd.totalAmount, 100.126);
});

// ───────────────────────────── parties ───────────────────────────────────────

test("clientParty: the client master as the consignee fallback", () => {
  const p = clientParty(exportOrder.client);
  assert.ok(p);
  assert.equal(p!.name, "Surfaces by Pacific");
  assert.deepEqual(p!.lines, ["4141 Blue Star Street", "Dallas, TX 75201, USA"]);
  assert.equal(p!.code, "USA-041");
  assert.equal(clientParty(null), null);
  assert.equal(clientParty({}), null, "a client with neither a name nor an address is no party at all");
});

test("exporterParty: the company master, exactly", () => {
  const e = exporterParty(S);
  assert.equal(e.name, "Pacific Engineered Surfaces Private Limited");
  assert.deepEqual(e.lines, S.company.addressLines);
  assert.equal(e.gstin, "33AALCP2750N1Z3");
  assert.equal(e.country, "India");
});

test("partyBlock: bold name, address lines, and only the contacts that exist", () => {
  const b = partyBlock({ name: "Surfaces by Pacific", lines: ["4141 Blue Star Street"], country: "USA", tel: "+1 214 555 0100", email: "orders@x.example", gstin: null });
  assert.equal(b.name, "Surfaces by Pacific");
  assert.deepEqual(b.lines, ["4141 Blue Star Street", "USA", "Tel: +1 214 555 0100", "Email: orders@x.example"]);
  const dedup = partyBlock({ name: "X", lines: ["Dallas, TX 75201, USA"], country: "USA" });
  assert.deepEqual(dedup.lines, ["Dallas, TX 75201, USA"], "the country is not repeated when the address already carries it");
  assert.deepEqual(partyBlock(null), { name: "", lines: [] });
  assert.deepEqual(partyBlock({ name: "Y", lines: ["", "  ", "Real line"] }).lines, ["Real line"]);
});

// ───────────────────────────── the snapshot ──────────────────────────────────

test("buildProformaSnapshot (EXPORT): the reference PI, field by field", () => {
  const s = buildProformaSnapshot(exportOrder, S, { ...opts, deliveryDate: "2026-08-15" });
  assert.equal(s.number, "SAL-ORD/26-27/01642");
  assert.equal(s.revision, 0);
  assert.equal(s.date, "2026-07-10");
  assert.equal(s.deliveryDate, "2026-08-15");
  assert.equal(s.kind, "EXPORT");
  assert.equal(s.currency, "USD", "the currency is upper-cased");
  assert.equal(s.buyerPoNo, "PO-4068622");
  assert.equal(s.exporter.name, "Pacific Engineered Surfaces Private Limited");
  assert.equal(s.consignee.name, "Surfaces by Pacific", "no consignee on the order → the client master");
  assert.equal(s.notifyParty, null);
  assert.equal(s.buyerIfNotConsignee, null);
  assert.equal(s.countryOfOrigin, "India");
  assert.equal(s.countryOfDestination, "USA", "taken from the consignee when the order names none");
  assert.equal(s.deliveryTerms, "FOB CHENNAI");
  assert.equal(s.paymentTerms, "50% Advance, 50% Against Scanned BL");
  assert.equal(s.preCarriageBy, "By Road");
  assert.equal(s.portOfLoading, "CHENNAI");
  assert.equal(s.portOfDischarge, "HOUSTON");
  assert.equal(s.finalDestination, "DALLAS, TX");
  assert.equal(s.vessel, null);
  assert.equal(s.lines.length, 2);
  assert.equal(s.discount, 0);
  assert.equal(s.bank.name, "Kotak Mahindra Bank Limited", "export banks with Kotak (OPEN-QUESTIONS §23)");
  assert.equal(s.bank.adCode, "0180038-8400009");
  assert.equal(s.bank.routingSwift, "IRVTUS3NXXX");
  assert.equal(s.company.gstin, "33AALCP2750N1Z3");
  assert.equal(s.company.rbiCode, "678");
  assert.equal(s.declaration, S.texts.piDeclaration);
  assert.equal(s.grossWeight, null);
  assert.equal(s.netWeight, null);
});

test("buildProformaSnapshot (DOMESTIC): CM thickness, the SQFT code, the Kotak account, rupees and paise in words", () => {
  const s = buildProformaSnapshot(domesticOrder, S, { revision: 1, date: "2026-07-12" });
  assert.equal(s.kind, "DOMESTIC");
  assert.equal(s.currency, "INR");
  assert.equal(s.revision, 1);
  assert.equal(s.lines[0].thickness, "2 CM");
  assert.equal(s.lines[0].unit, "SQFT");
  // OPEN-QUESTIONS §23: ICICI is the DTA INVOICE's account; the PI, the export
  // documents and the challan carry Kotak. A proforma is a PI whatever its kind.
  assert.equal(s.bank.name, "Kotak Mahindra Bank Limited");
  assert.equal(s.bank.accountNo, "3214292773");
  assert.notEqual(s.bank.accountNo, S.banks.domestic.accountNo, "the ICICI account does not belong on a PI");
  assert.equal(s.deliveryTerms, "Ex-Factory Without Packing", "the domestic default");
  assert.equal(s.paymentTerms, "100% Advance Payment");
  assert.equal(s.preCarriageBy, null, "a domestic PI has no pre-carriage default");
  assert.equal(s.portOfLoading, null);
  assert.equal(s.countryOfDestination, "India");
  assert.equal(s.totalAmount, 164826.27);
  assert.equal(s.amountInWords, "One Lakh Sixty Four Thousand Eight Hundred Twenty Six Rupees and Twenty Seven Paise Only.");
  assert.equal(s.consignee.gstin, "33AABCJ1234K1Z5");
});

test("the PI prints Kotak on both kinds, and piBank says so on its own (OPEN-QUESTIONS §23)", () => {
  assert.equal(piBank(S), S.banks.export);
  assert.equal(piBank(S).name, "Kotak Mahindra Bank Limited");
  const dom = buildProformaSnapshot(domesticOrder, S, opts);
  const exp = buildProformaSnapshot(exportOrder, S, opts);
  assert.deepEqual(dom.bank, exp.bank, "one PI account, whatever the kind — the customer wires an advance to it");
  for (const s of [dom, exp]) {
    assert.equal(s.bank.ifsc, "KKBK0000422");
    assert.notEqual(s.bank.name, S.banks.domestic.name);
    assert.notEqual(piPrintFields(s).accountNo, S.banks.domestic.accountNo);
  }
  // and the bank the settings call "domestic" is still there for the DTA invoice
  assert.equal(S.banks.domestic.accountNo, "020405012473");
});

test("buildProformaSnapshot: the order's own parties beat the client master, and bill-to becomes buyer-if-not-consignee", () => {
  const s = buildProformaSnapshot({
    ...exportOrder,
    consignee: { name: "Gulf Stone LLC", lines: ["PO Box 4411", "Dubai"], country: "UAE" },
    notifyParty: { name: "Same As Consignee", lines: [] },
    billTo: { name: "Surfaces by Pacific", lines: ["4141 Blue Star Street"] },
  }, S, opts);
  assert.equal(s.consignee.name, "Gulf Stone LLC");
  assert.equal(s.notifyParty!.name, "Same As Consignee");
  assert.equal(s.buyerIfNotConsignee!.name, "Surfaces by Pacific", "bill-to differs from the consignee, so it prints");
  assert.equal(s.countryOfDestination, "UAE");

  const same = buildProformaSnapshot({ ...exportOrder, consignee: { name: "Surfaces by Pacific", lines: [] }, billTo: { name: "surfaces by pacific", lines: [] } }, S, opts);
  assert.equal(same.buyerIfNotConsignee, null, "the same party twice is not a second party");
});

test("buildProformaSnapshot: an order with no items yields an empty, printable PI", () => {
  const s = buildProformaSnapshot({ ...exportOrder, items: [] }, S, opts);
  assert.deepEqual(s.lines, []);
  assert.equal(s.totalSlabs, 0);
  assert.equal(s.totalAmount, 0);
  assert.equal(s.amountInWords, "USD Zero only.");
});

// ───────────────────────────── draft edits ───────────────────────────────────

test("applyDraftPatch: the shipping facts a draft may gain", () => {
  const base = buildProformaSnapshot(exportOrder, S, opts);
  const { snapshot, changed } = applyDraftPatch(base, {
    vessel: "MSC ISABELLA / 431W",
    grossWeight: "24,500 KGS",
    netWeight: "23,100 KGS",
    deliveryDate: "2026-08-20",
    notes: "Container to be stuffed at the factory.",
  });
  assert.equal(changed, true);
  assert.equal(snapshot.vessel, "MSC ISABELLA / 431W");
  assert.equal(snapshot.grossWeight, "24,500 KGS");
  assert.equal(snapshot.netWeight, "23,100 KGS");
  assert.equal(snapshot.deliveryDate, "2026-08-20");
  assert.equal(snapshot.notes, "Container to be stuffed at the factory.");
  assert.equal(snapshot.totalAmount, base.totalAmount, "nothing touched the money");
  assert.equal(base.vessel, null, "the input snapshot is untouched");
});

test("applyDraftPatch: a discount re-derives the total and the words", () => {
  const base = buildProformaSnapshot(exportOrder, S, opts);
  const { snapshot, changed } = applyDraftPatch(base, { discount: "324.657" });
  assert.equal(changed, true);
  assert.equal(snapshot.discount, 324.657);
  assert.equal(snapshot.totalAmount, 17000);
  assert.equal(snapshot.amountInWords, "USD Seventeen Thousand only.");
  assert.equal(applyDraftPatch(base, { discount: -50 }).snapshot.discount, 0, "a negative discount is not a surcharge");
});

test("applyDraftPatch: replacing the lines re-derives slabs, total and words", () => {
  const base = buildProformaSnapshot(exportOrder, S, opts);
  const { snapshot } = applyDraftPatch(base, {
    lines: [{ lineNo: 1, itemCode: "X", description: "ONE LINE", thickness: "30mm", slabs: 10, hsn: "68101990", unit: "Square Foot", qty: 500, rate: 6, amount: 3000 }],
  });
  assert.equal(snapshot.lines.length, 1);
  assert.equal(snapshot.totalSlabs, 10);
  assert.equal(snapshot.totalAmount, 3000);
  assert.equal(snapshot.amountInWords, "USD Three Thousand only.");
});

test("applyDraftPatch: everything the customer's paper identity depends on is ignored", () => {
  const base = buildProformaSnapshot(exportOrder, S, opts);
  const { snapshot, changed } = applyDraftPatch(base, {
    number: "SAL-ORD/26-27/09999",
    revision: 9,
    kind: "DOMESTIC",
    currency: "EUR",
    totalAmount: 1,
    totalSlabs: 1,
    amountInWords: "free",
    bank: { name: "Some Other Bank" },
    company: { legalName: "Not Us" },
    declaration: "",
    exporter: { name: "Not Us", lines: [] },
  });
  assert.equal(changed, false);
  assert.equal(snapshot.number, "SAL-ORD/26-27/01642");
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.kind, "EXPORT");
  assert.equal(snapshot.currency, "USD");
  assert.equal(snapshot.totalAmount, 17324.657);
  assert.equal(snapshot.bank.name, "Kotak Mahindra Bank Limited");
  assert.equal(snapshot.company.legalName, "Pacific Engineered Surfaces Private Limited");
  assert.equal(snapshot.declaration, S.texts.piDeclaration);
  assert.equal(snapshot.exporter.name, "Pacific Engineered Surfaces Private Limited");
});

test("applyDraftPatch: a consignee may be replaced but never emptied; a bad date is refused", () => {
  const base = buildProformaSnapshot(exportOrder, S, opts);
  assert.equal(applyDraftPatch(base, { consignee: null }).snapshot.consignee.name, "Surfaces by Pacific");
  assert.equal(applyDraftPatch(base, { consignee: { name: "", lines: [] } }).snapshot.consignee.name, "Surfaces by Pacific");
  assert.equal(applyDraftPatch(base, { consignee: { name: "Gulf Stone LLC", lines: ["Dubai"] } }).snapshot.consignee.name, "Gulf Stone LLC");
  assert.equal(applyDraftPatch(base, { notifyParty: { name: "Notify Co", lines: [] } }).snapshot.notifyParty!.name, "Notify Co");
  assert.equal(applyDraftPatch(base, { deliveryDate: "15/08/2026" }).snapshot.deliveryDate, null, "DD/MM/YYYY is not how a date is stored");
  assert.equal(applyDraftPatch(base, { date: "not a date" }).snapshot.date, "2026-07-10");
  assert.equal(applyDraftPatch(base, {}).changed, false);
  assert.equal(applyDraftPatch(base, null).changed, false);
  assert.equal(applyDraftPatch(base, "nonsense").changed, false);
});

// PATCH /proformas/[piId] SKIPS THE WRITE when applyDraftPatch reports
// changed:false — it returns the row it already has, with a 200. So a false
// `changed` on a patch that really did move something is not a missed
// optimisation, it is an edit the user watched succeed and that never reached
// the database. Every branch that can move a field is run here, and each is
// checked twice: the flag it returns, and whether the snapshot it returns
// actually differs. The two must agree, always.
test("applyDraftPatch: `changed` is true on EVERY path that moves the document, and false on none of them", () => {
  const base = JSON.parse(JSON.stringify(buildProformaSnapshot(exportOrder, S, opts))) as ProformaSnapshot;
  const line = { lineNo: 1, itemCode: "X", description: "ONE LINE", thickness: "30mm", slabs: 10, hsn: "68101990", unit: "Square Foot", qty: 500, rate: 6, amount: 3000 };

  const cases: Array<{ what: string; patch: unknown; changed: boolean }> = [
    // the text branch, field by field — the PI tab's own form posts these five
    { what: "vessel", patch: { vessel: "MSC ISABELLA / 431W" }, changed: true },
    { what: "deliveryDate", patch: { deliveryDate: "2026-08-20" }, changed: true },
    { what: "grossWeight", patch: { grossWeight: "24,500 KGS" }, changed: true },
    { what: "netWeight", patch: { netWeight: "23,100 KGS" }, changed: true },
    { what: "notes", patch: { notes: "Container stuffed at the factory." }, changed: true },
    { what: "date", patch: { date: "2026-07-12" }, changed: true },
    { what: "buyerPoNo", patch: { buyerPoNo: "PO-9999" }, changed: true },
    { what: "deliveryTerms", patch: { deliveryTerms: "CIF HOUSTON" }, changed: true },
    { what: "paymentTerms", patch: { paymentTerms: "100% Advance" }, changed: true },
    { what: "preCarriageBy", patch: { preCarriageBy: "By Rail" }, changed: true },
    { what: "placeOfReceipt", patch: { placeOfReceipt: "HOSUR" }, changed: true },
    { what: "portOfLoading", patch: { portOfLoading: "TUTICORIN" }, changed: true },
    { what: "portOfDischarge", patch: { portOfDischarge: "NEW YORK" }, changed: true },
    { what: "finalDestination", patch: { finalDestination: "AUSTIN, TX" }, changed: true },
    { what: "countryOfOrigin", patch: { countryOfOrigin: "India (Tamil Nadu)" }, changed: true },
    { what: "countryOfDestination", patch: { countryOfDestination: "CANADA" }, changed: true },
    { what: "clearing a text field", patch: { portOfDischarge: null }, changed: true },
    // the party branch
    { what: "consignee", patch: { consignee: { name: "Gulf Stone LLC", lines: ["Dubai"] } }, changed: true },
    { what: "notifyParty", patch: { notifyParty: { name: "Notify Co", lines: [] } }, changed: true },
    { what: "buyerIfNotConsignee", patch: { buyerIfNotConsignee: { name: "Buyer Co", lines: ["X"] } }, changed: true },
    // the money branches
    { what: "discount", patch: { discount: "324.657" }, changed: true },
    { what: "lines replaced", patch: { lines: [line] }, changed: true },
    { what: "lines emptied", patch: { lines: [] }, changed: true },
    { what: "one line's amount edited", patch: { lines: [{ ...base.lines[0], amount: 17324.66 }, base.lines[1]] }, changed: true },
    // and the paths that really are no-ops: the route may skip the write
    { what: "nothing at all", patch: {}, changed: false },
    { what: "a null body", patch: null, changed: false },
    { what: "a string body", patch: "nonsense", changed: false },
    { what: "the same vessel twice", patch: { vessel: null }, changed: false },
    { what: "the same discount", patch: { discount: 0 }, changed: false },
    { what: "a negative discount on a zero discount", patch: { discount: -50 }, changed: false },
    { what: "the same lines back", patch: { lines: base.lines }, changed: false },
    { what: "an emptied consignee (ignored)", patch: { consignee: null }, changed: false },
    { what: "a bad delivery date (ignored)", patch: { deliveryDate: "15/08/2026" }, changed: false },
    { what: "a bad date (ignored)", patch: { date: "not a date" }, changed: false },
    { what: "read-only fields", patch: { number: "X", revision: 9, currency: "EUR", totalAmount: 1, bank: { name: "Other" } }, changed: false },
  ];

  for (const c of cases) {
    const r = applyDraftPatch(base, c.patch);
    const moved = JSON.stringify(r.snapshot) !== JSON.stringify(base);
    assert.equal(r.changed, c.changed, `${c.what}: changed should be ${c.changed}`);
    assert.equal(
      moved, c.changed,
      `${c.what}: the snapshot ${moved ? "moved" : "did not move"} but changed says ${c.changed} — the route writes on this flag`,
    );
  }
});

test("applyDraftPatch: the PI tab's own save body reports changed, so the PATCH is written", () => {
  // exactly what PiTab.saveDraft posts, on a draft that has none of it yet
  const base = buildProformaSnapshot(exportOrder, S, opts);
  const body = {
    deliveryDate: "2026-08-20",
    vessel: "MSC ISABELLA / 431W",
    grossWeight: "24,500 KGS",
    netWeight: "23,100 KGS",
    discount: 324.657,
    notes: "Container stuffed at the factory.",
  };
  const first = applyDraftPatch(base, body);
  assert.equal(first.changed, true, "the first save must reach the database");
  assert.equal(first.snapshot.totalAmount, 17000, "and the discount re-derived the total");
  assert.equal(first.snapshot.amountInWords, "USD Seventeen Thousand only.");
  // saving the same form again is the one honest no-op
  const again = applyDraftPatch(first.snapshot, body);
  assert.equal(again.changed, false);
  assert.deepEqual(again.snapshot, first.snapshot);
  // and changing one field of it moves again
  assert.equal(applyDraftPatch(first.snapshot, { ...body, vessel: "MAERSK SENTOSA" }).changed, true);
  assert.equal(applyDraftPatch(first.snapshot, { ...body, discount: 0 }).changed, true);
  assert.equal(applyDraftPatch(first.snapshot, { ...body, notes: null }).changed, true);
});

test("the editable field list is the whole of what a draft edit may reach", () => {
  assert.ok(EDITABLE_TEXT_FIELDS.includes("deliveryDate"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("vessel"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("grossWeight"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("netWeight"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("notes"));
  for (const forbidden of ["number", "revision", "currency", "totalAmount", "amountInWords", "declaration"]) {
    assert.equal((EDITABLE_TEXT_FIELDS as readonly string[]).includes(forbidden), false, forbidden);
  }
});

// ───────────────────────────── revisions and status ──────────────────────────

test("nextRevision: 0 for the first, max + 1 after", () => {
  assert.equal(nextRevision([]), 0);
  assert.equal(nextRevision([{ revision: 0 }]), 1);
  assert.equal(nextRevision([{ revision: 0 }, { revision: 2 }, { revision: 1 }]), 3, "a gap does not get re-used");
  assert.equal(nextRevision([0, 4]), 5);
});

test("who may do what to a revision", () => {
  assert.equal(canEditDraft("DRAFT"), true);
  assert.equal(canEditDraft("ISSUED"), false);
  assert.equal(canIssue("DRAFT"), true);
  assert.equal(canIssue("ISSUED"), false);
  assert.equal(canIssue("CANCELLED"), false);
  assert.equal(canAccept("ISSUED"), true);
  assert.equal(canAccept("DRAFT"), false);
  assert.equal(canAccept("ACCEPTED"), false);
  assert.equal(canCancel("DRAFT"), true);
  assert.equal(canCancel("ISSUED"), true);
  assert.equal(canCancel("ACCEPTED"), true);
  assert.equal(canCancel("SUPERSEDED"), false);
  assert.equal(canCancel("CANCELLED"), false);
});

test("refuseIssue: names the reason, or nothing at all", () => {
  const s = buildProformaSnapshot(exportOrder, S, opts);
  assert.equal(refuseIssue({ status: "DRAFT", snapshot: s }), null);
  assert.match(refuseIssue({ status: "ISSUED", snapshot: s })!, /Only a draft can be issued/);
  assert.match(refuseIssue({ status: "ISSUED", snapshot: s })!, /issued/);
  assert.match(refuseIssue({ status: "DRAFT", snapshot: { lines: [] } })!, /no lines/);
  assert.match(refuseIssue({ status: "DRAFT", snapshot: null })!, /no lines/);
});

test("supersededIds: issuing kills the other live revisions of the same number, nothing else", () => {
  const all = [
    { id: "a", number: "SAL-ORD/26-27/01642", status: "ISSUED" },
    { id: "b", number: "SAL-ORD/26-27/01642", status: "ACCEPTED" },
    { id: "c", number: "SAL-ORD/26-27/01642", status: "DRAFT" },
    { id: "d", number: "SAL-ORD/26-27/01642", status: "CANCELLED" },
    { id: "e", number: "SAL-ORD/26-27/01642", status: "SUPERSEDED" },
    { id: "f", number: "SAL-ORD/26-27/01700", status: "ISSUED" },
    { id: "me", number: "SAL-ORD/26-27/01642", status: "DRAFT" },
  ];
  assert.deepEqual(supersededIds(all, { id: "me", number: "SAL-ORD/26-27/01642" }), ["a", "b"]);
  assert.deepEqual(supersededIds([], { id: "me", number: "X" }), []);
});

test("statusTone / parseProformaStatus / pageArgs", () => {
  assert.equal(statusTone("ISSUED"), "brand");
  assert.equal(statusTone("ACCEPTED"), "green");
  assert.equal(statusTone("DRAFT"), "amber");
  assert.equal(statusTone("CANCELLED"), "red");
  assert.equal(statusTone("SUPERSEDED"), "red");

  assert.equal(parseProformaStatus("issued"), "ISSUED");
  assert.equal(parseProformaStatus("ACCEPTED"), "ACCEPTED");
  assert.equal(parseProformaStatus("junk"), null);
  assert.equal(parseProformaStatus(null), null);

  assert.deepEqual(pageArgs(null, null), { page: 1, limit: 50, skip: 0 });
  assert.deepEqual(pageArgs("3", "20"), { page: 3, limit: 20, skip: 40 });
  assert.deepEqual(pageArgs("0", "9999"), { page: 1, limit: 200, skip: 0 });
  assert.deepEqual(pageArgs("abc", "abc"), { page: 1, limit: 50, skip: 0 });
});

// ───────────────────────────── what the PDF prints ───────────────────────────

test("piTableHeader: the reference's two-row header, with the currency in it", () => {
  const h = piTableHeader("usd");
  assert.deepEqual(h.top, ["Item Code", "Description of goods", "", "", "HSN/SAC", "Unit", "Quantity", "Rate In USD unit", "Total Amount in USD"]);
  assert.deepEqual(h.sub, ["Color", "Thick", "No of Slabs"]);
  assert.equal(piTableHeader("").top[8], "Total Amount in USD", "a snapshot with no currency still prints a header");
});

test("piRow / piTotalRow: nine cells, in the header's order", () => {
  const s = buildProformaSnapshot(exportOrder, S, opts);
  assert.deepEqual(piRow(s.lines[0]), [
    "VGWT10301A-Polish-Super Jumbo-30mm-Premium",
    "CARRARA ROYALE-Polish-Super Jumbo-30mm-Premium",
    "30mm", "43", "68101990", "Square Foot", "3208.273", "5.4", "17324.657",
  ]);
  assert.deepEqual(piRow(s.lines[1]), ["", "FREE TRADE SAMPLES", "30mm", "25", "68101990", "Nos", "0.000", "0", "0.000"]);
  assert.deepEqual(piTotalRow(s), ["", "Total", "", "68", "", "", "", "", "17324.657"]);
  assert.equal(piRow(s.lines[0]).length, piTableHeader("USD").top.length);
});

test("piPrintFields: everything the PI prints, formatted — and a blank is blank", () => {
  const issued = applyDraftPatch(
    buildProformaSnapshot(exportOrder, S, { ...opts, deliveryDate: "2026-08-15" }),
    { vessel: "MSC ISABELLA / 431W", grossWeight: "24,500 KGS", netWeight: "23,100 KGS", discount: 24.657, notes: "Stuffed at the factory." },
  ).snapshot;
  const f = piPrintFields({ ...issued, validUntil: "2026-08-09" });
  assert.equal(f.title, "PROFORMA INVOICE");
  assert.equal(f.invoiceNo, "SAL-ORD/26-27/01642");
  assert.equal(f.invoiceDate, "10-07-2026");
  assert.equal(f.deliveryDate, "15-08-2026");
  assert.equal(f.validUntil, "09-08-2026");
  assert.equal(f.buyerPoNo, "PO-4068622");
  assert.equal(f.rbiCode, "678");
  assert.equal(f.gstin, "33AALCP2750N1Z3");
  assert.equal(f.customsOffice, S.company.customsOffice.toUpperCase());
  assert.equal(f.countryOfOrigin, "India");
  assert.equal(f.countryOfDestination, "USA");
  assert.equal(f.deliveryTerms, "FOB CHENNAI");
  assert.equal(f.paymentTerms, "50% Advance, 50% Against Scanned BL");
  assert.equal(f.termsAndConditions, "Stuffed at the factory.");
  assert.equal(f.preCarriageBy, "By Road");
  assert.equal(f.vessel, "MSC ISABELLA / 431W");
  assert.equal(f.portOfLoading, "CHENNAI");
  assert.equal(f.portOfDischarge, "HOUSTON");
  assert.equal(f.finalDestination, "DALLAS, TX");
  assert.equal(f.bankName, "Kotak Mahindra Bank Limited");
  assert.equal(f.adCode, "0180038-8400009");
  assert.equal(f.accountNo, "3214292773");
  assert.equal(f.ifsc, "KKBK0000422");
  assert.equal(f.swift, "KKBKINBBXXX");
  assert.equal(f.routingSwift, "IRVTUS3NXXX");
  assert.equal(f.grossWeight, "24,500 KGS");
  assert.equal(f.netWeight, "23,100 KGS");
  assert.equal(f.discount, "24.657");
  assert.equal(f.totalAmount, "17300.000");
  assert.equal(f.totalSlabs, "68");
  assert.equal(f.currency, "USD");
  assert.equal(f.amountInWords, "USD Seventeen Thousand, Three Hundred only.");
  assert.equal(f.declaration, S.texts.piDeclaration);
});

test("piPrintFields: an empty domestic PI prints empty cells, never None or null", () => {
  const bare = buildProformaSnapshot({ number: "SAL-ORD/26-27/01701", kind: "DOMESTIC", items: [] }, S, { revision: 2, date: "2026-09-06" });
  const f = piPrintFields(bare);
  assert.equal(f.invoiceNo, "SAL-ORD/26-27/01701-R2");
  assert.equal(f.buyerPoNo, "");
  assert.equal(f.deliveryDate, "");
  assert.equal(f.validUntil, "");
  assert.equal(f.vessel, "");
  assert.equal(f.portOfLoading, "");
  assert.equal(f.portOfDischarge, "");
  assert.equal(f.finalDestination, "");
  assert.equal(f.grossWeight, "");
  assert.equal(f.netWeight, "");
  assert.equal(f.discount, "", "a zero discount prints nothing, not 0.000");
  assert.equal(f.termsAndConditions, "");
  assert.equal(f.bankName, "Kotak Mahindra Bank Limited", "a domestic PI carries the PI's bank (§23), not the DTA invoice's");
  assert.equal(f.routingBank, S.banks.export.routingBank, "it is the Kotak block whole, on both kinds");
  assert.equal(f.routingSwift, "IRVTUS3NXXX");
  for (const [k, v] of Object.entries(f)) {
    assert.equal(typeof v, "string", k);
    assert.ok(!/^(None|null|undefined)$/.test(v), `${k} printed ${v}`);
  }
});

test("orderWarnings: what the PI tab says before anyone builds a document", () => {
  assert.deepEqual(orderWarnings({ items: [quartzLine], consignee: { name: "Gulf Stone LLC", lines: [] } }), []);
  const noItems = orderWarnings({ items: [], consignee: { name: "Gulf Stone LLC", lines: [] } });
  assert.equal(noItems.length, 1);
  assert.match(noItems[0], /no items/);
  const nothing = orderWarnings({ items: null, consignee: null, client: null });
  assert.equal(nothing.length, 2);
  assert.match(nothing[1], /consignee/);
  assert.deepEqual(
    orderWarnings({ items: [quartzLine], consignee: null, client: { name: "Surfaces by Pacific", address: "4141 Blue Star Street" } }),
    [],
    "the client master is a good enough consignee",
  );
});

test("a snapshot round-trips through JSON — it is stored in a Json column", () => {
  const s = buildProformaSnapshot(exportOrder, S, opts);
  const back = JSON.parse(JSON.stringify(s)) as ProformaSnapshot;
  assert.deepEqual(back, s);
  assert.deepEqual(piRow(back.lines[0]), piRow(s.lines[0]));
  assert.equal(piPrintFields(back).totalAmount, "17324.657");
});
