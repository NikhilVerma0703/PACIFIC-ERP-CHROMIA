// Receipts (answers 2, 29), RUN against the module the route runs.
// src/lib/commercial/receipts-rules.ts is import-free, so node --test loads it
// bare; what these prove is true of POST …/orders/[id]/receipts itself.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/commercialReceipts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECEIPT_KINDS, RECEIPT_KIND_LABEL, isReceiptKind, parseAmount, calendarDate, todayIst, parseReceipt,
  fmtReceiptAmount, receiptNote, receiptTotals, canRecordReceipt,
  advanceStatus, advanceShortfall, advanceBadge, effectiveAdvancePct, pctOf, fmtPct, parseWaiverReason,
  ADVANCE_PCT_FALLBACK, canWaiveAdvance, countsTowardAdvance, advancePctChange,
  RUPEES, usableRate, ratePerRupees, fmtRate, convertThroughRate, advanceReceiptCheck, type AdvanceRate,
} from "../src/lib/commercial/receipts-rules.ts";
import { invoiceAdvanceRate, exchangeRateRefusal } from "../src/lib/commercial/invoice-rules.ts";
import { ORDER_STATUSES, isTerminal } from "../src/lib/commercial/stages.ts";
import { DEFAULT_SETTINGS } from "../src/lib/commercial/settings-defaults.ts";

const ctx = { orderCurrency: "USD", today: "2026-09-08" };

// ───────────────────────────── the pieces ────────────────────────────────────

test("kinds: the four of answer 29, each with a printed label", () => {
  assert.deepEqual([...RECEIPT_KINDS], ["ADVANCE", "CAD", "BALANCE", "OTHER"]);
  for (const k of RECEIPT_KINDS) assert.ok(RECEIPT_KIND_LABEL[k], `${k} needs a label`);
  assert.equal(isReceiptKind("ADVANCE"), true);
  assert.equal(isReceiptKind("advance"), false, "the parser upper-cases before asking; the guard itself is exact");
  assert.equal(isReceiptKind("DEPOSIT"), false);
  assert.equal(isReceiptKind(null), false);
});

