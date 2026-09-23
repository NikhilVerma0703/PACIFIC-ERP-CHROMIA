# ERP → Salesforce: the dry run — your numbers, and we are ready for the go-ahead

**Date:** 23 September 2026
**Re:** your REPLY-17, *go ahead with the dry run — and two corrections we owe you*

No credentials in this document.

---

Thank you for §1 and §4. The `Grade__c` grant is exactly the gap we were worried about. The corrected
lengths mattered too: our caps had followed REPLY-10's 255, so a hand-typed finish between 41 and 255
characters would have been sent whole and refused. **They are now Finish 40, Grade 40, Series 60**, and
already live. The key is still built from the full value, so trimming a field can never merge two rows.

## 1. The dry run

Run against production at 15:40 UTC today, with the switch previewed as on. It read everything and
wrote nothing.

| | |
|---|---|
| **Slab rows after the switch** | **1,101**, up from 328 today |
| **Distinct finish-and-grade combinations** | **30** |
| **Old rows to retire** | **328**, every one of them. Each has at least one replacement. |
| **Old rows kept** (product sold out at the switch) | **0** |
| **Slabs carried** | **16,415**, identical before and after. The split divides each line's stock and never adds or loses any. |

**What your 20,000 cap will see.** 1,101 live slab rows plus the 524 sample, stand and box rows you
already hold makes **1,625 live rows**. The 328 retired rows stay in the object too, so it holds **1,953
in all**, under 10% of your headroom. It then grows slowly. A split row that sells out stays as a live
zero (§3 of REPLY-16), so combinations the yard has held build up over time. With 30 combinations
spread over 328 lines, that growth is gradual, and our run summary reports the row count every run.

## 2. The three blank counts

| Field | Rows sent blank | Slabs behind them | Why |
|---|---|---|---|
| `Finish__c` | **499** of 1,101 | **8,491** of 16,415 | QC has not recorded a polish on these slabs |
| `Grade__c` | **106** | **1,002** | no grade recorded, or *Not graded yet* |
| `Series__c` | **417** | — | 127 designs our colour chart does not list |

**The finish blank is the one to plan around: more than half the slab stock has no polish recorded.**
That is the yard's record, not something the sync dropped. A polish filter in Live Inventory will leave
those slabs out, whichever value is chosen. We are raising it with the yard, and they fill in on the next
run after QC records a polish.

The designs with the most stock and no series: Carrara Cloud (1,444 slabs), Carrara Royale (1,029), Sea
Pearl (545), Carrara Venatino (517), Antique Grey (250), Glenco (207), Desert Silk (205), Calacatta Grey
(201), Sparkle White (147), Carrara Beige (136).

**One series fixed because of this run.** Brilliant White (349 slabs) was coming out blank although our
chart puts it in Solids. Our alias table also maps "Ultima White" onto it, and the chart lists Ultima
White separately, in Aurora. A design's own chart entry now decides its series. That is live, and it
changed that one design only.

## 3. Your two questions on values

**`Printing`: none.** No slab row carries it today.

**`Trial` does appear as a grade: 18 rows, 67 slabs.** These are slabs of real, sellable designs whose
grade column says *Trial*. They are **already in today's stock totals**; the split only makes the word
visible. We are asking our owner whether trial-graded slabs should be withheld, as trial *designs*
already are. We will tell you the answer before the switch goes on. If they are withheld, the totals
above fall by 67 slabs.

**Every value is within your limits, with room to spare:**

| | Longest we would send | Your limit |
|---|---|---|
| `Finish__c` | 16 (*Leathered finish*) | 40 |
| `Grade__c` | 5 (*Trial*) | 40 |
| `Series__c` | 8 | 60 |
| Design | 24 (*Bianco Carrara Long Vein*, as you found) | — |
| `Name` | 51 | 80 |

**Nothing is over any limit today, and nothing we add can be refused for length later.** We clamp
`Finish__c`, `Grade__c`, `Series__c` and `Name` to your limits before sending, so a value that ever ran
long would be shortened, not refused. `Design__c` goes out as typed, as it always has. Design names are
typed by hand in the yard, so we cannot promise one will never pass 40. But our run summary reports
the longest name every run, and how many rows a limit would shorten, so we would see it the day it
happened and tell you.

**Three finish spellings will reach you as typed:** *Leather polish* (8 rows, 11 slabs), *Leathered
finish* (3, 4) and *No Polish* (2, 5). These are the "unrecognised spelling goes out exactly as typed"
case from REPLY-16. So Live Inventory will see seven finish values rather than four, plus blank. We
are asking the yard to correct them at source rather than guessing their meaning here.

## 4. Your first `Grade__c` write

**The dry run cannot tell you; it writes nothing.** The first live run will. Its first 200 new rows are
the probe. Whatever Salesforce answers for each of them lands in our run log by key, and we will send you
exactly what came back. If the grant works, the rest follow in the same run. If it does not, the old
rows keep carrying the stock exactly as today.

That first run will cost about fifteen API calls. Six create the 1,101 rows and two retire the 328.
About three more cover the sample rows then due for their half-hourly re-stamp, and the rest are the
usual reads. Our own count stood at 476 of our 1,000 daily budget when the dry run ran, and the
org at 2,511 of 160,000.

## 5. The go-ahead

Everything on our side is ready. The code is live, the switch is off, and the numbers above are what it
will do. **Once you give the go-ahead, and we have our owner's answer on *Trial* (§3), we turn it on.**
We will send you the first run's result, with refused rows named by key (the first 50, and a count
of any beyond that), and read it with you.

---

| | |
|---|---|
| **You** | The go-ahead · anything you want changed in how *Trial*, the unrecognised finishes or blank finish should read to reps |
| **Us** | Owner's answer on *Trial* before the switch · switch on after your go-ahead · first run's result to you, refusals by key · the unrecognised finishes and missing polish raised with the yard |
