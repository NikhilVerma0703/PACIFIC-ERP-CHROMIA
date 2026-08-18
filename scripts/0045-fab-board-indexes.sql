-- 0045: indexes for the two supervisor boards — slab assignment and sinks.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0045-fab-board-indexes.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and
-- raw-SQL-only columns that push proposes dropping — see the note at the top of
-- the sales section in schema.prisma and scripts/0040/0043/0044.)
--
-- NO NEW TABLES AND NO NEW COLUMNS. Everything the two boards store already
-- exists: allocations go into fab_requirement_allocation (requirement_id,
-- slab_id, allocated_quantity), the sink decision into
-- fab_requirement.sink_quantity from 0043, and the loss figures into
-- fab_slab_job.used_area_sqft / total_wastage_pct / true_scrap_pct, three
-- columns that have been in the schema since the fabrication module landed and
-- were written by nothing at all. This script is five indexes and nothing else.
--
-- PURELY ADDITIVE AND IDEMPOTENT. No backfill, no UPDATE, no DROP, no DEFAULT,
-- nothing rewritten. Re-running it is a no-op, and applying it changes no row
-- and no result — only how fast they are found.
--
-- WHY NOW. The fabrication tables carried no @@index at all until 0044 added
-- three, so every fab lookup is a sequential scan. That was survivable while
-- the screens read a whole project once per page load. It stops being
-- survivable here: the over-allocation guard re-reads one requirement's
-- allocations inside a transaction on EVERY assignment, while holding a row
-- lock that another supervisor's tablet is queued behind. A sequential scan of
-- fab_requirement_allocation under that lock is the difference between a board
-- that keeps up with two people and one that does not.
--
-- Each index, and the query that needs it:
--
--   fab_requirement_allocation_requirement_id_idx
--       "everything this piece row is allocated to, across slabs" — the sum the
--       no-over-allocation rule is checked against. Read once per assignment
--       inside the transaction, and once per row when the board loads.
--
--   fab_requirement_allocation_slab_id_idx
--       "the rows on this slab" — the slab cards, and the loss recomputation in
--       /api/fab/approve-slab. Also serves the existing
--       /api/fab/slab-allocation, which reads the same relation per slab.
--
--   fab_requirement_project_id_idx
--       "this project's piece rows" — the read behind both boards, and behind
--       release-project, which pulls every requirement of the project it is
--       releasing.
--
--   fab_slab_project_id_idx
--       "the slabs on this project" — the slab board's other half.
--
--   fab_slab_job_slab_id_status_idx
--       "has this slab already gone to the cutter?" — asked before every single
--       edit on the slab board, and by approve-slab's idempotency check. The
--       status column is in the index because every one of those lookups
--       filters on it (READY / IN_PROGRESS / COMPLETED).
--
-- Postgres does not index a foreign key for you; four of the five are foreign
-- keys that have never had one. The names are Prisma's own defaults for these
-- models, so `prisma migrate diff` stays clean after this is applied (same
-- discipline as scripts/0038 and 0044).

CREATE INDEX IF NOT EXISTS "fab_requirement_allocation_requirement_id_idx"
  ON "fab_requirement_allocation" ("requirement_id");

CREATE INDEX IF NOT EXISTS "fab_requirement_allocation_slab_id_idx"
  ON "fab_requirement_allocation" ("slab_id");

CREATE INDEX IF NOT EXISTS "fab_requirement_project_id_idx"
  ON "fab_requirement" ("project_id");

CREATE INDEX IF NOT EXISTS "fab_slab_project_id_idx"
  ON "fab_slab" ("project_id");

CREATE INDEX IF NOT EXISTS "fab_slab_job_slab_id_status_idx"
  ON "fab_slab_job" ("slab_id", "status");

COMMENT ON COLUMN "fab_slab_job"."used_area_sqft" IS
  'Square feet of this slab consumed by the pieces allocated to it, frozen when the slab was sent to the cutter. Written by /api/fab/approve-slab from computeSlabLoss(); see src/lib/fab/slabLoss.ts.';

COMMENT ON COLUMN "fab_slab_job"."total_wastage_pct" IS
  'Percentage of the slab left over after its allocated pieces, frozen at send-to-cutting. NULL when the slab has no usable dimensions — "we do not know" rather than 0%.';

COMMENT ON COLUMN "fab_slab_job"."true_scrap_pct" IS
  'The part of total_wastage_pct that is genuinely scrapped rather than kept as a reusable remnant. Equal to total_wastage_pct when nothing was reclaimed.';
