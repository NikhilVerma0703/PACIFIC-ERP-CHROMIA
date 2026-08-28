# Sample orders, end to end — the walkthrough

Everything in this pipeline is built and unit-tested, and **none of it has ever
run against a database**. I cannot reach yours from here, so this is the test I
would run myself, written so you can run it instead.

Do it on a **branch**, not on production. Neon → your project → Branches → new
branch off `main`, and point `DATABASE_URL` at the branch. Nothing below is
destructive, but it does create a real sample order, and a branch you can throw
away is worth the two minutes.

Budget about 30 minutes. Stop at the first step that fails and send me the step
number and what you saw — every step below says what wrong looks like, so a
failure is a sentence, not a screenshot hunt.

---

## Step 0 — before anything

```bash
npx prisma db execute --schema prisma/schema.prisma --file scripts/0059-sample-orders.sql
npx prisma generate
npm run dev
```

`prisma generate` is not optional. Without it the client has no `kind`,
`colourFinishId`, `samplingSizeId` or `samplingIntakeId` and every screen below
dies with **`Unknown argument 'kind'`** — which is a stale client, not a missing
column. If you see that sentence anywhere in this walkthrough, the answer is
always: stop, run `npx prisma generate`, restart `npm run dev`.

Confirm the catalogue is there:

```sql
SELECT (SELECT count(*) FROM product_colour)        AS colours,
       (SELECT count(*) FROM product_colour_finish) AS colour_finishes,
       (SELECT count(*) FROM sampling_size)         AS sizes;
-- colours 129, colour_finishes 516 (129 x 4). sizes may legitimately be 0.
```

If `colour_finishes` is not 516, run `scripts/0058` and then the catalogue seed
before going on — 0058 **before** the seed, or you get two spellings of the same
finish on two shelves.

---

## Step 1 — raise the request  ·  `/sampling/requests`

Fill in **three lines on purpose**, because the interesting bugs are all in the
plural:

| line | colour | finish | size | qty |
|---|---|---|---|---|
| 1 | any | Polished | pick an existing one, or type `11 x 11 x 20` | 4 |
| 2 | *the same colour* | Suede | the same size | 2 |
| 3 | any other colour | Leathered | type a size that does not exist yet | 3 |

Press Raise.

**Expect** a green confirmation naming an order code `SR-0001` (or the next
number), 3 lines, 9 pieces, and — because of line 3 — a note that a size was
created.

**This is the step that was broken.** `fab_requirement.slab_code` is `NOT NULL`
with no default and the create left it out, so every request died with a bare
500 and no field named. Fixed this session; this step is the proof. If you get a
500 here, open the terminal running `npm run dev` and send me the stack.

```sql
-- the order, its kind, and its three rows
SELECT p.project_code, p.kind, p.customer_name, p.number_of_pieces,
       r.row_letter, r.piece_label, r.quantity, r.slab_code,
       r.sink_quantity, r.sink_required, r.fabrication_required, r.polish_required
FROM   fab_project p JOIN fab_requirement r ON r.project_id = p.id
WHERE  p.kind = 'SAMPLE'
ORDER  BY p.created_at DESC, r.row_letter;
```

**Every row must read:** `kind = SAMPLE`, `slab_code = UNASSIGNED`,
`row_letter` A / B / C — three different letters —
`sink_quantity = 0`, `sink_required = false`, `fabrication_required = false`,
`polish_required = true`.

A sample row with a sink is the one thing this model must never produce. If
`sink_quantity` is anything but 0, stop.

```sql
-- lines 1 and 2 are the same colour in different finishes: two shelves, not one
SELECT r.row_letter, c.name AS colour, cf.finish,
       s.length_in, s.width_in, s.thickness_mm
FROM   fab_requirement r
JOIN   fab_project p           ON p.id  = r.project_id AND p.kind = 'SAMPLE'
JOIN   product_colour_finish cf ON cf.id = r.colour_finish_id
JOIN   product_colour c         ON c.id  = cf.colour_id
JOIN   sampling_size s          ON s.id  = r.sampling_size_id
ORDER  BY r.row_letter;
```

Three rows, each with a colour, a finish and a size. A NULL in any of those
columns means the line did not resolve and packing will have nowhere to credit.

---

## Step 2 — the supervisor sees a sample  ·  `/fab/supervisor`

Open the project list.

**Expect** the new `SR-0001` card to carry a **SAMPLE badge**. That badge is the
whole point — a supervisor should not have to work out which board he is on from
an empty sink column.

Open it. **Expect the steps to be numbered 1, 2, 3** — not 1 to 5. Steps 3 and 4
(sink decision, finished edges) are hidden on a sample project, and "Send to
cutter" is step **3**.

If you see five steps, the project's `kind` did not reach the screen: check
`SELECT kind FROM fab_project WHERE project_code = 'SR-0001';` and, if it says
SAMPLE, it is the stale Prisma client again.

---

## Step 3 — pick a slab and send it

Search a QC slab, add it to the board, drag the three rows onto it with the full
quantities (4 / 2 / 3), then **Send to cutter**.

```sql
-- nine pieces, lettered per row, none of them carrying a sink
SELECT pc.piece_code, pc.status, pc.has_sink,
       pc.polish_required, pc.fabrication_required
FROM   fab_piece pc
JOIN   fab_project p ON p.id = pc.project_id AND p.project_code = 'SR-0001'
ORDER  BY pc.piece_code;
```

