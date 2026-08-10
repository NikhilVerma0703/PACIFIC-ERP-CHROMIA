// Pins src/lib/finance/apiShapes.ts - the pure decisions inside the finance
// HTTP contract - to the behaviour of automation/app/api.py.
//
// The endpoints themselves need Prisma and a session, so they are not testable
// here. What IS testable is everything that decides an ANSWER rather than
// fetches one: how a search ranks, which GST head an invoice implies, what the
// export preview promises, and how a query parameter that is not what the
// caller thought is handled. Those are the parts where being quietly wrong
// costs money - a wrong input-tax head is a wrong GST return - and they are the
// parts a route handler would otherwise hide.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampInt, consequences, duplicateView, parseBillIds, parseBoolParam,
  parseStatuses, peopleResponse, rankNames,
} from "../src/lib/finance/apiShapes.ts";
import {
  buildGstIndex, vendorSuggestion, type GstLedger,
} from "../src/lib/finance/gst.ts";
import type { BuildBatchResult } from "../src/lib/finance/exportBatch.ts";
import type { Ledger } from "../src/lib/finance/ledgers.ts";

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

test("clampInt bounds a limit and never yields NaN", () => {
  assert.equal(clampInt("25", 50, 200), 25);
  assert.equal(clampInt(null, 50, 200), 50);
  assert.equal(clampInt("", 50, 200), 50);
  // A NaN limit reaching Prisma's `take:` would drop the bound entirely.
  assert.equal(clampInt("abc", 50, 200), 50);
  assert.equal(clampInt("9999", 50, 200), 200);
  assert.equal(clampInt("-3", 50, 200), 1);
  // offset uses min 0 - page two of a list starts at 0, not at 1.
  assert.equal(clampInt("-3", 0, 1000, 0), 0);
  assert.equal(clampInt("12.9", 0, 1000, 0), 12);
});

test("parseBoolParam keeps 'absent' distinct from 'false'", () => {
  // api.py's `exported: bool | None`. false means "only bills NOT yet
  // exported"; absent means "don't filter at all". Collapsing them would make
  // the approved list silently exclude every exported bill on every screen.
  assert.equal(parseBoolParam(null), null);
  assert.equal(parseBoolParam(""), null);
  assert.equal(parseBoolParam("false"), false);
  assert.equal(parseBoolParam("0"), false);
  assert.equal(parseBoolParam("true"), true);
  assert.equal(parseBoolParam("TRUE"), true);
  assert.equal(parseBoolParam("maybe"), null);
});

test("parseStatuses splits the comma-separated set the ERP sends", () => {
  assert.deepEqual(
    parseStatuses("review,manual_entry,duplicate,needs_reupload,error"),
    ["review", "manual_entry", "duplicate", "needs_reupload", "error"],
  );
  assert.deepEqual(parseStatuses(" review , , approved "), ["review", "approved"]);
  assert.deepEqual(parseStatuses(null), []);
});

test("parseBillIds drops junk and repeats instead of throwing", () => {
  // api.py's `[int(i) for i in ...]` raised a 500 on a non-numeric entry, and
  // buildBatch reports a repeated id as "listed twice in this batch" - a reason
  // the clerk who ticked one checkbox cannot act on.
  assert.deepEqual(parseBillIds([412, "413", 412, null, "x", -1, 0]), [412, 413]);
  assert.deepEqual(parseBillIds(undefined), []);
  assert.deepEqual(parseBillIds("412"), []);
});

// ---------------------------------------------------------------------------
// Name search
// ---------------------------------------------------------------------------

const NAMES = ["VIJAY KIRAN GAUTARAJ", "SHRI RAVI VIJAYAN", "VIJAYA LAKSHMI", "ANAND"];

test("rankNames puts prefix matches ahead of substring matches", () => {
  assert.deepEqual(
    rankNames(NAMES, "vij"),
    ["VIJAY KIRAN GAUTARAJ", "VIJAYA LAKSHMI", "SHRI RAVI VIJAYAN"],
  );
  // No query means no reordering: the caller's list is already sorted.
  assert.deepEqual(rankNames(NAMES, "  "), NAMES);
  assert.deepEqual(rankNames(NAMES, "zzz"), []);
});

test("peopleResponse reports truncation rather than silently dropping the tail", () => {
  // The dropdown is filtered in the browser, so a name past the cap is
  // unreachable, and the loss is alphabetical. A list that quietly stops is
  // worse than one that refuses to load: nobody goes looking for a name they
  // have been shown no reason to doubt.
  const capped = peopleResponse(NAMES, "", 2);
  assert.equal(capped.people.length, 2);
  assert.equal(capped.total, 4);
  assert.equal(capped.truncated, true);

  const whole = peopleResponse(NAMES, "", 50);
  assert.equal(whole.total, 4);
  assert.equal(whole.truncated, false);

  // total counts the MATCHES, not the master list - the UI shows "n of total".
  const filtered = peopleResponse(NAMES, "vij", 50);
  assert.equal(filtered.total, 3);
  assert.equal(filtered.truncated, false);
});

