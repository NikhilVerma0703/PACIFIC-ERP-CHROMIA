"""
Tally integration.

There is no Tally REST API. TallyPrime runs an HTTP server that speaks XML
envelopes, by default on port 9000. Enable it on the Tally machine at:

    F1 (Help) -> Settings -> Advanced Configuration -> HTTP Server

Tally must be running with the target company open, and the port reachable from
this app.

WHAT GETS POSTED
----------------
This is a staff reimbursement workflow, so a voucher needs exactly three things:

    the expense ledger      (what it was spent on)
    the person              (who to reimburse)
    the amount              (how much)
    the date                (nice to have, defaults to today)

Everything else the pipeline extracts - GSTIN, invoice number, vendor, tax
breakdown - stays in the local database. It drives duplicate detection and the
learning loop; it never reaches Tally.

The default voucher is a JOURNAL:

    Dr   <expense ledger>     the cost lands in P&L
    Cr   <person's ledger>    the company now owes the person

Finance settles the payable later in a normal payment run. Switch
`tally.voucher_type` to "Payment" in config.yaml to credit cash/bank instead and
treat the reimbursement as already paid.

THE SIGN CONVENTION TRAP
------------------------
In Tally XML, a NEGATIVE amount is a DEBIT and a POSITIVE amount is a CREDIT,
and ISDEEMEDPOSITIVE must agree with the sign. Entries that do not sum to zero
are rejected, sometimes silently. build_voucher_xml asserts balance before it
returns, so a malformed voucher fails here with a clear message rather than in
Tally with an obscure one.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

import urllib.error
import urllib.request


@dataclass
class Reimbursement:
    """Everything needed to post one reimbursement."""
    expense_ledger: str
    person_ledger: str
    amount: float
    voucher_date: date | None = None
    narration: str = ""

    def validate(self) -> list[str]:
        errs = []
        if not self.expense_ledger.strip():
            errs.append("No expense ledger selected")
        if not self.person_ledger.strip():
            errs.append("No person selected for reimbursement")
        if self.amount is None or self.amount <= 0:
            errs.append(f"Amount must be greater than zero (got {self.amount})")
        if self.amount and self.amount > 10_000_000:
            errs.append(f"Amount {self.amount:,.2f} looks wrong - please check")
        return errs


def _tally_date(d: date | None) -> str:
    return (d or date.today()).strftime("%Y%m%d")


# Control characters that are illegal anywhere in XML 1.0. Tesseract emits
# \x0c (form feed) on multi-column receipts, and one of those in a vendor name
# reaching a narration makes the whole import file unparseable.
_XML_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _esc(s: str) -> str:
    """Escape for XML element content AND attribute values.

    Ledger names containing '&' are the single most common cause of rejected
    vouchers - 'Repairs & Maintenance' must be sent as 'Repairs &amp;
    Maintenance' or Tally cannot resolve the ledger.

    Quotes matter just as much: this output is interpolated into attributes
    (LEDGER NAME="...", VCHTYPE="..."), so an apostrophe or double quote in a
    ledger or person name - 'M/s O"Brien', "Prop's Travels" - would otherwise
    close the attribute early and corrupt the file.
    """
    return escape(_XML_ILLEGAL.sub(" ", str(s or "")),
                  {'"': "&quot;", "'": "&apos;"})


def build_voucher_xml(r: Reimbursement, company: str,
                      voucher_type: str = "Journal",
                      cash_ledger: str | None = None) -> str:
    """Build the IMPORTDATA envelope for one reimbursement."""
    errs = r.validate()
    if errs:
        raise ValueError("; ".join(errs))

    amount = round(float(r.amount), 2)
    credit_ledger = r.person_ledger
    if voucher_type.lower() == "payment":
        if not cash_ledger:
            raise ValueError(
                "Payment vouchers need tally.cash_ledger set in config.yaml"
            )
        credit_ledger = cash_ledger

    # Debit the expense (negative), credit the person (positive). They must
    # cancel exactly.
    entries = [
        (r.expense_ledger, "Yes", -amount),
        (credit_ledger, "No", amount),
    ]
    total = round(sum(a for _, _, a in entries), 2)
    if abs(total) > 0.005:
        raise ValueError(f"Voucher does not balance - entries sum to {total}")

    lines = []
    for ledger, deemed_positive, amt in entries:
        lines.append(
            "          <ALLLEDGERENTRIES.LIST>\n"
            f"            <LEDGERNAME>{_esc(ledger)}</LEDGERNAME>\n"
            f"            <ISDEEMEDPOSITIVE>{deemed_positive}</ISDEEMEDPOSITIVE>\n"
            f"            <AMOUNT>{amt:.2f}</AMOUNT>\n"
            "          </ALLLEDGERENTRIES.LIST>"
        )

    d = _tally_date(r.voucher_date)
    narration = r.narration or f"Reimbursement to {r.person_ledger}"

    return f"""<ENVELOPE>
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
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="{_esc(voucher_type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>{d}</DATE>
            <EFFECTIVEDATE>{d}</EFFECTIVEDATE>
            <VOUCHERTYPENAME>{_esc(voucher_type)}</VOUCHERTYPENAME>
            <NARRATION>{_esc(narration)}</NARRATION>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
{chr(10).join(lines)}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""


