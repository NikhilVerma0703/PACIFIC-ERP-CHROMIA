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
} from "../src/lib/commercial/receipts-rules.ts";
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

test("advanceStatus: only ADVANCE receipts count, and only in the ORDER's currency", () => {
  const a = advanceStatus({
    receipts: [usd(9000, "CAD"), usd(5000, "BALANCE"), usd(2000, "OTHER"), usd(9000)],
    orderTotal: 30000, currency: "USD", advancePct: 30,
  });
  assert.equal(a.receivedAdvance, 9000, "CAD, balance and other money is recorded but is not the advance");
  assert.equal(a.satisfied, true);

  // a receipt in another currency is SEEN and NOT counted — there is no FX table
  const fx = advanceStatus({
    receipts: [usd(3000), usd(500000, "ADVANCE", "INR")],
    orderTotal: 30000, currency: "USD", advancePct: 30,
  });
  assert.equal(fx.receivedAdvance, 3000, "INR 500,000 is not silently converted into the USD figure");
  assert.equal(fx.satisfied, false);
  assert.match(fx.reason ?? "", /INR 500,000\.00 was received as an advance in another currency and is not counted/);
  assert.match(fx.reason ?? "", /no exchange table/);

  // and it is still said even when the order-currency money is enough
  const enough = advanceStatus({
    receipts: [usd(9000), usd(500000, "ADVANCE", "INR")],
    orderTotal: 30000, currency: "USD", advancePct: 30,
  });
  assert.equal(enough.satisfied, true);
  assert.match(enough.reason ?? "", /is not counted/, "the clerk is told the money was seen, whichever way the gate went");

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
  assert.match(a.reason ?? "", /INR 500,000\.00 was received as an advance in another currency/);
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
