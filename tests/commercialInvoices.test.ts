// Invoice rules, RUN against real values: how an order line and a packing
// list's slabs become printed lines, how the DTA sheet's GST and round-off
// land on a whole rupee, what the export sheet keeps at 3 dp, what the
// snapshot freezes, what a draft edit may change, and the register's filters.
// Import-free module (sibling pure imports only), so node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVOICE_KINDS, COMMODITY, DTA_DEFAULT_DESCRIPTION, NOMINAL_SLAB,
  defaultKindFor, sequenceKindFor, canEditInvoice, canIssueInvoice, canCancelInvoice, refuseIssue, statusTone,
  printable, round2, round3, round4, trimNumber, printInvoiceThickness, invoiceUnit, measureFieldFor,
  fmtDMY, fmtDMYDash, isoDate, istIsoDate, fmtIndian, fmtWestern, invoiceFilename, buyerPoRef,
  rateDp, fmtRateIndian, fmtRateWestern, amountColumnDp, datedRef,
  partyOrNull, clientParty, exporterParty, buyerStateCode,
  matchOrderItem, dtaDescription, exportDescription, lineFromItem, groupSlabs, buildInvoiceLines, sanitiseLine,
  lineNeedsPrice, unpricedLineNos, unpricedWarning, isDerivedAmount, displayGrandTotal, displaySubtotal,
  invoiceTotals, buildInvoiceSnapshot, recomputeSnapshot, applyDraftPatch, rowTotalsFromSnapshot,
  invoicesWhere, pageArgs,
  openInvoiceOf, refuseCreate, refuseIssueUnapproved, INVOICE_APPROVERS,
  BANK_KEYS, isBankKey, defaultBankKeyFor, bankBlockFor, gstinChoiceFor, gstinLabelFor, gstinWithLabel,
  designCodeLookup, NO_DESIGN_CODE, printedItemCode, lineLacksCode,
  datedLines, fyOfIso, fyBadge, snapshotExtras,
  patchedSnapshotFields, patchedInvoiceFields, ROW_ONLY_PATCH_FIELDS,
  registrationChanges, registrationChangeNote,
  exportRootOverrides, EXPORT_ROOT_GSTIN_KEY, EXPORT_ROOT_BANK_KEY, EXPORT_ROOT_SHEET_GSTIN_CELLS, overriddenSheetsNote,
  isAlternateOf, isAlternateGstin, gstinApplyAllFor, gstinScopeNote, gstinScopeWord, GSTIN_APPLY_ALL_QUESTION,
  hasExportWorkbook, gstinQuestionApplies, gstinScopeUnasked,
  isLivePi, livePiOf, bankKeyForInvoice, mayChangeInvoiceBank, bankChangeRefusal, BANK_FOLLOWS_PI,
  parseExchangeRate, sameExchangeRate, mayEditExchangeRate, exchangeRateNote, liveInvoiceOf,
  invoiceAdvanceRate, EXCHANGE_RATE_DESK, RATE_UNDATED,
  invoiceCurrencyFor, exchangeRateRefusal, printedRateNote,
} from "../src/lib/commercial/invoice-rules.ts";
import { usableRate } from "../src/lib/commercial/receipts-rules.ts";
import { DEFAULT_SETTINGS, gstinChoices } from "../src/lib/commercial/settings-defaults.ts";
import type { DocLine } from "../src/lib/commercial/types.ts";

const S = DEFAULT_SETTINGS;
/** The pre-answer-22 tax rule, kept behind the switch: the buyer's state decides. */
const S_BY_STATE = { ...S, tax: { ...S.tax, alwaysIgst: false } };

// ───────────────────────────── kinds & status ────────────────────────────────

test("kind: a DOMESTIC order invoices as DTA, everything else as EXPORT", () => {
  assert.deepEqual([...INVOICE_KINDS], ["DTA", "EXPORT"]);
  assert.equal(defaultKindFor("DOMESTIC"), "DTA");
  assert.equal(defaultKindFor("domestic"), "DTA");
  assert.equal(defaultKindFor("EXPORT"), "EXPORT");
  assert.equal(defaultKindFor(null), "EXPORT");
  assert.equal(sequenceKindFor("DTA"), "dtaInvoice");
  assert.equal(sequenceKindFor("EXPORT"), "exportInvoice");
});

test("status: a draft may be edited, issued or cancelled; an issued one only cancelled", () => {
  assert.equal(canEditInvoice("DRAFT"), true);
  assert.equal(canEditInvoice("ISSUED"), false);
  assert.equal(canIssueInvoice("DRAFT"), true);
  assert.equal(canIssueInvoice("CANCELLED"), false);
  assert.equal(canCancelInvoice("ISSUED"), true);
  assert.equal(canCancelInvoice("CANCELLED"), false);
  assert.equal(statusTone("ISSUED"), "green");
  assert.equal(statusTone("DRAFT"), "amber");
  assert.equal(statusTone("CANCELLED"), "red");
});

test("refuseIssue names the reason; a lined draft passes", () => {
  assert.match(refuseIssue({ status: "ISSUED", snapshot: { lines: [{}] } }) ?? "", /Only a draft/);
  assert.match(refuseIssue({ status: "DRAFT", snapshot: { lines: [] } }) ?? "", /no lines/);
  assert.equal(refuseIssue({ status: "DRAFT", snapshot: { lines: [{}] } }), null);
  assert.match(refuseIssue({ status: "DRAFT", snapshot: null }) ?? "", /no lines/);
});

// ───────────────────────────── printing ──────────────────────────────────────

test("printable strips the nulls the database and the sheets both carry", () => {
  assert.equal(printable(" Hosur "), "Hosur");
  assert.equal(printable("None"), "");
  assert.equal(printable(null), "");
  assert.equal(printable(undefined), "");
  assert.equal(printable("   "), "");
});

test("thickness prints '2 CM' on the DTA sheet and '3CM' on the export one", () => {
  assert.equal(printInvoiceThickness("2 cm", "DTA"), "2 CM");
  assert.equal(printInvoiceThickness("20mm", "DTA"), "2 CM");
  assert.equal(printInvoiceThickness("3 cm", "EXPORT"), "3CM");
  assert.equal(printInvoiceThickness("30mm", "EXPORT"), "3CM");
  assert.equal(printInvoiceThickness("1.2 cm", "DTA"), "1.2 CM");
  assert.equal(printInvoiceThickness("7 mm", "EXPORT"), "0.7CM");
  assert.equal(printInvoiceThickness("", "DTA"), null);
  assert.equal(printInvoiceThickness(null, "EXPORT"), null);
  assert.equal(printInvoiceThickness("Jumbo", "DTA"), "Jumbo", "an unknown spelling passes through");
});

test("unit: SQFT or NOS domestically, SQMT when the order line says so", () => {
  assert.equal(invoiceUnit("SQFT", "DTA"), "SQFT");
  assert.equal(invoiceUnit("Square Foot", "DTA"), "SQFT");
  assert.equal(invoiceUnit("NOS", "DTA"), "NOS");
  assert.equal(invoiceUnit("Set", "DTA"), "NOS");
  assert.equal(invoiceUnit("SQMT", "EXPORT"), "SQMT");
  assert.equal(invoiceUnit("sqm", "EXPORT"), "SQMT");
  assert.equal(invoiceUnit(null, "EXPORT"), "SQFT");
  assert.equal(measureFieldFor("SQMT"), "sqm");
  assert.equal(measureFieldFor("SQFT"), "sqft");
  assert.equal(measureFieldFor("NOS"), "nos");
});

test("dates print DD/MM/YYYY (DTA) and DD-MM-YYYY (PI reference)", () => {
  assert.equal(fmtDMY("2026-07-03"), "03/07/2026");
  assert.equal(fmtDMY("2026-07-03T11:20:00.000Z"), "03/07/2026");
  assert.equal(fmtDMY(new Date(Date.UTC(2026, 6, 3))), "03/07/2026");
  assert.equal(fmtDMY(""), "");
  assert.equal(fmtDMY("not a date"), "");
  assert.equal(fmtDMYDash("2026-07-03"), "03-07-2026");
  assert.equal(isoDate(new Date(Date.UTC(2026, 6, 3, 18, 30))), "2026-07-03");
});

test("datedRef prints ONE date form on the page — the DTA's DD/MM/YYYY, for the invoice and the PI alike", () => {
  // the header used to read "Dated: 14/07/2026" one line above "Dated: 02-07-2026"
  assert.equal(datedRef("PESPL/0137/26-27", "2026-07-14"), "PESPL/0137/26-27      Dated: 14/07/2026");
  assert.equal(datedRef("SAL-ORD/25-26/01416", "2026-07-02"), "SAL-ORD/25-26/01416      Dated: 02/07/2026");
  assert.match(datedRef("X", "2026-07-02"), /Dated: \d{2}\/\d{2}\/\d{4}$/, "slashes, never dashes");
  assert.equal(datedRef("PESPL/2780", null), "PESPL/2780", "no date, no 'Dated:'");
  assert.equal(datedRef("PESPL/2780", "not a date"), "PESPL/2780");
  assert.equal(datedRef(null, "2026-07-14"), "Dated: 14/07/2026");
  assert.equal(datedRef(null, null), "");
});

test("istIsoDate stamps the INDIAN day — a document raised before 05:30 IST is not yesterday's", () => {
  // 01:30 IST on 1 April: a new financial year, and a different challan counter
  assert.equal(istIsoDate(new Date("2026-03-31T20:00:00.000Z")), "2026-04-01");
  assert.equal(isoDate(new Date("2026-03-31T20:00:00.000Z")), "2026-03-31", "the UTC day is the previous FY — what the routes used to stamp");
  assert.equal(istIsoDate(new Date("2026-04-01T01:00:00.000Z")), "2026-04-01", "06:30 IST");
  assert.equal(istIsoDate(new Date("2026-03-31T18:29:00.000Z")), "2026-03-31", "23:59 IST on 31 March is still 31 March");
  assert.equal(istIsoDate(new Date("2026-08-20T18:30:00.000Z")), "2026-08-21", "midnight IST rolls the day");
});

test("numbers: Indian grouping for the DTA sheet, Western for the export one", () => {
  assert.equal(fmtIndian(3749231.7, 2), "37,49,231.70");
  assert.equal(fmtIndian(3177315, 2), "31,77,315.00");
  assert.equal(fmtIndian(75.291, 3), "75.291");
  assert.equal(fmtIndian(null), "");
  assert.equal(fmtWestern(17324.657, 3), "17,324.657");
  assert.equal(trimNumber(5.4), "5.4");
  assert.equal(trimNumber(2), "2");
  assert.equal(trimNumber(0.7), "0.7");
  assert.equal(round2(571916.7049), 571916.7);
  assert.equal(round3(1.23456), 1.235);
  assert.equal(round4(5.40001), 5.4);
});

test("a rate prints at the precision it is STORED with, so quantity × rate is the amount on the page", () => {
  // 3,160.5 SQFT at 1,005.3223 — printing the rate at 3 dp lost a stored digit
  // and left the multiplication on the face of the invoice 0.95 rupees short.
  const q = 3160.5;
  const rate = 1005.3223;
  const amount = round3(q * rate);
  assert.equal(rateDp(rate), 4);
  assert.equal(fmtRateIndian(rate), "1,005.3223");
  const printed = Number(fmtRateIndian(rate).replace(/,/g, ""));
  assert.equal(round2(q * printed), round2(amount), "printed quantity × printed rate IS the printed amount");

  const old3dp = Number(fmtIndian(rate, 3).replace(/,/g, ""));
  assert.notEqual(round2(q * old3dp), round2(amount), "3 dp does not reconcile — the defect this pins");
  assert.equal(round2(amount - q * old3dp), 0.95);

  // a plain rate still reads as money, and nothing invents digits
  assert.equal(rateDp(5.4), 2);
  assert.equal(fmtRateIndian(5.4), "5.40");
  assert.equal(fmtRateWestern(5.4), "5.40");
  assert.equal(fmtRateWestern(1005.3223), "1,005.3223");
  assert.equal(rateDp(100), 2);
  assert.equal(rateDp(12.505), 3);
  assert.equal(rateDp(null), 2, "no rate reads as 0.00");
});

