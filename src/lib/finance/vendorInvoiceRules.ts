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
