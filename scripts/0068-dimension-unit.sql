-- ============================================================================
-- 0068 · THE UNIT THE CUSTOMER ORDERED IN
-- ============================================================================
-- One nullable column on fab_requirement. Nothing is backfilled, nothing is
-- updated, nothing is dropped. Re-runnable.
--
-- ─────────────────────── WHY THIS EXISTS ────────────────────────────────────
-- fab_requirement.length/width are INCHES and must stay inches. Every figure in
-- the system is built on that: sqft_per_piece is L*W/144 (square inches to
-- square feet) and lib/fab/pricing.ts divides the perimeter by 12 to get the
-- RUNNING FEET that edge polish is charged by. Storing a centimetre in those
-- columns would multiply every edge charge by 2.54 and every area by 6.45, and
-- nothing on any screen would look wrong.
--
-- But the customer did not order in inches. PI SAL-ORD/25-26/01200 (Kerasom,
-- Netherlands) is centimetres throughout — "DS - Thresholds (103 x 3)", 2 CM
-- thick, priced per SQMT. The man at the saw is holding that document. Showing
-- him 40.5512 x 1.1811 where it says 103 x 3 is how a piece gets cut wrong.
--
-- So the unit is recorded BESIDE the inches rather than instead of them:
-- the maths reads the columns, the screens read this, and neither has to
-- convert anything the other depends on.
--
-- ─────────────────────── NULL IS INCHES, AND THAT IS THE POINT ──────────────
-- Every row written before today is an inch row — PO 10026 and every other US
-- order came off a packing list in inches and square feet. If NULL meant
-- "unknown" the screens would have to guess; if it meant "cm" every historical
-- row would suddenly display a number 2.54x larger than the one on its own
-- purchase order.
--
-- NULL MEANS INCHES. It is not a missing answer. lib/fab/dimensions.ts renders
-- a NULL row byte-identically to what the screens printed yesterday, which is
-- what makes this migration safe to apply to a live database at any moment,
-- including before the code that reads it ships.
--
-- ─────────────────────── LOCK PROFILE ───────────────────────────────────────
-- ADD COLUMN with no DEFAULT and no NOT NULL is metadata-only in Postgres 11+:
-- no table rewrite, no row locks held while scanning. It takes an ACCESS
-- EXCLUSIVE lock for the moment it edits the catalogue. On Neon, run it on a
-- branch first, then on production against the DIRECT endpoint (not -pooler).
--
-- The CHECK constraint is added NOT VALID and validated separately, so the
-- validation pass takes only a SHARE UPDATE EXCLUSIVE lock and does not block
-- reads or writes. On an empty-of-CM database this is instant either way; it is
-- written this way so the same file is still correct when the table is large.
--
-- ROLLBACK
--   ALTER TABLE "fab_requirement" DROP COLUMN IF EXISTS "dim_unit";
--   -- Loses only the display hint. No money, no quantity, no dimension.
-- ============================================================================

BEGIN;

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "dim_unit" TEXT;

COMMENT ON COLUMN "fab_requirement"."dim_unit" IS
  'The unit the CUSTOMER ordered this row in, for display only: ''CM'' or ''IN''. NULL means IN and is not a missing answer - every row predating scripts/0068 is an inch row. length/width are ALWAYS stored in inches regardless of this column, because sqft_per_piece (L*W/144) and the running-foot edge charge (perimeter/12) are built on inches. See src/lib/fab/dimensions.ts, which is the only thing that reads this.';

-- Two spellings, and no third. A typo here would render as an inch row and be
-- invisible, so the database refuses it rather than letting it through.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_dim_unit_ck'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_dim_unit_ck"
      CHECK ("dim_unit" IS NULL OR "dim_unit" IN ('IN', 'CM'))
      NOT VALID;
  END IF;
END $$;

COMMIT;

-- Separate transaction on purpose: validating outside the DDL transaction is
-- what keeps the weaker lock. Idempotent - validating an already-valid
-- constraint is a no-op.
ALTER TABLE "fab_requirement" VALIDATE CONSTRAINT "fab_requirement_dim_unit_ck";

-- ============================================================================
-- VERIFY (read-only)
-- ============================================================================
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'fab_requirement' AND column_name = 'dim_unit';
--   EXPECT  dim_unit | text | YES | (null)
--
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conname = 'fab_requirement_dim_unit_ck';
--   EXPECT  fab_requirement_dim_unit_ck | t
--
--   -- Nothing was touched: every pre-existing row is still NULL, i.e. inches.
--   SELECT count(*) FILTER (WHERE dim_unit IS NULL)  AS inch_rows,
--          count(*) FILTER (WHERE dim_unit = 'CM')   AS cm_rows
--     FROM fab_requirement;
-- ============================================================================
