// The decisions and shapes the finance HTTP contract is made of, with the
// database taken out.
//
// WHY THIS FILE EXISTS
// --------------------
// automation/app/api.py is one file because FastAPI let it be: a route handler
// there could reach straight into `conn` and still be readable. The Next
// equivalent is a single catch-all handler, and everything worth pinning down
// in it - how a search ranks, what the export preview promises, how a query
// parameter that is not what the caller thought is handled - would be
// unreachable from a test if it lived inside that handler. So the parts that
// are pure functions of their inputs live here, and route.ts is left as
// dispatch plus Prisma.
//
// Nothing here imports prisma, fs or network - and nothing here imports another
// module's VALUES either. `node --test` reparses these files as ESM, which
// resolves relative specifiers strictly, so a `from "./gst"` would fail to
// resolve while `import type` is erased before Node ever sees it. That is why
// vendorSuggestion() lives in gst.ts rather than here: it needs three of that
// module's functions, and it is GST logic anyway.
// See tests/financeApiShapes.test.ts, and the same note in dedupe.ts.

import type { BuildBatchResult } from "./exportBatch";

// ---------------------------------------------------------------------------
// Query-parameter parsing
// ---------------------------------------------------------------------------

/**
 * A bounded integer from a query string.
 *
 * FastAPI coerced `limit: int = 50` and every handler then re-clamped with
 * `max(1, min(limit, N))`. A URLSearchParams value is always a string here, so
 * the coercion is ours as well - and "abc", "" and "-5" must all land on
 * something sane rather than on NaN, which compares false against every bound
 * and would silently take the `take:` clause out of the query.
 */
