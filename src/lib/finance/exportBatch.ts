// Batch export: N approved bills -> ONE file to import into Tally.
// Ported from automation/app/export_batch.py.
//
// THE ORDERING RULE THAT MAKES THIS WORK
// --------------------------------------
// Tally imports a file top to bottom. A voucher referencing a ledger that does
// not exist yet is rejected, and in a 100-voucher file one rejection can abort
// what follows. So every new ledger is emitted FIRST, in its own TALLYMESSAGE
// block, before any voucher. One file, one import, and ledgers that did not
// exist five minutes ago are created and used in the same pass.
//
// New ledgers come from two places:
//   - an expense head a clerk typed that is not in the master
//   - a person who has no ledger yet
// Both are checked against the master parsed from Tally's own All Masters
// export, so "new" means genuinely absent from Tally - not merely absent from
// a report. That distinction matters: the Trial Balance report omitted 510
// real ledgers, and trusting it would have created 510 duplicates.
//
// WHY XML IS THE IMPORT PATH AND EXCEL IS NOT
// -------------------------------------------
// Tally's Excel import cannot create masters - only vouchers, and only when
// every ledger already exists. XML does both. Excel is still offered because
// finance teams like to eyeball a sheet before importing, but it is a REVIEW
// artefact. The UI says so, because importing the wrong one fails confusingly.
//
// This module is pure logic: no prisma, no fs, no network. buildBatchExcel
// returns a SheetJS workbook; the caller decides where the bytes go. It is
// also self-contained — escXml and tallyDate are duplicated from tally.ts
// rather than imported, because `node --test` resolves ESM strictly (a
// relative import with no .ts extension fails, and adding the extension
// fights the Next build). See the same note in dedupe.ts.

import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Duplicated helpers — byte-identical behaviour to tally.ts (see header).
// ---------------------------------------------------------------------------

const XML_ILLEGAL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

/** Escape for XML element content AND attribute values; & first. Same
 *  reasoning as tally.ts: '&' in a ledger name is the most common cause of a
 *  rejected voucher, and quotes would close an attribute early. */
