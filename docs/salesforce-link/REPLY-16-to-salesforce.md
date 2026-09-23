# ERP → Salesforce: polish, grade and series — it is (b), and here is the key

**Date:** 23 September 2026
**Re:** your REPLY-10, *please send polish, grade and series on every stock line*

No credentials in this document.

---

## 1. The answer is (b)

**Polish and grade belong to the slab, not to the line.** QC writes both on every slab it
passes, so a single design at a single thickness is routinely in the yard in more than one of
each at the same time — Arva White 20 mm as Polished A *and* Polished B, say. Keyed by design
and thickness alone, those would overwrite each other in your upsert, exactly as you
predicted, and the split would never be visible.

**Series is (a).** It belongs to the design, so every row of a design carries the same one
and it does not affect the key.

## 2. The new key

```
SLAB|<ProductCode>|<FINISH>|<GRADE>
```

| Row | `ERP_Key__c` |
|---|---|
| Arva White 20 mm, Polished, grade A | `SLAB\|QZ-ARVAWHITE-20\|POLISHED\|A` |
| Arva White 20 mm, Polished, grade B | `SLAB\|QZ-ARVAWHITE-20\|POLISHED\|B` |
| Arva White 20 mm, Leathered, no grade given | `SLAB\|QZ-ARVAWHITE-20\|LEATHERED\|-` |
| Arva White 20 mm, neither given | `SLAB\|QZ-ARVAWHITE-20\|-\|-` |

The rules, so you can reason about it without us:

- **Always four segments.** The product code is unchanged from today.
- **Finish and grade segments are uppercase**, spaces become `_`, and `-` means the yard gave
  no value. So `Printing` and `PRINTING` are one row, not two.
- **A `|` typed into a value becomes `/`**, so no value can ever add a fifth segment.
- **Never longer than 80 characters**, the length we have on record for `ERP_Key__c`, for any
  product code up to 55 characters. Your longest today is 27. A finish or grade long enough to break
  the limit is shortened to its first seven characters plus a short fixed hash of the whole value.
  If even that won't fit, which takes a product code over 41 characters, both segments become the
  hash alone. Either way, two long values stay two rows and the same value always gives the same
  key. No value in the yard today is anywhere near that long.
- **`SAMPLE|`, `FINISH|` and `UNIT|` keys do not change.** Only slab rows split.

## 3. How the switch happens — and what it will not do

**The split is a switch of its own, separate from us deploying the code.** Until we turn it on, the
sync keeps writing your 328 slab rows as it does today: same keys, same fields, and no new rows. Two
small corrections do apply from deploy, both in §4: slabs with a cut grade are left out, and a design
typed two ways is named by its commoner spelling. The first changes a handful of rows once. The
second follows whichever spelling currently covers more slabs, so it can move again later. We turn
the switch on only after your answers to §5.

**When it is on, the rule for each design and thickness is: the old row carries exactly the slabs
you don't yet hold a new row for.** No more, so nothing is counted twice. No less, so nothing
disappears. The new split rows go out first. Then:

- **You accept all of them:** the old `SLAB|<code>` row is retired in the same run. It is written
  once with `Available_Qty__c = 0` and `Retired__c = true`, and its `Name` is left alone. **Nothing
  is deleted**, so a sample request line that points at an old row still resolves.
- **You accept some:** the old row stays live, carrying just the slabs of the ones you refused. If
  Polished A goes in and Polished B is refused, the old row shows Polished B's count. Adding up
  every live row for the design still gives the true total.
- **You refuse all of them:** the old row stays live and carries the whole line. It is updated each
  run as it is today, so nothing looks different to a rep. This is the case in §5.1: if our user
  cannot edit `Grade__c`, every new row is refused.

**How a refusal is retried.** Until you have accepted at least one new row, each run sends only the
first 200 of them. If you refuse all 200, the rest wait for the next run. So a blanket refusal (the
§5.1 case) costs one API call a run, not the whole object, and cannot use up the daily call budget
and stop the rest of the sync. **Once you have accepted any new row, that brake is off:** every run
sends everything as normal, and a row you refuse on its own merits is re-sent every run until you
accept it, as any refused row is today. Refused rows appear in our run log by key: the first 50 per
run, with a count of the rest.

