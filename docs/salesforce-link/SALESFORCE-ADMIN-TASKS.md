# Pacific ERP - Salesforce stock sync: what we need from you

**To:** Pacific's Salesforce administrator
**From:** Pacific ERP team
**Date:** 2026-09-17

---

## Where things stand

The ERP can now authenticate to the org and read it. We ran a **full rehearsal** against
live data on 17 September. It reads everything a real run reads and writes nothing, so the
numbers below are exactly what a live push would send.

**Nothing has been written to Salesforce, and nothing will be until you and the owner have
both read this.**

| | |
|---|---|
| Connected as | Pacific ERP Integration |
| Username | `erp.integration@thepacific.group` |
| Org Id | `00DdN0000104upeUAA` |
| API calls used by one rehearsal | 3,886 of 160,000 |

### What the rehearsal found in the yard

```
 19,382  slabs AVAILABLE and whole
 -1,849  withheld: batch not sales-approved
 ------
 17,533  sellable
 -2,874  design spelling the ERP cannot match to a product
 -  340  thickness the ERP cannot classify
 ------
 14,319  would publish, as 186 stock lines
```

So **roughly 82 percent of sellable stock would reach Salesforce today.** The rest is what
this document is about. Most of it needs a decision from you; a smaller part is ours, and
section 5 lists it so you do not act on it.

---

## 1. Stock at 30 mm has nowhere to land - 84 products to create

The single biggest gap: **7,770 slabs** across **84 design codes**.

The ERP holds real, sellable 30 mm stock, but the org has no `Product2` row at that
thickness, so there is nothing to write the count against. These are not spelling
problems. The design is recognised; the thickness is not stocked as a product.

**What we need:** a `Product2` record for each code below, with `Family = 'Quartz Slab'`,
`IsActive = true`, and `ProductCode` (or `ERP_SKU__c`) set to **exactly** the string shown.
The ERP matches on that string, so a different spelling will not connect.

| ProductCode to create | Slabs waiting |
|---|---|
| `QZ-CARRARACLOUD-30` | 723 |
| `QZ-CARRARAROYALE-30` | 632 |
| `QZ-SUPERWHITE-30` | 526 |
| `QZ-HONEYDEW-30` | 416 |
| `QZ-ECHOWHITE-30` | 385 |
| `QZ-TRIAL-30` | 330 |
| `QZ-CAPPUCCINO-30` | 306 |
| `QZ-BELLAGIO-30` | 223 |
| `QZ-CALACATTAGOLD-30` | 215 |
| `QZ-CALACATTAGREY-30` | 196 |
| `QZ-ASTRALMIST-30` | 187 |
| `QZ-HAVELOCK-30` | 187 |
| `QZ-ALABASTERNOIR-30` | 181 |
| `QZ-BIANCOCRISTALLO-30` | 177 |
| `QZ-COASTALPEARL-30` | 177 |
| `QZ-DRIFTWOOD-30` | 159 |
| `QZ-LATTELUXE-30` | 136 |
| `QZ-ARVAWHITE-30` | 134 |
| `QZ-LARVIK-30` | 133 |
| `QZ-IRISHCREAM-30` | 129 |
| `QZ-COSTA-30` | 126 |
| `QZ-BRILLIANTWHITE-30` | 123 |
| `QZ-AUREATE-30` | 117 |
| `QZ-GOLDENDAWN-30` | 113 |
| `QZ-OAKVILLE-30` | 108 |
| `QZ-GALACTICHALO-30` | 105 |
| `QZ-CARRARAVENATINO-30` | 93 |
| `QZ-GLENCO-30` | 86 |
| `QZ-ALABASTER-30` | 81 |
| `QZ-TOKYO-30` | 76 |
| `QZ-OASIS-30` | 73 |
| `QZ-IKOS-30` | 58 |
| `QZ-ALCHEMY-30` | 57 |
| `QZ-CEMENTO-30` | 57 |
| `QZ-HAZELGOLD-30` | 57 |
| `QZ-BOHEMIA-30` | 56 |
| `QZ-BROOKLYN-30` | 55 |
| `QZ-FRENCHVANILLA-30` | 53 |
| `QZ-MAPLEGAZE-30` | 51 |
| `QZ-STELLAREMBER-30` | 49 |
| `QZ-PEBBLEICE-30` | 40 |
| `QZ-DAZZLE-30` | 39 |
| `QZ-IRISHGREY-30` | 38 |
| `QZ-TAJVEIN-30` | 37 |
| `QZ-WHITEBLIZZARD-30` | 34 |
| `QZ-ELVIS-30` | 32 |
| `QZ-CARRARABEIGE-30` | 30 |
| `QZ-CARRARACHIFFON-30` | 28 |
| `QZ-TAJMAHAL-30` | 26 |
| `QZ-ARENA-30` | 23 |
| `QZ-BELLASTATUARIO-30` | 23 |
| `QZ-VENUSGLOW-30` | 21 |
| `QZ-ATLANTIS-30` | 20 |
| `QZ-GLACIALSILVER-30` | 20 |
| `QZ-CEDARCHARM-30` | 17 |
| `QZ-CLEOPATRA-30` | 14 |
| `QZ-MIRAGGIO-30` | 14 |
| `QZ-TRAMENTO-30` | 13 |
| `QZ-MISKA-30` | 12 |
| `QZ-SEASONS-30` | 12 |
| `QZ-SILKEN-30` | 12 |
| `QZ-FERN-30` | 11 |
| `QZ-FOSSILGREY-30` | 11 |
| `QZ-CARIBBEAN-30` | 10 |
| `QZ-MIDNIGHT-30` | 9 |
| `QZ-ALPS-30` | 8 |
| `QZ-LUNARLIGHT-30` | 8 |
| `QZ-FRANKLIN-30` | 7 |
| `QZ-STELLA-30` | 7 |
| `QZ-PULSAR-30` | 6 |
| `QZ-WALDORF-30` | 6 |
| `QZ-CHATEAU-30` | 5 |
| `QZ-ANTONIO-30` | 4 |
| `QZ-CLASSICGRAY-30` | 4 |
| `QZ-STATUARIO-30` | 4 |
| `QZ-ULTIMAWHITE-30` | 4 |
| `QZ-CRISTALLOAZURE-30` | 3 |
| `QZ-SKYLINE-30` | 3 |
| `QZ-STARCLUSTER-30` | 3 |
| `QZ-BELLEZA-30` | 2 |
| `QZ-ARABESCO-30` | 1 |
| `QZ-ARLINA-30` | 1 |
| `QZ-EMINENCE-30` | 1 |
| `QZ-MEDUSA-30` | 1 |

