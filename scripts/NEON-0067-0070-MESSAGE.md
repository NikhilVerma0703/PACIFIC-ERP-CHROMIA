# Message to send with the migration

**Attach BOTH:**
- `scripts/NEON-0067-0070-PREFLIGHT.sql` — read-only, run this first
- `scripts/pacific-fab-0067-0070-neon.sql` — the migration

---

Hi,

One file for the fabrication module — `pacific-fab-0067-0070-neon.sql`. It is
four scripts (0067, 0068, 0069, 0070) concatenated in run order, with a runbook
in the header.

**What it does:** it adds 31 columns to three tables — `fab_requirement`,
`fab_piece`, `fab_project`. That is all it does. There is no UPDATE, no DELETE,
no DROP COLUMN, no TRUNCATE and no data change of any kind anywhere in it.

**Every column is nullable** except `fab_piece.polish_by_hand`, which carries
`DEFAULT false`. On Postgres 11+ a NOT NULL column with a constant default is a
catalogue change, not a table rewrite, so no existing row is touched by that
either.

**BEFORE ANYTHING: one prerequisite to check**

Run `NEON-0067-0070-PREFLIGHT.sql` first. It is a read-only SELECT against
`information_schema` — it changes nothing and is safe on production directly. It
prints one line per expected column, `present` or `MISSING`, with the missing
ones sorted to the top.

If it reports the three **0066** rows as missing —

    fab_piece.charged_edge
    fab_piece.charged_sink
    fab_piece.charged_at

— then `pacific-fab-0063-0066-neon.sql` has not been applied, and it must go in
BEFORE this file. Those three are not in this migration and not in the Prisma
schema (the application writes them with raw SQL), so nothing else reveals their
absence. Without them the packaging step still succeeds, but the per-piece
charge is never frozen: the write fails silently and every figure is re-priced
live forever, which defeats the point of freezing it.

**Do not run `pacific-fab-0067-0068-neon.sql`** if a copy of it has reached you.
It is an earlier, incomplete cut of the same work, missing eight of the
thirty-one columns — all of 0069 and 0070:

    pair_rate  edge_rate_top  edge_rate_bottom  edge_rate_side
    hand_pair_rate  hand_rate_top  hand_rate_bottom  hand_rate_side

Those carry the per-face and paired hand-polish rates the current code prices
from. `pacific-fab-0067-0070-neon.sql` supersedes it completely.

**How to run it**

1. Neon → Branches → new branch from production. Apply there first.
2. Use the **direct endpoint, not `-pooler`**. The pooled host multiplexes
   sessions and can hold DDL behind another transaction.
3. Run **section 6** of the header before you start — it tells you which parts
   are already applied, if any. Everything is idempotent, so re-running is safe
   either way.
4. Run **section 8** afterwards. It has the verification queries, including the
   one that matters: every new column NULL on every existing row.
5. Once that looks right on the branch, apply to production. I deploy the code
   after, not before.

**Two things that look alarming in a plain grep and are not** — section 4 covers
both, but so you are not surprised:

- `UPDATE` and `DELETE` appear only inside `ON DELETE SET NULL ON UPDATE
  CASCADE`, the referential action on the new foreign keys. Not statements.
- `DROP CONSTRAINT IF EXISTS` appears 7 times. It is the drop-then-add
  idempotency pattern, and **every name it drops is created by the same file a
  few lines further down** — they do not exist before 0067 runs, so on a first
  run all seven are no-ops. No pre-existing constraint is named anywhere in the
  file. You can confirm that yourself with

  ```sql
  SELECT conname FROM pg_constraint WHERE conname LIKE 'fab_%_ck' ORDER BY conname;
  ```

  before and after, and diffing: the after list is the before list plus the new
  names, with nothing missing.

**Lock profile:** every statement is ADD COLUMN or ADD CONSTRAINT. Each takes
ACCESS EXCLUSIVE on its table for the instant it edits the catalogue and then
releases it. No table is scanned, no row is rewritten, so duration does not grow
with table size. The CHECKs in 0068/0069/0070 are added NOT VALID and validated
in separate statements outside the transaction, so the validation pass takes only
SHARE UPDATE EXCLUSIVE and blocks neither reads nor writes.

If something blocks, it is waiting on an existing long transaction rather than on
its own work — cancel and retry rather than waiting it out.

**Rollback** is in section 7: dropping these columns loses only what has been
typed into them since. No pre-existing data is at risk because none of it is
touched.

**Tested before sending:** applied twice on Postgres 16. The first test was on a
database seeded with a copy-shaped PO 10026 row and a piece: both runs clean,
the row byte-for-byte unchanged, and the existing
`fab_requirement_finished_edges_ck` still present afterwards.

Re-tested 2026-09-09 against a database rolled back to exactly the
pre-migration schema. The file applied clean, produced a schema **byte-identical
to the working development database** (column name, type, nullability and
default all compared), and a second run reported zero errors and changed
nothing. 31 columns and 16 constraint statements, of which 5 are added NOT VALID
and validated separately.

Thanks.

---

## What it is for (if he asks)

| script | what it adds | why |
|---|---|---|
| **0067** | three-face hand-polish spec, per-row rate, pricing mode, agreed total, project total | Hand polish can be quoted top / bottom / side independently, per running foot, per piece, or as a lump sum, with a signed override |
| **0068** | `dim_unit` | Some orders are written in centimetres (Kerasom, Netherlands). Lengths stay stored in inches; this only decides what the screens print |
| **0069** | `pair_rate`, `hand_pair_rate` | A side polished on both faces is one trip with the piece flipped, so it is quoted as one figure instead of charged twice |
| **0070** | `edge_rate_top/bottom/side` and the hand equivalents | Top, bottom and the side band can each carry a different rate |

**Nothing in the running application writes to any of these until somebody uses
the new screens**, so there is no window where the old code and the new columns
disagree. The application also reads them defensively — a missing column leaves
a row showing "not chosen" rather than failing — which is why the migration can
safely go in ahead of the deploy.

## NOT in this file, on purpose

`data-PI1200-desert-silk.sql` and `data-PI1200-set-cm.sql` load a real 3,808-piece
customer order (Kerasom, PI SAL-ORD/25-26/01200). That is a business decision
about when that order goes live in production, not a schema change, and it should
not travel in a DBA migration batch.
