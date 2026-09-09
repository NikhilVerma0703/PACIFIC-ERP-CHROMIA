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

/**
 * Whether the advance may still be waived on an order in this status (answer
 * 12). The same line canRecordReceipt draws, for the same reason: a waiver is
 * permission for a truck that has not left, and on a closed or cancelled order
 * there is no truck left to let go — it would only be a stamp with somebody's
 * name on it against an order nobody can act on.
 */
export function canWaiveAdvance(status: string): { ok: true } | { ok: false; reason: string } {
  if (TERMINAL_STATUSES.includes(String(status).toUpperCase())) {
    return { ok: false, reason: "This order is closed or cancelled; the advance cannot be waived on it" };
  }
  return { ok: true };
}

// The dispatch gate's fact used to be "at least one ADVANCE receipt exists".
// Round two, answer 11 replaced that boolean with a figure: see advanceStatus
// at the foot of this file. Nothing asks the old question any more.

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

// ────────────────────── how much advance opens dispatch ──────────────────────
// Round two, answer 11: "it must reach the PI's advance percentage". The gate
// is no longer "is there an ADVANCE receipt" but "has the share of the order
// the customer agreed to pay up front actually arrived". Answer 12 sits beside
// it: the manager may waive the whole test, with a reason, and the truck goes.
//
// Everything below is pure so tests/commercialReceipts.test.ts runs the same
// arithmetic the dispatch route refuses with and the receipts card prints.

/** Fail-closed percentage when neither the order nor the settings could give
 *  one: ask for the whole amount rather than none. Every real caller resolves
 *  the figure with effectiveAdvancePct first; this is the last resort. */
export const ADVANCE_PCT_FALLBACK = 100;

