# ERP → Salesforce: two of our limits were wrong. Fixed. No edit access needed.

**Date:** 21 September 2026
**Re:** your *we checked the row against the live org. It is accepted.*

No credentials in this document.

---

Thank you for checking it the way you did. Splitting the values so that no
record satisfied the alert is a better test than the one we declined to run, and
it answered a question we could only have answered by setting your phone off.

## 1. You found two mistakes in our field handling. Both are fixed and deployed.

| Field | We had | It is | What that would have cost |
|---|---|---|---|
| `Error_Message__c` | 255 | **32,768** | A `Failed` row carries a thrown error's message, and those run long. We would have delivered one cut off at the first clause — at exactly the moment somebody was trying to read it. |
| `Payload__c` | 32,000 | **131,072** | Nothing in practice, as you say. But it was a guess at a default rather than a measured value, and it was wrong. |

Both constants now carry the measured number and a note saying it came from you,
so the next person to touch this file does not re-derive them from a default
table.

You are right that at ~140 bytes a summary will always fit. The cap stays as a
guard for the case where it does not, not as a routine filter.

## 2. Edit access on `Integration_Log__c`: thank you, but please don't grant it

You found that our user can create but not edit, and offered edit so we could
close an event off by updating its row. **We would rather you left it exactly as
it is.**

We have instead made the recovery a **second row** — `Status__c = Success`, same
touchpoint, written by the first run that writes normally after a stand-down:

> *"The stand-down has cleared. This run wrote 12 stock rows and 3 products;
> Salesforce is up to date again."*

Three reasons, in the order they decided it:

1. **Least privilege.** An integration that can edit `Integration_Log__c` can
   also rewrite the 26 `T5 - Sales order` rows nobody has agreed to touch. We
   would rather not hold that, and you should not have to trust us not to use
   it.
2. **It is the more honest record.** Editing the `Retry` row to `Success` erases
   the fact that the org was ever short of calls. Two rows keep both the outage
   and its end, with the times attached.
3. **Your own rule makes it free.** `Inbound AND Status IN (Retry, Failed)` — so
   a `Success` row lands quietly and pages nobody. We checked that against §3 of
   your note before writing it.

It fires on the first normal run after a stand-down and on no other, so it costs
one API call per outage, not one per run.

## 3. Your controlled pager test

Please go ahead, and thank you for doing it — we agree the first real stand-down
should not also be the first test of the alert. **We will not set `SF_ENABLED`
until you confirm it has fired.** Nothing on our side is waiting on anything
else.

One note so your test is not confused by us: until `SF_ENABLED` is set we write
nothing at all, so any row you see during the test is yours.

## 4. Go-live, unchanged

1. You confirm the pager test fired.
2. We message you immediately before setting `SF_ENABLED`, with the time.
3. We message you when the **first writing run has finished**.
4. You check by query and reply.

The sync cron runs every ten minutes, so step 3 follows step 2 within ten
minutes.

---

| | |
|---|---|
| **Us** | Wait for your pager test; then message before and after `SF_ENABLED`; send the 30 mm list after go-live |
| **You** | Fire the controlled test and confirm; **do not grant edit on `Integration_Log__c`** |
| **Owner** | Prices for the 24 inactive designs |
