# Remnants — keeping the offcut instead of calling it waste

**Status:** specified, not built. Agreed 2026-08-25, deferred until the sample
pipeline is proven and the production push is done.

---

## The ask

The owner, looking at a slab card reading **75.4% waste**:

> "See the wastage is there right. So if supervisor sees and thinks it can be
> the sample, or consumed later, so he keeps them in samples and consumes it
> later for samples or any other cut-to-size piece as well. How to solve this?"

The card in question: slab 146838, Carrara Royale 30 mm, 75.16 sqft. Twenty-two
11 × 11 in samples took 18.49 sqft. **56.67 sqft left, called waste.**

It is not waste. It is a rack of usable stone that nothing in the system can
name.

---

## What already exists

More than expected. This is wiring, not invention.

| Already there | State |
|---|---|
| `fab_residual_bag` (bag_code, slab_id, rack, remarks) | in `schema.prisma`, **nothing writes it** |
| `fab_residual_piece` (bag_id, length, width, quantity, area, reusable) | in `schema.prisma`, **nothing writes it** |
| `computeSlabLoss(input.reclaimedAreaSqft)` | parameter exists, **no caller sets it** |
| `SlabLossResult.trueScrapPct` | computed, and already saved to `fab_slab_job.true_scrap_pct` |
| `sampledAreaSqft` | fully wired — sampling take-off already leaves the waste figure |

`scripts/0051` says it out loud: *"the offcut side has purpose-built models
(`fab_residual_bag` / `fab_residual_piece`) and NOTHING writes them."*

So the two halves of the owner's sentence are in opposite states:

* **"it can be the sample"** — works today. `Cut this slab for samples` on the
  slab card records pieces via `lib/sampling/fabIntake.ts`, and `sampledAreaSqft`
  already takes that stone out of the waste figure.
* **"or consumed later"** — nothing at all. There is no way to park stone and
  decide afterwards, and that is what those 56.67 sqft need.

---

## The hole underneath it

Independent of the feature, and live right now.

`/api/fab/supervisor/slab-assignment` creates every `fab_slab` at
`STANDARD_SLAB_MM` — 137 × 79 in, **always**, regardless of what the stone has
already given:

```ts
const totalArea = STANDARD_SLAB_MM.lengthMm * STANDARD_SLAB_MM.widthMm;
```

So adding slab 146838 to a *second* project hands that project a full 75.16 sqft
that the first project already spent — while the first project has booked the
same stone as waste. **The same square foot counted twice, in opposite
directions.** Nothing refuses it, and no screen shows it.

Part 3 below closes this properly. Until it is built, the cheap guard is to warn
on add-slab when the QC row already reads CTS: *"this slab has already been cut
— what is left of it is not a full slab."*

---

## The model

A remnant is **measured rectangles, not an area**. Decided deliberately.

56.67 sqft "left" is a subtraction, not a shape. The real leftover may be an
L, or a strip too narrow for anything. What the supervisor can actually cut is
what he can measure with a tape — say two pieces at 40 × 30 in — and the
difference between that and 56.67 is honest scrap that should stay honest.

An area alone could fix the waste percentage and nothing else: you cannot put a
number on a saw.

### Units — the recurring bug class here, so stated once and loudly

* `fab_residual_piece.length` / `.width` are **INCHES**, matching
  `fab_requirement` and matching the tape in the supervisor's hand.
* `fab_residual_piece.area` is **SQUARE FEET**, matching everything
  `computeSlabLoss` speaks.
* `fab_slab.length` / `.width` are **MILLIMETRES**. Consuming a remnant
  therefore converts, using `INCH_TO_MM` from `lib/fab/slabLoss.ts` — never a
  literal 25.4 written a second time.
* Thickness and colour are **not stored on the remnant**. They come from the
  parent slab through `bag.slabId`. A remnant cannot be a different colour or
  thickness from the stone it was cut off, so storing them would only create
  somewhere for the two to disagree.

---

## Part 1 — Keep the offcut

**Where:** the slab card, beside `Cut this slab for samples`. Same shape of
control, deliberately: they are the two things a supervisor does with leftover
stone, and they should sit together.

**When:** any time, but the numbers only move once recorded. Realistically after
the cut, when the offcut is on the rack and measurable.

**What he types:** one row per usable rectangle — length in, width in, how many —
plus a rack code for the bag so it can be found again, and a remark.

**Writes:**

* one `fab_residual_bag` per recording — `bag_code` = `{slabCode}-R{n}`, unique;
  a slab cut twice gets two bags
* one `fab_residual_piece` per rectangle, `area` computed by `sqftFromInches()`
  and stored, never recomputed at read time

**API:** `POST /api/fab/supervisor/slabs/[slabId]/residuals`

Refuses when the recorded area exceeds what the slab has left
(`slabAreaSqft - usedAreaSqft - sampledAreaSqft`). A supervisor cannot keep more
stone than the slab had, and the refusal should say the arithmetic rather than
"invalid".

---

## Part 2 — The waste number stops lying

Feed the bag's pieces into the `reclaimedAreaSqft` parameter that already
exists. Everywhere `computeSlabLoss` is called — `approve-slab`, the slab board,
the CEO wastage — gains it in one change, because they all go through that one
function.