test("parseAmount: positive money at up to 2 dp; a slipped third decimal is refused, not rounded", () => {
  assert.equal(parseAmount("5000"), 5000);
  assert.equal(parseAmount("5000.5"), 5000.5);
  assert.equal(parseAmount("12,500.75"), 12500.75, "a typed thousands separator is not a NaN");
  assert.equal(parseAmount(250), 250);
  assert.equal(parseAmount(" 99.99 "), 99.99);
  assert.equal(parseAmount("0"), null, "nothing was received");
  assert.equal(parseAmount("0.00"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("5000.123"), null, "3 dp on a bank receipt is a slipped key");
  assert.equal(parseAmount("5k"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
  assert.equal(parseAmount(NaN), null);
});

test("calendarDate: a real YYYY-MM-DD (or the date part of an instant); 30 February is not a date", () => {
  assert.equal(calendarDate("2026-09-08"), "2026-09-08");
  assert.equal(calendarDate("2026-09-08T10:15:00.000Z"), "2026-09-08", "a date input sent as an instant keeps its day");
  assert.equal(calendarDate("2026-02-30"), null);
  assert.equal(calendarDate("2026-13-01"), null);
  assert.equal(calendarDate("08/09/2026"), null, "the office's display format is not the wire format");
  assert.equal(calendarDate(""), null);
  assert.equal(calendarDate(null), null);
});

test("todayIst: the office's calendar date, not the server's UTC one", () => {
  // 20:00 UTC on the 7th is 01:30 IST on the 8th — a receipt typed then is dated the 8th.
  assert.equal(todayIst(new Date("2026-09-07T20:00:00.000Z")), "2026-09-08");
  assert.equal(todayIst(new Date("2026-09-07T18:29:59.000Z")), "2026-09-07", "one second before IST midnight");
  assert.equal(todayIst(new Date("2026-09-07T18:30:00.000Z")), "2026-09-08", "IST midnight");
});

// ───────────────────────────── the whole body ────────────────────────────────

test("parseReceipt: a good body comes back trimmed, upper-cased and typed", () => {
  const r = parseReceipt({ kind: "advance", amount: "12,500.50", currency: " usd ", receivedAt: "2026-09-01", mode: " TT ", reference: " UTR123 ", notes: "  " }, ctx);
  assert.ok(r.ok);
  assert.deepEqual(r.data, {
    kind: "ADVANCE", amount: 12500.5, currency: "USD", receivedAt: "2026-09-01",
    mode: "TT", reference: "UTR123", notes: null,
  });
});

test("parseReceipt: the currency defaults to the order's and is upper-cased", () => {
  const r = parseReceipt({ kind: "CAD", amount: 100, receivedAt: "2026-09-08" }, ctx);
  assert.ok(r.ok);
  assert.equal(r.data.currency, "USD");
  const inr = parseReceipt({ kind: "CAD", amount: 100, receivedAt: "2026-09-08", currency: "inr" }, ctx);
  assert.ok(inr.ok);
  assert.equal(inr.data.currency, "INR", "an advance may arrive in a currency other than the order's (OPEN-QUESTIONS-2 §13 default)");
  const none = parseReceipt({ kind: "CAD", amount: 100, receivedAt: "2026-09-08" }, { ...ctx, orderCurrency: "" });
  assert.equal(none.ok, false);
  assert.match((none as { error: string }).error, /Currency/);
});

test("parseReceipt: today is accepted, tomorrow is not — money is recorded once it has arrived", () => {
  assert.equal(parseReceipt({ kind: "ADVANCE", amount: 1, receivedAt: "2026-09-08" }, ctx).ok, true);
  const future = parseReceipt({ kind: "ADVANCE", amount: 1, receivedAt: "2026-09-09" }, ctx);
  assert.equal(future.ok, false);
  assert.match((future as { error: string }).error, /future/);
});

test("parseReceipt: each thing wrong is named, in the order a clerk fills the form", () => {
  const kind = parseReceipt({ kind: "DEPOSIT", amount: 1, receivedAt: "2026-09-08" }, ctx);
  assert.equal(kind.ok, false);
  assert.match((kind as { error: string }).error, /Kind must be one of ADVANCE, CAD, BALANCE, OTHER/);

  const amount = parseReceipt({ kind: "ADVANCE", amount: "abc", receivedAt: "2026-09-08" }, ctx);
  assert.equal(amount.ok, false);
  assert.match((amount as { error: string }).error, /Amount/);

  const date = parseReceipt({ kind: "ADVANCE", amount: 1, receivedAt: "yesterday" }, ctx);
  assert.equal(date.ok, false);
  assert.match((date as { error: string }).error, /Received on/);

  assert.equal(parseReceipt(null, ctx).ok, false, "no body is a 400, not a crash");
  assert.equal(parseReceipt("advance", ctx).ok, false);
});

// ───────────────────────────── which orders take money ───────────────────────
// POST …/orders/[id]/receipts runs canRecordReceipt on the order's status
// before parseReceipt and 409s with its reason.

test("canRecordReceipt: a closed or cancelled order takes no more receipts; every live stage does", () => {
  assert.deepEqual(canRecordReceipt("CLOSED"), { ok: false, reason: "This order is closed or cancelled; receipts cannot be recorded on it" });
  assert.equal(canRecordReceipt("CANCELLED").ok, false);
  assert.equal(canRecordReceipt("cancelled").ok, false, "case does not open the door");
  for (const st of ["DRAFT", "CONFIRMED", "PI_ISSUED", "INVOICED", "DISPATCHED"]) assert.equal(canRecordReceipt(st).ok, true, `${st} still takes money`);
  // the import-free restatement must agree with stages.isTerminal on every stage the pipeline knows
  for (const st of ORDER_STATUSES) assert.equal(canRecordReceipt(st).ok, !isTerminal(st), `${st}: canRecordReceipt disagrees with isTerminal`);
});

test("canWaiveAdvance: a closed or cancelled order has no truck left to let go (answer 12)", () => {
  assert.deepEqual(canWaiveAdvance("CLOSED"), { ok: false, reason: "This order is closed or cancelled; the advance cannot be waived on it" });
  assert.equal(canWaiveAdvance("CANCELLED").ok, false);
  assert.equal(canWaiveAdvance("cancelled").ok, false, "case does not open the door");
  assert.equal(canWaiveAdvance("PACKING").ok, true, "the stage where the question is actually asked");
  // POST …/advance-waiver 409s with this, and it draws the same line as receipts
  for (const st of ORDER_STATUSES) assert.equal(canWaiveAdvance(st).ok, canRecordReceipt(st).ok, `${st}: the waiver and the receipt disagree about a finished order`);
});


// ───────────────────────────── what the card and the log print ───────────────

test("fmtReceiptAmount: 2 dp, grouped, currency first", () => {
  assert.equal(fmtReceiptAmount(12500.5, "USD"), "USD 12,500.50");
  assert.equal(fmtReceiptAmount(0, "INR"), "INR 0.00");
  assert.equal(fmtReceiptAmount(NaN, "INR"), "INR 0.00", "a broken figure prints as nothing rather than NaN");
});

test("receiptNote: the log line carries the kind and the amount, and whatever else was typed", () => {
  assert.equal(
    receiptNote({ kind: "ADVANCE", amount: 12500.5, currency: "USD", receivedAt: "2026-09-01", mode: "TT", reference: "UTR123" }, "recorded"),
    "Advance receipt USD 12,500.50 recorded received 2026-09-01 (TT, ref UTR123)",
  );
  assert.equal(
    receiptNote({ kind: "CAD", amount: 100, currency: "EUR", receivedAt: "2026-09-01T00:00:00.000Z" }, "deleted"),
    "CAD (documents against payment) receipt EUR 100.00 deleted received 2026-09-01",
    "a @db.Date column comes back as an instant; only its day is printed",
  );
  assert.equal(receiptNote({ kind: "OTHER", amount: 5, currency: "INR" }, "recorded"), "Other receipt INR 5.00 recorded");
  assert.equal(receiptNote({ kind: "MYSTERY", amount: 5, currency: "INR" }, "recorded"), "MYSTERY receipt INR 5.00 recorded", "an unknown kind still logs");
});

test("receiptTotals: per currency and per kind, never summed across currencies, 2 dp arithmetic", () => {
  const t = receiptTotals([
    { kind: "ADVANCE", amount: 0.1, currency: "USD" },
    { kind: "ADVANCE", amount: 0.2, currency: "usd" },
    { kind: "BALANCE", amount: 1000, currency: "USD" },
    { kind: "ADVANCE", amount: 50000, currency: "INR" },
  ]);
  assert.deepEqual(t, [
    { currency: "INR", total: 50000, byKind: { ADVANCE: 50000 } },
    { currency: "USD", total: 1000.3, byKind: { ADVANCE: 0.3, BALANCE: 1000 } },
  ]);
  assert.deepEqual(receiptTotals([]), []);
});

// ───────────────────────── how much advance opens dispatch ───────────────────
// Round two, answer 11: the gate is the PI's advance percentage, not the
// presence of a receipt. Everything below is the arithmetic the dispatch route
// refuses with and the receipts card prints, run on real figures.

const usd = (amount: number, kind = "ADVANCE", currency = "USD") => ({ kind, amount, currency });

test("effectiveAdvancePct: the order's own figure, else the settings default for its kind (answer 11)", () => {
  const d = { domestic: DEFAULT_SETTINGS.dispatch.advancePctDomestic, export: DEFAULT_SETTINGS.dispatch.advancePctExport };
  assert.equal(d.domestic, 100, "the domestic terms on file read 100% Advance Payment");
  assert.equal(d.export, 30);
  assert.equal(effectiveAdvancePct(40, "EXPORT", d), 40, "the order's own percentage wins");
  assert.equal(effectiveAdvancePct(null, "EXPORT", d), 30);
  assert.equal(effectiveAdvancePct(null, "DOMESTIC", d), 100);
  assert.equal(effectiveAdvancePct("", "DOMESTIC", d), 100, "a blank box is not an answer");
  assert.equal(effectiveAdvancePct(0, "EXPORT", d), 0, "0 IS an answer — no advance at all — and is not read as blank");
  assert.equal(effectiveAdvancePct(null, "export", d), 30, "the kind is compared case-insensitively");
  // fail closed: with neither an order figure nor a usable setting, ask for all of it
  assert.equal(effectiveAdvancePct(null, "EXPORT", null), ADVANCE_PCT_FALLBACK);
  assert.equal(effectiveAdvancePct(null, "EXPORT", { export: 140 }), ADVANCE_PCT_FALLBACK, "140% is a typo, not a percentage");
});

test("pctOf: 0 to 100 only; anything else is a typo and is refused, not clamped", () => {
  assert.equal(pctOf(30), 30);
  assert.equal(pctOf("30"), 30);
  assert.equal(pctOf("33.5"), 33.5);
  assert.equal(pctOf(0), 0);
  assert.equal(pctOf(100), 100);
  assert.equal(pctOf(101), null);
  assert.equal(pctOf(-1), null);
  assert.equal(pctOf("thirty"), null);
  assert.equal(pctOf(""), null);
  assert.equal(pctOf(null), null);
  // a Prisma Decimal arrives as an object with toNumber()
  assert.equal(pctOf({ toNumber: () => 30 }), 30);
});

test("advanceStatus: the money asked is the percentage of the order total, and the gate opens when it is in", () => {
  const a = advanceStatus({ receipts: [usd(9000)], orderTotal: 30000, currency: "USD", advancePct: 30 });
  assert.equal(a.required, 9000);
  assert.equal(a.receivedAdvance, 9000);
  assert.equal(a.pct, 30);
  assert.equal(a.satisfied, true);
  assert.equal(a.waived, false);
  assert.equal(a.reason, null, "nothing stands in the way and nothing qualifies it");
  assert.equal(advanceShortfall(a), 0);
});

test("advanceStatus: short money refuses, and the reason names every figure (the dispatch 409)", () => {
  const a = advanceStatus({ receipts: [usd(3000)], orderTotal: 30000, currency: "USD", advancePct: 30 });
  assert.equal(a.satisfied, false);
  assert.equal(a.required, 9000);
  assert.equal(a.receivedAdvance, 3000);
  assert.equal(advanceShortfall(a), 6000);
  assert.equal(
    a.reason,
    "The advance is short: USD 3,000.00 of the USD 9,000.00 asked (30% of USD 30,000.00).",
  );
});

test("advanceStatus: only ADVANCE receipts count, and — with no rate on file — only in the ORDER's currency", () => {
  const a = advanceStatus({
    receipts: [usd(9000, "CAD"), usd(5000, "BALANCE"), usd(2000, "OTHER"), usd(9000)],
    orderTotal: 30000, currency: "USD", advancePct: 30,
  });
  assert.equal(a.receivedAdvance, 9000, "CAD, balance and other money is recorded but is not the advance");
  assert.equal(a.satisfied, true);

  // a receipt in another currency, with NO rate on the invoice, is SEEN and NOT
  // counted — and the reason now names the rate that is missing rather than
  // saying the module has no exchange table, because since round three's answer
  // 10 it has one and typing it is the clerk's next move.
  const fx = advanceStatus({
    receipts: [usd(3000), usd(500000, "ADVANCE", "INR")],
    orderTotal: 30000, currency: "USD", advancePct: 30,
  });
  assert.equal(fx.receivedAdvance, 3000, "INR 500,000 is not silently converted into the USD figure");
  assert.equal(fx.satisfied, false);
  assert.match(fx.reason ?? "", /INR 500,000\.00 is not the order's currency \(USD\)/);
  assert.match(fx.reason ?? "", /no exchange rate is set on the order's invoice/);
  assert.equal(fx.convertedAdvance, 0);

  // and it is still said even when the order-currency money is enough
  const enough = advanceStatus({
    receipts: [usd(9000), usd(500000, "ADVANCE", "INR")],
    orderTotal: 30000, currency: "USD", advancePct: 30,
  });
  assert.equal(enough.satisfied, true);
  assert.match(enough.reason ?? "", /is not the order's currency/, "the clerk is told the money was seen, whichever way the gate went");

  // the comparison is case-insensitive on both sides
  const cased = advanceStatus({ receipts: [{ kind: "advance", amount: 9000, currency: "usd" }], orderTotal: 30000, currency: "usd", advancePct: 30 });
  assert.equal(cased.satisfied, true);
});

test("advanceStatus: an order with no total cannot be tested, so it is NOT satisfied (answer 11)", () => {
  for (const total of [0, null, undefined, ""]) {
    const a = advanceStatus({ receipts: [usd(9000)], orderTotal: total, currency: "USD", advancePct: 30 });
    assert.equal(a.satisfied, false, `an order total of ${String(total)} must not open dispatch`);
    assert.equal(a.required, 0, "a percentage of nothing is nothing — which is exactly why it proves nothing");
    assert.match(a.reason ?? "", /no total yet/);
    assert.match(a.reason ?? "", /30%/);
  }
  // and the waiver still gets that truck out (answer 12)
  const waived = advanceStatus({ receipts: [], orderTotal: 0, currency: "USD", advancePct: 30, waived: true });
  assert.equal(waived.satisfied, true);
});

test("advanceStatus: a waiver satisfies the gate outright and says so (answer 12)", () => {
  const a = advanceStatus({ receipts: [], orderTotal: 30000, currency: "USD", advancePct: 30, waived: true });
  assert.equal(a.satisfied, true);
  assert.equal(a.waived, true);
  assert.equal(a.receivedAdvance, 0, "the figures are still true — the waiver does not invent money");
  assert.equal(a.required, 9000);
  assert.match(a.reason ?? "", /waived/);
  assert.equal(advanceBadge(a, "USD"), "Advance waived");
});

test("advanceStatus: 0% asks for nothing and is settled, priced or not", () => {
  const priced = advanceStatus({ receipts: [], orderTotal: 30000, currency: "USD", advancePct: 0 });
  assert.equal(priced.satisfied, true);
  assert.equal(priced.required, 0);
  assert.match(priced.reason ?? "", /No advance is asked/);
  const unpriced = advanceStatus({ receipts: [], orderTotal: null, currency: "USD", advancePct: 0 });
  assert.equal(unpriced.satisfied, true, "there is nothing to work out, so nothing is missing");
});

test("advanceStatus: an unresolvable percentage fails CLOSED — the whole amount, not none", () => {
  const a = advanceStatus({ receipts: [usd(9000)], orderTotal: 30000, currency: "USD", advancePct: null });
  assert.equal(a.pct, ADVANCE_PCT_FALLBACK);
  assert.equal(a.required, 30000);
  assert.equal(a.satisfied, false, "a missing percentage must never read as 'nothing is asked'");
});

test("advanceStatus: money is compared in whole cents, so the paisa that arrived is not held back", () => {
  // 0.1 + 0.2 is 0.30000000000000004 in binary floating point
  const a = advanceStatus({ receipts: [usd(0.1), usd(0.2)], orderTotal: 1, currency: "USD", advancePct: 30 });
  assert.equal(a.required, 0.3);
  assert.equal(a.receivedAdvance, 0.3);
  assert.equal(a.satisfied, true, "the truck does not stand for a rounding artefact");
  // and a cent genuinely short is genuinely short
  const b = advanceStatus({ receipts: [usd(0.29)], orderTotal: 1, currency: "USD", advancePct: 30 });
  assert.equal(b.satisfied, false);
  assert.equal(advanceShortfall(b), 0.01);
  // over-payment is fine
  const c = advanceStatus({ receipts: [usd(20000)], orderTotal: 30000, currency: "USD", advancePct: 30 });
  assert.equal(c.satisfied, true);
  assert.equal(advanceShortfall(c), 0, "a shortfall is never negative");
});

test("advanceStatus: Prisma Decimals on the way in read the same as numbers on the way back", () => {
  const dec = (n: number) => ({ toNumber: () => n });
  const a = advanceStatus({
    receipts: [{ kind: "ADVANCE", amount: dec(9000), currency: "USD" }],
    orderTotal: dec(30000), currency: "USD", advancePct: dec(30),
  });
  assert.equal(a.required, 9000);
  assert.equal(a.receivedAdvance, 9000);
  assert.equal(a.satisfied, true);
});

test("advanceBadge / fmtPct: the strip and the card print a figure, never a tick", () => {
  assert.equal(fmtPct(30), "30%");
  assert.equal(fmtPct(33.5), "33.5%");
  assert.equal(fmtPct(100), "100%");
  const short = advanceStatus({ receipts: [usd(3000)], orderTotal: 30000, currency: "USD", advancePct: 30 });
  assert.equal(advanceBadge(short, "USD"), "Advance short USD 6,000.00 — USD 3,000.00 of USD 9,000.00");
  const inFull = advanceStatus({ receipts: [usd(9000)], orderTotal: 30000, currency: "USD", advancePct: 30 });
  assert.equal(advanceBadge(inFull, "USD"), "Advance in: USD 9,000.00 of USD 9,000.00");
  const none = advanceStatus({ receipts: [], orderTotal: 30000, currency: "USD", advancePct: 0 });
  assert.equal(advanceBadge(none, "USD"), "No advance asked");
  const unpriced = advanceStatus({ receipts: [], orderTotal: 0, currency: "USD", advancePct: 30 });
  assert.equal(advanceBadge(unpriced, "USD"), "Advance 30% — no order total yet");
});

test("parseWaiverReason: a waiver without a reason is refused (answer 12)", () => {
  assert.deepEqual(parseWaiverReason("Owner approved by phone"), { ok: true, reason: "Owner approved by phone" });
  assert.deepEqual(parseWaiverReason("  trimmed  "), { ok: true, reason: "trimmed" });
  assert.deepEqual(parseWaiverReason(""), { ok: false, error: "Give a reason for waiving the advance" });
  assert.equal(parseWaiverReason("   ").ok, false, "whitespace is not a reason");
  assert.equal(parseWaiverReason(null).ok, false);
  assert.equal(parseWaiverReason(undefined).ok, false);
  assert.equal(parseWaiverReason("x".repeat(501)).ok, false);
  assert.equal(parseWaiverReason("x".repeat(500)).ok, true);
});

// ───────────────────── the card and the gate ask ONE question ────────────────
// The receipts card flags an advance it says does not count. That flag used to
// be its own comparison (r.currency !== order.currency) while advanceStatus
// normalised both sides — so a receipt typed "usd" against a USD order was
// counted by the gate and printed "not counted" on the card. One predicate now
// answers for both.

test("countsTowardAdvance: an ADVANCE in the order's currency, compared case-blind", () => {
  assert.equal(countsTowardAdvance({ kind: "ADVANCE", currency: "USD" }, "USD"), true);
  assert.equal(countsTowardAdvance({ kind: "advance", currency: "usd" }, "USD"), true, "case is not a different kind or a different currency");
  assert.equal(countsTowardAdvance({ kind: "ADVANCE", currency: " usd " }, "usd"), true, "and neither is a stray space");
  assert.equal(countsTowardAdvance({ kind: "ADVANCE", currency: "INR" }, "USD"), false, "there is no exchange table");
  assert.equal(countsTowardAdvance({ kind: "CAD", currency: "USD" }, "USD"), false, "CAD money is not the advance");
  // An order with no currency has nothing to count money in, so nothing counts
  // toward it — the same answer advanceStatus gives, where a blank order
  // currency becomes "—" and matches no receipt at all.
  assert.equal(countsTowardAdvance({ kind: "ADVANCE", currency: "" }, ""), false);
  assert.equal(advanceStatus({ receipts: [{ kind: "ADVANCE", amount: 500, currency: "" }], orderTotal: 1000, currency: "", advancePct: 30 }).receivedAdvance, 0);
});

test("countsTowardAdvance and advanceStatus agree receipt by receipt", () => {
  const rows = [
    { kind: "ADVANCE", amount: 3000, currency: "usd" },
    { kind: "ADVANCE", amount: 4000, currency: "USD" },
    { kind: "ADVANCE", amount: 500000, currency: "INR" },
    { kind: "CAD", amount: 9000, currency: "USD" },
  ];
  const a = advanceStatus({ receipts: rows, orderTotal: 30000, currency: "USD", advancePct: 30 });
  const counted = rows.filter((r) => countsTowardAdvance(r, "USD")).reduce((t, r) => t + r.amount, 0);
  assert.equal(counted, 7000);
  assert.equal(a.receivedAdvance, counted, "the card's flag and the gate's arithmetic cannot drift");
  assert.match(a.reason ?? "", /INR 500,000\.00 is not the order's currency \(USD\)/);
});

// ───────────────────── lowering the gate is the waiver's desk ────────────────
// PATCH …/orders/[id] runs this over the percentages IN FORCE before and after
// the edit (both resolved through effectiveAdvancePct). advanceStatus settles
// 0% outright — a real answer for an order that asks for nothing — which is
// exactly why typing 0 into the header box had to stop being an ordinary edit:
// it opened dispatch with no reason, no stamp and nothing in the log.

test("advancePctChange: raising the advance, or leaving it alone, is an ordinary edit", () => {
  assert.deepEqual(advancePctChange(30, 50), { ok: true });
  assert.deepEqual(advancePctChange(30, 30), { ok: true });
  assert.deepEqual(advancePctChange(0, 0), { ok: true }, "an order that already asks for nothing is not being changed");
  assert.deepEqual(advancePctChange(0, 30), { ok: true }, "asking for money where none was asked needs nobody's permission");
  assert.deepEqual(advancePctChange(30, 30.001), { ok: true }, "compared in hundredths, the way money is");
});

test("advancePctChange: 0 is a waiver in all but name, and takes the waiver's desk (answers 11, 12)", () => {
  const zero = advancePctChange(30, 0);
  assert.equal(zero.ok, false);
  const reason = (zero as { reason: string }).reason;
  assert.match(reason, /0%/);
  assert.match(reason, /30%/, "the refusal names what the order asks today");
  assert.match(reason, /waiv/i, "and points at the route that does this properly");
  assert.match(reason, /Commercial Manager/);
  // the write-level login gets that sentence as its 403; the cancel-level one
  // is asked the same question and goes through, so 0 stays meaningful.
});

test("advancePctChange: any lowering opens dispatch on money that has not arrived", () => {
  const down = advancePctChange(100, 10);
  assert.equal(down.ok, false);
  assert.match((down as { reason: string }).reason, /from 100% to 10%/);
  // a blank box is a lowering when the default under it is lower — the route
  // resolves both sides first, so this is the shape it hands in
  const d = { domestic: 100, export: 30 };
  const cleared = advancePctChange(effectiveAdvancePct(60, "EXPORT", d), effectiveAdvancePct(null, "EXPORT", d));
  assert.equal(cleared.ok, false, "60% cleared back to the 30% default lowers the gate too");
  // and switching an order that follows the default from domestic to export
  // swaps 100 for 30 without the box being touched at all
  const kindSwap = advancePctChange(effectiveAdvancePct(null, "DOMESTIC", d), effectiveAdvancePct(null, "EXPORT", d));
  assert.equal(kindSwap.ok, false);
  // an order carrying its own percentage is untouched by that same swap
  assert.deepEqual(advancePctChange(effectiveAdvancePct(40, "DOMESTIC", d), effectiveAdvancePct(40, "EXPORT", d)), { ok: true });
});

test("advancePctChange: an unreadable percentage fails CLOSED on both sides", () => {
  assert.equal(advancePctChange(null, 30).ok, false, "unknown before means 100% before — 30 is a lowering");
  assert.equal(advancePctChange(30, "nonsense").ok, true, "unknown after means the fallback 100%, which is a raise");
  assert.equal(advancePctChange(ADVANCE_PCT_FALLBACK, 0).ok, false);
});

// ───────── the rate makes a foreign receipt count (round three, answer 10) ───
// "Add exchange rate per invoice, manual." This REPLACES round two's answer 13
// reading — same currency only — so the direction is pinned here BOTH ways and
// in words, because a rate applied the wrong way round does not look wrong: it
// looks like a truck that left on 1/88th of the advance.
//
// THE DIRECTION: `rate` is RUPEES PER ONE UNIT OF THE INVOICE CURRENCY.
//   order in INR, receipt in USD   →  amount × rate
//   order in USD, receipt in INR   →  amount ÷ rate

const usdRate = (rate = 88.42, invoiceNumber: string | null = "PESPL/2780"): AdvanceRate =>
  ({ rate, currency: "USD", at: "2026-09-09T06:00:00.000Z", invoiceNumber });

test("usableRate / fmtRate: a rate that cannot convert anything is no rate at all", () => {
  assert.equal(RUPEES, "INR");
  assert.equal(usableRate(null), null);
  assert.equal(usableRate({ rate: 0, currency: "USD" }), null, "zero would divide by zero one way and annihilate the money the other");
  assert.equal(usableRate({ rate: -88, currency: "USD" }), null);
  assert.equal(usableRate({ rate: 88.42, currency: "" }), null);
  assert.equal(usableRate({ rate: 88.42, currency: "INR" }), null, "rupees per rupee says nothing");
  assert.deepEqual(usableRate({ rate: "88.42", currency: " usd " } as unknown as AdvanceRate), { rate: 88.42, currency: "USD" });
  assert.equal(fmtRate(usdRate()), "INR 88.42 per USD");
});

test("convertThroughRate: rupees per one unit of the invoice currency, both directions", () => {
  const r = usdRate();
  // order in rupees, money arrived in the invoice's currency → MULTIPLY
  assert.equal(convertThroughRate(3000, "USD", "INR", r), 265260);
  // order in the invoice's currency, money arrived in rupees → DIVIDE
  assert.equal(convertThroughRate(265260, "INR", "USD", r), 3000);
  // and the two are each other's inverse, which is the whole point
  assert.equal(convertThroughRate(convertThroughRate(3000, "USD", "INR", r) as number, "INR", "USD", r), 3000);
  // same currency needs no rate at all
  assert.equal(convertThroughRate(3000, "USD", "USD", null), 3000);
  assert.equal(convertThroughRate(3000, "usd", "USD", null), 3000, "case is not a different currency");
  // a pair this rate is not about is refused, never guessed
  assert.equal(convertThroughRate(3000, "EUR", "USD", r), null);
  assert.equal(convertThroughRate(3000, "EUR", "INR", r), null);
  assert.equal(convertThroughRate(3000, "USD", "INR", null), null);
});

test("advanceReceiptCheck: what counted, what did not, and why not by name", () => {
  const r = usdRate();
  const direct = advanceReceiptCheck({ kind: "ADVANCE", amount: 9000, currency: "USD" }, { orderCurrency: "USD", rate: r });
  assert.deepEqual(direct, { counted: true, amount: 9000, via: "direct", reason: null });

  const converted = advanceReceiptCheck({ kind: "ADVANCE", amount: 265260, currency: "INR" }, { orderCurrency: "USD", rate: r });
  assert.equal(converted.counted, true);
  assert.equal(converted.via, "converted");
  assert.equal(converted.amount, 3000);
  assert.match(converted.reason ?? "", /INR 265,260\.00 counts as USD 3,000\.00 at INR 88\.42 per USD, the rate on invoice PESPL\/2780\./);

  // no rate on file: the refusal names the CURRENCY and the RATE that is missing
  const noRate = advanceReceiptCheck({ kind: "ADVANCE", amount: 265260, currency: "INR" }, { orderCurrency: "USD" });
  assert.equal(noRate.counted, false);
  assert.equal(noRate.amount, 0);
  assert.match(noRate.reason ?? "", /INR 265,260\.00 is not the order's currency \(USD\)/);
  assert.match(noRate.reason ?? "", /no exchange rate is set on the order's invoice/);

  // a rate on file that is not about this pair: named too, with the rate itself
  const wrongPair = advanceReceiptCheck({ kind: "ADVANCE", amount: 4000, currency: "EUR" }, { orderCurrency: "USD", rate: r });
  assert.equal(wrongPair.counted, false);
  assert.match(wrongPair.reason ?? "", /EUR 4,000\.00 is not the order's currency \(USD\)/);
  assert.match(wrongPair.reason ?? "", /invoice PESPL\/2780 — INR 88\.42 per USD — does not convert EUR/);

  // money that is not an advance is not the advance's business, rate or no rate
  assert.deepEqual(
    advanceReceiptCheck({ kind: "CAD", amount: 265260, currency: "INR" }, { orderCurrency: "USD", rate: r }),
    { counted: false, amount: 0, via: null, reason: null },
  );
});

// A rate typed on a RUPEE invoice is quoted per rupee and converts nothing.
// It has to be told apart from "no rate on the invoice", because that refusal
// asks the clerk to type a rate — and here he already has, on a screen sitting
// beside the card, and the invoice refuses to take another.
test("ratePerRupees: a rate on a rupee invoice is named as such, not reported as a missing rate", () => {
  assert.equal(ratePerRupees(null), false);
  assert.equal(ratePerRupees({ rate: 88.42, currency: "USD" }), false, "this one converts; nothing to explain");
  assert.equal(ratePerRupees({ rate: 88.42, currency: "INR" }), true);
  assert.equal(ratePerRupees({ rate: 88.42, currency: "inr" }), true, "case is not a different currency");
  assert.equal(ratePerRupees({ rate: 0, currency: "INR" }), false, "no rate was typed at all");
  // usableRate discards both, which is why the two need telling apart here
  assert.equal(usableRate({ rate: 88.42, currency: "INR" }), null);

  const perRupee: AdvanceRate = { rate: 88.42, currency: "INR", at: null, invoiceNumber: "PESPL/N7/26-27" };
  const c = advanceReceiptCheck({ kind: "ADVANCE", amount: 30000, currency: "USD" }, { orderCurrency: "INR", rate: perRupee });
  assert.equal(c.counted, false);
  assert.equal(c.amount, 0);
  assert.match(c.reason ?? "", /USD 30,000\.00 is not the order's currency \(INR\)/);
  assert.match(c.reason ?? "", /invoice PESPL\/N7\/26-27 is itself priced in INR/);
  assert.match(c.reason ?? "", /a rate quoted per rupee converts nothing/);
  assert.doesNotMatch(c.reason ?? "", /no exchange rate is set/, "he has typed one; the invoice screen shows it");

  // and the whole gate says the same thing, because advanceStatus hands the
  // per-receipt rule the rate AS TYPED rather than the usable one
  const a = advanceStatus({
    receipts: [{ kind: "ADVANCE", amount: 30000, currency: "USD" }],
    orderTotal: 2652600, currency: "INR", advancePct: 100, rate: perRupee,
  });
  assert.equal(a.receivedAdvance, 0);
  assert.equal(a.satisfied, false);
  assert.equal(a.rate, null, "the exported rate is still the USABLE one — nothing converted");
  assert.match(a.reason ?? "", /a rate quoted per rupee converts nothing/);

  // the sentence and the invoice screen's refusal are about the same fact
  assert.ok(exchangeRateRefusal("INR"), "the box that would have taken this rate is refused");
});

test("advanceStatus: an INR receipt against a USD export order now counts (this replaces round two, answer 13)", () => {
  const r = usdRate();
  // 30% of USD 30,000 is USD 9,000. Nothing arrived in USD; INR 795,780 did.
  const a = advanceStatus({
    receipts: [usd(795780, "ADVANCE", "INR")],
    orderTotal: 30000, currency: "USD", advancePct: 30, rate: r,
  });
  assert.equal(a.receivedAdvance, 9000, "795,780 divided by 88.42");
  assert.equal(a.convertedAdvance, 9000, "all of it arrived in another currency");
  assert.equal(a.satisfied, true, "the truck may leave");
  assert.match(a.reason ?? "", /counts as USD 9,000\.00 at INR 88\.42 per USD/);

  // the same money with no rate on the invoice is the old answer, unchanged
  const without = advanceStatus({ receipts: [usd(795780, "ADVANCE", "INR")], orderTotal: 30000, currency: "USD", advancePct: 30 });
  assert.equal(without.receivedAdvance, 0);
  assert.equal(without.satisfied, false);
  assert.match(without.reason ?? "", /no exchange rate is set on the order's invoice/);
});

test("advanceStatus: the other direction — a USD receipt against a rupee order", () => {
  // A domestic order priced in INR, 100% asked, USD money transferred against it.
  const a = advanceStatus({
    receipts: [usd(30000, "ADVANCE", "USD")],
    orderTotal: 2652600, currency: "INR", advancePct: 100, rate: usdRate(),
  });
  assert.equal(a.receivedAdvance, 2652600, "30,000 times 88.42");
  assert.equal(a.convertedAdvance, 2652600);
  assert.equal(a.satisfied, true);
});

test("advanceStatus: a rate converts only the pair it is about; a third currency is still listed and refused", () => {
  const a = advanceStatus({
    receipts: [usd(3000), usd(88420, "ADVANCE", "INR"), usd(4000, "ADVANCE", "EUR")],
    orderTotal: 30000, currency: "USD", advancePct: 30, rate: usdRate(),
  });
  assert.equal(a.receivedAdvance, 4000, "USD 3,000 direct plus INR 88,420 converted to USD 1,000");
  assert.equal(a.convertedAdvance, 1000);
  assert.equal(a.satisfied, false);
  assert.match(a.reason ?? "", /does not convert EUR/);
  assert.equal(advanceShortfall(a), 5000);
});

test("advanceStatus: the waiver is untouched by the rate (answer 12)", () => {
  const waived = advanceStatus({
    receipts: [usd(4000, "ADVANCE", "EUR")],
    orderTotal: 30000, currency: "USD", advancePct: 30, waived: true, rate: usdRate(),
  });
  assert.equal(waived.satisfied, true);
  assert.match(waived.reason ?? "", /^The advance was waived/);
  // and the money that could not be converted is STILL said, so a waiver never
  // hides a receipt nobody has reconciled
  assert.match(waived.reason ?? "", /does not convert EUR/);

  // a waiver with no receipts at all reads exactly as it did before answer 10
  const bare = advanceStatus({ receipts: [], orderTotal: 30000, currency: "USD", advancePct: 30, waived: true, rate: usdRate() });
  assert.equal(bare.reason, "The advance was waived — this order may be dispatched without it.");
  assert.equal(advanceBadge(bare, "USD"), "Advance waived");
});

test("countsTowardAdvance is advanceReceiptCheck, so the card and the gate stay one question", () => {
  const r = usdRate();
  const rows = [
    { kind: "ADVANCE", amount: 3000, currency: "USD" },
    { kind: "ADVANCE", amount: 88420, currency: "INR" },
    { kind: "ADVANCE", amount: 4000, currency: "EUR" },
    { kind: "CAD", amount: 9000, currency: "USD" },
  ];
  const a = advanceStatus({ receipts: rows, orderTotal: 30000, currency: "USD", advancePct: 30, rate: r });
  const counted = rows.filter((x) => countsTowardAdvance(x, "USD", r))
    .reduce((t, x) => t + advanceReceiptCheck(x, { orderCurrency: "USD", rate: r }).amount, 0);
  assert.equal(a.receivedAdvance, counted);
  // and asked WITHOUT a rate it is the pre-answer-10 predicate, exactly
  assert.equal(countsTowardAdvance({ kind: "ADVANCE", currency: "INR" }, "USD"), false);
  assert.equal(countsTowardAdvance({ kind: "ADVANCE", currency: "INR" }, "USD", r), true);
});

// ───────────── the join: the invoice's rate reaches the gate ─────────────────
// invoiceAdvanceRate reads the rate off the order's live invoice and hands it
// to advanceStatus. Checked together because a rate that never leaves the
// invoice screen is exactly the state answer 10 was answering.

test("invoiceAdvanceRate: the live invoice's rate, and nothing from a cancelled one", () => {
  const inv = (over: Record<string, unknown> = {}) => ({
    status: "ISSUED", number: "PESPL/2780", currency: "USD",
    exchangeRate: 88.42, exchangeRateAt: "2026-09-09T06:00:00.000Z", ...over,
  });
  assert.deepEqual(invoiceAdvanceRate([inv()]), {
    rate: 88.42, currency: "USD", at: "2026-09-09T06:00:00.000Z", invoiceNumber: "PESPL/2780",
  });
  // answer 18 leaves one live invoice; a cancelled one lends nothing (the same
  // rule refuseCreate uses, so "the order's invoice" means one thing)
  assert.equal(invoiceAdvanceRate([inv({ status: "CANCELLED" })]), null);
  assert.equal(invoiceAdvanceRate([]), null);
  assert.equal(invoiceAdvanceRate(null), null);
  // a rate box never filled is the same situation as no invoice: type a rate
  assert.equal(invoiceAdvanceRate([inv({ exchangeRate: null })]), null);
  assert.equal(invoiceAdvanceRate([inv({ currency: null })]), null);
  // an UNDATED rate still converts — the stamp is what the screens complain
  // about, not what the arithmetic waits for
  assert.equal(invoiceAdvanceRate([inv({ exchangeRateAt: null })])?.rate, 88.42);
  assert.equal(invoiceAdvanceRate([inv({ exchangeRateAt: null })])?.at, null);

  // and end to end: the invoice's rate is what settles the order's advance
  const rate = invoiceAdvanceRate([inv()]);
  const a = advanceStatus({
    receipts: [{ kind: "ADVANCE", amount: 795780, currency: "INR" }],
    orderTotal: 30000, currency: "USD", advancePct: 30, rate,
  });
  assert.equal(a.satisfied, true);
  assert.equal(a.receivedAdvance, 9000);
});