test("the amount column ADDS UP to the Total printed under it", () => {
  const line = (amount: number, lineNo: number): DocLine => ({
    lineNo, itemCode: null, description: "x", design: null, thickness: "2 CM",
    slabs: 1, hsn: "68101990", unit: "SQFT", qty: 1, rate: 1, amount, isSample: false,
  });
  const paise = [line(100.005, 1), line(200.005, 2)];
  const t = invoiceTotals(paise, "DTA", "27", S);
  assert.equal(t.subtotal, 300.01);
  assert.equal(round2(100.005) + round2(200.005), 300.02, "the defect: 2 dp lines sum to 300.02 under a Total of 300.01");
  const dp = amountColumnDp(paise, t.subtotal);
  assert.equal(dp, 3, "so the column prints its stored precision instead");
  const shown = paise.map((l) => Number(fmtIndian(l.amount, dp).replace(/,/g, "")));
  assert.equal(round3(shown.reduce((a, b) => a + b, 0)), Number(fmtIndian(t.subtotal, dp).replace(/,/g, "")));

  // an ordinary invoice keeps the reference sheet's two decimals
  const plain = [line(15058.2, 1), line(3500, 2)];
  assert.equal(amountColumnDp(plain, invoiceTotals(plain, "DTA", "27", S).subtotal), 2);
  assert.equal(amountColumnDp([line(3177315, 1)], 3177315), 2);
  assert.equal(amountColumnDp([], 0), 2);
});

test("invoiceFilename replaces the slashes a number carries", () => {
  assert.equal(invoiceFilename("PESPL/0137/26-27"), "PESPL-0137-26-27.pdf");
  assert.equal(invoiceFilename("PESPL/2780"), "PESPL-2780.pdf");
  assert.equal(invoiceFilename(""), "invoice.pdf");
});

test("buyerPoRef prints the CIOT form: PO, its date, and the PI in brackets", () => {
  assert.equal(
    buyerPoRef({ customerPoNumber: "PO-4068622", customerPoDate: "2026-07-03", number: "SAL-ORD/26-27/01642" }),
    "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/26-27/01642)",
  );
  assert.equal(buyerPoRef({ customerPoNumber: "PO-1", customerPoDate: null, number: "SAL-ORD/1" }), "PO-1 (PI-SAL-ORD/1)");
  assert.equal(buyerPoRef({ customerPoNumber: null, customerPoDate: null, number: "SAL-ORD/1" }), "PI-SAL-ORD/1");
  assert.equal(buyerPoRef({ customerPoNumber: null, customerPoDate: null, number: null }), null);
});

// ───────────────────────────── parties ───────────────────────────────────────

test("partyOrNull keeps a named block and drops an empty one", () => {
  assert.equal(partyOrNull({ name: "", lines: [] }), null);
  assert.equal(partyOrNull(null), null);
  assert.equal(partyOrNull("JB Homes"), null);
  assert.deepEqual(partyOrNull({ name: " JB Homes ", lines: ["Pune", "  ", "MH"], gstin: "27AAACJ1234A1Z5", stateCode: "27" }), {
    name: "JB Homes", lines: ["Pune", "MH"], country: null, tel: null, email: null,
    gstin: "27AAACJ1234A1Z5", stateCode: "27", code: null,
  });
});

test("clientParty is the fallback block; exporterParty is the company master", () => {
  const p = clientParty({ name: "JB Homes", address: "12 Main Rd", city: "Pune", country: "India", commercialExt: { gstin: "27AAACJ1234A1Z5", stateCode: "27", customerCode: "IND-007" } });
  assert.equal(p?.name, "JB Homes");
  assert.deepEqual(p?.lines, ["12 Main Rd", "Pune, India"]);
  assert.equal(p?.gstin, "27AAACJ1234A1Z5");
  assert.equal(p?.code, "IND-007");
  assert.equal(clientParty(null), null);
  const ex = exporterParty(S);
  assert.equal(ex.name, S.company.legalName);
  assert.equal(ex.gstin, "33AALCP2750N1Z3");
  assert.equal(ex.stateCode, "33");
});

test("buyerStateCode: the code on file, then the GSTIN's first two digits", () => {
  assert.equal(buyerStateCode({ stateCode: "27", gstin: "33AALCP2750N1Z3" }, null), "27");
  assert.equal(buyerStateCode({ stateCode: null, gstin: "27AAACJ1234A1Z5" }, null), "27");
  assert.equal(buyerStateCode(null, { name: "x", lines: [], gstin: "29AAACJ1234A1Z5" }), "29");
  assert.equal(buyerStateCode(null, null), null, "unknown state → computeTax assumes IGST and says so");
});

// ───────────────────────────── lines ─────────────────────────────────────────

const items = [
  { lineNo: 1, design: "Carrara Royale", customerSku: "CR-2", thickness: "2 cm", uom: "SQFT", rate: 100, hsn: "68101990", qtySlabs: 2, qty: 150.582, amount: 15058.2 },
  { lineNo: 2, design: "Statuario", customerSku: "ST-3", thickness: "3 cm", uom: "SQMT", rate: 500, hsn: "68101990", qtySlabs: 1, qty: 7, amount: 3500 },
];

test("matchOrderItem pairs a group with the line that prices it", () => {
  assert.equal(matchOrderItem(items, "Carrara Royale", "2 cm")?.lineNo, 1);
  assert.equal(matchOrderItem(items, "carrara royale", "20mm")?.lineNo, 1, "canonical thickness, case-insensitive design");
  assert.equal(matchOrderItem(items, "Statuario", "3 cm")?.lineNo, 2);
  assert.equal(matchOrderItem(items, "Carrara Royale", "3 cm")?.lineNo, 1, "design alone is the loose match");
  assert.equal(matchOrderItem(items, "Unknown", "9 cm"), null);
});

test("matchOrderItem needs BOTH the design AND the thickness for an exact hit", () => {
  // The conjunction is what stops a group being priced off the wrong order
  // line: Statuario at 2 cm must not come back holding the Carrara Royale
  // line's rate just because that line happens to be the 2 cm one.
  const hit = matchOrderItem(items, "Statuario", "2 cm");
  assert.equal(hit?.lineNo, 2, "the design decides; the thickness alone must not pull in another design's line");
  assert.equal(hit?.design, "Statuario");
  assert.equal(hit?.rate, 500);
  assert.equal(matchOrderItem(items, "Carrara Royale", "3 cm")?.rate, 100, "and the same the other way round");

  // and the thickness is what picks between two lines of the SAME design —
  // one order, one colour, 2 cm at one rate and 3 cm at another
  const twoThick = [
    { lineNo: 1, design: "Carrara Royale", thickness: "2 cm", uom: "SQFT", rate: 100 },
    { lineNo: 2, design: "Carrara Royale", thickness: "3 cm", uom: "SQFT", rate: 150 },
  ];
  assert.equal(matchOrderItem(twoThick, "Carrara Royale", "3 cm")?.rate, 150, "the design alone would have priced this off the 2 cm line");
  assert.equal(matchOrderItem(twoThick, "Carrara Royale", "2 cm")?.rate, 100);
  assert.equal(matchOrderItem(twoThick, "Carrara Royale", "1.2 cm")?.rate, 100, "no exact pair — the first line of that design is the loose match");

  // exact wins over loose wherever the exact line sits in the list
  const reversed = [items[1], items[0]];
  assert.equal(matchOrderItem(reversed, "Carrara Royale", "2 cm")?.lineNo, 1);
  assert.equal(matchOrderItem(items, "Carrara Royale", "2 cm")?.lineNo, 1);

  // with no design named, the thickness alone is allowed to match
  assert.equal(matchOrderItem(items, null, "3 cm")?.lineNo, 2);
  assert.equal(matchOrderItem(items, "", "2 cm")?.lineNo, 1);
  assert.equal(matchOrderItem(items, null, "9 cm"), null);
});

test("descriptions: the DTA sheet's assorted-colours fallback, the export sheet's SKU", () => {
  assert.equal(dtaDescription({ description: "White Quartz Slabs" }), "White Quartz Slabs");
  assert.equal(dtaDescription({ design: "Carrara Royale" }), "CARRARA ROYALE");
  assert.equal(dtaDescription({}), DTA_DEFAULT_DESCRIPTION);
  assert.equal(dtaDescription(null), "ASSORTED COLOURS QUARTZ SLABS");
  assert.equal(exportDescription({ customerSku: "VGWT10301A", design: "Carrara Royale" }), "VGWT10301A");
  assert.equal(exportDescription({ design: "Carrara Royale" }), "CARRARA ROYALE");
});

test("lineFromItem prints the STORED amount and never recomputes it", () => {
  // the 1404 PI's line: 3208.273 × 5.4 = 17324.674 by arithmetic, 17324.657 as agreed
  const l = lineFromItem({ design: "Carrara Royale", customerSku: "VGWT10301A", thickness: "3 cm", uom: "SQFT", qtySlabs: 43, qty: 3208.273, rate: 5.4, amount: 17324.657 }, 0, "EXPORT", S);
  assert.equal(l.amount, 17324.657);
  assert.equal(l.qty, 3208.273);
  assert.equal(l.rate, 5.4);
  assert.equal(l.thickness, "3CM");
  assert.equal(l.unit, "SQFT");
  assert.equal(l.slabs, 43);
  assert.equal(l.itemCode, null, "answer 20: the item code is the design master's, and the master is empty here");
  assert.equal(l.description, "VGWT10301A", "the customer's SKU stays in the description, where the CIOT sheet printed it");
  assert.equal(l.hsn, "68101990");
  const coded = lineFromItem({ design: "Carrara Royale", customerSku: "VGWT10301A", thickness: "3 cm", uom: "SQFT", qty: 1, rate: 1 }, 0, "EXPORT", S,
    designCodeLookup([{ design: "CARRARA ROYALE", code: "PES-CR-01" }]));
  assert.equal(coded.itemCode, "PES-CR-01", "the master's code, matched whatever the case");
  assert.equal(coded.description, "VGWT10301A");
  // a line with no amount typed is worked out
  const w = lineFromItem({ design: "Statuario", thickness: "2 cm", uom: "SQFT", qty: 100, rate: 12.5 }, 0, "DTA", S);
  assert.equal(w.amount, 1250);
  assert.equal(w.description, "STATUARIO");
  assert.equal(w.thickness, "2 CM");
});

test("buildInvoiceLines with no packing list mirrors the order, line for line", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].amount, 15058.2);
  assert.equal(lines[0].thickness, "2 CM");
  assert.equal(lines[1].qty, 7);
  assert.equal(lines[1].unit, "SQMT");
});

const slabs = [
  { slabNumber: 144338, design: "Carrara Royale", thickness: "2 cm", sqm: 6.9948, sqft: 75.291 },
  { slabNumber: 144339, design: "Carrara Royale", thickness: "20mm", sqm: 6.9948, sqft: 75.291 },
  { slabNumber: 144340, design: "Statuario", thickness: "3 cm", sqm: 7.0, sqft: 75.348 },
];