export function clampInt(raw: string | null | undefined, fallback: number, max: number, min = 1): number {
  const s = (raw ?? "").trim();
  // The empty test is not redundant: `Number("")` is 0, which is finite, so an
  // absent ?limit would clamp to `min` (1) instead of falling back to the
  // default - a bill list that returns one row and looks like an empty queue.
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

/** `?exported=true|false`. Absent means "don't filter" - a THIRD state, which
 *  is why this returns null rather than false. api.py's `exported: bool | None`
 *  made the same distinction: false means "only bills not yet exported". */
export function parseBoolParam(raw: string | null | undefined): boolean | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

/** `?status=review,manual_entry` -> ["review","manual_entry"]. */
export function parseStatuses(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * `{"bill_ids": [...]}` from an untrusted JSON body.
 *
 * api.py wrote `[int(i) for i in body.get("bill_ids") or []]`, which raises a
 * 500 on `["x"]`. Non-numeric entries are dropped here instead: the caller
 * checks for an empty list and answers 400, so a malformed id produces the same
 * "bill_ids is required" a missing one does rather than a stack trace.
 * De-duplicated because buildBatch reports a repeated id as "listed twice in
 * this batch", and a UI that sent the same id twice would see its own bill
 * skipped for a reason it cannot act on.
 */
export function parseBillIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Name search - people and ledgers
// ---------------------------------------------------------------------------

/**
 * Prefix matches first, then substring matches, each in the input's order.
 *
 * api.py's people() and ledgers() both do exactly this, and it is not
 * arbitrary: a clerk typing "vij" wants VIJAY before "SHRI RAVI VIJAYAN", and a
 * plain `includes` filter buries the obvious answer under the accidental ones.
 */
export function rankNames(names: readonly string[], q: string): string[] {
  const ql = q.trim().toLowerCase();
  if (!ql) return [...names];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const n of names) {
    const low = n.toLowerCase();
    if (low.startsWith(ql)) starts.push(n);
    else if (low.includes(ql)) contains.push(n);
  }
  return starts.concat(contains);
}

export interface PeopleResponse {
  people: string[];
  total: number;
  truncated: boolean;
}

/**
 * The claimant dropdown.
 *
 * `truncated` is the whole point of the shape. The ERP loads this list once and
 * filters it in the browser, so a name past the cap is not paginated - it is
 * unreachable, and the loss is alphabetical. api.py's own comment records how
 * that played out: "Veena  SK" became impossible to select while looking
 * exactly like a name that did not exist in Tally. The flag lets the UI say so.
 */
export function peopleResponse(names: readonly string[], q: string, limit: number): PeopleResponse {
  const ranked = rankNames(names, q);
  const capped = ranked.slice(0, limit);
  return { people: capped, total: ranked.length, truncated: capped.length < ranked.length };
}

// ---------------------------------------------------------------------------
// The two ledger fields
// ---------------------------------------------------------------------------

/**
 * WHICH of the two fields is asking - and nothing more than that.
 *
 * Both flows show exactly two ledger fields, `Ledger` and `Expense Ledger`, and
 * both draw on the SAME master (fin_ledger, ~2,500 rows). `kind` decides the
 * ORDER they are offered in and what the field shows before anyone types. It
 * must never decide what is reachable: a field that hides part of the master
 * looks, from the clerk's side, exactly like a missing import, and the fix they
 * reach for is to invent a duplicate ledger.
 *
 * "expense" is the default on purpose - it is what /ledgers did before the
 * parameter existed, so a caller that does not send one is unaffected.
 */
export type LedgerKind = "ledger" | "expense";

export function parseLedgerKind(raw: string | null | undefined): LedgerKind {
  return (raw ?? "").trim().toLowerCase() === "ledger" ? "ledger" : "expense";
}

export interface LedgerOptionsInput {
  kind: LedgerKind;
  /** The typed query. Empty means "what should this field open on?". */
  q: string;
  limit: number;
  /** Every name in the master. The ONLY thing that bounds reachability. */
  all: readonly string[];
  /** Expense heads, excludedRootGroups already applied. Ranking, not filtering. */
  expense: readonly string[];
  /** Claimants (isPerson). */
  people: readonly string[];
  /** Most-used first, from Tally's Journal Register. May name ledgers that are
   *  not in the master at all - see below. */
  popular?: readonly string[];
}

export interface LedgerOptions {
  ledgers: string[];
  source: string;
}

/**
 * Priority tiers, flattened. Earlier tiers win, duplicates are dropped, and
 * each tier is ranked internally (prefix before substring) by rankNames.
 *
 * Stopping once `limit` is reached is safe BECAUSE the tiers are strict
 * priority: nothing a later tier holds could outrank a name already taken.
 */
function tiered(tiers: readonly (readonly string[])[], q: string, limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tier of tiers) {
    for (const n of rankNames(tier, q)) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/**
 * What one ledger field offers, for a query or for no query at all.
 *
 * `all` is always the last tier, so every name in the master is reachable from
 * either field by typing it - which is the whole requirement. The tiers above
 * it only decide who leads:
 *
 *   Ledger         claimants, then the other parties (creditors, banks,
 *                  customers - everything that is not an expense head), then
 *                  the expense heads. This field names WHO the money moves to
 *                  or from: a claimant on a reimbursement, a supplier on a
 *                  purchase invoice.
 *   Expense Ledger the heads this company actually posts to, then the rest of
 *                  the expense heads, then everything else. Unchanged from what
 *                  /ledgers has always done, with the master appended.
 *
 * `popular` is filtered against the master, not trusted: fin_ledger_usage is
 * built from Tally's Journal Register and carries heads that were never
 * imported (insights() reports them as `missing_ledgers`). Offering one would
 * put a name in the picker that /confirm cannot canonicalise.
 */
export function ledgerOptions(i: LedgerOptionsInput): LedgerOptions {
  const q = i.q.trim();
  const inMaster = new Set(i.all);
  const keep = (names: readonly string[] | undefined) =>
    (names ?? []).filter((n) => inMaster.has(n));

  const expense = keep(i.expense);
  const isExpense = new Set(expense);

  const tiers: readonly string[][] = i.kind === "ledger"
    ? [keep(i.people), i.all.filter((n) => !isExpense.has(n)), [...i.all]]
    : [keep(i.popular).filter((n) => isExpense.has(n)), expense, [...i.all]];

  const source = q
    ? "search"
    : i.kind === "ledger"
      ? "claimants and parties"
      : tiers[0].length ? "most used" : "expense heads";

  return { ledgers: tiered(tiers, q, i.limit), source };
}

// ---------------------------------------------------------------------------
// Export preview - api.py:977 _consequences
// ---------------------------------------------------------------------------

export interface Consequences {
  requested: number;
  vouchers: number;
  total: number;
  reimbursement_vouchers: number;
  reimbursement_total: number;
  vendor_vouchers: number;
  vendor_total: number;
  vendor_tds_total: number;
  new_ledgers: Array<{ name: string; parent: string }>;
  new_voucher_type: string | null;
  skipped: Array<{ bill_id: number; reasons: string[] }>;
  voucher_numbers: Array<{
    bill_id: number;
    kind: "reimbursement" | "vendor";
    voucher_no: string;
    invoice_no?: string;
  }>;
}

/**
 * What the file will do to Tally, in plain terms, before anyone imports it.
 *
 * The reimbursement and vendor figures are reported SEPARATELY as well as
 * combined. Money owed to staff and money owed to suppliers net of TDS are
 * different obligations, and one merged number on the confirmation screen
 * reconciles against nothing anyone can check.
 *
 * `voucherNumberFor` is injected rather than imported so this stays a pure
 * function of its arguments: the reimbursement number embeds the financial
 * year, which is derived from the voucher date, and a test needs to be able to
 * pin that without freezing the clock.
 */
export function consequences(
  r: BuildBatchResult,
  requested: number,
  voucherNumberFor: (billId: number, date: Date | null | undefined) => string,
): Consequences {
  return {
    requested,
    vouchers: r.vouchers,
    total: r.total,
    reimbursement_vouchers: r.reimbursementVouchers,
    reimbursement_total: r.reimbursementTotal,
    vendor_vouchers: r.vendorVouchers,
    vendor_total: r.vendorTotal,
    vendor_tds_total: r.vendorTdsTotal,
    new_ledgers: r.newLedgers,
    new_voucher_type: r.newVoucherType,
    skipped: r.skipped.map((s) => ({ bill_id: s.billId, reasons: s.reasons })),
    voucher_numbers: [
      ...r.lines.map((l) => ({
        bill_id: l.billId,
        kind: "reimbursement" as const,
        voucher_no: (l.voucherNo || "").trim() || voucherNumberFor(l.billId, l.voucherDate),
      })),
      // A purchase voucher is numbered with the SUPPLIER's invoice number, so
      // the preview shows exactly the string that will appear in Tally - which
      // is also what their statement shows.
      ...r.vendorLines.map((v) => ({
        bill_id: v.billId,
        kind: "vendor" as const,
        invoice_no: v.invoiceNo,
        voucher_no: (v.voucherNo || "").trim() || v.invoiceNo,
      })),
    ],
  };
}

/** Shown next to the download link. Deliberately the exact keystrokes, because
 *  the person importing is not necessarily the person who exported. */
export const IMPORT_INSTRUCTIONS: readonly string[] = [
  "Copy the file into the Tally machine's import folder.",
  "In Tally: O: Import -> Transactions.",
  "Give the full path to the .xml and press Enter.",
  "Check the result reads Errors : 0, then mark this export as imported in the ERP.",
];

// ---------------------------------------------------------------------------
// Duplicate warnings
// ---------------------------------------------------------------------------

export interface DuplicateView {
  /** Both spellings, deliberately. See below. */
  bill_id: number;
  matched_bill_id: number;
  layer: string;
  score: number | null;
  detail: string | null;
  reasons: string[];
}

/**
 * A stored duplicate warning, as the review screen needs it.
 *
 * TWO DIVERGENCES FROM api.py, both to make the existing UI correct rather than
 * to change the contract:
 *
 *  1. `bill_id` is emitted alongside `matched_bill_id`. FinanceBills.tsx reads
 *     `d.bill_id` and renders "Looks like a duplicate of bill #undefined"
 *     against the Python engine, because api.py only ever sent
 *     `matched_bill_id`. Sending both fixes the screen without breaking a
 *     caller written to the documented name.
 *  2. `score` and `reasons` are parsed back out of `detail`. The SQLite table
 *     had its own `score` column; fin_duplicate does not, and the pipeline
 *     writes "87% - vendor and amount match, one day apart" into `detail`. The
 *     UI shows `d.reasons`, so the string is unpacked here rather than in the
 *     component, where a format change would be silently wrong.
 */
export function duplicateView(row: {
  matchId: number;
  kind: string;
  detail: string | null;
}): DuplicateView {
  const detail = row.detail ?? "";
  const m = /^\s*(\d+(?:\.\d+)?)%\s*-\s*(.*)$/s.exec(detail);
  return {
    bill_id: row.matchId,
    matched_bill_id: row.matchId,
    layer: row.kind,
    score: m ? Math.round(Number(m[1])) / 100 : null,
    detail: row.detail,
    reasons: (m ? m[2] : detail).split(",").map((s) => s.trim()).filter(Boolean),
  };
}
