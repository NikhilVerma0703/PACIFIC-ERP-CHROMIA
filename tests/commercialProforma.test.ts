// Proforma-invoice rules, RUN against the real reference document: how an order
// becomes the snapshot a PI prints, how a line is composed, how the totals and
// the amount in words are derived, what a draft edit may touch, which status
// may move where, what a revision inherits and what it cancels, when issuing
// is refused, and every string the PDF puts in a cell.
//
// The reference is the 1404 PI (Surfaces by Pacific, 10-07-2026):
//   VGWT10301A-Polish-Super Jumbo-30mm-Premium / CARRARA ROYALE-…
//   43 slabs, HSN 68101990, Square Foot, 3208.273 × 5.4 = 17324.657
// — and 3208.273 × 5.4 is 17324.6742, NOT 17324.657, which is the whole reason
// a stored amount is printed and never recomputed.
//
// The owner's answers of 2026-09-07 (DECISIONS.md) that this file pins:
//   1   stock check before the PI (piIssueRefusal asks stages.canEnter)
//   5/8 the PI's own counter, SAL-ORD/{fy}/N{seq} — never the order's number
//   21  a GSTIN dropdown, the company's own by default
//   23  Kotak on export, ICICI on domestic, changeable before issue
//   24  no validity; a revision is a NEW number and the old PI is CANCELLED;
//       nothing is re-numbered, no suffix, no reuse
//
// proforma-rules imports only sibling pure modules by path, so node --test
// loads it bare: no Next, no Prisma, no session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  printable, round3, round2, printThickness, unitLabel, trimNumber, fmtQty, fmtAmount, fmtRate, fmtSlabs,
  formatPiDate, isoDate, validUntilFor, piFilename, printedNumber,
  buildItemCode, buildDescription, buildLine, sanitiseLine, recomputeTotals,
  clientParty, exporterParty, buildProformaSnapshot, applyDraftPatch, piAmountInWords,
  defaultBankKey, parseBankKey, piBank, bankBlock, gstinChoiceFor, piChoices, BANK_KEYS,
  piWriteRefusal, PI_READ_ONLY_HINT, PI_NO_WRITE_ACTION_HINT,
  nextRevision, canEditDraft, canIssue, canAccept, canCancel, canRevise, refuseIssue,
  piIssueRefusal, revisionReason, revisedByIssue, carriedIntoRevision, refuseCancel,
  replacementOf, registerOrder, type RegisterRow,
  revisesAtIssue, refreezeAtIssue, revisionDraftFor, refuseRevise,
  statusTone, pageArgs, parseProformaStatus, partyBlock, piTableHeader, piRow, piTotalRow,
  piPrintFields, orderWarnings, piSalesperson, printsParty,
  EDITABLE_TEXT_FIELDS,
  type SnapshotOrderInput, type SnapshotItemInput, type PiSnapshot,
} from "../src/lib/commercial/proforma-rules.ts";
import { DEFAULT_SETTINGS, gstinChoices, type CommercialSettings } from "../src/lib/commercial/settings-defaults.ts";
import { canEnter } from "../src/lib/commercial/stages.ts";

const S = DEFAULT_SETTINGS;
const OWN_GSTIN = S.company.gstin;                       // 33AALCP2750N1Z3
const ALT_GSTIN = gstinChoices(S.company)[1].gstin;      // 33AAFCP5374A1ZQ, the PGI line

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

// The ORDER has its own number (ORD/…); the PI's number comes from the
// proforma counter and is passed in as opts.number. The two must never be
// confused again, so the fixtures keep them visibly different.
const exportOrder: SnapshotOrderInput = {
  number: "ORD/26-27/N7",
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
  number: "ORD/26-27/N8",
  kind: "DOMESTIC",
  currency: "INR",
  client: { name: "JB Homes", address: "No 4, Race Course Road", city: "Coimbatore", country: "India", commercialExt: { gstin: "33AABCJ1234K1Z5", stateCode: "33" } },
  items: [{ lineNo: 1, design: "Statuario Bianco", thickness: "2 cm", qtySlabs: 6, qty: 784.887, uom: "SQFT", rate: 210, amount: 164826.27, hsn: "68101990" }],
};

const PI_NO = "SAL-ORD/26-27/N3";
const opts = { number: PI_NO, revision: 0, date: "2026-07-10", validUntil: null };

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
  assert.equal(round2(100.255), 100.26);
});

test("dates: stored YYYY-MM-DD, printed DD-MM-YYYY, blank stays blank", () => {
  assert.equal(formatPiDate("2026-07-10"), "10-07-2026");
  assert.equal(formatPiDate("2026-07-10T09:30:00.000Z"), "10-07-2026", "an ISO timestamp prints as its day");
  assert.equal(formatPiDate(null), "");
  assert.equal(formatPiDate(""), "");
  assert.equal(formatPiDate("None"), "");
  assert.equal(isoDate(new Date("2026-07-10T23:45:00.000Z")), "2026-07-10");
});

test("validUntilFor: 0 days is NO validity (answer 24), a positive setting is the issue day plus the days", () => {
  const issued = new Date("2026-07-10T09:30:00.000Z");
  // The default is forever. The bug this pins: the first cut answered the
  // issue day itself for 0, so a PI would have "expired" the day it went out.
  assert.equal(S.piValidityDays, 0, "the default is forever (DECISIONS.md 24)");
  assert.equal(validUntilFor(issued, S.piValidityDays), null);
  assert.equal(validUntilFor(issued, 0), null);
  assert.equal(validUntilFor(issued, -5), null, "a negative setting is not a validity either");
  assert.equal(validUntilFor(issued, Number.NaN), null);
  // and the days path stays for the day the owner sets a number
  assert.equal(validUntilFor(issued, 30), "2026-08-09");
  assert.equal(validUntilFor(new Date("2026-02-27T00:00:00.000Z"), 3), "2026-03-02", "no leap day in 2026");
  assert.equal(validUntilFor(issued, 0.4), null, "rounds to whole days before deciding");
});

test("piFilename / printedNumber: a slash is not a filename; the number prints whole, with no revision suffix (answer 24)", () => {
  assert.equal(piFilename("SAL-ORD/26-27/N3"), "SAL-ORD-26-27-N3.pdf");
  assert.equal(piFilename("SAL-ORD/26-27/N142"), "SAL-ORD-26-27-N142.pdf");
  assert.equal(piFilename(""), "proforma.pdf");
  assert.equal(piFilename('a:b*c?"d<e>f|g'), "a-b-c-d-e-f-g.pdf");
  // A revision is a NEW number, so there is nothing to suffix: N3 prints as N3.
  assert.equal(printedNumber("SAL-ORD/26-27/N3"), "SAL-ORD/26-27/N3");
  assert.equal(printedNumber(" SAL-ORD/26-27/N3 "), "SAL-ORD/26-27/N3");
  assert.doesNotMatch(printedNumber("SAL-ORD/26-27/N3"), /-R\d+$/);
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
    buildProformaSnapshot({ ...domesticOrder, items: [{ ...domesticOrder.items![0], amount }] }, S, { number: PI_NO, revision: 0, date: "2026-07-12" });

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
  }, S, { number: PI_NO, revision: 0, date: "2026-07-12" });
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

