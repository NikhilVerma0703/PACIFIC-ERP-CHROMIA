# Commercial module: the owner's round-four answers

Given 2026-09-12, against `OPEN-QUESTIONS-4.md`. Three of the fourteen were
answered and changed the module. **The other eleven ship on the defaults the
questions stated** — that was explicit: *"The rest ship as. If there are
anything else i need chnages in we will do later."*

Schema: `scripts/0082-commercial-round4.sql`, applied and verified 2026-09-12.

---

## 1 — a cut piece is checked exactly like a slab

> *"A cut to size also gets a physical check piece by piece with mark crate as
> correct and even the slabs get slab by slab and mark crate as correct also a
> global mark all as correct."*

This overturns the default in question 1, which was that a cut-to-size list
needs no physical check. It needs the same one, and both kinds of list gain two
faster ways to give it.

**Rule.** A packed PIECE carries the same verdict a packed SLAB has carried
since 0076: `fit` (PENDING / FIT / UNFIT), `unfitReason`, who checked it and
when. The dispatch check screen shows slabs and pieces together, grouped by
crate, and a list is verified only when **every line of both kinds** has been
looked at. UNFIT still demands a reason, and one UNFIT line still rejects the
whole list and pulls the order back to PACKING.

**Three ways to say "correct", not one.**

| | what it touches |
|---|---|
| one line | that slab or that piece |
| **Mark crate as correct** | every still-PENDING line in that crate |
| **Mark all as correct** | every still-PENDING line on the list |

**The bulk marks never overwrite an UNFIT.** A line already marked unfit is a
deliberate finding with a reason attached, and a bulk "all correct" that
silently erased it would lose the one thing the check exists to produce. Both
bulk actions therefore touch PENDING lines only, and both report what they
skipped: *"38 marked correct, 2 left unfit."* To clear an unfit line the
checker marks that line FIT explicitly, which is one tap and is honest about
what it is doing.

**An unfit PIECE does not go back to stock.** An unfit slab is returned through
the inventory bridge, because a slab is a row in finished goods. A cut piece is
not — it was cut to a customer's size and there is nothing to return it to. So
an unfit piece stays on the list, flagged, and the rejection note names it. Not
noticing this would have thrown a bridge call at a slab number that does not
exist.

## 2 — one barcode, one article, and we allocate the next one ourselves

> *"Do not let duplicate barcodes be entered. If something is already there jn
> the data flab it and dont generate barcodes till its fixed. How are barcodes
> made ? Make in similar way only. Autogenerate"*

This overturns the default in question 2, which was to keep both duplicate rows
with a warning on the screen.

### The duplicate

**Rule.** An EAN is UNIQUE across the whole table, enforced by the database, not
by a warning. It is not scoped per client: an EAN-13 is globally unique by
construction — the company prefix inside it already says whose it is — so a
per-client index would permit exactly the collision the standard exists to
prevent.

His own file breaks the rule. `220x19.5x2` and `220x15x2` both read
`8720847172266`. So the losing row must still be storable, **without** a code
and **saying why it has none**: that is `eanBlockedReason`. And *"don't generate
barcodes till it's fixed"* is then a condition anything can read —

> While any article of a client carries a blocked reason, that client's
> barcodes are neither generated nor printed.

Label printing and allocation both refuse with the same sentence naming the two
articles that collide. Nothing prints half-right.

### How his customer's barcodes are made

Read off the nine valid codes in `Desert Silk Crate BARCODE.docx`:

```
8720847 17222 8        8720847   GS1 company prefix   (872 = GS1 Netherlands)
8720847 17223 5          17222   item reference       17222 … 17232, consecutive
8720847 17224 2              8   check digit          computed, never typed
8720847 17225 9
8720847 17226 6        7 digits of company prefix
8720847 17228 0      + 5 digits of item reference
8720847 17230 3      + 1 check digit  =  13
8720847 17231 0
8720847 17232 7
```

