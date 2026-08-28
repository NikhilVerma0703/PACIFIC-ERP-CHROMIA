# Pushing fabrication + sampling to Neon

Audit and runbook, 2026-08-25. **Scope: fabrication and sampling only.** Nothing
here touches chromia, robo, costing, sales or finance.

---

## THE AUDIT

### 1. `prisma db push` data loss — CLOSED

Every column any in-scope script creates was checked against `prisma/schema.prisma`.

```
checked 22 (table, column) pairs
tables with no Prisma model:  none
columns not declared:         none
```

All 9 tables created by `0051` (`product_series`, `product_colour`,
`product_colour_finish`, `sampling_size`, `sampling_stock`, `sampling_intake`,
`sampling_dispatch`, `sampling_dispatch_line`) plus `fab_po` from `0044` have
models. This is the failure that lost `users.alt_role` and `users.alt_branch`;
for this module it is now shut.

**It stays shut only while the declarations stay.** Anyone deleting a field from
`schema.prisma` because "nothing uses it" re-opens it.

### 2. Script number collisions — REAL, and they bite here

Six numbers are used twice, and in every case one is ours and one is not:

| # | OURS — run it | NOT ours — do **not** run |
|---|---|---|
| 0043 | `0043-fab-requirement-sink-quantity.sql` | `0043-costing-batch-verification.sql` |
| 0044 | `0044-fab-po.sql` | ⚠️ `0044-drop-chromia-module.sql` |
| 0045 | `0045-fab-board-indexes.sql` | `0045-chromia-module.sql` |
| 0046 | `0046-fab-stage-series-indexes.sql` | `0046-migrate-chromia-branch-users.sql` |
| 0047 | `0047-fab-worker-session.sql` | `0047-robo-batch-setup-fields.sql` |
| 0048 | `0048-fab-reject-downtime.sql` | `0048-costing-verification-per-person.sql` |

> **Never use a glob.** `--file scripts/0044-*.sql` is ambiguous, and one of the
> two candidates **drops the chromia module**. Every command below names the file
> in full. This is the single most dangerous thing about this push.

### 3. Idempotency — every in-scope script is re-runnable

- Columns: `ADD COLUMN IF NOT EXISTS`
- Tables and indexes: `IF NOT EXISTS`
- Constraints: `ADD CONSTRAINT` has no `IF NOT EXISTS` in Postgres, so each is
  wrapped — `0044/0047/0048/0055/0057/0059` guard on `pg_constraint`, `0051`
  uses `EXCEPTION WHEN duplicate_object`. Both forms are correct.

So you can run the whole sequence without first working out what is already
applied. Re-running an applied script is a no-op.

### 4. Destructive statements — one, and it is bounded

`0058` is the only in-scope script that deletes anything:

```sql
DELETE FROM sampling_stock         WHERE colour_finish_id = pair.old_id;
DELETE FROM product_colour_finish  WHERE id = pair.old_id;
```

Both fire **only inside the merge loop**, and that loop only finds a row when one
colour holds BOTH spellings of one finish (`Leather` *and* `Leathered`, or
`Honed` *and* `Matte`). Before the delete, the losing shelf's quantity is
**summed into the survivor** and its intake and dispatch lines are re-pointed.
No count is lost; two shelves become the one they always were.

On a database that has never had a hand-typed finish, the loop finds nothing and
the deletes never run.

### 5. Cross-module dependencies — none

The only foreign keys the new scripts create point at `product_colour_finish`,
`sampling_size` and `sampling_intake` — all from `0051`, all in scope. Nothing in
this batch needs a chromia, robo or costing script to have run.

---

## THE RUN

### Step 0 — branch first

```bash
# Neon console → your project → Branches → New branch from production.
# Or: neonctl branches create --name pre-2026-08-25 --parent production
```

None of this is reversible by running it backwards. `0058` renames stored values
and `0057` backfills a column; a branch is the only real undo.

Then point your shell at production:

```bash
export DATABASE_URL='postgresql://...neon.tech/...?sslmode=require'
```

### Step 1 — see where production actually is

Run this first. It tells you which of the 22 columns and 9 tables already exist,
so you know your starting point rather than guessing.

