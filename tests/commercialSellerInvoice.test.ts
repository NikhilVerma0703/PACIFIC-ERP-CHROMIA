// The commercial invoice of a group company that is NOT an Indian exporter —
// today MONOLITH SURFACES INC, the US subsidiary (the owner, 2026-09-15:
// "integrate these types on invoices too in the PI builder").
//
// The property this file exists to hold is not "the new invoice looks right".
// It is that NOTHING ELSE MOVED. An invoice is a document a customer already
// has in hand and a reprint must match it, so the two existing renderers get
// no lines and every snapshot frozen before today keeps answering "Pacific".
//
// Pure imports only: `npm test` runs node --experimental-strip-types with no
// loader and no imports map, so the `@/` alias every pdf/* module uses is
// invisible to Node. That is why the layout guards below read those files as
// TEXT rather than importing them — the same technique, for the same reason,
// as the format guards in tests/commercialProforma.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildInvoiceLines, buildInvoiceSnapshot, applyDraftPatch,
  invoiceSeller, invoicePrintsIndianBlock, invoiceCompanyBlock,
  refuseInvoiceForSeller, refuseIssueSellerChanged, sequenceKindFor, exporterParty,
} from "../src/lib/commercial/invoice-rules.ts";
import { printsSellerInvoice, siPrintFields, siTotalRow, siTotalSlabs } from "../src/lib/commercial/seller-invoice-rules.ts";
import { DEFAULT_SETTINGS, invoiceNumberingKind } from "../src/lib/commercial/settings-defaults.ts";

const S = DEFAULT_SETTINGS;

const items = [
  { lineNo: 1, design: "Aureate", customerSku: "ARWT10325A", thickness: "3 cm", finish: "Polish", sizeLabel: "Super Jumbo", uom: "SQFT", rate: 12.25, hsn: "68101990", qtySlabs: 14, qty: 1052.24, amount: 12889.94 },
  { lineNo: 2, design: "Honeydew", customerSku: "HDWT10314A", thickness: "3 cm", finish: "Polish", sizeLabel: "Super Jumbo", uom: "SQFT", rate: 12.25, hsn: "68101990", qtySlabs: 21, qty: 1578.36, amount: 19334.91 },
];

const mg = { name: "M & G Imports LLC", address: "5462 Medlock Corners Dr", city: "Norcross, GA 30092", country: "United States", commercialExt: null };

const baseOrder = {
  number: "ORD/26-27/N0007",
  kind: "EXPORT",
  currency: "USD",
  paymentTerms: "25% Advance & 75% CAD before Releasing BL",
  portOfDischarge: "Savannah",
  finalDestination: "Savannah Port",
  client: mg,
  items,
};

