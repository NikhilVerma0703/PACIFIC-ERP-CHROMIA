-- Grit assigned silo by silo: which SIZE each silo ran in a batch, and which
-- SUPPLIER(s) its weight was drawn from.
--
-- The verifiers assign size and supplier on /office/batch-verify; the price is
-- typed afterwards on the costing panel, in rupees per tonne.
--
--   cd ~/Pacific-ERP        <-- FROM THE REPO ROOT. This is not decoration.
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0049-costing-grit-silo-assignment.sql
--
-- Run from anywhere else and npx finds no local prisma, downloads the LATEST
-- major instead, and fails with "unknown or unexpected option: --url" — that
-- flag was dropped in Prisma 7, which reads the datasource from a config file
-- this repo does not have. The pinned 6.19.3 in node_modules still takes it.
--
-- Or paste the statements below into the Neon SQL editor, which needs no CLI,
-- no DATABASE_URL in your shell and no Prisma at all. That is how 0043 was run.
--
-- Not `prisma db push`. Same reason as 0040 through 0043 and 0048, and CLAUDE.md
-- says it out loud: this repo keeps model-less tables and raw-SQL-only columns
-- that db push proposes dropping along with their data.
--
-- ============================================================================
-- THERE IS NO MONEY COLUMN IN EITHER TABLE, AND THAT IS THE DESIGN.
-- ============================================================================
-- The price already has a home: costing_batch_material, keyed 'grit-silo-<n>',
-- category GRIT — a category isOverridable() and isSplittable() already admit,
-- in a table whose lines costsFingerprint already hashes and whose split editor
-- already exists. A nullable rate here would create a second pricing path, a
-- second fingerprint input computed in two places that would drift, and a rupee
-- value one SELECT away from a screen that is supposed to carry none. A column
-- that does not exist cannot be selected, spread, logged or leaked.
--
-- The reason these tables must exist at all, and it is not stylistic:
-- costing_batch_material.rate is NOT NULL and its route refuses rate <= 0 on
-- purpose ("a zero does not fail loudly — it prices the material at nothing").
-- An assignment has no price yet. It is physically unstorable there.
--
-- ============================================================================
-- silo_no IS THE MIXER'S OWN TYPED STRING (mixer_cycle.m*_g*_sn), btrim'd.
-- NEVER silo.id, NEVER silo."airtableId".
-- ============================================================================
-- Stated honestly, because a false proof is worse than a weak one:
--
--   It DOES keep a handle onto a bag row out of this schema, so a query joining
--   these tables to silo cannot be written without first inventing the column.
--
--   It does NOT make a leak hard. The bare silo number is the primary handle of
--   the entire silo mutation API — applyCorrection(siloNo), the deficit
--   helpers, the FIFO allocator's own index. A write needs no FK and no
--   relation to be possible.
--
-- What actually contains this is the import ban in tests/gritContainment.test.ts:
-- no costing module may import the silo, mixer, FIFO or report modules. Not the
-- shape of this key.
--
-- No foreign keys, matching costing_batch_material and
-- costing_batch_verification: batch_key is a string shared across several
-- import tables, not a table of its own.
--
-- Re-runnable: IF NOT EXISTS throughout. Creates only; alters nothing; drops
-- nothing; moves no data.