```sql
SELECT s.t AS "table", s.c AS "column",
       CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'present' END AS state
FROM (VALUES
  ('fab_requirement','sink_quantity'),   ('fab_requirement','po_id'),
  ('fab_requirement','row_letter'),      ('fab_requirement','finished_edges'),
  ('fab_requirement','colour_finish_id'),('fab_requirement','sampling_size_id'),
  ('fab_operation','worker_id'),         ('fab_operation','shift'),
  ('fab_machine_session','worker_id'),   ('fab_slab_job','worker_id'),
  ('fab_piece','reject_reason'),         ('fab_piece','reject_notes'),
  ('fab_piece','rejected_at'),           ('fab_piece','rejected_by_worker_id'),
  ('fab_piece','sampling_intake_id'),    ('fab_project','kind'),
  ('polish_qc','quality_grade_before_cts'), ('polish_qc','slab_mark'),
  ('sampling_intake','source_qc_id'),    ('sampling_intake','source_slab_id'),
  ('users','alt_role'),                  ('users','alt_branch')
) AS s(t,c)
LEFT JOIN information_schema.columns c
       ON c.table_name = s.t AND c.column_name = s.c AND c.table_schema = 'public'
ORDER BY state DESC, s.t, s.c;
```

```sql
-- and the tables
SELECT t.n AS "table",
       CASE WHEN to_regclass('public.'||t.n) IS NULL THEN 'MISSING' ELSE 'present' END AS state
FROM (VALUES ('fab_po'),('product_series'),('product_colour'),
             ('product_colour_finish'),('sampling_size'),('sampling_stock'),
             ('sampling_intake'),('sampling_dispatch'),('sampling_dispatch_line')
) AS t(n) ORDER BY state DESC, t.n;
```

### Step 2 — apply, in this exact order

Full filenames, no globs. Safe to run all of them even if some are already
applied.

```bash
npx prisma db execute --schema prisma/schema.prisma --file scripts/0043-fab-requirement-sink-quantity.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0044-fab-po.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0045-fab-board-indexes.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0046-fab-stage-series-indexes.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0047-fab-worker-session.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0048-fab-reject-downtime.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0051-sampling-and-catalogue.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0052-user-alt-role-context.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0053-sampling-source-qc.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0054-fab-requirement-row-letter.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0055-fab-requirement-finished-edges.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0056-polish-qc-grade-before-cts.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0057-polish-qc-slab-mark.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0058-sampling-finish-vocabulary.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0059-sample-orders.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0060-finished-slab-cut-grade-backfill.sql
npx prisma db execute --schema prisma/schema.prisma --file scripts/0061-fab-slab-thickness-repair.sql
```

Order is not decoration: `0051` creates the tables `0053`, `0058` and `0059`
reference; `0058` must run **before** the catalogue seed; `0059` assumes `0051`.

The last two are REPAIRS, not schema, and they come last because each reads a
column an earlier script creates. Both are idempotent and both refuse to touch a
row they cannot prove is wrong:

* `0060` stops already-cut slabs from being dispatchable. It only ever blocks
  more, never less — nothing sellable today stops being sellable.
* `0061` fixes slabs stored ten times too thick, from when QC text in
  millimetres ("12mm", "7mm") went through a centimetre conversion. Thickness is
  the key of the rate card, so a wrong one prices every sink and every running
  foot on that slab at the other band.

`0052` (`users.alt_role` / `alt_branch`) is included because the dual-role
switcher is what lets one person be both Fabrication Supervisor and Line
Incharge. Drop it from the list if that is not going live.

### Step 3 — verify before going further

```sql
-- 0057: every slab has a mark; already-cut ones say CTS
SELECT slab_mark, count(*) FROM polish_qc GROUP BY slab_mark ORDER BY 2 DESC;

-- and nothing drifted between the grade and the mark. MUST return 0 rows.
SELECT id, slab_number, quality_grade, slab_mark FROM polish_qc
WHERE upper(btrim(coalesce(quality_grade,''))) = 'CTS' AND slab_mark <> 'CTS';

-- 0058: only the four finishes exist. MUST return 0 rows.
SELECT DISTINCT finish FROM product_colour_finish
WHERE finish NOT IN ('Polished','Suede','Matte','Leathered');

-- 0059: the new columns are there
SELECT count(*) FILTER (WHERE kind = 'PO')     AS po_projects,
       count(*) FILTER (WHERE kind = 'SAMPLE') AS sample_orders
FROM fab_project;

-- 0054: row letters unique per project. MUST return 0 rows.
SELECT project_id, row_letter, count(*) FROM fab_requirement
WHERE row_letter IS NOT NULL
GROUP BY 1,2 HAVING count(*) > 1;
```

