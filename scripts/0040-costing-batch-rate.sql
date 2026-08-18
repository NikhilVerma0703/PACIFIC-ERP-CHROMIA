-- Per-batch material rates: what ONE batch's materials actually cost, layered
-- over the date-resolved rate card.
--
-- Purely additive: one new table, no change to costing_rate or anything else. A
-- batch with no rows here prices exactly as it did before this ran, so applying
-- it changes no existing costing.
--
-- Applied with `prisma db execute`, NOT `prisma db push`. This repo keeps eight
-- model-less tables that Prisma does not know about (entry_photo,
-- fg_sales_approved_batch, login_attempt and friends, see the note at the top of
-- the sales section in schema.prisma) plus several raw-SQL-only columns, and
-- `db push` proposes dropping every one of them along with its data.
--
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0040-costing-batch-rate.sql

CREATE TABLE IF NOT EXISTS "costing_batch_rate" (
  "id"         TEXT NOT NULL,
  -- mixer_cycle.batch_key. No FK: batch_key is a string shared across several
  -- import tables rather than a table of its own.
  "batch_key"  TEXT NOT NULL,
  -- RESIN | GRIT | FILLER | PIGMENT | CHEMICAL | DOSING. Conversion and basis
  -- rates are plant-wide and are refused by the write route, not by a CHECK —
  -- the category list belongs with the code that knows the catalogue.
  "category"   TEXT NOT NULL,
  "item"       TEXT NOT NULL,
  -- Supplier for resin, empty string otherwise. NOT nullable: Postgres treats
  -- NULLs as distinct, so a nullable column would let the unique index below
  -- admit duplicate rows for the same item.
  "variant"    TEXT NOT NULL DEFAULT '',
  "unit"       TEXT NOT NULL,
  "rate"       DOUBLE PRECISION NOT NULL,
  "note"       TEXT,
  "created_by" TEXT NOT NULL DEFAULT 'system',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "costing_batch_rate_pkey" PRIMARY KEY ("id")
);

-- One current rate per (batch, item, variant). Unlike costing_rate this table
-- is not append-only: a rate revision is history the whole plant shares and
-- earns a row, while a batch rate is a single fact about one run, corrected in
-- place. The upsert in the write route is addressed by exactly this key.
CREATE UNIQUE INDEX IF NOT EXISTS "costing_batch_rate_batch_item_variant_key"
  ON "costing_batch_rate" ("batch_key", "item", "variant");

-- Every read is "the rates for this batch".
CREATE INDEX IF NOT EXISTS "costing_batch_rate_batch_idx"
  ON "costing_batch_rate" ("batch_key");
