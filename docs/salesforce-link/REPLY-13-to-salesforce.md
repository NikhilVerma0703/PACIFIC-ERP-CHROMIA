# ERP → Salesforce: before you check — two of your expected numbers are wrong, and one badly

**Date:** 21 September 2026
**Re:** your *the pager fired. You are clear to set `SF_ENABLED`.*

No credentials in this document.

---

Thank you for testing both legs. The point about a flow entry formula reading correctly
and still evaluating false at runtime is exactly the kind of thing that is only ever
found by firing it, and we would not have known to doubt it.

**Before we switch on, please update your check list.** We re-ran the dry run against the
live org this evening and two of the five figures you are expecting no longer match. One
is ordinary drift. The other is a measurement mismatch that would have looked alarming.

## 1. `Product_Missing__c = true`: expect **197**, not 93

This is the one that matters. It is not drift — 93 and 197 were never the same
measurement.

`Product_Missing__c` is set **per stock row** whose product lookup is null, at any
thickness. Tonight:

```
321 published slab lines  =  124 matched to a Product2
                          +  197 with no product   ->  Product_Missing__c = true
```

93 is close to the **design-level** count we have been quoting throughout — the unmapped
worklist, which counts designs rather than rows, and which tonight reads **102 designs
across 105 spellings**. Our guess is that one of those figures was copied into a list of
the other kind. Nobody has miscounted anything; the two numbers just answer different
questions and have been sitting under one label.

Had we not caught it, you would have run `COUNT(*) WHERE Product_Missing__c = true`
straight after go-live, read 197 against an expected 93, and had to work out whether the
first live run had double-written something. We would rather you heard it from us first —
the same courtesy you paid us about the External sender tag.

We have changed our run summary to report this row count outright, beside the 30 mm code
count, so the figure you verify by query is one we publish rather than one you have to
reconstruct.

## 2. `ERP_Stock__c` rows: expect about **845**, not 834

Ordinary drift, and in the direction you would expect — the yard has produced and
dispatched since the last rehearsal. Composition:

| | |
|---|---|
| Published slab lines | 321 |
| Sample, finish and unit rows | 524 |
| **Total `ERP_Stock__c` rows** | **845** |

It will have moved again by the time we switch on. Treat it as "about 845", not as an
exact target.

## 3. The rest of your list is unchanged

| Check | Expect |
|---|---|
| Products with stock fields populated | **124** of 169 — exactly as you have it |
| `Synced_At__c` recent on every row | yes, stamped with the run's `asOf` |
| *Samples in stock* view | no never-stocked rows |

For completeness, tonight's other figures: 17,478 slabs published across those 321 lines,
2,563 slabs held back as unmapped, 1,066 withheld as sales-unapproved, 892 withheld as
trial. Two API calls for the whole rehearsal; the org sat at 2,750 of 160,000.

## 4. On the External sender tag

Noted, and thank you for saying so rather than letting us find it. It does not block us.
We would only ask that the verified address is in place before anyone starts filtering on
the sender — an alert that lands in spam is the failure mode this whole exercise exists to
avoid.

## 5. Go-live

Steps 1 and 2 are done. We will message you immediately before setting `SF_ENABLED`, with
the time, and again when the first writing run has **finished**.

---

| | |
|---|---|
| **Us** | Message before and after `SF_ENABLED`; send the 30 mm list after go-live |
| **You** | Update the check list to **197** and **~845**; verify the sending address |
| **Owner** | Prices for the 24 inactive designs |
