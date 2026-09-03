import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for the four sales routes where the two doors into PACKING
// and the one button that chases outstanding money live. They read the source
// rather than call it — in the style of salesOfficeMoneyGuards.test.ts — because
// every one of these is a Next.js route handler that needs a session, a request
// and a live database before it will run, and what is being protected is not a
// return value but a RULE that was broken once already:
//
//   * PACKING is where the warehouse starts pulling slabs. Both doors into it
//     must check that the advance has settled; for a while only one did, and the
//     other could be reached in two hops from an unpaid order.
//   * The manual payment reminder must always go out. A version of it refused to
//     send when it could not compute a due date, which silenced 50 of the 102
//     unpaid divisions on the live database — about USD 1.18M, every one on a
//     DISPATCHED or DELIVERED order.
//
// Each assertion names the incident it stands for. If a rewrite makes one of
// these strings wrong, re-read the rule before re-writing the test.

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const src = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

const statusRoute   = src("app", "api", "sales", "orders", "[id]", "status", "route.ts");
const stockRoute    = src("app", "api", "sales", "stock-checks", "[id]", "route.ts");
const divisionRoute = src("app", "api", "sales", "orders", "[id]", "payment-division", "route.ts");
const reminderRoute = src("app", "api", "sales", "payments", "[id]", "send-reminder", "route.ts");

test("the status route refuses PENDING_STOCK_CHECK, and refuses it before it writes", () => {
  assert.match(
    statusRoute, /if \(status === "PENDING_STOCK_CHECK"\)/,
    "PENDING_STOCK_CHECK must be refused outright: it is written only by the two payment routes, after advanceIfAdvancesSettled() confirms the advance has landed. While it was a legal manual ladder step, one PATCH from a SALESPERSON put an unpaid order into Commercial's stock queue, and the stock-check route then moved it to PACKING",
  );
  const refusal = statusRoute.indexOf('if (status === "PENDING_STOCK_CHECK")');
  const write = statusRoute.indexOf("db.salesOrder.update");
  assert.ok(refusal > 0 && write > refusal, "the PENDING_STOCK_CHECK refusal must sit above the salesOrder.update — a check after the write refuses nothing");
});

test("the advance gate on the status route still covers PACKING and everything past it", () => {
  assert.match(
    statusRoute, /targetIdx >= PACKING_IDX/,
    "the gate must compare against PACKING's index, not `status === \"PACKING\"` — the single-step version was walked around by a PATCH straight to DISPATCHED",
  );
  assert.match(
    statusRoute, /d\.paidAt \|\| !!d\.overriddenAt/,
    "settled means paid_at OR overridden_at: an RM waiver releases an order exactly like a receipt, and without the override half a waived advance left the order locked with Mark Paid as the only way out",
  );
});

test("the stock-check route checks the advance before it moves an order to PACKING", () => {
  const gate = stockRoute.indexOf('type: "ADVANCE"');
  const packing = stockRoute.indexOf('status: "PACKING"');
  assert.ok(gate > 0, "AVAILABLE/PARTIAL writes salesOrder.status = PACKING, so this route needs its own advance assertion — trusting the order to already be in PENDING_STOCK_CHECK was the hole");
  assert.ok(packing > gate, "the advance check must run before the PACKING write");
  const checkWrite = stockRoute.indexOf("db.salesStockCheck.update");
  assert.ok(checkWrite > gate, "the check must also run before the stock-check row is written, so a refusal leaves nothing half-done and Commercial keeps their typed notes");
  assert.match(
    stockRoute, /ADVANCE_UNPAID/,
    "the refusal must carry the ADVANCE_UNPAID code the rest of the app already keys on",
  );
});

test("only overriding an ADVANCE division releases the order", () => {
  const call = divisionRoute.indexOf("advanceIfAdvancesSettled(orderId, callerId)");
  assert.ok(call > 0, "the override must still release an order deadlocked by a waived advance");
  const guarded = divisionRoute.slice(Math.max(0, call - 200), call);
  assert.match(
    guarded, /target\?\.type === "ADVANCE"/,
    "the release must be guarded by the overridden division's type. Unguarded, waiving a BL_TO_PAY or CAD on an order in PENDING_PAYMENT moved it to PENDING_STOCK_CHECK and created a stock check, logged as 'All advance payments settled' — a state change nobody asked for",
  );
  const read = divisionRoute.indexOf("db.salesPaymentDivision.findFirst");
  const update = divisionRoute.indexOf("SET overridden_at = now()");
  assert.ok(read > 0 && read < update, "read the division type before the UPDATE: if that read throws, nothing has been written and the caller can retry");
});

test("the manual payment reminder always sends — it never refuses for a missing due date", () => {
  assert.doesNotMatch(
    reminderRoute, /Cannot determine the due date/,
    "the hard refusal must not come back. Measured on the live database 2026-09-03, it silenced 50 of 102 unpaid divisions (48 BL_TO_PAY with no bl_date, 2 CAD with no ETA or arrival), about USD 1.18M, every one on a DISPATCHED or DELIVERED order — goods gone, money outstanding, and no way to ask for it",
  );
  const send = reminderRoute.indexOf("await sendMail(");
  assert.ok(send > 0, "the route must still send");
  // No 400 may sit between resolving the due date and sending: the only
  // legitimate refusals (already paid, already waived, client has no email
  // address) are all decided further up.
  const resolve = reminderRoute.indexOf("resolveDueDate(division");
  assert.ok(resolve > 0 && resolve < send, "the due date is still resolved the same way the daily cron does it, so manual and automatic mail cannot disagree");
  assert.doesNotMatch(
    reminderRoute.slice(resolve, send), /status: 400/,
    "nothing between working out the due date and sending may refuse the send — the mail's job is to chase the money, not to prove a date",
  );
});

test("the reminder's fallback chain runs proven date -> books date -> milestone -> no date", () => {
  for (const [needle, why] of [
    ["resolveDueDate(division", "1. the milestone computation the cron uses"],
    ["division.dueDate", "2. the stored books-import due_date — a real commitment from the pre-ERP ledger"],
    ["commercialInvoiceDate", "3. a dated milestone, quoted as a fact and never as a deadline (21 live divisions reach this step)"],
    ["noDueDateBody", "4. amount and shipment stage only, claiming no date at all (29 live divisions reach this step)"],
  ] as [string, string][]) {
    assert.ok(reminderRoute.includes(needle), `the fallback chain must keep step ${why}`);
  }
  assert.ok(
    reminderRoute.indexOf("if (!dueDate && division.dueDate)") > reminderRoute.indexOf("resolveDueDate(division"),
    "the stored due_date is a fallback, not the first choice: it was the original `division.dueDate ?? new Date()` that put today's date on every reminder",
  );
});

test("the no-due-date reminder never asserts a due date", () => {
  const start = reminderRoute.indexOf("function noDueDateBody");
  assert.ok(start > 0, "noDueDateBody must exist — it is the whole reason the mail can go out without a date");
  const body = reminderRoute.slice(start, reminderRoute.indexOf("\n}", start));
  assert.doesNotMatch(
    body, /Due Date|due by|due on/i,
    "this variant exists precisely because the due date is unknown; a 'Due Date:' row here would be the same lie as the original `?? new Date()`",
  );
  assert.match(body, /Amount Outstanding:/, "it must still state what is owed — that is the point of sending it");
  assert.match(body, /remittance advice/, "and still ask for the money");
});
