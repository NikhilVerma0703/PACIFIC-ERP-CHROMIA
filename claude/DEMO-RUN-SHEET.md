# Demo run sheet — Pacific ERP

Everything below is **invented data in a separate database**. No real customer, price or slab
is reachable from the demo. Written 18 September 2026.

---

## Start it

```bash
cd C:\Users\user\Desktop\ERP     # or wherever your clone is
npm run demo
```

Wait for `✓ Ready`, then open **http://localhost:3000**.

**You must see this box before Next starts. No box means you are on production — stop.**

```
┌──────────────────────────────────────────┐
│  DEMO MODE — database: pacificdemo       │
└──────────────────────────────────────────┘
```

`npm run dev` is the REAL app. One word apart. Check the box every time.

### Sign in

| | |
|---|---|
| Branch | **Office** |
| Email | `demo@pacific.demo` |
| Password | `demo` |

That account does not exist in production, so if the login works you are on the demo database.
It cannot be otherwise.

---

## The five-minute tour, in order

### 1. Batch lookup — `2101`

**Lookups → Batch → type `2101`.** The one batch that is complete end to end.

| | |
|---|---|
| Press runs | 4 |
| Oven runs | 4 |
| Mixer cycles | 2 |
| Finished slabs | 39 |
| Polish QC rows | 7 |

This is the trace to walk through: raw material → mixer → press → oven → polish → finished
slabs, all joined to one batch number.

### 2. Slab lookup — `900001`

**Lookups → Slab → `900001`.** *Aurora Mist*, 2 cm, grade A, from batch 2101. Traces the single
slab back through every station. `900002` (grade C) and `900003` (3 cm) are its neighbours if
you want to show a different grade or thickness.

### 3. Batch costing — `2101`

**Office → Batch Costing → `2101`.** The only fully costed batch, and it is complete:

- 10 material lines — resin, three grit sizes, filler, two pigments, two chemicals
- 3 grit silos, split across 3 invented suppliers, **every line priced**
- 15 rate-card entries behind it
- Both sign-offs recorded

**Only 2101 is costed.** The other seventeen batches will show an empty sheet. That is
deliberate — the sheet refuses to total when any line is unpriced, so one batch done properly
beats eighteen half-priced ones. Don't open another batch here.

### 4. Inventory — the fullest screens

**Inventory → Finished Goods.** 600 slabs, 24 designs, spread over 90 days so the age column
has a shape.

- **Slabs by design** — 24 design columns. The biggest are Quarry Ash (31), Cinder Storm (30),
  Pale Harbour (28), Umber Vein (27), Slate Meridian (27).
- **Batch `2102`** is the fullest at **61 slabs**; `2106` has 60.
- **Designs tab** (admin only) — the design-name worklist, with merge suggestions.

### 5. Commercial

**Office → Commercial.**

| | |
|---|---|
| Clients | 10 |
| Orders | 12, spread across the status pipeline |
| Enquiries | 14 |
| Stock holds | 5 |

Invented companies: *Altamira Piedra S.A. de C.V.*, *Blue Cedar Countertops Inc*, *Caldera
Stoneworks LLC*, *Harbourline Interiors Pvt Ltd*, *Kestrel Kitchens Pty Ltd*, *Meridian
Surfaces GmbH*.

Orders run `ORD/26-27/N0001` upward and sit at different stages — CLOSED, DISPATCHED,
INVOICED, READY, DISPATCH_CHECK — so the board is not one flat column.

### 6. Sampling

**Sampling.** 30 shelf rows, plus boxes and stands: *Sample Kit Box – 12 Piece*, *Mailer Box –
4 Piece*, *Floor Stand – 24 Slot*, *Counter Display – 9 Slot*.

### 7. Fabrication

**Fab.** 6 projects, 8 purchase orders, 10 workers, 30 slab jobs, 40 cutting entries, 120
polishing entries.

---

## Other logins, if you want to show a different desk

All on the password `demo`. Each sees only its own screens — which is itself worth showing.

| Email | Role | Branch |
|---|---|---|
| `demo@pacific.demo` | ADMIN | Office |
| `ramesh.kumar@pacific.demo` | LINE_MANAGER | Shop floor |
| `arun.subramanian@pacific.demo` | INCHARGE | Shop floor |
| `suresh.balan@pacific.demo` | OPERATOR | Shop floor |
| `vignesh.iyer@pacific.demo` | OPERATOR | Fabrication |
| `deepa.krishnan@pacific.demo` | FINANCE | Office |

Sign in on the branch shown, not Office, for the shop-floor ones.

---

## What NOT to open, and why

Being straight about this is cheaper than being surprised in front of someone.

**The CEO report will look sparse.** There are 120 QC rows spread over 21 June – 14 September,
which averages under two a day; the busiest single day has **4**. Real production is thousands.
If the report takes a date range, use the whole span and it reads fine. If it is a single-day
report, it will look nearly empty whichever day you pick. **Ask for a denser reseed if you need
this screen** — it is a few minutes' work to concentrate 500 QC rows into one recent fortnight.

**Costing for any batch other than 2101** — empty, as above.

**Salesforce sync** — not wired to the demo database, and its credentials point at the real org.
Leave it alone.

**Anything that sends** — email, Telegram, WhatsApp. The demo database is isolated; outbound
messaging is not necessarily. Don't press send on anything.

---

## Refill the data

```bash
npm run demo:seed
```

Wipes `pacificdemo` and rebuilds it in about a minute — 3,852 rows. Safe to run any time: it
refuses to start unless Postgres itself confirms the database is `pacificdemo`, and it can
reach nothing else.

## If it will not start

| Symptom | Cause |
|---|---|
| `Missing script: "demo"` | That clone predates the demo tooling — `git pull`, then `npm install` |
| `Refusing to start: could not point DATABASE_URL at pacificdemo` | No `.env.local`, or its `DATABASE_URL` does not name `neondb`. The demo URL is derived from it at launch and never stored |
| `ERR_CONNECTION_REFUSED` | Next has not finished starting. Wait for `✓ Ready` |
| Port 3000 busy | `npx kill-port 3000`, then start again |
