# ERP → Salesforce: done — the split is live

**Date:** 23 September 2026
**Re:** your REPLY-17, *go ahead with the dry run — and two corrections we owe you*

No credentials in this document.

---

**Everything is done from our end.** The dry run, your corrections, and the switch itself: polish, grade
and series now go out on every slab row. **No reply is needed unless something looks wrong to you.**

## 1. The first live run — 16:00 UTC today

**Every row was accepted, and nothing was refused.** That covers all 1,101 new slab rows, each carrying
`Grade__c`, and all 328 retirements of the old rows. **So your grant works: our first write of
`Grade__c` landed on every row.** We checked this against our own record of what Salesforce accepted,
which holds every row with exactly the values we sent, and none of the old two-part keys.

The whole switch-over took one run and 8 API calls. That put our own count at 484 of our 1,000 daily
budget, and the org at 2,709 of 160,000.

## 2. What the object now holds

| | |
|---|---|
| **Slab rows** | **1,101**, up from 328 |
| **Distinct finish-and-grade combinations** | **28** |
| **Old slab rows retired** | **328** of 328. None deleted, so a sample request pointing at one still resolves. |
| **Slabs carried** | **16,416** at 16:02 UTC, equal to the published stock. The split divides it between rows and adds or loses none. |
| **Rows in the object** | about 1,953: 1,625 live (1,101 slab rows plus the 524 sample, stand and box rows) and the 328 retired. That is under 10% of your 20,000 cap. |

## 3. Your questions

- **`Printing`: none.** No slab row carries it.
- **`Trial` appears as a grade on 18 rows (67 slabs).** These are slabs of real designs, and our
  owner has confirmed they stay, shown as *Trial*. It is not one of our quality grades (A, A2, B, C),
  if you want to word it for reps.
- **Lengths:** the longest finish we send is 14 characters, grade 5, series 8, design 24 (*Bianco
  Carrara Long Vein*, as you found) and name 51. We clamp `Finish__c`, `Grade__c`, `Series__c` and
  `Name` to your limits (40, 40, 60 and 80), which are already live. So nothing can be refused for
  length. `Design__c` goes out as typed, as it always has.

## 4. Worth knowing

- **Blank values.** `Finish__c` is blank on 499 rows (8,491 slabs, over half the stock), because QC has
  not recorded a polish on those slabs. `Grade__c` is blank on 106 rows and `Series__c` on 417 (127
  designs not on our colour chart). They fill in as the yard records them.
- **Finish values.** One spelling, *Leathered finish*, is now folded into *Leathered*. Two still go out
  exactly as typed: *Leather polish* (8 rows) and *No Polish* (2). So you will see six finish values
  rather than four, plus blank.
- **Brilliant White** now carries its series, Solids. It was coming out blank because an alias linked
  it to a colour in another series.

---

**No reply needed** unless something looks wrong on your side. We will write again only if something
changes that you would see.
