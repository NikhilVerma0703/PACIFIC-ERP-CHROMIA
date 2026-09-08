// Money received against an order — the PURE half of
// /api/office/commercial/orders/[id]/receipts, run by
// tests/commercialReceipts.test.ts under node --test.
//
// Answer 29: record advance and CAD receipts. Answer 2: the ONE payment gate
// is at dispatch — the truck does not leave before the advance — so the first
// ADVANCE receipt on an order is a fact the pipeline reads (stages.canEnter),
// not a note in the margin. That is why the shape is validated here rather
// than trusted: a receipt typed as "5,000" or dated next week would either
// vanish in Decimal parsing or open dispatch on money that has not arrived.
//
// IMPORT-FREE, deliberately, so the test loads it bare.

export type ReceiptKind = "ADVANCE" | "CAD" | "BALANCE" | "OTHER";
export const RECEIPT_KINDS: readonly ReceiptKind[] = ["ADVANCE", "CAD", "BALANCE", "OTHER"];

export const RECEIPT_KIND_LABEL: Record<ReceiptKind, string> = {
  ADVANCE: "Advance",
  CAD: "CAD (documents against payment)",
  BALANCE: "Balance",
  OTHER: "Other",
};

/** What a validated receipt body carries into Prisma. */
export interface ReceiptInput {
  kind: ReceiptKind;
  amount: number;          // > 0, at most 2 dp
  currency: string;        // upper-cased; the order's when the body gives none
  receivedAt: string;      // YYYY-MM-DD, not after `today`
  mode: string | null;
  reference: string | null;
  notes: string | null;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const orNull = (v: unknown): string | null => { const x = s(v); return x ? x : null; };

/** The office's calendar date for an instant. The server clock is UTC and the
 *  office is at +05:30: a receipt entered at 02:00 IST on the 8th is dated the
 *  8th, not "tomorrow" — which is what a UTC comparison would have refused. */
export function todayIst(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD when the value is a real calendar date (an ISO instant's date
 *  part is accepted); null otherwise. 2026-02-30 is not a date. */
export function calendarDate(v: unknown): string | null {
  const m = s(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** A money figure as typed: thousands separators tolerated, at most 2 dp.
 *  Null when it is not a positive amount. A third decimal is refused rather
 *  than rounded — on a receipt it is far more often a slipped key than a
 *  fraction of a paisa, and the bank statement will not agree with a rounded
 *  figure either. */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const raw = typeof v === "number" ? String(v) : s(v).replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isReceiptKind(v: unknown): v is ReceiptKind {
  return typeof v === "string" && RECEIPT_KINDS.includes(v as ReceiptKind);
}

/**
 * The receipt a request body describes, or the one thing wrong with it.
 * `orderCurrency` fills a blank currency; `today` (YYYY-MM-DD, the office's
 * date) is the latest receivedAt accepted — money is recorded once it has
 * arrived, never in advance of itself.
 */
export function parseReceipt(body: unknown, ctx: { orderCurrency: string; today: string }): { ok: true; data: ReceiptInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = s(b.kind).toUpperCase();
  if (!isReceiptKind(kind)) return { ok: false, error: `Kind must be one of ${RECEIPT_KINDS.join(", ")}` };
  const amount = parseAmount(b.amount);
  if (amount === null) return { ok: false, error: "Amount must be more than zero, with at most 2 decimals" };
  const currency = (orNull(b.currency) ?? orNull(ctx.orderCurrency) ?? "").toUpperCase();
  if (!currency) return { ok: false, error: "Currency is required" };
  const receivedAt = calendarDate(b.receivedAt);
  if (!receivedAt) return { ok: false, error: "Received on must be a date (YYYY-MM-DD)" };
  if (receivedAt > ctx.today) return { ok: false, error: "Received on cannot be in the future" };
  return {
    ok: true,
    data: { kind, amount, currency, receivedAt, mode: orNull(b.mode), reference: orNull(b.reference), notes: orNull(b.notes) },
  };
}

/** The two statuses an order never leaves — the same line as
 *  stages.isTerminal, restated so this file stays import-free; the test
 *  cross-checks the two against every ORDER_STATUS. */
const TERMINAL_STATUSES: readonly string[] = ["CLOSED", "CANCELLED"];

/**
 * Whether money may still be recorded against an order in this status. A
 * closed or cancelled order is finished: a receipt on it would be a fact the
 * pipeline can never act on (there is no dispatch left to open — answer 2)
 * and a figure the month's reconciliation would have to explain. Anything
 * received against a finished order belongs on a live one, or in accounts.
 */
export function canRecordReceipt(status: string): { ok: true } | { ok: false; reason: string } {
  if (TERMINAL_STATUSES.includes(String(status).toUpperCase())) {
    return { ok: false, reason: "This order is closed or cancelled; receipts cannot be recorded on it" };
  }
  return { ok: true };
}

/** The dispatch gate's fact (answer 2): at least one ADVANCE receipt exists. */
export function advanceReceived(receipts: ReadonlyArray<{ kind: string }> | null | undefined): boolean {
  return Boolean(receipts?.some((r) => r.kind === "ADVANCE"));
}

/** Money as the receipts card and the log print it: 2 dp, grouped. */
export function fmtReceiptAmount(amount: number, currency: string): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** What the order log says about a receipt — the amount and the kind are the
 *  two things anyone reading it later wants without opening the row. */
export function receiptNote(r: { kind: string; amount: number; currency: string; receivedAt?: string | null; mode?: string | null; reference?: string | null }, verb: "recorded" | "deleted"): string {
  const kind = RECEIPT_KIND_LABEL[r.kind as ReceiptKind] ?? r.kind;
  const when = r.receivedAt ? ` received ${String(r.receivedAt).slice(0, 10)}` : "";
  const how = [orNull(r.mode), orNull(r.reference) ? `ref ${s(r.reference)}` : null].filter(Boolean).join(", ");
  return `${kind} receipt ${fmtReceiptAmount(r.amount, r.currency)} ${verb}${when}${how ? ` (${how})` : ""}`;
}

/** Totals per currency and kind for the card's footer. Currencies are never
 *  summed together — an order paid partly in USD and partly in INR shows two
 *  lines, not one meaningless number. */
export function receiptTotals(receipts: ReadonlyArray<{ kind: string; amount: number; currency: string }>): Array<{ currency: string; total: number; byKind: Partial<Record<ReceiptKind, number>> }> {
  const by = new Map<string, { total: number; byKind: Partial<Record<ReceiptKind, number>> }>();
  for (const r of receipts) {
    const cur = s(r.currency).toUpperCase() || "—";
    const row = by.get(cur) ?? { total: 0, byKind: {} };
    const amt = Number.isFinite(r.amount) ? r.amount : 0;
    row.total = Math.round((row.total + amt) * 100) / 100;
    const k = r.kind as ReceiptKind;
    row.byKind[k] = Math.round(((row.byKind[k] ?? 0) + amt) * 100) / 100;
    by.set(cur, row);
  }
  return Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([currency, v]) => ({ currency, ...v }));
}