/** A Decimal from Prisma, a string from JSON, or a number → a number; null
 *  when it is none of those. The order total and the receipt amounts reach
 *  this file from both sides of the wire. */
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    const n = (v as { toNumber(): number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Money compared as whole cents — 0.1 + 0.2 must not leave a truck standing. */
const cents = (n: number): number => Math.round(n * 100);
const cur = (v: unknown): string => s(v).toUpperCase();

/** A percentage between 0 and 100, or null. Anything outside that range is a
 *  typo, not a percentage, and is refused rather than clamped. */
export function pctOf(v: unknown): number | null {
  const n = money(v);
  if (n === null || n < 0 || n > 100) return null;
  return n;
}

/** "30%", "33.5%" — trailing zeros trimmed, because the PI writes it that way. */
export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Number(n.toFixed(2))}%`;
}

/**
 * The percentage this order asks for (answer 11): its own `advancePct` when it
 * has one, else the settings default for its kind — 100 domestic, 30 export as
 * shipped (`dispatch.advancePctDomestic` / `advancePctExport`). A blank on the
 * order means "the usual", never "none": 0 is a real answer and is kept.
 */
export function effectiveAdvancePct(
  orderPct: unknown,
  kind: string,
  defaults: { domestic?: unknown; export?: unknown } | null | undefined,
): number {
  const own = pctOf(orderPct);
  if (own !== null) return own;
  const fallback = pctOf(cur(kind) === "EXPORT" ? defaults?.export : defaults?.domestic);
  return fallback === null ? ADVANCE_PCT_FALLBACK : fallback;
}

/** The desk a change to the advance belongs to, named in every refusal so the
 *  clerk reading it knows whom to ask (answers 11 and 12). */
export const ADVANCE_WAIVER_DESK =
  "Only the Commercial Manager or an admin may do that — or waive the advance on the receipts card, which asks for a reason in writing and is logged.";

/**
 * May a write-level login make this change to the advance percentage, or does
 * it take the waiver's own desk (answer 12)?
 *
 * WHY THIS EXISTS: 0% is settled outright in advanceStatus — a real answer for
 * an order that genuinely asks for nothing (answer 11). That makes typing 0
 * into the header box the same act as waiving the advance, and lowering 100 to
 * 10 most of the way there: the truck leaves on money that has not arrived.
 * Done through the waiver route it costs a reason, a stamp and a log line and
 * is the Commercial Manager's; done through the header box it used to cost
 * nothing and leave nothing behind. So a change that LOWERS the gate takes the
 * cancel action, exactly as the waiver does, and everything that raises it (or
 * leaves it alone) stays an ordinary edit.
 *
 * Both figures are the percentages actually IN FORCE — the caller resolves the
 * order's own value and the settings default through effectiveAdvancePct first
 * — so clearing the box back to a lower default is caught too, and so is the
 * kind change that swaps one default for a lower one.
 */
export function advancePctChange(current: unknown, next: unknown): { ok: true } | { ok: false; reason: string } {
  const from = pctOf(current) ?? ADVANCE_PCT_FALLBACK;
  const to = pctOf(next) ?? ADVANCE_PCT_FALLBACK;
  // Compared in hundredths, the way money is: 30.001 is not a lowering of 30.
  if (Math.round(to * 100) >= Math.round(from * 100)) return { ok: true };
  if (to === 0) {
    return {
      ok: false,
      reason: `Setting the advance to 0% asks for no money before dispatch at all — that is a waiver of the ${fmtPct(from)} this order asks for, without the reason a waiver carries. ${ADVANCE_WAIVER_DESK}`,
    };
  }
  return {
    ok: false,
    reason: `Lowering the advance from ${fmtPct(from)} to ${fmtPct(to)} opens dispatch on money that has not arrived, the way a waiver does. ${ADVANCE_WAIVER_DESK}`,
  };
}

export interface AdvanceReceiptLike {
  kind: string;
  amount: unknown;
  currency: string;
}

/** The order's currency as everything below compares it: upper case, and "—"
 *  when the order has none, so a receipt typed with a blank currency is not
 *  quietly counted against an order that has none either. */
const orderCur = (v: unknown): string => cur(v) || "—";

// ───────────── the rate that makes a foreign receipt count ──────────────────
// Round three, answer 10: "add exchange rate per invoice, manual." The rate is
// not decoration. It REPLACES round two's answer 13 reading — "same currency
// only" — so an INR receipt against a USD export PI now counts toward the
// advance, converted through the rate the order's live invoice carries.
//
// THE DIRECTION, ONCE, IN WORDS: `rate` is RUPEES PER ONE UNIT OF THE INVOICE
// CURRENCY. USD 1 = INR 88.4200 is a rate of 88.42 on an invoice whose currency
// is USD. That is how the desk types it and how the export invoice prints it
// ("Exchange Rate : 88.42"), so nothing is inverted on the way in and nobody
// has to remember which way round the box means. Everything follows:
//
//     order in rupees, receipt in the invoice's currency   →  amount × rate
//     order in the invoice's currency, receipt in rupees   →  amount ÷ rate
//
// Any OTHER pair — two foreign currencies, or a receipt in a third currency —
// is not convertible from one rate and is refused rather than guessed. A truck
// must not leave on a number nobody typed.

/** The currency an invoice's exchange rate is quoted INTO (answer 10). */
export const RUPEES = "INR";

/** The rate on the order's live invoice, as everything below reads it. */
export interface AdvanceRate {
  /** Rupees per ONE unit of `currency`. */
  rate: number;
  /** The INVOICE's currency — the unit the rate is quoted per. */
  currency: string;
  /** `exchangeRateAt`: when the rate was typed. A rate with no date still
   *  converts; the screens say it was never stamped. */
  at?: string | null;
  /** The invoice it was read off, so a refusal or a conversion can name it. */
  invoiceNumber?: string | null;
}

/**
 * A rate that can actually convert something, normalised, or null. A rate of
 * zero or less converts nothing (and would divide by zero the other way), and
 * "rupees per rupee" says nothing at all — both are a half-filled box, not an
 * agreed figure.
 */
export function usableRate(r: AdvanceRate | null | undefined): AdvanceRate | null {
  if (!r) return null;
  const n = money(r.rate);
  const c = cur(r.currency);
  if (n === null || n <= 0 || !c || c === RUPEES) return null;
  return { ...r, rate: n, currency: c };
}

/**
 * A rate IS on file, and it is quoted per RUPEE — the invoice itself is priced
 * in INR, so "rupees per rupee" converts nothing (answer 10 quotes the rate per
 * one unit of the invoice's currency).
 *
 * WHY THIS IS ITS OWN QUESTION: usableRate answers null for this and for an
 * invoice whose rate box was never filled, and the two send the clerk to
 * DIFFERENT places. "Type the rate on the invoice" is followable when there is
 * no rate; said to a manager who has already typed one it is a refusal he can
 * only obey by retyping the same figure and getting the same answer. The rate
 * box is refused on a rupee invoice for exactly this reason
 * (invoice-rules.exchangeRateRefusal), and the sentence below says so.
 */
export function ratePerRupees(r: AdvanceRate | null | undefined): boolean {
  if (!r) return false;
  const n = money(r.rate);
  return n !== null && n > 0 && cur(r.currency) === RUPEES;
}

/** "INR 88.42 per USD" — the rate as every refusal and every note prints it. */
export function fmtRate(r: AdvanceRate): string {
  return `${RUPEES} ${Number(r.rate.toFixed(4))} per ${cur(r.currency)}`;
}

/** Where the rate came from, for the sentence that names it. */
function rateSource(r: AdvanceRate): string {
  return r.invoiceNumber ? `invoice ${r.invoiceNumber}` : "the order's invoice";
}

/**
 * `amount` of `from` expressed in `to` through ONE invoice rate, or null when
 * this is not the pair that rate is about. Same currency both sides is the
 * trivial conversion and needs no rate at all.
 */
export function convertThroughRate(amount: number, from: string, to: string, rate: AdvanceRate | null | undefined): number | null {
  const f = cur(from), t = cur(to);
  const n = money(amount);
  if (!f || !t || n === null) return null;
  if (f === t) return round2(n);
  const r = usableRate(rate);
  if (!r) return null;
  if (t === RUPEES && f === r.currency) return round2(n * r.rate);
  if (f === RUPEES && t === r.currency) return round2(n / r.rate);
  return null;
}

/** One receipt, weighed against the advance. */
export interface AdvanceReceiptCheck {
  counted: boolean;
  /** What it adds to the advance, IN THE ORDER'S CURRENCY. 0 when nothing. */
  amount: number;
  /** How it got there: in the order's own currency, or through the rate. */
  via: "direct" | "converted" | null;
  /** The conversion in words when it counted through a rate, and the refusal —
   *  naming the currency and the rate that is missing — when it did not. Null
   *  for a receipt that simply arrived in the order's own currency, and for
   *  money that is not an advance at all. */
  reason: string | null;
}

/**
 * Does this receipt add to the advance the gate measures (answers 11 and 10)?
 * An ADVANCE receipt in the ORDER's own currency, compared case-blind — "usd"
 * and "USD" are one currency — or one the invoice's rate can convert into it.
 *
 * Exported because the receipts card prints exactly this, receipt by receipt:
 * the screen's "not counted" note and advanceStatus's arithmetic have to be the
 * SAME question, or the card says a receipt counts while the truck stands.
 */
export function advanceReceiptCheck(
  r: { kind: string; amount?: unknown; currency: string },
  ctx: { orderCurrency: string; rate?: AdvanceRate | null },
): AdvanceReceiptCheck {
  const none: AdvanceReceiptCheck = { counted: false, amount: 0, via: null, reason: null };
  if (cur(r.kind) !== "ADVANCE") return none;
  const to = orderCur(ctx.orderCurrency);
  const from = cur(r.currency) || "—";
  const amount = money(r.amount) ?? 0;
  if (from === to) {
    // An order with no currency has nothing to count money in, so a receipt
    // with no currency does not quietly count against it: orderCur makes both
    // "—", and "—" is refused here rather than matched.
    if (to === "—") return { ...none, reason: `This order has no currency, so nothing can be counted toward its advance.` };
    return { counted: true, amount: round2(amount), via: "direct", reason: null };
  }
  const rate = usableRate(ctx.rate);
  if (!rate) {
    // The rate is there but quoted per rupee (the invoice is priced in INR):
    // saying "no exchange rate is set" would be contradicted by the invoice
    // screen sitting beside this card, and the move it asks for — type the rate
    // — is one the clerk has already made and the invoice screen refuses.
    if (ratePerRupees(ctx.rate)) {
      return {
        ...none,
        reason: `${fmtReceiptAmount(amount, from)} is not the order's currency (${to}), and ${rateSource(ctx.rate!)} is itself priced in ${RUPEES} — a rate quoted per rupee converts nothing. Record the money in ${to}, raise the invoice in the currency the money arrived in, or waive the advance.`,
      };
    }
    return {
      ...none,
      reason: `${fmtReceiptAmount(amount, from)} is not the order's currency (${to}) and no exchange rate is set on the order's invoice — type the rate on the invoice, record the money in ${to}, or waive the advance.`,
    };
  }
  const converted = convertThroughRate(amount, from, to, rate);
  if (converted === null) {
    return {
      ...none,
      reason: `${fmtReceiptAmount(amount, from)} is not the order's currency (${to}), and the rate on ${rateSource(rate)} — ${fmtRate(rate)} — does not convert ${from}; record the money in ${to}, or waive the advance.`,
    };
  }
  return {
    counted: true,
    amount: converted,
    via: "converted",
    reason: `${fmtReceiptAmount(amount, from)} counts as ${fmtReceiptAmount(converted, to)} at ${fmtRate(rate)}, the rate on ${rateSource(rate)}.`,
  };
}

