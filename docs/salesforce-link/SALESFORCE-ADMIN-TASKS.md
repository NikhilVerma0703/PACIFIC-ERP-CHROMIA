# Pacific ERP - Salesforce stock sync: what we need from you

**To:** Pacific's Salesforce administrator
**From:** Pacific ERP team
**Date:** 17 September 2026
**Replaces:** our handoff of the same date. Please work from this one.

---

## What we got wrong in the first version

You found eight things. You were right about all eight, and checking two of them
found defects on our side that neither of us had named. Corrections first, because
they change the numbers you were given.

**1. The "3,886 API calls" figure was not ours.** You identified it exactly: it is the
`Sforce-Limit-Info` header, your org's rolling 24-hour total. Our rehearsal made **two HTTP
requests** - one OAuth token mint and one `Product2` SOQL, of which one is a REST API call.
Per-run figures are in section 8.

**2. Four of the "spelling fixes" we asked YOU to make were our bug.** *Pebble ice*,
*Tajmahal*, *Carrara cloud* and *Irish grey* - 235 slabs - are designs we already publish.
Our matcher folded case when deriving a product code but compared the design NAME
case-sensitively, so an uppercase or a missing space was enough to refuse them. **Fixed in
code.** They now publish automatically and are gone from this document. We were about to ask
you to hand-type alias rows to paper over our own defect; your point 2 is what caught it.

**3. `QZ-TRIAL-30` was one third of a problem.** You spotted it in the 30 mm list. In fact
*Trial* is a bucket in our design table with **133 experimental names** mapped onto it, and it
was passing our publish rule at every thickness - **740 slabs** across 12 mm, 20 mm and 30 mm
would have reached your reps as sellable stock. **Withheld in code**, and reported as its own
line so it cannot silently vanish from a total.

**4. "Reversible" was overstated.** You are right. Turning the sync off stops future writes;
it does not undo values already written. We have removed that wording. There is no rollback.

**5. "`ProductCode` (or `ERP_SKU__c`)" was ambiguous.** Your reading is correct: **set
`ProductCode` only.** Confirmed - our run fills `ERP_SKU__c` from `ProductCode` wherever it
is blank, including on products you create, and it does so before matching, so a new product
is picked up on the first run after you create it.

---

## Where things stand

Rehearsal against live data, 17 September. It reads everything a real run reads and writes
nothing, so these are the numbers a live push would act on.

| | |
|---|---|
| Connected as | Pacific ERP Integration (`erp.integration@thepacific.group`) |
| Org | `00DdN0000104upeUAA` |
| Written so far | **nothing** - no product values, no stock lines, no log rows |

```
 19,425  slabs AVAILABLE and whole
 -1,849  withheld: batch not sales-approved
 -------
 17,576  sellable
 -2,649  design we cannot match to a product  (section 4)
 -  341  thickness we cannot classify         (section 5)
 -  740  trial stock, withheld on purpose     (correction 3)
 -------
 13,846  would publish, as 184 stock lines
```

Of your 110 active quartz products: **65 would carry a real count**, 10 would read zero correctly
(stock exists at another thickness), and 35 would read zero because we hold nothing matching
them (section 2).

---

## 1a. New THICKNESS of a design you already sell - 54 products

**4,896 slabs.** You separated this from 1b and you were right to: for every code here the
design already exists in your catalogue at 20 mm or 12 mm. Only the thickness is new.

`Family = 'Quartz Slab'`, `IsActive` as you decide, **`ProductCode` exactly as shown**.

