-- Put costing_batch_rate back. It is empty and unused by current code; it
-- exists solely so an OLDER BUILD STILL RUNNING IN PRODUCTION can query it
-- without crashing.
--
-- WHAT WENT WRONG. 0041 dropped costing_batch_rate at the same time as the code
-- that stopped reading it was pushed. Pushing is not deploying. The build live
-- on erp.pacific-surfaces.com at that moment was one of 4f85ac8 / 94293c6 /
-- 269e418, and all three call prisma.costingBatchRate.findMany inside
-- buildCostingReport. With the table gone, Prisma raised P2021 on every batch,
-- the route handler had no catch, and the browser got a 500 with an empty body
-- — which is why the costing screen said
-- "Unexpected end of JSON input" the moment anyone picked a batch.
--
-- The rate card kept rendering throughout, because it reads costing_rate, which
-- was never touched. That is what made it look like a front-end fault.
--
-- THE RULE I BROKE, stated so the next person does not: expand, then contract.
-- Deploy the code that stops using a column or table FIRST, confirm it is
-- actually live, and only then drop. A drop is not additive no matter how empty
-- the table is, because "empty" says nothing about who is still asking for it.
--
-- This table can be dropped again once a0431d1 or later is confirmed live — or
-- simply left. An empty table costs nothing, and leaving it removes the only
-- way this can happen twice.
--
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0042-restore-costing-batch-rate.sql

CREATE TABLE IF NOT EXISTS "costing_batch_rate" (
  "id"         TEXT NOT NULL,
  "batch_key"  TEXT NOT NULL,
  "category"   TEXT NOT NULL,
  "item"       TEXT NOT NULL,
  "variant"    TEXT NOT NULL DEFAULT '',
  "unit"       TEXT NOT NULL,
  "rate"       DOUBLE PRECISION NOT NULL,
  "note"       TEXT,
  "created_by" TEXT NOT NULL DEFAULT 'system',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "costing_batch_rate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "costing_batch_rate_batch_item_variant_key"
  ON "costing_batch_rate" ("batch_key", "item", "variant");

CREATE INDEX IF NOT EXISTS "costing_batch_rate_batch_idx"
  ON "costing_batch_rate" ("batch_key");