// ---------------------------------------------------------------------------
// GET /vendor/suggest
// ---------------------------------------------------------------------------

function led(name: string, parent: string): Ledger {
  return {
    name, parent, rootGroup: parent, path: [parent, name],
    nature: "other", isPostable: true, indent: 1, aliases: [], searchText: "",
  };
}

// A slice of PESPL's real chart of accounts, including the two traps gst.ts
// documents: an ineligible head living under an eligible parent, and two
// eligible 9% CGST heads that nothing on the bill can choose between.
const GST_INDEX: GstLedger[] = buildGstIndex([
  led("INPUT CGST @ 9%", "CGST INPUT"),
  led("CGST @ 9% ON SERVICE", "CGST INPUT"),
  led("CGST INPUT @ 9% - INELIGIBLE", "CGST INPUT"),
  led("INPUT SGST @ 9%", "SGST INPUT"),
  led("INPUT IGST @ 18%", "IGST INPUT"),
]);

const COMPANY_GSTIN = "33AALCP2750N1Z3"; // Tamil Nadu

test("vendorSuggestion derives the rate and offers the alternatives", () => {
  const r = vendorSuggestion(GST_INDEX, {
    taxable: 10000, cgst: 900, sgst: 900,
    vendorGstin: "33ABCDE1234F1Z5", companyGstin: COMPANY_GSTIN,
  });
  assert.equal(r.interstate, false);
  assert.equal(r.tax_lines.length, 2);
  // The plain "INPUT ..." head leads; the services head is the alternative,
  // because the goods/services call is the reviewer's, not the parser's.
  assert.equal(r.tax_lines[0].tax, "CGST");
  assert.equal(r.tax_lines[0].rate, 9);
  assert.equal(r.tax_lines[0].ledger, "INPUT CGST @ 9%");
  assert.deepEqual(r.tax_lines[0].alternatives, ["CGST @ 9% ON SERVICE"]);
  assert.equal(r.tax_total, 1800);
  assert.equal(r.invoice_total, 11800);
  assert.deepEqual(r.needs_review, []);
});

test("vendorSuggestion asks rather than assumes when the GSTIN was not read", () => {
  const r = vendorSuggestion(GST_INDEX, {
    taxable: 10000, cgst: 900, sgst: 900, companyGstin: COMPANY_GSTIN,
  });
  // The state code is the ONLY thing that decides IGST vs CGST+SGST, and
  // guessing books tax to the wrong head - which surfaces months later in
  // GSTR-2B, not at review time.
  assert.equal(r.interstate, null);
  assert.ok(r.needs_review.some((n) => n.includes("Vendor GSTIN not read")));
  // ...but the lines it CAN derive are still offered.
  assert.equal(r.tax_lines.length, 2);
});

test("vendorSuggestion refuses to snap a non-slab ratio", () => {
  const r = vendorSuggestion(GST_INDEX, {
    taxable: 10000, cgst: 700, vendorGstin: "33ABCDE1234F1Z5", companyGstin: COMPANY_GSTIN,
  });
  assert.deepEqual(r.tax_lines, []);
  const msg = r.needs_review.find((n) => n.includes("not a GST slab"));
  assert.ok(msg, "expected a not-a-slab warning");
  // The numbers are read against a paper bill, so they are formatted like the
  // ones printed on it - Python's f"{n:,.2f}".
  assert.ok(msg!.includes("7,000.00") === false);
  assert.ok(msg!.includes("CGST 700.00 on 10,000.00 is 7.00%"), msg);
});

test("vendorSuggestion flags a GSTIN that contradicts the printed tax", () => {
  const outOfState = vendorSuggestion(GST_INDEX, {
    taxable: 10000, cgst: 900, sgst: 900,
    vendorGstin: "29ABCDE1234F1Z5", companyGstin: COMPANY_GSTIN, // Karnataka
  });
  assert.equal(outOfState.interstate, true);
  assert.ok(outOfState.needs_review.some((n) => n.includes("out of state but the bill shows CGST/SGST")));

  const inState = vendorSuggestion(GST_INDEX, {
    taxable: 10000, igst: 1800,
    vendorGstin: "33ABCDE1234F1Z5", companyGstin: COMPANY_GSTIN,
  });
  assert.ok(inState.needs_review.some((n) => n.includes("in-state but the bill shows IGST")));
});

test("vendorSuggestion names the missing head instead of picking a near one", () => {
  const r = vendorSuggestion(GST_INDEX, {
    taxable: 10000, cgst: 900, sgst: 900,
    vendorGstin: "33ABCDE1234F1Z5", companyGstin: COMPANY_GSTIN,
    eligible: false,
  });
  // There IS an ineligible CGST head but no ineligible SGST one. Inventing it
  // would put blocked credit somewhere the GST return will not find it.
  assert.equal(r.tax_lines.length, 1);
  assert.equal(r.tax_lines[0].ledger, "CGST INPUT @ 9% - INELIGIBLE");
  assert.ok(r.needs_review.some((n) => n.includes("No ineligible SGST ledger at 9%")));
});

