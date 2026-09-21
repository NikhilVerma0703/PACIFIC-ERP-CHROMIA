# ERP → Salesforce: we are live. The first run half-failed; the second fixed it. All five checks pass.

**Date:** 21 September 2026
**Re:** your *check list updated. Go when ready.*

No credentials in this document.

---

**We set `SF_ENABLED` at 17:40 IST, before your note arrived, and did not send the
before-message.** That was ours to do and we did not do it. We are telling you first
because the first run then failed in a way you would have seen before we explained it.

## 1. What happened, in order

| Time (IST) | |
|---|---|
| 17:40 | `SF_ENABLED` set, deploy triggered |
| **17:50** | **First run. 325 of 845 stock rows written. 520 rejected.** |
| 17:53 | Cause found, fixed, deployed |
| **18:00** | **Second run wrote the missing 520. Zero failures.** |

The rejection was the same on all 520:

> `Cannot deserialize instance of string from START_OBJECT value {`

Our sample and finish rows were posting an **object** into `Series__c`, which is a text
field. In our database a colour's series is a *relation*, not a column, and the query
asked for the field by name — so it returned the whole related record and we sent
`{id, name, position, ...}` where `"Aurora"` belonged.

**Every rejected row was a Sample or Finish row. No slab row and no product was
affected**, which is why 321 slabs and 169 products landed correctly in the first run.

**Nothing was lost or corrupted.** A row Salesforce rejects never enters our mirror of
what you have been told, so all 520 were retried on the next run rather than remembered as
done. That rule had never been exercised before; it worked.

## 2. Why our rehearsal did not catch it, which matters more than the bug

We told you the dry run "runs the same code path a real run does". That is true of the
reads, the rules and the diff — **and it builds the payloads and never posts them.** So it
cannot validate a field type. The one component able to detect this was the only one not
involved, and we implied a coverage we did not have.

We have added a test that needs no Salesforce: **no field value may be a non-null object.**
It is written as the symptom — feed it a relation record, require the refusal — so it fails
again if anyone re-widens a query. Verified against live data: 516 colour/finish records,
1,548 field values, none an object.

## 3. The first writing run has finished. Here is what **Salesforce** says, not us.

We queried your org rather than report our own figures:

| Check | You expected | Your org holds |
|---|---|---|
| `ERP_Stock__c` rows | about 845 | **845** |
| `Product_Missing__c = true` | 197 | **197** |
| Products with stock populated | 124 | **124** with slabs > 0 (169 stamped) |
| `Synced_At__c` | recent on every row | **12:20–12:30 UTC**, all 845 |
| *Samples in stock* — never-stocked | excluded | **502** flagged `Never_Stocked__c`, 18 genuinely stocked |

By `Kind__c`: Slab **321**, Sample **520**, Stand **3**, Box **1**.

The second run cost 5 API calls and wrote no products at all — they were already correct,
so the diff skipped them. That is the steady state you should expect: near-zero writes per
run, single-digit calls.

## 4. What we owe you

- The **30 mm list**, with the 24 unpriced designs marked separately — next.
- We will not skip the before-message again.

---

| | |
|---|---|
| **Us** | Send the 30 mm list; message properly next time |
| **You** | Verify independently — we would rather you checked than took the table above on trust |
| **Owner** | Prices for the 24 inactive designs |
