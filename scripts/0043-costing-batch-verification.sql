-- Two sign-offs on a batch, either side of the costing sheet.
--
-- The production manager confirms the weights the mixer recorded; the store
-- incharge confirms the prices those weights are costed at. Neither sees the
-- other's half and neither sees a total — /office/costing stays ADMIN-only, and
-- the verifiers get /office/batch-verify, which serves one half per session.
--
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0043-costing-batch-verification.sql
--
-- Not `prisma db push` — this repo keeps model-less tables and raw-SQL-only
-- columns that db push proposes dropping along with their data. Same reason as
-- 0040, 0041 and 0042.
--
-- Re-runnable: IF NOT EXISTS throughout, and no data is written or moved.

CREATE TABLE IF NOT EXISTS "costing_batch_verification" (
  "id"          TEXT NOT NULL,
  -- mixer_cycle.batch_key. No FK, same as costing_batch_material: batch_key is
  -- a string shared across several import tables rather than a table of its own.
  "batch_key"   TEXT NOT NULL,
  -- WEIGHTS | COSTS. Text rather than an enum so this applies cleanly on a
  -- database where migrations are run by hand and an enum would need its own
  -- CREATE TYPE and its own rollback.
  "side"        TEXT NOT NULL,
  -- What the side's numbers hashed to when the button was pressed.
  --
  -- Stored rather than a boolean because the weights are edited on half a dozen
  -- other screens and the prices move whenever the rate card is revised. Hooking
  -- every write path that could invalidate a sign-off means finding all of them,
  -- and missing one leaves a batch marked checked over numbers that changed
  -- after the check. Comparing the numbers themselves cannot miss one.
  --
  -- See weightsFingerprint / costsFingerprint in src/lib/costing/verification.ts.
  "fingerprint" TEXT NOT NULL,
  "verified_by" TEXT NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "costing_batch_verification_pkey" PRIMARY KEY ("id")
);

-- One sign-off per side per batch: the write path upserts on this pair, so
-- re-verifying after a change updates the row rather than growing a history.
CREATE UNIQUE INDEX IF NOT EXISTS "costing_batch_verification_batch_key_side_key"
  ON "costing_batch_verification" ("batch_key", "side");

CREATE INDEX IF NOT EXISTS "costing_batch_verification_batch_key_idx"
  ON "costing_batch_verification" ("batch_key");