| ProductCode | Slabs waiting |
|---|---|
| `QZ-SUPERWHITE-30` | 526 |
| `QZ-HONEYDEW-30` | 417 |
| `QZ-ECHOWHITE-30` | 385 |
| `QZ-CAPPUCCINO-30` | 306 |
| `QZ-BELLAGIO-30` | 224 |
| `QZ-ASTRALMIST-30` | 187 |
| `QZ-HAVELOCK-30` | 187 |
| `QZ-ALABASTERNOIR-30` | 181 |
| `QZ-COASTALPEARL-30` | 177 |
| `QZ-DRIFTWOOD-30` | 160 |
| `QZ-LATTELUXE-30` | 136 |
| `QZ-ARVAWHITE-30` | 134 |
| `QZ-LARVIK-30` | 133 |
| `QZ-IRISHCREAM-30` | 129 |
| `QZ-COSTA-30` | 126 |
| `QZ-BRILLIANTWHITE-30` | 124 |
| `QZ-AUREATE-30` | 117 |
| `QZ-GOLDENDAWN-30` | 113 |
| `QZ-GALACTICHALO-30` | 110 |
| `QZ-OAKVILLE-30` | 108 |
| `QZ-ALABASTER-30` | 81 |
| `QZ-TOKYO-30` | 76 |
| `QZ-OASIS-30` | 73 |
| `QZ-IKOS-30` | 58 |
| `QZ-ALCHEMY-30` | 57 |
| `QZ-CEMENTO-30` | 57 |
| `QZ-HAZELGOLD-30` | 57 |
| `QZ-BOHEMIA-30` | 56 |
| `QZ-FRENCHVANILLA-30` | 53 |
| `QZ-STELLAREMBER-30` | 49 |
| `QZ-TAJVEIN-30` | 37 |
| `QZ-WHITEBLIZZARD-30` | 34 |
| `QZ-ELVIS-30` | 32 |
| `QZ-ARENA-30` | 23 |
| `QZ-VENUSGLOW-30` | 21 |
| `QZ-ATLANTIS-30` | 20 |
| `QZ-GLACIALSILVER-30` | 20 |
| `QZ-CEDARCHARM-30` | 17 |
| `QZ-CLEOPATRA-30` | 14 |
| `QZ-SEASONS-30` | 13 |
| `QZ-SILKEN-30` | 12 |
| `QZ-FERN-30` | 11 |
| `QZ-ALPS-30` | 8 |
| `QZ-FRANKLIN-30` | 7 |
| `QZ-STELLA-30` | 7 |
| `QZ-ANTONIO-30` | 4 |
| `QZ-CLASSICGRAY-30` | 4 |
| `QZ-ULTIMAWHITE-30` | 4 |
| `QZ-SKYLINE-30` | 3 |
| `QZ-STARCLUSTER-30` | 3 |
| `QZ-BELLEZA-30` | 2 |
| `QZ-ARLINA-30` | 1 |
| `QZ-EMINENCE-30` | 1 |
| `QZ-MEDUSA-30` | 1 |

## 1b. Genuinely new designs - 29 products

**2,618 slabs.** No product exists at any thickness. These are the ones that need a
catalogue decision, not just a thickness.

| ProductCode | Slabs waiting |
|---|---|
| `QZ-CARRARACLOUD-30` | 728 |
| `QZ-CARRARAROYALE-30` | 632 |
| `QZ-CALACATTAGOLD-30` | 215 |
| `QZ-CALACATTAGREY-30` | 196 |
| `QZ-BIANCOCRISTALLO-30` | 179 |
| `QZ-CARRARAVENATINO-30` | 94 |
| `QZ-PEBBLEICE-30` | 87 |
| `QZ-GLENCO-30` | 86 |
| `QZ-BROOKLYN-30` | 57 |
| `QZ-MAPLEGAZE-30` | 51 |
| `QZ-DAZZLE-30` | 39 |
| `QZ-IRISHGREY-30` | 39 |
| `QZ-CARRARABEIGE-30` | 30 |
| `QZ-CARRARACHIFFON-30` | 28 |
| `QZ-TAJMAHAL-30` | 26 |
| `QZ-BELLASTATUARIO-30` | 23 |
| `QZ-TRAMENTO-30` | 19 |
| `QZ-MIRAGGIO-30` | 14 |
| `QZ-MISKA-30` | 12 |
| `QZ-FOSSILGREY-30` | 11 |
| `QZ-CARIBBEAN-30` | 10 |
| `QZ-MIDNIGHT-30` | 9 |
| `QZ-LUNARLIGHT-30` | 8 |
| `QZ-PULSAR-30` | 6 |
| `QZ-WALDORF-30` | 6 |
| `QZ-CHATEAU-30` | 5 |
| `QZ-STATUARIO-30` | 4 |
| `QZ-CRISTALLOAZURE-30` | 3 |
| `QZ-ARABESCO-30` | 1 |

> Your note that **no 30 mm price exists anywhere**, and that each product needs a price in 36
> price books, is understood. Create them inactive if that is easier - we match on
> `ProductCode` and do not read `IsActive` except to skip inactive products, so an inactive
> product simply waits.

### One naming mismatch, and it is ours to fix or yours to rename

Your org spells this design **`QZ-PEBBLESICE-20`** ("Pebbles Ice"). We derive
`QZ-PEBBLEICE` from our own "Pebble Ice". As you say, the two would never meet. Tell us which
spelling is correct and we will alias ours to match - **no change needed on your side** unless
you would rather rename the product.

---

## 2. 35 active products we hold no design for

Each would publish **zero available**. Correct if discontinued; misleading if the design is
simply named differently on our side.

**What we need:** for each, *"retire it"* or *"this is our &lt;name&gt;"*.

