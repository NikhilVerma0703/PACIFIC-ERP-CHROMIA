// What stops a vendor invoice being saved — the rule, on its own, with no React
// around it.
//
// Split out of VendorInvoicePanel for the reason shiftScoreMath is split out of
// shiftScore: this decides whether a bill can be booked, and a rule that decides
// that should be testable without mounting a component or opening a browser.
//
// It was verified once by a throwaway script that RE-IMPLEMENTED the same
// conditions. That proves the author's mental model and nothing about the code:
// the panel could drift a line and the script would still pass. The panel now
// imports this, so the tests and the screen cannot disagree.
//
// Pure: no fetch, no clock, no Prisma. Everything it judges is passed in.

export interface InvoiceState {
  vendorLedger: string;
  expenseLedger: string;
  invoiceNo: string;
  /** The taxable value as typed — a string, because the input is one. */
  taxable: number;
  /** How many input-tax lines the engine resolved from the amounts entered. */
  taxLineCount: number;
  /** The reviewer has stated this bill genuinely carries no GST. */
  noGst: boolean;
  /** Rupees, already computed from the rate. 0 when no TDS applies. */
  tdsAmount: number;
  tdsLedger: string;
  /** taxable + resolved tax, before TDS. */
  invoiceTotal: number;
}

/**
 * Everything preventing a save, in the order a reviewer meets it on screen.
 * Empty means the invoice can be booked.
 *
 * THE ZERO-GST RULE IS THE INTERESTING ONE. A bill with no GST is ordinary
 * business — an unregistered vendor, a composition dealer, an exempt supply —
 * and it used to be unsaveable, full stop. But "this bill has no GST" and "we
 * could not READ the GST" reach this function looking identical: both are
 * simply zero tax lines. Booking the second silently forfeits input credit the
 * company is entitled to reclaim, on a screen that said nothing.
 *
 * So zero tax is allowed, and the reviewer says which case it is. That is what
 * `noGst` carries. It is one tick, not a form — the least that can honestly
 * tell the two apart.
 */
export function invoiceBlockers(s: InvoiceState): string[] {
  const out: string[] = [];
  if (!s.vendorLedger.trim()) out.push("Pick the vendor ledger");
  if (!s.expenseLedger.trim()) out.push("Pick the expense head");
  if (!s.invoiceNo.trim()) out.push("Enter the vendor's invoice number");
  if (!(s.taxable > 0)) out.push("Enter the taxable value");
  if (!s.noGst && s.taxLineCount === 0) {
    out.push("No tax lines resolved — tick “No GST on this bill” if that is correct");
  }
  // TDS is independent of GST. A zero-GST bill with TDS is valid; a TDS amount
  // with nowhere to book it is not, whatever the GST says.
  if (s.tdsAmount > 0 && !s.tdsLedger.trim()) out.push("Pick the TDS head");
  // Withholding the whole invoice means the arithmetic is wrong somewhere; the
  // vendor would be paid nothing or less than nothing.
  if (s.tdsAmount > 0 && s.tdsAmount >= s.invoiceTotal) {
    out.push("TDS is not less than the invoice total");
  }
  return out;
}

/**
 * Which review advisories still apply.
 *
 * "No tax read on this bill - confirm it is not exempt" is ANSWERED once the
 * reviewer ticks the box, so it stops nagging — but every other warning (a
 * GSTIN that disagrees with the tax heads, an out-of-state vendor charging
 * CGST) survives, because ticking "no GST" says nothing about those.
 */
export function visibleAdvisories(needsReview: readonly string[], noGst: boolean): string[] {
  return noGst ? needsReview.filter((n) => !/no tax read/i.test(n)) : [...needsReview];
}

// ---------------------------------------------------------------------------
// What a confirmed vendor invoice puts back on the extraction row
// ---------------------------------------------------------------------------

/** The newest `fin_extraction` row for the bill, or null when it has none. */
export interface VendorMirrorExisting {
  invoiceDate: string | null;
  vendorName: string | null;
  vendorGstin: string | null;
}

/** The confirmed invoice, as `confirm-vendor` has already validated it. */
export interface VendorMirrorInput {
  invoiceNo: string;
  /** ISO YYYY-MM-DD, or "" when the reviewer left the date field empty. */
  date: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** taxable + EVERY confirmed tax line, rounded by the caller. Passed in
   *  rather than re-added from the three scalars above, which bucket only
   *  CGST/SGST/IGST and would quietly drop anything else the reviewer booked. */
  invoiceTotal: number;
  /** The confirmed expense head. */
  expense: string;
  narration: string;
  /** The confirmed vendor LEDGER - a Tally creditor account, not a read name. */
  vendor: string;
  /** Uppercased, or "" when the bill carries none. */
  gstin: string;
  existing: VendorMirrorExisting | null;
}

/** Column-for-column what to write to `fin_extraction`. */
export interface VendorMirror {
  invoiceNo: string;
  invoiceDate: string | null;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  netAmount: number;
  ledger: string;
  narration: string | null;
  editedByUser: boolean;
  vendorName: string | null;
  vendorGstin: string | null;
}

/**
 * The values a confirmed vendor invoice must leave on `fin_extraction`.
 *
 * WHY THIS EXISTS AT ALL. confirm-vendor used to write only fin_vendor_entry,
 * but every read surface in the UI - the Ready-for-Tally list (store.ts
 * billSummary), the review panel's seed (billDetail) and the past-export
 * amounts (exportDetail) - reads fin_extraction. So an approve that corrected
 * an OCR misread showed the misread straight back, and reopening the row
 * re-seeded the panel from it: a second confirm then replaced a correct vendor
 * entry with the stale one. The reimbursement path (pipeline.ts confirmBill)
 * has always mirrored its confirmed values across; this is the same move for
 * the vendor path.
 *
 * Two of the fields resolve in OPPOSITE directions, which is the whole reason
 * this is a tested function and not four lines inlined in a transaction:
 *
 *   invoiceDate  confirmed wins, stored kept when the field was left blank.
 *   vendorName   STORED wins. The name the OCR read is the dedupe business key
 *                and the vendor-memory key; overwriting it with the ledger the
 *                reviewer picked would re-point both at a different vendor.
 *                It is filled only when the extractor read nothing.
 *   vendorGstin  confirmed wins - the reviewer types it against the paper -
 *                falling back to the stored one, then null.
 *
 * Pure: no Prisma, no clock. The caller supplies the stored row.
 */
export function vendorExtractionMirror(i: VendorMirrorInput): VendorMirror {
  const ex = i.existing;
  return {
    invoiceNo: i.invoiceNo,
    // COALESCE(?, invoice_date): a blank date field must not erase a date the
    // extractor read correctly. Same rule as pipeline.ts confirmBill.
    invoiceDate: i.date || ex?.invoiceDate || null,
    taxableValue: i.taxable,
    cgst: i.cgst,
    sgst: i.sgst,
    igst: i.igst,
    netAmount: i.invoiceTotal,
    // The CONFIRMED expense head, so the list's ledger column and its
    // ledger_confirmed flag stop reporting the machine's mere suggestion.
    ledger: i.expense,
    narration: i.narration || null,
    editedByUser: true,
    vendorName: ex?.vendorName || i.vendor,
    vendorGstin: i.gstin || ex?.vendorGstin || null,
  };
}