test("groupSlabs groups by design + canonical thickness, in first-seen order", () => {
  const g = groupSlabs(slabs);
  assert.equal(g.length, 2);
  assert.equal(g[0].design, "Carrara Royale");
  assert.equal(g[0].thickness, "2 cm");
  assert.equal(g[0].slabs, 2);
  assert.equal(g[0].sqft, 150.582);
  assert.equal(g[0].sqm, 13.9896);
  assert.equal(g[1].design, "Statuario");
  assert.equal(g[1].slabs, 1);
});

test("a slab with no measure counts as a nominal 347 × 201 slab", () => {
  // 347, not 348: the CIOT measurement list's own figure. inToCm(137) rounds
  // 347.98 up to 348, and 348 x 201 would read 75.292 sqft -- a slab nobody
  // measured is the NOMINAL slab, whose area is known, not one to re-derive
  // from the rounding of its own inch display.
  assert.equal(NOMINAL_SLAB.lengthCm, 347);
  assert.equal(NOMINAL_SLAB.widthCm, 201);
  assert.equal(NOMINAL_SLAB.sqm, 6.9747);
  assert.equal(NOMINAL_SLAB.sqft, 75.076);
  const g = groupSlabs([{ design: "Carrara Royale", thickness: "2 cm", sqm: null, sqft: null }]);
  assert.equal(g[0].sqft, NOMINAL_SLAB.sqft);
  assert.equal(g[0].sqm, NOMINAL_SLAB.sqm);
});

test("buildInvoiceLines from a packing list sums the slabs and prices from the order", () => {
  const lines = buildInvoiceLines(items, slabs, "DTA", S);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].slabs, 2);
  assert.equal(lines[0].unit, "SQFT");
  assert.equal(lines[0].qty, 150.582);
  assert.equal(lines[0].rate, 100);
  assert.equal(lines[0].amount, 15058.2, "qty × the order's rate");
  assert.equal(lines[0].description, "CARRARA ROYALE");
  assert.equal(lines[1].unit, "SQMT", "the order line's uom decides which measure is summed");
  assert.equal(lines[1].qty, 7);
  assert.equal(lines[1].amount, 3500);
  assert.deepEqual(lines.map((l) => l.lineNo), [1, 2]);
});

test("a sample line has no slabs on the packing list, so it comes from the order unchanged", () => {
  const withSample = [...items, { lineNo: 3, description: "Display stand", uom: "NOS", qty: 4, rate: 1500, amount: 6000, hsn: "73089050", isSample: true }];
  const lines = buildInvoiceLines(withSample, slabs, "DTA", S);
  assert.equal(lines.length, 3);
  assert.equal(lines[2].description, "Display stand");
  assert.equal(lines[2].unit, "NOS");
  assert.equal(lines[2].hsn, "73089050");
  assert.equal(lines[2].amount, 6000);
  assert.equal(lines[2].isSample, true);
  assert.equal(lines[2].lineNo, 3);
});

test("a group whose design is unknown prints the assorted-colours description", () => {
  const lines = buildInvoiceLines([], [{ design: null, thickness: "2 cm", sqft: 75.291, sqm: 6.9948 }], "DTA", S);
  assert.equal(lines[0].description, DTA_DEFAULT_DESCRIPTION);
  assert.equal(lines[0].rate, 0, "no order line to price it — the screen has to fill the rate in");
  assert.equal(lines[0].hsn, "68101990");
});

test("a packed slab the order cannot price is MARKED, not billed at zero in silence", () => {
  // a slab of a design the order does not carry: matchOrderItem finds nothing,
  // so the line arrives at rate 0 and amount 0 on a tax invoice
  const lines = buildInvoiceLines(items, [{ slabNumber: 144341, design: "Calacatta Gold", thickness: "2 cm", sqm: 6.9948, sqft: 75.291 }], "DTA", S);
  assert.equal(lines[0].qty, 75.291);
  assert.equal(lines[0].rate, 0);
  assert.equal(lines[0].amount, 0);
  assert.equal(lineNeedsPrice(lines[0]), true);
  assert.deepEqual(unpricedLineNos(lines), [1]);
  assert.match(unpricedWarning(lines) ?? "", /^Line 1 has no rate/);
  assert.match(unpricedWarning(lines) ?? "", /bills those slabs at zero/);

  // a priced invoice says nothing
  const priced = buildInvoiceLines(items, slabs, "DTA", S);
  assert.deepEqual(unpricedLineNos(priced), []);
  assert.equal(unpricedWarning(priced), null);

  // two of them read as a list
  const two = buildInvoiceLines([], [
    { design: "Calacatta Gold", thickness: "2 cm", sqft: 75.291, sqm: 6.9948 },
    { design: "Nero Marquina", thickness: "3 cm", sqft: 75.348, sqm: 7 },
  ], "DTA", S);
  assert.deepEqual(unpricedLineNos(two), [1, 2]);
  assert.match(unpricedWarning(two) ?? "", /^Lines 1, 2 have no rate/);

  // a free sample is deliberately worth nothing, and a zero-quantity line is
  // not "unpriced" either
  assert.equal(lineNeedsPrice({ qty: 4, rate: 0, amount: 0, isSample: true }), false);
  assert.equal(lineNeedsPrice({ qty: 0, rate: 0, amount: 0 }), false);
  assert.equal(lineNeedsPrice({ qty: 10, rate: 0, amount: 500 }), false, "an amount typed without a rate is priced");
  assert.equal(lineNeedsPrice({ qty: 10, rate: 12.5, amount: 125 }), false);
});

test("isDerivedAmount tells a worked-out amount from a typed one, so a new rate re-derives", () => {
  assert.equal(isDerivedAmount({ qty: 100, rate: 12.5, amount: 1250 }), true);
  assert.equal(isDerivedAmount({ qty: 3208.273, rate: 5.4, amount: 17324.657 }), false, "the 1404 PI's typed total stands");
  assert.equal(isDerivedAmount({ qty: 75.291, rate: 0, amount: 0 }), true, "an unpriced line re-derives once a rate is typed");
});

test("sanitiseLine coerces a hand-edited line and fills a missing amount", () => {
  const l = sanitiseLine({ description: " White ", qty: "100", rate: "12.5", slabs: "2", unit: "SQFT", hsn: "68101990" }, 0);
  assert.equal(l?.qty, 100);
  assert.equal(l?.rate, 12.5);
  assert.equal(l?.amount, 1250);
  assert.equal(l?.slabs, 2);
  assert.equal(l?.description, "White");
  assert.equal(l?.lineNo, 1);
  assert.equal(sanitiseLine("nonsense", 0), null);
  assert.equal(sanitiseLine({ qty: 1, rate: 1, amount: 999 }, 0)?.amount, 999, "a typed amount stands");
});

// ───────────────────────────── totals ────────────────────────────────────────

const dtaLine = (amount: number, slabs = 42): DocLine => ({
  lineNo: 1, itemCode: null, description: DTA_DEFAULT_DESCRIPTION, design: null, thickness: "2 CM",
  slabs, hsn: "68101990", unit: "SQFT", qty: 3160.5, rate: 1005.32, amount, isSample: false,
});

test("DTA totals: IGST 18% out of state, whole-rupee grand total, the round-off shown", () => {
  // the JB Homes sheet: 31,77,315.00 + 18% = 37,49,231.70, printed as 37,49,232
  const t = invoiceTotals([dtaLine(3177315)], "DTA", "27", S);
  assert.equal(t.subtotal, 3177315);
  assert.equal(t.taxType, "IGST");
  assert.equal(t.taxRate, 18);
  assert.equal(t.igst, 571916.7);
  assert.equal(t.cgst, 0);
  assert.equal(t.sgst, 0);
  assert.equal(t.grandTotal, 3749232);
  assert.equal(t.roundOff, 0.3);
  assert.equal(t.amountInWords, "Thirty Seven Lakh Forty Nine Thousand Two Hundred Thirty Two Rupees Only.");
  assert.equal(t.totalSlabs, 42);
  assert.equal(t.warning, null);
});

test("DTA totals (answer 22): IGST 18% for EVERY domestic buyer, Tamil Nadu included, and no state warning", () => {
  assert.equal(S.tax.alwaysIgst, true, "the switch the owner set on 2026-09-07");
  const tn = invoiceTotals([dtaLine(100000)], "DTA", "33", S);
  assert.equal(tn.taxType, "IGST");
  assert.equal(tn.igst, 18000);
  assert.equal(tn.cgst, 0);
  assert.equal(tn.sgst, 0);
  assert.equal(tn.grandTotal, 118000);
  assert.equal(tn.warning, null);
  const unknown = invoiceTotals([dtaLine(100000)], "DTA", null, S);
  assert.equal(unknown.taxType, "IGST");
  assert.equal(unknown.warning, null, "there is no state code to fill in, so nothing to warn about");
  const exp = invoiceTotals([dtaLine(100000)], "EXPORT", "33", S, "USD");
  assert.equal(exp.taxType, "NONE", "the switch is about domestic tax; export stays under LUT");
});

test("DTA totals: with the switch OFF a Tamil Nadu buyer pays CGST 9 + SGST 9, not IGST", () => {
  const t = invoiceTotals([dtaLine(100000)], "DTA", "33", S_BY_STATE);
  assert.equal(t.taxType, "CGST_SGST");
  assert.equal(t.cgst, 9000);
  assert.equal(t.sgst, 9000);
  assert.equal(t.igst, 0);
  assert.equal(t.taxRate, 18);
  assert.equal(t.grandTotal, 118000);
});

test("DTA totals: with the switch OFF an unknown buyer state falls to IGST and says so", () => {
  const t = invoiceTotals([dtaLine(100000)], "DTA", null, S_BY_STATE);
  assert.equal(t.taxType, "IGST");
  assert.match(t.warning ?? "", /state code missing/i);
});

test("EXPORT totals: no GST under LUT, and the three decimals are kept", () => {
  const line: DocLine = { ...dtaLine(17324.657, 43), unit: "SQFT", thickness: "3CM" };
  const t = invoiceTotals([line], "EXPORT", null, S, "USD");
  assert.equal(t.subtotal, 17324.657);
  assert.equal(t.taxType, "NONE");
  assert.equal(t.taxTotal, 0);
  assert.equal(t.roundOff, 0, "an export invoice is not rounded to a whole unit");
  assert.equal(t.grandTotal, 17324.657);
  assert.equal(t.amountInWords, "USD Seventeen Thousand, Three Hundred And Twenty Four and Sixty Six Cent only.");
});

// ───────────────────────────── the snapshot ──────────────────────────────────

const order = {
  number: "SAL-ORD/26-27/01642",
  kind: "DOMESTIC",
  currency: "INR",
  customerPoNumber: "PO-4068622",
  customerPoDate: "2026-07-03",
  deliveryTerms: "Ex-Factory Without Packing",
  paymentTerms: "100% Advance Payment",
  createdByName: "Pavankumar",
  billTo: { name: "JB Homes", lines: ["12 Main Rd", "Pune"], gstin: "27AAACJ1234A1Z5", stateCode: "27" },
  consignee: null,
  client: { name: "JB Homes", address: "12 Main Rd", city: "Pune", country: "India", commercialExt: { gstin: "27AAACJ1234A1Z5", stateCode: "27", customerCode: null } },
  items,
};