**Two windows where a design's total can briefly read wrong, for completeness.** In both, the old
row keeps its previous count while the new rows beside it have moved on. So the total reads high if
the old row should have shrunk, or low if it should have grown.

- *A run cut off partway through writing.* We record each batch of 200 as Salesforce answers it,
  so a run that stops keeps everything it had already committed.
- *A refused write to the old row itself,* its retirement or its new remainder.

The next run whose write to the old row succeeds puts it right. That is normally ten minutes
later, but not necessarily: if Salesforce is short of API calls, the sync stands down until it
isn't. A refused old-row write is always named in our run log by its key, ahead of any other
refusal, and stays wrong until you accept it.

**If Salesforce rejects a whole request** rather than individual rows, which is how a field hidden
from our user usually arrives, only that batch's rows count as refused, and the run carries on.
Rows that carry `Grade__c` are sent in batches of their own. So a missing permission can only ever
cost the new rows, never your samples, stands or the old slab rows.

**A product that is sold out at the moment of the switch keeps its row.** It has no stock, so there
is nothing to split it into. Its old row stays as today's searchable "0 — none right now" until stock
comes back. Then it splits like every other.

**What the switch run looks like:** the new split rows, plus one retirement for each old row whose
replacement you accepted. Up to 328 — the dry run in §6 gives the exact number.

**Afterwards, the rows are finer, so there are more of them:** one per finish and grade, where today
there is one per design and thickness. Everything else is as today. A run sends the rows that changed,
plus the half-hourly re-stamp of `Synced_At__c` on rows not sent within the last 30 minutes. A split row
that sells out stays as a live zero, exactly as a sold-out line does today. It is not re-stamped, so it
reads `Stale__c` within the hour. With finer rows you will see more of these than before.

## 4. What goes in each field

| Field | What we send | Blank when |
|---|---|---|
| `Finish__c` | **Polished, Suede, Matte or Leathered** — the owner's four words | QC recorded no polish |
| `Grade__c` | **What QC wrote**: A, A2, B, C, Printing … trimmed | QC recorded no grade, typed a dash, or wrote *Not graded yet* |
| `Series__c` | **Our colour chart's series name, unchanged**: Aurora, Celestia, Eclipse, Kosmic, Luminara, Nebula, **Solids** | the design has no series in the ERP — see below; this will be most rows |

**Two deliberate exceptions to "send your own values, unchanged", and we would rather say so than
have you find them.**

*Finish.* The yard's polish field says `Polish`, `Honed` and `Leathered`; the owner's colour chart
says `Polished`, `Matte` and `Leathered`. We send the chart's word:

1. **It is the vocabulary your sample rows already carry** in `Finish__c` on this same object, so a
   filter on `Polished` finds slabs and samples alike. Sent raw, slabs would say `Polish` and
   samples `Polished`.
2. **Otherwise one shelf can become two rows.** The field is typed by hand. If some slabs of a
   design say `Polish` and others `Polished`, sending them unchanged makes two keys for one stock
   line, and a rep filtering on either word misses the rest.

*Grade.* QC's grade column has two habits we undo, the same way our own QC screens and dispatch do.
It says **"Not graded yet"** when there is no grade: we send that blank, not as a grade. And it says
**"C (Reject)"** for C: we send `C`, or C would be two rows. Everything else goes as QC typed it.

Both are the ERP's own words, not a mapping onto anything of yours. **A finish spelling we do not
recognise goes out exactly as typed** — never dropped, never guessed onto one of the four. If you
would rather have the raw text anyway, say so; the cost is the duplicate rows above.

**One grade value to know about: `Printing`.** It is in the grade column, and it goes out as typed,
but the ERP itself treats it as a routing state, not a quality verdict. A rep reading "Grade
Printing" should read it that way.