| ProductCode | Product name |
|---|---|
| `QZ-ALMONDMIST-12` | Almond Mist |
| `QZ-ALMONDMIST-20` | Almond Mist |
| `QZ-ARYA-20` | Arya |
| `QZ-ARYAPEARL-20` | Arya Pearl |
| `QZ-CHERRYHILL-12` | Cherry Hill |
| `QZ-CHERRYHILL-20` | Cherry Hill |
| `QZ-COMETSTRANDS-20` | Comet Strands |
| `QZ-COPPERMIST-20` | Copper Mist |
| `QZ-COSMOPOLITAN-20` | Cosmopolitan |
| `QZ-CRESCENDO-20` | Crescendo |
| `QZ-DEEPWAVE-20` | Deepwave |
| `QZ-ELANO-12` | Elano |
| `QZ-ELANO-20` | Elano |
| `QZ-HERMES-20` | Hermes |
| `QZ-HORIZONVEIL-12` | Horizon Veil |
| `QZ-HORIZONVEIL-20` | Horizon Veil |
| `QZ-IRISGRAY-20` | Iris Gray |
| `QZ-LUMINACRYSTAL-20` | Lumina Crystal |
| `QZ-MATCHAMIST-12` | Matcha Mist |
| `QZ-MATCHAMIST-20` | Matcha Mist |
| `QZ-MINTARA-20` | Mintara |
| `QZ-MORVA-20` | Morva |
| `QZ-MOSSLINE-20` | Mossline |
| `QZ-MYSTIQUE-20` | Mystique |
| `QZ-ORENDA-20` | Orenda |
| `QZ-PATAGONIA-12` | Patagonia |
| `QZ-PATAGONIA-20` | Patagonia |
| `QZ-RUSKIN-12` | Ruskin |
| `QZ-RUSKIN-20` | Ruskin |
| `QZ-SANMARINO-20` | San Marino |
| `QZ-SOFTVEIL-20` | Soft Veil |
| `QZ-SONEVA-20` | Soneva |
| `QZ-TIFFANY-20` | Tiffany |
| `QZ-VALENCIA-20` | Valencia |
| `QZ-WINTERSKY-20` | Wintersky |

> ### ⚠ Three of these have stock waiting in section 4 — the dependency you warned us about
>
> Answering section 2 before section 4 would retire designs that have live stock under a
> different spelling. Your ordering instruction was right, and here is the full list:
>
> | Section 2 says "no ERP design" | Section 4 holds | Slabs | Our reading |
> |---|---|---|---|
> | `QZ-TIFFANY-20` (Tiffany) | TIFFINY / Tiffiny | 75 | **Same design.** Alias ours, keep the product |
> | `QZ-CRESCENDO-20` (Crescendo) | Crecendo | 40 | **Same design.** Alias ours, keep the product |
> | `QZ-MATCHAMIST-20` (Matcha Mist) | MOCHA MIST | 121 | **Probably NOT the same** — you said brown vs green, and we agree. Holding |
>
> So: **Tiffany and Crescendo are live designs, not retirement candidates.** We will add the
> aliases on our side; you keep both products and no Salesforce change is needed for them.
> Mocha Mist stays unresolved until you tell us — if it is a genuinely separate design it
> belongs in section 1b as a product to create.

---

## 3. 10 products stocked, but not at that thickness

We hold these designs, just not at this product's thickness. They publish zero, correctly, and
carry a note saying stock exists elsewhere. **No action needed unless you disagree.**

| ProductCode | Product name |
|---|---|
| `QZ-ARLINA-20` | Arlina |
| `QZ-ASTRALMIST-12` | Astral Mist |
| `QZ-BOHEMIA-20` | Bohemia |
| `QZ-CLASSICGRAY-20` | Classic Gray |
| `QZ-FRENCHVANILLA-12` | French Vanilla |
| `QZ-GOLDENDAWN-12` | Golden Dawn |
| `QZ-HAVANA-20` | Havana |
| `QZ-IRISHCREAM-12` | Irish Cream |
| `QZ-TAJVEIN-12` | Taj Vein |
| `QZ-WALNUT-12` | Walnut |

---

## 4. 99 designs with stock and no product - 2,649 slabs

**99 designs, 102 spellings.** You objected that the previous version said
"83 designs" while listing case twins separately - correct, and this table now folds them:
one row per design, with every yard spelling shown. Each spelling still needs its own alias
row on our side, which is why they are listed rather than hidden.

For each: either it deserves a product (tell us the code), or it is not sold through
Salesforce (tell us, and we stop counting it as a gap).

