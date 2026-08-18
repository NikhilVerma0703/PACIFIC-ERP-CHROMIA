// Tally voucher XML — building and parsing, ported from automation/app/tally.py.
//
// There is no Tally REST API. TallyPrime speaks XML envelopes over its own HTTP
// gateway, and its Import Data screen reads the same envelopes from a file. The
// Python engine could POST straight to the gateway; this port deliberately
// keeps ONLY the XML layer — the web app runs on Vercel with no tunnel to the
// Tally machine, so vouchers leave as downloadable files an accountant imports.
// The transport (post_xml / fetch_ledgers / fetch_people HTTP) is NOT ported;
// the parsers for what that transport carried ARE, because a pasted or uploaded
// Tally response is parsed identically to a fetched one.
//
// WHAT GETS EXPORTED
// ------------------
// This is a staff reimbursement workflow, so a voucher needs exactly three
// things: the expense ledger (what it was spent on), the person (who to
// reimburse), the amount — plus a date, defaulting to today. Everything else
// the pipeline extracts (GSTIN, invoice number, vendor, tax breakdown) stays in
// the database; it drives duplicate detection and learning, it never reaches
// Tally.
//
// The default voucher is a JOURNAL:
//
//     Dr   <expense ledger>     the cost lands in P&L
//     Cr   <person's ledger>    the company now owes the person
//
// Finance settles the payable later in a normal payment run. A "Payment"
// voucher type credits cash/bank instead and treats the claim as already paid.
//
// THE SIGN CONVENTION TRAP
// ------------------------
// In Tally XML, a NEGATIVE amount is a DEBIT and a POSITIVE amount is a CREDIT,
// and ISDEEMEDPOSITIVE must agree with the sign. Entries that do not sum to
// zero are rejected, sometimes silently. buildVoucherXml asserts balance before
// it returns, so a malformed voucher fails here with a clear message rather
// than in Tally with an obscure one.
//
// This module is pure: no prisma, no fs, no network. Callers own storage and
// delivery. It is also self-contained (no imports from sibling modules) so
// `node --test` can load it directly — see the note in dedupe.ts.

export interface Reimbursement {
  expenseLedger: string;
  personLedger: string;
  amount: number;
  voucherDate?: Date | null;
  narration?: string;
}

export function validateReimbursement(r: Reimbursement): string[] {
  const errs: string[] = [];
  if (!r.expenseLedger.trim()) errs.push("No expense ledger selected");
  if (!r.personLedger.trim()) errs.push("No person selected for reimbursement");
  if (r.amount == null || r.amount <= 0) {
    errs.push(`Amount must be greater than zero (got ${r.amount})`);
  }
  if (r.amount && r.amount > 10_000_000) {
    const pretty = r.amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    errs.push(`Amount ${pretty} looks wrong - please check`);
  }
  return errs;
}

/** Tally's date wire format: yyyymmdd, local time (a clerk's "today" is the
 *  office's today, not UTC's). */
export function tallyDate(d?: Date | null): string {
  const dt = d ?? new Date();
  return (
    String(dt.getFullYear()) +
    String(dt.getMonth() + 1).padStart(2, "0") +
    String(dt.getDate()).padStart(2, "0")
  );
}

// Control characters that are illegal anywhere in XML 1.0. Tesseract emits
// \x0c (form feed) on multi-column receipts, and one of those in a vendor name
// reaching a narration makes the whole import file unparseable.
const XML_ILLEGAL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

/**
 * Escape for XML element content AND attribute values.
 *
 * Ledger names containing '&' are the single most common cause of rejected
 * vouchers - 'Repairs & Maintenance' must be sent as 'Repairs &amp;
 * Maintenance' or Tally cannot resolve the ledger.
 *
 * Quotes matter just as much: this output is interpolated into attributes
 * (LEDGER NAME="...", VCHTYPE="..."), so an apostrophe or double quote in a
 * ledger or person name - 'M/s O"Brien', "Prop's Travels" - would otherwise
 * close the attribute early and corrupt the file.
 *
 * & is replaced FIRST, or the other entities would be double-escaped.
 */
