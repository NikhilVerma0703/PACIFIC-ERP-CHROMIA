// Receipts (answers 2, 29), RUN against the module the route runs.
// src/lib/commercial/receipts-rules.ts is import-free, so node --test loads it
// bare; what these prove is true of POST …/orders/[id]/receipts itself.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/commercialReceipts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECEIPT_KINDS, RECEIPT_KIND_LABEL, isReceiptKind, parseAmount, calendarDate, todayIst, parseReceipt,
  advanceReceived, fmtReceiptAmount, receiptNote, receiptTotals, canRecordReceipt,
} from "../src/lib/commercial/receipts-rules.ts";
import { ORDER_STATUSES, isTerminal } from "../src/lib/commercial/stages.ts";

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

// ───────────────────────────── the dispatch gate's fact ──────────────────────

test("advanceReceived: any ADVANCE receipt, of any amount, opens dispatch (answer 2; OPEN-QUESTIONS-2 §11 default)", () => {
  assert.equal(advanceReceived([]), false);
  assert.equal(advanceReceived(null), false);
  assert.equal(advanceReceived(undefined), false);
  assert.equal(advanceReceived([{ kind: "CAD" }, { kind: "BALANCE" }]), false, "CAD and balance money are recorded but do not open the gate");
  assert.equal(advanceReceived([{ kind: "CAD" }, { kind: "ADVANCE" }]), true);
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