test("buildInvoiceSnapshot (DTA): domestic bank, no LUT, buyer from bill-to, totals frozen", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  const snap = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10", piDate: "2026-07-03" });
  assert.equal(snap.kind, "DTA");
  assert.equal(snap.currency, "INR");
  assert.equal(snap.date, "2026-07-10");
  assert.equal(snap.piNumber, "SAL-ORD/26-27/01642");
  assert.equal(snap.piDate, "2026-07-03");
  assert.equal(snap.buyerPoRef, "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/26-27/01642)");
  assert.equal(snap.salesPerson, "Pavankumar");
  assert.equal(snap.commodity, COMMODITY);
  assert.equal(snap.bank.accountNo, S.banks.domestic.accountNo, "ICICI on a DTA invoice");
  assert.equal(snap.lutText, null, "the LUT remark belongs to an export invoice only");
  assert.equal(snap.buyer.name, "JB Homes");
  assert.equal(snap.buyer.stateCode, "27");
  assert.equal(snap.consignee.name, "JB Homes", "no consignee on the order → the client");
  assert.equal(snap.taxType, "IGST");
  assert.equal(snap.subtotal, 18558.2);
  assert.equal(snap.grandTotal, Math.round(18558.2 * 1.18));
  assert.equal(snap.company.tan, "BLRP25273D");
  assert.equal(snap.company.locationCode, "XP0605");
  assert.equal(snap.company.hsnQuartz, "68101990");
  assert.equal(snap.declaration, S.texts.dtaDeclaration);
  assert.equal(snap.number, "", "the route stamps the number once issueNumber has run");
});

test("buildInvoiceSnapshot (EXPORT): Kotak, the LUT remark, USD, the port defaults", () => {
  const exportOrder = { ...order, kind: "EXPORT", currency: "USD", billTo: { name: "CIOT LLC", lines: ["Dallas, TX"], country: "USA" }, client: { name: "CIOT LLC", country: "USA", commercialExt: null } };
  const lines = buildInvoiceLines(items, null, "EXPORT", S);
  const snap = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", containerNo: "TCLU1234567", sealNo: "IN0012345", marksAndNos: "01 TO 07", packages: "07 Wooden Crate(S)" });
  assert.equal(snap.currency, "USD");
  assert.equal(snap.bank.accountNo, S.banks.export.accountNo);
  assert.equal(snap.bank.adCode, "0180038-8400009");
  assert.match(snap.lutText ?? "", /Supply Meant For Export Under LUT/);
  assert.equal(snap.portOfLoading, "CHENNAI");
  assert.equal(snap.preCarriageBy, "By Road");
  assert.equal(snap.taxType, "NONE");
  assert.equal(snap.containerNo, "TCLU1234567");
  assert.equal(snap.marksAndNos, "01 TO 07");
  assert.equal(snap.packages, "07 Wooden Crate(S)");
  assert.equal(snap.countryOfDestination, "USA");
  assert.equal(snap.grandTotal, snap.subtotal, "no GST, nothing rounded away");
});

test("recomputeSnapshot re-derives the tax after an edit; rowTotalsFromSnapshot mirrors it", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  const snap = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10" });
  const edited = recomputeSnapshot({ ...snap, lines: [dtaLine(100000)] }, S);
  assert.equal(edited.subtotal, 100000);
  assert.equal(edited.igst, 18000);
  assert.equal(edited.grandTotal, 118000);
  const row = rowTotalsFromSnapshot(edited);
  assert.equal(row.subtotal, 100000);
  assert.equal(row.grandTotal, 118000);
  assert.equal(row.taxType, "IGST");
  assert.equal(row.amountInWords, "One Lakh Eighteen Thousand Rupees Only.");
});

// ───────────────────────────── draft edits ───────────────────────────────────

test("applyDraftPatch changes only the fields it may, and re-derives the totals", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  const snap = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10" });

  const a = applyDraftPatch(snap, { vehicleNo: "TN 20 CJ 1234", transporter: "SRT Logistics", notes: "Gate pass 44" }, S);
  assert.equal(a.changed, true);
  assert.equal(a.snapshot.vehicleNo, "TN 20 CJ 1234");
  assert.equal(a.snapshot.transporter, "SRT Logistics");
  assert.equal(a.snapshot.grandTotal, snap.grandTotal, "transport fields do not touch the money");

  const b = applyDraftPatch(snap, { number: "PESPL/9999", kind: "EXPORT", grandTotal: 1, bank: { accountNo: "x" } }, S);
  assert.equal(b.changed, false, "number, kind, totals and bank are not editable");
  assert.equal(b.snapshot.number, snap.number);

  const c = applyDraftPatch(snap, { date: "10-07-2026" }, S);
  assert.equal(c.changed, false, "a date that is not YYYY-MM-DD is ignored");

  const d = applyDraftPatch(snap, { date: "2026-07-11" }, S);
  assert.equal(d.snapshot.date, "2026-07-11");

  const e = applyDraftPatch(snap, { lines: [{ description: "White", qty: 10, rate: 10, unit: "SQFT", hsn: "68101990" }] }, S);
  assert.equal(e.changed, true, "the route writes NOTHING when this is false — the edit would be lost behind a 200");
  assert.equal(e.snapshot.lines.length, 1);
  assert.equal(e.snapshot.subtotal, 100);
  assert.equal(e.snapshot.igst, 18);
  assert.equal(e.snapshot.grandTotal, 118);

  const f = applyDraftPatch(snap, { buyer: { name: "JB Homes", lines: ["Hosur"], stateCode: "33" } }, S);
  assert.equal(f.snapshot.taxType, "IGST", "answer 22: moving the buyer into Tamil Nadu changes nothing");
  const f2 = applyDraftPatch(recomputeSnapshot(snap, S_BY_STATE), { buyer: { name: "JB Homes", lines: ["Hosur"], stateCode: "33" } }, S_BY_STATE);
  assert.equal(f2.snapshot.taxType, "CGST_SGST", "the by-state path still works behind the switch");

  const g = applyDraftPatch(snap, { consignee: null }, S);
  assert.equal(g.changed, false, "an invoice must name a consignee — a blank one is ignored");

  assert.equal(applyDraftPatch(snap, null, S).changed, false);
});

test("applyDraftPatch: the LINES path reports `changed` truthfully — the route discards the edit when it lies", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  const snap = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10" });

  // a real replacement is a change: rowPatchFor(snapshot) only reaches the row
  // when this is true, so `false` here means a 200 and nothing written
  const repriced = snap.lines.map((l) => ({ ...l, rate: 200, amount: "" }));
  const a = applyDraftPatch(snap, { lines: repriced }, S);
  assert.equal(a.changed, true);
  assert.deepEqual(a.rejected, []);
  assert.equal(a.snapshot.lines[0].rate, 200);
  assert.equal(a.snapshot.lines[0].amount, round3(150.582 * 200));
  assert.notEqual(a.snapshot.subtotal, snap.subtotal, "and the totals were re-derived");

  // one line's rate, the rest untouched — what the invoice screen's Save rates sends
  const oneRate = applyDraftPatch(snap, { lines: snap.lines.map((l, i) => (i === 0 ? { ...l, rate: 101, amount: "" } : l)) }, S);
  assert.equal(oneRate.changed, true);
  assert.equal(oneRate.snapshot.lines[0].rate, 101);
  assert.equal(oneRate.snapshot.lines[1].amount, 3500, "the other line is untouched");

  // the same lines back again is genuinely no change
  const same = applyDraftPatch(snap, { lines: JSON.parse(JSON.stringify(snap.lines)) }, S);
  assert.equal(same.changed, false);
  assert.deepEqual(same.snapshot.lines, snap.lines);

  // `lines` that is not an array was silently dropped; now it is refused, so
  // the route answers 400 instead of "saved" with nothing saved
  const bad = applyDraftPatch(snap, { lines: "nonsense" }, S);
  assert.equal(bad.changed, false);
  assert.deepEqual(bad.rejected, ["lines"]);
  assert.deepEqual(bad.snapshot.lines, snap.lines);

  // and the other fields that get thrown away name themselves too
  assert.deepEqual(applyDraftPatch(snap, { date: "10-07-2026" }, S).rejected, ["date"]);
  assert.deepEqual(applyDraftPatch(snap, { piDate: "not a date" }, S).rejected, ["piDate"]);
  assert.deepEqual(applyDraftPatch(snap, { consignee: null }, S).rejected, ["consignee"]);
  assert.deepEqual(applyDraftPatch(snap, { vehicleNo: "TN 20 CJ 1234" }, S).rejected, [], "a good edit refuses nothing");
});