The card then shows **two numbers and never one**:

```
75.4% not used     of the slab, what this project's pieces did not take
22.5% true scrap   after samples and kept offcuts — the stone actually lost
```

Same lesson as Ops vs Packed on the report: a single number that merges two
different questions gets read as whichever one the reader had in mind. One
column for both was the bug there, and it would be the bug here.

`trueScrapPct` is already computed and already written to
`fab_slab_job.true_scrap_pct` on every send, so the CEO wastage figures become
honest at the same moment with no extra write.

---

## Part 3 — Consume it

The supervisor wants that remnant for a sample order, or for another
cut-to-size job. He picks it from a **remnant rack** on the slab board — a second
source beside "search QC" — filtered to the colour and thickness the project
needs.

**Consuming a remnant creates a `fab_slab`.**

| new slab field | from |
|---|---|
| `projectId` | the project consuming it |
| `slabCode` | parent's `slabCode` + `-R` — visible on the floor as a remnant |
| `colour`, `thickness`, `pacificQcId` | the parent slab |
| `length`, `width` | the remnant's inches × `INCH_TO_MM` |
| `totalArea`, `availableArea` | from those dimensions |

Everything downstream then works **unchanged** — allocation, cutting job, piece
creation, loss — because a remnant on the saw *is* a slab, just a small one.
This is the same move the sample-order design made: a sample order is a
`fab_project` with `kind = SAMPLE` rather than a parallel set of tables. One
pipeline, one set of screens, one place an operator looks.

`fab_slab.pacificQcId` is nullable and **not** unique, and `fab_slab` is already
per-project, so two rows pointing at one QC slab is a shape the schema already
supports. Nothing new is being bent.

### Partial consumption

A residual row of "2 at 40 × 30" where only one is wanted **splits**, exactly as
a PO row splits on the sink decision (`lib/fab/sinkSplit.ts`): the source row's
quantity drops to 1, and a new row of quantity 1 is created carrying
`consumed_by_slab_id`. The supervisor already understands that pattern from the
PO board, and reusing it means one idea rather than two.

### First check the tables are actually there

**They are in `schema.prisma` and no script in `scripts/` creates either of them.**
Verified 26 Aug: `fab_residual_bag`, `fab_residual_piece`, `fab_dispatch` and
`fab_drawing` are all declared in Prisma and created by nothing. Locally they
exist because `prisma db push` made them; production is administered by hand and
has only ever had what the numbered scripts wrote.

So `scripts/0062` cannot open with an `ALTER TABLE` — it has to establish the
tables first, or it fails on a database that never had them:

```sql
SELECT to_regclass('public.fab_residual_bag')   AS bag,
       to_regclass('public.fab_residual_piece') AS piece;
-- NULL on either means the script below must CREATE, not ALTER.
```

### The one new column

```sql
ALTER TABLE fab_residual_piece
  ADD COLUMN IF NOT EXISTS consumed_by_slab_id text UNIQUE REFERENCES fab_slab(id);
```

**UNIQUE is the point.** It is what makes consuming idempotent under a
double-click, the same way `fab_piece.sampling_intake_id` stops packaging
crediting a shelf twice. A remnant is one physical object; it can become exactly
one slab.

Add it to `schema.prisma` in the same commit — `prisma db push` drops undeclared
columns, and that is how `users.alt_role` was lost once already.

Script: `scripts/0062-fab-residual-consumed.sql`, idempotent, plus the
`@@index([bagId])` and `@@index([slabId])` those two tables never got.

---

## What this deliberately does not do

* **No optimiser.** The system records what the supervisor measured; it does not
  work out what fits. Cut-list optimisation is a separate conversation.
* **No irregular shapes.** A remnant is rectangles or it is scrap. An L is two
  rectangles if he wants it to be.
* **No automatic remnant creation.** Nothing infers a remnant from leftover
  area. A remnant exists because a person looked at the rack and measured it —
  inferring one would put stone in the system that may already be in a skip.
* **No expiry or ageing.** Worth revisiting once there is a rack full of them.

---

## Verification, once built

```sql
-- MUST RETURN 0 ROWS — a bag claiming more stone than its slab had
SELECT b.bag_code, s.slab_code, sum(p.area) AS kept, s.total_area
FROM   fab_residual_bag b
JOIN   fab_residual_piece p ON p.bag_id = b.id
JOIN   fab_slab s           ON s.id     = b.slab_id
GROUP  BY b.bag_code, s.slab_code, s.total_area
HAVING sum(p.area) > s.total_area / 92903.04;   -- sq mm -> sq ft

-- MUST RETURN 0 ROWS — one remnant became two slabs
SELECT consumed_by_slab_id, count(*) FROM fab_residual_piece
WHERE  consumed_by_slab_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;

-- The rack, as the supervisor would read it
SELECT s.colour, s.thickness, p.length, p.width, sum(p.quantity) AS pieces,
       round(sum(p.area)::numeric, 2) AS sqft
FROM   fab_residual_piece p
JOIN   fab_residual_bag b ON b.id = p.bag_id
JOIN   fab_slab s         ON s.id = b.slab_id
WHERE  p.consumed_by_slab_id IS NULL AND p.reusable
GROUP  BY 1,2,3,4 ORDER BY s.colour, s.thickness;
```
