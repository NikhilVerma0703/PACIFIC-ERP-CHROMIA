// GST input-tax ledger selection for vendor invoices, ported from
// automation/app/gst.py.
//
// A reimbursement posts two lines: Dr expense, Cr person. A vendor invoice is
// four or five, because the tax is claimable input credit and has to land in
// its own ledger:
//
//     Dr  <expense head>          taxable value
//     Dr  INPUT CGST @ 9%         cgst
//     Dr  INPUT SGST @ 9%         sgst
//     Cr  <vendor>                invoice total
//
// WHY THIS IS AN INDEX AND NOT A LOOKUP TABLE
// PESPL's GST ledgers are not consistently named. All of these are real:
//
//     INPUT CGST @ 9%          INPUT CGST 14%           Input CGST @ 6%
//     INPUT CGST @ 2.5%        CGST @ 9% ON SERVICE     INPUT IGST @ 0.1% ON PURCHASE
//     CGST INPUT @ 9% - INELIGIBLE     INPUT CGST @ 2.5%- Ineligible
//     INPUT CGST @ 9% RCM
//
// Any template ("INPUT {tax} @ {rate}%") gets four of those wrong. So the index
// is built by READING the chart of accounts. If finance opens "INPUT IGST @ 12%"
// tomorrow it appears here on the next master refresh, with no code change.
//
// TWO TRAPS IN THE DATA, BOTH LOAD-BEARING
// 1. Parent group does not decide eligibility. "CGST INPUT @ 9% - INELIGIBLE"
//    sits under the parent "CGST INPUT" alongside the eligible ones. The NAME
//    decides; the group is only a fallback for names that say nothing.
// 2. (tax, rate, eligible) is not unique. 9% eligible CGST matches both
//    "INPUT CGST @ 9%" and "CGST @ 9% ON SERVICE", and nothing on the bill can
//    choose between them — it depends on whether the purchase was goods or a
//    service, which the reviewer knows and the parser does not.
//
// Hence `candidates()` returns a ranked list rather than one answer.

import type { Ledger } from "./ledgers";

// "@ 9%", "14%", "@ 2.5%", "@ 0.10%" — the rate is the only number followed by
// a percent sign. Tolerates the missing "@" and the missing space.
const RATE_RE = /(\d+(?:\.\d+)?)\s*%/;
const TAX_RE = /\b([CSI])GST\b/i;

// Groups that hold input tax. Output and the reconciliation buckets
// ("GST Adjustment", "Not in GSTR2B", "GST Credit Ledger") are deliberately
// excluded: they are month-end accounting, never a line on a purchase voucher.
const INPUT_GROUPS = new Set([
  "cgst input", "sgst input", "igst input", "gst ineligible", "input rcm",
]);

export interface GstLedger {
  /** Verbatim Tally spelling — what goes in the voucher. */
  name: string;
  /** "CGST" | "SGST" | "IGST" */
  tax: string;
  /** 9, 2.5, 18 … */
  rate: number;
  /** False for the s.17(5) blocked-credit ledgers. */
  eligible: boolean;
  /** Reverse charge. */
  rcm: boolean;
  parent: string;
}

/** "CGST @ 9% ON SERVICE" — a rate that applies to services only. */
export function isService(g: GstLedger): boolean {
  return g.name.toLowerCase().includes("service");
}

function decode(led: Ledger): GstLedger | null {
  const name = led.name;
  const parent = (led.parent ?? "").trim();
  if (!INPUT_GROUPS.has(parent.toLowerCase())) return null;

  const taxM = TAX_RE.exec(name);
  const rateM = RATE_RE.exec(name);
  // "Ineligible Input", "INPUT - GST Import Input" — real ledgers, but they
  // carry no rate, so they can never be picked by amount. They stay reachable
  // through free search in the UI.
  if (!taxM || !rateM) return null;

  const low = name.toLowerCase();
  return {
    name,
    tax: taxM[1].toUpperCase() + "GST",
    rate: Number(rateM[1]),
    // Name wins over group — see trap 1.
    eligible: !(low.includes("ineligible") || parent.toLowerCase() === "gst ineligible"),
    rcm: low.includes("rcm") || parent.toLowerCase() === "input rcm",
    parent,
  };
}

/** Decode the whole chart of accounts once, at load time. */
export function buildGstIndex(ledgers: readonly Ledger[]): GstLedger[] {
  const out: GstLedger[] = [];
  for (const l of ledgers) {
    const g = decode(l);
    if (g) out.push(g);
  }
  return out.sort((a, b) =>
    a.tax.localeCompare(b.tax) || a.rate - b.rate ||
    Number(a.eligible) - Number(b.eligible) || a.name.localeCompare(b.name));
}

