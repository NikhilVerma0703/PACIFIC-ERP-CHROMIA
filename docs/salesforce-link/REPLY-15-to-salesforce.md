# ERP → Salesforce: the 30 mm list. Most of it is ours to unblock, not yours.

**Date:** 21 September 2026
**Re:** the 30 mm codes, as promised after go-live

No credentials in this document. **Attached:** `30mm-codes-without-product.csv` — 87 rows,
marked `A` or `B`.

---

## The split, and the surprise in it

87 codes have 30 mm stock in the yard and no sellable product in your org. They divide
cleanly, and not the way we expected:

| | Codes | Slabs behind them | Whose move |
|---|---|---|---|
| **A** — a `Product2` exists, but `IsActive = false` | **23** | **3,071** | **Ours.** The owner prices it; you activate what is already there. |
| **B** — no `Product2` at all | **64** | **1,370** | **Yours**, if the design should be sold at 30 mm. |

**Group A is more than twice group B by volume.** We had been describing the 24 unpriced
designs as a footnote to this list; they are in fact the larger half of it. The five
biggest are Carrara Cloud (1,072 slabs), Carrara Royale (751), Calacatta Gold (395),
Carrara Venatino (338) and Calacatta Grey (147) — 2,703 slabs between them, all sitting
behind one pricing decision rather than any catalogue work.

That is ours to chase, and we are saying so plainly rather than sending you a list of 87
things that look equally like your problem.

**23, not 24.** `QZ-ARABESCO-30` is the twenty-fourth inactive product, and it has no 30 mm
stock in the yard today, so it is not on this list. It will appear the moment any is
produced.

## Group B — what we are asking

For each of the 64: **either create the product, or tell us the design is not sold at 30 mm
and we will stop reporting it.** A "we don't sell that at 30" is as useful to us as a new
product — it takes the row off the worklist permanently instead of leaving it to be
re-reported every week.

The biggest is `QZ-SEAPEARL-30` — Sea Pearl, 485 slabs.

You will see some spellings in the design column that are plainly the same stone typed two
ways (`Simply white`, `ARLINA CHROMIA`, `irish Grey`). **The code is what matters** — it is
folded and case-insensitive, so those all resolve to one code and one row. We are
separately tidying the display names at our end; you do not need to wait for that.

## How to read the numbers

`slabs_available` is stock **approved for sale** at the moment we ran this — the same
filter the sync publishes through, so it will not disagree with `ERP_Stock__c`. It moves
daily. Treat the ordering as reliable and the exact figures as a snapshot.

One thing worth stating because it explains a discrepancy you might otherwise find: the
yard also holds stock that is **withheld from sale** by our own approval gate, and that
stock is not in these counts, not in `ERP_Stock__c`, and not visible to your reps. That is
deliberate and it is the same rule your reps already see through the ERP.

## While you are in there

Nothing else is outstanding from us. The sync has been running clean since 18:00 — zero
failures, and it re-stamps `Synced_At__c` on everything every thirty minutes, so you will
see a write wave twice an hour rather than constant traffic. That is the freshness
behaviour you asked for, working as intended.

---

| | |
|---|---|
| **Us** | Chase the owner on the 23 — they are the bigger half |
| **You** | Group B: create, or tell us it is not a 30 mm product |
| **Owner** | Prices for the 24 inactive designs — 3,071 slabs are behind this |