const OPTS = { date: "2026-09-15", grossWeight: "27,000 KGS", netWeight: "26,500 KGS" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snapFor = (over: Record<string, unknown>): any => {
  const lines = buildInvoiceLines(items as never, null, "EXPORT", S);
  return buildInvoiceSnapshot({ ...baseOrder, ...over } as never, S, "EXPORT", lines, OPTS as never);
};

// ───────────────────── the rule that protects every old invoice ──────────────

test("an invoice with no seller at all is Pacific's, and keeps its own renderer", () => {
  // THE SINGLE MOST IMPORTANT ASSERTION IN THIS FILE. Every invoice issued
  // before 2026-09-15 was frozen without a `seller` key, and a reprint must be
  // what the customer received. Absence is not "unknown, ask somebody" — it is
  // the default seller, and it is read in one place.
  const snap = snapFor({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacy = { ...snap } as any;
  delete legacy.seller;
  assert.equal(invoiceSeller(legacy).key, "PESPL");
  assert.equal(invoiceSeller(legacy).indianExporter, true);
  assert.equal(invoicePrintsIndianBlock(legacy), true);
  assert.equal(printsSellerInvoice(legacy), false, "a legacy invoice never reaches the new renderer");
  // and the same for an explicitly empty one
  assert.equal(printsSellerInvoice({ ...legacy, seller: null }), false);
});

test("Pacific's own invoice is untouched by any of this", () => {
  for (const key of [undefined, null, "", "PESPL", "pespl"]) {
    const snap = snapFor(key === undefined ? {} : { sellerKey: key });
    assert.equal(invoiceSeller(snap).key, "PESPL", `sellerKey=${String(key)}`);
    assert.equal(printsSellerInvoice(snap), false);
    assert.equal(snap.company.legalName, S.company.legalName);
    assert.equal(snap.company.gstin, S.company.gstin);
    assert.equal(snap.company.iec, S.company.iec);
    assert.equal(snap.bank.name, S.banks.export.name, "still Kotak on an export invoice");
    assert.equal(snap.declaration, S.texts.piDeclaration);
    assert.ok(snap.lutText, "the LUT remark still prints");
    assert.equal(snap.preCarriageBy, S.defaults.preCarriageBy, "and the Indian shipping defaults still fill in");
    assert.equal(snap.portOfLoading, S.defaults.portOfLoading);
  }
});

// ───────────────────── what a US seller's invoice actually says ──────────────

test("a Monolith invoice carries no Indian fact at all — absent, not blanked", () => {
  const snap = snapFor({ sellerKey: "MONOLITH" });
  assert.equal(invoiceSeller(snap).key, "MONOLITH");
  assert.equal(invoicePrintsIndianBlock(snap), false);
  assert.equal(printsSellerInvoice(snap), true);

  assert.equal(snap.company.legalName, "MONOLITH SURFACES INC");
  assert.equal(snap.company.addressLines[0], "25298 FM 2978 Rd, Unit A,");
  // Every Indian registration is the EMPTY STRING, never Pacific's. The type
  // declares them required, so they cannot be absent; what matters is that
  // anything slipping past printsIndianBlock prints nothing rather than
  // printing an Indian exporter's registrations under an American name.
  for (const f of ["gstin", "iec", "pan", "tan", "stateCode", "districtCode", "customsOffice", "commissionerate", "division", "range", "locationCode"] as const) {
    assert.equal(snap.company[f], "", `company.${f} must be empty on a US seller's invoice`);
  }
  // The HSN is a property of the GOODS, not of the seller, and stays.
  assert.equal(snap.company.hsnQuartz, S.company.hsnQuartz);
  // A LUT is a bond an Indian exporter files with Indian GST. No LUT, no ARN.
  assert.equal(snap.lutText, null);
  // "Goods of Indian Origin" is a statement only an Indian exporter can make,
  // and there is no US wording to put in its place.
  assert.equal(snap.declaration, "");
  assert.equal(snap.gstin, "");
  assert.equal(snap.gstinLabel, "");
});

test("the silent Indian shipping defaults are the Indian exporter's; what a human typed is everyone's", () => {
  const blank = snapFor({ sellerKey: "MONOLITH" });
  assert.equal(blank.preCarriageBy, null, "no 'By Road' invented for a US sale");
  assert.equal(blank.portOfLoading, null, "and no Chennai");
  const typed = snapFor({ sellerKey: "MONOLITH", preCarriageBy: "By Road", portOfLoading: "Chennai" });
  assert.equal(typed.preCarriageBy, "By Road", "a typed value prints whoever sells");
  assert.equal(typed.portOfLoading, "Chennai");
});

test("the money: Monolith's own account, and the two routes kept apart", () => {
  const snap = snapFor({ sellerKey: "MONOLITH" });
  assert.equal(snap.bank.name, "ICICI Bank Limited, New York Branch");
  assert.equal(snap.bank.accountNo, "840000004202");
  assert.equal(snap.bank.swift, "ICICUS3N");
  // An IFSC is an Indian branch code. Its ABSENCE is what tells the renderer
  // this is not an Indian account — the bank shape is keyed on the account and
  // never on the seller, because one company can be paid into another's bank.
  assert.ok(!snap.bank.ifsc, "no IFSC on a US account");
  // A wire and an ACH carry DIFFERENT account numbers; a payer who reads one
  // line out of the wrong route has the money returned a week later.
  assert.equal(snap.bank.routingAccountNo, "8900676973");
  assert.deepEqual(snap.bank.ach, { bank: "Bank of New York Mellon", routingNo: "021-000-018", accountNo: "30000840000004202" });
  assert.notEqual(snap.bank.ach?.accountNo, snap.bank.accountNo);
  assert.notEqual(snap.bank.ach?.accountNo, snap.bank.routingAccountNo);
});

test("the buyer block is populated now, and only when the buyer is not the consignee", () => {
  const same = snapFor({ sellerKey: "MONOLITH" });
  assert.equal(same.buyerIfNotConsignee, null, "billed and shipped to the same party: no second block");
  const split = snapFor({
    sellerKey: "MONOLITH",
    billTo: { name: "M & G Holdings LLC", lines: ["Atlanta, GA"], country: "United States" },
  });
  assert.ok(split.buyerIfNotConsignee, "a different bill-to fills the block the type has always declared");
  assert.equal(split.buyerIfNotConsignee?.name, "M & G Holdings LLC");
});

// ───────────────────── the draft screen cannot undo any of it ────────────────

test("applyDraftPatch cannot re-poison a Monolith draft with Pacific's bank or a GSTIN", () => {
  // The defect this pins reaches paper. The snapshot is built correctly at
  // draft time and then EDITED before issue through PATCH /invoices/[invId];
  // both identity dropdowns used to rewrite from Pacific's settings with no
  // idea whose paper it was. Picking a bank put Kotak Chennai on Monolith's
  // invoice — worse than the fully-Pacific document it produced before,
  // because the rest of the page looks right.
  const snap = snapFor({ sellerKey: "MONOLITH" });
  const banked = applyDraftPatch(snap, { bankKey: "export" }, S);
  assert.equal(banked.snapshot.bank.name, "ICICI Bank Limited, New York Branch", "still Monolith's account");
  assert.notEqual(banked.snapshot.bank.name, S.banks.export.name);
  assert.deepEqual(banked.snapshot.bank.ach, snap.bank.ach, "and both routes survive");

  const gstin = applyDraftPatch(snap, { gstin: S.company.gstin }, S);
  assert.ok(gstin.rejected.includes("gstin"), "a US company has no GSTIN to choose between");
  assert.equal(gstin.snapshot.company.gstin, "");

  // and the same patch on a PACIFIC draft still works exactly as it did
  const pac = snapFor({});
  const pacBank = applyDraftPatch(pac, { bankKey: "domestic" }, S);
  assert.equal(pacBank.snapshot.bank.name, S.banks.domestic.name);
  const pacGstin = applyDraftPatch(pac, { gstin: S.company.gstin }, S);
  assert.equal(pacGstin.rejected.includes("gstin"), false);
});

// ───────────────────── refusals, numbering, and identity ─────────────────────

test("a DTA invoice is refused for a non-Indian seller, and the refusal names both exits", () => {
  // DTA is Domestic Tariff Area: the sheet IS the Indian instrument. Take away
  // its tax bands, its rupee words, its round-off and its "time of removal"
  // and no document is left, so this is a refusal rather than a branch.
  const msg = refuseInvoiceForSeller(S, "MONOLITH", "DTA");
  assert.ok(msg, "refused");
  assert.match(msg!, /Monolith Surfaces Inc/);
  assert.match(msg!, /the selling company on the order, or its kind/, "a person picks which is wrong; the code never guesses");
  // and every other combination is allowed, unchanged
  assert.equal(refuseInvoiceForSeller(S, "MONOLITH", "EXPORT"), null);
  assert.equal(refuseInvoiceForSeller(S, null, "DTA"), null);
  assert.equal(refuseInvoiceForSeller(S, undefined, "DTA"), null);
  assert.equal(refuseInvoiceForSeller(S, "PESPL", "DTA"), null);
  assert.equal(refuseInvoiceForSeller(S, "NOSUCHSELLER", "DTA"), null, "an unknown key is the default seller, not a refusal");
});

test("a Monolith invoice draws its own series and never a number out of Pacific's", () => {
  assert.equal(invoiceNumberingKind("EXPORT", "MONOLITH"), "monolithInvoice");
  assert.equal(invoiceNumberingKind("EXPORT", "monolith"), "monolithInvoice", "the key is case-insensitive");
  assert.equal(invoiceNumberingKind("EXPORT", null), "exportInvoice");
  assert.equal(invoiceNumberingKind("EXPORT", undefined), "exportInvoice");
  assert.equal(invoiceNumberingKind("EXPORT", "NOBODY"), "exportInvoice");
  assert.equal(invoiceNumberingKind("DTA", "MONOLITH"), "dtaInvoice", "refused upstream, so never actually drawn");
  assert.equal(invoiceNumberingKind("DTA", null), "dtaInvoice");
  // sequenceKindFor keeps its old one-argument answer for every old caller
  assert.equal(sequenceKindFor("EXPORT"), "exportInvoice");
  assert.equal(sequenceKindFor("DTA"), "dtaInvoice");
  assert.equal(sequenceKindFor("EXPORT", "MONOLITH"), "monolithInvoice");
  // the two Monolith counters are separate: a proforma and an invoice are two
  // documents, and INV-1012 must not be able to name both
  assert.notEqual(S.numbering.monolithInvoice.key, S.numbering.monolithProforma.key);
  assert.notEqual(S.numbering.monolithInvoice.key, S.numbering.exportInvoice.key);
  assert.equal(S.numbering.monolithInvoice.perFy, false, "a US company has no Indian financial year to reset on");
});

test("invoiceCompanyBlock's Indian branch is field-for-field what it always returned", () => {
  const seller = { key: "PESPL", label: S.company.legalName, indianExporter: true };
  const block = invoiceCompanyBlock(S, seller, S.company.gstin);
  const c = S.company;
  assert.deepEqual(block, {
    legalName: c.legalName, shortName: c.shortName, addressLines: [...c.addressLines],
    gstin: c.gstin, iec: c.iec, pan: c.pan, tan: c.tan,
    stateCode: c.stateCode, districtCode: c.districtCode,
    customsOffice: c.customsOffice, commissionerate: c.commissionerate,
    division: c.division, range: c.range, locationCode: c.locationCode,
    hsnQuartz: c.hsnQuartz,
  });
});

test("exporterParty still answers for two arguments, and takes a seller for three", () => {
  // It delegates to proforma-rules now instead of carrying a second body.
  // tests/commercialInvoices.test.ts imports this by name, and several callers
  // pass two arguments, so both shapes must keep working.
  const two = exporterParty(S, S.company.gstin);
  assert.equal(two.name, S.company.legalName);
  assert.equal(two.gstin, S.company.gstin);
  const three = exporterParty(S, null, "MONOLITH");
  assert.equal(three.name, "MONOLITH SURFACES INC");
});

// ───────────────────── what the printed sheet says ───────────────────────────

test("siPrintFields: a blank is the empty string, never null — that is what withholds a box", () => {
  const snap = snapFor({ sellerKey: "MONOLITH" });
  snap.number = "MSI-1001";
  const f = siPrintFields(snap);
  assert.equal(f.title, "INVOICE", "not a tax invoice and not an Indian customs one");
  assert.equal(f.sellerLabel, "Seller", "a US company selling in the US exports nothing");
  assert.equal(f.invoiceNo, "MSI-1001");
  assert.equal(f.invoiceDate, "15-09-2026", "DD-MM-YYYY, as on every other document here");
  assert.equal(f.declaration, "");
  assert.equal(f.vessel, "", "nothing booked yet — and an empty string is what drops the box");
  assert.equal(f.grossWeight, "27,000 KGS");
  assert.equal(f.currency, "USD");
  for (const [k, v] of Object.entries(f)) {
    assert.equal(typeof v, "string", `${k} must be a string`);
    assert.ok(!/(null|undefined)/.test(v), `${k} printed "${v}"`);
  }
});

test("the total row counts slabs and money the way the accepted format prints them", () => {
  const snap = snapFor({ sellerKey: "MONOLITH" });
  assert.equal(siTotalSlabs(snap), 35, "14 + 21");
  const row = siTotalRow(snap);
  assert.equal(row.length, 9, "the same nine columns piRow prints");
  assert.equal(row[1], "Total");
  assert.equal(row[3], "35");
  // two decimals, or three when the third says something — the rule both of
  // the customer's own documents follow
  assert.match(row[8], /^\d+\.\d{2,3}$/);
  assert.ok(!row[8].endsWith("0") || row[8].split(".")[1].length === 2, `no padded third decimal: ${row[8]}`);
});

// ───────────────────── and nothing else moved ────────────────────────────────

const read = (rel: string): string => readFileSync(new URL(`../src/lib/commercial/${rel}`, import.meta.url), "utf8");

test("the two existing invoice renderers know nothing about sellers, and must stay that way", () => {
  // THE REPRINT GUARANTEE, made structural. These two files print every
  // invoice this company has ever issued; an `if (seller)` inside either puts
  // that guarantee in the hands of whoever edits them next. The new document
  // is a THIRD file precisely so these two need no edit at all.
  for (const f of ["pdf/export-invoice.ts", "pdf/dta-invoice.ts"]) {
    const src = read(f);
    for (const word of ["seller", "Seller", "printsIndianBlock", "Monolith", "MONOLITH"]) {
      assert.equal(src.includes(word), false, `${f} must not mention ${word}`);
    }
  }
});

test("the seller invoice keys its bank on the ACCOUNT, and keeps the two routes apart", () => {
  // Pinned on the source because no test can render a PDF here. The defect
  // this guards came off a real document: keying the bank shape on the SELLER
  // printed "AD Code :" and "IFSC :" standing empty around a New York account
  // the day one company was paid into another's bank.
  const src = read("pdf/seller-invoice.ts");
  assert.match(src, /const indianAccount = Boolean\(printable\(f\.ifsc\)\)/,
    "the account decides how the account is quoted — never the seller");
  assert.equal(src.includes("indianExporter"), false, "the renderer never re-asks the seller question");
  for (const label of ['"Wire Transfer"', '"ACH Transfer"', '"A/c No \\(ACH only\\) : "']) {
    assert.match(src, new RegExp(label), `the ${label} block must stay separately labelled`);
  }
  // and it is built from the shared format, not from a copy of it
  assert.match(src, /from "\.\/format"/);
  assert.match(src, /layout: outerGrid/, "the header is one bordered box holding two inner tables");
  assert.match(src, /dontBreakRows: true/, "a long order breaks in the item table, not through the signatures");
});

test("the proforma and the seller invoice share one format module, not two copies", () => {
  for (const f of ["pdf/proforma.ts", "pdf/seller-invoice.ts"]) {
    assert.match(read(f), /from "\.\/format"/, `${f} must import the shared format`);
    assert.equal(read(f).includes("const gridLayout = {"), false, `${f} must not redeclare the grid`);
  }
  const fmt = read("pdf/format.ts");
  for (const sym of ["export const FS", "export const gridLayout", "export const outerGrid", "export const innerGrid", "export function pairRow", "export function fieldOrNull"]) {
    assert.ok(fmt.includes(sym), `format.ts must export ${sym}`);
  }
});

// ───────── the three defects an adversarial review found before this shipped ─

test("the seller cannot drift between drafting an invoice and issuing it", () => {
  // refuseInvoiceForSeller runs when the DRAFT is created. Nothing re-asked at
  // issue, and commercial_order.seller_key stays editable at every order
  // status — so: draft under Monolith, correct the order back to Pacific,
  // press Issue, and an ISSUED invoice goes out numbered MSI-1 printing
  // MONOLITH SURFACES INC on a Pacific shipment, which the export document set
  // then refuses to accompany because the snapshot still says Monolith. The
  // mirror is worse: an Indian GST tax invoice issued on an order the ERP
  // records as sold by a US company.
  const mono = snapFor({ sellerKey: "MONOLITH" });
  const pac = snapFor({});

  assert.equal(refuseIssueSellerChanged(mono, "MONOLITH", S), null, "unchanged: no refusal");
  assert.equal(refuseIssueSellerChanged(pac, null, S), null);
  assert.equal(refuseIssueSellerChanged(pac, "", S), null, "blank is the default seller, not a mismatch");
  assert.equal(refuseIssueSellerChanged(pac, "pespl", S), null, "case is not a mismatch");
  assert.equal(refuseIssueSellerChanged(pac, "NOSUCHKEY", S), null, "an unknown key is the default seller");

  const drifted = refuseIssueSellerChanged(mono, null, S);
  assert.ok(drifted, "a Monolith draft on an order now marked Pacific is refused");
  assert.match(drifted!, /Monolith Surfaces Inc/);
  assert.match(drifted!, /Cancel it and raise the invoice again/, "and says what to do about it");

  const mirrored = refuseIssueSellerChanged(pac, "MONOLITH", S);
  assert.ok(mirrored, "and the mirror too");
  assert.match(mirrored!, /Pacific Engineered Surfaces/);
});

test("a Monolith draft's bank can still be changed — a blank GSTIN is not an attempt to set one", () => {
  // The registration card sends gstin, gstinApplyAll and bankKey in ONE body,
  // and the PATCH route turns any rejection into a 400 for the whole request.
  // Refusing a blank gstin by name therefore refused the BANK change sitting
  // beside it, with a GSTIN error the clerk could do nothing about — the card
  // was unusable for the one seller it had just been taught to handle.
  const mono = snapFor({ sellerKey: "MONOLITH" });
  const asTheCardSends = applyDraftPatch(mono, { gstin: "", gstinApplyAll: false, bankKey: "domestic" }, S);
  assert.deepEqual(asTheCardSends.rejected, [], "nothing refused");
  assert.equal(asTheCardSends.snapshot.company.gstin, "", "and no Indian registration appears");
  assert.equal(asTheCardSends.snapshot.bank.name, "ICICI Bank Limited, New York Branch", "still Monolith's own account");

  // A REAL GSTIN is still refused, which is the mistake actually worth naming.
  const real = applyDraftPatch(mono, { gstin: S.company.gstin }, S);
  assert.ok(real.rejected.includes("gstin"));

  // And Pacific is untouched by the change: a blank GSTIN there is still a
  // refusal, because an Indian exporter always has one to choose.
  const pac = snapFor({});
  assert.equal(applyDraftPatch(pac, { gstin: S.company.gstin }, S).rejected.includes("gstin"), false);
  assert.ok(applyDraftPatch(pac, { gstin: "not-a-gstin" }, S).rejected.includes("gstin"));
});
