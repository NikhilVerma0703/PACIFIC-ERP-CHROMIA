-- Batch verification: one mark per PERSON per side, not one per side.
--
-- The owner's instruction (2026-08-18): both the store incharge and the named
-- production verifier mark BOTH the price and the consumption as correct, and
-- every mark carries a name and a time. The original unique on
-- (batch_key, side) allowed exactly one row per side, so the second person's
-- sign-off would silently OVERWRITE the first — the upsert keyed on that pair.
-- Widening the key to (batch_key, side, verified_by) lets both signatures
-- stand on the same side; the write path now upserts on the triple and a
-- withdrawal deletes only the caller's own row.
--
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0048-costing-verification-per-person.sql
--
-- Not `prisma db push` — this repo keeps model-less tables and raw-SQL-only
-- columns that db push proposes dropping along with their data. Same reason as
-- 0040 through 0043.
--
-- Verified before writing this: the table holds 0 rows in Neon (2026-08-18),
-- so the swap moves no data and cannot collide. Re-runnable: DROP IF EXISTS /
-- IF NOT EXISTS throughout.

DROP INDEX IF EXISTS "costing_batch_verification_batch_key_side_key";

CREATE UNIQUE INDEX IF NOT EXISTS "costing_batch_verification_batch_key_side_verified_by_key"
  ON "costing_batch_verification" ("batch_key", "side", "verified_by");

-- The plain batch_key lookup index from 0043 is unchanged and still wanted.
