import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invoiceBlockers, vendorExtractionMirror, visibleAdvisories,
  type InvoiceState, type VendorMirrorExisting, type VendorMirrorInput,
} from "../src/lib/finance/vendorInvoiceRules.ts";

// These decide whether a bill can be booked into Tally. The zero-GST cases are
// the ones the change was made for and are listed here exactly as they were
// asked for, so a future edit that quietly re-blocks them fails loudly.
//
// This file exists because the first verification of that change re-implemented
// the rule in a scratch script. It passed, and proved nothing about the panel.

const ok = (o: Partial<InvoiceState> = {}): InvoiceState => ({
  vendorLedger: "A2Z Maintenance Service",
  expenseLedger: "Repairs & Maintenance",
  invoiceNo: "INV-4471",
  taxable: 100_000,
  taxLineCount: 2,
  noGst: false,
  tdsAmount: 0,
  tdsLedger: "",
  invoiceTotal: 118_000,
  ...o,
});

test("invoice: the fields that were always required still are", () => {
  assert.deepEqual(invoiceBlockers(ok()), []);
  assert.ok(invoiceBlockers(ok({ vendorLedger: "  " })).includes("Pick the vendor ledger"));
  assert.ok(invoiceBlockers(ok({ expenseLedger: "" })).includes("Pick the expense head"));
  assert.ok(invoiceBlockers(ok({ invoiceNo: " " })).includes("Enter the vendor's invoice number"));
  assert.ok(invoiceBlockers(ok({ taxable: 0 })).includes("Enter the taxable value"));
  assert.ok(invoiceBlockers(ok({ taxable: -5 })).includes("Enter the taxable value"));
  // NaN from an empty numeric input must block, not slip through a `<= 0` test.
  assert.ok(invoiceBlockers(ok({ taxable: NaN })).includes("Enter the taxable value"));
});

test("invoice: every zero-GST case that was asked for now saves", () => {
  const saves = (s: InvoiceState) => assert.deepEqual(invoiceBlockers(s), []);

  // GST 18%, TDS 0
  saves(ok({ taxLineCount: 2, invoiceTotal: 118_000 }));
  // GST 5%, TDS applicable
  saves(ok({ taxLineCount: 2, invoiceTotal: 105_000, tdsAmount: 2_000, tdsLedger: "TDS 194C" }));
  // GST 0%, TDS 0 — the case the whole change exists for
  saves(ok({ taxLineCount: 0, noGst: true, invoiceTotal: 100_000 }));
  // GST 0%, TDS applicable
  saves(ok({ taxLineCount: 0, noGst: true, invoiceTotal: 100_000, tdsAmount: 2_000, tdsLedger: "TDS 194C" }));
  // GST > 0 + TDS
  saves(ok({ taxLineCount: 1, invoiceTotal: 118_000, tdsAmount: 2_000, tdsLedger: "TDS 194C" }));
});

test("invoice: zero tax WITHOUT the tick still blocks — that is the point", () => {
  // "This bill has no GST" and "we could not read the GST" look identical here.
  // Letting the second through books a bill with no input credit, silently.
  const b = invoiceBlockers(ok({ taxLineCount: 0, noGst: false, invoiceTotal: 100_000 }));
  assert.equal(b.length, 1);
  assert.match(b[0], /No tax lines resolved/);
  assert.match(b[0], /No GST on this bill/, "the message must name the way out");
});

test("invoice: TDS rules stand on their own, whatever the GST is", () => {
  // TDS with nowhere to book it — blocked with or without GST.
  for (const gst of [{ taxLineCount: 2, invoiceTotal: 118_000 },
                     { taxLineCount: 0, noGst: true, invoiceTotal: 100_000 }]) {
    assert.ok(invoiceBlockers(ok({ ...gst, tdsAmount: 2_000, tdsLedger: "" }))
      .includes("Pick the TDS head"));
  }
  // Withholding the entire invoice is arithmetic gone wrong: the vendor would
  // be paid nothing or less.
  assert.ok(invoiceBlockers(ok({ tdsAmount: 118_000, tdsLedger: "TDS 194C" }))
    .includes("TDS is not less than the invoice total"));
  assert.ok(invoiceBlockers(ok({ tdsAmount: 200_000, tdsLedger: "TDS 194C" }))
    .includes("TDS is not less than the invoice total"));
  // Zero TDS never trips either rule, even though 0 >= 0.
  assert.deepEqual(invoiceBlockers(ok({ tdsAmount: 0, invoiceTotal: 0, taxable: 1 })).filter(
    (x) => /TDS/.test(x)), []);
});