const SLABS = [0.1, 0.25, 1.5, 2.5, 5.0, 6.0, 9.0, 12.0, 14.0, 18.0, 28.0];

/**
 * Rate implied by the bill itself, snapped to a real GST slab.
 *
 * Derived rather than read, because OCR reads amounts far more reliably than it
 * reads "9%" out of a tax table.
 *
 * The tolerance is RELATIVE (5% of the slab), not a flat window. A flat ±0.5
 * matched 0.7% to the 0.25% slab — nonsense, and the kind that books input
 * credit at the wrong rate. Scaling keeps generous rounding room on 9% and 18%
 * while staying tight on the sub-1% slabs, and is capped below the gap between
 * the closest pair (5 and 6) so no reading can match two slabs.
 *
 * Null when the ratio is near no slab. That is a real answer: an amount was
 * misread, or the invoice mixes rates, and a human must look. Snapping to the
 * nearest slab would hide exactly the bills that need one.
 */
export function inferRate(taxAmount: number | null | undefined,
                          taxable: number | null | undefined): number | null {
  if (!taxAmount || !taxable || taxable <= 0) return null;
  const pct = (Number(taxAmount) / Number(taxable)) * 100;
  for (const slab of SLABS) {
    if (Math.abs(pct - slab) <= Math.max(0.05, Math.min(0.45, slab * 0.05))) return slab;
  }
  return null;
}

/**
 * IGST or CGST+SGST, from the first two digits of each GSTIN.
 *
 * The state code is positions 1-2 and is the ONLY thing that decides this.
 * PESPL is 33 (Tamil Nadu); a vendor at 29 (Karnataka) charges IGST. Null when
 * the vendor GSTIN was not read, so the caller asks rather than assumes —
 * guessing books tax to the wrong head and surfaces months later in GSTR-2B.
 */
export function isInterstate(vendorGstin: string | null | undefined,
                             companyGstin: string): boolean | null {
  const v = (vendorGstin ?? "").trim();
  const c = (companyGstin ?? "").trim();
  if (v.length < 2 || c.length < 2) return null;
  if (!/^\d{2}/.test(v) || !/^\d{2}/.test(c)) return null;
  return v.slice(0, 2) !== c.slice(0, 2);
}

/**
 * Every ledger matching the decoded bill, best first.
 *
 * Ranked, not resolved — see trap 2. Ordering puts the plain
 * "INPUT <TAX> @ <rate>%" form first, because that is the general-purpose head
 * PESPL uses for the overwhelming majority of purchases; the narrower
 * service-specific one only leads when the caller says the line is a service.
 */
export function gstCandidates(
  index: readonly GstLedger[],
  tax: string,
  rate: number,
  eligible = true,
  rcm = false,
  preferService: boolean | null = null,
): GstLedger[] {
  const hits = index.filter((g) =>
    g.tax === tax.toUpperCase() && Math.abs(g.rate - rate) < 0.001 &&
    g.eligible === eligible && g.rcm === rcm);

  const rank = (g: GstLedger): [number, number, string] => {
    const serviceRank = preferService === null
      ? (isService(g) ? 1 : 0)
      : (isService(g) === Boolean(preferService) ? 0 : 1);
    const startsInput = g.name.trim().toLowerCase().startsWith("input") ? 0 : 1;
    return [serviceRank, startsInput, g.name];
  };

  return hits.sort((a, b) => {
    const [as, ai, an] = rank(a);
    const [bs, bi, bn] = rank(b);
    return as - bs || ai - bi || an.localeCompare(bn);
  });
}

/** What the chart of accounts can actually handle — so a missing slab is
 *  noticed before a bill needs it, not during a review. */
export function summariseGst(index: readonly GstLedger[]): {
  total: number;
  eligibleRates: Record<string, number[]>;
  ineligible: number;
  rcm: number;
} {
  const byTax: Record<string, Set<number>> = {};
  for (const g of index) {
    if (g.eligible && !g.rcm) (byTax[g.tax] ??= new Set()).add(g.rate);
  }
  const eligibleRates: Record<string, number[]> = {};
  for (const k of Object.keys(byTax).sort()) {
    eligibleRates[k] = [...byTax[k]].sort((a, b) => a - b);
  }
  return {
    total: index.length,
    eligibleRates,
    ineligible: index.filter((g) => !g.eligible).length,
    rcm: index.filter((g) => g.rcm).length,
  };
}