test("applyDraftPatch: the EXCHANGE RATE path coerces a string, rounds to 4 dp and reaches the snapshot", () => {
  const exportOrder = { ...order, kind: "EXPORT", currency: "USD", exchangeRate: null };
  const lines = buildInvoiceLines(items, null, "EXPORT", S);
  const snap = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20" });
  assert.equal(snap.exchangeRate, null);

  const a = applyDraftPatch(snap, { exchangeRate: "88.123456" }, S);
  assert.equal(a.changed, true, "the route writes nothing when this is false");
  assert.equal(a.snapshot.exchangeRate, 88.1235, "a string is coerced and kept to 4 dp — the column is Decimal(12,4)");
  assert.equal(a.snapshot.grandTotal, snap.grandTotal, "the rate does not touch the invoice's own money");

  assert.equal(applyDraftPatch(a.snapshot, { exchangeRate: 88.1235 }, S).changed, false, "the same rate again is not a change");
  assert.equal(applyDraftPatch(a.snapshot, { exchangeRate: "88.1234" }, S).snapshot.exchangeRate, 88.1234);
  assert.equal(applyDraftPatch(a.snapshot, { exchangeRate: "1,00,000.5" }, S).snapshot.exchangeRate, 100000.5, "grouped digits are read");

  const cleared = applyDraftPatch(a.snapshot, { exchangeRate: "" }, S);
  assert.equal(cleared.changed, true);
  assert.equal(cleared.snapshot.exchangeRate, null, "blank clears it");
  assert.equal(applyDraftPatch(snap, { exchangeRate: null }, S).changed, false, "already null");

  // and the two ways it is set when the invoice is first drafted
  assert.equal(buildInvoiceSnapshot({ ...exportOrder, exchangeRate: "88.123456" }, S, "EXPORT", lines, { date: "2026-08-20" }).exchangeRate, 88.1235);
  assert.equal(buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", exchangeRate: 89.5 }).exchangeRate, 89.5);
});

test("the screens show the SNAPSHOT's total, not the NUMERIC(16,2) column it was rounded into", () => {
  // commercial_invoice.grand_total is Decimal(16,2); an export document carries
  // three decimals, so the column reads 17,324.657 back as 17,324.66 and the
  // register printed 17,324.660 beside a PDF that said .657.
  const column = round2(17324.657);
  assert.equal(column, 17324.66);
  assert.equal(fmtWestern(column, 3), "17,324.660", "what the register used to print");

  assert.equal(displayGrandTotal({ grandTotal: column, snapshot: { grandTotal: 17324.657 } }), 17324.657);
  assert.equal(displayGrandTotal({ grandTotal: column, grandTotalExact: 17324.657 }), 17324.657, "the register carries it as grandTotalExact");
  assert.equal(fmtWestern(displayGrandTotal({ grandTotal: column, grandTotalExact: 17324.657 }), 3), "17,324.657");
  assert.equal(displayGrandTotal({ grandTotal: column }), column, "a row written without a snapshot still shows something");
  assert.equal(displayGrandTotal({ grandTotal: null }), null);
  assert.equal(displayGrandTotal(null), null);
  assert.equal(displaySubtotal({ subtotal: column, snapshot: { subtotal: 17324.657 } }), 17324.657);
  assert.equal(displaySubtotal({ subtotal: 12, subtotalExact: 12.345 }), 12.345);

  // the snapshot really does keep the third decimal an export invoice needs
  const line: DocLine = { ...dtaLine(17324.657, 43), unit: "SQFT", thickness: "3CM" };
  const exportSnap = buildInvoiceSnapshot({ ...order, kind: "EXPORT", currency: "USD" }, S, "EXPORT", [line], { date: "2026-08-20" });
  assert.equal(exportSnap.grandTotal, 17324.657);
  assert.notEqual(round2(exportSnap.grandTotal), exportSnap.grandTotal);
});

// ───────────────────────────── list filters ──────────────────────────────────

test("invoicesWhere: kind, status, order, a date window and a free-text search", () => {
  assert.deepEqual(invoicesWhere({}), {});
  assert.deepEqual(invoicesWhere({ kind: "dta" }), { kind: "DTA" });
  assert.deepEqual(invoicesWhere({ kind: "nonsense" }), {}, "an unknown kind is ignored, not sent to Postgres");
  assert.deepEqual(invoicesWhere({ status: "DRAFT,ISSUED" }), { status: { in: ["DRAFT", "ISSUED"] } });
  assert.deepEqual(invoicesWhere({ orderId: "ord1" }), { orderId: "ord1" });
  const w = invoicesWhere({ from: "2026-07-01", to: "2026-07-31" });
  assert.equal((w.invoiceDate as { gte: Date }).gte.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal((w.invoiceDate as { lte: Date }).lte.toISOString(), "2026-07-31T00:00:00.000Z");
  const q = invoicesWhere({ q: "2780" });
  assert.equal((q.OR as unknown[]).length, 3);
});

test("pageArgs: 1/50 by default, clamped, skip worked out", () => {
  assert.deepEqual(pageArgs(null, null), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageArgs("3", "20"), { page: 3, limit: 20, skip: 40, take: 20 });
  assert.deepEqual(pageArgs(-4, 9000), { page: 1, limit: 500, skip: 0, take: 500 });
  assert.deepEqual(pageArgs("abc", "abc"), { page: 1, limit: 50, skip: 0, take: 50 });
});

// ───────────────────── the owner's answers of 2026-09-07 ─────────────────────

test("one invoice per order (answer 18): a second draft is refused while one is not cancelled", () => {
  assert.equal(refuseCreate([]), null);
  assert.equal(refuseCreate(null), null);
  assert.equal(refuseCreate([{ status: "CANCELLED", number: "PESPL/N1" }]), null, "a cancelled invoice no longer counts");
  assert.match(refuseCreate([{ status: "DRAFT", number: "PESPL/N2" }]) ?? "", /already has invoice PESPL\/N2 \(draft\)/);
  assert.match(refuseCreate([{ status: "ISSUED", number: "PESPL/N2" }]) ?? "", /cancel it with a reason before raising another/);
  assert.match(refuseCreate([{ status: "issued" }]) ?? "", /already has an invoice/, "case-insensitive, and a number-less row still blocks");
  assert.equal(openInvoiceOf([{ status: "CANCELLED", id: 1 }, { status: "ISSUED", id: 2 }])?.id, 2);
  assert.equal(openInvoiceOf([{ status: "CANCELLED" }]), null);
});

test("approval before the final invoice (answer 10): the refusal names who approves", () => {
  assert.equal(refuseIssueUnapproved({ approvedAt: "2026-09-07T10:00:00.000Z" }), null);
  assert.equal(refuseIssueUnapproved({ approvedAt: new Date() }), null);
  const r = refuseIssueUnapproved({ approvedAt: null });
  assert.match(r ?? "", /^The checklist must be approved before the final invoice/, "the same sentence stages.canEnter gives");
  assert.ok(r?.includes(INVOICE_APPROVERS), "and who can do it");
  assert.match(INVOICE_APPROVERS, /Commercial Manager/);
  assert.notEqual(refuseIssueUnapproved(null), null);
  assert.notEqual(refuseIssueUnapproved({}), null);
  assert.notEqual(refuseIssueUnapproved({ approvedAt: "" }), null);
});

test("the bank (answer 23): ICICI on a DTA invoice, Kotak on an export one, either by choice", () => {
  assert.deepEqual([...BANK_KEYS], ["export", "domestic"]);
  assert.equal(defaultBankKeyFor("DTA"), "domestic");
  assert.equal(defaultBankKeyFor("EXPORT"), "export");
  assert.equal(isBankKey("export"), true);
  assert.equal(isBankKey("EXPORT"), false, "the key is the settings key, exactly");
  assert.equal(isBankKey(null), false);
  assert.equal(bankBlockFor(S, "domestic").accountNo, S.banks.domestic.accountNo);
  assert.equal(bankBlockFor(S, "export").adCode, S.banks.export.adCode);

  const lines = buildInvoiceLines(items, null, "DTA", S);
  const kotakOnDta = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10", bankKey: "export" });
  assert.equal(kotakOnDta.bankKey, "export");
  assert.equal(kotakOnDta.bank.accountNo, S.banks.export.accountNo, "the dropdown overrides the default");
  const dflt = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10" });
  assert.equal(dflt.bankKey, "domestic");
  assert.equal(dflt.bank.accountNo, S.banks.domestic.accountNo);

  // editable while a draft
  const sw = applyDraftPatch(dflt, { bankKey: "export" }, S);
  assert.equal(sw.changed, true);
  assert.equal(sw.snapshot.bankKey, "export");
  assert.equal(sw.snapshot.bank.name, S.banks.export.name);
  assert.equal(applyDraftPatch(sw.snapshot, { bankKey: "export" }, S).changed, false, "the same bank again is no change");
  const bad = applyDraftPatch(dflt, { bankKey: "hdfc" }, S);
  assert.deepEqual(bad.rejected, ["bankKey"], "a bank the settings do not hold is refused by name");
  assert.equal(bad.snapshot.bank.accountNo, S.banks.domestic.accountNo);
});

test("the GSTIN (answer 21): the company's own by default, the sister company's by choice, labelled", () => {
  const choices = gstinChoices(S.company);
  assert.equal(choices[0].gstin, "33AALCP2750N1Z3");
  assert.equal(choices[1].gstin, "33AAFCP5374A1ZQ", "PGI's, seeded in the defaults");
  assert.equal(gstinChoiceFor(S, null)?.gstin, "33AALCP2750N1Z3");
  assert.equal(gstinChoiceFor(S, "")?.gstin, "33AALCP2750N1Z3");
  assert.equal(gstinChoiceFor(S, "33aafcp5374a1zq")?.gstin, "33AAFCP5374A1ZQ", "case does not matter");
  assert.equal(gstinChoiceFor(S, "27AAACJ1234A1Z5"), null, "a registration the settings do not offer is refused, not printed");
  assert.equal(gstinLabelFor(S, choices[0]), null, "the company's own needs no label — the name above it says whose it is");
  assert.equal(gstinLabelFor(S, choices[1]), "Pacific Granites (India) Pvt Ltd");
  assert.equal(gstinWithLabel("33AAFCP5374A1ZQ", "Pacific Granites (India) Pvt Ltd"), "33AAFCP5374A1ZQ (Pacific Granites (India) Pvt Ltd)");
  assert.equal(gstinWithLabel("33AALCP2750N1Z3", null), "33AALCP2750N1Z3");
  assert.equal(gstinWithLabel(null, "x"), "");

  const lines = buildInvoiceLines(items, null, "EXPORT", S);
  const own = buildInvoiceSnapshot({ ...order, kind: "EXPORT", currency: "USD" }, S, "EXPORT", lines, { date: "2026-08-20" });
  assert.equal(own.gstin, "33AALCP2750N1Z3");
  assert.equal(own.gstinLabel, null);
  assert.equal(own.company.gstin, "33AALCP2750N1Z3");
  assert.equal(own.exporter.gstin, "33AALCP2750N1Z3");

  const pgi = buildInvoiceSnapshot({ ...order, kind: "EXPORT", currency: "USD" }, S, "EXPORT", lines, { date: "2026-08-20", gstin: "33AAFCP5374A1ZQ" });
  assert.equal(pgi.gstin, "33AAFCP5374A1ZQ");
  assert.equal(pgi.gstinLabel, "Pacific Granites (India) Pvt Ltd");
  assert.equal(pgi.company.gstin, "33AAFCP5374A1ZQ", "a reader of the old shape prints the chosen registration too");
  assert.equal(pgi.exporter.gstin, "33AAFCP5374A1ZQ");
  assert.equal(pgi.company.legalName, S.company.legalName, "the company's name does not change — only the registration under it");

  const unknown = buildInvoiceSnapshot(order, S, "DTA", buildInvoiceLines(items, null, "DTA", S), { date: "2026-07-10", gstin: "27AAACJ1234A1Z5" });
  assert.equal(unknown.gstin, "33AALCP2750N1Z3", "a direct caller with an unknown GSTIN gets the company's own, never a blank");

  // editable while a draft
  const sw = applyDraftPatch(own, { gstin: "33AAFCP5374A1ZQ" }, S);
  assert.equal(sw.changed, true);
  assert.equal(sw.snapshot.gstin, "33AAFCP5374A1ZQ");
  assert.equal(sw.snapshot.gstinLabel, "Pacific Granites (India) Pvt Ltd");
  assert.equal(sw.snapshot.company.gstin, "33AAFCP5374A1ZQ");
  assert.equal(sw.snapshot.exporter.gstin, "33AAFCP5374A1ZQ");
  assert.equal(sw.snapshot.grandTotal, own.grandTotal, "the registration does not touch the money");
  assert.deepEqual(applyDraftPatch(own, { gstin: "27AAACJ1234A1Z5" }, S).rejected, ["gstin"]);
  const back = applyDraftPatch(sw.snapshot, { gstin: "" }, S);
  assert.equal(back.snapshot.gstin, "33AALCP2750N1Z3", "blank means the company's own");
  assert.equal(back.snapshot.gstinLabel, null);
});

test("snapshotExtras reads a row frozen before the answers with the defaults it would have had", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  const snap = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10" });
  const { gstin, gstinLabel, bankKey, gstinApplyAll, ...old } = snap;
  void gstin; void gstinLabel; void bankKey; void gstinApplyAll;
  const ex = snapshotExtras(old);
  assert.equal(ex.gstin, "33AALCP2750N1Z3", "from company.gstin");
  assert.equal(ex.gstinLabel, null);
  assert.equal(ex.bankKey, "domestic", "by kind");
  assert.equal(ex.gstinApplyAll, true, "before the question was asked an alternate went onto every sheet — reading such a row must not change its workbook");
  assert.equal(snapshotExtras({ ...old, kind: "EXPORT" }).bankKey, "export");
  // and such a row can still have its bank switched
  const sw = applyDraftPatch(old, { bankKey: "export" }, S);
  assert.equal(sw.changed, true);
  assert.equal(sw.snapshot.bankKey, "export");
});

test("design codes (answer 20): the master's code on the line, the name on paper, a marker on the screen", () => {
  const codeFor = designCodeLookup([
    { design: "Carrara Royale", code: "PES-CR-01" },
    { design: "  Statuario  Venato ", code: " PES-SV-02 " },
    { design: "Nero", code: null },
    { design: "", code: "ORPHAN" },
  ]);
  assert.equal(codeFor("carrara royale"), "PES-CR-01");
  assert.equal(codeFor("STATUARIO VENATO"), "PES-SV-02", "spacing and case are the floor's, not the master's");
  assert.equal(codeFor("Nero"), null, "a row without a code is no code");
  assert.equal(codeFor("Calacatta"), null);
  assert.equal(codeFor(null), null);
  assert.equal(NO_DESIGN_CODE("Carrara Royale"), null);

  const coded = buildInvoiceLines(items, slabs, "EXPORT", S, codeFor);
  assert.equal(coded[0].itemCode, "PES-CR-01");
  assert.equal(coded[1].itemCode, null, "Statuario has no code in this master");
  assert.equal(lineLacksCode(coded[0]), false);
  assert.equal(lineLacksCode(coded[1]), true, "the screen marks it");
  assert.equal(printedItemCode(coded[0]), "PES-CR-01");
  assert.equal(printedItemCode(coded[1]), "Statuario", "the document prints the design name, never a marker");
  assert.equal(printedItemCode({ itemCode: null, design: null, description: "Display stand" }), "Display stand");
  assert.equal(lineLacksCode({ itemCode: null, isSample: true }), false, "a sample is not a design");

  const plain = buildInvoiceLines(items, slabs, "EXPORT", S);
  assert.deepEqual(plain.map((l) => l.itemCode), [null, null], "no master, no codes — the description still carries the SKU");
  assert.equal(plain[0].description, "CR-2");
});

test("the date prints DIRECTLY UNDER the number (answer 6), and an export number shows its FY beside it", () => {
  assert.deepEqual(datedLines("PESPL/N12", "2026-07-14"), ["PESPL/N12", "Dated: 14/07/2026"]);
  assert.deepEqual(datedLines("PESPL/N12", null), ["PESPL/N12"], "no date, no bare 'Dated:'");
  assert.deepEqual(datedLines(null, "2026-07-14"), ["Dated: 14/07/2026"]);
  assert.deepEqual(datedLines("", ""), []);
  assert.deepEqual(datedLines("PESPL/DC/N3/26", new Date(Date.UTC(2026, 7, 20))), ["PESPL/DC/N3/26", "Dated: 20/08/2026"]);

  assert.equal(fyOfIso("2026-04-01"), "26-27");
  assert.equal(fyOfIso("2026-03-31"), "25-26");
  assert.equal(fyOfIso("2027-01-15T10:00:00.000Z"), "26-27");
  assert.equal(fyOfIso(new Date(Date.UTC(2026, 3, 1))), "26-27");
  assert.equal(fyOfIso("nonsense"), "");
  assert.equal(fyOfIso(null), "");

  assert.equal(fyBadge("EXPORT", "2026-07-14"), "FY 26-27", "PESPL/N{seq} runs on across years, so the register says which year");
  assert.equal(fyBadge("export", "2027-02-01"), "FY 26-27");
  assert.equal(fyBadge("DTA", "2026-07-14"), null, "a DTA number already carries its FY");
  assert.equal(fyBadge("EXPORT", null), null);
});

// ─────────── what an edit logged, and what the export form overrode ──────────

test("the edit log names the body keys that landed — never the derived totals", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  const before = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10" });

  const body: Record<string, unknown> = {
    gstin: "33AAFCP5374A1ZQ",     // changes the registration
    vehicleNo: "KA 05 AB 1234",   // changes a snapshot field
    notes: null,                  // named, but already null — nothing changed
    lrNo: "LR-99",                // row-only: no snapshot field to compare
  };
  const { snapshot: after } = applyDraftPatch(before, body, S);

  assert.deepEqual(patchedSnapshotFields(body, before, after), ["gstin", "vehicleNo"]);
  assert.deepEqual(patchedInvoiceFields(body, before, after), ["gstin", "vehicleNo", "lrNo"],
    "the row-only columns are in the log too, in the order the body named them");
  assert.deepEqual([...ROW_ONLY_PATCH_FIELDS], ["lrNo", "ewayBillNo", "packingListId"]);

  // the failure this replaced: Object.keys(the UPDATE data) reported the
  // re-derived money columns and nothing the clerk actually typed.
  const edited = applyDraftPatch(before, { lines: [{ ...lines[0], rate: 200 }] }, S);
  const fields = patchedInvoiceFields({ lines: [] }, before, edited.snapshot);
  assert.deepEqual(fields, ["lines"]);
  assert.equal(fields.includes("grandTotal"), false);
  assert.equal(fields.includes("igst"), false);
  assert.notEqual(edited.snapshot.grandTotal, before.grandTotal, "the totals DID move — they are just not the news");

  // the invoice date is `invoiceDate` on the row and `date` in the snapshot
  const dated = applyDraftPatch(before, { invoiceDate: "2026-07-11", date: "2026-07-11" }, S);
  assert.deepEqual(patchedInvoiceFields({ invoiceDate: "2026-07-11" }, before, dated.snapshot), ["invoiceDate"]);

  assert.deepEqual(patchedInvoiceFields(null, before, after), []);
  assert.deepEqual(patchedInvoiceFields({}, before, before), []);
});

