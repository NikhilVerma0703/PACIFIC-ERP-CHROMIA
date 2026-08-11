import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invoiceBlockers, visibleAdvisories, type InvoiceState,
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