test("exporterParty: the company master, under the chosen registration (answer 21)", () => {
  const e = exporterParty(S);
  assert.equal(e.name, "Pacific Engineered Surfaces Private Limited");
  assert.deepEqual(e.lines, S.company.addressLines);
  assert.equal(e.gstin, OWN_GSTIN, "no choice → the company's own");
  assert.equal(e.country, "India");
  assert.equal(exporterParty(S, ALT_GSTIN).gstin, ALT_GSTIN);
  assert.equal(exporterParty(S, "").gstin, OWN_GSTIN, "a blank choice is no choice");
  assert.equal(exporterParty(S, null).gstin, OWN_GSTIN);
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

// ───────────────────────────── the two choices ───────────────────────────────

test("defaultBankKey / parseBankKey: ICICI on domestic, Kotak on international (answer 23); a typo is no choice", () => {
  assert.equal(defaultBankKey("DOMESTIC"), "domestic");
  assert.equal(defaultBankKey("EXPORT"), "export");
  assert.equal(defaultBankKey("anything else"), "export", "a PI of unknown kind is an export PI");
  assert.equal(parseBankKey("export"), "export");
  assert.equal(parseBankKey(" DOMESTIC "), "domestic");
  assert.equal(parseBankKey("kotak"), null, "the key is the settings slot, not the bank's name");
  assert.equal(parseBankKey(null), null);
  assert.equal(parseBankKey(""), null);
  assert.deepEqual([...BANK_KEYS], ["export", "domestic"]);
});

test("piBank / bankBlock: the account is the settings slot, frozen as a copy", () => {
  assert.equal(piBank(S, "export").name, "Kotak Mahindra Bank Limited");
  assert.equal(piBank(S, "domestic").name, "ICICI Bank");
  const block = bankBlock(S.banks.export);
  assert.deepEqual(block, {
    name: "Kotak Mahindra Bank Limited",
    address: S.banks.export.address,
    accountNo: "3214292773",
    ifsc: "KKBK0000422",
    swift: "KKBKINBBXXX",
    adCode: "0180038-8400009",
    routingBank: S.banks.export.routingBank,
    routingSwift: "IRVTUS3NXXX",
  });
  assert.notEqual(block, S.banks.export, "a copy, so a later settings edit cannot change a PI the customer holds");
  assert.equal(bankBlock(S.banks.domestic).adCode, undefined, "ICICI has no AD code and the block does not invent one");
});

test("gstinChoiceFor: the company's own by default, an alternate when it is on the list, own again for a stranger", () => {
  assert.equal(gstinChoiceFor(S, null).gstin, OWN_GSTIN);
  assert.equal(gstinChoiceFor(S, undefined).gstin, OWN_GSTIN);
  assert.equal(gstinChoiceFor(S, "").gstin, OWN_GSTIN);
  assert.equal(gstinChoiceFor(S, ALT_GSTIN).gstin, ALT_GSTIN);
  assert.equal(gstinChoiceFor(S, ALT_GSTIN).label, "Pacific Granites (India) Pvt Ltd");
  assert.equal(gstinChoiceFor(S, ALT_GSTIN.toLowerCase()).gstin, ALT_GSTIN, "case does not matter");
  // A GSTIN removed from Settings after the draft was built must not print as
  // a blank on the customer's paper.
  assert.equal(gstinChoiceFor(S, "29ZZZZZ9999Z1Z9").gstin, OWN_GSTIN);
  assert.equal(gstinChoiceFor(S, OWN_GSTIN).label, S.company.legalName);
});

test("piChoices: what the PI tab's dropdowns offer, labels only — plus the area's own answer", () => {
  const c = piChoices(S, "write");
  assert.deepEqual(c.banks, [
    { key: "export", label: "Kotak Mahindra Bank Limited (export)" },
    { key: "domestic", label: "ICICI Bank (domestic)" },
  ]);
  assert.deepEqual(c.gstins.map((g) => g.gstin), [OWN_GSTIN, ALT_GSTIN]);
  assert.equal(c.piValidityDays, 0);
  assert.equal(piChoices({ ...S, piValidityDays: 30 }, "write").piValidityDays, 30);
  assert.equal(piChoices({ ...S, piValidityDays: -3 }, "write").piValidityDays, 0, "a negative setting reads as forever");
  assert.equal(JSON.stringify(c).includes(S.banks.export.accountNo), false, "no account number leaves through the choices route");
  // The tab cannot learn this from the action list the workspace passes down
  // (answers 1, 2: Raghav and Murali write elsewhere and only read PIs), so
  // the choices payload carries it.
  assert.equal(c.access, "write");
  assert.equal(piChoices(S, "view").access, "view");
});

test("piWriteRefusal: a PI write this login cannot make is DISABLED with the reason, never hidden", () => {
  // Setumani / the manager: the write action AND the proforma area.
  assert.equal(piWriteRefusal(["view", "write", "cancel"], "write"), null);
  // Raghav and Murali hold "write" for their own screens and only READ PIs —
  // the whole reason the action list alone is not the question (answers 1, 2).
  assert.equal(piWriteRefusal(["view", "write"], "view"), PI_READ_ONLY_HINT);
  assert.equal(piWriteRefusal(["view", "write"], "none"), PI_READ_ONLY_HINT);
  // No write action at all.
  assert.equal(piWriteRefusal(["view"], "write"), PI_NO_WRITE_ACTION_HINT);
  assert.equal(piWriteRefusal([], null), PI_NO_WRITE_ACTION_HINT);
  // Unknown (the choices call is in flight, or it failed): the buttons stay
  // live and the route is the authority — a hiccup must not grey the tab out.
  assert.equal(piWriteRefusal(["view", "write"], null), null);
  assert.equal(piWriteRefusal(["view", "write"], undefined), null);
  // Every refusal is a sentence a person can act on, not a bare "no".
  for (const hint of [PI_READ_ONLY_HINT, PI_NO_WRITE_ACTION_HINT]) {
    assert.ok(hint.length > 20 && /login/i.test(hint), hint);
  }
});

// ───────────────────────────── the snapshot ──────────────────────────────────

test("buildProformaSnapshot (EXPORT): the reference PI, field by field — under the PI's OWN number", () => {
  const s = buildProformaSnapshot(exportOrder, S, { ...opts, deliveryDate: "2026-08-15" });
  assert.equal(s.number, PI_NO, "the number is the proforma counter's (answers 5, 8, 24)");
  assert.notEqual(s.number, exportOrder.number, "…and never the order's");
  assert.equal(s.revision, 0);
  assert.equal(s.date, "2026-07-10");
  assert.equal(s.deliveryDate, "2026-08-15");
  assert.equal(s.validUntil, null, "answer 24: no validity");
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
  assert.equal(s.bankKey, "export", "answer 23: Kotak on international by default");
  assert.equal(s.bank.name, "Kotak Mahindra Bank Limited");
  assert.equal(s.bank.adCode, "0180038-8400009");
  assert.equal(s.bank.routingSwift, "IRVTUS3NXXX");
  assert.equal(s.gstinKey, OWN_GSTIN, "answer 21: the company's own by default");
  assert.equal(s.company.gstin, OWN_GSTIN);
  assert.equal(s.exporter.gstin, OWN_GSTIN);
  assert.equal(s.company.rbiCode, "678");
  assert.equal(s.declaration, S.texts.piDeclaration);
  assert.equal(s.grossWeight, null);
  assert.equal(s.netWeight, null);
  assert.equal(s.revises, null);
});

test("buildProformaSnapshot (DOMESTIC): CM thickness, the SQFT code, ICICI by default, rupees and paise in words", () => {
  const s = buildProformaSnapshot(domesticOrder, S, { number: "SAL-ORD/26-27/N4", revision: 1, date: "2026-07-12" });
  assert.equal(s.number, "SAL-ORD/26-27/N4");
  assert.equal(s.kind, "DOMESTIC");
  assert.equal(s.currency, "INR");
  assert.equal(s.revision, 1);
  assert.equal(s.lines[0].thickness, "2 CM");
  assert.equal(s.lines[0].unit, "SQFT");
  // Answer 23: "ICICI on domestic, Kotak on international".
  assert.equal(s.bankKey, "domestic");
  assert.equal(s.bank.name, "ICICI Bank");
  assert.equal(s.bank.accountNo, "020405012473");
  assert.equal(s.bank.ifsc, "ICIC0000204");
  assert.equal(s.deliveryTerms, "Ex-Factory Without Packing", "the domestic default");
  assert.equal(s.paymentTerms, "100% Advance Payment");
  assert.equal(s.preCarriageBy, null, "a domestic PI has no pre-carriage default");
  assert.equal(s.portOfLoading, null);
  assert.equal(s.countryOfDestination, "India");
  assert.equal(s.totalAmount, 164826.27);
  assert.equal(s.amountInWords, "One Lakh Sixty Four Thousand Eight Hundred Twenty Six Rupees and Twenty Seven Paise Only.");
  assert.equal(s.consignee.gstin, "33AABCJ1234K1Z5");
});

test("buildProformaSnapshot: the dropdowns' choices override the kind's defaults (answers 21, 23)", () => {
  const dom = buildProformaSnapshot(domesticOrder, S, { ...opts, bankKey: "export" });
  assert.equal(dom.bankKey, "export");
  assert.equal(dom.bank.name, "Kotak Mahindra Bank Limited", "a domestic customer may still be asked to wire to Kotak");
  const exp = buildProformaSnapshot(exportOrder, S, { ...opts, bankKey: "domestic", gstinKey: ALT_GSTIN });
  assert.equal(exp.bankKey, "domestic");
  assert.equal(exp.bank.name, "ICICI Bank");
  assert.equal(exp.gstinKey, ALT_GSTIN);
  assert.equal(exp.company.gstin, ALT_GSTIN, "the printed GSTIN follows the choice…");
  assert.equal(exp.exporter.gstin, ALT_GSTIN, "…in both places it prints");
  assert.equal(exp.company.legalName, S.company.legalName, "the name does not: the PI is still PESPL's paper");
  const stranger = buildProformaSnapshot(exportOrder, S, { ...opts, gstinKey: "29ZZZZZ9999Z1Z9", bankKey: null });
  assert.equal(stranger.gstinKey, OWN_GSTIN);
  assert.equal(stranger.bankKey, "export");
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

test("applyDraftPatch: the bank and GSTIN choices re-freeze from Settings — and only when Settings are passed", () => {
  const base = buildProformaSnapshot(exportOrder, S, opts);
  // the bank
  const toIcici = applyDraftPatch(base, { bankKey: "domestic" }, S);
  assert.equal(toIcici.changed, true);
  assert.equal(toIcici.snapshot.bankKey, "domestic");
  assert.equal(toIcici.snapshot.bank.name, "ICICI Bank");
  assert.equal(toIcici.snapshot.bank.accountNo, "020405012473");
  assert.equal(toIcici.snapshot.bank.adCode, undefined, "the whole block is re-frozen, not patched over Kotak's");
  assert.equal(applyDraftPatch(base, { bankKey: "export" }, S).changed, false, "the same key is a no-op");
  assert.equal(applyDraftPatch(base, { bankKey: "kotak" }, S).changed, false, "a typo changes nothing rather than blanking the bank");
  assert.equal(applyDraftPatch(base, { bankKey: "domestic" }).changed, false, "no settings, no re-freeze: the route always passes them");
  // the GSTIN
  const toAlt = applyDraftPatch(base, { gstinKey: ALT_GSTIN }, S);
  assert.equal(toAlt.changed, true);
  assert.equal(toAlt.snapshot.gstinKey, ALT_GSTIN);
  assert.equal(toAlt.snapshot.company.gstin, ALT_GSTIN);
  assert.equal(toAlt.snapshot.exporter.gstin, ALT_GSTIN);
  assert.equal(toAlt.snapshot.exporter.name, base.exporter.name);
  assert.equal(applyDraftPatch(base, { gstinKey: OWN_GSTIN }, S).changed, false);
  assert.equal(applyDraftPatch(base, { gstinKey: "29ZZZZZ9999Z1Z9" }, S).changed, false, "a stranger falls back to the own GSTIN the draft already has");
  assert.equal(applyDraftPatch(toAlt.snapshot, { gstinKey: "29ZZZZZ9999Z1Z9" }, S).snapshot.gstinKey, OWN_GSTIN, "…and back to own when the draft was on an alternate");
  // the bank block itself and the company block are NOT editable directly
  const direct = applyDraftPatch(base, { bank: { name: "Some Other Bank" }, company: { gstin: ALT_GSTIN } }, S);
  assert.equal(direct.changed, false);
  assert.equal(direct.snapshot.bank.name, "Kotak Mahindra Bank Limited");
  assert.equal(direct.snapshot.company.gstin, OWN_GSTIN);
});

test("applyDraftPatch: everything the customer's paper identity depends on is ignored", () => {
  const base = buildProformaSnapshot(exportOrder, S, opts);
  const { snapshot, changed } = applyDraftPatch(base, {
    number: "SAL-ORD/26-27/N999",
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
    revises: { id: "x", number: "SAL-ORD/26-27/N1" },
    validUntil: "2030-01-01",
  }, S);
  assert.equal(changed, false);
  assert.equal(snapshot.number, PI_NO);
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.kind, "EXPORT");
  assert.equal(snapshot.currency, "USD");
  assert.equal(snapshot.totalAmount, 17324.657);
  assert.equal(snapshot.bank.name, "Kotak Mahindra Bank Limited");
  assert.equal(snapshot.company.legalName, "Pacific Engineered Surfaces Private Limited");
  assert.equal(snapshot.declaration, S.texts.piDeclaration);
  assert.equal(snapshot.exporter.name, "Pacific Engineered Surfaces Private Limited");
  assert.equal(snapshot.revises, null);
  assert.equal(snapshot.validUntil, null, "validity is the issue route's to set, never a draft edit's");
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
  const base = JSON.parse(JSON.stringify(buildProformaSnapshot(exportOrder, S, opts))) as PiSnapshot;
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
    // the two choices (answers 21, 23)
    { what: "bankKey", patch: { bankKey: "domestic" }, changed: true },
    { what: "gstinKey", patch: { gstinKey: ALT_GSTIN }, changed: true },
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
    { what: "the same bank key", patch: { bankKey: "export" }, changed: false },
    { what: "a bank key typo", patch: { bankKey: "kotak" }, changed: false },
    { what: "the same GSTIN", patch: { gstinKey: OWN_GSTIN }, changed: false },
    { what: "an unknown GSTIN on a draft already on its own", patch: { gstinKey: "29ZZZZZ9999Z1Z9" }, changed: false },
    { what: "read-only fields", patch: { number: "X", revision: 9, currency: "EUR", totalAmount: 1, bank: { name: "Other" }, validUntil: "2030-01-01" }, changed: false },
  ];

  for (const c of cases) {
    const r = applyDraftPatch(base, c.patch, S);
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
    bankKey: "export",
    gstinKey: OWN_GSTIN,
  };
  const first = applyDraftPatch(base, body, S);
  assert.equal(first.changed, true, "the first save must reach the database");
  assert.equal(first.snapshot.totalAmount, 17000, "and the discount re-derived the total");
  assert.equal(first.snapshot.amountInWords, "USD Seventeen Thousand only.");
  // saving the same form again is the one honest no-op
  const again = applyDraftPatch(first.snapshot, body, S);
  assert.equal(again.changed, false);
  assert.deepEqual(again.snapshot, first.snapshot);
  // and changing one field of it moves again
  assert.equal(applyDraftPatch(first.snapshot, { ...body, vessel: "MAERSK SENTOSA" }, S).changed, true);
  assert.equal(applyDraftPatch(first.snapshot, { ...body, discount: 0 }, S).changed, true);
  assert.equal(applyDraftPatch(first.snapshot, { ...body, notes: null }, S).changed, true);
  assert.equal(applyDraftPatch(first.snapshot, { ...body, bankKey: "domestic" }, S).changed, true);
  assert.equal(applyDraftPatch(first.snapshot, { ...body, gstinKey: ALT_GSTIN }, S).changed, true);
});

test("the editable field list is the whole of what a draft edit may reach", () => {
  assert.ok(EDITABLE_TEXT_FIELDS.includes("deliveryDate"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("vessel"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("grossWeight"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("netWeight"));
  assert.ok(EDITABLE_TEXT_FIELDS.includes("notes"));
  for (const forbidden of ["number", "revision", "currency", "totalAmount", "amountInWords", "declaration", "validUntil", "bankKey", "gstinKey", "revises"]) {
    assert.equal((EDITABLE_TEXT_FIELDS as readonly string[]).includes(forbidden), false, forbidden);
  }
});

// ───────────────────────────── revisions and status ──────────────────────────

test("nextRevision: 0 for the first, max + 1 after — an ordinal, never part of the number", () => {
  assert.equal(nextRevision([]), 0);
  assert.equal(nextRevision([{ revision: 0 }]), 1);
  assert.equal(nextRevision([{ revision: 0 }, { revision: 2 }, { revision: 1 }]), 3, "a gap does not get re-used");
  assert.equal(nextRevision([0, 4]), 5);
  const second = buildProformaSnapshot(exportOrder, S, { ...opts, number: "SAL-ORD/26-27/N9", revision: nextRevision([{ revision: 0 }]) });
  assert.equal(second.revision, 1);
  assert.equal(printedNumber(second.number), "SAL-ORD/26-27/N9", "the ordinal does not print");
  assert.equal(piPrintFields(second).invoiceNo, "SAL-ORD/26-27/N9");
});

test("who may do what to a PI", () => {
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
  // a revision replaces paper the customer holds; a draft is edited, a cancelled one is history
  assert.equal(canRevise("ISSUED"), true);
  assert.equal(canRevise("ACCEPTED"), true);
  assert.equal(canRevise("DRAFT"), false);
  assert.equal(canRevise("CANCELLED"), false);
  assert.equal(canRevise("SUPERSEDED"), false);
});

test("refuseIssue: names the reason, or nothing at all", () => {
  const s = buildProformaSnapshot(exportOrder, S, opts);
  assert.equal(refuseIssue({ status: "DRAFT", snapshot: s }), null);
  assert.match(refuseIssue({ status: "ISSUED", snapshot: s })!, /Only a draft can be issued/);
  assert.match(refuseIssue({ status: "ISSUED", snapshot: s })!, /issued/);
  assert.match(refuseIssue({ status: "DRAFT", snapshot: { lines: [] } })!, /no lines/);
  assert.match(refuseIssue({ status: "DRAFT", snapshot: null })!, /no lines/);
});

test("piIssueRefusal (answer 1): no PI without a stock check — a stamp AND a live hold — in canEnter's own words", () => {
  const stamp = "2026-09-01T10:00:00.000Z";
  const gateWords = (canEnter("STOCK_CHECKED", "PI_ISSUED", { stockChecked: false }) as { reason: string }).reason;
  assert.match(gateWords, /Stock check first/);

  // the ordinary first PI
  assert.equal(piIssueRefusal({ status: "STOCK_CHECKED", stockCheckedAt: stamp, activeHolds: 1 }), null);
  assert.equal(piIssueRefusal({ status: "CONFIRMED", stockCheckedAt: null, activeHolds: 0 }), gateWords, "the same words the stage strip shows");
  assert.equal(piIssueRefusal({ status: "CONFIRMED", stockCheckedAt: stamp, activeHolds: 0 }), gateWords, "the stamp alone is history: the hold lapsed (answer 11)");
  assert.equal(piIssueRefusal({ status: "STOCK_CHECKED", stockCheckedAt: null, activeHolds: 1 }), gateWords, "a hold with no stamp is not a stock check either");
  assert.equal(piIssueRefusal({ status: "DRAFT", stockCheckedAt: null, activeHolds: 0 }), gateWords);
  assert.equal(piIssueRefusal({ status: "CONFIRMED", stockCheckedAt: new Date(stamp), activeHolds: 2 }), null, "a Date works as well as an ISO string");

  // a revision: the order already stands at PI_ISSUED (or further) — not a
  // stage move, so canEnter's "Already PI issued" no-op must not refuse it
  assert.equal(piIssueRefusal({ status: "PI_ISSUED", stockCheckedAt: stamp, activeHolds: 1 }), null);
  assert.equal(piIssueRefusal({ status: "PI_ISSUED", stockCheckedAt: stamp, activeHolds: 0 }), gateWords, "…but the stock gate still holds on a revision");
  assert.equal(piIssueRefusal({ status: "PACKING", stockCheckedAt: stamp, activeHolds: 1 }), null);

  // a terminal order never gets a PI
  assert.match(piIssueRefusal({ status: "CANCELLED", stockCheckedAt: stamp, activeHolds: 1 })!, /cannot move/);
  assert.match(piIssueRefusal({ status: "CLOSED", stockCheckedAt: stamp, activeHolds: 1 })!, /cannot move/);
});

test("revisionReason / revisedByIssue (answer 24): the old PI is CANCELLED as revised, by number, on the same order only", () => {
  assert.equal(revisionReason("SAL-ORD/26-27/N4"), "Revised as SAL-ORD/26-27/N4");
  assert.equal(revisionReason("  SAL-ORD/26-27/N4 "), "Revised as SAL-ORD/26-27/N4");

  const all = [
    { id: "a", orderId: "o1", status: "ISSUED" },
    { id: "b", orderId: "o1", status: "ACCEPTED" },
    { id: "c", orderId: "o1", status: "DRAFT" },
    { id: "d", orderId: "o1", status: "CANCELLED" },
    { id: "e", orderId: "o1", status: "SUPERSEDED" },
    { id: "f", orderId: "o2", status: "ISSUED" },
    { id: "me", orderId: "o1", status: "DRAFT" },
  ];
  assert.deepEqual(revisedByIssue(all, { id: "me", orderId: "o1" }), ["a", "b"], "the live ones of this order, not drafts, not history, not another order, not itself");
  assert.deepEqual(revisedByIssue([], { id: "me", orderId: "o1" }), []);
  assert.deepEqual(revisedByIssue([{ id: "me", orderId: "o1", status: "ISSUED" }], { id: "me", orderId: "o1" }), [], "a PI does not revise itself");
});

// Answer 24, the revise/issue split: /revise leaves the old PI ISSUED and only
// drafts the replacement, so the order is never without a live PI between the
// two; the retirement happens at ISSUE, in one transaction with the new paper
// going live. These four helpers are everything the two routes decide.

test("revisionDraftFor / refuseRevise (answer 24): the old PI stays live, and a second revision of it is refused while the first draft exists", () => {
  const live = { id: "old", status: "ISSUED" };

  // nothing pending → the revision may go ahead
  assert.equal(refuseRevise(live, []), null);
  assert.equal(refuseRevise({ id: "old", status: "ACCEPTED" }, []), null, "accepted paper is revisable too");

  // only paper the customer holds is revisable — a draft is simply edited,
  // history is history
  assert.match(refuseRevise({ id: "old", status: "DRAFT" }, [])!, /Only an issued or accepted PI can be revised \(this PI is draft\)/);
  assert.match(refuseRevise({ id: "old", status: "CANCELLED" }, [])!, /this PI is cancelled/);
  assert.match(refuseRevise({ id: "old", status: "SUPERSEDED" }, [])!, /this PI is superseded/);

  const siblings = [
    { id: "d1", number: "SAL-ORD/26-27/N9", status: "DRAFT", snapshot: { revises: null } },
    { id: "d2", number: "SAL-ORD/26-27/N4", status: "DRAFT", snapshot: { revises: { id: "old", number: "SAL-ORD/26-27/N3" } } },
    { id: "x", number: "SAL-ORD/26-27/N5", status: "ISSUED", snapshot: { revises: { id: "old", number: "SAL-ORD/26-27/N3" } } },
  ];
  assert.equal(revisionDraftFor(siblings, "old")!.id, "d2", "the DRAFT that already revises it");
  assert.equal(revisionDraftFor(siblings, "other"), null, "a draft revising a different PI is not in the way");
  assert.equal(revisionDraftFor([siblings[0], siblings[2]], "old"), null, "an ISSUED revision does not block — it already retired the old one");

  // the 409 the route returns: two clerks would take two numbers off the
  // counter and leave two drafts racing to retire one paper
  const refusal = refuseRevise(live, siblings)!;
  assert.match(refusal, /A draft revising this PI already exists \(SAL-ORD\/26-27\/N4\)/);
  assert.match(refusal, /edit and issue that one/);

  // a draft that revises it and was then abandoned as CANCELLED does not block
  assert.equal(refuseRevise(live, [{ id: "d2", number: "SAL-ORD/26-27/N4", status: "CANCELLED", snapshot: { revises: { id: "old", number: "SAL-ORD/26-27/N3" } } }]), null);
});

test("revisesAtIssue: paper issued over a live PI always names what it retired, even when it was not drafted through /revise", () => {
  const retired = [
    { id: "o2", number: "SAL-ORD/26-27/N2" },
    { id: "o3", number: "SAL-ORD/26-27/N3" },
  ];

  // a draft from /revise already carries the link — it is never overwritten,
  // because the paper names what the clerk actually revised
  assert.deepEqual(revisesAtIssue({ id: "o1", number: "SAL-ORD/26-27/N1" }, retired), { id: "o1", number: "SAL-ORD/26-27/N1" });
  assert.deepEqual(revisesAtIssue({ id: "o1", number: "SAL-ORD/26-27/N1" }, []), { id: "o1", number: "SAL-ORD/26-27/N1" });

  // a draft built straight off the order carries none — link it to what it
  // retired, or the chain has a hole nobody reading the register can close
  assert.deepEqual(revisesAtIssue(null, retired), { id: "o3", number: "SAL-ORD/26-27/N3" }, "the last retired is the one the customer held most recently");
  assert.deepEqual(revisesAtIssue(undefined, [retired[0]]), { id: "o2", number: "SAL-ORD/26-27/N2" });

  // the first PI of an order retires nothing and revises nothing
  assert.equal(revisesAtIssue(null, []), null);
  assert.equal(revisesAtIssue({ id: "", number: "" }, []), null, "a blank link is no link");
});

test("refreezeAtIssue: the bank and the GSTIN are read from Settings at the moment the paper goes out, not when the draft was built", () => {
  const draft = applyDraftPatch(
    buildProformaSnapshot(exportOrder, S, opts),
    { bankKey: "export", gstinKey: OWN_GSTIN },
    S,
  ).snapshot;
  assert.equal(draft.bank.accountNo, S.banks.export.accountNo);

  // an admin corrects the account number and the company's own GSTIN while the
  // draft sits — a wrong account number on issued paper is money that never
  // arrives, so the details are re-read (the KEYS stay the clerk's choice)
  const later: CommercialSettings = {
    ...S,
    banks: { ...S.banks, export: { ...S.banks.export, accountNo: "9988776655", ifsc: "KKBK0000999" } },
  };
  const issued = refreezeAtIssue(draft, later);
  assert.equal(issued.bankKey, "export", "the clerk's key stands");
  assert.equal(issued.bank.accountNo, "9988776655");
  assert.equal(issued.bank.ifsc, "KKBK0000999");
  assert.equal(draft.bank.accountNo, S.banks.export.accountNo, "and the draft it was derived from is untouched");

  // the chosen registration prints on all three places it appears
  const alt = refreezeAtIssue({ ...draft, gstinKey: ALT_GSTIN }, S);
  assert.equal(alt.gstinKey, ALT_GSTIN);
  assert.equal(alt.company.gstin, ALT_GSTIN);
  assert.equal(alt.exporter.gstin, ALT_GSTIN);

  // a GSTIN removed from Settings since the draft was built falls back to the
  // company's own rather than printing a blank on the customer's paper
  const dropped = refreezeAtIssue({ ...draft, gstinKey: "33ZZZZZ9999Z9Z9" }, S);
  assert.equal(dropped.gstinKey, OWN_GSTIN);
  assert.equal(dropped.company.gstin, OWN_GSTIN);

  // a legacy draft frozen before the two choices existed: the kind's default
  // bank (answer 23) and the company's own GSTIN (answer 21)
  const legacy = { ...draft } as PiSnapshot;
  delete legacy.bankKey;
  delete legacy.gstinKey;
  const exportRefrozen = refreezeAtIssue(legacy, S);
  assert.equal(exportRefrozen.bankKey, "export", "EXPORT → Kotak");
  assert.equal(exportRefrozen.bank.name, S.banks.export.name);
  assert.equal(exportRefrozen.gstinKey, OWN_GSTIN);
  const domesticLegacy = refreezeAtIssue({ ...legacy, kind: "DOMESTIC" }, S);
  assert.equal(domesticLegacy.bankKey, "domestic", "DOMESTIC → ICICI");
  assert.equal(domesticLegacy.bank.name, S.banks.domestic.name);

  // everything else on the paper is the frozen snapshot, untouched
  assert.equal(issued.number, draft.number);
  assert.deepEqual(issued.lines, draft.lines);
  assert.equal(issued.totalAmount, draft.totalAmount);
  assert.equal(issued.amountInWords, draft.amountInWords);
});

test("a revision is a NEW snapshot under a NEW number: parties, lines and rates from the order as it stands; the clerk's shipping facts and choices carried", () => {
  // the PI the customer holds, with everything the clerk typed onto it
  const old = applyDraftPatch(
    buildProformaSnapshot(exportOrder, S, { ...opts, number: "SAL-ORD/26-27/N3", deliveryDate: "2026-08-15" }),
    { vessel: "MSC ISABELLA / 431W", grossWeight: "24,500 KGS", netWeight: "23,100 KGS", discount: 24.657, notes: "Stuffed at the factory.", portOfDischarge: "NEW YORK", bankKey: "domestic", gstinKey: ALT_GSTIN },
    S,
  ).snapshot;
  // the order has moved on: a new rate and a new consignee — the reason for the revision
  const changedOrder: SnapshotOrderInput = {
    ...exportOrder,
    consignee: { name: "Gulf Stone LLC", lines: ["PO Box 4411", "Dubai"], country: "UAE" },
    items: [{ ...quartzLine, rate: 5.6, amount: 17966.329 }, sampleLine],
  };
  const carried = carriedIntoRevision(old);
  assert.deepEqual(Object.keys(carried).sort(), [
    "bankKey", "deliveryDate", "discount", "finalDestination", "grossWeight", "gstinKey", "netWeight", "notes",
    "placeOfReceipt", "portOfDischarge", "portOfLoading", "preCarriageBy", "vessel",
  ]);
  for (const k of ["consignee", "notifyParty", "lines", "number", "date", "validUntil", "revises", "buyerPoNo", "deliveryTerms", "paymentTerms"]) {
    assert.equal(k in carried, false, `${k} comes from the order, not from the old paper`);
  }

  const fresh = buildProformaSnapshot(changedOrder, S, {
    number: "SAL-ORD/26-27/N4", revision: 1, date: "2026-09-08", validUntil: null,
    revises: { id: "old-id", number: old.number },
  });
  const revised = applyDraftPatch(fresh, carried, S).snapshot;

  assert.equal(revised.number, "SAL-ORD/26-27/N4", "a brand-new number");
  assert.notEqual(revised.number, old.number);
  assert.equal(printedNumber(revised.number), "SAL-ORD/26-27/N4", "nothing is re-numbered and nothing is suffixed");
  assert.deepEqual(revised.revises, { id: "old-id", number: "SAL-ORD/26-27/N3" }, "the chain reads from the paper");
  assert.equal(revised.date, "2026-09-08", "a revision is dated the day it is made");
  assert.equal(revised.validUntil, null);
  // from the order as it stands
  assert.equal(revised.consignee.name, "Gulf Stone LLC");
  assert.equal(revised.lines[0].rate, 5.6);
  assert.equal(revised.lines[0].amount, 17966.329);
  assert.equal(revised.countryOfDestination, "UAE");
  // carried from the old paper
  assert.equal(revised.vessel, "MSC ISABELLA / 431W");
  assert.equal(revised.grossWeight, "24,500 KGS");
  assert.equal(revised.netWeight, "23,100 KGS");
  assert.equal(revised.deliveryDate, "2026-08-15");
  assert.equal(revised.notes, "Stuffed at the factory.");
  assert.equal(revised.portOfDischarge, "NEW YORK");
  assert.equal(revised.discount, 24.657);
  assert.equal(revised.bankKey, "domestic");
  assert.equal(revised.bank.name, "ICICI Bank");
  assert.equal(revised.gstinKey, ALT_GSTIN);
  assert.equal(revised.company.gstin, ALT_GSTIN);
  // and the money is re-derived from the NEW lines less the carried discount
  assert.equal(revised.totalAmount, round3(17966.329 - 24.657));
  assert.equal(revised.totalSlabs, 68);
  assert.equal(old.totalAmount, 17300, "the old snapshot is untouched — it is the paper the customer holds");

  // the cancellation the system writes on the old one
  assert.equal(revisionReason(revised.number), "Revised as SAL-ORD/26-27/N4");
  assert.equal(canRevise("CANCELLED"), false, "and a cancelled PI cannot be revised again — the new one is");
});

test("carriedIntoRevision on a PI frozen before the choices existed carries nothing that would blank them", () => {
  const legacy = { ...buildProformaSnapshot(exportOrder, S, opts) } as PiSnapshot;
  delete legacy.bankKey;
  delete legacy.gstinKey;
  const fresh = buildProformaSnapshot(domesticOrder, S, { number: "SAL-ORD/26-27/N5", revision: 1, date: "2026-09-08" });
  const revised = applyDraftPatch(fresh, carriedIntoRevision(legacy), S).snapshot;
  assert.equal(revised.bankKey, "domestic", "no bank key on the old paper → the kind's default stands");
  assert.equal(revised.bank.name, "ICICI Bank");
  assert.equal(revised.gstinKey, OWN_GSTIN);
});

test("statusTone / parseProformaStatus / pageArgs", () => {
  assert.equal(statusTone("ISSUED"), "brand");
  assert.equal(statusTone("ACCEPTED"), "green");
  assert.equal(statusTone("DRAFT"), "amber");
  assert.equal(statusTone("CANCELLED"), "red");
  assert.equal(statusTone("SUPERSEDED"), "red");

  assert.equal(parseProformaStatus("issued"), "ISSUED");
  assert.equal(parseProformaStatus("ACCEPTED"), "ACCEPTED");
  assert.equal(parseProformaStatus("cancelled"), "CANCELLED", "cancelled PIs stay in the register (answer 24), so they can be filtered for");
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
  assert.equal(f.invoiceNo, PI_NO, "the PI's own number, whole");
  assert.equal(f.invoiceDate, "10-07-2026");
  assert.equal(f.deliveryDate, "15-08-2026");
  assert.equal(f.validUntil, "09-08-2026", "the days path, when the owner sets a validity");
  assert.equal(f.buyerPoNo, "PO-4068622");
  assert.equal(f.rbiCode, "678");
  assert.equal(f.gstin, OWN_GSTIN);
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
  assert.equal(f.bankKey, "export");
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

test("piPrintFields: no validity prints NO validity (answer 24) — the PDF adds its line only for a non-blank", () => {
  const s = buildProformaSnapshot(exportOrder, S, opts);
  assert.equal(s.validUntil, null);
  assert.equal(piPrintFields(s).validUntil, "");
  assert.equal(piPrintFields({ ...s, validUntil: "" }).validUntil, "");
  assert.equal(piPrintFields({ ...s, validUntil: "None" }).validUntil, "", "never the serialiser's None");
  assert.equal(piPrintFields({ ...s, validUntil: validUntilFor(new Date("2026-07-10T00:00:00.000Z"), 0) }).validUntil, "", "as the issue route stores it for a 0 setting");
  assert.equal(piPrintFields({ ...s, validUntil: validUntilFor(new Date("2026-07-10T00:00:00.000Z"), 15) }).validUntil, "25-07-2026");
});

test("piPrintFields: the chosen bank and GSTIN print, and a legacy snapshot without the keys still prints its frozen bank", () => {
  const dom = piPrintFields(buildProformaSnapshot(domesticOrder, S, opts));
  assert.equal(dom.bankKey, "domestic");
  assert.equal(dom.bankName, "ICICI Bank");
  assert.equal(dom.accountNo, "020405012473");
  assert.equal(dom.adCode, "", "ICICI has no AD code: blank, not undefined");
  assert.equal(dom.routingBank, "");
  const alt = piPrintFields(buildProformaSnapshot(exportOrder, S, { ...opts, gstinKey: ALT_GSTIN }));
  assert.equal(alt.gstin, ALT_GSTIN);
  // a PI frozen before 2026-09-07 has no bankKey; it prints the block it froze
  // and the screen labels it by the kind's default
  const legacy = { ...buildProformaSnapshot(exportOrder, S, opts) } as PiSnapshot;
  delete legacy.bankKey;
  const lf = piPrintFields(legacy);
  assert.equal(lf.bankKey, "export");
  assert.equal(lf.bankName, "Kotak Mahindra Bank Limited");
});

test("piPrintFields: an empty domestic PI prints empty cells, never None or null", () => {
  const bare = buildProformaSnapshot({ number: "ORD/26-27/N9", kind: "DOMESTIC", items: [] }, S, { number: "SAL-ORD/26-27/N12", revision: 2, date: "2026-09-06" });
  const f = piPrintFields(bare);
  assert.equal(f.invoiceNo, "SAL-ORD/26-27/N12", "the ordinal 2 is nowhere on the paper");
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
  assert.equal(f.bankName, "ICICI Bank", "a domestic PI banks with ICICI by default (answer 23)");
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
  const s = buildProformaSnapshot(exportOrder, S, { ...opts, gstinKey: ALT_GSTIN, bankKey: "domestic", revises: { id: "x", number: "SAL-ORD/26-27/N1" } });
  const back = JSON.parse(JSON.stringify(s)) as PiSnapshot;
  assert.deepEqual(back, s);
  assert.deepEqual(piRow(back.lines[0]), piRow(s.lines[0]));
  assert.equal(piPrintFields(back).totalAmount, "17324.657");
  assert.equal(back.bankKey, "domestic");
  assert.equal(back.gstinKey, ALT_GSTIN);
  assert.deepEqual(back.revises, { id: "x", number: "SAL-ORD/26-27/N1" });
});

test("a settings edit after issue does not reach the paper: the snapshot froze its own copy", () => {
  const s = buildProformaSnapshot(exportOrder, S, opts);
  const later: CommercialSettings = { ...S, banks: { ...S.banks, export: { ...S.banks.export, accountNo: "0000000000" } }, company: { ...S.company, gstin: "33NEWGSTIN0000Z1" } };
  assert.equal(piPrintFields(s).accountNo, "3214292773");
  assert.equal(piPrintFields(s).gstin, OWN_GSTIN);
  // only a DRAFT edit that names the key re-freezes, and it re-freezes from the settings it is handed
  assert.equal(applyDraftPatch(s, { bankKey: "export" }, later).changed, false, "the same key does not silently pull new account details in");
  assert.equal(applyDraftPatch(s, { bankKey: "domestic" }, later).snapshot.bank.name, "ICICI Bank");
});

// ── round two, answer 8: a cancelled PI keeps its place in the register ──────

test("refuseCancel: a cancellation without a reason is refused (round two, answer 8)", () => {
  assert.equal(refuseCancel({ status: "ISSUED" }, "Customer changed the design"), null);
  assert.equal(refuseCancel({ status: "DRAFT" }, "Built by mistake"), null);
  assert.equal(refuseCancel({ status: "ACCEPTED" }, "Order withdrawn"), null);
  for (const blank of [null, undefined, "", "   ", "None", "null"]) {
    assert.match(
      refuseCancel({ status: "ISSUED" }, blank) ?? "",
      /needs a reason/,
      `${String(blank)} is not a reason`,
    );
  }
  // status is asked first, so a cancelled PI is told it is cancelled rather
  // than asked for a reason it can no longer use
  assert.match(refuseCancel({ status: "CANCELLED" }, "" ) ?? "", /cancelled PI cannot be cancelled/);
  assert.match(refuseCancel({ status: "SUPERSEDED" }, "why not") ?? "", /superseded PI cannot be cancelled/);
  // and it agrees with canCancel, which the tab still asks to decide the button
  for (const st of ["DRAFT", "ISSUED", "ACCEPTED", "SUPERSEDED", "CANCELLED"]) {
    assert.equal(refuseCancel({ status: st }, "a reason") === null, canCancel(st), st);
  }
});

test("revisionReason is what the issue transaction writes on the retired PI", () => {
  assert.equal(revisionReason("SAL-ORD/26-27/N0007"), "Revised as SAL-ORD/26-27/N0007");
  // and it passes refuseCancel's reason test, so the by-hand rule and the
  // automatic one write the same kind of row
  assert.equal(refuseCancel({ status: "ISSUED" }, revisionReason("SAL-ORD/26-27/N0007")), null);
});

const row = (id: string, number: string, revision: number, status: string, replacedById: string | null = null): RegisterRow =>
  ({ id, number, revision, status, replacedById });

test("replacementOf: the number beside a struck-through one is resolved from the siblings", () => {
  const live = row("c", "SAL-ORD/26-27/N0003", 2, "ISSUED");
  const dead = row("a", "SAL-ORD/26-27/N0001", 0, "CANCELLED", "c");
  const all = [live, dead];
  assert.equal(replacementOf(all, dead)?.number, "SAL-ORD/26-27/N0003");
  assert.equal(replacementOf(all, live), null, "a live PI was replaced by nothing");
  assert.equal(replacementOf(all, row("z", "N/0", 9, "CANCELLED", "gone")), null, "a link outside the list prints no number");
  assert.equal(replacementOf(all, row("s", "N/0", 9, "CANCELLED", "s")), null, "a row cannot replace itself");
  for (const blank of [null, undefined, ""]) {
    assert.equal(replacementOf(all, { id: "a", replacedById: blank }), null);
  }
});

test("registerOrder: a cancelled PI sits with its replacement, not at its own ordinal", () => {
  const a = row("a", "SAL-ORD/26-27/N0001", 0, "CANCELLED", "c");
  const b = row("b", "SAL-ORD/26-27/N0002", 1, "DRAFT");
  const c = row("c", "SAL-ORD/26-27/N0003", 2, "ISSUED");
  assert.deepEqual(
    registerOrder([a, b, c]).map((r) => r.id),
    ["c", "a", "b"],
    "N0001 is read under N0003 that replaced it, ahead of the unrelated draft N0002",
  );
  // the input is not reordered in place
  assert.deepEqual([a, b, c].map((r) => r.id), ["a", "b", "c"]);
});

test("registerOrder: a chain of revisions unwinds newest to oldest under the live one", () => {
  const rows = [
    row("p1", "SAL-ORD/26-27/N0001", 0, "CANCELLED", "p2"),
    row("p2", "SAL-ORD/26-27/N0002", 1, "CANCELLED", "p3"),
    row("p3", "SAL-ORD/26-27/N0003", 2, "ACCEPTED"),
  ];
  assert.deepEqual(registerOrder(rows).map((r) => r.id), ["p3", "p2", "p1"]);
});

test("registerOrder: nothing is dropped and nothing is listed twice, whatever the links say", () => {
  const dangling = [row("a", "N1", 0, "CANCELLED", "nowhere"), row("b", "N2", 1, "ISSUED")];
  assert.deepEqual(registerOrder(dangling).map((r) => r.id), ["b", "a"], "a broken link leaves the row at its ordinal");

  // a cycle has no head to hang off; both rows still list, once each
  const cycle = [row("x", "N1", 0, "CANCELLED", "y"), row("y", "N2", 1, "CANCELLED", "x")];
  const out = registerOrder(cycle);
  assert.equal(out.length, 2);
  assert.deepEqual([...new Set(out.map((r) => r.id))].length, 2);

  assert.deepEqual(registerOrder([]), []);
  const one = [row("solo", "N1", 0, "ISSUED")];
  assert.deepEqual(registerOrder(one).map((r) => r.id), ["solo"]);
});

test("registerOrder: two PIs retired by one issue are both listed under it", () => {
  // revisedByIssue exists to stop this happening, but a register that hid the
  // second one would hide the very thing a reader is looking for
  const rows = [
    row("old1", "N0001", 0, "CANCELLED", "new"),
    row("old2", "N0002", 1, "CANCELLED", "new"),
    row("new", "N0003", 2, "ISSUED"),
  ];
  assert.deepEqual(registerOrder(rows).map((r) => r.id), ["new", "old2", "old1"]);
});

// ─────────────── the owner's three changes of 2026-09-15 ─────────────────────
//
//  1  "terms and confitions me tonnage nahi dikhana (make it empty unless
//     stated clearly to fill in it)"
//  2  "for dta a small section for salesperson (who has asked for the PI for
//     his customer/consignee)"
//  3  "buyer if not consignee section (only applicable for SBP)"
//
// The first two are rules about a field, so they are pinned on the field. The
// third is a rule about whether a cell is rendered at all, which the PDF asks
// printsParty — the predicate lives in the rules module so the answer is
// testable without rendering a document.

test("Terms & Conditions carries what a human typed and NOTHING else (owner, 2026-09-15)", () => {
  // An order carrying every fact a well-meaning later hand might be tempted to
  // compose a "25 ton container" line out of: weights, packing, a delivery
  // schedule, the order's own internal notes.
  const loaded = {
    ...domesticOrder,
    notes: "Internal: customer wants a 25 ton container, stuff at the factory.",
    deliverySchedule: "One 25 ton container a week from 01-08-2026",
    specialPacking: "25 TON CONTAINER, fumigated pallets",
    grossWeight: "24,500 KGS",
    netWeight: "23,100 KGS",
  } as SnapshotOrderInput;

  const blank = buildProformaSnapshot(loaded, S, opts);
  assert.equal(blank.notes, null, "nothing on the order reaches the Terms & Conditions box");
  assert.equal(piPrintFields(blank).termsAndConditions, "", "a blank box prints blank — the PDF still prints the labelled box");
  assert.equal(blank.grossWeight, null, "and the weights are their own fields, still empty");
  assert.equal(blank.netWeight, null);

  // The one way anything gets in there: somebody types it.
  const typed = buildProformaSnapshot(loaded, S, { ...opts, notes: "Rate valid for 30 days. Prices exclusive of GST." });
  assert.equal(typed.notes, "Rate valid for 30 days. Prices exclusive of GST.");
  assert.equal(piPrintFields(typed).termsAndConditions, "Rate valid for 30 days. Prices exclusive of GST.");

  // …and the one way it comes back out: somebody clears it.
  const cleared = applyDraftPatch(typed, { notes: null }, S);
  assert.equal(cleared.changed, true, "clearing the box is an edit the route must write");
  assert.equal(cleared.snapshot.notes, null);
  assert.equal(piPrintFields(cleared.snapshot).termsAndConditions, "");

  // A draft edit cannot smuggle it in under another name either: only `notes`
  // is the Terms & Conditions box.
  const sneaky = applyDraftPatch(blank, {
    termsAndConditions: "25 ton container",
    specialPacking: "25 TON CONTAINER",
  }, S);
  assert.equal(sneaky.snapshot.notes, null, "only `notes` is the box");
  assert.equal(piPrintFields(sneaky.snapshot).termsAndConditions, "");

  // And the serialiser's leftovers are not content.
  assert.equal(piPrintFields({ ...blank, notes: "None" }).termsAndConditions, "");
  assert.equal(piPrintFields({ ...blank, notes: "   " }).termsAndConditions, "");
});

test("the salesperson is frozen off the ORDER at draft time, and is never the desk that typed the PI (scripts/0084)", () => {
  const order: SnapshotOrderInput = { ...domesticOrder, salespersonName: "Gibin Thomas" };
  const s = buildProformaSnapshot(order, S, opts);
  assert.equal(s.salespersonName, "Gibin Thomas");

  // reassigning the order does not touch paper already printed
  const reassigned = buildProformaSnapshot({ ...order, salespersonName: "Chromia Raj" }, S, { ...opts, number: "SAL-ORD/26-27/N5" });
  assert.equal(reassigned.salespersonName, "Chromia Raj");
  assert.equal(s.salespersonName, "Gibin Thomas", "the PI already frozen keeps the name it carried");

  // an order with nobody recorded freezes null — not "None", not a blank
  // string, and above all not a fallback to whoever built the draft
  const none = buildProformaSnapshot(domesticOrder, S, opts);
  assert.equal(none.salespersonName, null);
  const junk = buildProformaSnapshot({ ...domesticOrder, salespersonName: "  None " }, S, opts);
  assert.equal(junk.salespersonName, null, "the serialiser's None is nobody");
});

test("the salesperson block is DOMESTIC only — an export PI prints none, not an empty one (owner, 2026-09-15)", () => {
  const dta = buildProformaSnapshot({ ...domesticOrder, salespersonName: "Gibin Thomas" }, S, opts);
  assert.equal(piSalesperson(dta), "Gibin Thomas");
  assert.equal(piPrintFields(dta).salesperson, "Gibin Thomas", "the PDF prints the block for a non-blank, as it does the validity line");

  // An export order MAY hold one (scripts/0084 keeps the column kindless, so
  // moving an order between the two kinds loses nothing) and the PI simply
  // does not print it.
  const exp = buildProformaSnapshot({ ...exportOrder, salespersonName: "Gibin Thomas" }, S, opts);
  assert.equal(exp.salespersonName, "Gibin Thomas", "carried in the snapshot…");
  assert.equal(piSalesperson(exp), "", "…and printed nowhere on an export PI");
  assert.equal(piPrintFields(exp).salesperson, "");

  // a domestic PI with nobody recorded prints no block either: the block names
  // a person, and an empty labelled box names nobody
  assert.equal(piSalesperson(buildProformaSnapshot(domesticOrder, S, opts)), "");
  assert.equal(piSalesperson({ ...dta, salespersonName: "   " }), "");
  assert.equal(piSalesperson({ ...dta, salespersonName: "None" }), "");
  assert.equal(piSalesperson({ ...dta, salespersonName: null }), "");

  // a PI frozen before 2026-09-15 has no such key at all and still prints
  const legacy = { ...dta } as PiSnapshot;
  delete legacy.salespersonName;
  assert.equal(piSalesperson(legacy), "");
  assert.equal(piPrintFields(legacy).salesperson, "");
});

test("the salesperson survives every step between drafting and printed paper", () => {
  const draft = buildProformaSnapshot({ ...domesticOrder, salespersonName: "Gibin Thomas" }, S, opts);

  // the draft edit (EDITABLE_TEXT_FIELDS — the PI tab's own box)
  assert.ok((EDITABLE_TEXT_FIELDS as readonly string[]).includes("salespersonName"));
  const corrected = applyDraftPatch(draft, { salespersonName: "Chromia Raj" }, S);
  assert.equal(corrected.changed, true, "a correction must reach the database — the route writes on this flag");
  assert.equal(corrected.snapshot.salespersonName, "Chromia Raj");
  assert.equal(applyDraftPatch(corrected.snapshot, { salespersonName: "Chromia Raj" }, S).changed, false, "the same name twice is a no-op");
  assert.equal(applyDraftPatch(corrected.snapshot, { salespersonName: null }, S).snapshot.salespersonName, null, "and it can be cleared");

  // issue: the bank and the GSTIN are re-read, the name is the paper's
  const issued = refreezeAtIssue(corrected.snapshot, S);
  assert.equal(issued.salespersonName, "Chromia Raj", "refreezeAtIssue must not drop it");
  assert.equal(piPrintFields(issued).salesperson, "Chromia Raj");

  // the Json column
  const back = JSON.parse(JSON.stringify(issued)) as PiSnapshot;
  assert.deepEqual(back, issued);
  assert.equal(back.salespersonName, "Chromia Raj");
  assert.equal(piPrintFields(back).salesperson, "Chromia Raj");

  // a revision reads the ORDER again rather than copying the old paper, so a
  // reassignment cannot be silently undone by revising
  assert.equal("salespersonName" in carriedIntoRevision(issued), false, "not carried: the fresh snapshot reads the order");
  const revision = buildProformaSnapshot({ ...domesticOrder, salespersonName: "Murali S" }, S, { ...opts, number: "SAL-ORD/26-27/N6", revises: { id: "x", number: PI_NO } });
  const { snapshot: revised } = applyDraftPatch(revision, carriedIntoRevision(issued), S);
  assert.equal(revised.salespersonName, "Murali S", "the order as it stands, not the retired paper");
});

test("the PI tab's save body carries the salesperson, and still reports changed honestly", () => {
  // exactly what PiTab.saveDraft posts, on a domestic draft that has none of it
  const base = buildProformaSnapshot(domesticOrder, S, opts);
  const body = {
    deliveryDate: "2026-08-20",
    vessel: null,
    grossWeight: null,
    netWeight: null,
    discount: 0,
    notes: null,
    salespersonName: "Gibin Thomas",
    bankKey: "domestic",
    gstinKey: OWN_GSTIN,
  };
  const first = applyDraftPatch(base, body, S);
  assert.equal(first.changed, true);
  assert.equal(first.snapshot.salespersonName, "Gibin Thomas");
  assert.equal(piPrintFields(first.snapshot).salesperson, "Gibin Thomas");
  assert.equal(applyDraftPatch(first.snapshot, body, S).changed, false, "saving the same form again is the one honest no-op");
  assert.equal(applyDraftPatch(first.snapshot, { ...body, salespersonName: "Chromia Raj" }, S).changed, true);
});

test("a draft frozen before the salesperson existed saves unchanged: an absent key is nobody, not an edit", () => {
  // The commercial module has been live since 2026-09-09, so the register
  // already holds DRAFT PIs whose snapshots carry no `salespersonName` key at
  // all — the column is a day old and scripts/0084 backfills nothing on
  // purpose. PiTab.saveDraft posts the field on EVERY save, blank as null, so
  // an absent key and an empty box have to read here as the same nobody. If
  // they do not, the first save of every draft already in the register reports
  // `changed`, and the PATCH route — which keys both its write and its
  // `pi_edited` event off that flag — rewrites the row and puts "draft edited"
  // on the order's timeline for an edit nobody made. That timeline is the
  // module's audit trail; an entry nobody can account for costs more than the
  // write it records, which is a null over an absent key and changes nothing.
  //
  // This is the only field on EDITABLE_TEXT_FIELDS where the case arises:
  // buildProformaSnapshot writes every other one unconditionally, as null at
  // worst, so for those the comparison has always been null against null.
  const legacy = { ...buildProformaSnapshot(domesticOrder, S, opts) } as PiSnapshot;
  delete legacy.salespersonName;
  assert.equal("salespersonName" in legacy, false, "the fixture is a pre-2026-09-15 snapshot");

  // exactly what PiTab.saveDraft posts when the clerk opens the draft, types
  // nothing and presses Save
  const untouched = {
    deliveryDate: null,
    vessel: null,
    grossWeight: null,
    netWeight: null,
    discount: 0,
    notes: null,
    salespersonName: null,
    bankKey: legacy.bankKey,
    gstinKey: legacy.gstinKey,
  };
  assert.equal(applyDraftPatch(legacy, untouched, S).changed, false, "nothing was typed, so nothing was edited");

  // and the new box still works on that same legacy draft: typing a name is an
  // edit, saving it again is not, and clearing it lands as null rather than
  // going back to an absent key
  const typed = applyDraftPatch(legacy, { ...untouched, salespersonName: "Gibin Thomas" }, S);
  assert.equal(typed.changed, true);
  assert.equal(typed.snapshot.salespersonName, "Gibin Thomas");
  assert.equal(piPrintFields(typed.snapshot).salesperson, "Gibin Thomas");
  assert.equal(applyDraftPatch(typed.snapshot, { ...untouched, salespersonName: "Gibin Thomas" }, S).changed, false);

  const cleared = applyDraftPatch(typed.snapshot, untouched, S);
  assert.equal(cleared.changed, true);
  assert.equal(cleared.snapshot.salespersonName, null);
  assert.equal(applyDraftPatch(cleared.snapshot, untouched, S).changed, false, "and the cleared draft saves unchanged too");
});

test("printsParty: the buyer-if-not-consignee cell is printed only where there is one (owner, 2026-09-15)", () => {
  // SBP's own PI, as the owner supplied it: a customer code and a US address.
  const sbp = buildProformaSnapshot({
    ...exportOrder,
    consignee: { name: "Surfaces by Pacific", lines: ["1300 Mark Street", "Elk Grove Village ILLINOIS 60007"], country: "United States" },
    buyerIfNotConsignee: {
      name: "USA-001,xxxxx",
      lines: ["1300 Mark Street, Elk Grove Village ILLINOIS 60007, Other Territory"],
      country: "United States",
    },
  }, S, opts);
  assert.equal(printsParty(sbp.buyerIfNotConsignee), true);
  assert.deepEqual(partyBlock(sbp.buyerIfNotConsignee), {
    name: "USA-001,xxxxx",
    lines: ["1300 Mark Street, Elk Grove Village ILLINOIS 60007, Other Territory", "United States"],
  });

  // every other PI: no buyer, so no cell at all — not an empty labelled box
  const plain = buildProformaSnapshot(exportOrder, S, opts);
  assert.equal(plain.buyerIfNotConsignee, null);
  assert.equal(printsParty(plain.buyerIfNotConsignee), false);
  assert.equal(printsParty(buildProformaSnapshot(domesticOrder, S, opts).buyerIfNotConsignee), false);

  // the same party as the consignee is not a second party, so still no cell
  const same = buildProformaSnapshot({
    ...exportOrder,
    consignee: { name: "Surfaces by Pacific", lines: [] },
    billTo: { name: "surfaces by pacific", lines: [] },
  }, S, opts);
  assert.equal(printsParty(same.buyerIfNotConsignee), false);

  // the predicate answers for what partyBlock would RENDER, never for the raw
  // object: a party of blanks and Nones prints nothing and so is not printed,
  // and one carrying only a country or a telephone number still is
  assert.equal(printsParty(null), false);
  assert.equal(printsParty(undefined), false);
  assert.equal(printsParty({ name: "  ", lines: ["", "None"] }), false);
  assert.equal(printsParty({ name: "", lines: [], country: "United States" }), true);
  assert.equal(printsParty({ name: "", lines: [], tel: "+1 847 555 0100" }), true);
  assert.equal(printsParty({ name: "USA-001,xxxxx", lines: [] }), true);
});

// ─────────────────────────── the discount line ───────────────────────────────
// The owner, 2026-09-15, looking at the two proformas raised that day: "remove
// discount amount ... in these two". Neither carried a discount, so what he was
// looking at was a bold "DISCOUNT AMOUNT :" with nothing after it — the same
// complaint as the empty Buyer-if-Not-Consignee box directly above it.
//
// So the line is WITHHELD, not removed. Their own earlier export PI
// (SAL-ORD/26-27/01642) does carry one: it is how a total is rounded to a clean
// figure, the 24.657 remainder sitting on this line. Deleting the row outright
// would have taken that away to fix a blank label.

test("the discount line is withheld when there is no discount, and kept when there is (owner, 2026-09-15)", () => {
  const order = { ...exportOrder };
  const none = piPrintFields(buildProformaSnapshot(order, S, opts));
  assert.equal(none.discount, "", "no discount: the field is blank, which is what withholds the row");

  const withDiscount = piPrintFields({ ...buildProformaSnapshot(order, S, opts), discount: 24.657 });
  assert.equal(withDiscount.discount, fmtAmount(24.657), "a real discount still prints, formatted like every other amount");
  assert.notEqual(withDiscount.discount, "", "and is therefore still drawn");

  // A zero is not a discount — it is the absence of one, and must not print a
  // line reading "0.000" on a customer's invoice.
  assert.equal(piPrintFields({ ...buildProformaSnapshot(order, S, opts), discount: 0 }).discount, "");
});

test("the PDF draws the discount row only for a non-blank discount", () => {
  // Pinned on the source because no test renders a PDF: the guard is what makes
  // the field above mean anything, and an unconditional row would put the label
  // back without failing a single assertion here.
  const src = readFileSync(new URL("../src/lib/commercial/pdf/proforma.ts", import.meta.url), "utf8");
  assert.match(src, /\.\.\.\(f\.discount \? \[\{ text: \[\{ text: "DISCOUNT AMOUNT : "/,
    "the DISCOUNT AMOUNT row must be spread in behind a truthiness test on f.discount");
});

// ───────────────────── the header and the carriage grid ──────────────────────
// Two corrections the owner made on 2026-09-15, looking at a printed PI.

test("no vessel / flight number on a proforma, and the remaining ports still read in order", () => {
  const src = readFileSync(new URL("../src/lib/commercial/pdf/proforma.ts", import.meta.url), "utf8");
  assert.equal(src.includes('field("Vessel / Flight No"'), false,
    'the vessel cell is gone from the proforma — "not required in any PI"');
  // Gone, not blanked: the snapshot still CARRIES a vessel (the packing list and
  // the export invoice print one), so a test that only checked the value would
  // pass with an empty box still on the page.
  assert.match(src, /pairRow\(field\("Port of Loading", f\.portOfLoading\), field\("Port of Discharge", f\.portOfDischarge\)\)/,
    "the two ports pair up where the vessel used to sit, so no half-width cell is left behind");
  assert.match(src, /fullRow\(field\("Final Destination", f\.finalDestination\)\)/,
    "and Final Destination takes the full width below them");
});

test("dropping the vessel box loses no vessel, because the PI never held the only one", () => {
  // The obvious worry, and it is wrong in an unobvious way. There is NO vessel
  // column on commercial_order: the PI's box was typed on the PI and fed
  // nothing downstream. The one place this module records a vessel is the
  // INVOICE's frozen snapshot, and the packing list reads it from there.
  const inv = readFileSync(new URL("../src/lib/commercial/invoice-rules.ts", import.meta.url), "utf8");
  assert.match(inv, /vessel: clean\(opts\.vessel\)/, "the invoice still takes and freezes a vessel");
  const pack = readFileSync(new URL("../src/lib/commercial/packing-rules.ts", import.meta.url), "utf8");
  assert.match(pack, /export function vesselFromSnapshot/, "and the packing list still reads one off that snapshot");

  // The PI snapshot keeps the key so a proforma frozen before today round-trips
  // unchanged — it is simply not drawn any more.
  const snap = buildProformaSnapshot(exportOrder, S, opts);
  assert.equal("vessel" in snap, true, "the key survives for legacy snapshots");
  assert.equal(snap.vessel, null, "and was always null at build time — it was never read off the order");

  // The screen stops asking for it, or it would be a box reaching no document.
  const tab = readFileSync(new URL("../src/components/commercial/order/PiTab.tsx", import.meta.url), "utf8");
  assert.equal(tab.includes('label="Vessel / flight no"'), false, "no vessel input on the PI draft");
});

test("RBI code and GSTIN print as label-and-value, one complete line each", () => {
  // They used to share one field(): the label "RBI Code No." sat alone on a
  // line and the value line read "678        GSTIN : 33AALCP2750N1Z3", so the
  // GSTIN had a label and the 678 appeared to have none. Their own reference
  // proforma prints "RBI Code No.:678" then "GSTIN NO: 33AALCP2750N1Z3".
  const src = readFileSync(new URL("../src/lib/commercial/pdf/proforma.ts", import.meta.url), "utf8");
  assert.match(src, /text: "RBI Code No\.: "/, "RBI code carries its own inline label");
  assert.match(src, /text: "GSTIN : "/, "and the GSTIN carries its own");
  assert.equal(src.includes('field("RBI Code No."'), false,
    "and neither goes through field(), which stacks the label above the value");
  assert.match(src, /\.\.\.\(f\.gstin \?/, "the GSTIN line is dropped, not left dangling, when there is none");
});
