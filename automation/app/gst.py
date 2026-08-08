"""
GST input-tax ledger selection for Agent 2 (vendor invoices).

Agent 1 posts two lines: Dr expense, Cr person. A vendor invoice is four or
five, because the tax is claimable input credit and has to land in its own
ledger:

    Dr  <expense head>          taxable value
    Dr  INPUT CGST @ 9%         cgst
    Dr  INPUT SGST @ 9%         sgst
    Cr  <vendor>                invoice total

WHY THIS IS AN INDEX AND NOT A LOOKUP TABLE
-------------------------------------------
PESPL's GST ledgers are not consistently named. All of these are real:

    INPUT CGST @ 9%          INPUT CGST 14%           Input CGST @ 6%
    INPUT CGST @ 2.5%        CGST @ 9% ON SERVICE     INPUT IGST @ 0.1% ON PURCHASE
    CGST INPUT @ 9% - INELIGIBLE     INPUT CGST @ 2.5%- Ineligible
    INPUT CGST @ 9% RCM

Any f-string template ("INPUT {tax} @ {rate}%") gets four of those wrong. So
the index is built by *reading the chart of accounts* and parsing what is
actually there. If finance adds "INPUT IGST @ 12%" tomorrow it appears here on
the next master refresh, with no code change.

TWO TRAPS IN THE DATA, BOTH LOAD-BEARING
----------------------------------------
1. Parent group does not decide eligibility. "CGST INPUT @ 9% - INELIGIBLE"
   sits under the parent "CGST INPUT" alongside the eligible ones. The NAME
   decides; the group is only a fallback for ledgers whose name says nothing.

2. (tax, rate, eligible) is not unique. Rate 9% eligible CGST matches both
   "INPUT CGST @ 9%" and "CGST @ 9% ON SERVICE". There is no way to choose
   between them from the bill alone - it depends on whether the purchase was
   goods or a service, which the reviewer knows and the parser does not.

Hence `candidates()` returns a ranked list rather than one answer, and the
reviewer confirms. That matches how eligibility is decided too: blocked credits
(food, staff welfare, motor vehicles) are a judgment call under s.17(5), not
something to infer from OCR text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .ledgers import Ledger

# "@ 9%", "14%", "@ 2.5%", "@ 0.10%" - the rate is the only number followed by
# a percent sign. Written to tolerate the missing "@" and the missing space.
_RATE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_TAX_RE = re.compile(r"\b([CSI])GST\b", re.I)

# Groups that hold input tax. Output and the reconciliation/adjustment buckets
# ("GST Adjustment", "Not in GSTR2B", "GST Credit Ledger") are deliberately
# excluded: they are month-end accounting, never a line on a purchase voucher.
_INPUT_GROUPS = {"cgst input", "sgst input", "igst input",
                 "gst ineligible", "input rcm"}


@dataclass(frozen=True)
class GstLedger:
    """One input-tax ledger, decoded."""
    name: str               # verbatim Tally spelling - what goes in the voucher
    tax: str                # "CGST" | "SGST" | "IGST"
    rate: float             # 9.0, 2.5, 18.0 ...
    eligible: bool          # False for the s.17(5) blocked-credit ledgers
    rcm: bool               # reverse charge
    parent: str

    @property
    def is_service(self) -> bool:
        """"CGST @ 9% ON SERVICE" - a rate that applies to services only."""
        return "service" in self.name.lower()


def _decode(led: Ledger) -> GstLedger | None:
    """One ledger -> GstLedger, or None if it is not an input-tax ledger."""
    name = led.name
    parent = (led.parent or "").strip()

    if parent.lower() not in _INPUT_GROUPS:
        return None

    tax_m = _TAX_RE.search(name)
    rate_m = _RATE_RE.search(name)
    if not tax_m or not rate_m:
        # "Ineligible Input", "INPUT - GST Import Input" - real ledgers, but
        # they carry no rate, so they can never be picked by amount. They stay
        # available through free search in the UI.
        return None

    low = name.lower()
    return GstLedger(
        name=name,
        tax=tax_m.group(1).upper() + "GST",
        rate=float(rate_m.group(1)),
        # Name wins over group - see trap 1 in the module docstring.
        eligible=not ("ineligible" in low or parent.lower() == "gst ineligible"),
        rcm="rcm" in low or parent.lower() == "input rcm",
        parent=parent,
    )


def build_index(ledgers: list[Ledger]) -> list[GstLedger]:
    """Decode the whole chart of accounts once, at load time."""
    out = [g for g in (_decode(l) for l in ledgers) if g is not None]
    return sorted(out, key=lambda g: (g.tax, g.rate, g.eligible, g.name))


def infer_rate(tax_amount: float | None, taxable: float | None) -> float | None:
    """Rate implied by the bill itself, snapped to a real GST slab.

    Derived rather than read, because OCR reads amounts far more reliably than
    it reads "9%" out of a tax table.

    The tolerance is RELATIVE (5% of the slab), not a flat window. A flat +-0.5
    matched 0.7% to the 0.25% slab - nonsense, and the kind of nonsense that
    books input credit at the wrong rate. Scaling it keeps generous rounding
    room on 9% and 18% while staying tight on the sub-1% slabs. It is also
    capped below the gap between the closest pair (5 and 6), so no reading can
    ever match two slabs.

    Returns None when the ratio is not near any slab. That is a real answer:
    the OCR misread an amount, or the invoice has mixed rates, and the reviewer
    must look. Snapping it to the nearest slab would hide exactly the bills
    that need a human.
    """
    if not tax_amount or not taxable or taxable <= 0:
        return None
    pct = (float(tax_amount) / float(taxable)) * 100.0
    for slab in (0.1, 0.25, 1.5, 2.5, 5.0, 6.0, 9.0, 12.0, 14.0, 18.0, 28.0):
        if abs(pct - slab) <= max(0.05, min(0.45, slab * 0.05)):
            return slab
    return None


def is_interstate(vendor_gstin: str | None, company_gstin: str) -> bool | None:
    """IGST or CGST+SGST, from the first two digits of each GSTIN.

    The state code is positions 1-2 of a GSTIN and is the *only* thing that
    decides this. PESPL is 33 (Tamil Nadu); a vendor at 29 (Karnataka) charges
    IGST. Returns None when the vendor GSTIN was not read, so the caller can
    ask rather than assume - guessing here books tax to the wrong head and the
    error surfaces months later in GSTR-2B reconciliation.
    """
    v = (vendor_gstin or "").strip()
    c = (company_gstin or "").strip()
    if len(v) < 2 or len(c) < 2 or not v[:2].isdigit() or not c[:2].isdigit():
        return None
    return v[:2] != c[:2]


def candidates(index: list[GstLedger], tax: str, rate: float,
               eligible: bool = True, rcm: bool = False,
               prefer_service: bool | None = None) -> list[GstLedger]:
    """Every ledger matching the decoded bill, best first.

    Ranked, not resolved: see trap 2. The caller shows these to the reviewer.
    Ordering puts the plain "INPUT <TAX> @ <rate>%" form first, because that is
    the general-purpose head PESPL uses for the overwhelming majority of
    purchases; the narrower service-specific one only leads when the caller
    says the line is a service.
    """
    hits = [g for g in index
            if g.tax == tax.upper() and abs(g.rate - rate) < 0.001
            and g.eligible is eligible and g.rcm is rcm]

    def rank(g: GstLedger) -> tuple:
        if prefer_service is None:
            service_rank = 1 if g.is_service else 0
        else:
            service_rank = 0 if g.is_service is bool(prefer_service) else 1
        # "INPUT CGST @ 9%" before "CGST @ 9% ON SERVICE" for the general case.
        starts_input = 0 if g.name.strip().lower().startswith("input") else 1
        return (service_rank, starts_input, g.name)

    return sorted(hits, key=rank)


def summarise(index: list[GstLedger]) -> dict:
    """What the chart of accounts can actually handle - shown at startup so a
    missing slab is noticed before a bill needs it, not during a review."""
    by_tax: dict[str, list[float]] = {}
    for g in index:
        if g.eligible and not g.rcm:
            by_tax.setdefault(g.tax, []).append(g.rate)
    return {
        "total": len(index),
        "eligible_rates": {k: sorted(set(v)) for k, v in sorted(by_tax.items())},
        "ineligible": sum(1 for g in index if not g.eligible),
        "rcm": sum(1 for g in index if g.rcm),
    }