**Expect** 9 rows, codes `SR-0001-A-1 … A-4`, `B-1 B-2`, `C-1 … C-3`,
`status = PENDING`, and **`has_sink = false` on all nine**.

```sql
-- the slab is now marked as cut, and inventory agrees
SELECT q.slab_number, q.quality_grade, q.slab_mark, fs.grade AS inventory_grade
FROM   polish_qc q
LEFT   JOIN finished_slab fs ON fs.slab_number = q.slab_number
WHERE  q.id = '<the pacific_qc_id you picked>';
```

`slab_mark` should read **CTS** — this is a fabrication-style cut of a whole
slab. And `inventory_grade` must have moved to `CTS` too: that mirror is what
blocks dispatch, and it not updating was the live hole fixed earlier. If
`inventory_grade` still says A or B, the mirror did not refresh — tell me.

Try to dispatch that slab from the inventory screen. **It must refuse.**

---

## Step 4 — cut  ·  `/fab/cutting`

Start a session on a machine, find the slab job, Start and Complete.

```sql
SELECT status, count(*) FROM fab_piece pc
JOIN fab_project p ON p.id = pc.project_id AND p.project_code = 'SR-0001'
GROUP BY status;
-- expect: CUT 9
```

While you are here, test the guard I added this session. Press **Revert** on the
job you just completed.

**Expect it to succeed** — nothing has moved past cutting, which is exactly the
case revert exists for. Then complete it again to carry on. (Later, after Step
6, pressing Revert must *refuse* with a 409 naming how many pieces are packed.
Come back and try it if you want to see it; it is the fix for a revert that used
to send packed pieces back to the saw and let them be packed a second time.)

---

## Step 5 — polish  ·  `/fab/polishing`

All nine pieces should be in this queue. Complete them.

**They must NOT appear in `/fab/sink-cutting` or `/fab/fabrication` at any
point.** That is the routing rule for samples; if a sample piece shows up in
either queue, stop and tell me.

```sql
SELECT status, count(*) FROM fab_piece pc
JOIN fab_project p ON p.id = pc.project_id AND p.project_code = 'SR-0001'
GROUP BY status;
-- expect: POLISHED 9
```

---

## Step 6 — pack, and the shelf gets credited  ·  `/fab/packaging`

This is the step the whole design turns on. Pack all nine.

```sql
-- every packed piece created exactly one intake, and no piece created two
SELECT count(*) FILTER (WHERE pc.status = 'PACKAGED')          AS packaged,
       count(*) FILTER (WHERE pc.sampling_intake_id IS NOT NULL) AS credited
FROM   fab_piece pc
JOIN   fab_project p ON p.id = pc.project_id AND p.project_code = 'SR-0001';
-- expect: packaged 9, credited 9
```

```sql
-- the shelves. Line 1 and line 2 were the same colour and size in different
-- finishes and MUST be two separate shelves.
SELECT c.name AS colour, cf.finish,
       s.length_in, s.width_in, s.thickness_mm, st.quantity
FROM   sampling_stock st
JOIN   product_colour_finish cf ON cf.id = st.colour_finish_id
JOIN   product_colour c         ON c.id  = cf.colour_id
JOIN   sampling_size s          ON s.id  = st.sampling_size_id
ORDER  BY c.name, cf.finish;
-- expect the three shelves to have gone up by 4, 2 and 3
```

Note the shelf numbers before you pack if any of them were non-zero — the test
is the **increase**, not the total.

**Now press Pack again on an already-packed piece, or re-run the packing call.**
The credit must not double. `fab_piece.sampling_intake_id` is unique and is
claimed inside the same transaction, so the second run credits nothing.

```sql
-- MUST RETURN 0 ROWS: an intake claimed by two pieces
SELECT sampling_intake_id, count(*) FROM fab_piece
WHERE  sampling_intake_id IS NOT NULL
GROUP  BY 1 HAVING count(*) > 1;
```

---

## Step 7 — the desk sees it finished  ·  `/sampling/requests`

**Expect** `SR-0001` showing ordered 9 · on slabs 9 · released 9 · packed 9 ·
credited 9. All five equal is what "done" looks like; any two differing is where
the pipeline stopped, and the column that lags tells you which step to re-read.

---

## Step 8 — and it earns nothing, correctly  ·  `/fab/ceo` → Report

Set the window to cover today.

**Expect** the nine pieces in **Packed**, and **₹0** in Edge, Sink ₹ and Total.
A sample is cut, polished and packed with no fabrication in it, so there is
nothing on the rate card to charge. The footnote should read *"Of the 9 pieces
packed in this window, 0 earned the money above."*

That second number is new this session, and it is worth understanding, because
it is where the pricing bug lived. A purchase-order row of 60 pieces with 30
sinks packs **60** and charges for **30** — the charge spreads over the
fabrication pieces only. The report used to apply that per-piece share to all
sixty and bill the row at exactly twice its value, silently, because both halves
of the row are the same size and colour and nothing on the screen looked wrong.
If you want to see the fix on real money, find a mixed PO row and check that
Packed and charged differ.

---

## What I could not test for you

* **Concurrency.** Two desks raising a request in the same second, two
  supervisors sending the same slab. The locks are in the code and reasoned
  about; they are not proven.
* **Volume.** Nine pieces is a walkthrough, not a load test.
* **The SR- number under contention.** It reads `MAX` inside the transaction and
  never reuses a deleted number, but two simultaneous POSTs will make one of
  them lose on the unique index and return a bare 500 rather than retrying. Rare
  and self-evident when it happens; worth fixing if two people really do raise
  requests at once.