**`Series__c` will be blank on most slab rows, and we would rather you heard that from us than
counted it.** Our series come from the owner's colour chart: 129 colours in 7 series, not the whole
design list. Many of the designs with the most stock are not on it at all: Carrara
Cloud, Calacatta Gold, Carrara Royale, Taj Mahal, and most of the 30 mm list. For those, the ERP
holds no series to send. Blank is the honest value, and inventing one is what you asked us not to
do. Where a design *is* on the chart under another spelling (the chart says "Pebbles Ice" where the
ERP says "Pebble Ice"), we look it up through our design alias table, so one alias row fixes it on
the next run. The dry run lists the 25 designs with the most stock and no series, and counts the
rest.

**Our chart's series name is `Solids`, not `Solid`.** Your list said Solid. We send our own name
unchanged, as the sample rows already do, so a filter or report built on `Solid` will miss Brilliant
White and Super White.

**`Name` now tells rows apart:** `Arva White 20 mm · Polished · Grade A`. A row with neither value
keeps today's name, `Arva White 20 mm`.

**Also tightened while we were in here:** a slab whose *grade* reads `CTS` or `SAMPLE` has been cut,
and our dispatch refuses it whatever its other fields say. The sync now leaves those out the same way
dispatch does, in any case. We expect this to be zero or close to it. But with grade now a column,
one would otherwise have reached a rep as "Grade CTS, in stock". This applies from the moment we
deploy, before the switch.

**And a design's name no longer depends on database order.** Where the yard types a design two ways
that fold to one product code ("Arva White", "arva white"), the row is named by whichever spelling
covers more slabs. Before, it was whichever the database happened to return first, which could
change from run to run. Now it changes only when the balance between the two spellings does. When
their counts are close, that can still happen as slabs are sold or arrive. With the switch on, each
such change re-sends every finish and grade row of that design.

## 5. What we need from you before we turn the switch on

1. **`Grade__c` is new today — please confirm our integration user has Edit on it**, and on
   `Finish__c` and `Series__c` if that is not already so. A new field is usually hidden from
   profiles until someone grants it. Without Edit, every new row is refused. Per §3 you would lose
   nothing, and the old rows keep carrying the stock. But nothing would split, and we would spend one
   call a run retrying.
2. **Please check where retired rows will show up.** There will be up to 328 of them. The list view
   we designed with you, "Slabs in stock", filters `Retired__c = false`, so it will not show them.
   We don't know whether Live Inventory does the same. The "Everything incl. unmapped" view, global
   search, and any report that doesn't filter on `Retired__c` match every row by name. Those will
   show the retired rows next to their replacements, at 0.
3. **Please confirm the key format suits your upsert, and that `ERP_Key__c` is still 80
   characters.** The key is the part that is expensive to change after the switch.
4. **Tell us if you built anything on the series value `Solid`** (§4).

## 6. What happens next

- **A dry run first, against production.** It runs the same code path and reads everything, but
  writes nothing, with the switch previewed as if it were on. We will send you what it reports:
  - **slab rows**;
  - **old rows** that would be retired once their replacements are accepted, and old rows kept
    because the product is sold out;
  - how many rows go out with **`Finish__c`, `Grade__c` or `Series__c` blank**, and **the designs
    without a series**.

  The blank counts are there so that "the ERP sent nothing" can never be mistaken for "the yard
  recorded nothing".
- **Then we turn the switch on, on your go-ahead to §5.** You read the first run and confirm the
  counts, as you offered. We send you our side of it, including the rows you refused, named by key
  (our log keeps the first 50 per run by name, and counts the rest).
- **Product2 does not change.** `ERP_Available_Slabs__c` is still the product's whole stock (every
  finish and grade added up), so the deal-page panel and your product matching are unaffected.

---

| | |
|---|---|
| **You** | Edit on `Grade__c` (and `Finish__c`, `Series__c`) for the integration user · where retired rows show · OK the key and its 80-character limit · anything built on `Solid` |
| **Us** | Dry-run counts and the no-series list to you · switch on at your go-ahead · re-read the first run with you |