| Design (all spellings we hold) | Slabs |
|---|---|
| Sea Pearl | 545 |
| Antique Grey | 250 |
| Sparkle White | 223 |
| DESERT SILK / Desert Silk | 175 |
| Caterina | 140 |
| Poseidon | 123 |
| MOCHA MIST | 121 |
| PIETRA GREY | 101 |
| Simply white / Simply White | 101 |
| TIFFINY / Tiffiny | 75 |
| Bianco Carrara Long Vein | 66 |
| ARLINA CHROMIA | 48 |
| Alphine Winter | 42 |
| Silken Perla White | 41 |
| Crecendo | 40 |
| Calcatta gold | 39 |
| Moritz | 30 |
| Venice | 28 |
| Carrara Lumus | 27 |
| Classic Grey | 26 |
| Dakar | 25 |
| Bellagio green | 23 |
| Chromia trail | 21 |
| Wakanda | 20 |
| Grey Expo | 20 |
| Lumitaj | 20 |
| Neptune | 18 |
| Stone Evolution | 17 |
| Miragio | 16 |
| Pure White | 16 |
| Taj Aureate | 15 |
| Donatello Grey | 14 |
| Extra White | 14 |
| Kreas | 10 |
| Black Nimbus | 7 |
| Bellagio gold | 6 |
| Dark Cappuccino | 6 |
| Paetra Grey | 6 |
| Bariyan | 6 |
| Ashen bloom | 5 |
| Azun Cascade | 5 |
| Super white Calacatta | 5 |
| Viola Trial | 5 |
| Woodland | 5 |
| Carrara marmi | 4 |
| Siken Perla White | 4 |
| Canopy | 4 |
| Atmos Gold | 3 |
| Carrara Miska | 3 |
| Kreo& trial | 3 |
| Molana | 3 |
| Movitaz asford | 3 |
| Mysore Gold | 3 |
| Mysore Grey | 3 |
| Trail robo | 3 |
| Tram | 3 |
| White Arabesque | 3 |
| Black Sparkle | 3 |
| Carrara royal | 3 |
| Amazonite | 2 |
| Bellagio echo white | 2 |
| Brown Cappuccino | 2 |
| Calcatta Grey | 2 |
| Dolce | 2 |
| Iris gold | 2 |
| Kero& trial | 2 |
| Ocellio | 2 |
| Star | 2 |
| Antique Greya | 2 |
| Bellagio blue | 2 |
| Bellagio green - B | 2 |
| Horizon calcatta grey | 2 |
| Lumen Sky | 2 |
| Mysterio Avo | 2 |
| An | 1 |
| Atlantic | 1 |
| Bellagio blue ultimate w | 1 |
| BRAEWIND trial | 1 |
| Cal | 1 |
| Calacatta Gold trail | 1 |
| Carr | 1 |
| Cb | 1 |
| Chese board | 1 |
| Elvis grey | 1 |
| Golactie holo | 1 |
| ILANO CHROMIA | 1 |
| Kandice | 1 |
| Lipuib mercury | 1 |
| Liquid mercury | 1 |
| Luna Light | 1 |
| Malana trial | 1 |
| Manthattan grey | 1 |
| Marble | 1 |
| Semento | 1 |
| Stalla | 1 |
| Trail  krish cream | 1 |
| Trail kreso | 1 |
| Ultimate white | 1 |
| Venatino | 1 |

---

## 5. 52 rows whose thickness we cannot classify - 341 slabs

Not a design problem: the design is recognised, but the yard recorded a thickness our
converter does not fold - "3 cm to 2 cm" cut-downs and similar. Ours to clean up. **Listed for
completeness; no action needed.**

| Design | Thickness as recorded | Slabs |
|---|---|---|
| Cappuccino | 3 cm to 2 cm | 43 |
| Cappuccino | 10 mm | 25 |
| Golden Dawn | 3 cm to 2 cm | 22 |
| Hazel Gold | 3 cm to 2 cm | 22 |
| Echo White | 3 cm to 2 cm | 21 |
| Calacatta Gold | 3 cm to 2 cm | 17 |
| Larvik | 3 cm to 2 cm | 17 |
| Irish Cream | 3 cm to 2 cm | 14 |
| Carrara Royale | 3 cm to 2 cm | 13 |
| Astral Mist | 3 cm to 2 cm | 12 |
| Honey dew | 3 cm to 2 cm | 10 |
| French Vanilla | 3 cm to 2 cm | 9 |
| Venatino (Marmi) |  | 9 |
| Cappuccino | 8 mm | 7 |
| Latte Luxe | 3 cm to 2 cm | 7 |
| TAJ VEIN | 3 cm to 2 cm | 7 |
| Arva White | 3 cm to 2 cm | 6 |
| Alchemy | 3 cm to 2 cm | 5 |
| Amazing Silver | 3 cm to 2 cm | 5 |
| Banyan | 3 cm to 2 cm | 4 |
| *…and 32 more* | | |