/**
 * The old boolean, kept for the callers that ask the question without a rate.
 * It is the SAME function with no rate on file, never a second comparison —
 * that is how the card's flag and the gate's arithmetic were made to agree in
 * the first place, and adding the rate must not undo it.
 */
export function countsTowardAdvance(r: { kind: string; currency: string }, orderCurrency: string, rate?: AdvanceRate | null): boolean {
  return advanceReceiptCheck(r, { orderCurrency, rate }).counted;
}

export interface AdvanceInput {
  receipts: ReadonlyArray<AdvanceReceiptLike> | null | undefined;
  /** Σ of the order lines' amounts. Zero or absent means the order is not
   *  priced yet. */
  orderTotal: unknown;
  /** The ORDER's currency — the only one that counts toward the advance. */
  currency: string;
  /** Already resolved through effectiveAdvancePct by the caller. */
  advancePct: unknown;
  /** answer 12: the manager let this one go. */
  waived?: boolean | null;
  /** Round three, answer 10: the manual rate on the order's live invoice.
   *  Absent or unusable and the module behaves exactly as it did before the
   *  answer — foreign advance money is listed and not counted. */
  rate?: AdvanceRate | null;
}

export interface AdvanceStatus {
  /** The money that must be in, in the order currency. 0 when nothing is
   *  asked, and 0 when the order has no total to take a share of. */
  required: number;
  /** ADVANCE money measured in the ORDER's currency: what arrived in it, plus
   *  whatever the invoice's rate could convert into it (answer 10). Money in a
   *  currency the rate does not reach is deliberately not here — see `reason`. */
  receivedAdvance: number;
  /** The percentage asked (answer 11), after the settings default. */
  pct: number;
  satisfied: boolean;
  /** One sentence about the state: what is missing, or what qualifies a
   *  satisfied answer (a waiver, foreign money converted through the invoice's
   *  rate, or foreign money that could not be). Null when the money is simply
   *  in, in the order's own currency. */
  reason: string | null;
  waived: boolean;
  /** How much of `receivedAdvance` arrived in another currency and was
   *  converted (answer 10). Optional so a reader written before the rate
   *  existed still type-checks; 0 when nothing was converted. */
  convertedAdvance?: number;
  /** The rate that did the converting, when one was used. */
  rate?: AdvanceRate | null;
}