> If any of these should **not** be sold at 30 mm, tell us rather than creating the product
> and we will stop publishing that line. A design you do not sell is a decision, not an
> error - we only need to know which it is.

---

## 2. 36 active products the ERP has no design for

These are live `Quartz Slab` products in the org. The ERP holds no design matching them, so
each would publish **zero available**. That is correct if the design is discontinued, and
misleading if it is simply named differently on our side.

**What we need:** for each, either *"retire it"* or *"this is our &lt;name&gt;"*.

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
| `QZ-MOCKINGBIRD-20` | Mockingbird |
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

---

## 3. 10 products stocked, but not at that thickness

The ERP recognises these designs and holds stock of them, just not at the thickness this
product represents. They publish zero, correctly, and carry a note saying stock exists at
another thickness. **No action needed unless you disagree.**

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

## 4. 83 designs with stock and no product at all - a decision, not a fix

**2,291 slabs.** The ERP holds these under names the org has never seen. We could not
find a close match to any existing product, so we are not guessing.

For each: either it deserves a product (tell us the code to use, or say "create it" and we
will propose one), or it is not sold through Salesforce (tell us, and we stop counting it
as a gap).

| Design as the yard spells it | Slabs |
|---|---|
| Sea Pearl | 545 |
| Antique Grey | 250 |
| Sparkle White | 223 |
| DESERT SILK | 140 |
| Caterina | 140 |
| Poseidon | 123 |
| PIETRA GREY | 101 |
| Bianco Carrara Long Vein | 66 |
| Simply white | 57 |
| ARLINA CHROMIA | 48 |
| Simply White | 44 |
| Alphine Winter | 42 |
| Silken Perla White | 41 |
| Desert Silk | 35 |
| Venice | 28 |
| Moritz | 28 |
| Carrara Lumus | 27 |
| Dakar | 25 |
| Bellagio green | 23 |
| Wakanda | 20 |
| Grey Expo | 20 |
| Lumitaj | 20 |
| Chromia trail | 19 |
| Neptune | 18 |
| Stone Evolution | 17 |
| Pure White | 16 |
| Donatello Grey | 14 |
| Extra White | 14 |
| Kreas | 10 |
| Black Nimbus | 7 |
| Bellagio gold | 6 |
| Paetra Grey | 6 |
| Bariyan | 6 |
| Ashen bloom | 5 |
| Azun Cascade | 5 |
| Super white Calacatta | 5 |
| Viola Trial | 5 |
| Carrara marmi | 4 |
| Siken Perla White | 4 |
| Woodland | 4 |
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
| Bellagio echo white | 2 |
| Brown Cappuccino | 2 |
| Dolce | 2 |
| Iris gold | 2 |
| Kero& trial | 2 |
| Ocellio | 2 |
| Star | 2 |
| Bellagio blue | 2 |
| Bellagio green - B | 2 |
| Horizon calcatta grey | 2 |
| Lumen Sky | 2 |
| Mysterio Avo | 2 |
| Amazonite | 1 |
| An | 1 |
| Antique Greya | 1 |
| Bellagio blue ultimate w | 1 |
| BRAEWIND trial | 1 |
| Cal | 1 |
| Carr | 1 |
| Cb | 1 |
| Chese board | 1 |
| Elvis grey | 1 |
| Golactie holo | 1 |
| ILANO CHROMIA | 1 |
| Kandice | 1 |
| Lipuib mercury | 1 |
| Liquid mercury | 1 |
| Malana trial | 1 |
| Manthattan grey | 1 |
| Marble | 1 |
| Trail kreso | 1 |

