# ERP → Salesforce: the 30 mm list. Most of it is ours to unblock, not yours.

**Date:** 21 September 2026
**Re:** your *verified independently. Every figure matches. You are live.*

No credentials in this document. **Attached:** `30mm-codes-without-product.csv` — 87 rows,
each marked `A` or `B`.

---

Thank you for querying the org rather than taking our table. Checking `Series__c` for `{`
across all 845 rows was the better test — it verified the *fix*, where the counts only
verified the *totals*, and those are different questions.

## 1. The split, and the surprise in it

87 codes have 30 mm stock in the yard and no sellable product in your org. They divide
cleanly, and not the way either of us has been describing them:

| | Codes | Slabs behind them | Whose move |
|---|---|---|---|
| **A** — a `Product2` exists, but `IsActive = false` | **23** | **3,071** | **Ours.** The owner prices it; you activate what is already there. |
| **B** — no `Product2` at all | **64** | **1,370** | **Yours**, if the design should be sold at 30 mm. |

**Group A is more than twice group B by volume.** We have been treating the 24 unpriced
designs as a footnote to this list. They are the larger half of it. The five biggest are
Carrara Cloud (1,072 slabs), Carrara Royale (751), Calacatta Gold (395), Carrara Venatino
(338) and Calacatta Grey (147) — 2,703 slabs between them, sitting behind one pricing
decision rather than behind any catalogue work.

That is ours to chase, and we would rather say so than hand you 87 rows that all look
equally like your problem.

**23, not 24.** `QZ-ARABESCO-30` is the twenty-fourth inactive product and has no 30 mm
stock in the yard today, so it is not on the list. It will appear when any is produced.

## 2. Group B — what we are actually asking

For each of the 64: **either create the product, or tell us the design is not sold at 30 mm
and we will stop reporting it.** A "we don't sell that at 30" is as useful to us as a new
product — it takes the row off the worklist permanently instead of leaving it to be
re-reported every week.

The biggest is `QZ-SEAPEARL-30` — Sea Pearl, 485 slabs.

Some spellings in the design column are plainly one stone typed two ways (`Simply white`,
`ARLINA CHROMIA`, `irish Grey`). **The code is what matters** — it is folded and
case-insensitive, so those resolve to one code and one row. We are tidying the display
names separately; you do not need to wait for that.

## 3. The `Synced_At__c` window — your reading was right, the mechanism is narrower

You saw 13:00–13:10 where we had quoted 12:20–12:30, and put it down to "a later run
re-stamping, which is what a ten-minute cron should do."

Right conclusion, and worth stating precisely because it changes what you should expect to
see. **It is not per run — it is per row, by age.** A row is re-stamped only once its last
push is more than **thirty minutes** old. A ten-minute cron that re-stamped everything
would be 845 writes every ten minutes; what actually happens is:

```
18:20   0 rows      18:30   325 rows      18:40   520 rows      18:50   0 rows
```

The 325 slab-and-unit rows and the 520 sample rows first landed ten minutes apart, so they
age out ten minutes apart — two waves an hour, offset, with quiet runs between them. If you
ever see 845 in one run, something has changed and we would want to know.

The rule is written as an age rather than "every third run" deliberately: a run that is
skipped, fails or is retried would drift a counter, where an age repairs itself.

## 4. Open from our side

Nothing, once this list is with you. The sync has run clean since 18:00 — zero failures.

We will chase the owner on the 23, and tell you the moment any are priced so you can
activate them.

---

| | |
|---|---|
| **Us** | Chase the owner on the 23 — the bigger half |
| **You** | Group B: create, or tell us it is not a 30 mm product; sending address when convenient |
| **Owner** | Prices for the 24 inactive designs — **3,071 slabs** are behind this |
