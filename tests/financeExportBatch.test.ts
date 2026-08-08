import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchLineProblems, fyLabel, normKey, vendorInvoiceTotal, vendorLineProblems,
  vendorPayable, vendorTaxTotal, voucherNumber,
} from "../src/lib/finance/exportBatch.ts";

// exportBatch.ts was ported with no tests, and it is the module that decides
// what reaches Tally: the eligibility guards below are the last thing standing
// between a half-filled bill and a real voucher in the books. The Python side
// tests exactly these ("an unconfirmed bill cannot be exported", "the approved,
// clean bill still goes"), so the port should too.

const goodLine = { person: "A Vinoth Kumar", ledger: "Travelling Expenses", amount: 2400 };

test("a complete reimbursement line has no problems", () => {
  assert.deepEqual(batchLineProblems(goodLine), []);
});

test("every missing field on a reimbursement line is named", () => {
  assert.deepEqual(batchLineProblems({ ...goodLine, person: "" }), ["no person"]);
  assert.deepEqual(batchLineProblems({ ...goodLine, person: "   " }), ["no person"],
    "whitespace is not a person");
  assert.deepEqual(batchLineProblems({ ...goodLine, ledger: "" }), ["no ledger"]);

  // All of them at once, so a clerk fixes the bill in one pass rather than
  // discovering the next problem after each save.
  assert.deepEqual(
    batchLineProblems({ person: "", ledger: "", amount: 0 }),
    ["no person", "no ledger", "amount is zero or missing"],
  );
});

test("amounts that are not money are refused, and the two cases read differently", () => {
  assert.deepEqual(batchLineProblems({ ...goodLine, amount: 0 }), ["amount is zero or missing"]);
  assert.deepEqual(batchLineProblems({ ...goodLine, amount: -5 }), ["amount is zero or missing"]);
  assert.deepEqual(batchLineProblems({ ...goodLine, amount: NaN }), ["amount is not a number"]);
});

test("ledger identity ignores case and repeated whitespace", () => {
  // Tally's own exports are inconsistent about double spaces, and a second
  // ledger differing only in whitespace is painful to unpick later.
  assert.equal(normKey("Professional  Fees"), normKey("professional fees"));
  assert.equal(normKey("  Travelling Expenses  "), "travelling expenses");
  assert.equal(normKey(null), "");
  assert.notEqual(normKey("Travel"), normKey("Travels"));
});

test("the financial year label follows the Indian April boundary", () => {
  assert.equal(fyLabel(new Date(2026, 6, 30)), "26-27");   // 30 Jul 2026
  assert.equal(fyLabel(new Date(2026, 3, 1)), "26-27");    // 1 Apr - first day
  assert.equal(fyLabel(new Date(2026, 2, 31)), "25-26");   // 31 Mar - last day
  assert.equal(fyLabel(new Date(2027, 0, 15)), "26-27");   // January is still 26-27
});

test("voucher numbers carry the bill id so a line traces back to its photograph", () => {
  const n = voucherNumber(42, new Date(2026, 6, 30));
  assert.match(n, /^REIMB\/26-27\/0*42$/, `unexpected voucher number ${n}`);
  assert.ok(voucherNumber(42, new Date(2026, 6, 30), "VEND").startsWith("VEND/"));
});

// --- vendor invoices: the money must add up before anything is posted -------

const vendor = {
  vendorLedger: "A2Z Maintenance Service",
  expenseLedger: "Repairs & Maintenance",
  invoiceNo: "INV-07039",
  taxable: 10000,
  taxLines: [
    { ledger: "Input CGST 9%", amount: 900 },
    { ledger: "Input SGST 9%", amount: 900 },
  ],
  tdsAmount: 0,
  tdsLedger: "",
};

test("a clean vendor invoice totals correctly and raises nothing", () => {
  assert.equal(vendorTaxTotal(vendor), 1800);
  assert.equal(vendorInvoiceTotal(vendor), 11800);
  // No withholding, so payable is the full invoice.
  assert.equal(vendorPayable(vendor), 11800);
  assert.deepEqual(vendorLineProblems(vendor), []);
});

test("TDS reduces what the vendor is paid but not what they billed", () => {
  const withTds = { ...vendor, tdsAmount: 200, tdsLedger: "TDS Payable 194C" };
  assert.equal(vendorInvoiceTotal(withTds), 11800, "the vendor still billed the full amount");
  assert.equal(vendorPayable(withTds), 11600);
  assert.deepEqual(vendorLineProblems(withTds), []);
});

test("a TDS amount and a TDS ledger must arrive together", () => {
  assert.deepEqual(
    vendorLineProblems({ ...vendor, tdsAmount: 200, tdsLedger: "" }),
    ["TDS amount with no TDS ledger"],
  );
  assert.deepEqual(
    vendorLineProblems({ ...vendor, tdsAmount: 0, tdsLedger: "TDS Payable 194C" }),
    ["TDS ledger with no amount"],
  );
});

test("withholding more than the invoice is refused", () => {
  const absurd = { ...vendor, tdsAmount: 99999, tdsLedger: "TDS Payable 194C" };
  assert.ok(vendorLineProblems(absurd).includes("TDS exceeds the invoice total"));
});

test("a missing invoice number is a problem, because outstandings tie to it", () => {
  assert.ok(vendorLineProblems({ ...vendor, invoiceNo: "" }).includes("no invoice number"));
  assert.ok(vendorLineProblems({ ...vendor, invoiceNo: "  " }).includes("no invoice number"));
});

test("a tax line with no ledger or no amount is caught", () => {
  const badLedger = { ...vendor, taxLines: [{ ledger: "", amount: 900 }] };
  assert.ok(vendorLineProblems(badLedger).includes("a tax line has no ledger"));

  const zero = { ...vendor, taxLines: [{ ledger: "Input CGST 9%", amount: 0 }] };
  assert.ok(vendorLineProblems(zero).some((p) => /zero amount/.test(p)));
});

test("a vendor line missing its ledgers names both", () => {
  const problems = vendorLineProblems({ ...vendor, vendorLedger: "", expenseLedger: "" });
  assert.ok(problems.includes("no vendor"));
  assert.ok(problems.includes("no expense ledger"));
});

test("rounding does not leak paise into the totals", () => {
  // Three tax lines that each round awkwardly; the total must still be exact
  // to two places, or Tally's own arithmetic disagrees with the voucher.
  const odd = {
    ...vendor,
    taxable: 3333.33,
    taxLines: [
      { ledger: "Input CGST 9%", amount: 299.9997 },
      { ledger: "Input SGST 9%", amount: 299.9997 },
    ],
  };
  assert.equal(vendorTaxTotal(odd), 600);
  assert.equal(vendorInvoiceTotal(odd), 3933.33);
  assert.equal(Number(vendorInvoiceTotal(odd).toFixed(2)), vendorInvoiceTotal(odd));
});