---

## 6. Trial stock, withheld - 740 slabs

Reported so the total reconciles, not because you need to act. *Trial* is our bucket for
168 experimental yard entries; it is now excluded from everything we publish.
**Please do not create a trial product.**

---

## 7. Everything the live sync will write

- **`Product2`** - `ERP_Available_Slabs__c`, `ERP_Match__c`, `ERP_Other_Thickness_Stock__c`,
  `ERP_Stock_As_Of__c`, and `ERP_SKU__c` where blank. **Only products whose values changed**
  (see section 9).
- **`ERP_Stock__c`** - 708 rows, keyed on `ERP_Key__c`:

| Kind | Rows | Note |
|---|---|---|
| Slab | 184 | one per design+thickness we publish |
| Sample | 18 | sampling shelves, including shelves at zero |
| Sample (never stocked) | 502 | colour+finish never cut - `Never_Stocked__c` true |
| Box / Stand | 4 | 1 box, 3 stands |

  Of the 184 slab rows, **83 carry `Product_Missing__c` true** - the 30 mm lines from
  section 1, which become linked products the moment you create them.

- **`Integration_Log__c`** - **nothing. We write no log rows at all.** The object is in our
  allowlist and our design document describes a T3 log row; no code writes one, and none will
  without telling you first. Your storage question does not arise.

- **Nothing else.** No deletes, ever. No Opportunity, Account, Quote or Order. No approvals.

**Havana**, which you asked about: we hold **1 slab at 12 mm**. That is the whole
other-thickness holding, which is why it appears against `QZ-HAVANA-20` and not at 30 mm.

---

## 8. Our API calls, per run

You were right that we could not answer this from the org's counter. Derived from our code:

| Phase | Calls |
|---|---|
| OAuth token mint | 1 (0 while a cached token is warm, 20 min) |
| `Product2` SOQL (110 rows, one page) | 1 |
| `ERP_Stock__c` read | **0** - we diff against our own database, not yours |
| `Product2` write | 1 chunk of up to 200, **only if something changed** |
| `ERP_Stock__c` upsert | 1 chunk per 200 changed rows |
| Log write | 0 |

- **Dry run: 2 HTTP requests.**
- **First live run: 7** - token, SOQL, one product chunk, four upsert chunks for 708 rows.
- **Steady state: 2-3** - an unchanged line costs nothing.
- At a ten-minute cadence that is roughly **440-580 a day**.

Two things you should know rather than take on trust:

- **The cron is not scheduled yet** and the write switch is off, so today the real figure is
  **0 runs a day**, not 144.
- **Our 1,000-a-day ceiling is a stated limit, not an enforced one.** Nothing in our code
  counts calls or stops at it. A pathological day where every run found a full set of changes
  would exceed it and nothing would prevent that. We would rather you knew that than trusted
  a guard we have not built.

---

## 9. Your point 6: we will stop rewriting every product

**Done, and you were right.** Every run used to PATCH all 110 products whether or not anything
had changed - at the cadence we proposed, 15,840 modifications a day, which would have
destroyed *Last Modified* as a record of human edits.

Products are now hashed and **only the changed ones are written**. This run: **110 to write,
0 unchanged.**

**One consequence to agree before we go live.** The hash cannot include `ERP_Stock_As_Of__c`,
because it carries the run clock and would make every product differ every run - which is the
behaviour you asked us to remove. So that stamp now means *"when this count last changed"*
rather than *"when we last looked"*.

**This breaks `Stale__c` as specified.** We asked you to build
`Stale__c = (NOW() - Synced_At__c) > 1/24` on `ERP_Stock__c`, but `Synced_At__c` is only
written on rows that changed - so an unchanged, perfectly current row marks itself stale
within the hour. Your options:

1. **Redefine it** to mean "the count has not moved recently", which is what it now measures; or
2. **We stamp every row every run**, which restores your formula and throws away the saving
   you just asked for.

You cannot have both, and we would rather you chose than discover it live. **This is the one
decision blocking us.**

---

## What happens next

1. You answer sections 1a, 1b, 2 and 4, and choose on `Stale__c` (section 9).
2. We re-run the rehearsal and send you the new numbers.
3. Only then do we schedule the job and turn writing on.

Turning it off stops future writes. **It does not undo values already written** - there is no
rollback, and we will not describe one.
