# ERP → Salesforce: both alerts are built. Ready when you are.

**Date:** 21 September 2026
**Re:** your *both alerts, and go-live as soon as they're built*

No credentials in this document.

---

## 1. Both alert parts are built and deployed

### The `Integration_Log__c` row

Written exactly as you specified:

| Field | Value |
|---|---|
| `Direction__c` | `Inbound` |
| `Status__c` | `Retry` on a stand-down · `Failed` on a run that errors out |
| `Touchpoint__c` | `T3 - Inventory lookup` |
| `Object_Type__c` | `ERP_Stock__c` |
| `Error_Message__c` | the stand-down sentence |
| `Payload__c` | the run summary JSON when it fits, omitted when it does not |

**One row per stand-down event — not per run.** This is worth being precise
about, because the difference is large. The sync runs every ten minutes, so an
org that stays low on allowance for an afternoon is thirty-odd runs carrying one
sentence. Per run, that is up to 144 rows a day, all identical, and your alert
would fire on every one of them. An event begins on the first run that stands
down after a run that did not, and ends when a run writes normally again. One
row at the start of each.

There is a second reason, which is yours as much as ours: creating the row costs
an API call, spent at precisely the moment we have decided we have too few calls
left to write anything. One per event is affordable. One per run would mean the
alert about running out of calls was itself burning them.

`Payload__c` is dropped rather than truncated when the summary is large. Half a
JSON document is not JSON, and a field holding `{"wrote":{"stockRo` reads as
data while being nothing of the kind.

### The Telegram message

To our ops group: on the first stand-down, then at most once an hour while it
lasts. The hourly one is worded as a reminder — *"is still stood down"* — so
nobody reads it as a second, new fault.

If the `Integration_Log__c` row cannot be written, the Telegram message says so
outright rather than claiming Salesforce was told. That case matters: if the org
is out of API calls altogether, the row is the thing that cannot get through,
and your pager never rings. The Telegram message is then the only warning
anybody gets, and it now says as much.

### One thing we have deliberately not done

**We have not test-fired the `Integration_Log__c` row against your org.** A
`Retry` row pages you within the minute, by your own description, and we were
not willing to do that to prove a field mapping. The record shape is covered by
14 tests on our side — including one asserting `Touchpoint__c` contains a
**hyphen**, since an en-dash is a different string and would reject the whole
create, which would mean the alert about a failure failing silently.

**So the first time that row is written for real will be the first real
stand-down.** If the picklist rejects any value we have used, please tell us and
we will correct it the same day. Nothing else depends on it.

---

## 2. Go-live

Understood, and agreed:

1. ~~Build the alert~~ — done, deployed.
2. We message you immediately before setting `SF_ENABLED`, with the time.
3. We message you when the first writing run has finished.

The sync cron runs **every ten minutes**, so the first writing run begins within
ten minutes of the switch and we will confirm once it has completed rather than
once it has started.

We understand that switching the sync off stops future writes but does not undo
what has already been written.

## 3. On the two follow-ups

- **The 84 thirty-millimetre codes without a product** — we will send the list
  once go-live is confirmed, with the 24 unpriced designs marked separately so
  you can see which part of it the owner's pricing decision resolves.
- Noted on Astral Mist, thank you.

---

| | |
|---|---|
| **Us** | Message before and after `SF_ENABLED`; send the 30 mm list after go-live |
| **You** | Check the first run by query; tell us if any picklist value is rejected |
| **Owner** | Prices for the 24 inactive designs |
