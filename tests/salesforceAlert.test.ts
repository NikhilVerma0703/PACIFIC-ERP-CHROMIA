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
  planStandDownAlert, planRecoveryAlert, integrationLogRecord, standDownTelegram,
  recoveryMessage, recoveryTelegram,
  TELEGRAM_REPEAT_MS, PAYLOAD_MAX, ERROR_MAX,
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

test("the field caps are the org's real ones, not assumed defaults", () => {
  // Both were wrong until the administrator read the live field definitions
  // for us (REPLY-11 §1). Error_Message__c was capped at 255 on an assumption
  // that it was a Text(255); it is a long text of 32,768. A 5,000-character
  // failure message used to arrive cut off at the first sentence.
  assert.equal(ERROR_MAX, 32_768);
  assert.equal(PAYLOAD_MAX, 131_072);

  const rec = integrationLogRecord({ status: "Retry", message: "x".repeat(5_000) });
  assert.equal(String(rec.Error_Message__c).length, 5_000, "5k fits and must not be cut");

  const huge = integrationLogRecord({ status: "Failed", message: "x".repeat(40_000) });
  assert.equal(String(huge.Error_Message__c).length, ERROR_MAX, "past the cap it is trimmed to fit");
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

/* --------------------------------------------- the other end of the event */

test("a normal run after a normal run says nothing at all", () => {
  // The overwhelmingly common case. It must cost no Salesforce call.
  assert.deepEqual(planRecoveryAlert({ stoodDown: false, lastTelegramAt: null }),
    { log: false, telegram: false });
});

test("the first normal run after a stand-down announces the recovery", () => {
  assert.deepEqual(planRecoveryAlert({ stoodDown: true, lastTelegramAt: null }),
    { log: true, telegram: true });
});

test("the recovery is a Success row, which by their rule pages nobody", () => {
  // REPLY-11 §3: their alert fires on Inbound AND Status IN (Retry, Failed).
  // A Success row is how we close the event off WITHOUT needing edit access on
  // Integration_Log__c — which we were offered and declined, because a second
  // row needs only the Create we already hold, and an integration that can edit
  // that object can also rewrite the 26 T5 rows nobody agreed to touch.
  const rec = integrationLogRecord({ status: "Success", message: recoveryMessage({ products: 3, stockRows: 12 }) });
  assert.equal(rec.Status__c, "Success");
  assert.equal(rec.Direction__c, "Inbound");
  assert.ok(!["Retry", "Failed"].includes(String(rec.Status__c)), "must not page anyone");
});

test("the recovery sentence counts singular and plural correctly", () => {
  assert.match(recoveryMessage({ products: 1, stockRows: 1 }), /1 stock row and 1 product;/);
  assert.match(recoveryMessage({ products: 0, stockRows: 2 }), /2 stock rows and 0 products;/);
});

test("the recovery message reads as good news, not another alarm", () => {
  const t = recoveryTelegram(recoveryMessage({ products: 3, stockRows: 12 }));
  assert.match(t, /writing again/);
  assert.ok(!/stood down/.test(t));
});

/* ------------------------------------------------ no object may reach a field */
// THE FIRST LIVE RUN REJECTED 520 OF 845 ROWS, and this is the shape of the
// fault that did it. `ProductColour.series` is a RELATION; Prisma's
// `series: true` returns the whole related record, and Series__c is a text
// field, so every sample and finish row posted `{id, name, position, ...}`
// into it: "Cannot deserialize instance of string from START_OBJECT value {".
//
// The bug was invisible in review — `f.colour?.series` reads exactly like a
// column — and invisible in the dry run, which builds the identical payloads
// and never posts them. Only Salesforce could tell us, and it told us in
// production. So the rule gets a test that does not need Salesforce: NO field
// value may be a non-null object. Scalars, strings, numbers, booleans, null.
import { slabRows, sampleRow, finishRow, unitRow } from "../src/lib/salesforce/stock-rules.ts";

const scalarOnly = (fields: Record<string, unknown>, where: string) => {
  for (const [k, v] of Object.entries(fields)) {
    assert.ok(
      v === null || typeof v !== "object",
      `${where}: ${k} is ${JSON.stringify(v)} — an object cannot go into a Salesforce field`,
    );
  }
};

test("a sample row carrying a relation object is refused by the rule", () => {
  // Exactly what the live run sent, reduced: the related record in place of
  // its name. Written as the SYMPTOM, so the test fails if anyone re-widens
  // the select.
  const related = { id: "cuid", name: "Classic", position: 1 };
  const bad = sampleRow("s1", "label", 3, { Series__c: related });
  assert.throws(() => scalarOnly(bad.fields, "sample"), /cannot go into a Salesforce field/);

  const good = sampleRow("s1", "label", 3, { Series__c: related.name });
  scalarOnly(good.fields, "sample");
});

test("every row builder emits scalars only", () => {
  scalarOnly(sampleRow("s", "l", 1, { Series__c: "Classic", Colour__c: "Ash", Finish__c: null }).fields, "sample");
  scalarOnly(finishRow("f", "l", { Series__c: "Classic", Colour__c: null }).fields, "finish");
  scalarOnly(unitRow("u", "Box", "BOX", 2).fields, "unit");
  // Split and unsplit both: the three fields the split adds (Finish__c,
  // Grade__c, Series__c) are strings or null, never an object.
  const [slab] = slabRows({ canonical: "Aurora", mm: 20, code: "QZ-AURORA-20", available: 5 } as never, null);
  scalarOnly(slab!.fields, "slab");
  for (const r of slabRows({
    canonical: "Aurora", mm: 20, code: "QZ-AURORA-20", available: 5,
    splits: [{ finish: "Polished", grade: "A", available: 3 }, { finish: null, grade: null, available: 2 }],
  } as never, null, "Aurora")) scalarOnly(r.fields, "slab split");
});
