-- Per-batch material LINES, replacing the per-batch single rate.
--
-- 0040 gave a batch one ₹/unit per material. That can only average what was
-- actually bought: the mixer weighs "resin, 1,000 kg" while the invoices say
-- 600 kg from Aypols at ₹161 and 400 from 3n Composits at ₹145. An average is
-- exactly the figure nobody can reconcile. So a material now carries several
-- rows — quantity, price, and a description of what that part was.
--
-- SAFE BECAUSE THE OLD TABLE IS EMPTY, AND THIS REFUSES TO RUN IF IT IS NOT.
-- costing_batch_rate was created earlier today and the deployment that would
-- have let anyone write to it never reached the live domain, so it holds no
-- rows. The guard below is not ceremony: if this is ever run somewhere that DID
-- collect data, it raises instead of dropping it, and whoever runs it can write
-- a migration rather than discovering the loss afterwards.
--
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0041-costing-batch-material.sql
--
-- Not `prisma db push` — this repo keeps eight model-less tables and several
-- raw-SQL-only columns that db push proposes dropping along with their data.

CREATE TABLE IF NOT EXISTS "costing_batch_material" (
  "id"          TEXT NOT NULL,
  -- mixer_cycle.batch_key. No FK: batch_key is a string shared across several
  -- import tables rather than a table of its own.
  "batch_key"   TEXT NOT NULL,
  -- RESIN | GRIT | FILLER | PIGMENT | CHEMICAL | DOSING. Conversion and basis
  -- are refused by the write route, not by a CHECK — the category list belongs
  -- with the code that knows the catalogue.
  "category"    TEXT NOT NULL,
  "item"        TEXT NOT NULL,
  -- Lines consume the mixer quantity in this order, so a NULL-qty "rest" line
  -- placed last takes what remains rather than everything.
  "seq"         INTEGER NOT NULL DEFAULT 0,
  -- NULL means "whatever is left of the mixer's quantity". Always NULL for
  -- DOSING, which is a factor with nothing to split.
  "qty"         DOUBLE PRECISION,
  "unit"        TEXT NOT NULL,
  "rate"        DOUBLE PRECISION NOT NULL,
  -- The column that makes a split readable six months later.
  "description" TEXT,
  "note"        TEXT,
  "created_by"  TEXT NOT NULL DEFAULT 'system',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "costing_batch_material_pkey" PRIMARY KEY ("id")
);

-- One row per (batch, material, position). Not per (batch, material) any more:
-- several rows for one material IS the feature. The upsert in the write route
-- is addressed by exactly this key.
CREATE UNIQUE INDEX IF NOT EXISTS "costing_batch_material_batch_item_seq_key"
  ON "costing_batch_material" ("batch_key", "item", "seq");

-- Every read is "the lines for this batch".
CREATE INDEX IF NOT EXISTS "costing_batch_material_batch_idx"
  ON "costing_batch_material" ("batch_key");

-- Retire 0040's table, but only if nothing was ever written to it.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.costing_batch_rate') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM costing_batch_rate' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION
      'costing_batch_rate holds % row(s) — refusing to drop it. Those are per-batch rates somebody entered; migrate them into costing_batch_material (one line each, qty NULL) before running this.', n;
  END IF;
  DROP TABLE costing_batch_rate;
END $$;