CREATE TABLE IF NOT EXISTS "costing_batch_grit_silo" (
  "id"          TEXT PRIMARY KEY,
  "batch_key"   TEXT NOT NULL,
  "silo_no"     TEXT NOT NULL,
  -- What the verifier says this silo ran, VERBATIM as typed. Not normalised on
  -- the way in: the normalised form is computed for comparison (sizeKey in
  -- src/lib/costing/gritAssign.ts), and a stored canonical form would be a
  -- second source of truth that can disagree with the first.
  --
  -- NOT a rate-card item key. A typed size must never mint a catalogue entry —
  -- that is how batch 1414 came to need a rate for 'grit-Grit' that nothing can
  -- satisfy and no screen can set.
  --
  -- '' means "listed, suppliers perhaps assigned, size not chosen yet". A row
  -- exists as soon as a silo is touched, so the batch flips to the silo-wise
  -- costing path on the first save rather than only when every silo is done.
  "size"        TEXT NOT NULL DEFAULT '',
  "assigned_by" TEXT NOT NULL DEFAULT 'system',
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ONE SIZE PER SILO PER BATCH, held by the DATABASE. This index IS the rule
-- that a silo cannot run two sizes in one batch. The single dropdown on the
-- screen is how that rule looks; this is where it is true.
--
-- What it does NOT do, so nobody leans on it for the wrong thing: it stops two
-- ROWS. It does not stop a stale writer deleting and re-inserting, which is why
-- the write path scopes its delete to the silos in the payload rather than
-- wiping the batch.
CREATE UNIQUE INDEX IF NOT EXISTS "costing_batch_grit_silo_batch_key_silo_no_key"
  ON "costing_batch_grit_silo" ("batch_key", "silo_no");
CREATE INDEX IF NOT EXISTS "costing_batch_grit_silo_batch_key_idx"
  ON "costing_batch_grit_silo" ("batch_key");
-- The plant-wide learned size list is DERIVED from this column
-- (SELECT DISTINCT size), the way supplier suggestions are already derived from
-- costing_batch_material.description. A size typed once is offered on every
-- batch afterwards, with no dictionary table to administer and no way for the
-- list and the data to disagree.
CREATE INDEX IF NOT EXISTS "costing_batch_grit_silo_size_idx"
  ON "costing_batch_grit_silo" ("size");

CREATE TABLE IF NOT EXISTS "costing_batch_grit_supplier" (
  "id"          TEXT PRIMARY KEY,
  "batch_key"   TEXT NOT NULL,
  -- Same raw mixer string, same reasoning. No FK to the size table either: a
  -- silo may have suppliers assigned before a size, and a join Prisma can
  -- generate is a join somebody will eventually traverse.
  "silo_no"     TEXT NOT NULL,
  -- Position within the silo's split. Rewritten wholesale PER SILO on every
  -- save, the same convention as costing_batch_material.seq.
  "seq"         INTEGER NOT NULL DEFAULT 0,
  -- Free text, as typed. Compared FUZZILY to
  -- silo.name_from_supplier_master_from_used_bag and flagged when they differ.
  -- THE TYPED VALUE WINS AND IS WHAT IS STORED. Nothing here is ever written
  -- back to a silo row.
  "supplier"    TEXT NOT NULL,
  -- Kilograms — the unit the mixer records and the unit the screen shows. The
  -- conversion to tonnes happens once, in report.ts, because rupees-per-tonne
  -- is what gets typed; converting in two places is how somebody ends up
  -- entering 14,780 against a kilogram.
  "kg"          DOUBLE PRECISION NOT NULL,
  "assigned_by" TEXT NOT NULL DEFAULT 'system',
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "costing_batch_grit_supplier_batch_key_silo_no_seq_key"
  ON "costing_batch_grit_supplier" ("batch_key", "silo_no", "seq");
CREATE INDEX IF NOT EXISTS "costing_batch_grit_supplier_batch_key_idx"
  ON "costing_batch_grit_supplier" ("batch_key");
CREATE INDEX IF NOT EXISTS "costing_batch_grit_supplier_supplier_idx"
  ON "costing_batch_grit_supplier" ("supplier");

-- NOTHING IS MIGRATED AND NOTHING IS DROPPED.
--
-- costing_batch_material keeps every grit-<band> row it holds. A band-keyed
-- line can span several silos and no record survives of how its rate divided
-- among them, so a faithful migration does not exist — and an unfaithful one
-- would silently re-price batches two people have already signed off. The
-- report reads band lines for batches with no assignment rows, and silo lines
-- for batches with them; the switch is per batch and flips the first time
-- somebody assigns a silo. Stale band lines are named on the pricing panel and
-- removed by hand through the existing DELETE, if at all.
--
-- Expand, then contract.
