-- =====================================================================
-- NEON-01-schema.sql   STRUCTURE CHANGES
--
-- Pacific Surfaces — fabrication + sampling, 2026-08-25.
-- Run this FIRST, then NEON-02-data.sql.
--
-- Paste the whole file into the Neon SQL Editor and run it. No Prisma CLI,
-- no repo checkout, no Node — this is plain SQL against Neon.
--
-- ─────────────────────────────────────────────────────────────────────
-- WHAT IT DOES, AND WHAT IT DOES NOT
--
-- It UPGRADES THE EXISTING DATABASE IN PLACE. There is no dump, no restore
-- and no new database. Every project, slab, QC row and piece already in
-- Neon stays exactly where it is. Every statement is additive:
-- ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE INDEX
-- IF NOT EXISTS, and constraints wrapped in duplicate guards.
--
-- SAFE TO RE-RUN, end to end. Running it twice changes nothing.
--
-- THE ONE THING THAT DELETES ANYTHING is the finish merge in section 13,
-- and it is bounded: it only fires for a colour that holds BOTH spellings
-- of one finish (Leather AND Leathered, or Honed AND Matte). Before the
-- delete it SUMS the losing shelf's quantity into the survivor and
-- re-points its intake and dispatch history. No count is lost — two
-- shelves become the one they always were. On a database where nobody has
-- hand-typed a finish, it finds nothing and deletes nothing.
--
-- ─────────────────────────────────────────────────────────────────────
-- EXISTING ROWS ADAPT THEMSELVES — nothing to migrate by hand:
--
--   fab_project.kind        -> 'PO' for every project you have, which is
--                              what they all are
--   polish_qc.slab_mark     -> 'FULL_SLAB', then BACKFILLED to 'CTS' for
--                              every slab whose quality_grade already
--                              reads CTS (section 12)
--   fab_requirement.colour_finish_id / sampling_size_id
--                           -> NULL on purchase-order rows, correctly:
--                              they are for sample orders only
--
-- ─────────────────────────────────────────────────────────────────────
-- ORDER OF OPERATIONS FOR THE WHOLE PUSH
--
--   1. Take a Neon branch. This is the only real undo — section 13
--      renames stored values and section 12 backfills a column, and
--      neither is recoverable by running something backwards.
--   2. Run THIS file.
--   3. Run the verification queries at the end. Several must return
--      0 rows.
--   4. Run NEON-02-data.sql (the colour catalogue).
--   5. Deploy the application.
--
--   Steps 2-4 BEFORE step 5, not after. Every change here is additive, so
--   the CURRENTLY DEPLOYED code keeps working against the upgraded
--   database — it simply ignores the new columns. The new code against the
--   old database asks for fab_project.kind and fails. So the database goes
--   first and the site never goes down.
--
--   The deployed app regenerates its database client automatically at
--   build time ("prisma generate && next build"), so nobody needs to run
--   that by hand.
-- =====================================================================


-- ###################################################################
-- ## SECTION 1 — 0043-fab-requirement-sink-quantity
-- ###################################################################

-- 0043: fab_requirement.sink_quantity — the supervisor's per-row sink count.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0043-fab-requirement-sink-quantity.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and raw-SQL-only
-- columns that push proposes dropping — see the note at the top of the sales
-- section in schema.prisma and scripts/0040.)
--
-- WHY. The manager's upload used to carry a sink-cut count per drawing row and
-- routing was derived from it. The new intake is a flat Length / Width / Qty /
-- SFT list with no sink information at all, so the sink decision moves to the
-- supervisor, who marks a requirement row and says how many of its pieces get
-- one — 3 of 10 is a normal answer, and the default when he picks a row is the
-- full quantity. fabrication_required still tracks the sink exactly, and
-- polish_required is now true for every piece, so this is the only new fact the
-- database has to hold.
--
-- PURELY ADDITIVE AND IDEMPOTENT. One nullable column, no default, no backfill,
-- no index, nothing dropped, nothing rewritten. Re-running it is a no-op.
-- Applying it changes no existing row and no existing query: every read path
-- today selects named columns or Prisma-generated ones, and code that does not
-- know about sink_quantity behaves exactly as it did.
--
-- NULLABLE, AND NO DEFAULT — on purpose.
--   * NULL means "the supervisor has not looked at this row yet". 0 means "he
--     looked and said no sinks". Those are different facts about a decision a
--     human has to make, and a DEFAULT 0 would assert the second one on behalf
--     of every requirement that already exists, including several thousand rows
--     whose sinks were driven by the old sink_cuts column.
--   * They route identically: resolveSinkQuantity() in
--     src/lib/fab/requirement-derive.ts folds NULL and 0 to the same 0, so the
--     distinction costs nothing at read time and is there when a UI wants to
--     badge the un-reviewed rows.
--   * A nullable column with no default is also the cheapest DDL Postgres has —
--     a catalogue entry, no table rewrite, no lock held while 10k rows are
--     touched.
--
-- The value is a count of PIECES, so 0 <= sink_quantity <= quantity. That is not
-- enforced by a CHECK: quantity is editable, and a constraint that can be
-- violated by a legitimate edit elsewhere turns a routine quantity change into a
-- failed transaction. The application clamps instead (resolveSinkQuantity), so a
-- stale over-large value degrades to "all pieces", which is the safe reading.

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "sink_quantity" INTEGER;

COMMENT ON COLUMN "fab_requirement"."sink_quantity" IS
  'How many of this requirement''s pieces get a sink (supervisor-set). NULL = not yet reviewed, 0 = none, = quantity means all. fabrication_required follows the sink; polish applies to every piece.';

-- ###################################################################
-- ## SECTION 2 — 0044-fab-po
-- ###################################################################