**Rule.** Autogeneration continues that series: the client's GS1 prefix, the
next item reference, the computed check digit. The prefix is the **customer's**,
so it is stored per client (`commercial_client_barcode`) and the next customer
will have a different one of a different length — the item reference simply
takes whatever is left of the twelve digits.

**Three things the allocator does that are worth stating.**

* **It never reuses a gap.** His series skips `17227`. A gap is far more likely
  to be a code the customer allocated somewhere we cannot see than a free slot,
  and a reissued EAN is the same failure as a duplicate one, discovered at the
  customer's gate. The allocator always goes above the highest reference in use.
* **It never overwrites a customer's code.** `eanSource` records whether a code
  came off their file or out of our allocator; only a blank article is allocated.
* **The floor is a floor, not a counter.** `nextRef` is compared with the highest
  reference actually in use and the greater wins, so a hand-entered code cannot
  be handed out again and a deleted row cannot rewind the series.

## 3 — the label has to fit the edge of a 2 cm slab

> *"We have tk paste it on a 2cm slab so lower than 2cm width. Length can be
> anythjng proportinal."*

This overturns the default in question 3, which assumed a 100 × 70 mm crate
label. The barcode label is pasted on the **edge** of the piece — a 2 cm strip —
so its short dimension is fixed at under 20 mm and its length is free.

**The arithmetic says truncation is forced, so the question is only how much.**
An EAN-13 at magnification 1.00 is 22.85 mm of bars plus about 2.75 mm of
digits underneath. The symbol is only specified down to magnification 0.80, and
even there it is 18.3 mm of bars plus 2.2 mm of digits — **20.5 mm, taller than
the slab is thick.** There is no magnification in the whole legal band at which
a full-height EAN-13 fits on a 2 cm edge. So the bars must be shortened
whatever else we choose.

**Rule.** Shorten the bars; do not shrink the module. Bar height is the one
dimension of an EAN-13 that costs you aiming tolerance rather than the read
itself — a handheld scanner sweeps a line across the bars, and a shorter bar
means the operator holds it straighter, not that the code fails. Module width
is what actually decides whether the code can be resolved at all. Since the
length is free, the module stays at magnification **1.50**, where it already
was, and the height is cut to fit:

```
label          18.0 mm tall  (2 mm of clearance on a 20 mm edge)
   margin       1.0 mm
   bars        13.4 mm       a truncated symbol, deliberately — see below
   digits       2.6 mm
   margin       1.0 mm
label          57.9 mm long  (55.9 mm of symbol incl. quiet zones + margins)
```

Two different percentages get quoted about that 13.4 mm and they are both
right, so the module reports both rather than picking one. Against GS1's
**nominal** bar height — 22.85 mm, the height at magnification 1.00, and the
number a conversation with a customer's quality desk is had in — it is **59%**.
Against what **magnification 1.50 is actually specified at** — 34.28 mm — it is
39%, and `truncatedByMm` says the same thing in millimetres: 20.9 mm of bar
given up. `percentOfNominalHeight` is therefore over 100 on thick stock while
`truncated` is still true, which is not a contradiction: a 30 mm edge gets
23.4 mm of bars, more than the unmagnified nominal and still well short of what
this magnification specifies.

The height follows the slab: an article 3 cm thick gets a taller label and less
truncation, automatically. Below about 6 mm of bars the module refuses to print
rather than producing something that scans as nothing.

**This is a known deviation from the GS1 height specification, chosen on
purpose.** It is recorded here so that when a customer's scanner is fussy, the
first question asked is about magnification and quiet zones, not about why the
bars are short.

---

## What was NOT changed

Questions 4 through 14 keep the defaults the questions stated: shipping date
typed on the packing list, the item code stored as sent, piece labels carrying
item code and size only, no consignment or project number on the packing list,
weight as the stone alone, sizes stored in millimetres, reserved stock marked
dispatched on CLOSED, the exchange rate read as rupees per unit of invoice
currency, the twelve-and-three task list as seeded, articles edited by manager
and admin while anyone who may see a packing list prints its labels, and the
old `COMMERCIAL` role left in place and unused.