// ---------------------------------------------------------------------------
// The whole invoice at once - api.py:373 /vendor/suggest
//
// Everything above answers one question about one ledger. This answers the
// question the reviewer actually has: given the amounts somebody read off a
// bill, which heads should this voucher use, and what is still unknown?
//
// It lives HERE rather than beside the other API shapes because it is GST
// reasoning - it needs isInterstate, inferRate and gstCandidates - and because
// apiShapes.ts must stay free of value imports to remain unit-testable under
// `node --test` (see the note at the top of that file).
// ---------------------------------------------------------------------------

export interface VendorSuggestTaxLine {
  tax: string;
  rate: number;
  amount: number;
  ledger: string;
  alternatives: string[];
}

export interface VendorSuggestion {
  interstate: boolean | null;
  tax_lines: VendorSuggestTaxLine[];
  taxable: number;
  tax_total: number;
  invoice_total: number;
  needs_review: string[];
}

export interface VendorSuggestInput {
  taxable: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  vendorGstin?: string;
  companyGstin: string;
  eligible?: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Python's `f"{n:,.2f}"` - thousands separators and exactly two decimals. The
 *  messages below are read by a human against a paper bill, so the numbers have
 *  to look like the numbers on it. */
function money(n: number): string {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Turn a read invoice into proposed input-tax lines.
 *
 * A PICKER, not a resolver. Everything derivable from the bill is derived - the
 * rate from the amounts, IGST-vs-CGST/SGST from the two GSTINs - and everything
 * that is not comes back in `needs_review` as a specific thing to look at,
 * rather than as a plausible guess. The two that matter:
 *
 *   - the vendor GSTIN was not read, so IGST vs CGST+SGST is unknown. The state
 *     code is the ONLY thing that decides it.
 *   - the tax-over-taxable ratio is near no GST slab, which means an amount was
 *     misread or the invoice mixes rates. Snapping to the nearest slab would
 *     hide exactly the bills a human needs to see.
 */
export function vendorSuggestion(
  index: readonly GstLedger[],
  input: VendorSuggestInput,
): VendorSuggestion {
  const taxable = Number(input.taxable) || 0;
  const eligible = input.eligible !== false;
  const interstate = isInterstate(input.vendorGstin ?? "", input.companyGstin ?? "");

  const needs: string[] = [];
  if (interstate === null) {
    needs.push("Vendor GSTIN not read - confirm IGST or CGST+SGST");
  }

  const lines: VendorSuggestTaxLine[] = [];
  const add = (tax: string, amount: number): void => {
    const rate = inferRate(amount, taxable);
    if (rate === null) {
      const pct = taxable ? (amount / taxable) * 100 : 0;
      needs.push(
        `${tax} ${money(amount)} on ${money(taxable)} is ${pct.toFixed(2)}% - ` +
        "not a GST slab, please check the amounts",
      );
      return;
    }
    const cands = gstCandidates(index, tax, rate, eligible);
    if (!cands.length) {
      needs.push(
        `No ${eligible ? "" : "ineligible "}${tax} ledger at ${rate}% exists in Tally - ` +
        "finance must open that head first",
      );
      return;
    }
    lines.push({
      tax, rate, amount: round2(amount),
      ledger: cands[0].name,
      alternatives: cands.slice(1).map((c) => c.name),
    });
  };

  // IGST first so an inter-state bill reads top-down the way it is printed.
  const igst = Number(input.igst) || 0;
  const cgst = Number(input.cgst) || 0;
  const sgst = Number(input.sgst) || 0;
  if (igst > 0) add("IGST", igst);
  if (cgst > 0) add("CGST", cgst);
  if (sgst > 0) add("SGST", sgst);

  // The GSTIN and the printed tax heads disagreeing is either a misread GSTIN
  // or a vendor who has charged the wrong tax. Both are somebody's problem
  // before this invoice is booked, not after.
  if (interstate === true && (cgst || sgst)) {
    needs.push("Vendor is out of state but the bill shows CGST/SGST - check the invoice");
  }
  if (interstate === false && igst) {
    needs.push("Vendor is in-state but the bill shows IGST - check the invoice");
  }
  if (!lines.length && !needs.length) {
    needs.push("No tax read on this bill - confirm it is not exempt");
  }

  const taxTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  return {
    interstate,
    tax_lines: lines,
    taxable: round2(taxable),
    tax_total: taxTotal,
    invoice_total: round2(taxable + taxTotal),
    needs_review: needs,
  };
}
