// TDS deduction heads for vendor invoices, ported from automation/app/tds.py.
//
// WHERE TDS SITS IN THE VOUCHER
// TDS is withheld from what you pay the vendor, so it splits the credit side. A
// professional invoice of 11,800 (10,000 + 18% GST) with 10% TDS on the taxable
// value becomes:
//
//     Dr  Professional Charges         10,000     the expense, at full value
//     Dr  INPUT CGST @ 9%                 900     input credit is on the FULL tax
//     Dr  INPUT SGST @ 9%                 900
//     Cr  TDS Payable - Professional    1,000
//     Cr  <vendor>                     10,800     what they actually get
//
// Two things people get wrong here and the code must not:
//   - TDS is deducted on the TAXABLE value, not the invoice total. Deducting on
//     the gross over-withholds and the vendor will dispute it.
//   - Input GST credit is claimed on the FULL tax charged, unaffected by TDS.
//     Netting it down is a wrong ITC claim.
//
// WHY THE REVIEWER PICKS THE HEAD
// The section depends on the nature of the payment — contractor, professional,
// rent, commission — which is a contractual fact, not something visible on the
// invoice. Worse, PESPL keeps several heads per section at different rates:
// 194C alone has 0.40%, 0.87%, 1%, 1.35% and 2% heads, because the rate turns on
// whether the payee is an individual or a company and whether a lower-deduction
// certificate applies. None of that is on the bill.
//
// So this module indexes what exists and ranks candidates; a human chooses.
// Guessing a section produces a wrong 26Q return — a correction filed with the
// department, not a journal entry reversed quietly.

import type { Ledger } from "./ledgers";

// Every deduction head lives under this group in PESPL's chart of accounts.
// "TDS Paid" / "TDS Receivable" (current assets) and "Interest on TDS" are
// deliberately excluded — settlement and penalty, never a purchase-voucher line.
const TDS_GROUP = "t d s account";

// "194C", "194J", "192B", "194Q". Tally's names carry both the current section
// and a legacy one ("1024 -(Old Sec.94C)"), so match the 19x form specifically
// rather than any number.
const SECTION_RE = /\b(19[24][A-Z]?)\b/i;
// Some heads carry only the pre-renumbering form: "(Old Sec.94C)" rather than
// "194C". Same section, one digit short. Without this the 0.87% contractor head
// indexes with no section at all and drops out of a section-filtered picker.
const OLD_SECTION_RE = /\b(9[24][A-Z])\b/i;
const RATE_RE = /(\d+(?:\.\d+)?)\s*%/;

const NATURES = ["contractors", "professional", "rent", "commission",
                 "interest", "purchase", "salary"] as const;

export interface TdsLedger {
  /** Verbatim Tally spelling. */
  name: string;
  /** "194C", "194J", "192B" … or "" when unstated. */
  section: string;
  /** Null for heads with no rate in the name. */
  rate: number | null;
  /** "contractors", "professional" … or "". */
  nature: string;
  parent: string;
}

/**
 * The section a head's name states, current form, or "" when it states none.
 *
 * Exported because the confirm-vendor route stores the section alongside the
 * chosen head: `fin_vendor_entry.tds_section` is what a 26Q reconciliation
 * groups by, and re-deriving it there with a second copy of these regexes is
 * how the two spellings of 194C would eventually disagree.
 */
export function sectionOf(name: string): string {
  const sec = SECTION_RE.exec(name);
  if (sec) return sec[1].toUpperCase();
  const old = OLD_SECTION_RE.exec(name);
  return old ? "1" + old[1].toUpperCase() : "";
}

function decode(led: Ledger): TdsLedger | null {
  const parent = (led.parent ?? "").trim();
  if (parent.toLowerCase() !== TDS_GROUP) return null;

  const name = led.name;
  const low = name.toLowerCase();

  const section = sectionOf(name);
  const rate = RATE_RE.exec(name);

  return {
    name,
    section,
    rate: rate ? Number(rate[1]) : null,
    nature: NATURES.find((n) => low.includes(n)) ?? "",
    parent,
  };
}

export function buildTdsIndex(ledgers: readonly Ledger[]): TdsLedger[] {
  const out: TdsLedger[] = [];
  for (const l of ledgers) {
    const t = decode(l);
    if (t) out.push(t);
  }
  return out.sort((a, b) =>
    a.nature.localeCompare(b.nature) || a.section.localeCompare(b.section) ||
    (a.rate ?? 0) - (b.rate ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Heads matching the reviewer's choices, narrowest first.
 *
 * Every filter is optional, because the reviewer may know only some of it —
 * "it's a contractor" is common, "it's 194C at 1.35%" is not. An empty filter
 * returns everything, which is the right behaviour for a picker.
 */
export function tdsCandidates(
  index: readonly TdsLedger[],
  opts: { nature?: string; section?: string; rate?: number | null } = {},
): TdsLedger[] {
  let hits = [...index];
  if (opts.nature) {
    const n = opts.nature.trim().toLowerCase();
    hits = hits.filter((t) => t.nature === n);
  }
  if (opts.section) {
    const s = opts.section.trim().toUpperCase();
    hits = hits.filter((t) => t.section === s);
  }
  if (opts.rate != null) {
    hits = hits.filter((t) => t.rate != null && Math.abs(t.rate - Number(opts.rate)) < 0.001);
  }
  // Lowest rate first: the common case is the standard slab, and the higher
  // heads exist for the no-PAN and company-payee exceptions.
  return hits.sort((a, b) =>
    (a.rate ?? 99) - (b.rate ?? 99) || a.name.localeCompare(b.name));
}

/**
 * TDS amount on the taxable value, rounded to the rupee.
 *
 * Rounded, not truncated: the department's own utilities round, and a paise
 * mismatch between the voucher and the 26Q return is a reconciliation item
 * somebody has to chase.
 */
export function tdsDeduction(taxable: number, rate: number): number {
  return Math.round((Math.round(Number(taxable) * 100) / 100) * Number(rate) / 100);
}

export function summariseTds(index: readonly TdsLedger[]): {
  total: number;
  sections: string[];
  ratesByNature: Record<string, number[]>;
} {
  const byNature: Record<string, number[]> = {};
  for (const t of index) {
    (byNature[t.nature || "(unspecified)"] ??= []).push(...(t.rate == null ? [] : [t.rate]));
  }
  const ratesByNature: Record<string, number[]> = {};
  for (const k of Object.keys(byNature).sort()) {
    ratesByNature[k] = [...byNature[k]].sort((a, b) => a - b);
  }
  return {
    total: index.length,
    sections: [...new Set(index.map((t) => t.section).filter(Boolean))].sort(),
    ratesByNature,
  };
}
