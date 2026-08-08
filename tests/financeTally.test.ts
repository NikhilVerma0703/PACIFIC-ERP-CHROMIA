import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDayBookXml, buildVoucherXml, countMatchingVouchers, humaniseTallyError,
  parseDayBook, parseLedgerList, parseTallyResponse, peopleUnderGroup,
  unescapeXml,
} from "../src/lib/finance/tally.ts";
import type { Reimbursement } from "../src/lib/finance/tally.ts";
import {
  batchFilename, buildBatch, buildBatchExcel, fyLabel, normKey,
  vendorVoucherBlock, voucherNumber,
} from "../src/lib/finance/exportBatch.ts";
import type { BatchLine, VendorLine } from "../src/lib/finance/exportBatch.ts";
import * as XLSX from "xlsx";

// Behaviour is pinned by automation/tests.py, sections "Tally voucher XML"
// and "Batch export (validated against PESPL's own voucher XML)". The second
// one is the money section: every structural check in it was learned from
// PESPL's real exported voucher, so these assertions are reproduced verbatim.
// The Python checks that read config.yaml rather than code (batch_voucher_type
// is "Journal", payment_voucher_type is "Payment", voucher_type_parent) have
// no code to pin here and are omitted; the post_xml network test is omitted
// because the HTTP transport is deliberately not ported.

// ---------------------------------------------------------------------------
// The Python suite proves well-formedness with minidom. No XML parser ships
// with node, so this is a small strict checker: every tag must nest, text may
// not contain '<', a bare '&' outside a known entity fails, and the control
// characters _esc exists to remove fail. That is exactly the set of ways this
// generator could produce a file Tally rejects.
// ---------------------------------------------------------------------------
function checkText(text: string, label: string) {
  assert.ok(!text.includes("<"), `${label}: stray '<' in text ${JSON.stringify(text)}`);
  assert.ok(
    !/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text),
    `${label}: bare '&' in text ${JSON.stringify(text)}`,
  );
  assert.ok(
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text),
    `${label}: illegal control character`,
  );
}

function assertWellFormed(xml: string, label = "xml") {
  const s = xml.trim().replace(/^<\?xml[^>]*\?>/, "");
  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9._:-]*)((?:\s+[A-Za-z0-9._:-]+="[^"<]*")*)\s*(\/?)>/g;
  const stack: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s))) {
    checkText(s.slice(last, m.index), label);
    last = m.index + m[0].length;
    if (m[1]) {
      const open = stack.pop();
      assert.equal(open, m[2], `${label}: </${m[2]}> closes <${open}>`);
    } else if (!m[4]) {
      stack.push(m[2]);
    }
  }
  checkText(s.slice(last), label);
  assert.deepEqual(stack, [], `${label}: unclosed tags remain`);
}