test("a GSTIN or bank switch is logged BY VALUE (answers 21, 23)", () => {
  const lines = buildInvoiceLines(items, null, "DTA", S);
  const before = buildInvoiceSnapshot(order, S, "DTA", lines, { date: "2026-07-10" });
  const { snapshot: after } = applyDraftPatch(before, { gstin: "33AAFCP5374A1ZQ", bankKey: "export" }, S);

  const c = registrationChanges(before, after);
  assert.deepEqual(c?.gstin, { from: "33AALCP2750N1Z3", to: "33AAFCP5374A1ZQ" });
  assert.deepEqual(c?.gstinLabel, { from: null, to: "Pacific Granites (India) Pvt Ltd" });
  assert.deepEqual(c?.bankKey, { from: "domestic", to: "export" });

  const note = registrationChangeNote(c);
  assert.match(note, /GSTIN 33AALCP2750N1Z3 → 33AAFCP5374A1ZQ \(Pacific Granites \(India\) Pvt Ltd\)/);
  assert.match(note, /bank domestic → export/);

  assert.equal(registrationChanges(before, before), null, "an edit that left both alone logs no registration change");
  assert.equal(registrationChangeNote(null), "");

  // a row frozen before the two answers existed carries neither field; reading
  // it must not report a change against the defaults it always had.
  const { gstin, gstinLabel, bankKey, ...pre } = before;
  void gstin; void gstinLabel; void bankKey;
  assert.equal(registrationChanges(pre, before), null);
  assert.deepEqual(patchedInvoiceFields({ gstin: "33AALCP2750N1Z3" }, pre, before), []);
});

test("exportRootOverrides: the SAVED export form, not the invoice, is what the workbook prints", () => {
  const lines = buildInvoiceLines(items, null, "EXPORT", S);
  const snap = buildInvoiceSnapshot({ ...order, kind: "EXPORT", currency: "USD" }, S, "EXPORT", lines, { date: "2026-08-20" });
  const bankName = snap.bank?.name ?? "";
  assert.equal(snap.gstin, "33AALCP2750N1Z3");
  assert.equal(bankName, S.banks.export.name);

  assert.deepEqual(exportRootOverrides(snap, null), [], "nothing saved — the invoice's choice is what the form will default to");
  assert.deepEqual(exportRootOverrides(snap, {}), []);
  assert.deepEqual(exportRootOverrides(null, { [EXPORT_ROOT_GSTIN_KEY]: "anything" }), []);

  assert.deepEqual(exportRootOverrides(snap, {
    [EXPORT_ROOT_GSTIN_KEY]: `GSTIN NO: ${snap.gstin}`,
    [EXPORT_ROOT_BANK_KEY]: bankName,
  }), [], "the prefill saved back unchanged is not an override");

  assert.deepEqual(exportRootOverrides(snap, {
    [EXPORT_ROOT_GSTIN_KEY]: `GSTIN  ${snap.gstin} (Pacific Exports)`,
    [EXPORT_ROOT_BANK_KEY]: `  ${bankName.toUpperCase()} `,
  }), [], "re-typed wording, spacing and case around the SAME registration and bank are not an override");

  const o = exportRootOverrides(snap, {
    [EXPORT_ROOT_GSTIN_KEY]: "GSTIN NO: 33AAFCP5374A1ZQ",
    [EXPORT_ROOT_BANK_KEY]: "HDFC Bank Ltd",
  });
  assert.deepEqual(o.map((x) => x.what), ["GSTIN", "bank"]);
  assert.equal(o[0].key, EXPORT_ROOT_GSTIN_KEY);
  assert.equal(o[0].expected, "33AALCP2750N1Z3");
  assert.equal(o[0].saved, "GSTIN NO: 33AAFCP5374A1ZQ");
  assert.equal(o[1].expected, bankName);
  assert.equal(o[1].saved, "HDFC Bank Ltd");

  // a cell cleared in the form prints blank — the screen must say so rather
  // than promise the invoice's bank.
  const blank = exportRootOverrides(snap, { [EXPORT_ROOT_BANK_KEY]: "" });
  assert.equal(blank.length, 1);
  assert.equal(blank[0].what, "bank");
  assert.equal(blank[0].saved, "");

  // the sister company's invoice with the form still on the old registration
  const pgi = buildInvoiceSnapshot({ ...order, kind: "EXPORT", currency: "USD" }, S, "EXPORT", lines, { date: "2026-08-20", gstin: "33AAFCP5374A1ZQ" });
  const stale = exportRootOverrides(pgi, { [EXPORT_ROOT_GSTIN_KEY]: "GSTIN NO: 33AALCP2750N1Z3" });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].expected, "33AAFCP5374A1ZQ (Pacific Granites (India) Pvt Ltd)");
  assert.equal(stale[0].sheetGstin, false);
});

test("exportRootOverrides: the SCOPE is checked cell by cell, on the three sheets it decides (round two, answer 19)", () => {
  const own = S.company.gstin;                                   // 33AALCP2750N1Z3
  const pgiGstin = gstinChoices(S.company)[1].gstin;             // 33AAFCP5374A1ZQ
  const lines = buildInvoiceLines(items, null, "EXPORT", S);
  const exportOrder = { ...order, kind: "EXPORT", currency: "USD" };
  const keys = EXPORT_ROOT_SHEET_GSTIN_CELLS.map((c) => c.key);
  assert.deepEqual(keys, ["plGstin", "custPlGstin", "c1Gstin"], "the same three cells export-workbook/mapping.ts names");

  // "every sheet": all three are expected to carry the CHOSEN registration
  const wide = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", gstin: pgiGstin, gstinApplyAll: true });
  assert.equal(snapshotExtras(wide).gstinApplyAll, true);
  assert.deepEqual(exportRootOverrides(wide, Object.fromEntries(keys.map((k) => [k, `GSTIN NO: ${pgiGstin}`])), own), [],
    "the prefill saved back unchanged is not an override");
  const wideOff = exportRootOverrides(wide, { plGstin: `GSTIN NO: ${own}`, custPlGstin: `GSTIN NO: ${pgiGstin}`, c1Gstin: own }, own);
  assert.deepEqual(wideOff.map((o) => o.key), ["plGstin", "c1Gstin"], "only the cells actually typed over");
  assert.equal(wideOff[0].sheetGstin, true);
  assert.equal(wideOff[0].what, "GSTIN on the packing list");
  assert.equal(wideOff[0].expected, `${pgiGstin} (Pacific Granites (India) Pvt Ltd)`);
  assert.equal(wideOff[0].saved, `GSTIN NO: ${own}`);
  assert.equal(overriddenSheetsNote(wideOff), "the packing list and Annexure C1");

  // "this invoice only": the same three are expected to carry the COMPANY's
  // own, which the snapshot cannot say — so the own registration is passed in
  const narrow = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", gstin: pgiGstin, gstinApplyAll: false });
  assert.equal(snapshotExtras(narrow).gstinApplyAll, false);
  assert.deepEqual(exportRootOverrides(narrow, { plGstin: `GSTIN NO: ${own}`, custPlGstin: `GSTIN NO: ${own}`, c1Gstin: own }, own), [],
    "the three sheets on the company's own is exactly what the answer asked for");
  const spread = exportRootOverrides(narrow, { plGstin: `GSTIN NO: ${pgiGstin}`, custPlGstin: `GSTIN NO: ${pgiGstin}`, c1Gstin: pgiGstin }, own);
  assert.deepEqual(spread.map((o) => o.key), keys, "the alternate typed into all three IS the tab's warning");
  assert.equal(spread[0].expected, own, "no label: the company's own is the expectation");
  assert.equal(overriddenSheetsNote(spread), "the packing list, the customer's copy and Annexure C1");

  // without the company's own registration the three are left UNCHECKED
  // rather than guessed at — a wrong warning about a customs document is
  // worse than none. The invoice's own cell is still checked.
  assert.deepEqual(exportRootOverrides(narrow, { plGstin: `GSTIN NO: ${pgiGstin}` }), []);
  assert.deepEqual(exportRootOverrides(narrow, { plGstin: `GSTIN NO: ${pgiGstin}` }, null), []);
  const stillChecked = exportRootOverrides(narrow, { [EXPORT_ROOT_GSTIN_KEY]: `GSTIN NO: ${own}`, plGstin: `GSTIN NO: ${pgiGstin}` }, null);
  assert.deepEqual(stillChecked.map((o) => o.key), [EXPORT_ROOT_GSTIN_KEY]);
  // an "every sheet" answer needs no own registration: the expectation is the
  // chosen one, which the snapshot carries
  assert.deepEqual(exportRootOverrides(wide, { plGstin: `GSTIN NO: ${own}` }).map((o) => o.key), ["plGstin"]);

  // a cell cleared in the form prints nothing, and that is an override too
  const blank = exportRootOverrides(wide, { c1Gstin: "" }, own);
  assert.equal(blank.length, 1);
  assert.equal(blank[0].saved, "");
  assert.equal(overriddenSheetsNote(blank), "Annexure C1");
  assert.equal(overriddenSheetsNote([]), null, "nothing typed over — the scope sentence may stand as written");
});