test("invoice: ticking no-GST answers that one advisory and silences no other", () => {
  const warnings = [
    "No tax read on this bill - confirm it is not exempt",
    "Vendor is out of state but the bill shows CGST/SGST - check the invoice",
    "Vendor GSTIN not read - confirm IGST or CGST+SGST",
  ];
  // Untouched when the box is clear.
  assert.deepEqual(visibleAdvisories(warnings, false), warnings);
  // Only the answered one goes.
  const shown = visibleAdvisories(warnings, true);
  assert.equal(shown.length, 2);
  assert.ok(!shown.some((w) => /no tax read/i.test(w)));
  assert.ok(shown.some((w) => /out of state/i.test(w)), "a real tax mismatch must survive");
  assert.ok(shown.some((w) => /GSTIN not read/i.test(w)), "an unread GSTIN must survive");
  // Never mutates the caller's array.
  assert.equal(warnings.length, 3);
});

// ---------------------------------------------------------------------------
// vendorExtractionMirror
// ---------------------------------------------------------------------------
//
// confirm-vendor wrote the reviewer's corrections to fin_vendor_entry and
// stopped there, but every screen in the finance module reads fin_extraction.
// So an approve that fixed an OCR misreading displayed the misreading straight
// back, and because an approved bill can be reopened until it is exported, the
// panel then re-seeded from it and a second confirm overwrote the good vendor
// entry with the stale one.
//
// These tests cover the DECISIONS the mirror makes. The database write itself
// (the update-or-create inside confirm-vendor's transaction) is not exercised
// here - there is no Prisma in a unit test - so what is locked down is which
// value wins, not that the row is saved.

const stored = (o: Partial<VendorMirrorExisting> = {}): VendorMirrorExisting => ({
  invoiceDate: "2025-10-04",
  vendorName: "A2Z MAINTENANCE SERVICES PVT LTD",
  vendorGstin: "33AAACA1234A1Z9",
  ...o,
});

const mirrored = (o: Partial<VendorMirrorInput> = {}) => vendorExtractionMirror({
  invoiceNo: "INV-4471",
  date: "2026-03-31",
  taxable: 100_000,
  cgst: 9_000,
  sgst: 9_000,
  igst: 0,
  invoiceTotal: 118_000,
  expense: "Repairs & Maintenance",
  narration: "",
  vendor: "A2Z Maintenance Service",
  gstin: "33ABCDE1234F1Z5",
  existing: null,
  ...o,
});

test("vendor mirror: the confirmed date wins, and a blank one keeps what was read", () => {
  // THE BUG THIS EXISTS FOR. The extractor read October off a smudged invoice,
  // the reviewer corrected it to the real March date, the approve returned ok -
  // and the Ready-for-Tally list went on showing October, because the corrected
  // date was never written anywhere the list looks.
  assert.equal(
    mirrored({ date: "2026-03-31", existing: stored({ invoiceDate: "2025-10-04" }) }).invoiceDate,
    "2026-03-31");
  // A blank field means "I did not touch this", never "erase it" - the same
  // COALESCE rule confirmBill uses on the reimbursement side.
  assert.equal(
    mirrored({ date: "", existing: stored({ invoiceDate: "2025-10-04" }) }).invoiceDate,
    "2025-10-04");
  // Blank on both sides is null, not "" - isoDate() and Tally both want a
  // missing date to be missing.
  assert.equal(mirrored({ date: "", existing: stored({ invoiceDate: null }) }).invoiceDate, null);
  assert.equal(mirrored({ date: "", existing: null }).invoiceDate, null);
});

