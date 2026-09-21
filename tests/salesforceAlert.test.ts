// The stand-down alert's rate limiting, which is the whole of it.
//
// Both rules exist to stop an alert becoming noise: the sync runs every ten
// minutes, so an outage that lasts an afternoon is 30-odd runs all reporting
// the same sentence. Getting the grouping wrong is not a visible bug — it is a
// Telegram group that gets muted and a Salesforce administrator who filters the
// Retry rows, after which the alert exists and warns nobody. So it is tested.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planStandDownAlert, integrationLogRecord, standDownTelegram,
  TELEGRAM_REPEAT_MS, PAYLOAD_MAX,
} from "../src/lib/salesforce/alert-rules.ts";

const T0 = new Date("2026-09-21T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

/* ------------------------------------------------- the event, not the run */

test("the first stand-down alerts on both channels", () => {
  const plan = planStandDownAlert({ stoodDown: false, lastTelegramAt: null }, T0);
  assert.deepEqual(plan, { telegram: true, log: true, newEvent: true });
});

test("a second stand-down ten minutes later writes NO second log row", () => {
  // The administrator asked for one row per EVENT, and this is that rule. At
  // the ten-minute cadence, per-run would be 144 rows a day saying one thing.
  const plan = planStandDownAlert({ stoodDown: true, lastTelegramAt: T0 }, at(10 * 60_000));
  assert.equal(plan.log, false);
  assert.equal(plan.newEvent, false);
});

test("...and no second Telegram message either, inside the hour", () => {
  for (const mins of [10, 20, 30, 59]) {
    const plan = planStandDownAlert({ stoodDown: true, lastTelegramAt: T0 }, at(mins * 60_000));
    assert.equal(plan.telegram, false, `${mins} minutes in should stay quiet`);
  }
});

test("the hourly reminder goes out at exactly an hour, and not before", () => {
  const justUnder = planStandDownAlert(
    { stoodDown: true, lastTelegramAt: T0 }, at(TELEGRAM_REPEAT_MS - 1));
  assert.equal(justUnder.telegram, false);

  const exactly = planStandDownAlert(
    { stoodDown: true, lastTelegramAt: T0 }, at(TELEGRAM_REPEAT_MS));
  assert.equal(exactly.telegram, true);
  // Still the same event: the reminder must not write a second log row.
  assert.equal(exactly.log, false);
  assert.equal(exactly.newEvent, false);
});

test("an event that CLEARS and returns is a new event, and alerts in full", () => {
  // The run in between wrote normally, so prior.stoodDown is false again —
  // even though a Telegram went out only minutes ago. A fresh outage is news.
  const plan = planStandDownAlert({ stoodDown: false, lastTelegramAt: at(5 * 60_000) }, at(6 * 60_000));
  assert.deepEqual(plan, { telegram: true, log: true, newEvent: true });
});

test("inside an event with no recorded Telegram, it SENDS rather than skips", () => {
  // Either the send failed or the row that remembers it was not written. Both
  // mean nobody has been told; sending twice is the cheaper mistake.
  const plan = planStandDownAlert({ stoodDown: true, lastTelegramAt: null }, T0);
  assert.equal(plan.telegram, true);
  assert.equal(plan.log, false, "but the event still owns only one log row");
});

/* ------------------------------------------- the record, exactly as asked */

test("the log record carries the four fixed fields verbatim", () => {
  const rec = integrationLogRecord({ status: "Retry", message: "out of calls" });
  assert.equal(rec.Direction__c, "Inbound");
  assert.equal(rec.Status__c, "Retry");
  assert.equal(rec.Object_Type__c, "ERP_Stock__c");
  assert.equal(rec.Error_Message__c, "out of calls");
});

test("Touchpoint__c uses a HYPHEN, because the org's picklist does", () => {
  // An en-dash here is a different string and Salesforce rejects the whole
  // create — so the alert about a failure would itself fail. ADMIN-HANDOFF.md
  // §4.7 makes the same point about the T8 value.
  const rec = integrationLogRecord({ status: "Retry", message: "x" });
  assert.equal(rec.Touchpoint__c, "T3 - Inventory lookup");
  assert.ok(!String(rec.Touchpoint__c).includes("–"), "must not contain an en-dash");
});

test("a run that errored out is Failed, not Retry", () => {
  const rec = integrationLogRecord({ status: "Failed", message: "boom" });
  assert.equal(rec.Status__c, "Failed");
});

test("an over-long message is truncated rather than rejected by Salesforce", () => {
  const rec = integrationLogRecord({ status: "Retry", message: "x".repeat(5_000) });
  assert.equal(String(rec.Error_Message__c).length, 255);
});

test("a small payload is attached; an enormous one is dropped whole", () => {
  const small = integrationLogRecord({ status: "Retry", message: "m", payload: { a: 1 } });
  assert.equal(small.Payload__c, '{"a":1}');

  const huge = integrationLogRecord({
    status: "Retry", message: "m", payload: { blob: "y".repeat(PAYLOAD_MAX) },
  });
  // Not truncated: half a JSON document is not JSON, and a field holding
  // `{"blob":"yyyy` reads as data while being nothing of the kind.
  assert.equal("Payload__c" in huge, false);
});

test("a payload that cannot be serialised costs nothing", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const rec = integrationLogRecord({ status: "Retry", message: "m", payload: circular });
  assert.equal("Payload__c" in rec, false);
  assert.equal(rec.Error_Message__c, "m", "the rest of the record survives");
});

/* ----------------------------------------------------------- the wording */

test("the message distinguishes a new outage from the hourly reminder", () => {
  const first = standDownTelegram({ message: "m", newEvent: true, logged: true });
  const again = standDownTelegram({ message: "m", newEvent: false, logged: false });
  assert.match(first, /has stood down/);
  assert.match(again, /is still stood down/);
  assert.match(again, /hourly reminder/);
});

test("when the log row could not be written, the message says so outright", () => {
  // This is the case where Telegram is the ONLY warning anybody gets, because
  // the administrator's pager is driven by the Salesforce row. Saying "logged"
  // when we did not would be the worst possible sentence here.
  const t = standDownTelegram({ message: "m", newEvent: true, logged: false });
  assert.match(t, /could NOT be written/);
  assert.ok(!/so Salesforce has been alerted too/.test(t));
});