// ───────── round two (2026-09-08): the GSTIN question, the PI's bank ─────────

test("round two, answer 19: only an alternate registration asks, and the answer is what the snapshot stores", () => {
  const own = S.company.gstin;                                   // 33AALCP2750N1Z3
  const pgi = gstinChoices(S.company)[1].gstin;                  // 33AAFCP5374A1ZQ

  assert.equal(isAlternateOf(own, own), false, "the company's own is not an alternate");
  assert.equal(isAlternateOf(own, own.toLowerCase()), false, "case is not a different company");
  assert.equal(isAlternateOf(own, pgi), true);
  assert.equal(isAlternateOf(own, ""), false, "a blank is the default, and the default asks nothing");
  assert.equal(isAlternateGstin(S, pgi), true);
  assert.equal(isAlternateGstin(S, own), false);

  // the company's own is always "every sheet": the question is never put, and
  // storing false there would describe a distinction that does not exist
  assert.equal(gstinApplyAllFor(S, own, false), true);
  assert.equal(gstinApplyAllFor(S, own, null), true);
  assert.equal(gstinApplyAllFor(S, "", false), true);
  // an alternate takes the answer; no answer takes the NARROW reading
  assert.equal(gstinApplyAllFor(S, pgi, true), true);
  assert.equal(gstinApplyAllFor(S, pgi, false), false);
  assert.equal(gstinApplyAllFor(S, pgi, null), false, "nobody confirmed it for the other sheets");
  assert.equal(gstinApplyAllFor(S, pgi, undefined), false);

  assert.equal(gstinScopeNote(own, { gstin: own, gstinApplyAll: true }), null, "nothing to explain about the company's own");
  assert.match(String(gstinScopeNote(own, { gstin: pgi, gstinApplyAll: true })), /every sheet/);
  assert.match(String(gstinScopeNote(own, { gstin: pgi, gstinApplyAll: false })), /invoice only/);

  // ONLY an export invoice has a workbook, so only there is the question worth
  // putting — a DTA has one sheet and a delivery challan, and asking about
  // "every sheet of the export workbook" there asks about sheets nobody will
  // ever print.
  assert.equal(hasExportWorkbook("EXPORT"), true);
  assert.equal(hasExportWorkbook("export"), true);
  assert.equal(hasExportWorkbook("DTA"), false);
  assert.equal(hasExportWorkbook(null), false, "a kind nobody has chosen yet asks nothing");
  assert.equal(gstinQuestionApplies(own, pgi, "EXPORT"), true);
  assert.equal(gstinQuestionApplies(own, pgi, "DTA"), false, "no workbook, no question");
  assert.equal(gstinQuestionApplies(own, own, "EXPORT"), false, "the company's own reaches everything anyway");
  assert.equal(gstinQuestionApplies(own, "", "DTA"), false);
  // what the screen sends when it does NOT ask: the same value the server's
  // gstinApplyAllFor derives from an answer nobody supplied, so the two agree
  assert.equal(gstinScopeUnasked(own, own), true);
  assert.equal(gstinScopeUnasked(own, ""), true, "blank is the default, i.e. the company's own");
  assert.equal(gstinScopeUnasked(own, pgi), false);
  assert.equal(gstinScopeUnasked(own, pgi), gstinApplyAllFor(S, pgi, null));
  assert.equal(gstinScopeUnasked(own, own), gstinApplyAllFor(S, own, null));
  // and the note under the field is worded for the kind rather than promising
  // a DTA invoice a workbook
  assert.match(String(gstinScopeNote(own, { gstin: pgi, gstinApplyAll: false }, "DTA")), /no export workbook/);
  assert.match(String(gstinScopeNote(own, { gstin: pgi, gstinApplyAll: true }, "DTA")), /no export workbook/);
  assert.equal(gstinScopeNote(own, { gstin: own, gstinApplyAll: true }, "DTA"), null);
  assert.match(String(gstinScopeNote(own, { gstin: pgi, gstinApplyAll: true }, "EXPORT")), /every sheet/);
  assert.equal(gstinScopeWord(true), "every sheet");
  assert.equal(gstinScopeWord(false), "this invoice only");
  assert.match(GSTIN_APPLY_ALL_QUESTION, /every sheet of the export workbook/);
});

test("round two, answer 19: the answer rides in the snapshot and survives a draft edit", () => {
  const lines = buildInvoiceLines(items, null, "EXPORT", S);
  const exportOrder = { ...order, kind: "EXPORT", currency: "USD" };
  const pgi = "33AAFCP5374A1ZQ";

  const wide = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", gstin: pgi, gstinApplyAll: true });
  assert.equal(wide.gstin, pgi);
  assert.equal(wide.gstinApplyAll, true);

  const narrow = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", gstin: pgi, gstinApplyAll: false });
  assert.equal(narrow.gstinApplyAll, false);

  const unasked = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", gstin: pgi });
  assert.equal(unasked.gstinApplyAll, false, "a caller that never asked does not spread the registration");

  const ownSnap = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20", gstinApplyAll: false });
  assert.equal(ownSnap.gstinApplyAll, true, "the company's own ignores an answer nobody was asked for");

  // the draft edit: the answer may be changed on its own
  const a = applyDraftPatch(wide, { gstinApplyAll: false }, S);
  assert.equal(a.changed, true);
  assert.equal(a.snapshot.gstinApplyAll, false);
  assert.equal(a.snapshot.gstin, pgi, "the registration itself did not move");

  // re-sending the SAME registration without an answer keeps the stored one —
  // the screen sends both together, and a bare re-send must not silently
  // narrow a workbook the clerk already widened
  const b = applyDraftPatch(wide, { gstin: pgi }, S);
  assert.equal(b.snapshot.gstinApplyAll, true);
  assert.equal(b.changed, false);

  // a CHANGE of registration asks again: without an answer it is the narrow one
  const own = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20" });
  const c = applyDraftPatch(own, { gstin: pgi }, S);
  assert.equal(c.snapshot.gstinApplyAll, false);
  const d = applyDraftPatch(own, { gstin: pgi, gstinApplyAll: true }, S);
  assert.equal(d.snapshot.gstinApplyAll, true);

  // back to the company's own and the scope goes back to "every sheet"
  const e = applyDraftPatch(narrow, { gstin: "" }, S);
  assert.equal(e.snapshot.gstin, S.company.gstin);
  assert.equal(e.snapshot.gstinApplyAll, true);

  assert.deepEqual(applyDraftPatch(wide, { gstinApplyAll: "yes" }, S).rejected, ["gstinApplyAll"], "a non-boolean is refused by name, never read as truthy");
  assert.equal(applyDraftPatch(wide, { gstinApplyAll: "yes" }, S).snapshot.gstinApplyAll, true, "and the stored answer stands");
});

test("round two, answer 19: the workbook scope is logged by value, beside the registration", () => {
  const lines = buildInvoiceLines(items, null, "EXPORT", S);
  const exportOrder = { ...order, kind: "EXPORT", currency: "USD" };
  const own = buildInvoiceSnapshot(exportOrder, S, "EXPORT", lines, { date: "2026-08-20" });
  const wide = applyDraftPatch(own, { gstin: "33AAFCP5374A1ZQ", gstinApplyAll: true }, S).snapshot;
  const narrow = applyDraftPatch(wide, { gstinApplyAll: false }, S).snapshot;

  const c1 = registrationChanges(own, wide);
  assert.equal(c1?.gstin?.to, "33AAFCP5374A1ZQ");
  assert.equal(c1?.gstinApplyAll, undefined, "the company's own was already 'every sheet' — nothing moved");

  const c2 = registrationChanges(wide, narrow);
  assert.deepEqual(c2?.gstinApplyAll, { from: true, to: false });
  assert.equal(c2?.gstin, undefined);
  assert.match(registrationChangeNote(c2), /workbook every sheet → this invoice only/);
  assert.equal(registrationChanges(wide, wide), null);
  assert.deepEqual(patchedSnapshotFields({ gstinApplyAll: false }, wide, narrow), ["gstinApplyAll"]);
});

test("round two, answer 20: the invoice's bank follows the live PI's, and the kind decides when there is none", () => {
  const issued = { status: "ISSUED", revision: 0, snapshot: { bankKey: "domestic" } };
  const accepted = { status: "ACCEPTED", revision: 1, snapshot: { bankKey: "export" } };

  assert.equal(isLivePi(issued), true);
  assert.equal(isLivePi(accepted), true, "an accepted PI is an issued one the customer signed");
  assert.equal(isLivePi({ status: "DRAFT", snapshot: { bankKey: "export" } }), false, "a draft is not paper yet");
  assert.equal(isLivePi({ status: "CANCELLED", snapshot: { bankKey: "export" } }), false, "a cancelled PI is history (answer 24)");
  assert.equal(isLivePi({ status: "SUPERSEDED", snapshot: { bankKey: "export" } }), false);
  assert.equal(isLivePi(null), false);

  // the PI's bank wins over the kind's default, both ways round
  assert.equal(bankKeyForInvoice(issued, "EXPORT"), "domestic", "an export invoice on the PI's domestic account");
  assert.equal(bankKeyForInvoice(accepted, "DTA"), "export");
  // no PI, a draft PI, a PI frozen before the bank was stored → the kind
  assert.equal(bankKeyForInvoice(null, "DTA"), "domestic");
  assert.equal(bankKeyForInvoice(null, "EXPORT"), "export");
  assert.equal(bankKeyForInvoice({ status: "DRAFT", snapshot: { bankKey: "domestic" } }, "EXPORT"), "export");
  assert.equal(bankKeyForInvoice({ status: "ISSUED", snapshot: null }, "EXPORT"), "export");
  assert.equal(bankKeyForInvoice({ status: "ISSUED", snapshot: { bankKey: "kotak" } }, "DTA"), "domestic", "a bank key the settings do not know is not inherited");

  // which PI is THE live one: since answer 24 there is at most one, and the
  // highest revision wins if a pre-answer row left two standing
  assert.equal(livePiOf([]), null);
  assert.equal(livePiOf(null), null);
  assert.equal(livePiOf([{ status: "CANCELLED", revision: 0, snapshot: { bankKey: "export" } }]), null);
  assert.equal(livePiOf([issued, accepted]), accepted);
  assert.equal(livePiOf([accepted, issued]), accepted, "the order the rows arrive in does not decide it");
  assert.equal(bankKeyForInvoice(livePiOf([issued, accepted]), "DTA"), "export");

  // THE TIE-BREAK, pinned: two live PIs of the SAME revision (a pre-answer-24
  // pair) are separated by the order the caller hands them in — the first
  // wins. invoices/_lib.ts livePiFor selects them highest revision first and,
  // inside one revision, latest issued first, and then runs this same rule, so
  // the server and the order screen cannot name different PIs as the live one.
  const r2a = { status: "ISSUED", revision: 2, snapshot: { bankKey: "export" } };
  const r2b = { status: "ISSUED", revision: 2, snapshot: { bankKey: "domestic" } };
  assert.equal(livePiOf([r2a, r2b]), r2a, "equal revisions: the first row given wins");
  assert.equal(livePiOf([r2b, r2a]), r2b);
  // and a later-issued LOWER revision still loses to the higher one, which is
  // where an issuedAt-first query used to disagree with this rule
  assert.equal(livePiOf([issued, r2a]), r2a);
  assert.equal(livePiOf([r2a, issued]), r2a);
  // a row with no revision at all reads as 0 rather than throwing
  assert.equal(livePiOf([{ status: "ISSUED", snapshot: null }, r2a]), r2a);
});

