-- ============================================================================
-- 0069 · THE PRICE FOR DOING TOP AND BOTTOM TOGETHER
-- ============================================================================
-- Two nullable columns and two CHECK constraints. Nothing is backfilled,
-- nothing is updated, nothing is dropped. Re-runnable.
--
-- ─────────────────────── WHY ────────────────────────────────────────────────
-- The owner: "sometime when choosen top and bottom both they get a price — if
-- per feet 10 rs then doing top + bottom we will give them 15 not 20."
--
-- Polishing both faces of the same edge is ONE trip along that edge with the
-- piece flipped, not two separate jobs. Until now the two faces were simply
-- SUMMED, so a row done top and bottom at Rs10 a foot could only ever come to
-- Rs20 a perimeter-foot. There was no way to quote the Rs15 that was actually
-- agreed, short of typing an override and losing the fact that it IS a rate.
--
-- ─────────────────────── WHAT IT MULTIPLIES ─────────────────────────────────
-- THE SIDES THAT SHARE BOTH FACES, and only those. Asked and answered:
--
--   top on all four, bottom on front and back only
--     -> front and back are paired      : charged at pair_rate
--     -> left and right are top-only    : charged at edge_rate as before
--
-- All four on both faces means the whole perimeter is paired and nothing is
-- single, which is the Rs15-over-505-feet case exactly. See facePairSplit() in
-- src/lib/fab/shape.ts, which owns the geometry and is unit tested.
--
-- The SIDE BAND never pairs. It is the vertical thickness face, done in its own
-- pass, and there is no second face for it to share a trip with.
--
-- ─────────────────────── NULL MEANS NO DISCOUNT ─────────────────────────────
-- And that is the whole compatibility story. NULL leaves the two faces summed
-- at edge_rate, which is exactly what every row in the database is charged
-- today, so not one existing figure moves when this runs. The discount exists
-- only on a row where somebody has typed it.
--
-- RUNNING FOOT ONLY. A pair rate is a rate PER FOOT, so it means nothing under
-- PER_PIECE or LUMP_SUM — those price the whole piece or the whole row and have
-- no per-face arithmetic to discount. priceRow ignores it in those modes.
--
-- ─────────────────────── LOCK PROFILE ───────────────────────────────────────
-- ADD COLUMN with no DEFAULT and no NOT NULL is metadata-only in Postgres 11+:
-- no table rewrite, no scan. ACCESS EXCLUSIVE for the instant the catalogue is
-- edited. The CHECKs are added NOT VALID and validated separately, so the
-- validation pass takes only SHARE UPDATE EXCLUSIVE and blocks nothing.
--
-- On Neon: branch first, then production against the DIRECT endpoint, not
-- -pooler.
--
-- ROLLBACK
--   ALTER TABLE "fab_requirement" DROP COLUMN IF EXISTS "pair_rate";
--   ALTER TABLE "fab_piece"       DROP COLUMN IF EXISTS "hand_pair_rate";
--   -- Loses only the discounts typed since. Every other figure is untouched,
--   -- because a row without a pair rate is priced the way it always was.
-- ============================================================================

BEGIN;

-- ── the ordered row ─────────────────────────────────────────────────────────
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "pair_rate" DOUBLE PRECISION;

COMMENT ON COLUMN "fab_requirement"."pair_rate" IS
  'Rupees per running foot for a side polished on BOTH top and bottom, replacing two passes at edge_rate. NULL means no pair discount - the two faces are summed at edge_rate, which is what every row predating scripts/0069 is charged. Applies to the sides that share both faces and to nothing else; the side band never pairs. RUNNING_FOOT only. See facePairSplit() in src/lib/fab/shape.ts.';

-- Zero is a real pair rate - a customer can genuinely get the second face free
-- - so this is >= and not >.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_pair_rate_ck'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_pair_rate_ck"
      CHECK ("pair_rate" IS NULL OR "pair_rate" >= 0)
      NOT VALID;
  END IF;
END $$;

-- ── and the hand bench, which quotes its own terms per piece ────────────────
-- scripts/0067 gave a piece sent to hand its own faces, rate and mode. The pair
-- rate is part of those terms for the same reason: the bench is quoted the same
-- way the row is, and a piece flipped once is a piece flipped once whoever is
-- holding it.
ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "hand_pair_rate" DOUBLE PRECISION;

COMMENT ON COLUMN "fab_piece"."hand_pair_rate" IS
  'This piece''s own pair rate at the hand bench - rupees per running foot for a side polished on both top and bottom. NULL means no pair discount for this piece. The per-piece counterpart of fab_requirement.pair_rate; see scripts/0067 for why a hand-bench piece carries its own terms at all.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_hand_pair_rate_ck'
  ) THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_hand_pair_rate_ck"
      CHECK ("hand_pair_rate" IS NULL OR "hand_pair_rate" >= 0)
      NOT VALID;
  END IF;
END $$;

COMMIT;

-- Separate transaction on purpose: validating outside the DDL transaction is
-- what keeps the weaker lock. Idempotent - validating an already-valid
-- constraint is a no-op.
ALTER TABLE "fab_requirement" VALIDATE CONSTRAINT "fab_requirement_pair_rate_ck";
ALTER TABLE "fab_piece"       VALIDATE CONSTRAINT "fab_piece_hand_pair_rate_ck";

-- ============================================================================
-- VERIFY (read-only)
-- ============================================================================
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE column_name IN ('pair_rate', 'hand_pair_rate');
--   EXPECT  fab_requirement | pair_rate      | double precision | YES | (null)
--           fab_piece       | hand_pair_rate | double precision | YES | (null)
--
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conname IN ('fab_requirement_pair_rate_ck','fab_piece_hand_pair_rate_ck');
--   EXPECT both, convalidated = t
--
--   -- NOT ONE ROW WAS TOUCHED. Every row is still priced as it was yesterday.
--   SELECT count(*) FILTER (WHERE pair_rate IS NOT NULL) AS with_discount,
--          count(*)                                      AS rows_total
--     FROM fab_requirement;
--   EXPECT with_discount = 0
-- ============================================================================