/**
 * Advance money summed per currency and put through the SAME per-receipt rule,
 * so the wording on the card's row and the wording in the summary cannot say
 * different things about the same money.
 *
 * ONE helper for both halves of the sentence — the foreign money that WAS
 * converted (said once, so a satisfied gate still shows what satisfied it) and
 * the money that could NOT be counted, whose reason names the rate that is
 * missing rather than claiming the module has no exchange table: since answer
 * 10 it has one, and the clerk's next move is to type it on the invoice.
 * They were two byte-identical functions; one would have been reworded and the
 * other left, and the two halves of one sentence would have stopped matching.
 */
function noteFor(rows: ReadonlyArray<AdvanceReceiptLike>, ctx: { orderCurrency: string; rate?: AdvanceRate | null }): string {
  if (!rows.length) return "";
  const by = new Map<string, number>();
  for (const r of rows) {
    const c = cur(r.currency) || "—";
    by.set(c, round2((by.get(c) ?? 0) + (money(r.amount) ?? 0)));
  }
  return Array.from(by.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([c, n]) => advanceReceiptCheck({ kind: "ADVANCE", amount: n, currency: c }, ctx).reason)
    .filter((s): s is string => Boolean(s))
    .join(" ");
}

const sentence = (...parts: Array<string | null | undefined>): string | null => {
  const out = parts.map((p) => s(p)).filter(Boolean).join(" ");
  return out || null;
};

/**
 * Whether the advance the order asks for has actually arrived (answer 11), or
 * has been waived (answer 12).
 *
 * THREE THINGS THIS DELIBERATELY REFUSES TO GUESS:
 *
 *   a receipt in a currency the rate does not reach — listed on the card, never
 *   added in. Round three, answer 10 gave the module ONE rate, the manual one
 *   on the order's live invoice, and it converts exactly the pair it is about
 *   (rupees ↔ the invoice's currency). Anything else — two foreign currencies,
 *   or an invoice with no rate typed yet — is money that was seen and not
 *   counted, and the reason says which rate is missing, which is the honest
 *   answer and the one a clerk can act on.
 *
 *   an order with no total — a percentage of nothing is nothing, and treating
 *   it as "0 required, therefore satisfied" would open dispatch on every
 *   unpriced order. NOT satisfied, with the missing total named. A waiver
 *   still gets the truck out.
 *
 *   a rounding difference — the comparison is in whole cents, so money that
 *   arrived to the paisa is not held back by binary floating point.
 */