test("round two, answer 20: the bank is the manager's to change, and the refusal says so", () => {
  assert.equal(mayChangeInvoiceBank(["view", "write"]), false, "Raghav and Setumani read the PI's bank");
  assert.equal(mayChangeInvoiceBank(["view", "write", "approve"]), false, "Murali approves the checklist; the bank is not his");
  assert.equal(mayChangeInvoiceBank(["view", "write", "approve", "cancel"]), true, "the Commercial Manager");
  assert.equal(mayChangeInvoiceBank(["admin", "cancel"]), true);
  assert.equal(mayChangeInvoiceBank([]), false);
  assert.equal(mayChangeInvoiceBank(null), false);

  assert.equal(bankChangeRefusal(["cancel"]), null);
  assert.equal(bankChangeRefusal(["write"]), BANK_FOLLOWS_PI);
  assert.equal(BANK_FOLLOWS_PI, "The invoice follows the PI's bank; the Commercial Manager may change it");
});

// ───────── the manual exchange rate per invoice (round three, answer 10) ─────
// "Add exchange rate per invoice, manual." What is tested here is the invoice
// half: the shape of the figure, whether a re-save is a change, whose desk it
// is once the paper is out, and what the order log is told. The conversion
// itself lives in receipts-rules and is pinned in tests/commercialReceipts.

test("parseExchangeRate: a positive figure at 4 dp; blank clears it, zero is a slipped key", () => {
  assert.deepEqual(parseExchangeRate("88.42"), { ok: true, value: 88.42 });
  assert.deepEqual(parseExchangeRate(88.42), { ok: true, value: 88.42 });
  assert.deepEqual(parseExchangeRate(" 1,088.4256 "), { ok: true, value: 1088.4256 }, "a typed thousands separator is not a NaN");
  assert.deepEqual(parseExchangeRate("88.42567"), { ok: true, value: 88.4257 }, "the column is NUMERIC(12,4)");

  // blank CLEARS: the column is nullable and null means "no rate agreed"
  assert.deepEqual(parseExchangeRate(""), { ok: true, value: null });
  assert.deepEqual(parseExchangeRate("   "), { ok: true, value: null });
  assert.deepEqual(parseExchangeRate(null), { ok: true, value: null });
  assert.deepEqual(parseExchangeRate(undefined), { ok: true, value: null });

  // zero is refused rather than stored: the advance divides by it one way round
  assert.equal(parseExchangeRate("0").ok, false);
  assert.equal(parseExchangeRate("0.00004").ok, false, "rounded to 4 dp this is zero");
  assert.equal(parseExchangeRate("-88.42").ok, false);
  assert.equal(parseExchangeRate("eighty eight").ok, false);
  assert.equal(parseExchangeRate("1e12").ok, false, "wider than the column holds");
});

test("sameExchangeRate: 88.4200 typed over 88.42 is not a change, so nothing is restamped", () => {
  assert.equal(sameExchangeRate(88.42, "88.4200"), true);
  assert.equal(sameExchangeRate(88.42, 88.42), true);
  assert.equal(sameExchangeRate(null, null), true);
  assert.equal(sameExchangeRate(null, ""), true, "a blank box over no rate is no change");
  assert.equal(sameExchangeRate(88.42, null), false, "clearing a rate IS a change");
  assert.equal(sameExchangeRate(null, "88.42"), false);
  assert.equal(sameExchangeRate(88.42, "88.43"), false);
  assert.equal(sameExchangeRate(88.42, "nonsense"), false, "an unreadable value is never 'the same'");
});

test("mayEditExchangeRate: the draft is any invoice writer's; once issued it is the manager's (answer 10)", () => {
  assert.deepEqual(mayEditExchangeRate("DRAFT", ["view", "write"]), { ok: true });
  assert.deepEqual(mayEditExchangeRate("DRAFT", ["view", "write", "cancel"]), { ok: true });
  assert.equal(mayEditExchangeRate("DRAFT", ["view"]).ok, false, "a read-only login edits nothing");

  // the paper is out: the same desk that cancels the invoice (answer 24)
  const issued = mayEditExchangeRate("ISSUED", ["view", "write"]);
  assert.equal(issued.ok, false);
  assert.equal(issued.ok === false ? issued.reason : "", EXCHANGE_RATE_DESK);
  assert.deepEqual(mayEditExchangeRate("ISSUED", ["view", "write", "cancel"]), { ok: true });

  // a cancelled invoice is history and takes nothing from anybody
  assert.equal(mayEditExchangeRate("CANCELLED", ["view", "write", "cancel"]).ok, false);
  assert.equal(mayEditExchangeRate("cancelled", ["write", "cancel"]).ok, false, "status is asked case-blind");

  // the refusal is a sentence a clerk can act on, not a rule number
  assert.match(EXCHANGE_RATE_DESK, /Commercial Manager/);
  assert.match(RATE_UNDATED, /no date/);
});

test("invoiceCurrencyFor: what a draft will be priced in, decided once for the screen and the snapshot", () => {
  assert.equal(invoiceCurrencyFor("DTA", "USD"), "INR", "a DTA is a rupee document whatever the order says");
  assert.equal(invoiceCurrencyFor("EXPORT", "USD"), "USD");
  assert.equal(invoiceCurrencyFor("EXPORT", " eur "), "EUR");
  assert.equal(invoiceCurrencyFor("EXPORT", null), "USD", "an export order that names none");
  assert.equal(invoiceCurrencyFor("EXPORT", "INR"), "INR", "an export order priced in rupees is a rupee invoice");
  // and it is the SAME answer the frozen snapshot carries, which is what lets
  // the create form predict a currency for an invoice that does not exist yet
  const euro = { ...order, kind: "EXPORT", currency: "EUR" };
  const euroLines = buildInvoiceLines(items, null, "EXPORT", S);
  assert.equal(buildInvoiceSnapshot(euro, S, "EXPORT", euroLines, { date: "2026-08-20" }).currency, invoiceCurrencyFor("EXPORT", "EUR"));
  assert.equal(buildInvoiceSnapshot(euro, S, "DTA", euroLines, { date: "2026-08-20" }).currency, invoiceCurrencyFor("DTA", "EUR"));
});

test("exchangeRateRefusal: the box is refused on a rupee invoice, because the rate is quoted PER a foreign unit", () => {
  assert.equal(exchangeRateRefusal("USD"), null);
  assert.equal(exchangeRateRefusal("eur"), null);
  const refused = exchangeRateRefusal("INR");
  assert.ok(refused, "every DTA, and an export invoice on a rupee-priced order");
  assert.equal(exchangeRateRefusal("inr"), refused, "case is not a different currency");
  assert.match(refused ?? "", /priced in rupees/);
  // the refusal exists because the receipts side would discard the figure: the
  // two rules are about one fact, and this is the sentence said at the box
  assert.equal(usableRate({ rate: 88.42, currency: invoiceCurrencyFor("DTA", "USD") }), null);
  assert.equal(usableRate({ rate: 88.42, currency: invoiceCurrencyFor("EXPORT", "USD") })?.rate, 88.42);
});

test("printedRateNote: the row's working rate against the one the document froze", () => {
  // agreed — nothing to disclose, and the screen prints one figure
  assert.equal(printedRateNote(88.42, 88.42, "USD"), null);
  assert.equal(printedRateNote("88.4200", 88.42, "USD"), null, "the same rate typed again is not a difference");
  assert.equal(printedRateNote(null, null, "USD"), null);
  // moved after the invoice was issued: the PDF and the workbook keep 88.42
  assert.match(printedRateNote(91, 88.42, "USD") ?? "", /The document prints INR 88\.42 per USD/);
  assert.match(printedRateNote(91, 88.42, "usd") ?? "", /per USD/);
  // a rate added to a row whose snapshot never had one
  assert.match(printedRateNote(88.42, null, "USD") ?? "", /The document prints no exchange rate/);
});

test("exchangeRateNote: the log carries both figures, because 'fields: [exchangeRate]' defends nothing", () => {
  assert.equal(exchangeRateNote(null, 88.42), "exchange rate none → 88.42");
  assert.equal(exchangeRateNote(88.42, 89), "exchange rate 88.42 → 89");
  assert.equal(exchangeRateNote(88.42, null), "exchange rate 88.42 → none");
  assert.equal(exchangeRateNote("", ""), "exchange rate none → none");
});

test("liveInvoiceOf is openInvoiceOf, so 'the order's invoice' means one thing (answer 18)", () => {
  const rows = [{ status: "CANCELLED", number: "PESPL/2779" }, { status: "ISSUED", number: "PESPL/2780" }];
  assert.equal(liveInvoiceOf(rows), rows[1]);
  assert.equal(liveInvoiceOf(rows), openInvoiceOf(rows));
  assert.equal(liveInvoiceOf([{ status: "CANCELLED", number: "x" }]), null);
  assert.equal(liveInvoiceOf(null), null);
});

test("invoiceAdvanceRate: what the receipts side is handed, and the three ways of having no rate", () => {
  const live = { status: "DRAFT", number: "PESPL/2780", currency: "USD", exchangeRate: "88.4200", exchangeRateAt: new Date("2026-09-09T06:00:00.000Z") };
  assert.deepEqual(invoiceAdvanceRate([live]), {
    rate: 88.42, currency: "USD", at: "2026-09-09T06:00:00.000Z", invoiceNumber: "PESPL/2780",
  });
  // no invoice, a cancelled one, and an empty rate box are one situation to the
  // clerk — type a rate on the invoice — so they are one answer here
  assert.equal(invoiceAdvanceRate([]), null);
  assert.equal(invoiceAdvanceRate([{ ...live, status: "CANCELLED" }]), null);
  assert.equal(invoiceAdvanceRate([{ ...live, exchangeRate: null }]), null);
  // a zero on the row (from before parseExchangeRate refused it) converts nothing
  assert.equal(invoiceAdvanceRate([{ ...live, exchangeRate: 0 }]), null);
});