test("vendor mirror: net amount is the invoice total, never the taxable value", () => {
  // This is the amount column on Ready-for-Tally and on the past-export view.
  // Writing the taxable here understates every payable on screen by the GST.
  const intra = mirrored({ taxable: 100_000, cgst: 9_000, sgst: 9_000, igst: 0, invoiceTotal: 118_000 });
  assert.equal(intra.netAmount, 118_000);
  assert.equal(intra.taxableValue + intra.cgst + intra.sgst + intra.igst, intra.netAmount);
  // Interstate - one IGST line instead of two.
  const inter = mirrored({ taxable: 50_000, cgst: 0, sgst: 0, igst: 9_000, invoiceTotal: 59_000 });
  assert.equal(inter.netAmount, 59_000);
  assert.equal(inter.taxableValue + inter.cgst + inter.sgst + inter.igst, inter.netAmount);
  // A zero-GST bill reconciles to its taxable value, and that is not a bug.
  const exempt = mirrored({ taxable: 40_000, cgst: 0, sgst: 0, igst: 0, invoiceTotal: 40_000 });
  assert.equal(exempt.netAmount, 40_000);
  assert.equal(exempt.taxableValue + exempt.cgst + exempt.sgst + exempt.igst, exempt.netAmount);
});

test("vendor mirror: a vendor name that was READ is never overwritten, only filled", () => {
  // DELIBERATE, and the opposite of every other field here. vendor_name is the
  // dedupe business key and the vendor-memory key. The ledger the reviewer
  // picked is a Tally account - usually a different string for the same
  // supplier - so writing it over the read name re-points both, and the next
  // invoice from this vendor stops matching the one before it.
  assert.equal(
    mirrored({
      vendor: "A2Z Maintenance Service",
      existing: stored({ vendorName: "A2Z MAINTENANCE SERVICES PVT LTD" }),
    }).vendorName,
    "A2Z MAINTENANCE SERVICES PVT LTD");
  // Nothing was read, so the confirmed ledger is better than a blank - it at
  // least gives dedupe and the memory something to key on.
  for (const empty of [null, ""]) {
    assert.equal(
      mirrored({ vendor: "A2Z Maintenance Service", existing: stored({ vendorName: empty }) }).vendorName,
      "A2Z Maintenance Service");
  }
  assert.equal(mirrored({ vendor: "A2Z Maintenance Service", existing: null }).vendorName,
    "A2Z Maintenance Service");
});

test("vendor mirror: the GSTIN resolves the other way round from the name", () => {
  // The reviewer reads this one off the paper bill, so theirs wins...
  assert.equal(
    mirrored({ gstin: "33ABCDE1234F1Z5", existing: stored({ vendorGstin: "33AAACA1234A1Z9" }) }).vendorGstin,
    "33ABCDE1234F1Z5");
  // ...and a field they left empty falls back to what was extracted, then null.
  assert.equal(
    mirrored({ gstin: "", existing: stored({ vendorGstin: "33AAACA1234A1Z9" }) }).vendorGstin,
    "33AAACA1234A1Z9");
  assert.equal(mirrored({ gstin: "", existing: stored({ vendorGstin: null }) }).vendorGstin, null);
  assert.equal(mirrored({ gstin: "", existing: null }).vendorGstin, null);
});

test("vendor mirror: the rest is the confirmation, verbatim", () => {
  const m = mirrored({ invoiceNo: "INV-4471", expense: "Repairs & Maintenance" });
  assert.equal(m.invoiceNo, "INV-4471");
  // ledger_confirmed (store.ts) is "a ledger is set AND the bill was accepted",
  // so leaving this as the classifier's suggestion made the list report that a
  // human had agreed to a head nobody ever chose.
  assert.equal(m.ledger, "Repairs & Maintenance");
  // A human has now been through this row by definition.
  assert.equal(m.editedByUser, true);
  // Blank narration is null, matching the vendor entry's own column.
  assert.equal(m.narration, null);
  assert.equal(
    mirrored({ narration: "No GST on this bill - confirmed by reviewer" }).narration,
    "No GST on this bill - confirmed by reviewer");
  // A previous extraction must not drag any of these back.
  const reopened = mirrored({ invoiceNo: "INV-9002", expense: "Freight Inward", existing: stored() });
  assert.equal(reopened.invoiceNo, "INV-9002");
  assert.equal(reopened.ledger, "Freight Inward");
});