def build_ledger_master_xml(name: str, parent: str, company: str) -> str:
    """Create a ledger in Tally - used when a clerk requests a new expense head
    or a new person, and an approver signs it off."""
    return f"""<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{_esc(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="{_esc(name)}" ACTION="Create">
            <NAME>{_esc(name)}</NAME>
            <PARENT>{_esc(parent)}</PARENT>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""


def build_ledger_export_xml(company: str) -> str:
    """Request the full ledger list. Run nightly so ledgers created directly in
    Tally by accountants appear in the dashboard without a manual re-import."""
    return f"""<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>List of Accounts</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{_esc(company)}</SVCURRENTCOMPANY>
          <ACCOUNTTYPE>Ledgers</ACCOUNTTYPE>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>"""


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------
@dataclass
class TallyResponse:
    ok: bool
    message: str
    raw: str = ""
    voucher_no: str | None = None
    created: int = 0
    errors: int = 0


# Tally's own error text is terse and unhelpful to a finance clerk. These map
# the ones that actually occur to something actionable.
ERROR_HINTS = [
    (r"could not (?:find|set) ledger|unknown ledger|ledger.*does not exist",
     "Tally does not have a ledger with that exact name. Check spelling and "
     "spacing, or create the ledger in Tally first."),
    (r"no company|company.*not.*open|select company",
     "The company is not open in Tally. Open it and try again."),
    (r"voucher.*not.*balance|debit.*credit.*not.*equal",
     "The debit and credit amounts do not match."),
    (r"voucher type.*(?:not|unknown)",
     "That voucher type does not exist in Tally. Check tally.voucher_type in config.yaml."),
    (r"date.*period|period.*date",
     "The voucher date falls outside the current financial year in Tally."),
]


def _humanise(raw: str) -> str:
    low = raw.lower()
    for pattern, hint in ERROR_HINTS:
        if re.search(pattern, low):
            return hint
    m = re.search(r"<LINEERROR>(.*?)</LINEERROR>", raw, re.S | re.I)
    if m:
        return f"Tally rejected the voucher: {m.group(1).strip()}"
    return "Tally rejected the voucher. See the raw response for details."


def post_xml(xml: str, host: str = "localhost", port: int = 9000,
             timeout: int = 30) -> TallyResponse:
    """POST an envelope to Tally's HTTP gateway."""
    url = f"http://{host}:{port}"
    body = xml.encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "text/xml;charset=utf-8", "Content-Length": str(len(body))},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        return TallyResponse(
            False,
            f"Could not reach Tally at {url}. Check that Tally is running, the "
            f"HTTP server is enabled (F1 > Settings > Advanced Configuration), "
            f"and the machine is reachable. ({e.reason})",
        )
    except Exception as e:  # noqa: BLE001
        return TallyResponse(False, f"Unexpected error talking to Tally: {e}")

    created = int((re.search(r"<CREATED>(\d+)</CREATED>", raw) or [0, 0])[1] or 0)
    errors = int((re.search(r"<ERRORS>(\d+)</ERRORS>", raw) or [0, 0])[1] or 0)
    lasted = re.search(r"<LASTVCHID>(\d+)</LASTVCHID>", raw)

    if created > 0 and errors == 0:
        return TallyResponse(True, f"Posted to Tally ({created} voucher created)",
                             raw, lasted.group(1) if lasted else None, created, errors)
    return TallyResponse(False, _humanise(raw), raw, None, created, errors or 1)


def write_xml_file(xml: str, out_dir: str, name: str) -> str:
    """File-export mode: drop the XML in a watched folder for an accountant to
    import through Tally's Import Data screen.

    Recommended for the first month of a rollout. Nothing reaches the books
    without a person choosing to import it, which is the cheapest possible way
    to build trust in a new system.
    """
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    path = Path(out_dir) / f"{safe}.xml"
    path.write_text(xml, encoding="utf-8")
    return str(path)