export function advanceStatus(input: AdvanceInput): AdvanceStatus {
  const currency = orderCur(input.currency);
  const waived = Boolean(input.waived);
  const pct = pctOf(input.advancePct) ?? ADVANCE_PCT_FALLBACK;
  const rate = usableRate(input.rate);
  // The per-receipt rule is handed the rate AS TYPED, not the usable one: it
  // has to tell "no rate on the invoice" from "a rate that is quoted per rupee
  // and converts nothing", and those two sentences send the clerk to different
  // places. What is exported below (`rate`) is still the usable one — that is
  // the figure the screens print and the one that did any converting.
  const ctx = { orderCurrency: currency, rate: input.rate ?? null };
  const advances = (input.receipts ?? []).filter((r) => cur(r.kind) === "ADVANCE");
  // One rule, shared with the card (advanceReceiptCheck), so "not counted" on
  // the screen and "not added in" here can never mean different things — and
  // the converted figure on the row is the very number summed here.
  const checked = advances.map((r) => ({ r, c: advanceReceiptCheck(r, ctx) }));
  const uncounted = checked.filter((x) => !x.c.counted).map((x) => x.r);
  const converted = checked.filter((x) => x.c.via === "converted").map((x) => x.r);
  const receivedAdvance = round2(checked.reduce((t, x) => t + x.c.amount, 0));
  const convertedAdvance = round2(checked.filter((x) => x.c.via === "converted").reduce((t, x) => t + x.c.amount, 0));
  const flag = sentence(noteFor(converted, ctx), noteFor(uncounted, ctx)) ?? "";
  const total = money(input.orderTotal);
  const priced = total !== null && total > 0;
  const required = priced ? round2((total * pct) / 100) : 0;
  const base = { required, receivedAdvance, pct, waived, convertedAdvance, rate };

  if (waived) {
    return { ...base, satisfied: true, reason: sentence("The advance was waived — this order may be dispatched without it.", flag) };
  }
  if (pct === 0) {
    // 0 on the order is a real answer, not a blank (schema: "0 asks for no
    // advance at all"), so it is settled whether or not the order is priced.
    // It stays settled here on purpose: 0 is kept meaningful for the manager
    // whose order really asks for nothing, and the cost of setting it is
    // charged where it belongs — advancePctChange makes it the waiver's desk.
    return { ...base, satisfied: true, reason: sentence("No advance is asked on this order.", flag) };
  }
  if (!priced) {
    return {
      ...base,
      satisfied: false,
      reason: sentence(`The order has no total yet, so the ${fmtPct(pct)} advance cannot be worked out: price the line items, or waive the advance.`, flag),
    };
  }
  if (cents(receivedAdvance) >= cents(required)) {
    return { ...base, satisfied: true, reason: sentence(flag) };
  }
  return {
    ...base,
    satisfied: false,
    reason: sentence(
      `The advance is short: ${fmtReceiptAmount(receivedAdvance, currency)} of the ${fmtReceiptAmount(required, currency)} asked (${fmtPct(pct)} of ${fmtReceiptAmount(total as number, currency)}).`,
      flag,
    ),
  };
}

/** What is still owed on the advance, never below zero. */
export function advanceShortfall(a: { required: number; receivedAdvance: number }): number {
  return round2(Math.max(0, a.required - a.receivedAdvance));
}

/** The one-line figure the stage strip, the overview and the receipts card all
 *  show INSTEAD OF A TICK (round two: the advance is a number, not a state). */
export function advanceBadge(a: AdvanceStatus, currency: string): string {
  const c = cur(currency) || "—";
  if (a.waived) return "Advance waived";
  if (a.required === 0 && a.satisfied) return "No advance asked";
  if (a.required === 0) return `Advance ${fmtPct(a.pct)} — no order total yet`;
  if (a.satisfied) return `Advance in: ${fmtReceiptAmount(a.receivedAdvance, c)} of ${fmtReceiptAmount(a.required, c)}`;
  return `Advance short ${fmtReceiptAmount(advanceShortfall(a), c)} — ${fmtReceiptAmount(a.receivedAdvance, c)} of ${fmtReceiptAmount(a.required, c)}`;
}

/** A waiver needs a reason in writing (answer 12), and the reason is what the
 *  order, the log and the dispatch screen carry afterwards. */
export function parseWaiverReason(v: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const r = s(v);
  if (!r) return { ok: false, error: "Give a reason for waiving the advance" };
  if (r.length > 500) return { ok: false, error: "The reason is too long — 500 characters at most" };
  return { ok: true, reason: r };
}
