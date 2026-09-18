# ERP → Salesforce: the four confirmations, and the re-run numbers

**Date:** 18 September 2026
**Re:** your *your answers received, and our side done*

Thank you for the `Never_Stocked__c` filter and the `ERP_Stock_As_Of__c` relabel. Both noted,
and the relabel needs nothing from us as you say — we read the API name, not the label.

---

## 1. Yes, the 1,000-a-day counter is built

Both guards exist now, and they are the two you asked for, in the order you asked for them.

- **Ours, first.** `client.ts` counts every request the integration sends — the token mint
  included, because it is a real call against your org even though it is not a REST one. The
  day's total is summed from our own run records over a rolling 24 hours.
- **Yours, second.** The `Sforce-Limit-Info` check, below 10% of the org's allowance remaining.

One honesty on the second: a **missing** `Sforce-Limit-Info` header reads as *unknown*, not as
*empty*. If we treated a missing header as "the org is out", one absent header would stand the
sync down for ever.

## 2. What happens when a guard trips

Plainly, because the answer has a gap in it and you should have the gap too.

**It stops that RUN, not the day.** Both guards are asked after every read and before the
first write, so a run that trips:

1. has already read everything, and returns the complete summary of what it *would* have sent;
2. writes **nothing** — no product, no stock row;
3. sets a `stoodDown` field naming which guard tripped and the numbers behind it, e.g.
   *"The org is below 10% of its daily API allowance (145,000 of 160,000 used), so nothing was
   written. Stock is unchanged in Salesforce and the next run will send it."*;
4. records the run, so the next run's daily total includes it.

The next run ten minutes later asks again. If the condition has cleared it proceeds normally;
nothing needs resetting and nothing is stuck. Because every value we write is absolute rather
than incremental, a skipped run costs nothing but freshness — the following run sends the
current number, not a backlog.

**AND NOTHING TELLS ANYONE.** That is the gap. The reason is in the JSON response, which means
it is visible to whoever opens the URL and to nobody else. There is no email, no Telegram
message and — by your own earlier question — no `Integration_Log__c` row. A sync that stood
down every run for a week would look, from your side, exactly like a sync with nothing to say.

We would rather fix that than have you discover it. Three options, and we are happy with any:

- **a Telegram message to the ERP operations group** on the first stand-down and then at most
  once an hour — our usual alerting path, nothing new for you;
- **an `Integration_Log__c` row** on a stand-down only, not per run and not per record. One row
  per event, so your storage arithmetic stays where you put it;
- **nothing** — you watch it from the Vercel cron log, where a stand-down is a 200.

Tell us which and we will build it before go-live.

## 3. Confirmed: we only ever match ACTIVE products

Your caution was exactly right, and we checked it against the live org rather than against our
own memory. Those four records are there:

```
QZ-MATCHAMIST-12   inactive   Family = "Quartz"
QZ-MATCHAMIST-12   ACTIVE     Family = "Quartz Slab"
QZ-MATCHAMIST-20   inactive   Family = "Quartz"
QZ-MATCHAMIST-20   ACTIVE     Family = "Quartz Slab"
```

**The inactive twins fail our filter twice over.** Our one product query is:

```sql
SELECT Id, Name, ProductCode, ERP_SKU__c, IsActive, Family
  FROM Product2 WHERE IsActive = true AND Family = 'Quartz Slab'
```

so they are excluded by `IsActive` and, independently, by `Family` — the old records carry
`"Quartz"`, not `"Quartz Slab"`. Run against the org today, that query returns **exactly two**
Matcha Mist records, both active.

Two further points, since the underlying worry is "can a code resolve to two records":

- Across the whole `Quartz Slab` family there is **no ProductCode held by two active records**,
  so the match cannot be ambiguous even in principle.
- We **never address a product by its code**. The code is only how we recognise it; the write
  itself is `PATCH` by the record `Id` we read in that same run. A duplicate code could not
  cause a write to the wrong record even if one existed.

Mocha Mist's slabs will therefore reach `QZ-MATCHAMIST-20` and `QZ-MATCHAMIST-12` by Id, split
by the thickness each slab actually is.

## 4. Confirmed: section 4 publishes as unlinked lines

Yes — exactly as you specified. A design we cannot match now goes out as an `ERP_Stock__c` row
with `Product__c` blank and `Product_Missing__c` = true, and stays on our own worklist at the
same time. Published and "needs a product" are different questions and we answer both.

Your trial rule is kept: names carrying a trial marker are still withheld. One refinement we
made after the last reply — **a real product beats the marker.** The org sells
`QZ-ASTRALMISTKREOSTRAIL2-20`, and a word test for "trail" was withholding 7 slabs of it. A
string test cannot outrank your catalogue, so the marker now only decides names Salesforce has
never heard of.

---

## 5. The re-run

Read against live data, 18 September. Nothing written.

```
 19,357  slabs AVAILABLE and whole
   -873  withheld: batch not sales-approved
 -------
 18,484  sellable
 -2,509  design we cannot match to a product   (published unlinked, section 4)
   -361  thickness we cannot classify
   -874  trial stock, withheld on purpose
 -------
 17,249  published, as 310 stock lines
```

| | |
|---|---|
| Stock rows to write on the first run | **834** |
| Products, of 169 active | **124 matched**, 10 not at this thickness, 35 no ERP design |
| Designs published with `Product_Missing__c` = true | 93 |
| 30 mm codes still without a product | 84 |
| API calls this run | **1** (the token was already warm; a cold dry run is 2) |
| Your org's rolling 24 h usage when we ran | 4,062 of 160,000 |
| Stood down | no |
| **Written** | **nothing — `{products: 0, stockRows: 0, failures: []}`** |

Matcha Mist is matched and no longer on the unmapped list.

Production holding 0 `ERP_Stock__c` rows is expected and correct: `SF_ENABLED` is still unset,
so the cron reads every ten minutes and writes nothing. Scheduling the job and allowing it to
write are two separate switches, and only the first is on.

---

## Where that leaves us

| | |
|---|---|
| **You** | Read the numbers above; tell us which stand-down alert you want; agree a go-live time |
| **Us** | Build the alert, then set `SF_ENABLED` at the time you name |
| **Owner** | Prices for the 24 inactive designs, so you can activate them |

One thing we will not say again, having said it wrongly once: turning the sync off stops
future writes. **It does not undo values already written.** There is no rollback.