function esc(s: unknown): string {
  const t = s ? String(s) : "";
  return t
    .replace(XML_ILLEGAL, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Tally's yyyymmdd, local time; today when no date given. */
function tallyDate(d?: Date | null): string {
  const dt = d ?? new Date();
  return (
    String(dt.getFullYear()) +
    String(dt.getMonth() + 1).padStart(2, "0") +
    String(dt.getDate()).padStart(2, "0")
  );
}

/** round(x, 2). Python's round() is banker's; this rounds half away from
 *  zero. Differs only on exact half-cents, which 2dp bill amounts never hit. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Batch lines
// ---------------------------------------------------------------------------

/** One reimbursement in the batch. */
export interface BatchLine {
  billId: number;
  person: string;
  ledger: string;
  amount: number;
  voucherDate?: Date | null;
  narration?: string;
  vendor?: string;
  voucherNo?: string;
}

export function batchLineProblems(l: BatchLine): string[] {
  const out: string[] = [];
  if (!(l.person || "").trim()) out.push("no person");
  if (!(l.ledger || "").trim()) out.push("no ledger");
  // Python: float() raising -> "not a number"; falsy or <= 0 -> "zero or
  // missing". NaN is the JS spelling of "float() raised".
  const amt = Number(l.amount);
  if (Number.isNaN(amt)) out.push("amount is not a number");
  else if (!l.amount || amt <= 0) out.push("amount is zero or missing");
  return out;
}

/**
 * Case- and whitespace-insensitive ledger identity.
 *
 * Tally's own exports are inconsistent about double spaces
 * ("Professional  Fees"), and creating a second ledger that differs only in
 * whitespace is painful to unpick afterwards.
 */
export function normKey(n: string | null | undefined): string {
  return (n || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Indian financial year label for a date: 30-Jul-2026 -> "26-27". */
export function fyLabel(d?: Date | null): string {
  const dt = d ?? new Date();
  const month = dt.getMonth() + 1;
  const start = month >= 4 ? dt.getFullYear() : dt.getFullYear() - 1;
  const two = (y: number) => String(((y % 100) + 100) % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}

/**
 * A unique, human-readable voucher number.
 *
 * WHY THIS EXISTS
 * ---------------
 * Omitting <VOUCHERNUMBER> made Tally stamp every imported voucher as "1" -
 * verified on PESPL's own data, where ten test imports all came in as Vch No 1.
 * A hundred reimbursements sharing one number is useless for audit and makes
 * reversing a single wrong entry a manual hunt.
 *
 * The bill id is the uniqueness guarantee, and it points straight back at the
 * scanned image in our own database, so any Tally line can be traced to a
 * photograph without a lookup table. The FY segment matches how PESPL already
 * numbers vouchers (MAA142946/26-27).
 */
export function voucherNumber(billId: number, d?: Date | null, prefix = "REIMB"): string {
  return `${prefix}/${fyLabel(d)}/${String(Math.trunc(billId)).padStart(5, "0")}`;
}

// Learned from PESPL's own exported Journal (data/SAMPLE_VOUCHER.xml). Three
// things that file corrected, each of which would have caused rejections or
// silently wrong data:
//
//  1. REPORTNAME must be "Vouchers", not "All Masters", when the payload
//     contains vouchers. Masters and vouchers cannot share one envelope.
//  2. The credited party carries <ISPARTYLEDGER>Yes</ISPARTYLEDGER> and a
//     <BILLALLOCATIONS.LIST> with BILLTYPE "New Ref". PESPL's party ledgers
//     have bill-wise tracking ON (the masters file has 2,861 BILLALLOCATIONS
//     blocks). Omitting it leaves the credit unallocated, which shows up later
//     as an unreconciled balance rather than an import error - the worst kind
//     of bug, because nobody notices for a month.
//  3. GST registration fields are stamped on the voucher. Harmless to include
//     and it matches what Tally itself writes, so the import behaves the same
//     as a manual entry.
//
// Everything in their export that is a Tally *default* (the ~90 ISxxx>No
// flags) is deliberately omitted: Tally fills defaults itself, and a shorter
// file is far easier for a human to inspect before importing.
export function voucherBlock(
  line: BatchLine,
  voucherType: string,
  cashLedger?: string | null,
  companyGstin = "",
  gstRegistration = "",
  gstState = "",
  vchPrefix = "REIMB",
): string {
  const amount = round2(Number(line.amount));
  let credit = line.person;
  if (voucherType.toLowerCase() === "payment") {
    if (!cashLedger) throw new Error("Payment batches need tally.cash_ledger in config");
    credit = cashLedger;
  }

  const d = tallyDate(line.voucherDate);
  const narration =
    line.narration ||
    `Reimbursement to ${line.person}` + (line.vendor ? ` - ${line.vendor}` : "");

  // Bill reference for the party allocation. Tally requires a NAME; using the
  // bill id keeps it unique and traceable straight back to the scanned image.
  const billRef = `REIMB-${line.billId}`;

  // Unique voucher number. Without it Tally numbers every imported voucher "1".
  const vchNo =
    (line.voucherNo || "").trim() || voucherNumber(line.billId, line.voucherDate, vchPrefix);

  let gstBlock = "";
  if (companyGstin) {
    gstBlock =
      `\n      <GSTREGISTRATION TAXTYPE="GST" ` +
      `TAXREGISTRATION="${esc(companyGstin)}">` +
      `${esc(gstRegistration)}</GSTREGISTRATION>` +
      `\n      <CMPGSTIN>${esc(companyGstin)}</CMPGSTIN>` +
      `\n      <CMPGSTREGISTRATIONTYPE>Regular</CMPGSTREGISTRATIONTYPE>` +
      `\n      <CMPGSTSTATE>${esc(gstState)}</CMPGSTSTATE>`;
  }

  // Negative = debit, positive = credit. The pair must sum to zero.
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${esc(voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>${d}</DATE>
      <EFFECTIVEDATE>${d}</EFFECTIVEDATE>
      <REFERENCEDATE>${d}</REFERENCEDATE>
      <VOUCHERTYPENAME>${esc(voucherType)}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${esc(vchNo)}</VOUCHERNUMBER>
      <REFERENCE>${esc(vchNo)}</REFERENCE>
      <NARRATION>${esc(narration)}</NARRATION>
      <PARTYLEDGERNAME>${esc(credit)}</PARTYLEDGERNAME>${gstBlock}
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <VCHENTRYMODE>As Voucher</VCHENTRYMODE>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${esc(line.ledger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>${(-amount).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${esc(credit)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <AMOUNT>${amount.toFixed(2)}</AMOUNT>
       <BILLALLOCATIONS.LIST>
        <NAME>${esc(billRef)}</NAME>
        <BILLTYPE>New Ref</BILLTYPE>
        <AMOUNT>${amount.toFixed(2)}</AMOUNT>
       </BILLALLOCATIONS.LIST>
      </ALLLEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>`;
}

// ---------------------------------------------------------------------------
// Vendor invoices (Agent 2)
// ---------------------------------------------------------------------------

/** One input-tax line on a vendor invoice: which ledger, how much. */
export interface VendorTaxLine {
  ledger: string;
  amount: number;
}

/**
 * One vendor invoice in the batch - Agent 2.
 *
 * Deliberately a separate type from BatchLine rather than optional fields on
 * it. A reimbursement and a purchase invoice look similar on the review screen
 * and are nothing alike in the books: different number of legs, a bill
 * reference that must be the vendor's own invoice number, input credit, and a
 * split credit side when tax is withheld. Folding them together produced a
 * builder where every second line was `if is_vendor`, and the reimbursement
 * path - the one already live - got riskier every time Agent 2 changed.
 */
export interface VendorLine {
  billId: number;
  vendorLedger: string; // the creditor, credited
  expenseLedger: string; // the expense head, debited at taxable value
  taxable: number;
  invoiceNo: string; // becomes the bill reference - NOT our own id
  taxLines?: VendorTaxLine[];
  tdsLedger?: string; // blank when nothing is withheld
  tdsAmount?: number;
  voucherDate?: Date | null;
  narration?: string;
  voucherNo?: string;
}

export function vendorTaxTotal(v: VendorLine): number {
  return round2((v.taxLines ?? []).reduce((s, t) => s + Number(t.amount), 0));
}

/** What the vendor billed: taxable + tax. TDS does not reduce this. */
export function vendorInvoiceTotal(v: VendorLine): number {
  return round2(round2(Number(v.taxable)) + vendorTaxTotal(v));
}

/** What the vendor is actually credited, after withholding. */
export function vendorPayable(v: VendorLine): number {
  return round2(vendorInvoiceTotal(v) - round2(Number(v.tdsAmount || 0)));
}

export function vendorLineProblems(v: VendorLine): string[] {
  const out: string[] = [];
  if (!(v.vendorLedger || "").trim()) out.push("no vendor");
  if (!(v.expenseLedger || "").trim()) out.push("no expense ledger");
  if (!(v.invoiceNo || "").trim()) {
    // The bill reference has to be the vendor's number or the creditor's
    // outstandings never tie back to their statement.
    out.push("no invoice number");
  }
  const taxable = Number(v.taxable);
  if (Number.isNaN(taxable)) out.push("taxable value is not a number");
  else if (!v.taxable || taxable <= 0) out.push("taxable value is zero or missing");
  for (const t of v.taxLines ?? []) {
    if (!(t.ledger || "").trim()) out.push("a tax line has no ledger");
    if (Number(t.amount || 0) <= 0) out.push(`tax line '${t.ledger}' has a zero amount`);
  }
  const tds = Number(v.tdsAmount || 0);
  if (tds > 0 && !(v.tdsLedger || "").trim()) out.push("TDS amount with no TDS ledger");
  if ((v.tdsLedger || "").trim() && tds <= 0) out.push("TDS ledger with no amount");
  if (tds > 0 && vendorPayable(v) <= 0) out.push("TDS exceeds the invoice total");
  return out;
}

/**
 * One vendor invoice as a Tally Journal.
 *
 *     Dr  expense head        taxable
 *     Dr  each tax ledger     its own amount      (input credit, full value)
 *     Cr  TDS payable         withheld            (only when withholding)
 *     Cr  vendor              invoice total - TDS
 *
 * The debits and credits are asserted to net to zero before this returns.
 * Tally rejects an unbalanced voucher, but its message names neither the
 * voucher nor the amount, so in a 60-invoice batch you would be bisecting a
 * file by hand. Failing here names the invoice.
 */
export function vendorVoucherBlock(
  line: VendorLine,
  companyGstin = "",
  gstRegistration = "",
  gstState = "",
  voucherType = "Journal",
): string {
  const problems = vendorLineProblems(line);
  if (problems.length) {
    throw new Error(`invoice ${line.invoiceNo || line.billId}: ${problems.join("; ")}`);
  }

  const taxable = round2(Number(line.taxable));
  const tds = round2(Number(line.tdsAmount || 0));
  const payable = vendorPayable(line);

  // Negative = debit, positive = credit, and they must cancel exactly.
  // [ledger, isDebit, amount, isParty]
  const entries: Array<[string, boolean, number, boolean]> = [
    [line.expenseLedger, true, -taxable, false],
  ];
  for (const t of line.taxLines ?? []) {
    entries.push([t.ledger, true, -round2(Number(t.amount)), false]);
  }
  if (tds > 0) entries.push([line.tdsLedger!, false, tds, false]);
  entries.push([line.vendorLedger, false, payable, true]);

  const total = round2(entries.reduce((s, [, , a]) => s + a, 0));
  if (Math.abs(total) > 0.005) {
    throw new Error(
      `invoice ${line.invoiceNo || line.billId} does not balance - ` +
        `entries sum to ${total.toFixed(2)} (taxable ${taxable.toFixed(2)}, ` +
        `tax ${vendorTaxTotal(line).toFixed(2)}, TDS ${tds.toFixed(2)})`,
    );
  }

  const d = tallyDate(line.voucherDate);

  // THE VOUCHER NUMBER IS THE SUPPLIER'S INVOICE NUMBER.
  //
  // Unlike a reimbursement - which has no external document number, so we mint
  // REIMB/26-27/00123 - a purchase already has the number both sides of the
  // transaction refer to. Numbering the voucher anything else means an
  // accountant holding the supplier's statement has to translate before they
  // can find the entry, every time.
  //
  // TWO CONSEQUENCES, BOTH DELIBERATE:
  //
  //  - Uniqueness now depends on the supplier's numbering, not ours. Two
  //    vendors can both issue "001". Tally will hold the second one against
  //    the first; if it objects, that is a real collision worth seeing rather
  //    than papering over with a prefix.
  //  - The link back to the scanned image no longer lives in the number, so
  //    the bill id moves into the narration. Without it, a voucher in Tally
  //    cannot be traced to the photograph it came from.
  const vchNo = (line.voucherNo || "").trim() || line.invoiceNo.trim();
  let narration =
    line.narration || `Purchase - ${line.vendorLedger} - Inv ${line.invoiceNo}`;
  narration = `${narration} [bill #${line.billId}]`;

  let gstBlock = "";
  if (companyGstin) {
    gstBlock =
      `\n      <GSTREGISTRATION TAXTYPE="GST" ` +
      `TAXREGISTRATION="${esc(companyGstin)}">` +
      `${esc(gstRegistration)}</GSTREGISTRATION>` +
      `\n      <CMPGSTIN>${esc(companyGstin)}</CMPGSTIN>` +
      `\n      <CMPGSTREGISTRATIONTYPE>Regular</CMPGSTREGISTRATIONTYPE>` +
      `\n      <CMPGSTSTATE>${esc(gstState)}</CMPGSTSTATE>`;
  }

  const rows: string[] = [];
  for (const [ledger, isDebit, amount, isParty] of entries) {
    // The bill reference goes on the VENDOR leg only, and it is the vendor's
    // own invoice number - that is what their statement shows and what a
    // later payment is settled "Agst Ref" against. Allocating the net-of-TDS
    // amount is deliberate: the outstanding is what we owe.
    let alloc = "";
    if (isParty) {
      alloc =
        `\n       <BILLALLOCATIONS.LIST>` +
        `\n        <NAME>${esc(line.invoiceNo)}</NAME>` +
        `\n        <BILLTYPE>New Ref</BILLTYPE>` +
        `\n        <AMOUNT>${amount.toFixed(2)}</AMOUNT>` +
        `\n       </BILLALLOCATIONS.LIST>`;
    }
    rows.push(
      `      <ALLLEDGERENTRIES.LIST>\n` +
        `       <LEDGERNAME>${esc(ledger)}</LEDGERNAME>\n` +
        `       <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>\n` +
        `       <ISPARTYLEDGER>${isParty ? "Yes" : "No"}</ISPARTYLEDGER>\n` +
        `       <AMOUNT>${amount.toFixed(2)}</AMOUNT>${alloc}\n` +
        `      </ALLLEDGERENTRIES.LIST>`,
    );
  }

  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${esc(voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>${d}</DATE>
      <EFFECTIVEDATE>${d}</EFFECTIVEDATE>
      <REFERENCEDATE>${d}</REFERENCEDATE>
      <VOUCHERTYPENAME>${esc(voucherType)}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${esc(vchNo)}</VOUCHERNUMBER>
      <REFERENCE>${esc(line.invoiceNo)}</REFERENCE>
      <NARRATION>${esc(narration)}</NARRATION>
      <PARTYLEDGERNAME>${esc(line.vendorLedger)}</PARTYLEDGERNAME>${gstBlock}
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <VCHENTRYMODE>As Voucher</VCHENTRYMODE>
${rows.join("\n")}
     </VOUCHER>
    </TALLYMESSAGE>`;
}

/**
 * Create a dedicated voucher type for reimbursements.
 *
 * WHY A SEPARATE TYPE
 * -------------------
 * Three things it buys, none available on the plain Journal:
 *
 * 1. PREVENTDUPLICATE. Tally refuses a second voucher with the same number, so
 *    importing the same file twice is REJECTED rather than duplicated. We
 *    proved that gap on live data: five imports of one test file produced ten
 *    vouchers and Tally never objected. Since a duplicate reaching the books
 *    becomes a duplicate payment, having the guard on Tally's side as well as
 *    ours is worth the one extra master.
 * 2. Its own number series, so our numbering can never be confused with a
 *    journal number a clerk types by hand.
 * 3. Reimbursements become filterable and reportable as a group - "show me
 *    every staff claim this quarter" is one Day Book filter.
 *
 * PARENT is Journal, so it behaves identically in the accounts: same Dr/Cr
 * treatment, same reports, nothing new for an auditor to learn.
 */
export function voucherTypeBlock(name: string, parent = "Journal"): string {
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHERTYPE NAME="${esc(name)}" ACTION="Create">
      <NAME>${esc(name)}</NAME>
      <PARENT>${esc(parent)}</PARENT>
      <NUMBERINGMETHOD>Manual</NUMBERINGMETHOD>
      <PREVENTDUPLICATE>Yes</PREVENTDUPLICATE>
      <ISOPTIONAL>No</ISOPTIONAL>
      <AFFECTSSTOCK>No</AFFECTSSTOCK>
      <USEFORPOSDINVOICE>No</USEFORPOSDINVOICE>
     </VOUCHERTYPE>
    </TALLYMESSAGE>`;
}

export function ledgerBlock(name: string, parent: string): string {
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <LEDGER NAME="${esc(name)}" ACTION="Create">
      <NAME>${esc(name)}</NAME>
      <PARENT>${esc(parent)}</PARENT>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <OPENINGBALANCE>0</OPENINGBALANCE>
     </LEDGER>
    </TALLYMESSAGE>`;
}

// ---------------------------------------------------------------------------
// The batch builder
// ---------------------------------------------------------------------------

export interface BuildBatchOptions {
  voucherType?: string;
  cashLedger?: string | null;
  newExpenseParent?: string;
  newPersonParent?: string;
  companyGstin?: string;
  gstRegistration?: string;
  gstState?: string;
  createVoucherType?: boolean;
  voucherTypeParent?: string;
  knownVoucherTypes?: Iterable<string> | null;
  voucherNoPrefix?: string;
  alreadyExported?: Iterable<number> | null;
  vendorLines?: VendorLine[] | null;
  newVendorParent?: string;
  /** Accepted for parity with the Python signature; the Python never used it
   *  either — a purchase voucher is numbered with the supplier's invoice
   *  number, so there is no prefix to apply. */
  vendorNoPrefix?: string;
}

export interface BuildBatchResult {
  xml: string;
  vouchers: number;
  reimbursementVouchers: number;
  vendorVouchers: number;
  newLedgers: Array<{ name: string; parent: string }>;
  newVoucherType: string | null;
  skipped: Array<{ billId: number; reasons: string[] }>;
  total: number;
  reimbursementTotal: number;
  vendorTotal: number;
  vendorTdsTotal: number;
  lines: BatchLine[];
  vendorLines: VendorLine[];
}

/**
 * Build one importable XML for the whole batch.
 *
 * Returns the xml plus exactly what it will do, so the UI can show a human
 * the consequences before anyone imports anything:
 *     vouchers      how many will be created
 *     newLedgers    which masters will be created, and under which group
 *     skipped       bills left out, with the reason
 *     total         rupee total of what IS included
 *
 * Unlike the Python (which rewrote ledger spellings on the caller's own
 * objects), input lines are shallow-copied before canonicalisation — the
 * returned `lines`/`vendorLines` carry the rewritten spellings, the caller's
 * arrays are left alone.
 */
export function buildBatch(
  lines: BatchLine[],
  company: string,
  knownLedgers: Iterable<string>,
  options: BuildBatchOptions = {},
): BuildBatchResult {
  const {
    voucherType = "Journal",
    cashLedger = null,
    newExpenseParent = "Indirect Expenses",
    newPersonParent = "Sundry Creditors",
    companyGstin = "",
    gstRegistration = "",
    gstState = "",
    createVoucherType = true,
    voucherTypeParent = "Journal",
    knownVoucherTypes = null,
    voucherNoPrefix = "REIMB",
    alreadyExported = null,
    vendorLines = null,
    newVendorParent = "Sundry Creditors",
  } = options;

  // Identity is whitespace/case-insensitive, but Tally matches a voucher's
  // <LEDGERNAME> to a master BYTE FOR BYTE. So keep a canonical spelling per
  // identity and rewrite every line to it below - otherwise a bill typed
  // "Travelling  Expenses" (two spaces) is judged "already known", then emits
  // a voucher naming a ledger Tally cannot resolve, and the import fails.
  const canonical = new Map<string, string>();
  for (const n of [...knownLedgers].sort()) {
    const k = normKey(n);
    if (!canonical.has(k)) canonical.set(k, n.trim());
  }
  const exact = new Set([...knownLedgers].map((n) => n.trim()));
  const known = new Set(canonical.keys());

  // THE EXPORT GUARD.
  // Because the batch posts under Tally's standard Journal, Tally cannot
  // reject a duplicate for us. So a bill that has already been in an exported
  // file is excluded here rather than sent a second time - and it is reported
  // as skipped, not dropped silently, so a human sees why.
  //
  // This does not stop someone re-importing an OLD file into Tally; nothing on
  // our side can. It stops the far likelier accident: a bill still sitting in
  // the approved list getting swept into tomorrow's batch as well.
  const exported = new Set([...(alreadyExported ?? [])].map((b) => Math.trunc(Number(b))));

  const ok: BatchLine[] = [];
  const skipped: Array<{ billId: number; reasons: string[] }> = [];
  const seenIds = new Set<number>();
  for (const raw of lines) {
    const ln = { ...raw };
    const probs = batchLineProblems(ln);
    if (exported.has(ln.billId)) {
      probs.push("already exported to Tally in an earlier batch");
    }
    if (seenIds.has(ln.billId)) {
      // Two lines for one bill would post it twice within a single file and
      // produce a duplicate voucher number.
      probs.push("listed twice in this batch");
    }
    seenIds.add(ln.billId);
    if (probs.length) skipped.push({ billId: ln.billId, reasons: probs });
    else ok.push(ln);
  }

  // Collect new masters, keeping the first spelling seen.
  const newLedgers: Array<[string, string]> = [];
  const seenNew = new Set<string>();
  for (const ln of ok) {
    for (const [name, parent] of [
      [ln.ledger, newExpenseParent],
      [ln.person, newPersonParent],
    ] as Array<[string, string]>) {
      const k = normKey(name);
      if (k && !known.has(k) && !seenNew.has(k)) {
        seenNew.add(k);
        canonical.set(k, name.trim());
        newLedgers.push([name.trim(), parent]);
      }
    }
  }

  // Every voucher now names either an existing Tally master or a ledger
  // created earlier in this same file, spelled identically.
  const canon = (s: string): string => {
    const t = (s || "").trim();
    // An exact byte-match wins: Tally may genuinely hold two ledgers that
    // differ only in whitespace, and we must not merge them.
    return exact.has(t) ? t : canonical.get(normKey(t)) ?? t;
  };

  for (const ln of ok) {
    ln.ledger = canon(ln.ledger);
    ln.person = canon(ln.person);
  }

  // -----------------------------------------------------------------------
  // Agent 2: vendor invoices.
  //
  // Same batch, same file, same import. They are validated separately because
  // a purchase can fail in ways a reimbursement cannot - an unbalanced set of
  // legs, or a GST/TDS head that does not exist.
  //
  // THE RULE THAT MATTERS HERE: expense heads and vendors may be CREATED, but
  // statutory ledgers - input GST, TDS payable - may NOT. A missing "INPUT
  // IGST @ 12%" means finance has not opened that head yet, and inventing it
  // under a guessed parent puts input credit somewhere the GST return will
  // not find it. So the invoice is skipped and named, and a human opens the
  // ledger in Tally. This is the one place where refusing to act is safer
  // than acting.
  // -----------------------------------------------------------------------
  const vOk: VendorLine[] = [];
  // The voucher number IS the supplier's invoice number, so uniqueness is no
  // longer ours to guarantee. Two invoices sharing a number inside one file
  // would post two vouchers numbered identically - which is exactly the
  // "every voucher is Vch No 1" problem the numbering exists to prevent, and
  // it makes reversing one of them a manual hunt. Caught here, named, and
  // skipped rather than discovered in the books.
  const seenInvoice = new Map<string, number>();
  for (const rawVl of vendorLines ?? []) {
    const vl: VendorLine = { ...rawVl, taxLines: (rawVl.taxLines ?? []).map((t) => ({ ...t })) };
    const probs = vendorLineProblems(vl);
    if (exported.has(vl.billId)) {
      probs.push("already exported to Tally in an earlier batch");
    }
    if (seenIds.has(vl.billId)) probs.push("listed twice in this batch");
    seenIds.add(vl.billId);

    const inv = normKey(vl.invoiceNo);
    if (inv && seenInvoice.has(inv)) {
      probs.push(
        `invoice number '${vl.invoiceNo}' is already used by bill ` +
          `${seenInvoice.get(inv)} in this batch - a purchase voucher is ` +
          `numbered with the supplier's invoice number, so two cannot ` +
          `share one`,
      );
    } else if (inv) {
      seenInvoice.set(inv, vl.billId);
    }

    for (const statutory of [
      ...(vl.taxLines ?? []).map((t) => t.ledger),
      ...(vl.tdsLedger ? [vl.tdsLedger] : []),
    ]) {
      if (!known.has(normKey(statutory))) {
        probs.push(
          `'${statutory}' is not a ledger in Tally - create it there ` +
            `first (statutory heads are never auto-created)`,
        );
      }
    }

    if (probs.length) {
      skipped.push({ billId: vl.billId, reasons: probs });
      continue;
    }

    for (const [name, parent] of [
      [vl.expenseLedger, newExpenseParent],
      [vl.vendorLedger, newVendorParent],
    ] as Array<[string, string]>) {
      const k = normKey(name);
      if (k && !known.has(k) && !seenNew.has(k)) {
        seenNew.add(k);
        canonical.set(k, name.trim());
        newLedgers.push([name.trim(), parent]);
      }
    }

    vl.expenseLedger = canon(vl.expenseLedger);
    vl.vendorLedger = canon(vl.vendorLedger);
    vl.taxLines = (vl.taxLines ?? []).map((t) => ({ ledger: canon(t.ledger), amount: t.amount }));
    if (vl.tdsLedger) vl.tdsLedger = canon(vl.tdsLedger);
    vOk.push(vl);
  }

  // ORDER MATTERS: voucher type, then ledgers, then vouchers. Tally reads the
  // file top to bottom, so anything a voucher refers to must already have
  // been created earlier in the same file.
  const builtin = new Set(["journal", "payment", "receipt", "contra", "sales", "purchase"]);
  const knownVt = new Set([...(knownVoucherTypes ?? [])].map((v) => normKey(v)));
  let newVoucherType: string | null = null;
  if (createVoucherType && !builtin.has(voucherType.toLowerCase()) && !knownVt.has(normKey(voucherType))) {
    newVoucherType = voucherType;
  }

  const blocks: string[] = newVoucherType
    ? [voucherTypeBlock(newVoucherType, voucherTypeParent)]
    : [];
  blocks.push(...newLedgers.map(([n, p]) => ledgerBlock(n, p)));
  blocks.push(
    ...ok.map((ln) =>
      voucherBlock(ln, voucherType, cashLedger, companyGstin, gstRegistration, gstState, voucherNoPrefix),
    ),
  );
  // Vendor invoices always post as Journal - confirmed with PESPL. They come
  // after the reimbursements purely for readability; both only reference
  // masters emitted above.
  blocks.push(
    ...vOk.map((vl) => vendorVoucherBlock(vl, companyGstin, gstRegistration, gstState, "Journal")),
  );
  // A Payment settles against the bank/cash ledger, so the party ledger on
  // the credit side is that account - the person is only the payee. Guard
  // here so a config change to voucherType cannot silently mis-post.
  if (voucherType.toLowerCase() === "payment" && !cashLedger) {
    throw new Error("Payment batches need tally.cash_ledger in config");
  }

  // REPORTNAME "Vouchers" - copied from PESPL's own export. Tally uses this
  // to decide how to interpret the payload; "All Masters" with vouchers
  // inside is rejected.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${blocks.join("\n")}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;

  // The two totals are reported separately as well as combined. A
  // reimbursement total is money owed to staff; a purchase total is money
  // owed to suppliers, and it is net of TDS. Showing one merged number on the
  // preview screen would be a figure that reconciles to nothing.
  const reimbTotal = round2(ok.reduce((s, l) => s + Number(l.amount), 0));
  const vendorTotal = round2(vOk.reduce((s, v) => s + vendorPayable(v), 0));
  return {
    xml,
    vouchers: ok.length + vOk.length,
    reimbursementVouchers: ok.length,
    vendorVouchers: vOk.length,
    newLedgers: newLedgers.map(([name, parent]) => ({ name, parent })),
    newVoucherType,
    skipped,
    total: round2(reimbTotal + vendorTotal),
    reimbursementTotal: reimbTotal,
    vendorTotal,
    vendorTdsTotal: round2(vOk.reduce((s, v) => s + Number(v.tdsAmount || 0), 0)),
    lines: ok,
    vendorLines: vOk,
  };
}

// ---------------------------------------------------------------------------
// Excel review sheet
// ---------------------------------------------------------------------------

/**
 * A review sheet, NOT the import path — see the module header.
 *
 * Ported from openpyxl to SheetJS: same sheets, same columns, same order,
 * same TOTAL formula, same column widths. Two cosmetic losses, because
 * SheetJS community edition cannot write them: the bold header font and the
 * frozen header row. Neither changes what a finance person reviews.
 *
 * Returns the workbook; the caller turns it into bytes (XLSX.write) or a
 * download — this module touches no filesystem.
 */
export function buildBatchExcel(
  lines: BatchLine[],
  newLedgers?: Array<{ name: string; parent: string }> | null,
): XLSX.WorkBook {
  const headers = [
    "Bill #", "Date", "Person (Credit)", "Expense Ledger (Debit)",
    "Amount", "Vendor", "Narration",
  ];
  const fmtDate = (d?: Date | null) => {
    const dt = d ?? new Date();
    return (
      `${String(dt.getDate()).padStart(2, "0")}-` +
      `${String(dt.getMonth() + 1).padStart(2, "0")}-` +
      `${dt.getFullYear()}`
    );
  };

  const rows: Array<Array<string | number>> = [headers];
  for (const ln of lines) {
    rows.push([
      ln.billId,
      fmtDate(ln.voucherDate),
      ln.person,
      ln.ledger,
      round2(Number(ln.amount)),
      ln.vendor ?? "",
      ln.narration ?? "",
    ]);
  }
  if (lines.length) {
    // openpyxl: TOTAL lands at max_row + 2, i.e. one blank row after the data.
    rows.push([]);
    rows.push(["", "", "", "TOTAL", 0]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (lines.length) {
    const totalRow = lines.length + 3; // 1 header + N data + 1 blank + this
    const sum = round2(lines.reduce((s, l) => s + Number(l.amount), 0));
    ws[`E${totalRow}`] = { t: "n", v: sum, f: `SUM(E2:E${lines.length + 1})` };
  }
  ws["!cols"] = [8, 12, 30, 38, 14, 26, 40].map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vouchers");

  if (newLedgers && newLedgers.length) {
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["Ledger the XML will create", "Under group"],
      ...newLedgers.map((nl) => [nl.name, nl.parent]),
    ]);
    ws2["!cols"] = [{ wch: 42 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws2, "New ledgers");
  }
  return wb;
}

/**
 * A unique reference for one export.
 *
 * Seconds AND a random suffix: two exports in the same clock minute is a
 * normal clerk workflow (person A at 14:12:05, person B at 14:12:40), and at
 * minute granularity the second one overwrote the first one's XML file on
 * disk before failing on the UNIQUE ref - leaving the books and the records
 * disagreeing about what was sent to Tally.
 */
export function batchFilename(prefix = "reimbursements"): string {
  const n = new Date();
  const p = (v: number, w = 2) => String(v).padStart(w, "0");
  const stamp =
    `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}` +
    `_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
  const suffix = Array.from({ length: 6 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
  return `${prefix}_${stamp}_${suffix}`;
}