test("vendorSuggestion says so when a bill carries no tax at all", () => {
  const r = vendorSuggestion(GST_INDEX, {
    taxable: 500, vendorGstin: "33ABCDE1234F1Z5", companyGstin: COMPANY_GSTIN,
  });
  assert.deepEqual(r.tax_lines, []);
  assert.deepEqual(r.needs_review, ["No tax read on this bill - confirm it is not exempt"]);
  assert.equal(r.invoice_total, 500);
});

// ---------------------------------------------------------------------------
// Export preview
// ---------------------------------------------------------------------------

function emptyResult(over: Partial<BuildBatchResult> = {}): BuildBatchResult {
  return {
    xml: "", vouchers: 0, reimbursementVouchers: 0, vendorVouchers: 0,
    newLedgers: [], newVoucherType: null, skipped: [], total: 0,
    reimbursementTotal: 0, vendorTotal: 0, vendorTdsTotal: 0,
    lines: [], vendorLines: [], ...over,
  };
}

test("consequences reports staff and supplier money separately", () => {
  const r = emptyResult({
    vouchers: 3, reimbursementVouchers: 2, vendorVouchers: 1,
    total: 12450, reimbursementTotal: 650, vendorTotal: 11800, vendorTdsTotal: 1000,
    newLedgers: [{ name: "ZZ New Head", parent: "ADMINISTRATION EXPENSES" }],
    skipped: [{ billId: 414, reasons: ["already exported to Tally in an earlier batch"] }],
    lines: [
      { billId: 412, person: "VIJAY", ledger: "Food", amount: 250, voucherDate: new Date(2026, 6, 30) },
      { billId: 413, person: "VIJAY", ledger: "Food", amount: 400, voucherDate: new Date(2026, 6, 30) },
    ],
    vendorLines: [{
      billId: 415, vendorLedger: "ACME", expenseLedger: "Repairs",
      taxable: 10000, invoiceNo: "INV/26-27/881",
    }],
  });

  const c = consequences(r, 4, (id, d) => `REIMB/${d?.getFullYear()}/${id}`);

  assert.equal(c.requested, 4);
  assert.equal(c.vouchers, 3);
  // A combined figure would reconcile against nothing anyone can check.
  assert.equal(c.reimbursement_total, 650);
  assert.equal(c.vendor_total, 11800);
  assert.equal(c.vendor_tds_total, 1000);
  // snake_case on the wire; the ERP components were written against it.
  assert.deepEqual(c.skipped, [
    { bill_id: 414, reasons: ["already exported to Tally in an earlier batch"] },
  ]);
  assert.deepEqual(c.new_ledgers, [{ name: "ZZ New Head", parent: "ADMINISTRATION EXPENSES" }]);
  assert.deepEqual(c.voucher_numbers, [
    { bill_id: 412, kind: "reimbursement", voucher_no: "REIMB/2026/412" },
    { bill_id: 413, kind: "reimbursement", voucher_no: "REIMB/2026/413" },
    // A purchase voucher is numbered with the SUPPLIER's invoice number, so the
    // preview shows the string that will actually appear in Tally.
    { bill_id: 415, kind: "vendor", invoice_no: "INV/26-27/881", voucher_no: "INV/26-27/881" },
  ]);
});

test("consequences honours a voucher number that was already assigned", () => {
  const c = consequences(
    emptyResult({
      lines: [{
        billId: 9, person: "P", ledger: "L", amount: 1,
        voucherDate: new Date(2026, 0, 1), voucherNo: "REIMB/25-26/00009",
      }],
    }),
    1,
    () => "SHOULD-NOT-BE-USED",
  );
  assert.equal(c.voucher_numbers[0].voucher_no, "REIMB/25-26/00009");
});

// ---------------------------------------------------------------------------
// Duplicate warnings
// ---------------------------------------------------------------------------

test("duplicateView unpacks the score and reasons the pipeline packed into detail", () => {
  // fin_duplicate has no score column, and the pipeline writes
  // "87% - <why>, <why>" into `detail`. The review screen shows the reasons.
  const v = duplicateView({
    matchId: 388,
    kind: "field_match",
    detail: "87% - same vendor and amount, one day apart",
  });
  assert.equal(v.score, 0.87);
  assert.deepEqual(v.reasons, ["same vendor and amount", "one day apart"]);
  // BOTH id spellings. FinanceBills.tsx reads `bill_id` and rendered
  // "duplicate of bill #undefined" against api.py, which only sent
  // `matched_bill_id`.
  assert.equal(v.bill_id, 388);
  assert.equal(v.matched_bill_id, 388);
  assert.equal(v.layer, "field_match");
});

test("duplicateView degrades rather than throwing on an unparseable detail", () => {
  const v = duplicateView({ matchId: 12, kind: "file_hash", detail: null });
  assert.equal(v.score, null);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.bill_id, 12);

  const plain = duplicateView({ matchId: 12, kind: "file_hash", detail: "exact file match" });
  assert.equal(plain.score, null);
  assert.deepEqual(plain.reasons, ["exact file match"]);
});
