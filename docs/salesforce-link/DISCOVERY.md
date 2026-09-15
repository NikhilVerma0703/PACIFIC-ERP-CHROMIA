# Salesforce ↔ ERP: what is actually there

Read on 2026-09-14, from the live Salesforce org (connector signed in as
Mohamed Kursheeth, System Administrator) and the live Neon database. This is
the record the design rests on. Nothing here is assumed; every number was
queried.

The owner's ask, verbatim, in three parts:

> "We have to connect our erp to salesforce to show inventory (he puts a design
> name/code constant with salesforce … and number just show in stock or not)."
> — then, the same hour: "Should be able to see active stock too in the
> inventory view in salesforce" and "So the stock search should have both slab
> and sample option."

> "We want to add to track sample boxes and stands in the sampling modules."

> "A request portal in salesforce for salespeople to raise a request, get it
> approved (approval required only for stand) and then comes on erp for the
> sampling incharge to view and it should automatically check and show if stock
> is available / not and show the status to both salesforce and erp. Manually
> sampling incharge should be able to mark it as packed and sent."

---

## 1. Salesforce already has most of the objects, and none of the data

### Products — `Product2`

| family | active | inactive | with `ERP_SKU__c` |
|---|---|---|---|
| Quartz Slab | **110** | — | 55 |
| Quartz (retired duplicates) | — | 55 | 0 |
| Vanity & Sink | 49 | — | 0 |
| Granite | 35 | — | 0 |
| Sample & Display | 3 | — | 0 |
| Custom Item | 1 | — | 0 |
| (no family) | — | 30 | 0 |

**The code scheme is deterministic.** Every active quartz product's
`ProductCode` is `QZ-<NAME uppercased, non-alphanumerics removed>-<thickness mm>`:
"Alabaster Noir" at 20 mm is `QZ-ALABASTERNOIR-20`. Where `ERP_SKU__c` is filled
(55 rows) it is identical to `ProductCode`. So there is no lookup table to ask
the owner for — the code is a function of (design name, thickness), and the
sync can fill the other 55 `ERP_SKU__c` values itself.

**Only two thicknesses exist in Salesforce: 20 mm (91 products) and 12 mm
(19).** There is no 30 mm product at all. See §3.

**The three display products** are generic: `PCES-SAMPLE-PIECE`,
`PCES-SAMPLE-SET`, `PCES-SAMPLE-STAND`, with the instruction "name the colour
in the line Description". Colours are not products at sample level in
Salesforce. Contrast the ERP, §2.

### The request portal — `Sample_Dispatch__c` + `Sample_Dispatch_Item__c`

Designed in full and **used once**: exactly one record exists (Requested /
Sample Kit / approval Not Required). Fields already there:

* `Status__c`: Requested · On Hold · Dispatched · Delivered · Installed ·
  Returned · Cancelled
* `Dispatch_Type__c`: New Stand · Stand Top-up · Sample Kit (default) · Loose
  Samples · Replacement
* `Approval_Status__c`: Not Required · Pending · Approved · Rejected — help text:
  *"Maintained by the PCES Sample Request Approval process. Every sample
  request routes to the requesting rep's manager automatically."*
* `Approver__c`, `Requested_By__c`, `Needed_By__c`, `Ship_To_Address__c`,
  `Requested_Items__c` (free text), `Blocked_Reason__c` (for On Hold),
  `Sample_ETA__c` — help text: *"Filled in by the sampling desk. The rep sees
  this on the opportunity."*
* Items: `Product__c` → Product2, `Quantity__c`, `Size__c`, `Finish__c`,
  `Batch_Ref__c`, `Slab_Ref__c`.

The owner wants approval **only for a stand**. The existing process routes
*every* request. That is a Salesforce approval-process change, not an ERP one.

### Stands — `Sample_Stand__c`

Also one record. `Stand_Type__c`: Floor Stand · Wall Display · Counter Display
· **Sample Kit Box** · Other. `Status__c`: Requested · Dispatched · Installed ·
Needs Refresh · Retired. `Serial_No__c`, `Account__c`, `Installed_Date__c`,
`Location_Note__c`. Note "Sample Kit Box" is a *stand type* here — Salesforce
already treats the box as a trackable unit alongside stands, which is exactly
the owner's second ask.

### The integration that was started — `Integration_Log__c`

Seven touchpoints are designed as picklist values: T1 customer master, T2
product master, **T3 inventory lookup**, T4 pricing, T5 sales order, T6 invoice
status, T7 payment status. `Direction__c` in/out, `Status__c` Success / Failed /
Pending / Retry, `Payload__c`, `Error__c`.

**26 rows exist. All are T5 – Sales order, Outbound, Pending. Newest
2026-09-08.** The payload says:

> "Awaiting T5 push to the ERP. Middleware owns retry and dead-letter."

