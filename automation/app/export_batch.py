"""
Batch export: N approved bills -> ONE file to import into Tally.

THE ORDERING RULE THAT MAKES THIS WORK
--------------------------------------
Tally imports a file top to bottom. A voucher referencing a ledger that does not
exist yet is rejected, and in a 100-voucher file one rejection can abort what
follows. So every new ledger is emitted FIRST, in its own TALLYMESSAGE block,
before any voucher. One file, one import, and ledgers that did not exist five
minutes ago are created and used in the same pass.

New ledgers come from two places:
  - an expense head a clerk typed that is not in the master
  - a person who has no ledger yet
Both are checked against the master parsed from Tally's own All Masters export,
so "new" means genuinely absent from Tally - not merely absent from a report.
That distinction matters: the Trial Balance report omitted 510 real ledgers, and
trusting it would have created 510 duplicates.

WHY XML IS THE IMPORT PATH AND EXCEL IS NOT
-------------------------------------------
Tally's Excel import cannot create masters - only vouchers, and only when every
ledger already exists. XML does both. Excel is still offered because finance
teams like to eyeball a sheet before importing, but it is a REVIEW artefact. The
UI says so, because importing the wrong one fails confusingly.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from .tally import _esc, _tally_date


@dataclass
class BatchLine:
    """One reimbursement in the batch."""
    bill_id: int
    person: str
    ledger: str
    amount: float
    voucher_date: date | None = None
    narration: str = ""
    vendor: str = ""
    voucher_no: str = ""

    def problems(self) -> list[str]:
        out = []
        if not (self.person or "").strip():
            out.append("no person")
        if not (self.ledger or "").strip():
            out.append("no ledger")
        try:
            if not self.amount or float(self.amount) <= 0:
                out.append("amount is zero or missing")
        except (TypeError, ValueError):
            out.append("amount is not a number")
        return out


def norm_key(n: str) -> str:
    """Case- and whitespace-insensitive ledger identity.

    Tally's own exports are inconsistent about double spaces
    ("Professional  Fees"), and creating a second ledger that differs only in
    whitespace is painful to unpick afterwards.
    """
    return re.sub(r"\s+", " ", n or "").strip().lower()


def fy_label(d: date | None) -> str:
    """Indian financial year label for a date: 30-Jul-2026 -> "26-27"."""
    d = d or date.today()
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def voucher_number(bill_id: int, d: date | None, prefix: str = "REIMB") -> str:
    """A unique, human-readable voucher number.

    WHY THIS EXISTS
    ---------------
    Omitting <VOUCHERNUMBER> made Tally stamp every imported voucher as "1" -
    verified on PESPL's own data, where ten test imports all came in as Vch No 1.
    A hundred reimbursements sharing one number is useless for audit and makes
    reversing a single wrong entry a manual hunt.

    The bill id is the uniqueness guarantee, and it points straight back at the
    scanned image in our own database, so any Tally line can be traced to a
    photograph without a lookup table. The FY segment matches how PESPL already
    numbers vouchers (MAA142946/26-27).
    """
    return f"{prefix}/{fy_label(d)}/{int(bill_id):05d}"


# Learned from PESPL's own exported Journal (data/SAMPLE_VOUCHER.xml). Three
# things that file corrected, each of which would have caused rejections or
# silently wrong data:
#
#  1. REPORTNAME must be "Vouchers", not "All Masters", when the payload
#     contains vouchers. Masters and vouchers cannot share one envelope.
#  2. The credited party carries <ISPARTYLEDGER>Yes</ISPARTYLEDGER> and a
#     <BILLALLOCATIONS.LIST> with BILLTYPE "New Ref". PESPL's party ledgers
#     have bill-wise tracking ON (the masters file has 2,861 BILLALLOCATIONS
#     blocks). Omitting it leaves the credit unallocated, which shows up later
#     as an unreconciled balance rather than an import error - the worst kind
#     of bug, because nobody notices for a month.
#  3. GST registration fields are stamped on the voucher. Harmless to include
#     and it matches what Tally itself writes, so the import behaves the same
#     as a manual entry.
#
# Everything in their export that is a Tally *default* (the ~90 ISxxx>No flags)
# is deliberately omitted: Tally fills defaults itself, and a shorter file is
# far easier for a human to inspect before importing.
def _voucher_block(line: BatchLine, voucher_type: str,
                   cash_ledger: str | None = None,
                   company_gstin: str = "", gst_registration: str = "",
                   gst_state: str = "", vch_prefix: str = "REIMB") -> str:
    amount = round(float(line.amount), 2)
    credit = line.person
    if voucher_type.lower() == "payment":
        if not cash_ledger:
            raise ValueError("Payment batches need tally.cash_ledger in config")
        credit = cash_ledger

    d = _tally_date(line.voucher_date)
    narration = line.narration or (
        f"Reimbursement to {line.person}"
        + (f" - {line.vendor}" if line.vendor else ""))

    # Bill reference for the party allocation. Tally requires a NAME; using the
    # bill id keeps it unique and traceable straight back to the scanned image.
    bill_ref = f"REIMB-{line.bill_id}"

    # Unique voucher number. Without it Tally numbers every imported voucher "1".
    vch_no = (line.voucher_no or "").strip() or voucher_number(
        line.bill_id, line.voucher_date, vch_prefix)

    gst_block = ""
    if company_gstin:
        gst_block = (
            f"\n      <GSTREGISTRATION TAXTYPE=\"GST\" "
            f"TAXREGISTRATION=\"{_esc(company_gstin)}\">"
            f"{_esc(gst_registration)}</GSTREGISTRATION>"
            f"\n      <CMPGSTIN>{_esc(company_gstin)}</CMPGSTIN>"
            f"\n      <CMPGSTREGISTRATIONTYPE>Regular</CMPGSTREGISTRATIONTYPE>"
            f"\n      <CMPGSTSTATE>{_esc(gst_state)}</CMPGSTSTATE>")

    # Negative = debit, positive = credit. The pair must sum to zero.
    return f"""    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="{_esc(voucher_type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>{d}</DATE>
      <EFFECTIVEDATE>{d}</EFFECTIVEDATE>
      <REFERENCEDATE>{d}</REFERENCEDATE>
      <VOUCHERTYPENAME>{_esc(voucher_type)}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>{_esc(vch_no)}</VOUCHERNUMBER>
      <REFERENCE>{_esc(vch_no)}</REFERENCE>
      <NARRATION>{_esc(narration)}</NARRATION>
      <PARTYLEDGERNAME>{_esc(credit)}</PARTYLEDGERNAME>{gst_block}
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <VCHENTRYMODE>As Voucher</VCHENTRYMODE>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>{_esc(line.ledger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>{-amount:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>{_esc(credit)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <AMOUNT>{amount:.2f}</AMOUNT>
       <BILLALLOCATIONS.LIST>
        <NAME>{_esc(bill_ref)}</NAME>
        <BILLTYPE>New Ref</BILLTYPE>
        <AMOUNT>{amount:.2f}</AMOUNT>
       </BILLALLOCATIONS.LIST>
      </ALLLEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>"""


def _voucher_type_block(name: str, parent: str = "Journal") -> str:
    """Create a dedicated voucher type for reimbursements.

    WHY A SEPARATE TYPE
    -------------------
    Three things it buys, none available on the plain Journal:

    1. PREVENTDUPLICATE. Tally refuses a second voucher with the same number, so
       importing the same file twice is REJECTED rather than duplicated. We
       proved that gap on live data: five imports of one test file produced ten
       vouchers and Tally never objected. Since a duplicate reaching the books
       becomes a duplicate payment, having the guard on Tally's side as well as
       ours is worth the one extra master.
    2. Its own number series, so our numbering can never be confused with a
       journal number a clerk types by hand.
    3. Reimbursements become filterable and reportable as a group - "show me
       every staff claim this quarter" is one Day Book filter.

    PARENT is Journal, so it behaves identically in the accounts: same Dr/Cr
    treatment, same reports, nothing new for an auditor to learn.
    """
    return f"""    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHERTYPE NAME="{_esc(name)}" ACTION="Create">
      <NAME>{_esc(name)}</NAME>
      <PARENT>{_esc(parent)}</PARENT>
      <NUMBERINGMETHOD>Manual</NUMBERINGMETHOD>
      <PREVENTDUPLICATE>Yes</PREVENTDUPLICATE>
      <ISOPTIONAL>No</ISOPTIONAL>
      <AFFECTSSTOCK>No</AFFECTSSTOCK>
      <USEFORPOSDINVOICE>No</USEFORPOSDINVOICE>
     </VOUCHERTYPE>
    </TALLYMESSAGE>"""


def _ledger_block(name: str, parent: str) -> str:
    return f"""    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <LEDGER NAME="{_esc(name)}" ACTION="Create">
      <NAME>{_esc(name)}</NAME>
      <PARENT>{_esc(parent)}</PARENT>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <OPENINGBALANCE>0</OPENINGBALANCE>
     </LEDGER>
    </TALLYMESSAGE>"""


def build_batch(lines: list[BatchLine], company: str,
                known_ledgers: set[str],
                voucher_type: str = "Journal",
                cash_ledger: str | None = None,
                new_expense_parent: str = "Indirect Expenses",
                new_person_parent: str = "Sundry Creditors",
                company_gstin: str = "", gst_registration: str = "",
                gst_state: str = "",
                create_voucher_type: bool = True,
                voucher_type_parent: str = "Journal",
                known_voucher_types: set[str] | None = None,
                voucher_no_prefix: str = "REIMB",
                already_exported: set[int] | None = None) -> dict:
    """Build one importable XML for the whole batch.

    Returns a dict with the xml plus exactly what it will do, so the UI can show
    a human the consequences before anyone imports anything:
        vouchers      how many will be created
        new_ledgers   which masters will be created, and under which group
        skipped       bills left out, with the reason
        total         rupee total of what IS included
    """
    # Identity is whitespace/case-insensitive, but Tally matches a voucher's
    # <LEDGERNAME> to a master BYTE FOR BYTE. So keep a canonical spelling per
    # identity and rewrite every line to it below - otherwise a bill typed
    # "Travelling  Expenses" (two spaces) is judged "already known", then emits
    # a voucher naming a ledger Tally cannot resolve, and the import fails.
    canonical: dict[str, str] = {}
    for n in sorted(known_ledgers):
        canonical.setdefault(norm_key(n), n.strip())
    exact = {n.strip() for n in known_ledgers}
    known = set(canonical)

    # THE EXPORT GUARD.
    # Because the batch posts under Tally's standard Journal, Tally cannot reject
    # a duplicate for us. So a bill that has already been in an exported file is
    # excluded here rather than sent a second time - and it is reported as
    # skipped, not dropped silently, so a human sees why.
    #
    # This does not stop someone re-importing an OLD file into Tally; nothing on
    # our side can. It stops the far likelier accident: a bill still sitting in
    # the approved list getting swept into tomorrow's batch as well.
    exported = {int(b) for b in (already_exported or set())}

    ok: list[BatchLine] = []
    skipped: list[dict] = []
    seen_ids: set[int] = set()
    for ln in lines:
        probs = ln.problems()
        if ln.bill_id in exported:
            probs.append("already exported to Tally in an earlier batch")
        if ln.bill_id in seen_ids:
            # Two lines for one bill would post it twice within a single file
            # and produce a duplicate voucher number.
            probs.append("listed twice in this batch")
        seen_ids.add(ln.bill_id)
        (skipped.append({"bill_id": ln.bill_id, "reasons": probs})
         if probs else ok.append(ln))

    # Collect new masters, keeping the first spelling seen.
    new_ledgers: list[tuple[str, str]] = []
    seen_new: set[str] = set()
    for ln in ok:
        for name, parent in ((ln.ledger, new_expense_parent),
                             (ln.person, new_person_parent)):
            k = norm_key(name)
            if k and k not in known and k not in seen_new:
                seen_new.add(k)
                canonical[k] = name.strip()
                new_ledgers.append((name.strip(), parent))

    # Every voucher now names either an existing Tally master or a ledger
    # created earlier in this same file, spelled identically.
    def _canon(s: str) -> str:
        s = (s or "").strip()
        # An exact byte-match wins: Tally may genuinely hold two ledgers that
        # differ only in whitespace, and we must not merge them.
        return s if s in exact else canonical.get(norm_key(s), s)

    for ln in ok:
        ln.ledger = _canon(ln.ledger)
        ln.person = _canon(ln.person)

    # ORDER MATTERS: voucher type, then ledgers, then vouchers. Tally reads the
    # file top to bottom, so anything a voucher refers to must already have been
    # created earlier in the same file.
    new_voucher_type: str | None = None
    if (create_voucher_type
            and voucher_type.lower() not in ("journal", "payment", "receipt",
                                             "contra", "sales", "purchase")
            and norm_key(voucher_type) not in {
                norm_key(v) for v in (known_voucher_types or set())}):
        new_voucher_type = voucher_type

    blocks = ([_voucher_type_block(new_voucher_type, voucher_type_parent)]
              if new_voucher_type else [])
    blocks += [_ledger_block(n, p) for n, p in new_ledgers]
    blocks += [_voucher_block(ln, voucher_type, cash_ledger, company_gstin,
                              gst_registration, gst_state, voucher_no_prefix)
               for ln in ok]
    # A Payment settles against the bank/cash ledger, so the party ledger on the
    # credit side is that account - the person is only the payee. Guard here so a
    # config change to voucher_type cannot silently mis-post.
    if voucher_type.lower() == "payment" and not cash_ledger:
        raise ValueError("Payment batches need tally.cash_ledger in config")

    # REPORTNAME "Vouchers" - copied from PESPL's own export. Tally uses this to
    # decide how to interpret the payload; "All Masters" with vouchers inside is
    # rejected.
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>{_esc(company)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
{chr(10).join(blocks)}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
"""
    return {
        "xml": xml,
        "vouchers": len(ok),
        "new_ledgers": [{"name": n, "parent": p} for n, p in new_ledgers],
        "new_voucher_type": new_voucher_type,
        "skipped": skipped,
        "total": round(sum(float(l.amount) for l in ok), 2),
        "lines": ok,
    }


def build_batch_excel(lines: list[BatchLine], path: str | Path,
                      new_ledgers: list[dict] | None = None) -> str:
    """A review sheet, NOT the import path. See the module docstring."""
    import openpyxl
    from openpyxl.styles import Font

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Vouchers"
    headers = ["Bill #", "Date", "Person (Credit)", "Expense Ledger (Debit)",
               "Amount", "Vendor", "Narration"]
    ws.append(headers)
    for c in range(1, len(headers) + 1):
        ws.cell(1, c).font = Font(bold=True)

    for ln in lines:
        ws.append([
            ln.bill_id,
            (ln.voucher_date or date.today()).strftime("%d-%m-%Y"),
            ln.person, ln.ledger, round(float(ln.amount), 2),
            ln.vendor, ln.narration,
        ])
    if lines:
        row = ws.max_row + 2
        ws.cell(row, 4, "TOTAL").font = Font(bold=True)
        ws.cell(row, 5, f"=SUM(E2:E{len(lines) + 1})").font = Font(bold=True)
    for col, width in zip("ABCDEFG", (8, 12, 30, 38, 14, 26, 40)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"

    if new_ledgers:
        ws2 = wb.create_sheet("New ledgers")
        ws2.append(["Ledger the XML will create", "Under group"])
        for c in (1, 2):
            ws2.cell(1, c).font = Font(bold=True)
        for nl in new_ledgers:
            ws2.append([nl["name"], nl["parent"]])
        ws2.column_dimensions["A"].width = 42
        ws2.column_dimensions["B"].width = 30

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(path))
    return str(path)


def batch_filename(prefix: str = "reimbursements") -> str:
    """A unique reference for one export.

    Seconds AND a random suffix: two exports in the same clock minute is a
    normal clerk workflow (person A at 14:12:05, person B at 14:12:40), and at
    minute granularity the second one overwrote the first one's XML file on
    disk before failing on the UNIQUE ref - leaving the books and the records
    disagreeing about what was sent to Tally.
    """
    return (f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            f"_{uuid.uuid4().hex[:6]}")