export function escXml(s: unknown): string {
  // Mirrors Python's `str(s or "")`: null, undefined, "", 0 all become "".
  const t = s ? String(s) : "";
  return t
    .replace(XML_ILLEGAL, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** round(x, 2). Python's round() is banker's (round-half-to-even); this is
 *  round-half-away. They differ only on exact half-cents, which real bill
 *  amounts (already 2dp from OCR) never produce. Not worth simulating. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the IMPORTDATA envelope for one reimbursement. */
export function buildVoucherXml(
  r: Reimbursement,
  company: string,
  voucherType = "Journal",
  cashLedger?: string | null,
): string {
  const errs = validateReimbursement(r);
  if (errs.length) throw new Error(errs.join("; "));

  const amount = round2(Number(r.amount));
  let creditLedger = r.personLedger;
  if (voucherType.toLowerCase() === "payment") {
    if (!cashLedger) {
      throw new Error("Payment vouchers need tally.cash_ledger set in config.yaml");
    }
    creditLedger = cashLedger;
  }

  // Debit the expense (negative), credit the person (positive). They must
  // cancel exactly.
  const entries: Array<[string, string, number]> = [
    [r.expenseLedger, "Yes", -amount],
    [creditLedger, "No", amount],
  ];
  const total = round2(entries.reduce((s, [, , a]) => s + a, 0));
  if (Math.abs(total) > 0.005) {
    throw new Error(`Voucher does not balance - entries sum to ${total}`);
  }

  const lines = entries.map(
    ([ledger, deemedPositive, amt]) =>
      "          <ALLLEDGERENTRIES.LIST>\n" +
      `            <LEDGERNAME>${escXml(ledger)}</LEDGERNAME>\n` +
      `            <ISDEEMEDPOSITIVE>${deemedPositive}</ISDEEMEDPOSITIVE>\n` +
      `            <AMOUNT>${amt.toFixed(2)}</AMOUNT>\n` +
      "          </ALLLEDGERENTRIES.LIST>",
  );

  const d = tallyDate(r.voucherDate);
  const narration = r.narration || `Reimbursement to ${r.personLedger}`;

  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escXml(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${escXml(voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${d}</DATE>
            <EFFECTIVEDATE>${d}</EFFECTIVEDATE>
            <VOUCHERTYPENAME>${escXml(voucherType)}</VOUCHERTYPENAME>
            <NARRATION>${escXml(narration)}</NARRATION>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
${lines.join("\n")}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/** Create a ledger in Tally - used when a clerk requests a new expense head
 *  or a new person, and an approver signs it off. */
export function buildLedgerMasterXml(name: string, parent: string, company: string): string {
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escXml(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${escXml(name)}" ACTION="Create">
            <NAME>${escXml(name)}</NAME>
            <PARENT>${escXml(parent)}</PARENT>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/** Request the full ledger list. In the Python engine this ran nightly so
 *  ledgers created directly in Tally by accountants appeared in the dashboard;
 *  here the same envelope is exported for an accountant to run by hand, and
 *  parseLedgerList reads what comes back. */
export function buildLedgerExportXml(company: string): string {
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>List of Accounts</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escXml(company)}</SVCURRENTCOMPANY>
          <ACCOUNTTYPE>Ledgers</ACCOUNTTYPE>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

// ---------------------------------------------------------------------------
// Response parsing. The HTTP POST itself is not ported (no route from Vercel
// to the Tally box), but the response body is worth parsing wherever it comes
// from — a manual gateway run, a saved file, a future relay.
// ---------------------------------------------------------------------------

export interface TallyResponse {
  ok: boolean;
  message: string;
  raw: string;
  voucherNo: string | null;
  created: number;
  errors: number;
}

// Tally's own error text is terse and unhelpful to a finance clerk. These map
// the ones that actually occur to something actionable. Patterns are matched
// against the LOWERCASED response.
export const ERROR_HINTS: Array<[RegExp, string]> = [
  [/could not (?:find|set) ledger|unknown ledger|ledger.*does not exist/,
   "Tally does not have a ledger with that exact name. Check spelling and " +
   "spacing, or create the ledger in Tally first."],
  [/no company|company.*not.*open|select company/,
   "The company is not open in Tally. Open it and try again."],
  [/voucher.*not.*balance|debit.*credit.*not.*equal/,
   "The debit and credit amounts do not match."],
  [/voucher type.*(?:not|unknown)/,
   "That voucher type does not exist in Tally. Check tally.voucher_type in config.yaml."],
  [/date.*period|period.*date/,
   "The voucher date falls outside the current financial year in Tally."],
];

export function humaniseTallyError(raw: string): string {
  const low = raw.toLowerCase();
  for (const [pattern, hint] of ERROR_HINTS) {
    if (pattern.test(low)) return hint;
  }
  const m = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/i.exec(raw);
  if (m) return `Tally rejected the voucher: ${m[1].trim()}`;
  return "Tally rejected the voucher. See the raw response for details.";
}

/** The success/failure judgement from post_xml, minus the POST: Tally reports
 *  <CREATED>/<ERRORS> counts and the last voucher id it assigned. Success is
 *  strictly "something created AND nothing errored" — a mixed response is a
 *  failure, because a half-imported batch needs a human, not a green tick. */
export function parseTallyResponse(raw: string): TallyResponse {
  const created = Number(/<CREATED>(\d+)<\/CREATED>/.exec(raw)?.[1] ?? 0);
  const errors = Number(/<ERRORS>(\d+)<\/ERRORS>/.exec(raw)?.[1] ?? 0);
  const lastVch = /<LASTVCHID>(\d+)<\/LASTVCHID>/.exec(raw);

  if (created > 0 && errors === 0) {
    return {
      ok: true,
      message: `Posted to Tally (${created} voucher created)`,
      raw,
      voucherNo: lastVch ? lastVch[1] : null,
      created,
      errors,
    };
  }
  return {
    ok: false,
    message: humaniseTallyError(raw),
    raw,
    voucherNo: null,
    created,
    errors: errors || 1,
  };
}

// &amp; LAST: doing it first would turn "&amp;lt;" into a real "<" instead
// of the literal "&lt;" Tally actually meant.
export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Ledger names and parents out of a List of Accounts export — the parsing
 *  half of the Python fetch_ledgers, which existed because accountants create
 *  ledgers directly in Tally and the dashboard must not offer names Tally
 *  will reject. */
export function parseLedgerList(raw: string): Array<{ name: string; parent: string }> {
  const out: Array<{ name: string; parent: string }> = [];
  for (const m of (raw || "").matchAll(/<LEDGER[^>]*NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
    const parent = /<PARENT>([\s\S]*?)<\/PARENT>/i.exec(m[2]);
    out.push({
      name: unescapeXml(m[1]),
      parent: parent ? unescapeXml(parent[1]) : "",
    });
  }
  return out;
}

/** Ledgers under the nominated group - the staff who can be reimbursed.
 *  Sourcing the list from Tally's own export rather than a local table means
 *  a voucher can never fail on an unknown person. (The fetch itself is the
 *  caller's problem; this is the filter from the Python fetch_people.) */
export function peopleUnderGroup(
  ledgers: Array<{ name: string; parent: string }>,
  group: string,
): string[] {
  const g = group.trim().toLowerCase();
  return ledgers
    .filter((l) => l.parent.trim().toLowerCase() === g)
    .map((l) => l.name)
    .sort();
}

/** Request every voucher for one date - the raw material for checking whether
 *  a reimbursement already exists in Tally's books. */
export function buildDayBookXml(company: string, onDate: Date): string {
  const d = tallyDate(onDate);
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escXml(company)}</SVCURRENTCOMPANY>
          <SVFROMDATE TYPE="Date">${d}</SVFROMDATE>
          <SVTODATE TYPE="Date">${d}</SVTODATE>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export interface DayBookVoucher {
  vchType: string;
  date: string;
  entries: Array<[ledger: string, amount: number]>;
}

/**
 * Voucher entries out of a Day Book export.
 *
 * Regex rather than an XML parser on purpose: Tally's export XML is not
 * always well-formed (unescaped ampersands in narrations are routine), and a
 * strict parser dies on exactly the vouchers we most need to see.
 */
export function parseDayBook(raw: string | null | undefined): DayBookVoucher[] {
  const out: DayBookVoucher[] = [];
  for (const vm of (raw || "").matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
    const block = vm[0];
    const vt = /VCHTYPE="([^"]*)"/i.exec(block);
    const dt = /<DATE>(\d{8})<\/DATE>/.exec(block);
    const entries: Array<[string, number]> = [];
    for (const em of block.matchAll(
      /<(?:ALL)?LEDGERENTRIES\.LIST>([\s\S]*?)<\/(?:ALL)?LEDGERENTRIES\.LIST>/gi,
    )) {
      const e = em[1];
      const name = /<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/i.exec(e);
      const amt = /<AMOUNT>(-?[\d.]+)<\/AMOUNT>/i.exec(e);
      if (name && amt) {
        entries.push([unescapeXml(name[1].trim()), Number(amt[1])]);
      }
    }
    out.push({
      vchType: vt ? unescapeXml(vt[1]) : "",
      date: dt ? dt[1] : "",
      entries,
    });
  }
  return out;
}

/** How many parsed Day Book vouchers credit this person with this amount —
 *  the comparison half of the Python find_matching_vouchers, which ran right
 *  before posting because that is the moment a duplicate becomes a duplicate
 *  payment. The caller supplies the parsed day book; an unavailable Tally is
 *  simply an empty list, and an empty list must not block posting. */
export function countMatchingVouchers(
  vouchers: DayBookVoucher[],
  person: string,
  amount: number,
  tolerance = 1.0,
): number {
  const p = person.trim().toLowerCase();
  let hits = 0;
  for (const v of vouchers) {
    for (const [ledger, amt] of v.entries) {
      if (ledger.trim().toLowerCase() === p && Math.abs(Math.abs(amt) - Math.abs(amount)) <= tolerance) {
        hits += 1;
        break;
      }
    }
  }
  return hits;
}