So a Salesforce-side trigger writes a log row when an Order is created and
expects an external middleware to poll it and push to the ERP. **The middleware
was never built.** Twenty-six sales orders have been queued to nowhere for up to
a month. Nothing has ever fired for T3.

This matters twice over: it is a live problem the owner may not know about,
and it is the pattern the previous integrator chose — Salesforce as the
system that *records the intent*, an outside process that *acts on it*.

---

## 2. What the ERP has

### Finished goods — `fg_finished_slab`

25,808 slabs. Status: **AVAILABLE 19,538**, DISPATCHED 6,741, CHROMIA 126, CTS 1.
"Active stock", as the owner means it, is AVAILABLE.

`design` is **free text as the yard typed it**. 455 distinct spellings.
`fg_design_alias` (variant → canonical) is the existing mechanism that
collapses them, read once into a Map by the stock picker and the commercial
inventory bridge. `commercial_design_code.code` holds one code per canonical
design (unique) — one code per design, not per thickness.

`slab_thickness` is also free text: `"3 cm"` 14,267 · `"2 cm"` 11,097 ·
`"3 cm to 2 cm"` 440 · `"2cm"` 317 · `"1.2 cm"` 155 · `"3cm"` 29 · `"10 mm"` 25,
plus cut-downs like `"2cm to 12mm"`.

### Samples — the sampling module

A **curated** catalogue, unlike the yard: `ProductColour` (56 colours over 7
series) → `ProductColourFinish` (59 rows) → `SamplingStock` keyed on
(colour+finish, size) with a `quantity`. `/api/sampling/inventory` returns the
whole shelf in one payload, empty shelves included, so "no such colour" and
"none left" cannot render the same.

Dispatch: `SamplingDispatch` (destination DOMESTIC / INTERNATIONAL; status
RELEASED → DISPATCHED → DELIVERED) with lines keyed on (colour+finish, size).

**There is no box and no stand anywhere in the sampling model.** "Sample Box"
exists only as a crate *kind* on a commercial packing list.

The ERP's existing "sampling request" (`/api/sampling/requests`) is a
different thing from the owner's ask: it is the **desk asking the floor to cut
samples** — it becomes a `fab_project` of kind SAMPLE on the supervisor's slab
board. A salesperson's request to *ship* samples is new on the ERP side.

### Salesforce wiring in the ERP

None. No client library, no credentials, no route. The existing scheduled
jobs run as Vercel crons hitting routes guarded by `CRON_SECRET`.

---

## 3. The match, run today

Derived every ERP (canonical design, thickness → mm) into a `QZ-` code and
compared it with the 110 products.

| | count |
|---|---|
| Salesforce products matched to an ERP design at that thickness | **75** — 3,811 AVAILABLE slabs behind them |
| Salesforce products whose design is not in finished goods at all | 35 |
| Salesforce products whose design is in finished goods but not at that thickness | 10 (mostly 12 mm) |
| ERP design spellings with no Salesforce product | 383 — trials, variants, misspellings ("Alabester White", "Astal Mist", "Artermis", "Arno Robo", "Astral Mist Kreos Trail-2") |
| **ERP 3 cm stock for designs Salesforce sells at 20/12 only** | **59 designs, 4,202 AVAILABLE slabs** |

Active stock by thickness across the whole yard: **30 mm 10,391 · 20 mm 8,458
· 12 mm 153**. The largest single body of stock has no Salesforce product to
show against.

The twelve biggest matches, as Salesforce would show them today:

```
QZ-ARVAWHITE-20        417 available of 504
QZ-CAPPUCCINO-20       396 of 581
QZ-SUPERWHITE-20       329 of 507
QZ-AUREATE-20          218 of 296
QZ-LATTELUXE-20        170 of 179
QZ-BRILLIANTWHITE-20   157 of 197
QZ-OASIS-20            151 of 371
QZ-HAZELGOLD-20        145 of 259
QZ-ASTRALMIST-20       131 of 135
QZ-ANTONIO-20          106 of 106
QZ-STARCLUSTER-20      100 of 100
QZ-SAKURA-20            99 of 116
```

**What the match says about the design.** The code scheme is fine; the yard's
free text is the problem, and the ERP already solves it with `fg_design_alias`.
The Salesforce mapping must therefore go through the **canonical** design, and
the 383 noisy names are an alias-table job that exists regardless of Salesforce.
Deriving a code from raw yard text would put "Astal Mist" in Salesforce as a
product nobody sells.

---

## 4. The two facts that decide the shape

1. **Salesforce holds the request; the ERP holds the truth about stock.** A
   salesperson raises in Salesforce (the portal is built), the sampling
   incharge acts in the ERP (the shelf is there), and status has to be true in
   both. Neither system can own the other's half.
2. **The previous integration assumed a middleware and never built one.** The
   ERP is a Vercel app with crons and a Postgres it already owns; it can *be*
   that middleware for the flows that matter, and the stuck T5 rows are the
   proof that "someone else will poll it" does not ship.