---

## 5. Not yours - we are fixing these (listed so you do not act on them)

**20 designs, 583 slabs** are our own misspellings in the yard data.
Each is fixed with an alias on the ERP side and folds into an existing product on the next
run, with **no Salesforce change at all**.

| Yard spelling | Looks like | Slabs | Confidence |
|---|---|---|---|
| Pebble ice | Pebble Ice | 200 | likely a spelling variant |
| MOCHA MIST | MATCHAMIST | 121 | **confirm - may be a different design** |
| TIFFINY | TIFFANY | 66 | likely a spelling variant |
| Crecendo | CRESCENDO | 40 | likely a spelling variant |
| Calcatta gold | Calacatta Gold | 39 | likely a spelling variant |
| Tajmahal | Taj Mahal | 29 | likely a spelling variant |
| Classic Grey | CLASSICGRAY | 26 | likely a spelling variant |
| Miragio | Miraggio | 16 | likely a spelling variant |
| Taj Aureate | Aureate | 15 | **confirm - may be a different design** |
| Tiffiny | TIFFANY | 9 | likely a spelling variant |
| Dark Cappuccino | Cappuccino | 6 | **confirm - may be a different design** |
| Carrara cloud | Carrara Cloud | 5 | likely a spelling variant |
| Carrara royal | Carrara Royale | 3 | likely a spelling variant |
| Calcatta Grey | Calacatta Grey | 2 | likely a spelling variant |
| Atlantic | Atlantis | 1 | likely a spelling variant |
| Calacatta Gold trail | Calacatta Gold | 1 | likely a spelling variant |
| Irish grey | irish Grey | 1 | likely a spelling variant |
| Luna Light | Lunar Light | 1 | likely a spelling variant |
| Semento | Cemento | 1 | likely a spelling variant |
| Ultimate white | ULTIMAWHITE | 1 | likely a spelling variant |

> These pairings were suggested by automatic name-similarity and **have not been confirmed
> by a human**. `MOCHA MIST -> MATCHAMIST` in particular looks wrong: mocha and matcha are
> different colours. Pacific will confirm each before applying it.

---

## What happens next

1. You create or confirm the products in sections 1 to 4.
2. Pacific applies the alias fixes in section 5.
3. We re-run the rehearsal and send you the new numbers. The gap should be close to zero.
4. Only then does Pacific enable writing, and a scheduled job begins pushing every 10 minutes.

Each step is reversible by the one before it. Turning the job off restores the previous
state, and no data is deleted from Salesforce at any point.

### What the sync will write, once it is on

- **`Product2`** - `ERP_Available_Slabs__c`, `ERP_Match__c`, `ERP_Other_Thickness_Stock__c`
  and `ERP_Stock_As_Of__c`, on all 110 active quartz products, every run, **including zeros**.
  A sold-out design reads zero rather than going quiet.
- **`ERP_Stock__c`** - one row per stock line (710 today): slabs, sample shelves, boxes and
  stands, keyed on `ERP_Key__c`.

It **never** deletes records, never edits an Opportunity, Account, Quote or Order, and never
approves anything.

---

## The three that block the most stock

1. Section 1, the 84 thirty-millimetre products - 7,770 slabs.
2. Section 4, the 83 unknown designs - 2,291 slabs.
3. Section 2, the 36 zero-stock products - accuracy rather than volume.