const amountsIn = (x: string) =>
  [...x.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((mm) => Number(mm[1]));
const ledgersIn = (x: string) =>
  [...x.matchAll(/<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/g)].map((mm) => mm[1]);
const countOf = (x: string, needle: string) => x.split(needle).length - 1;

// ------------------------------------------------------------- Tally voucher

const r: Reimbursement = {
  expenseLedger: "Boarding & Lodging Expenses",
  personLedger: "VIJAY KIRAN GAUTARAJ",
  amount: 2214.0,
  voucherDate: null,
  narration: "Staff meals",
};

test("voucher balances to zero, debits expense, credits person", () => {
  const xml = buildVoucherXml(r, "Pacific Engineered Surfaces Pvt Ltd- FAB", "Journal");
  const amounts = amountsIn(xml);
  assert.ok(Math.abs(amounts.reduce((a, b) => a + b, 0)) < 0.005, `${amounts}`);
  assert.equal(amounts[0], -2214.0, "expense is debited (negative)");
  assert.equal(amounts[1], 2214.0, "person is credited (positive)");
  const names = ledgersIn(xml);
  assert.equal(names[0], "Boarding &amp; Lodging Expenses", "escapes & in ledger names");
  assert.equal(names[1], "VIJAY KIRAN GAUTARAJ", "credits the person");
});

test("voucher is well-formed XML", () => {
  assertWellFormed(buildVoucherXml(r, "Pacific Engineered Surfaces Pvt Ltd- FAB", "Journal"));
});

test("invalid reimbursements are rejected before any XML exists", () => {
  const bads: Array<[Reimbursement, string]> = [
    [{ expenseLedger: "", personLedger: "P", amount: 10.0 }, "empty expense ledger"],
    [{ expenseLedger: "L", personLedger: "", amount: 10.0 }, "empty person"],
    [{ expenseLedger: "L", personLedger: "P", amount: 0 }, "zero amount"],
    [{ expenseLedger: "L", personLedger: "P", amount: -5 }, "negative amount"],
    [{ expenseLedger: "L", personLedger: "P", amount: 99_999_999 }, "absurd amount"],
  ];
  for (const [bad, label] of bads) {
    assert.throws(() => buildVoucherXml(bad, "Co"), Error, `rejects ${label}`);
  }
});

test("Payment mode needs a cash ledger and then credits it", () => {
  assert.throws(() => buildVoucherXml(r, "Co", "Payment"), Error,
    "rejects Payment mode with no cash ledger");
  const pay = buildVoucherXml(r, "Co", "Payment", "Cash");
  assert.equal(ledgersIn(pay)[1], "Cash", "Payment mode credits cash");
});

// ------------------------------------------- response parsing and unescaping

test("a successful Tally response is recognised, with the voucher id", () => {
  const resp = parseTallyResponse(
    "<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS><LASTVCHID>4471</LASTVCHID></RESPONSE>",
  );
  assert.equal(resp.ok, true);
  assert.equal(resp.message, "Posted to Tally (1 voucher created)");
  assert.equal(resp.voucherNo, "4471");
});

test("a rejection maps to an actionable hint, never raw Tally-speak", () => {
  const raw =
    "<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS>" +
    "<LINEERROR>Could not find Ledger 'Travellinng Expenses'!</LINEERROR></RESPONSE>";
  const resp = parseTallyResponse(raw);
  assert.equal(resp.ok, false);
  assert.ok(resp.message.includes("does not have a ledger with that exact name"));
  assert.equal(resp.errors, 1);
  // Errors with no <ERRORS> count still report at least one error.
  assert.equal(parseTallyResponse("garbage").errors, 1);
  // The LINEERROR fallback fires when no hint pattern matches.
  assert.ok(humaniseTallyError("<LINEERROR>Weird new failure</LINEERROR>")
    .includes("Weird new failure"));
});

test("unescape resolves &amp; LAST, exactly like the Python", () => {
  // Doing &amp; first would turn "&amp;lt;" into a real "<" instead of the
  // literal "&lt;" Tally actually meant.
  assert.equal(unescapeXml("&amp;lt;"), "&lt;");
  assert.equal(unescapeXml("Repairs &amp; Maintenance"), "Repairs & Maintenance");
});

test("day book round-trip: what the builder writes, the parser reads", () => {
  const xml = buildVoucherXml(
    { ...r, voucherDate: new Date(2026, 6, 30) },
    "Co", "Journal",
  );
  const vouchers = parseDayBook(xml);
  assert.equal(vouchers.length, 1);
  assert.equal(vouchers[0].vchType, "Journal");
  assert.equal(vouchers[0].date, "20260730");
  assert.deepEqual(vouchers[0].entries, [
    ["Boarding & Lodging Expenses", -2214.0],
    ["VIJAY KIRAN GAUTARAJ", 2214.0],
  ]);
  // The pre-posting duplicate check: case/whitespace-insensitive person,
  // within the rupee tolerance, counting each voucher at most once.
  assert.equal(countMatchingVouchers(vouchers, " vijay kiran gautaraj", 2214.5), 1);
  assert.equal(countMatchingVouchers(vouchers, "someone else", 2214.0), 0);
  const day = buildDayBookXml("Co", new Date(2026, 6, 30));
  assert.ok(day.includes('<SVFROMDATE TYPE="Date">20260730</SVFROMDATE>'));
  assert.ok(day.includes('<SVTODATE TYPE="Date">20260730</SVTODATE>'));
});

test("ledger list parsing and the people filter", () => {
  const raw =
    '<LEDGER NAME="Repairs &amp; Maintenance" RESERVEDNAME=""><PARENT>Indirect Expenses</PARENT></LEDGER>' +
    '<LEDGER NAME="VIJAY KIRAN GAUTARAJ"><PARENT>SUNDRY CRS FOR SUNDRY EXPENSES</PARENT></LEDGER>' +
    '<LEDGER NAME="AMIT AGARWAL"><PARENT>sundry crs for sundry expenses </PARENT></LEDGER>';
  const ledgers = parseLedgerList(raw);
  assert.equal(ledgers.length, 3);
  assert.equal(ledgers[0].name, "Repairs & Maintenance");
  assert.deepEqual(
    peopleUnderGroup(ledgers, "Sundry CRS for Sundry Expenses"),
    ["AMIT AGARWAL", "VIJAY KIRAN GAUTARAJ"],
  );
});

// ----------------- Batch export (validated against PESPL's own voucher XML)

// Values from automation/config.yaml, verbatim — the company string INCLUDING
// the "(from ...)" suffixes Tally appends, because Tally matches it literally.
const COMPANY =
  "Pacific Engineered Surfaces Pvt Ltd- FAB - (from 1-Apr-21) - (from 1-Apr-22) - (from 1-Apr-23)";
const CASH_LEDGER = "Cash";
const NEW_LEDGER_PARENT = "ADMINISTRATION EXPENSES";
const NEW_PERSON_PARENT = "SUNDRY CRS FOR SUNDRY EXPENSES";
const COMPANY_GSTIN = "33AALCP2750N1Z3";
const GST_REGISTRATION = "Tamil Nadu Registration";
const GST_STATE = "Tamil Nadu";

const known = new Set([
  "Travelling Expenses", "Boarding & Lodging Expenses", "VIJAY KIRAN GAUTARAJ",
]);

const batch: BatchLine[] = [
  { billId: 101, person: "VIJAY KIRAN GAUTARAJ", ledger: "Travelling Expenses",
    amount: 11662.0, voucherDate: new Date(2026, 3, 17), vendor: "AIR TICKET" },
  { billId: 102, person: "BRAND NEW PERSON", ledger: "Brand New Expense Head",
    amount: 1200.0, voucherDate: new Date(2026, 5, 3) },
  { billId: 103, person: "VIJAY KIRAN GAUTARAJ", ledger: "Boarding & Lodging Expenses",
    amount: 2214.0, voucherDate: new Date(2026, 5, 29), vendor: "HOTEL SITARA GRAND" },
  { billId: 104, person: "", ledger: "Travelling Expenses", amount: 500.0 }, // skipped
  { billId: 105, person: "VIJAY KIRAN GAUTARAJ", ledger: "Travelling Expenses",
    amount: 0 }, // skipped
];

const buildMain = () =>
  buildBatch(batch, COMPANY, known, {
    voucherType: "Journal",
    cashLedger: CASH_LEDGER,
    newExpenseParent: NEW_LEDGER_PARENT,
    newPersonParent: NEW_PERSON_PARENT,
    companyGstin: COMPANY_GSTIN,
    gstRegistration: GST_REGISTRATION,
    gstState: GST_STATE,
  });

test("3 valid vouchers, 2 skipped, total counts only valid lines", () => {
  const res = buildMain();
  assert.equal(res.vouchers, 3);
  assert.equal(res.skipped.length, 2);
  assert.equal(res.total, 15076.0);
  assertWellFormed(res.xml, "batch");
});

test("the four things PESPL's real voucher export corrected", () => {
  const x = buildMain().xml;
  // These four were WRONG before the real sample arrived.
  assert.ok(x.includes("<REPORTNAME>Vouchers</REPORTNAME>"),
    "REPORTNAME is 'Vouchers' (was 'All Masters')");
  assert.ok(x.includes("(from 1-Apr-21)"),
    "company string matches Tally's exactly, suffixes included");
  assert.equal(countOf(x, "<ISPARTYLEDGER>Yes</ISPARTYLEDGER>"), 3,
    "party line carries ISPARTYLEDGER=Yes");
  assert.equal(countOf(x, "<BILLTYPE>New Ref</BILLTYPE>"), 3,
    "party line carries BILLALLOCATIONS New Ref");
  assert.equal(countOf(x, "<ISPARTYLEDGER>No</ISPARTYLEDGER>"), 3,
    "expense line carries ISPARTYLEDGER=No");
  assert.ok(x.includes("33AALCP2750N1Z3"), "GSTIN stamped on vouchers");
});

test("each voucher's Dr and Cr cancel; the bill allocation equals the credit", () => {
  const x = buildMain().xml;
  const amts = amountsIn(x);
  // 3 per voucher: expense, party, bill-allocation.
  for (let i = 0; i < amts.length; i += 3) {
    assert.ok(Math.abs(amts[i] + amts[i + 1]) < 0.005, `voucher at ${i}: ${amts}`);
    assert.ok(Math.abs(amts[i + 1] - amts[i + 2]) < 0.005, `allocation at ${i}: ${amts}`);
  }
  assert.ok(x.includes("Boarding &amp; Lodging"), "ampersand escaped in ledger names");
});

test("new masters come first, and only genuinely-new names are created", () => {
  const res = buildMain();
  const x = res.xml;
  // New masters must come first or Tally rejects the voucher that uses them.
  const li = [...x.matchAll(/<LEDGER /g)].map((m) => m.index!);
  const vi = [...x.matchAll(/<VOUCHER /g)].map((m) => m.index!);
  assert.ok(Math.max(...li) < Math.min(...vi), "all new ledgers precede all vouchers");
  assert.deepEqual(
    new Set(res.newLedgers.map((n) => n.name)),
    new Set(["BRAND NEW PERSON", "Brand New Expense Head"]),
  );
  assert.ok(
    res.newLedgers
      .filter((n) => n.name.includes("PERSON"))
      .every((n) => n.parent === "SUNDRY CRS FOR SUNDRY EXPENSES"),
    "new person goes under the verified people group",
  );
  assert.ok(!res.newLedgers.some((n) => n.name === "VIJAY KIRAN GAUTARAJ"),
    "existing ledgers are never recreated");
  assert.equal(normKey("Professional  Fees"), normKey("professional fees"),
    "whitespace variants count as the same ledger");
});

// 100 bills in one file - the actual use case.
const many: BatchLine[] = Array.from({ length: 100 }, (_, k) => ({
  billId: 200 + k,
  person: "VIJAY KIRAN GAUTARAJ",
  ledger: "Travelling Expenses",
  amount: 100.0 + 200 + k,
  voucherDate: new Date(2026, 6, 1),
}));

test("100 bills -> one well-formed file with unique bill references", () => {
  const big = buildBatch(many, COMPANY, known, { voucherType: "Journal" });
  assert.equal(big.vouchers, 100);
  assertWellFormed(big.xml, "big batch");
  const refs = new Set([...big.xml.matchAll(/<NAME>(REIMB-\d+)<\/NAME>/g)].map((m) => m[1]));
  assert.equal(refs.size, 100, "no duplicate bill references");
});

test("voucher numbering: unique, FY-stamped, traceable to the bill id", () => {
  // Regression: with no <VOUCHERNUMBER> Tally stamped every imported voucher
  // "1" - confirmed on PESPL's live data, where ten test vouchers all shared
  // Vch No 1.
  const big = buildBatch(many, COMPANY, known, { voucherType: "Journal" });
  const nums = [...big.xml.matchAll(/<VOUCHERNUMBER>([\s\S]*?)<\/VOUCHERNUMBER>/g)].map((m) => m[1]);
  assert.equal(nums.length, 100, "every voucher carries a number");
  assert.equal(new Set(nums).size, 100, "voucher numbers are unique");
  assert.ok(nums.every((n) => n.includes("/26-27/")),
    `number encodes the financial year: ${nums[0]}`);
  assert.deepEqual(
    [fyLabel(new Date(2026, 2, 31)), fyLabel(new Date(2026, 3, 1))],
    ["25-26", "26-27"],
    "FY rolls over on 1 April",
  );
  const manual = buildBatch(
    [{ billId: 7, person: "VIJAY KIRAN GAUTARAJ", ledger: "Travelling Expenses",
       amount: 5.0, voucherDate: new Date(2026, 6, 1), voucherNo: "PES/MANUAL/7" }],
    COMPANY, known, { voucherType: "Journal" },
  );
  assert.ok(manual.xml.includes("<VOUCHERNUMBER>PES/MANUAL/7</VOUCHERNUMBER>"),
    "an explicit voucher number is respected");
  assert.equal(voucherNumber(42, new Date(2026, 6, 30)), "REIMB/26-27/00042",
    "number traces back to the bill id");
  assert.equal(voucherNumber(42, new Date(2026, 6, 30), "PES/CLAIM"),
    "PES/CLAIM/26-27/00042", "prefix is configurable");
});

test("the export guard: an exported bill never goes out twice", () => {
  // Standard Journal means Tally cannot reject duplicates for us, so this is
  // the only thing standing between an approved bill and a second voucher.
  const gLines: BatchLine[] = [
    { billId: 501, person: "VIJAY KIRAN GAUTARAJ", ledger: "Travelling Expenses",
      amount: 11.0, voucherDate: new Date(2026, 6, 30) },
    { billId: 502, person: "VIJAY KIRAN GAUTARAJ", ledger: "Travelling Expenses",
      amount: 12.0, voucherDate: new Date(2026, 6, 30) },
  ];
  const g = buildBatch(gLines, COMPANY, known, {
    voucherType: "Journal", alreadyExported: new Set([501]),
  });
  assert.equal(g.vouchers, 1, "an already-exported bill is excluded");
  assert.ok(
    g.skipped.some((s) => s.reasons.some((reason) => reason.includes("already exported"))),
    "and the reason is reported, not silent",
  );
  assert.equal(g.total, 12.0, "the total reflects only what is included");

  const dup = buildBatch([...gLines, gLines[0]], COMPANY, known, { voucherType: "Journal" });
  assert.equal(dup.vouchers, 2, "the same bill twice in one batch is caught");
  const nums = new Set(
    [...dup.xml.matchAll(/<VOUCHERNUMBER>([\s\S]*?)<\/VOUCHERNUMBER>/g)].map((m) => m[1]),
  );
  assert.equal(nums.size, dup.vouchers, "duplicate voucher numbers cannot occur");
});

test("dedicated voucher type: created once, before every voucher, guarded", () => {
  // Still supported, in case PESPL ever wants Tally-side duplicate rejection.
  // Off by default in config.
  const one: BatchLine[] = [
    { billId: 1, person: "VIJAY KIRAN GAUTARAJ", ledger: "Travelling Expenses",
      amount: 11.0, voucherDate: new Date(2026, 6, 30) },
  ];
  const vt = buildBatch(one, COMPANY, known, {
    voucherType: "Reimbursement Journal",
    createVoucherType: true,
    voucherTypeParent: "Journal",
  });
  assert.equal(vt.newVoucherType, "Reimbursement Journal", "voucher type is created");
  assert.ok(vt.xml.includes("<PARENT>Journal</PARENT>"), "it is a child of Journal");
  assert.ok(vt.xml.includes("<PREVENTDUPLICATE>Yes</PREVENTDUPLICATE>"),
    "Tally will refuse a re-import (PREVENTDUPLICATE)");
  assert.ok(vt.xml.includes("<NUMBERINGMETHOD>Manual</NUMBERINGMETHOD>"),
    "numbering is manual, so our numbers survive");
  assert.ok(vt.xml.includes("<AFFECTSSTOCK>No</AFFECTSSTOCK>"), "it does not touch stock");
  assert.ok(vt.xml.indexOf("<VOUCHERTYPE ") < vt.xml.indexOf("<VOUCHER "),
    "voucher type precedes every voucher");
  assert.equal(
    countOf(vt.xml, "<VOUCHERTYPENAME>Reimbursement Journal</VOUCHERTYPENAME>"),
    1, "vouchers use the new type",
  );
  assertWellFormed(vt.xml, "voucher-type batch");

  assert.equal(
    buildBatch(one, COMPANY, known, { voucherType: "Journal", createVoucherType: true })
      .newVoucherType,
    null, "built-in Journal is never recreated",
  );
  assert.equal(
    buildBatch(one, COMPANY, known, {
      voucherType: "Reimbursement Journal",
      knownVoucherTypes: new Set(["reimbursement  journal"]),
    }).newVoucherType,
    null, "an existing custom type is not recreated",
  );
  assert.equal(
    countOf(
      buildBatch(many, COMPANY, known, { voucherType: "Reimbursement Journal" }).xml,
      "<VOUCHERTYPE ",
    ),
    1, "100-bill batch emits the type exactly once",
  );
});

// --------------------------------------------------- vendor invoices (Agent 2)

test("a vendor voucher balances across all legs and is numbered by the invoice", () => {
  const vl: VendorLine = {
    billId: 77, vendorLedger: "ACME Supplies", expenseLedger: "Stores & Spares",
    taxable: 100.0, invoiceNo: "INV-9",
    taxLines: [
      { ledger: "INPUT CGST @ 9%", amount: 9.0 },
      { ledger: "INPUT SGST @ 9%", amount: 9.0 },
    ],
    tdsLedger: "TDS Payable - 194C", tdsAmount: 10.0,
    voucherDate: new Date(2026, 6, 30),
  };
  const block = vendorVoucherBlock(vl);
  // Dr 100 + Dr 9 + Dr 9 vs Cr 10 (TDS) + Cr 108 (vendor, net of TDS),
  // then the bill allocation repeats the vendor credit.
  assert.deepEqual(amountsIn(block), [-100.0, -9.0, -9.0, 10.0, 108.0, 108.0]);
  assert.ok(block.includes("<VOUCHERNUMBER>INV-9</VOUCHERNUMBER>"),
    "the voucher number IS the supplier's invoice number");
  assert.ok(block.includes("[bill #77]"),
    "the bill id moves into the narration for traceability");
  // An unbalanced line fails HERE with the invoice named, not inside Tally.
  assert.throws(
    () => vendorVoucherBlock({ ...vl, tdsAmount: 500.0 }),
    /invoice INV-9/,
  );
});

test("statutory ledgers are never auto-created; the invoice is skipped and named", () => {
  const vl: VendorLine = {
    billId: 78, vendorLedger: "ACME Supplies", expenseLedger: "Stores & Spares",
    taxable: 100.0, invoiceNo: "INV-10",
    taxLines: [{ ledger: "INPUT IGST @ 12%", amount: 12.0 }],
    voucherDate: new Date(2026, 6, 30),
  };
  const res = buildBatch([], COMPANY, known, { vendorLines: [vl] });
  assert.equal(res.vendorVouchers, 0);
  assert.ok(res.skipped.some((s) =>
    s.billId === 78 &&
    s.reasons.some((reason) => reason.includes("statutory heads are never auto-created"))));

  // With the statutory head open in Tally, the same invoice goes through and
  // the vendor totals are net of TDS (what is actually owed).
  const known2 = new Set([...known, "INPUT IGST @ 12%"]);
  const ok = buildBatch([], COMPANY, known2, { vendorLines: [vl] });
  assert.equal(ok.vendorVouchers, 1);
  assert.equal(ok.vendorTotal, 112.0);
  assert.equal(ok.total, 112.0);
  assertWellFormed(ok.xml, "vendor batch");

  // Two invoices sharing the supplier's number cannot share one file. The
  // identity is normKey's: case- and whitespace-insensitive, hyphens intact.
  const clash = buildBatch([], COMPANY, known2, {
    vendorLines: [vl, { ...vl, billId: 79, invoiceNo: " inv-10 " }],
  });
  assert.equal(clash.vendorVouchers, 1);
  assert.ok(clash.skipped.some((s) =>
    s.billId === 79 && s.reasons.some((reason) => reason.includes("already used by bill 78"))));
});

// ----------------------------------------------------------- review artefacts

test("the Excel review sheet mirrors openpyxl's columns, order and total", () => {
  const lines: BatchLine[] = [
    { billId: 101, person: "VIJAY KIRAN GAUTARAJ", ledger: "Travelling Expenses",
      amount: 11662.0, voucherDate: new Date(2026, 3, 17), vendor: "AIR TICKET",
      narration: "" },
    { billId: 103, person: "VIJAY KIRAN GAUTARAJ", ledger: "Boarding & Lodging Expenses",
      amount: 2214.0, voucherDate: new Date(2026, 5, 29), vendor: "HOTEL SITARA GRAND",
      narration: "" },
  ];
  const wb = buildBatchExcel(lines, [
    { name: "Brand New Expense Head", parent: "ADMINISTRATION EXPENSES" },
  ]);
  assert.deepEqual(wb.SheetNames, ["Vouchers", "New ledgers"]);
  const ws = wb.Sheets["Vouchers"];
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(ws, { header: 1 });
  assert.deepEqual(rows[0], [
    "Bill #", "Date", "Person (Credit)", "Expense Ledger (Debit)",
    "Amount", "Vendor", "Narration",
  ]);
  assert.deepEqual(rows[1].slice(0, 5),
    [101, "17-04-2026", "VIJAY KIRAN GAUTARAJ", "Travelling Expenses", 11662.0]);
  // TOTAL row lands one blank row below the data, with a live formula.
  assert.equal((ws["D5"] as XLSX.CellObject).v, "TOTAL");
  assert.equal((ws["E5"] as XLSX.CellObject).f, "SUM(E2:E3)");
  const ws2 = wb.Sheets["New ledgers"];
  const rows2 = XLSX.utils.sheet_to_json<Array<string>>(ws2, { header: 1 });
  assert.deepEqual(rows2[0], ["Ledger the XML will create", "Under group"]);
  assert.deepEqual(rows2[1], ["Brand New Expense Head", "ADMINISTRATION EXPENSES"]);
});

test("batch filenames cannot collide within a clock minute", () => {
  const a = batchFilename();
  const b = batchFilename();
  assert.match(a, /^reimbursements_\d{8}_\d{6}_[0-9a-f]{6}$/);
  assert.notEqual(a, b, "the random suffix separates same-second exports");
});
