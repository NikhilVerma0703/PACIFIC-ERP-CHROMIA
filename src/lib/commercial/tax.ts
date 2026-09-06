// GST on a Commercial invoice — PURE.
//
// The reference DTA invoice (JB Homes, Maharashtra 27) hard-codes IGST 18%
// with no state comparison. The rule it is an instance of:
//
//   EXPORT                              no GST — supply under LUT
//   DOMESTIC, buyer state ≠ supplier    IGST at the full rate
//   DOMESTIC, buyer state = supplier    CGST + SGST, each half the rate
//
// Tamil Nadu is 33. A domestic buyer with no state code on file falls to
// IGST, which is what the sheet did — the screen flags the missing code so
// somebody fills it in rather than the invoice silently guessing.
//
// Rounding: GST law expects the grand total on a whole rupee with the
// difference shown as a Round Off line; the reference sheet only rounded the
// DISPLAY (3,749,231.70 shown as 3,749,232 and worded as such). We do it
// properly: grandTotal is a whole rupee and roundOff carries the difference
// (±0.50 max), so the words and the figure agree.

export type TaxType = "IGST" | "CGST_SGST" | "NONE";

export interface TaxInput {
  subtotal: number;
  kind: "DOMESTIC" | "EXPORT";
  supplierStateCode: string;            // '33'
  buyerStateCode?: string | null;       // '27', or unknown
  igstRate: number;                     // 18
  cgstRate: number;                     // 9
  sgstRate: number;                     // 9
  /** DTA invoices round to a whole rupee; export invoices keep their decimals. */
  roundToWhole?: boolean;
}

export interface TaxResult {
  taxType: TaxType;
  taxRate: number;                      // total rate applied (18, or 0)
  igst: number;
  cgst: number;
  sgst: number;
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  /** Set when the rule had to fall back (no buyer state on a domestic sale). */
  warning: string | null;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function computeTax(input: TaxInput): TaxResult {
  const subtotal = r2(input.subtotal);
  let taxType: TaxType = "NONE";
  let warning: string | null = null;
  if (input.kind === "DOMESTIC") {
    const buyer = (input.buyerStateCode ?? "").trim();
    if (!buyer) { taxType = "IGST"; warning = "Buyer state code missing — IGST assumed"; }
    else taxType = buyer === input.supplierStateCode.trim() ? "CGST_SGST" : "IGST";
  }
  const igst = taxType === "IGST" ? r2(subtotal * input.igstRate / 100) : 0;
  const cgst = taxType === "CGST_SGST" ? r2(subtotal * input.cgstRate / 100) : 0;
  const sgst = taxType === "CGST_SGST" ? r2(subtotal * input.sgstRate / 100) : 0;
  const taxTotal = r2(igst + cgst + sgst);
  const taxRate = taxType === "IGST" ? input.igstRate : taxType === "CGST_SGST" ? input.cgstRate + input.sgstRate : 0;
  const raw = r2(subtotal + taxTotal);
  const roundToWhole = input.roundToWhole ?? input.kind === "DOMESTIC";
  const grandTotal = roundToWhole ? Math.round(raw) : raw;
  const roundOff = r2(grandTotal - raw);
  return { taxType, taxRate, igst, cgst, sgst, taxTotal, roundOff, grandTotal, warning };
}

/** The GST state code is the first two characters of a GSTIN. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const g = (gstin ?? "").trim();
  return /^\d{2}[A-Z0-9]{13}$/i.test(g) ? g.slice(0, 2) : null;
}

/** GSTIN shape check (15 chars: 2 digits, 10-char PAN, 1, Z, 1). Shape only —
 *  no checksum, so a typo in the last character passes; the point is to catch
 *  a PAN or a phone number pasted into the GSTIN box. */
export function looksLikeGstin(v: string | null | undefined): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test((v ?? "").trim());
}
