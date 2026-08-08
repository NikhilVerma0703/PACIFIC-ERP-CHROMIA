"""
TDS deduction heads for Agent 2 (vendor invoices).

WHERE TDS SITS IN THE VOUCHER
-----------------------------
TDS is withheld from what you pay the vendor, so it splits the credit side. A
professional invoice of 11,800 (10,000 + 18% GST) with 10% TDS on the taxable
value becomes:

    Dr  Professional Charges      10,000      the expense, at full value
    Dr  INPUT CGST @ 9%              900      input credit is on the FULL tax
    Dr  INPUT SGST @ 9%              900
    Cr  TDS Payable - Professional 1027    1,000
    Cr  <vendor>                          10,800      what they actually get

Two things people get wrong here and the code must not:

  - TDS is deducted on the TAXABLE value, not on the invoice total. Deducting
    on the gross over-withholds and the vendor will dispute it.
  - Input GST credit is claimed on the FULL tax charged, unaffected by TDS.
    Netting it down is a wrong ITC claim.

WHY THE REVIEWER PICKS THE HEAD
-------------------------------
The section depends on the *nature of the payment* - contractor, professional,
rent, commission - which is a contractual fact, not something visible on the
invoice. Worse, PESPL keeps several heads per section at different rates:
194C alone has 0.40%, 0.87%, 1%, 1.35% and 2% heads, because the rate turns on
whether the payee is an individual or a company and whether a lower-deduction
certificate applies. None of that is on the bill.

So this module indexes what exists and ranks sensible candidates; a human
chooses. Guessing a TDS section produces a wrong 26Q return, which is a
correction filed with the department, not a journal entry reversed quietly.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .ledgers import Ledger

# Every deduction head lives under this group in PESPL's chart of accounts.
# "TDS Paid" / "TDS Receivable" (current assets) and "Interest on TDS" are
# deliberately excluded - they are settlement and penalty, never a deduction on
# a purchase voucher.
_TDS_GROUP = "t d s account"

# "194C", "194J", "192B", "194Q". Tally's names carry both the current section
# and a legacy one ("1024 -(Old Sec.94C)"), so match the 19x form specifically
# rather than any number.
_SECTION_RE = re.compile(r"\b(19[24][A-Z]?)\b", re.I)
# Some heads carry only the pre-renumbering form: "(Old Sec.94C)" rather than
# "194C". Same section, one digit short. Without this the 0.87% contractor head
# indexes with no section at all and drops out of a section-filtered picker.
_OLD_SECTION_RE = re.compile(r"\b(9[24][A-Z])\b", re.I)
_RATE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")

# Nature of payment, as written in the ledger names.
_NATURES = ("contractors", "professional", "rent", "commission",
            "interest", "purchase", "salary")


@dataclass(frozen=True)
class TdsLedger:
    """One TDS deduction head, decoded."""
    name: str               # verbatim Tally spelling
    section: str            # "194C", "194J", "192B" ... or "" when unstated
    rate: float | None      # None for heads with no rate in the name
    nature: str             # "contractors", "professional" ... or ""
    parent: str


def _decode(led: Ledger) -> TdsLedger | None:
    parent = (led.parent or "").strip()
    if parent.lower() != _TDS_GROUP:
        return None

    name = led.name
    low = name.lower()

    sec = _SECTION_RE.search(name)
    if sec:
        section = sec.group(1).upper()
    else:
        old = _OLD_SECTION_RE.search(name)
        section = ("1" + old.group(1).upper()) if old else ""
    rate = _RATE_RE.search(name)
    nature = next((n for n in _NATURES if n in low), "")

    return TdsLedger(
        name=name,
        section=section,
        rate=float(rate.group(1)) if rate else None,
        nature=nature,
        parent=parent,
    )


def build_index(ledgers: list[Ledger]) -> list[TdsLedger]:
    out = [t for t in (_decode(l) for l in ledgers) if t is not None]
    return sorted(out, key=lambda t: (t.nature, t.section, t.rate or 0.0, t.name))


def candidates(index: list[TdsLedger], nature: str = "",
               section: str = "", rate: float | None = None) -> list[TdsLedger]:
    """Heads matching the reviewer's choices, narrowest first.

    Every filter is optional, because the reviewer may know only some of it -
    "it's a contractor" is common, "it's 194C at 1.35%" is not. An empty filter
    returns everything, which is the right behaviour for a picker.
    """
    hits = list(index)
    if nature:
        hits = [t for t in hits if t.nature == nature.strip().lower()]
    if section:
        hits = [t for t in hits if t.section == section.strip().upper()]
    if rate is not None:
        hits = [t for t in hits if t.rate is not None
                and abs(t.rate - float(rate)) < 0.001]
    # Lowest rate first: the common case is the standard slab, and the higher
    # heads exist for the no-PAN and company-payee exceptions.
    return sorted(hits, key=lambda t: (t.rate if t.rate is not None else 99.0,
                                       t.name))


def deduction(taxable: float, rate: float) -> float:
    """TDS amount on the taxable value, rounded to the rupee.

    Rounded, not truncated: the department's own utilities round, and a paise
    mismatch between the voucher and the 26Q return is a reconciliation item
    somebody has to chase.
    """
    return round(round(float(taxable), 2) * float(rate) / 100.0, 0)


def summarise(index: list[TdsLedger]) -> dict:
    by_nature: dict[str, list[float | None]] = {}
    for t in index:
        by_nature.setdefault(t.nature or "(unspecified)", []).append(t.rate)
    return {
        "total": len(index),
        "sections": sorted({t.section for t in index if t.section}),
        "rates_by_nature": {k: sorted(r for r in v if r is not None)
                            for k, v in sorted(by_nature.items())},
    }