# --------------------------------------------------------------------------
# Ledger sync
# --------------------------------------------------------------------------
def fetch_ledgers(company: str, host: str = "localhost",
                  port: int = 9000, timeout: int = 60) -> list[dict]:
    """Pull the live ledger list from Tally.

    The trial balance import is a bootstrap. This is the real source of truth,
    because accountants create ledgers directly in Tally and the dashboard must
    not offer names Tally will reject.
    """
    resp = post_xml(build_ledger_export_xml(company), host, port, timeout)
    if not resp.raw:
        return []
    out = []
    for m in re.finditer(r"<LEDGER[^>]*NAME=\"([^\"]+)\"[^>]*>(.*?)</LEDGER>",
                         resp.raw, re.S | re.I):
        name = m.group(1)
        block = m.group(2)
        parent = re.search(r"<PARENT>(.*?)</PARENT>", block, re.S | re.I)
        out.append({
            "name": _unescape(name),
            "parent": _unescape(parent.group(1)) if parent else "",
        })
    return out


def _unescape(s: str) -> str:
    # &amp; LAST: doing it first would turn "&amp;lt;" into a real "<" instead
    # of the literal "&lt;" Tally actually meant.
    return (s.replace("&lt;", "<").replace("&gt;", ">")
             .replace("&quot;", '"').replace("&apos;", "'")
             .replace("&amp;", "&"))


def build_day_book_xml(company: str, on_date: "date") -> str:
    """Request every voucher for one date - the raw material for checking
    whether a reimbursement already exists in Tally's books."""
    d = on_date.strftime("%Y%m%d")
    return f"""<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{_esc(company)}</SVCURRENTCOMPANY>
          <SVFROMDATE TYPE="Date">{d}</SVFROMDATE>
          <SVTODATE TYPE="Date">{d}</SVTODATE>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>"""


def parse_day_book(raw: str) -> list[dict]:
    """Voucher entries out of a Day Book export.

    Regex rather than an XML parser on purpose: Tally's export XML is not
    always well-formed (unescaped ampersands in narrations are routine), and a
    strict parser dies on exactly the vouchers we most need to see. Each
    voucher becomes {"vch_type", "date", "entries": [(ledger, amount), ...]}.
    """
    out = []
    for vm in re.finditer(r"<VOUCHER[^>]*>(.*?)</VOUCHER>", raw or "", re.S | re.I):
        block = vm.group(0)
        vt = re.search(r'VCHTYPE="([^"]*)"', block, re.I)
        dt = re.search(r"<DATE>(\d{8})</DATE>", block)
        entries = []
        for em in re.finditer(
                r"<(?:ALL)?LEDGERENTRIES\.LIST>(.*?)</(?:ALL)?LEDGERENTRIES\.LIST>",
                block, re.S | re.I):
            e = em.group(1)
            name = re.search(r"<LEDGERNAME>(.*?)</LEDGERNAME>", e, re.S | re.I)
            amt = re.search(r"<AMOUNT>(-?[\d.]+)</AMOUNT>", e, re.I)
            if name and amt:
                entries.append((_unescape(name.group(1).strip()),
                                float(amt.group(1))))
        out.append({
            "vch_type": _unescape(vt.group(1)) if vt else "",
            "date": dt.group(1) if dt else "",
            "entries": entries,
        })
    return out


def find_matching_vouchers(company: str, on_date: "date", person: str,
                           amount: float, host: str = "localhost",
                           port: int = 9000, tolerance: float = 1.0) -> int:
    """How many vouchers ALREADY IN TALLY credit this person with this amount
    on this date.

    This is the duplicate check the local database cannot do: it sees what
    accountants entered directly in Tally, outside this app entirely. Called
    right before posting, because that is the moment a duplicate becomes a
    duplicate payment. Errors count as zero matches - an unreachable Tally
    must not block posting, it just means the check could not run.
    """
    try:
        resp = post_xml(build_day_book_xml(company, on_date), host, port,
                        timeout=15)
        if not resp.raw:
            return 0
        person_l = person.strip().lower()
        hits = 0
        for v in parse_day_book(resp.raw):
            for ledger, amt in v["entries"]:
                if ledger.strip().lower() == person_l \
                        and abs(abs(amt) - abs(amount)) <= tolerance:
                    hits += 1
                    break
        return hits
    except Exception:
        return 0


def fetch_people(company: str, group: str, host: str = "localhost",
                 port: int = 9000) -> list[str]:
    """Ledgers under the nominated group - the staff who can be reimbursed.

    Sourcing the list from Tally rather than a local table means a posted
    voucher can never fail on an unknown person, which is the most common
    integration failure in this kind of tool.
    """
    return sorted(
        l["name"] for l in fetch_ledgers(company, host, port)
        if l["parent"].strip().lower() == group.strip().lower()
    )