### Step 4 — regenerate and seed

```bash
npx prisma generate
npm run db:seed:catalogue
```

`prisma generate` is what fixes `Unknown argument 'kind'` — that error is a
client generated before the field existed, not a missing column.

The catalogue seed is **master data and is meant to run against production** — no
environment guard, deliberately. It upserts on natural names (series name,
colour name, colour+finish), so re-running changes nothing:

```
series:            7
colours:           129
colour+finishes:   516   (every colour × Polished, Suede, Matte, Leathered)
```

It aborts before writing anything if the chart has gone self-contradictory,
rather than failing halfway and leaving production half-written.

**Run it after `0058`.** The seeder writes `Leathered` and `Matte`; if it goes
first, `0058` finds nothing to rename and any older `Leather` / `Honed` rows
survive alongside — two spellings, two shelves, one physical finish.

### Step 5 — final check

```sql
-- the catalogue landed whole
SELECT (SELECT count(*) FROM product_series)        AS series,
       (SELECT count(*) FROM product_colour)        AS colours,
       (SELECT count(*) FROM product_colour_finish) AS colour_finishes;
-- expect 7 / 129 / 516

-- no colour lost its finishes. MUST return 0 rows.
SELECT c.name FROM product_colour c
LEFT JOIN product_colour_finish f ON f.colour_id = c.id
GROUP BY c.name HAVING count(f.id) <> 4;
```

Then deploy the app and hard-refresh.

### THE DATABASE GOES FIRST. THE APP GOES SECOND.

Not a preference — the order is the whole safety of this push, and it is the one
thing here that can take the floor down.

The new code selects `fab_project.kind`, `fab_requirement.colour_finish_id`,
`fab_requirement.sampling_size_id`, `fab_requirement.row_letter` and
`fab_piece.sampling_intake_id` by name. Postgres answers a select for a column
that does not exist with an error, not a null, so a deploy that lands **before**
Step 2 does not degrade — the supervisor's slab board, the sampling screens and
the packaging queue return 500 and stay there until the SQL is run. Nobody can
cut, and the failure looks like a broken release rather than a missing script.

Run in the other order and there is no window at all: the columns are additive,
every one of them is nullable or defaulted, and the **old** code neither reads
nor writes any of them. Production runs on the new schema, unchanged and
unbothered, for as long as it takes to press deploy.

If the deploy has already gone out and the screens are 500ing: this is Step 2,
not a rollback. Run it and they come back.

---

## Do not run

| File | Why |
|---|---|
| `0044-drop-chromia-module.sql` | Drops the chromia module. Shares a number with ours. |
| `0043-costing-batch-verification.sql` | Costing, not ours |
| `0045-chromia-module.sql` | Chromia |
| `0046-migrate-chromia-branch-users.sql` | Chromia |
| `0047-robo-batch-setup-fields.sql` | Robo |
| `0048-costing-verification-per-person.sql` | Costing |
| `0037-fab-test-data-reset.sql` | **Wipes fabrication test data.** Never against production. |
| `npx prisma db push` | Drops undeclared columns. Use `db execute`. |

---

## If something goes wrong

Restore the branch from Step 0. Do not attempt to hand-reverse `0058` — the
merge summed two shelves into one and the split is not recoverable from the
result. Everything else is additive and harmless to leave in place.

## Known gap, worth deciding before you push

Slabs that fabrication took **before** this batch carry a stale
`finished_slab.grade`, because nothing was refreshing inventory's mirror. They
stay wrongly dispatchable until their next QC save. The fix from now on is live
(`refreshInventoryMirror`), but there is no backfill script yet. Say the word and
`0060` can sync `finished_slab.grade` from `polish_qc` for every slab already
marked CTS or SAMPLE.