-- 0044: fab_po — the purchase order that sits between a project and its
--       requirements, and fab_requirement.po_id pointing at it.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0044-fab-po.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and
-- raw-SQL-only columns that push proposes dropping — see the note at the top of
-- the sales section in schema.prisma and scripts/0040/0043.)
--
-- WHY. The manager's surface is three steps: create a project by hand, create a
-- PO under it, upload that PO's PDF. A project holds SEVERAL purchase orders
-- (one customer, several orders), and the piece rows of each PO's PDF become
-- fab_requirement rows. Without this table those rows hang off the project with
-- no record of which document they came from, so a second PO's 780 pieces are
-- indistinguishable from the first's and neither can be re-checked against its
-- own totals row.
--
-- PURELY ADDITIVE AND IDEMPOTENT. One new table, one new nullable column, three
-- indexes and two foreign keys, all guarded. No backfill, no UPDATE, no DROP,
-- no DEFAULT applied to an existing column, nothing rewritten. Re-running it is
-- a no-op. Applying it changes no existing row and no existing query: every
-- read path selects named columns or Prisma-generated ones, and code that does
-- not know about fab_po behaves exactly as it did.
--
-- po_number IS UNIQUE WITHIN A PROJECT, NOT GLOBALLY. Two projects may
-- legitimately quote the same external PO number — the number belongs to the
-- customer's system, not ours, and two customers number from 1. A global unique
-- would reject the second one with a constraint error the manager cannot act
-- on. The composite unique is also the index for "this project's PO 10026".
--
-- po_id IS NULLABLE, and there is no backfill. Every requirement that exists
-- today came from the Excel intake and belongs to no purchase order; that is
-- the truth about them, and inventing a PO to point at would be worse than a
-- NULL. ON DELETE SET NULL matches Prisma's default for an optional relation:
-- deleting a PO must not take its requirements' history with it.
--
-- INDEXES, and why each one. The fabrication tables carry no @@index at all
-- today while the rest of the schema carries 59 — every fab lookup is a
-- sequential scan. These three are the ones this feature's own queries need:
--   * fab_po_project_id_po_number_key   — enforces the per-project uniqueness
--                                         AND serves "find PO n of project p";
--                                         its project_id prefix serves the FK.
--   * fab_po_project_id_created_at_idx  — the PO list on the project screen,
--                                         WHERE project_id = ? ORDER BY created_at DESC.
--   * fab_requirement_po_id_idx         — every read of one PO's piece rows.
--                                         Postgres does not index a foreign key
--                                         for you; without this, opening one PO
--                                         scans every requirement in the system.
-- The names are Prisma's own defaults for these models, so `prisma migrate
-- diff` stays clean after this is applied (same discipline as scripts/0038).

CREATE TABLE IF NOT EXISTS "fab_po" (
  "id"              TEXT         NOT NULL,
  "project_id"      TEXT         NOT NULL,
  "po_number"       TEXT         NOT NULL,
  "pdf_file_name"   TEXT,
  "pdf_imported_at" TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fab_po_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fab_po_project_id_po_number_key"
  ON "fab_po" ("project_id", "po_number");

CREATE INDEX IF NOT EXISTS "fab_po_project_id_created_at_idx"
  ON "fab_po" ("project_id", "created_at");

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "po_id" TEXT;

CREATE INDEX IF NOT EXISTS "fab_requirement_po_id_idx"
  ON "fab_requirement" ("po_id");

-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so both foreign keys are
-- guarded by name. Referential actions are Prisma's defaults for the relation's
-- optionality — RESTRICT for the required project link (a project with POs must
-- not vanish under them), SET NULL for the optional requirement link.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_po_project_id_fkey'
  ) THEN
    ALTER TABLE "fab_po"
      ADD CONSTRAINT "fab_po_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "fab_project" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_po_id_fkey'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_po_id_fkey"
      FOREIGN KEY ("po_id") REFERENCES "fab_po" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMENT ON TABLE "fab_po" IS
  'A customer purchase order under a fab_project. po_number is the customer''s own number and is unique within the project only. pdf_file_name/pdf_imported_at record the PO PDF whose piece table produced this PO''s fab_requirement rows.';

COMMENT ON COLUMN "fab_requirement"."po_id" IS
  'The purchase order this requirement came off, when it came from a PO PDF. NULL for every row created by the older Excel intake.';

-- ###################################################################
-- ## SECTION 3 — 0045-fab-board-indexes
-- ###################################################################

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

-- ###################################################################
-- ## SECTION 4 — 0046-fab-stage-series-indexes
-- ###################################################################

-- 0046: two indexes for the CEO dashboard's date-wise, stage-wise breakdown.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0046-fab-stage-series-indexes.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and
-- raw-SQL-only columns that push proposes dropping -- see the note at the top
-- of the sales section in schema.prisma and scripts/0040/0043/0044/0045.)
--
-- NO NEW TABLES, NO NEW COLUMNS, NO BACKFILL. Everything the new panel reads
-- already exists and is already written: fab_piece_operation.completed_at is
-- set by every queue's complete route, and fab_slab_job.end_time by the CLO
-- round-trip. This script is two indexes and nothing else.
--
-- PURELY ADDITIVE AND IDEMPOTENT. No UPDATE, no DROP, no DEFAULT, nothing
-- rewritten. Re-running it is a no-op, and applying it changes no row and no
-- result -- only how fast they are found.
--
-- WHY NOW. The dashboard grew a per-day series: five stage counts for every
-- calendar day in a range of up to 92, refreshed every 30 seconds by an open
-- browser tab. Both queries behind it are GROUP BYs over a date window, and
-- neither window was indexable.
--
-- Each index, and the query that needs it:
--
--   fab_piece_operation_is_completed_completed_at_idx
--       "what was finished between these two dates?" -- the range GROUP BY
--       behind the new breakdown. fab_piece_operation had NO index of any kind
--       before this line, not even on its foreign keys, so every one of these
--       was a sequential scan of the whole table. Two more long-standing reads
--       land on the same index for free: the single-day pieceOpsDay fetch that
--       feeds the existing "Today's throughput" strip and the leaderboard
--       (same predicate, one day wide), and the 30-minute idle-detection
--       window, which runs on every dashboard load. is_completed leads because
--       every one of those callers pins it to TRUE, which makes the composite
--       a near-perfect match; completed_at follows because it is the range.
--
--   fab_slab_job_status_end_time_idx
--       "which slabs were cut between these two dates?" -- the CLO half of the
--       cutting number. Cutting has two sources and this is the one that does
--       not produce a piece-operation row, so it cannot be dropped without
--       under-reporting every slab cut through the CLO. 0045 already indexed
--       this table as (slab_id, status), which a scan by status and time
--       cannot use: a composite btree is only useful from its leading column,
--       and these queries do not know the slab.
--
-- The join side of the second query, fab_requirement_allocation (slab_id), was
-- already indexed by scripts/0045 -- nothing further is needed for it.
--
-- The names are Prisma's own defaults for the matching @@index lines added to
-- prisma/schema.prisma alongside this file, so `prisma migrate diff` stays
-- clean after it is applied (same discipline as scripts/0038, 0044 and 0045).
--
-- Sizing: both tables are small-to-mid, so plain CREATE INDEX (no
-- CONCURRENTLY -- db execute runs in a transaction) is fine; each build takes
-- a brief write lock and well under a second.

CREATE INDEX IF NOT EXISTS "fab_piece_operation_is_completed_completed_at_idx"
  ON "fab_piece_operation" ("is_completed", "completed_at");

CREATE INDEX IF NOT EXISTS "fab_slab_job_status_end_time_idx"
  ON "fab_slab_job" ("status", "end_time");

-- ###################################################################
-- ## SECTION 5 — 0047-fab-worker-session
-- ###################################################################

-- 0047: floor roster (fab_worker) and who-did-this columns on sessions,
--       operations, and slab jobs.
--
-- PURELY ADDITIVE AND IDEMPOTENT. The operator login is shared; a process
-- session now names the person standing at that station.

CREATE TABLE IF NOT EXISTS fab_worker (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_id TEXT
);

CREATE INDEX IF NOT EXISTS fab_worker_active_idx ON fab_worker (active);

ALTER TABLE fab_machine_session
  ADD COLUMN IF NOT EXISTS worker_id TEXT;

ALTER TABLE fab_operation
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS shift TEXT;

ALTER TABLE fab_slab_job
  ADD COLUMN IF NOT EXISTS worker_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_machine_session_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_machine_session
      ADD CONSTRAINT fab_machine_session_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_operation_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_operation
      ADD CONSTRAINT fab_operation_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_slab_job_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_slab_job
      ADD CONSTRAINT fab_slab_job_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_worker_created_by_id_fkey'
  ) THEN
    ALTER TABLE fab_worker
      ADD CONSTRAINT fab_worker_created_by_id_fkey
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fab_machine_session_machine_id_is_active_idx
  ON fab_machine_session (machine_id, is_active);

-- ###################################################################
-- ## SECTION 6 — 0048-fab-reject-downtime
-- ###################################################################

-- 0048: piece rejection (status + reason) and machine downtime log.
-- PURELY ADDITIVE AND IDEMPOTENT.

ALTER TYPE "FabPieceStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE fab_piece
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS reject_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by_worker_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_rejected_by_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_piece
      ADD CONSTRAINT fab_piece_rejected_by_worker_id_fkey
      FOREIGN KEY (rejected_by_worker_id) REFERENCES fab_worker(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fab_machine_downtime (
  id            TEXT PRIMARY KEY,
  machine_id    TEXT NOT NULL,
  process_type  TEXT NOT NULL,
  reason        TEXT NOT NULL,
  notes         TEXT,
  started_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at      TIMESTAMP(3),
  worker_id     TEXT,
  shift         TEXT,
  session_id    TEXT,
  user_id       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS fab_machine_downtime_machine_ended_idx
  ON fab_machine_downtime (machine_id, ended_at);
CREATE INDEX IF NOT EXISTS fab_machine_downtime_process_ended_idx
  ON fab_machine_downtime (process_type, ended_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_machine_downtime_machine_id_fkey'
  ) THEN
    ALTER TABLE fab_machine_downtime
      ADD CONSTRAINT fab_machine_downtime_machine_id_fkey
      FOREIGN KEY (machine_id) REFERENCES fab_machine(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_machine_downtime_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_machine_downtime
      ADD CONSTRAINT fab_machine_downtime_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ###################################################################
-- ## SECTION 7 — 0051-sampling-and-catalogue
-- ###################################################################

-- 0051: the Sampling module — sample pieces cut from slabs, stored, packed and
--       shipped — plus the shared product catalogue it counts stock against,
--       and the SAMPLING value on the Role enum.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0051-sampling-and-catalogue.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and
-- raw-SQL-only columns that push proposes dropping — see the note at the top of
-- the sales section in schema.prisma and scripts/0039 onwards.)
--
-- PURELY ADDITIVE AND IDEMPOTENT. Eight new tables, three new enum types, one
-- new value on an existing enum, sixteen indexes and nine foreign keys — all
-- guarded. NO backfill, no UPDATE, no DROP, no DEFAULT applied to an existing
-- column, nothing rewritten, and not one statement that names an existing
-- table. Re-running it is a no-op. Applying it changes no existing row and no
-- existing query.
--
-- THE ROLE VALUE IS THE ONLY THING THIS SHARES WITH ANYTHING, and it is a ROLE,
-- not a Branch. Sampling was designed as a DEPARTMENT — Branch SAMPLING with
-- the shared OPERATOR / INCHARGE / LINE_MANAGER ranks, so that "Sampling
-- Incharge" would be SAMPLING + INCHARGE — back when Chromia was one too.
-- Chromia has since been RETIRED as a department: scripts/0044 dropped the
-- old integration, scripts/0045 added 'CHROMIA' to the Role enum, and
-- scripts/0046 moved the last logins off Branch CHROMIA onto that role. The
-- surviving shape for a single-purpose module is a capped ROLE, so this adds
-- 'SAMPLING' to "Role" and NOTHING to "Branch". scripts/0045 is the precedent
-- for this exact statement; scripts/0023 is the precedent for the ADD VALUE
-- form itself.
--
-- NOTE ON THE ENUM AND TRANSACTIONS: PostgreSQL runs a multi-statement script
-- as one implicit transaction (prisma db execute sends the whole file as a
-- single command), and a NEW ENUM VALUE CANNOT BE USED IN THE TRANSACTION THAT
-- ADDS IT. Nothing below references 'SAMPLING' — and nothing appended to this
-- file may either. There is no backfill here and none is wanted: the value is
-- only ever written to users.role by Users & Roles, afterwards. (Chromia needed
-- a second script, 0046, for exactly this reason; sampling does not, because it
-- is a new module with no logins to move.)
--
-- THREE TABLES ARE NOT sampling_-PREFIXED, ON PURPOSE. product_series,
-- product_colour and product_colour_finish are the colour chart, and the chart
-- is not sampling's property: fabrication already buys against these names
-- ("Arva White" is the material on PO 10026) and the polishing line calls the
-- same string a "design" (polish_qc.design). Naming them sampling_* would have
-- meant a second copy the first time fabrication wanted one.
-- product_colour.name is UNIQUE ACROSS ALL SERIES so those callers can resolve
-- a colour by name without knowing its series.
--
-- FINISH IS A VARIANT OF A COLOUR, NOT A COLOUR. Cappuccino comes in Polished
-- and Leather: one product_colour row, two product_colour_finish rows. Stock,
-- intake and dispatch lines all reference the colour+finish row, never the
-- colour, because a count that does not know the finish is not a count. The
-- finish itself is TEXT rather than an enum so adding one is a seed edit
-- instead of a migration; the canonical spellings live in
-- src/lib/catalogue/colours.ts.
--
-- UNITS. sampling_size.length_in and .width_in are INCHES; .thickness_mm is
-- whole MILLIMETRES. The column names carry the unit because
-- src/lib/fab/slabLoss.ts is this repo's standing warning about what happens
-- when they do not — fab_requirement is inches, fab_slab is millimetres, and
-- nothing in the schema said so. Inches match fab_requirement and
-- fab_residual_piece (an offcut becomes sample stock with no conversion);
-- millimetres match fab_slab.thickness and
-- chromia_base_material.default_thickness_mm.
--
-- NUMERIC(10,2), NOT double precision, for the two edges: the unique index on
-- (length_in, width_in, thickness_mm) IS the "a size typed twice is the same
-- size" rule, and NUMERIC makes 4, 4.0 and 4.00 the same value in that index.
-- The canonical ordering (length >= width, so 4x6 and 6x4 are one size) is
-- enforced in src/lib/sampling/size.ts and NOT by a CHECK constraint: Prisma
-- cannot model a CHECK, so one here would show up forever as drift to be
-- dropped.
--
-- NO FOREIGN KEY TO fab_residual_piece. The offcut side has purpose-built
-- models (fab_residual_bag / fab_residual_piece) and NOTHING writes them —
-- they are dead, so a hard link would make sampling intake wait on a
-- fabrication feature with no owner, and they cannot carry what a sample needs
-- anyway (a residual piece has length and width but no thickness and no
-- colour). sampling_intake.source_ref is the seam: the slab or bag number as
-- written on the piece, to match on later.
--
-- USER ATTRIBUTION columns (created_by_id, released_by_id, dispatched_by_id,
-- delivered_by_id) are plain TEXT holding users.id with NO foreign key — the
-- Sales and Chromia precedent. sampling_intake.created_by_id in particular is
-- not always sampling staff: a Fabrication Supervisor may add stock, and only
-- add stock (src/lib/sampling/actions.ts).
--
-- INDEXES. Sixteen, and every one of them names the query it serves in the
-- comment above it. The fabrication tables carried no index at all until
-- scripts/0044-0046 — every fab lookup was a sequential scan — and these
-- tables are not going to repeat that. The names are Prisma's own defaults for
-- the @@unique / @@index lines added to prisma/schema.prisma alongside this
-- file, so `prisma migrate diff` stays clean after it is applied (the same
-- discipline as scripts/0038, 0044, 0045 and 0046).
--
-- SIZING: every table here starts empty, so plain CREATE INDEX (no
-- CONCURRENTLY — db execute runs in a transaction) is instant.

-- The capped login the module is gated by, exactly like ROBO and CHROMIA.
-- Nothing below uses it; see the transaction note above.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SAMPLING';

-- ---------------------------------------------------------------- enums ----

DO $$ BEGIN
  CREATE TYPE "sampling_intake_source" AS ENUM ('SAMPLE_CUTTING', 'FAB_OFFCUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "sampling_destination" AS ENUM ('DOMESTIC', 'INTERNATIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RELEASED / DISPATCHED / DELIVERED only. "In stock" is deliberately not a
-- status: it is where a piece is BEFORE any dispatch claims it, which is a
-- sampling_stock quantity. Creating the dispatch is the first transition.
DO $$ BEGIN
  CREATE TYPE "sampling_dispatch_status" AS ENUM ('RELEASED', 'DISPATCHED', 'DELIVERED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------- product catalogue ----

CREATE TABLE IF NOT EXISTS "product_series" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_colour" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_colour_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_colour_finish" (
    "id" TEXT NOT NULL,
    "colour_id" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_colour_finish_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------ sampling ----

CREATE TABLE IF NOT EXISTS "sampling_size" (
    "id" TEXT NOT NULL,
    "length_in" DECIMAL(10,2) NOT NULL,
    "width_in" DECIMAL(10,2) NOT NULL,
    "thickness_mm" INTEGER NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sampling_size_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_stock" (
    "id" TEXT NOT NULL,
    "colour_finish_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sampling_stock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_intake" (
    "id" TEXT NOT NULL,
    "colour_finish_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" "sampling_intake_source" NOT NULL,
    "source_ref" TEXT,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sampling_intake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_dispatch" (
    "id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "destination" "sampling_destination" NOT NULL,
    "reference" TEXT,
    "status" "sampling_dispatch_status" NOT NULL DEFAULT 'RELEASED',
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "dispatched_by_id" TEXT,
    "delivered_at" TIMESTAMP(3),
    "delivered_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sampling_dispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_dispatch_line" (
    "id" TEXT NOT NULL,
    "dispatch_id" TEXT NOT NULL,
    "colour_finish_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sampling_dispatch_line_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------- indexes ----

-- The series pick-list, and the seed's upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS "product_series_name_key"
  ON "product_series" ("name");

-- Unique ACROSS SERIES, not within one: fabrication and QC name a colour
-- without naming its series, and a duplicate would make that lookup ambiguous.
-- Also the seed's upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS "product_colour_name_key"
  ON "product_colour" ("name");

-- "The colours of this series" — step 2 of adding stock, and the foreign key,
-- which Postgres does not index for you.
CREATE INDEX IF NOT EXISTS "product_colour_series_id_idx"
  ON "product_colour" ("series_id");

-- One row per colour+finish. Its colour_id prefix is also "the finishes of
-- this colour" (step 3) and the foreign key's index.
CREATE UNIQUE INDEX IF NOT EXISTS "product_colour_finish_colour_id_finish_key"
  ON "product_colour_finish" ("colour_id", "finish");

-- THE RULE THAT KEEPS THE PICK-LIST HONEST: one row per distinct size. A size
-- typed a second time has to land on the row it already has, or the stock
-- splits into two half-counts nobody reconciles.
CREATE UNIQUE INDEX IF NOT EXISTS "sampling_size_length_in_width_in_thickness_mm_key"
  ON "sampling_size" ("length_in", "width_in", "thickness_mm");

-- The point lookup every intake and every release performs, and the index for
-- "every size of this colour+finish" — one row of the inventory screen.
CREATE UNIQUE INDEX IF NOT EXISTS "sampling_stock_colour_finish_id_size_id_key"
  ON "sampling_stock" ("colour_finish_id", "size_id");

-- The other direction: "who has 4x4 in 2 cm, across every colour" — what a
-- customer asking for a size rather than a colour needs. Also the size_id
-- foreign key.
CREATE INDEX IF NOT EXISTS "sampling_stock_size_id_idx"
  ON "sampling_stock" ("size_id");

-- "What came in recently", newest first.
CREATE INDEX IF NOT EXISTS "sampling_intake_created_at_idx"
  ON "sampling_intake" ("created_at");

-- "How did this stock row reach that number" — the audit when a count looks
-- wrong. Also the colour_finish_id foreign key.
CREATE INDEX IF NOT EXISTS "sampling_intake_colour_finish_id_size_id_idx"
  ON "sampling_intake" ("colour_finish_id", "size_id");

-- "How much of this month's stock is offcut rather than cut-to-sample" — the
-- question the source column exists to answer.
CREATE INDEX IF NOT EXISTS "sampling_intake_source_created_at_idx"
  ON "sampling_intake" ("source", "created_at");

-- The dispatch board: "packed but not gone", "gone but not confirmed".
CREATE INDEX IF NOT EXISTS "sampling_dispatch_status_created_at_idx"
  ON "sampling_dispatch" ("status", "created_at");

-- "What have we sent this customer before". The name is free text, so this
-- serves the exact and prefix match a lookup starts from.
CREATE INDEX IF NOT EXISTS "sampling_dispatch_customer_name_idx"
  ON "sampling_dispatch" ("customer_name");

-- One line per item on a package — the same item added twice is a quantity
-- change, not a second line. The dispatch_id prefix is also "the lines of this
-- package", which every read of a dispatch performs, and the foreign key.
--
-- THE ONE HAND-PICKED NAME IN THIS FILE. Prisma's default would be
-- sampling_dispatch_line_dispatch_id_colour_finish_id_size_id_key: exactly 63
-- characters, which is Postgres's identifier limit to the character. It fits,
-- but a single letter added to any of those column names would truncate
-- Prisma's name and not this one. The schema carries the matching
-- `map: "sampling_dispatch_line_item_key"`.
CREATE UNIQUE INDEX IF NOT EXISTS "sampling_dispatch_line_item_key"
  ON "sampling_dispatch_line" ("dispatch_id", "colour_finish_id", "size_id");

-- "Where did our 4x4 Cappuccino go" — the reverse lookup from a stock row.
CREATE INDEX IF NOT EXISTS "sampling_dispatch_line_colour_finish_id_size_id_idx"
  ON "sampling_dispatch_line" ("colour_finish_id", "size_id");

-- The size_id foreign key on the two line-level tables. Neither is covered by
-- an index above (both composites lead with colour_finish_id), and an
-- unindexed FK turns a size lookup into a sequential scan.
CREATE INDEX IF NOT EXISTS "sampling_intake_size_id_idx"
  ON "sampling_intake" ("size_id");

CREATE INDEX IF NOT EXISTS "sampling_dispatch_line_size_id_idx"
  ON "sampling_dispatch_line" ("size_id");

-- -------------------------------------------------------- foreign keys ----
-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so each one is wrapped in a
-- duplicate_object guard (the scripts/0039 form). Referential actions are
-- Prisma's defaults for each relation's optionality: RESTRICT for the required
-- links (a colour with stock against it must not vanish under it), CASCADE
-- from a dispatch to its own lines, which have no meaning without it.

DO $$ BEGIN
  ALTER TABLE "product_colour" ADD CONSTRAINT "product_colour_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "product_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_colour_finish" ADD CONSTRAINT "product_colour_finish_colour_id_fkey" FOREIGN KEY ("colour_id") REFERENCES "product_colour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_stock" ADD CONSTRAINT "sampling_stock_colour_finish_id_fkey" FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_stock" ADD CONSTRAINT "sampling_stock_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sampling_size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_intake" ADD CONSTRAINT "sampling_intake_colour_finish_id_fkey" FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_intake" ADD CONSTRAINT "sampling_intake_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sampling_size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_dispatch_line" ADD CONSTRAINT "sampling_dispatch_line_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "sampling_dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_dispatch_line" ADD CONSTRAINT "sampling_dispatch_line_colour_finish_id_fkey" FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_dispatch_line" ADD CONSTRAINT "sampling_dispatch_line_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sampling_size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------ comments ----

COMMENT ON TABLE "product_colour" IS
  'One colour in one series. NOT sampling-only: fabrication buys against these names (PO 10026 is Arva White) and polish_qc calls the same string a design, so name is unique across every series and callers resolve a colour without knowing its series. "Cappuccino (Leather)" is NOT a row here — it is the Leather finish of Cappuccino. "Cappuccino Dark" IS.';

COMMENT ON TABLE "product_colour_finish" IS
  'A colour in one finish (Polished / Leather / Suede / Honed) — the row sample stock is actually counted against, because a count that does not know the finish is not a count. TEXT rather than an enum so adding a finish needs no migration; canonical spellings in src/lib/catalogue/colours.ts.';

COMMENT ON TABLE "sampling_size" IS
  'A sample size, created the first time it is typed and reused from then on — there are no standard sizes and nobody curates this list. length_in/width_in are INCHES, thickness_mm is whole MILLIMETRES. length_in is the LONGER edge: 4x6 and 6x4 are one size, because a sample piece has no orientation. Normalisation and the ordering rule live in src/lib/sampling/size.ts.';

COMMENT ON COLUMN "sampling_intake"."source_ref" IS
  'Free text: the slab or bag number the pieces came off. The seam to fab_residual_bag / fab_residual_piece, which are deliberately NOT linked by a foreign key — nothing writes them, and a residual piece carries neither thickness nor colour.';

COMMENT ON TABLE "sampling_dispatch" IS
  'One package to one customer. Free-form by decision: customer name, domestic/international and an optional reference, with no link to the Sales module. status is RELEASED -> DISPATCHED -> DELIVERED, one step forward only, each stamped with its own time and user; "in stock" is the absence of a dispatch, not a status. Rules in src/lib/sampling/lifecycle.ts.';

-- ###################################################################
-- ## SECTION 8 — 0052-user-alt-role-context
-- ###################################################################

-- 0052-user-alt-role-context.sql
--
-- THE SECOND GRANTED JOB. One person is both Line Manager on the production
-- line and Fabrication Supervisor. That was two email accounts and two logins;
-- it is now one login holding two granted role+branch pairs, with a cookie
-- selecting which is live. See src/lib/roleContext.ts for the safety property.
--
-- NOT IN THE PRISMA MODEL, on purpose — the same convention scripts/0019 and
-- 0024 established for sales_role and amount_received. src/lib/users.ts reads
-- and writes these two columns with raw SQL only, and its reader swallows the
-- "column does not exist" error so a deploy that runs BEFORE this script simply
-- sees nobody holding a second job, rather than throwing P2022 on every screen
-- that lists a user.
--
-- Both columns are nullable with no default, and both move together: a role
-- without a branch is not a job, and lib/roleContext.ts treats a half-filled
-- grant as no grant at all. Granting nothing is the state of every existing
-- row, which is why there is no backfill here.
--
-- Additive only. No DROP, no UPDATE, no DELETE. Safe to re-run.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "alt_role"   "Role",
  ADD COLUMN IF NOT EXISTS "alt_branch" "Branch";

COMMENT ON COLUMN "users"."alt_role" IS
  'The role of a second job this login may switch into (NULL for almost everybody). Granted only by an admin; a cookie selects between this pair and the primary but can never widen either. Read/written by raw SQL in src/lib/users.ts, deliberately absent from the Prisma model.';

COMMENT ON COLUMN "users"."alt_branch" IS
  'The department of the second job. Meaningless without alt_role and cleared with it: src/lib/roleContext.ts treats a half-filled grant as no grant.';

-- ###################################################################
-- ## SECTION 9 — 0053-sampling-source-qc
-- ###################################################################

-- =====================================================================
-- 0053-sampling-source-qc.sql
--
-- Link a sample intake back to the QC slab it was cut from.
--
-- WHY
-- ---
-- sampling_intake.source_ref already carries the slab NUMBER as text, and
-- fab_slab.slab_code is already that number: slab-assignment writes
-- `slabCode: String(qc.slabNumber)` when a supervisor puts a QC slab on the
-- board. Text is what a person reads and argues about. It is not a link —
-- polish_qc is re-imported from the polishing line, and a number can be
-- re-typed — so "which QC slab" and "what did the supervisor call it" are
-- two different questions. source_ref answers the second; this column
-- answers the first, and is what "show me every sample cut off this slab"
-- joins on.
--
-- NO FOREIGN KEY TO polish_qc, deliberately, and for the same reason the
-- module's other cross-boundary references carry none (see the note on
-- SamplingIntake.createdById and the Sales/Chromia precedent): polish_qc
-- rows are re-imported wholesale from the line. A constraint here would
-- make a routine QC re-import fail on sampling history that must not be
-- deleted. The column is a reference, and a dangling one is still a better
-- record than none.
--
-- NULLABLE, and that is not laziness. The sampling desk adds stock that
-- never came off a slab; those rows have no QC record to point at. What is
-- refused is a FABRICATION intake with no readable slab number at all, and
-- that refusal lives in the route (requireSlabSource in
-- lib/sampling/fabIntake.ts) rather than in a CHECK, because the rule is
-- "one of two references must exist" and it applies to two of the three
-- ways a row can be created.
--
-- IDEMPOTENT. Safe to re-run. Apply AFTER 0051 (which creates the table).
--
-- HOW TO RUN
--     psql "$DATABASE_URL" -f scripts/0053-sampling-source-qc.sql
-- or paste into the Neon SQL editor.
-- =====================================================================

BEGIN;

-- 1. The columns.
ALTER TABLE "sampling_intake"
  ADD COLUMN IF NOT EXISTS "source_qc_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "source_slab_id" TEXT;

COMMENT ON COLUMN "sampling_intake"."source_slab_id" IS
  'fab_slab.id of the slab card these pieces came off. source_qc_id answers '
  '"which stone"; this answers "which slab card", and fabrication accounting '
  'is per fab_slab. Summed into computeSlabLoss.sampledAreaSqft so sampled '
  'stone stops being reported as scrap and stops leaving PO capacity '
  'unchanged. No FK: deleting fab test data must not reason about sampling.';

COMMENT ON COLUMN "sampling_intake"."source_qc_id" IS
  'polish_qc.id of the slab these pieces were cut from. No FK on purpose: '
  'polish_qc is re-imported from the polishing line and a constraint would '
  'make a re-import fail on sampling history. source_ref carries the same '
  'slab as human-readable text.';

-- 2. The index that makes the traceability question cheap in the direction
--    it is actually asked: from a slab, to everything taken off it.
CREATE INDEX IF NOT EXISTS "sampling_intake_source_qc_id_idx"
  ON "sampling_intake" ("source_qc_id");

-- 3. The hotter of the two: read on every send-to-cutter and every board load,
--    because the slab's remaining PO capacity now depends on it.
CREATE INDEX IF NOT EXISTS "sampling_intake_source_slab_id_idx"
  ON "sampling_intake" ("source_slab_id");

COMMIT;


-- =====================================================================
-- BACKFILL (optional, run once, read the note first)
--
-- Existing rows have source_ref but no source_qc_id. Where the text in
-- source_ref is exactly one polish_qc slab number, the link can be
-- recovered. Where it matches several — the same slab number can appear
-- more than once across re-imports — it is LEFT NULL rather than guessed,
-- because a wrong link is worse than a missing one.
--
-- Run the SELECT first and read the counts. Only then run the UPDATE.
-- =====================================================================

-- What the backfill would do, before it does it:
-- SELECT
--   count(*) FILTER (WHERE m.qc_id IS NOT NULL)                        AS will_link,
--   count(*) FILTER (WHERE m.qc_id IS NULL AND i.source_ref IS NOT NULL) AS ambiguous_or_unknown,
--   count(*) FILTER (WHERE i.source_ref IS NULL)                       AS no_reference_at_all
-- FROM sampling_intake i
-- LEFT JOIN LATERAL (
--   SELECT CASE WHEN count(*) = 1 THEN min(q.id) END AS qc_id
--   FROM polish_qc q
--   WHERE q.slab_number::text = btrim(i.source_ref)
-- ) m ON true
-- WHERE i.source_qc_id IS NULL;

-- The backfill itself:
-- UPDATE sampling_intake i
-- SET    source_qc_id = m.qc_id
-- FROM LATERAL (
--   SELECT CASE WHEN count(*) = 1 THEN min(q.id) END AS qc_id
--   FROM polish_qc q
--   WHERE q.slab_number::text = btrim(i.source_ref)
-- ) m
-- WHERE i.source_qc_id IS NULL
--   AND i.source_ref IS NOT NULL
--   AND m.qc_id IS NOT NULL;


-- =====================================================================
-- AFTERWARDS — the question this was all for:
--
--   SELECT q.slab_number, q.design, ps.name AS series,
--          pc.name AS colour, pcf.finish,
--          s.length_in, s.width_in, s.thickness_mm,
--          i.quantity, i.source, i.created_at
--   FROM sampling_intake i
--   JOIN polish_qc q              ON q.id  = i.source_qc_id
--   JOIN sampling_size s          ON s.id  = i.size_id
--   JOIN product_colour_finish pcf ON pcf.id = i.colour_finish_id
--   JOIN product_colour pc        ON pc.id = pcf.colour_id
--   JOIN product_series ps        ON ps.id = pc.series_id
--   WHERE q.slab_number = 154700
--   ORDER BY i.created_at;
-- =====================================================================

-- ###################################################################
-- ## SECTION 10 — 0054-fab-requirement-row-letter
-- ###################################################################

-- =====================================================================
-- 0054-fab-requirement-row-letter.sql
--
-- ONE CONSISTENT PIECE NAME:  {projectCode}-{LETTER}-{n}
--
--     PRJ1-A-1    first piece of the first ordered row
--     PRJ1-A-12   twelfth piece of that same row
--     PRJ1-B-1    first piece of the second row
--
-- A letter per ORDERED ROW, a number per PIECE, so a cutter reading a piece
-- of stone knows which row it belongs to without a lookup.
--
-- WHAT THIS REPLACES. Three formats were live at once:
--     PRJ1-0007              approve-slab / release-project (one sequence
--                            across a whole project, said nothing about the row)
--     PRJ1-2B-003-9f1c       the retired cutting-queue auto-create branch
--     "Row 3"                fab_requirement.piece_label, from the PO importer
-- The first two are retired in code (lib/fab/releasePlan.ts). The third stays
-- in piece_label as provenance — which row of which PDF this came from — and
-- the LETTER becomes what the floor sees.
--
-- WHY THE LETTER IS STORED AND NOT DERIVED. Deriving it from row order would
-- re-letter every existing piece the moment a second PO joined the project or
-- a row was deleted. Stone that has already been cut and stickered cannot be
-- migrated.
--
-- PAST Z it continues bijectively: A…Z, AA, AB…  The Kerasom sheet is 28 rows
-- and PO 10026 is 23, so 26 letters was never enough.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0044-fab-po.sql.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0054-fab-requirement-row-letter.sql
-- =====================================================================

BEGIN;

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "row_letter" TEXT;

COMMENT ON COLUMN "fab_requirement"."row_letter" IS
  'Letter in the piece code {projectCode}-{LETTER}-{n}. Assigned once at '
  'import, never recomputed: re-lettering would rename pieces already cut. '
  'Unique per project. Bijective base-26 past Z (A..Z, AA, AB, ...).';

-- One letter per row within a project. A partial index so the rows that
-- predate this script (row_letter IS NULL) do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "fab_requirement_project_row_letter_key"
  ON "fab_requirement" ("project_id", "row_letter")
  WHERE "row_letter" IS NOT NULL;

COMMIT;


-- =====================================================================
-- BACKFILL — give every existing row a letter, in creation order.
--
-- SAFE ONLY WHILE A PROJECT HAS NO PIECES CUT UNDER THE NEW FORMAT. Rows
-- are lettered by created_at, which is the order they were imported, so a
-- project whose pieces are all still {projectCode}-{NNNN} simply starts
-- using letters from its next send. A project already carrying
-- {projectCode}-{LETTER}-{n} codes must NOT be re-lettered — check first.
--
-- 1. Look before you write: which projects already use the new format?
-- =====================================================================

-- SELECT p.project_code, count(*) AS new_format_pieces
-- FROM   fab_piece pc
-- JOIN   fab_project p ON p.id = pc.project_id
-- WHERE  pc.piece_code ~ '^.+-[A-Z]+-[0-9]+$'
-- GROUP  BY p.project_code;

-- 2. The backfill itself. Only touches rows with no letter, and skips any
--    project that already has new-format pieces.
-- =====================================================================

-- WITH numbered AS (
--   SELECT r.id,
--          row_number() OVER (PARTITION BY r.project_id
--                             ORDER BY r.created_at, r.id) - 1 AS idx
--   FROM   fab_requirement r
--   WHERE  r.row_letter IS NULL
--     AND  r.project_id NOT IN (
--            SELECT DISTINCT pc.project_id FROM fab_piece pc
--            WHERE pc.piece_code ~ '^.+-[A-Z]+-[0-9]+$')
-- )
-- UPDATE fab_requirement r
-- SET    row_letter = (
--          -- bijective base-26: 0->A, 25->Z, 26->AA
--          WITH RECURSIVE b(rem, acc) AS (
--            SELECT n.idx, ''::text
--            UNION ALL
--            SELECT (rem / 26) - 1, chr(65 + (rem % 26)) || acc FROM b WHERE rem >= 0
--          )
--          SELECT acc FROM b WHERE rem < 0 LIMIT 1
--        )
-- FROM   numbered n
-- WHERE  r.id = n.id;

-- 3. Check: no project may have two rows sharing a letter.
-- SELECT project_id, row_letter, count(*)
-- FROM   fab_requirement WHERE row_letter IS NOT NULL
-- GROUP  BY 1,2 HAVING count(*) > 1;

-- ###################################################################
-- ## SECTION 11 — 0055-fab-requirement-finished-edges
-- ###################################################################

-- =====================================================================
-- 0055-fab-requirement-finished-edges.sql
--
-- WHICH EDGES ARE FINISHED, so edge work can be charged.
--
-- Edge work is billed by the RUNNING FOOT — 2 cm ₹15/ft, 3 cm ₹20/ft — and a
-- running foot is a length of finished EDGE, not an area and not a piece. A
-- 28 x 22.5 in top with all four edges done is (28+28+22.5+22.5)/12 = 8.42 ft;
-- sixty of them are 505 ft, which is ₹7,575 at 2 cm. Charging that per piece
-- would bill ₹900 for the same work.
--
-- STORED PER ROW, not per piece. The owner's rule: "same row all have same".
-- Every piece of an ordered row is the same size and gets the same treatment,
-- so the supervisor picks the edges once on a diagram of the piece and the
-- whole row is priced from it.
--
-- THE FORMAT is a canonical comma-separated list: 'front,back,left,right'.
--   front / back  run the LENGTH of the piece
--   left  / right run the WIDTH
-- Empty string = no edges finished. NULL = nobody has chosen yet, which is a
-- different fact and why the column is nullable: a row nobody has looked at
-- must not be reported as "no edge work" and billed at zero.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0054.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0055-fab-requirement-finished-edges.sql
-- =====================================================================

BEGIN;

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "finished_edges" TEXT;

COMMENT ON COLUMN "fab_requirement"."finished_edges" IS
  'Canonical CSV of finished edges: front,back,left,right. front/back run the '
  'length, left/right the width. Empty = none finished; NULL = not yet chosen. '
  'Per ordered row, not per piece. Priced per running foot - lib/fab/pricing.ts.';

-- Only the four known words, in any combination, or empty. A typo must not
-- become a charge, and the application already refuses one — this is the
-- second door, on the column itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_finished_edges_ck'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_finished_edges_ck"
      CHECK ("finished_edges" IS NULL OR "finished_edges" = ''
             OR "finished_edges" ~ '^(front|back|left|right)(,(front|back|left|right))*$');
  END IF;
END $$;

COMMIT;


-- =====================================================================
-- AFTERWARDS — what a project is worth, straight from SQL.
--
-- The application computes this in lib/fab/pricing.ts; this is the same
-- sum, for checking a figure without opening the app.
-- =====================================================================

-- SELECT p.project_code,
--        sum(
--          ( (CASE WHEN r.finished_edges LIKE '%front%' THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%back%'  THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%left%'  THEN r.width  ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%right%' THEN r.width  ELSE 0 END)
--          ) * r.quantity / 12.0
--        )                                                        AS running_ft,
--        sum(coalesce(r.sink_quantity, 0))                        AS sink_pieces
-- FROM   fab_requirement r
-- JOIN   fab_project p ON p.id = r.project_id
-- GROUP  BY p.project_code
-- ORDER  BY p.project_code;

-- ###################################################################
-- ## SECTION 12 — 0056-polish-qc-grade-before-cts
-- ###################################################################

-- =====================================================================
-- 0056-polish-qc-grade-before-cts.sql
--
-- KEEP THE POLISHING LINE'S VERDICT WHEN FABRICATION TAKES THE SLAB.
--
-- polish_qc.quality_grade holds SIX values, and they are not six points on
-- one scale:
--
--     A, A2, B, C   the polishing line's VERDICT on the stone
--     CTS           cut-to-size: taken for fabrication, no longer
--                   dispatchable as a full slab. A routing state.
--     Printing      routed to printing. Also a routing state.
--
-- lib/fab/markQcSlabCts.ts OVERWRITES the column with 'CTS' the moment a
-- supervisor picks a slab for fabrication. That is correct as far as
-- dispatch is concerned — the slab genuinely cannot go out whole any more,
-- and lib/inventory/grading.ts refuses it on exactly that grade.
--
-- But it DESTROYS the verdict. Every slab that has ever reached fabrication
-- now reads CTS and nothing records whether it was grade A stone or a C
-- reject. The CEO asked to see the grade beside the slab; without this
-- column the honest answer for every fabrication slab is "we no longer
-- know".
--
-- This adds a place to keep it. markQcSlabCts writes the outgoing value here
-- BEFORE overwriting, and only when this column is still empty — so a slab
-- marked CTS twice keeps its ORIGINAL verdict rather than recording "CTS"
-- as its own history.
--
-- WHAT IT CANNOT DO: recover the grades already overwritten. Those are gone.
-- From here on they are kept.
--
-- IDEMPOTENT. Safe to re-run. No backfill — there is nothing to backfill
-- from, and inventing one would be inventing quality data.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0056-polish-qc-grade-before-cts.sql
-- =====================================================================

BEGIN;

ALTER TABLE "polish_qc"
  ADD COLUMN IF NOT EXISTS "quality_grade_before_cts" TEXT;

COMMENT ON COLUMN "polish_qc"."quality_grade_before_cts" IS
  'The polishing line''s verdict (A/A2/B/C) as it was immediately before '
  'fabrication overwrote quality_grade with the CTS routing state. Written '
  'once, by lib/fab/markQcSlabCts.ts, and only while still NULL. Null means '
  'the slab was never routed, or was routed before scripts/0056.';

COMMIT;


-- =====================================================================
-- HOW MUCH WAS ALREADY LOST — run this to see the scale.
-- =====================================================================

-- SELECT quality_grade,
--        count(*)                                              AS slabs,
--        count(quality_grade_before_cts)                       AS verdict_kept
-- FROM   polish_qc
-- GROUP  BY quality_grade
-- ORDER  BY slabs DESC;

-- Every CTS row with no preserved verdict is one where the grade is
-- unrecoverable:
-- SELECT count(*) AS cts_with_no_verdict
-- FROM   polish_qc
-- WHERE  quality_grade = 'CTS' AND quality_grade_before_cts IS NULL;

-- ###################################################################
-- ## SECTION 13 — 0057-polish-qc-slab-mark
-- ###################################################################

-- =====================================================================
-- 0057-polish-qc-slab-mark.sql
--
-- WHAT HAPPENED TO THE SLAB, kept apart from HOW GOOD IT IS.
--
-- The owner, correcting an earlier reading of this:
--
--     "CTS is not a grade, it's a mark. Marks should be full slab, CTS,
--      sample. That's it. Initially full slab; if fabrication happened,
--      CTS; if it's pushed to sample, sample."
--
-- Today polish_qc.quality_grade carries BOTH facts, because
-- lib/fab/markQcSlabCts.ts overwrites it with 'CTS' when a supervisor picks
-- a slab for fabrication. So the column answers two different questions:
--
--     GRADE   A, A2, B, C          the polishing line's verdict on the stone
--     MARK    FULL_SLAB, CTS,      what has become of the physical slab
--             SAMPLE
--
-- A grade C slab that has been cut to size is grade C AND CTS. Neither
-- replaces the other, and the CEO dashboard was showing one where the other
-- belonged — every fabrication slab read "CTS" in a Grade column, coloured
-- red by its first letter, so the whole floor looked like it was cutting
-- rejects.
--
-- This gives the mark its own column. Three values, nothing else.
--
-- ─────────────────────────────────── WHAT THIS DOES *NOT* CHANGE ────────
-- quality_grade is still written 'CTS' by markQcSlabCts, deliberately.
-- lib/inventory/grading.ts REFUSES TO DISPATCH a slab whose grade reads CTS
-- (gradeBlocksDispatch), and that refusal is load-bearing — it is what stops
-- an already-cut slab leaving the yard as a full one. Moving dispatch onto
-- the mark is a separate change to a working module and is not made here.
-- Until it is made, the two writes happen together and cannot disagree.
--
-- SAMPLE is the new fact. A slab pushed to sampling was previously not
-- marked at all: sampling_intake recorded the pieces, and the slab itself
-- still read as whole.
--
-- ─────────────────────────────────── THE BACKFILL IS REAL, NOT INVENTED ─
-- Every row already reading quality_grade = 'CTS' is a slab fabrication has
-- cut. That is a fact the database already holds, so it is copied across.
-- Nothing is invented: rows with a real verdict get FULL_SLAB, which is what
-- they are.
--
-- No SAMPLE backfill is possible. sampling_intake.source_qc_id only exists
-- from scripts/0053, and rows older than that recorded no slab at all.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0056.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0057-polish-qc-slab-mark.sql
--
-- THEN, and this is the part that bites: `npx prisma db push` DROPS any
-- column the schema does not declare. slab_mark and quality_grade_before_cts
-- are both declared on model PolishQc in prisma/schema.prisma for exactly
-- that reason. Do not remove them.
-- =====================================================================

BEGIN;

ALTER TABLE "polish_qc"
  ADD COLUMN IF NOT EXISTS "slab_mark" TEXT NOT NULL DEFAULT 'FULL_SLAB';

COMMENT ON COLUMN "polish_qc"."slab_mark" IS
  'What became of the physical slab: FULL_SLAB (whole, dispatchable), CTS '
  '(fabrication cut it) or SAMPLE (pushed to sampling). NOT a quality grade '
  '- that is quality_grade, and the two are independent. A slab is cut once: '
  'only FULL_SLAB moves. See src/lib/fab/slabMark.ts.';

-- Three words, nothing else. A typo must not create a fourth state that no
-- screen knows how to draw and no rule knows how to refuse.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'polish_qc_slab_mark_ck'
  ) THEN
    ALTER TABLE "polish_qc"
      ADD CONSTRAINT "polish_qc_slab_mark_ck"
      CHECK ("slab_mark" IN ('FULL_SLAB', 'CTS', 'SAMPLE'));
  END IF;
END $$;

-- The slabs fabrication has already cut. quality_grade = 'CTS' is the only
-- record of it, and it is a reliable one - markQcSlabCts is the sole writer
-- of that value.
UPDATE "polish_qc"
SET    "slab_mark" = 'CTS'
WHERE  "slab_mark" = 'FULL_SLAB'
  AND  upper(btrim(coalesce("quality_grade", ''))) = 'CTS';

-- Finding a cut slab is the common read: the fabrication supervisor's picker
-- and the CEO board both ask "which of these are still whole". Partial, so
-- the index holds only the minority of rows that are not FULL_SLAB.
CREATE INDEX IF NOT EXISTS "polish_qc_slab_mark_idx"
  ON "polish_qc" ("slab_mark")
  WHERE "slab_mark" <> 'FULL_SLAB';

COMMIT;


-- =====================================================================
-- AFTERWARDS — check it landed, and how the floor divides.
-- =====================================================================

-- SELECT slab_mark, count(*) AS slabs
-- FROM   polish_qc
-- GROUP  BY slab_mark
-- ORDER  BY slabs DESC;

-- The two facts side by side. Every row here should read as a sentence:
-- "grade A stone, cut to size" and so on. A CTS mark beside a null grade is
-- a slab whose verdict was destroyed before scripts/0056 existed.
-- SELECT slab_mark,
--        coalesce(quality_grade_before_cts, quality_grade) AS verdict,
--        count(*)                                          AS slabs
-- FROM   polish_qc
-- GROUP  BY 1, 2
-- ORDER  BY 1, 3 DESC;

-- Must return 0 rows. If it does not, something other than markQcSlabCts is
-- writing quality_grade = 'CTS' and the two columns have drifted.
-- SELECT id, slab_number, quality_grade, slab_mark
-- FROM   polish_qc
-- WHERE  upper(btrim(coalesce(quality_grade, ''))) = 'CTS'
--   AND  slab_mark <> 'CTS';

-- ###################################################################
-- ## SECTION 14 — 0058-sampling-finish-vocabulary
-- ###################################################################

-- =====================================================================
-- 0058-sampling-finish-vocabulary.sql
--
-- THE FOUR FINISHES, IN THE OWNER'S WORDS.
--
--     "I need the finish type of all — polished, suede, matte, leathered."
--
-- product_colour_finish.finish was seeded with the spellings transcribed off
-- the printed chart: Polished, Leather, Suede, Honed. Two of those are the
-- same finishes under different names:
--
--     Leather -> Leathered   the owner's word, and the one the ERP already
--                            uses in finished_slab.polish_type
--     Honed   -> Matte       honed IS the matte finish. The trade says one,
--                            the owner says the other, and a vocabulary
--                            carrying both counts one shelf of stock as two.
--
-- Only THREE rows in the whole chart carry a non-default finish — Cappuccino
-- (Leather), Taj Vein (Leather) and Alabaster Noir – Suede — so this touches
-- two rows in practice. Nothing was ever seeded as Honed; that arm exists
-- because somebody may have typed it since.
--
-- ─────────────────────────────────── THE MERGE, AND WHY IT IS NEEDED ───────
-- (colour_id, finish) is UNIQUE. If a colour somehow holds BOTH "Leather" and
-- "Leathered" — one seeded, one created by hand — a plain UPDATE violates that
-- constraint and the whole script fails. So the duplicates are folded first:
-- stock, intake and dispatch lines are re-pointed at the surviving row and the
-- loser is deleted. NO COUNT IS LOST; the two shelves become one, which is
-- what they always were.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0057.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0058-sampling-finish-vocabulary.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Fold any colour that holds BOTH spellings onto the new one.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT old_row.id AS old_id, new_row.id AS new_id
    FROM   product_colour_finish old_row
    JOIN   product_colour_finish new_row
           ON new_row.colour_id = old_row.colour_id
    WHERE  (old_row.finish = 'Leather' AND new_row.finish = 'Leathered')
       OR  (old_row.finish = 'Honed'   AND new_row.finish = 'Matte')
  LOOP
    -- Every table that points at a colour+finish row. Stock is SUMMED rather
    -- than moved: both shelves are the same shelf, and dropping one would
    -- lose its count.
    UPDATE sampling_stock s
    SET    quantity = s.quantity + old_s.quantity
    FROM   sampling_stock old_s
    WHERE  s.colour_finish_id = pair.new_id
      AND  old_s.colour_finish_id = pair.old_id
      AND  old_s.size_id = s.size_id;

    -- A size the old row had and the new one did not simply changes hands.
    UPDATE sampling_stock
    SET    colour_finish_id = pair.new_id
    WHERE  colour_finish_id = pair.old_id
      AND  size_id NOT IN (
             SELECT size_id FROM sampling_stock WHERE colour_finish_id = pair.new_id
           );

    DELETE FROM sampling_stock WHERE colour_finish_id = pair.old_id;

    -- The ledgers are append-only history and are simply re-pointed.
    UPDATE sampling_intake        SET colour_finish_id = pair.new_id WHERE colour_finish_id = pair.old_id;
    UPDATE sampling_dispatch_line SET colour_finish_id = pair.new_id WHERE colour_finish_id = pair.old_id;

    DELETE FROM product_colour_finish WHERE id = pair.old_id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Rename what is left. No duplicates can remain after step 1.
-- ---------------------------------------------------------------------
UPDATE product_colour_finish SET finish = 'Leathered' WHERE finish = 'Leather';
UPDATE product_colour_finish SET finish = 'Matte'     WHERE finish = 'Honed';

COMMENT ON COLUMN "product_colour_finish"."finish" IS
  'One of src/lib/catalogue/colours.ts FINISHES: Polished, Suede, Matte, '
  'Leathered. TEXT rather than an enum so adding a finish is a seed edit '
  'and not a migration. A row is created on first use — every colour can be '
  'cut in any finish, and the chart only ever printed the photographed ones.';

COMMIT;


-- =====================================================================
-- AFTERWARDS — what the chart now holds.
-- =====================================================================

-- Must return only the four words:
-- SELECT finish, count(*) AS colours
-- FROM   product_colour_finish
-- GROUP  BY finish
-- ORDER  BY colours DESC;

-- Must return 0 rows — anything here is a spelling nothing in the app knows:
-- SELECT DISTINCT finish
-- FROM   product_colour_finish
-- WHERE  finish NOT IN ('Polished', 'Suede', 'Matte', 'Leathered');

-- The colours that have more than one finish on the shelf:
-- SELECT c.name, string_agg(f.finish, ' + ' ORDER BY f.finish) AS finishes
-- FROM   product_colour_finish f
-- JOIN   product_colour c ON c.id = f.colour_id
-- GROUP  BY c.name
-- HAVING count(*) > 1
-- ORDER  BY c.name;

-- ###################################################################
-- ## SECTION 15 — 0059-sample-orders
-- ###################################################################

-- =====================================================================
-- 0059-sample-orders.sql
--
-- SAMPLE ORDERS ON THE FABRICATION FLOOR.
--
-- The owner: "sampling page, they create the request — catalogue requirement —
-- and request the samples and send to supervisor. He the same way chooses the
-- slab and adds pieces and quantity and sends to cutting, then polished (no
-- sink and fabri in the samples) and pushed to package."
--
-- Sample stock arrives two ways, and they are not the same event:
--
--   OFFCUT    a PO slab has been cut and usable pieces are left over.
--             Recorded on the supervisor's slab card where they are found.
--             The slab stays CTS. Already built (sampling_intake).
--   ORDERED   somebody wants forty 11x11 Carrara Royale in suede. That is a
--             JOB: a slab must be chosen, pieces cut, polished and packed
--             before the stock exists. That is what this adds.
--
-- ─────────────────────────────────── SAME PIPELINE, ON PURPOSE ─────────────
-- A sample order is a fab_project with kind = 'SAMPLE'. Its rows are
-- fab_requirement, its pieces are fab_piece, and they cross the same slab
-- board and the same cutting / polishing / packaging queues as everything
-- else. One set of screens, one set of piece codes, one place an operator
-- looks.
--
-- The alternative — parallel tables and parallel queues — means an operator
-- choosing between two cutting screens depending on what is on the saw, and
-- two copies of every rule, which then drift. Sampling work is not a different
-- kind of work; it is the same work for a different customer.
--
-- ─────────────────────────────────── WHAT THE ROWS CARRY ───────────────────
-- A sample requirement has to know WHICH SHELF it will credit when its pieces
-- are packed:
--
--   colour_finish_id   product_colour_finish — the colour AND its finish.
--                      Never the colour alone: "50 Carrara Royale 11x11" is
--                      not a stock figure until you know it is suede.
--   sampling_size_id   sampling_size — the exact shelf size. The requirement
--                      also has its own length/width in inches for the saw;
--                      this is the catalogue row those inches came from, so
--                      packing credits the shelf that was ordered rather than
--                      one that merely measures the same.
--
-- Both NULL on every purchase-order row, which is what they are.
--
-- NO SINK, NO FABRICATION on a sample: enforced in the application
-- (lib/fab/sampleOrder.ts checkSampleSink) and by the CHECK below, because a
-- sink count on a sample row is not a preference somebody could hold.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0058.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0059-sample-orders.sql
--
-- THEN: `npx prisma db push` DROPS any column the schema does not declare.
-- kind, colour_finish_id and sampling_size_id are all declared on the models
-- in prisma/schema.prisma for that reason. Do not remove them.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. What a project is FOR.
-- ---------------------------------------------------------------------
ALTER TABLE "fab_project"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'PO';

COMMENT ON COLUMN "fab_project"."kind" IS
  'PO or SAMPLE. Every project that predates sample orders is a PO, which is '
  'what they all were. A SAMPLE project is the sampling desk''s own job and '
  'runs the same pipeline with sink and fabrication switched off. '
  'See src/lib/fab/sampleOrder.ts.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_project_kind_ck') THEN
    ALTER TABLE "fab_project"
      ADD CONSTRAINT "fab_project_kind_ck" CHECK ("kind" IN ('PO', 'SAMPLE'));
  END IF;
END $$;

-- Sample orders are the minority and are always asked for by name.
CREATE INDEX IF NOT EXISTS "fab_project_kind_idx"
  ON "fab_project" ("kind") WHERE "kind" <> 'PO';

-- ---------------------------------------------------------------------
-- 2. Which shelf a sample row credits when its pieces are packed.
-- ---------------------------------------------------------------------
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "colour_finish_id" TEXT,
  ADD COLUMN IF NOT EXISTS "sampling_size_id" TEXT;

COMMENT ON COLUMN "fab_requirement"."colour_finish_id" IS
  'product_colour_finish this sample row was ordered against - the colour AND '
  'its finish. NULL on every purchase-order row. Packing a piece of this row '
  'credits this shelf.';
COMMENT ON COLUMN "fab_requirement"."sampling_size_id" IS
  'sampling_size this sample row was ordered against. The row also carries '
  'length/width in inches for the saw; this is the catalogue row those inches '
  'came from, so packing credits the shelf that was ORDERED rather than one '
  'that merely measures the same. NULL on purchase-order rows.';

-- Real foreign keys, unlike sampling_intake's slab reference: these two tables
-- exist and are curated, so a row pointing at a deleted shelf is a bug and not
-- a fact of life. ON DELETE RESTRICT — a colour or size with sample orders
-- against it must not vanish underneath them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_colour_finish_fkey') THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_colour_finish_fkey"
      FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_sampling_size_fkey') THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_sampling_size_fkey"
      FOREIGN KEY ("sampling_size_id") REFERENCES "sampling_size" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- "The rows of this sample order that still owe stock" is the sampling desk's
-- own question, and it is asked by colour+finish.
CREATE INDEX IF NOT EXISTS "fab_requirement_colour_finish_idx"
  ON "fab_requirement" ("colour_finish_id") WHERE "colour_finish_id" IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Which sample pieces have already been credited to the shelf.
-- ---------------------------------------------------------------------
--
-- WITHOUT THIS, PACKING TWICE COUNTS TWICE. Packaging can be re-run — an
-- operator re-scans a trolley, a request is retried on a flaky tablet — and a
-- sample piece that credited stock on the first pass must not credit it again
-- on the second. One row per piece, unique, written in the same transaction as
-- the stock increment.
ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "sampling_intake_id" TEXT;

COMMENT ON COLUMN "fab_piece"."sampling_intake_id" IS
  'The sampling_intake row this piece created when it was packed, if it is a '
  'sample piece. NULL for a purchase-order piece, and NULL for a sample piece '
  'not yet packed. Its presence is what stops a re-run crediting twice.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_sampling_intake_fkey') THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_sampling_intake_fkey"
      FOREIGN KEY ("sampling_intake_id") REFERENCES "sampling_intake" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- PLAIN, not partial: Prisma's @unique on a nullable column emits exactly this,
-- and Postgres already treats NULLs as distinct — so nothing here conflicts and
-- `prisma db push` sees no drift to "fix". A partial index would be marginally
-- smaller and would make every push want to rewrite it.
CREATE UNIQUE INDEX IF NOT EXISTS "fab_piece_sampling_intake_id_key"
  ON "fab_piece" ("sampling_intake_id");

COMMIT;


-- =====================================================================
-- AFTERWARDS
-- =====================================================================

-- The sample orders on the floor and how far along they are:
-- SELECT p.project_code, p.status,
--        count(pc.id)                                        AS pieces,
--        count(pc.id) FILTER (WHERE pc.status = 'PACKAGED')  AS packed,
--        count(pc.sampling_intake_id)                        AS credited
-- FROM   fab_project p
-- LEFT   JOIN fab_piece pc ON pc.project_id = p.id
-- WHERE  p.kind = 'SAMPLE'
-- GROUP  BY p.project_code, p.status
-- ORDER  BY p.project_code;

-- Must return 0 rows: a packed sample piece that credited no shelf. Each one is
-- a row that could not say which colour+finish and size it was ordered against.
-- SELECT pc.piece_code, p.project_code
-- FROM   fab_piece pc
-- JOIN   fab_project p ON p.id = pc.project_id
-- JOIN   fab_requirement r ON r.id = pc.requirement_id
-- WHERE  p.kind = 'SAMPLE' AND pc.status = 'PACKAGED'
--   AND  pc.sampling_intake_id IS NULL;

-- Must return 0 rows: a sink on a sample row.
-- SELECT r.id, p.project_code, r.sink_quantity
-- FROM   fab_requirement r
-- JOIN   fab_project p ON p.id = r.project_id
-- WHERE  p.kind = 'SAMPLE' AND coalesce(r.sink_quantity, 0) > 0;


-- ###################################################################
-- ## SECTION 16 — 0060-finished-slab-cut-grade-backfill
-- ###################################################################

-- =====================================================================
-- 0060-finished-slab-cut-grade-backfill.sql
--
-- ALREADY-CUT SLABS THAT ARE STILL DISPATCHABLE. A one-off repair.
--
-- ─────────────────────────────────── THE BUG, PLAINLY ──────────────────────
-- finished_slab is a MIRROR of the latest polish_qc row for a slab number, and
-- inventory's dispatch rule reads finished_slab.grade — not polish_qc. The
-- mirror is only ever refreshed by autolinkFinishedSlabFromQc().
--
-- Nothing on the fabrication side was calling it. So when a supervisor picked a
-- slab for fabrication, markQcSlabCts wrote polish_qc.quality_grade = 'CTS' by
-- raw SQL and inventory carried on showing the old A/B/C. The CTS dispatch
-- block therefore NEVER FIRED for a slab fabrication took — it only ever worked
-- when QC itself typed CTS, because that path re-saves the QC row and refreshes
-- the mirror on the way past.
--
-- That is, word for word, the failure lib/inventory/grading.ts says it exists to
-- prevent: "which is how already-cut slabs left as full slabs."
--
-- The live path is fixed — refreshInventoryMirror() now runs on every CTS and
-- SAMPLE write. This script repairs the slabs cut BEFORE that fix, which would
-- otherwise stay wrongly dispatchable until somebody happened to re-save their
-- QC row.
--
-- ─────────────────────────────────── WHAT IT CHANGES ───────────────────────
-- ONE COLUMN, ON THE SLABS THAT ARE ALREADY CUT: finished_slab.grade is set to
-- what polish_qc actually says, for every slab whose QC row reads CTS or SAMPLE
-- and whose mirror does not.
--
-- IT ONLY EVER BLOCKS MORE, never less. Slabs graded A/B/C are untouched, so
-- nothing that can be dispatched today stops being dispatchable. That is the
-- only safe direction for a rule that is the last thing between an already-cut
-- slab and a lorry.
--
-- STATUS IS NOT TOUCHED. A slab already DISPATCHED stays dispatched — that
-- shipment happened, and rewriting history would not bring the stone back. This
-- only stops the NEXT one.
--
-- ─────────────────────────────────── WHICH QC ROW ──────────────────────────
-- The LATEST for that slab number, by created_time then imported_at — exactly
-- the ordering autolinkFinishedSlabFromQc uses, so this script and the live
-- path can never disagree about which row is authoritative.
--
-- IDEMPOTENT. Safe to re-run: the second run finds nothing left to change.
-- Apply after 0057.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Before: how many slabs are cut in QC but still read as sellable stone.
-- ---------------------------------------------------------------------
-- SELECT count(*) AS wrongly_dispatchable
-- FROM   finished_slab fs
-- JOIN   LATERAL (
--          SELECT quality_grade FROM polish_qc q
--          WHERE  q.slab_number = fs.slab_number
--          ORDER  BY q.created_time DESC NULLS LAST, q.imported_at DESC
--          LIMIT  1
--        ) qc ON TRUE
-- WHERE  upper(btrim(coalesce(qc.quality_grade,''))) IN ('CTS','SAMPLE')
--   AND  upper(btrim(coalesce(fs.grade,''))) NOT IN ('CTS','SAMPLE');

-- DISTINCT ON, NOT A LATERAL. The obvious way to write this is
-- `UPDATE finished_slab fs ... FROM LATERAL (... WHERE q.slab_number =
-- fs.slab_number)`, and Postgres refuses it: the UPDATE's target table is not
-- part of the FROM list, so a lateral subquery cannot reference it —
-- "invalid reference to FROM-clause entry for table fs". It is a hard parse
-- error, so the whole script stops here rather than doing anything partial.
--
-- DISTINCT ON with the same ORDER BY gives exactly the same rows: one row per
-- slab_number, the newest first by created_time then imported_at. That is the
-- ordering autolinkFinishedSlabFromQc uses, and this must agree with it or the
-- repair and the live path would disagree about which QC row is authoritative.
UPDATE finished_slab fs
SET    grade = latest.grade
FROM   (
         SELECT DISTINCT ON (q.slab_number)
                q.slab_number,
                upper(btrim(coalesce(q.quality_grade, ''))) AS grade
         FROM   polish_qc q
         ORDER  BY q.slab_number, q.created_time DESC NULLS LAST, q.imported_at DESC
       ) latest
WHERE  latest.slab_number = fs.slab_number
  AND  latest.grade IN ('CTS', 'SAMPLE')
  -- Only where the mirror actually disagrees, so a re-run is a no-op and the
  -- row count reported is the number genuinely repaired.
  AND  upper(btrim(coalesce(fs.grade, ''))) NOT IN ('CTS', 'SAMPLE');

COMMIT;


-- =====================================================================
-- AFTERWARDS
-- =====================================================================

-- MUST RETURN 0 ROWS. Any row here is a slab QC calls cut and inventory still
-- calls sellable — the exact state this script exists to remove.
-- SELECT fs.slab_number, fs.grade AS inventory_says, qc.quality_grade AS qc_says, fs.status
-- FROM   finished_slab fs
-- JOIN   LATERAL (
--          SELECT quality_grade FROM polish_qc q
--          WHERE  q.slab_number = fs.slab_number
--          ORDER  BY q.created_time DESC NULLS LAST, q.imported_at DESC
--          LIMIT  1
--        ) qc ON TRUE
-- WHERE  upper(btrim(coalesce(qc.quality_grade,''))) IN ('CTS','SAMPLE')
--   AND  upper(btrim(coalesce(fs.grade,''))) NOT IN ('CTS','SAMPLE');

-- WORTH READING ONCE, and it may be uncomfortable: cut slabs that were
-- DISPATCHED while the block was not firing. Nothing can be done about them
-- now — the stone has gone — but it says how long this was happening and how
-- much left as full slabs that should not have.
-- SELECT fs.slab_number, fs.grade, fs.status, fs.customer, fs.reserved_for_pi
-- FROM   finished_slab fs
-- WHERE  upper(btrim(coalesce(fs.grade,''))) IN ('CTS','SAMPLE')
--   AND  fs.status = 'DISPATCHED'
-- ORDER  BY fs.slab_number;


-- ###################################################################
-- ## SECTION 17 — 0061-fab-slab-thickness-repair
-- ###################################################################

-- =====================================================================
-- 0061-fab-slab-thickness-repair.sql
--
-- SLABS STORED TEN TIMES TOO THICK. A one-off repair.
--
-- /api/fab/supervisor/slab-assignment stored a slab's thickness as
-- parseFloat(polish_qc.slab_thickness) * 10, which is right only when the QC
-- inspector typed centimetres. The slab entry screen offers "3cm", "2cm",
-- "12mm" and "7mm", so a 12 mm slab was written as 120 mm and a 7 mm one as 70.
--
-- Thickness is the KEY OF THE RATE CARD — 2 cm is ₹230 a sink and ₹15 a running
-- foot, 3 cm is ₹300 and ₹20 — and it is what the slab-loss maths measures
-- against. 120 looks like a plausible number, which is why nobody caught it.
--
-- The route now calls parseThicknessMm(), the one function that knows how to
-- read that free text. This repairs the rows written before that.
--
-- ONLY THE ROWS IT CAN PROVE ARE WRONG: the QC text's leading figure must be 10
-- or more (millimetres), and the stored value must be EXACTLY that figure times
-- ten — the fingerprint of the old formula and of nothing else. A slab someone
-- corrected by hand does not match and is left alone. IDEMPOTENT.
-- =====================================================================

BEGIN;

UPDATE fab_slab s
SET    thickness = substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric
FROM   polish_qc q
WHERE  q.id = s.pacific_qc_id
  AND  q.slab_thickness ~ '^\s*[0-9]+(\.[0-9]+)?'
  AND  substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric >= 10
  AND  s.thickness IS NOT NULL
  AND  abs(s.thickness
           - substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric * 10) < 0.001
  AND  s.thickness
       <> substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric;

COMMIT;


-- ###################################################################
-- ## VERIFICATION — run these after the file above.
-- ## The ones marked MUST RETURN 0 ROWS are the ones that matter.
-- ###################################################################

-- 1. Every column arrived. Anything reading MISSING did not apply.
SELECT s.t AS "table", s.c AS "column",
       CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'present' END AS state
FROM (VALUES
  ('fab_requirement','sink_quantity'),      ('fab_requirement','po_id'),
  ('fab_requirement','row_letter'),         ('fab_requirement','finished_edges'),
  ('fab_requirement','colour_finish_id'),   ('fab_requirement','sampling_size_id'),
  ('fab_operation','worker_id'),            ('fab_operation','shift'),
  ('fab_machine_session','worker_id'),      ('fab_slab_job','worker_id'),
  ('fab_piece','reject_reason'),            ('fab_piece','reject_notes'),
  ('fab_piece','rejected_at'),              ('fab_piece','rejected_by_worker_id'),
  ('fab_piece','sampling_intake_id'),       ('fab_project','kind'),
  ('polish_qc','quality_grade_before_cts'), ('polish_qc','slab_mark'),
  ('sampling_intake','source_qc_id'),       ('sampling_intake','source_slab_id'),
  ('users','alt_role'),                     ('users','alt_branch')
) AS s(t,c)
LEFT JOIN information_schema.columns c
       ON c.table_name = s.t AND c.column_name = s.c AND c.table_schema = 'public'
ORDER BY state DESC, s.t, s.c;

-- 2. Every table arrived.
SELECT t.n AS "table",
       CASE WHEN to_regclass('public.'||t.n) IS NULL THEN 'MISSING' ELSE 'present' END AS state
FROM (VALUES ('fab_po'),('product_series'),('product_colour'),
             ('product_colour_finish'),('sampling_size'),('sampling_stock'),
             ('sampling_intake'),('sampling_dispatch'),('sampling_dispatch_line')
) AS t(n) ORDER BY state DESC, t.n;

-- 3. The slab marks, after the backfill. Expect FULL_SLAB for most and CTS
--    for every slab fabrication has already taken.
SELECT slab_mark, count(*) AS slabs FROM polish_qc GROUP BY slab_mark ORDER BY 2 DESC;

-- 4. MUST RETURN 0 ROWS — the grade and the mark must not disagree.
SELECT id, slab_number, quality_grade, slab_mark
FROM   polish_qc
WHERE  upper(btrim(coalesce(quality_grade,''))) = 'CTS' AND slab_mark <> 'CTS';

-- 5. MUST RETURN 0 ROWS — only the four finishes may exist.
SELECT DISTINCT finish FROM product_colour_finish
WHERE  finish NOT IN ('Polished','Suede','Matte','Leathered');

-- 6. MUST RETURN 0 ROWS — a row letter is unique within its project, because
--    piece codes are built from it and two rows sharing one collide.
SELECT project_id, row_letter, count(*)
FROM   fab_requirement WHERE row_letter IS NOT NULL
GROUP  BY 1,2 HAVING count(*) > 1;

-- 7. MUST RETURN 0 ROWS — a sample row may never carry a sink.
SELECT r.id, p.project_code, r.sink_quantity
FROM   fab_requirement r JOIN fab_project p ON p.id = r.project_id
WHERE  p.kind = 'SAMPLE' AND coalesce(r.sink_quantity,0) > 0;

-- 8. The project split. Every existing project should read PO.
SELECT kind, count(*) FROM fab_project GROUP BY kind;

-- 9. MUST RETURN 0 ROWS — a slab QC calls cut that inventory still calls
--    sellable. Section 16 repairs these; anything left here did not repair.
SELECT fs.slab_number, fs.grade AS inventory_says, qc.quality_grade AS qc_says
FROM   finished_slab fs
JOIN   LATERAL (
         SELECT quality_grade FROM polish_qc q
         WHERE  q.slab_number = fs.slab_number
         ORDER  BY q.created_time DESC NULLS LAST, q.imported_at DESC
         LIMIT  1
       ) qc ON TRUE
WHERE  upper(btrim(coalesce(qc.quality_grade,''))) IN ('CTS','SAMPLE')
  AND  upper(btrim(coalesce(fs.grade,''))) NOT IN ('CTS','SAMPLE');

-- 10. Slab thickness, after Section 17. Quartz here is 7, 12, 15, 20, 25 or
--     30 mm. A row reading 70 or 120 did not repair; anything else outside the
--     list was typed oddly rather than parsed wrongly and wants a human.
SELECT thickness AS mm, count(*) AS slabs
FROM   fab_slab WHERE thickness IS NOT NULL
GROUP  BY thickness ORDER BY thickness;
