-- ============================================================================
-- 0070 · A RATE PER FACE
-- ============================================================================
-- Six nullable columns and two CHECK constraints. Nothing is backfilled,
-- nothing is updated, nothing is dropped. Re-runnable.
--
-- ─────────────────────── WHY ────────────────────────────────────────────────
-- The owner: "bottom edge have diff price sometime, top have diff price
-- sometime and side have different price sometime."
--
-- Until now a row carried ONE edge_rate. scripts/0067 made the three FACE
-- SELECTIONS independent — top on four sides, bottom on two, side on four — but
-- left the PRICE shared, so all three were charged the same rupees per foot.
-- Choosing independently and paying identically is half a feature.
--
-- ─────────────────────── THE RULE, IN HIS WORDS ─────────────────────────────
-- "Top have their rate, bottom have their rate. If pair rate is empty use the
--  sum, if something is written use this new rate, that's it. Side is diff."
--
-- Per SIDE of the piece:
--
--   polished top AND bottom  ->  pair_rate, or (top rate + bottom rate) when
--                                the pair box is empty. One trip, flipped.
--   polished top only        ->  the top rate
--   polished bottom only     ->  the bottom rate
--   the vertical band        ->  the side rate, always on its own
--
-- ─────────────────────── NULL FALLS BACK, AND THAT IS THE WHOLE STORY ───────
-- Each of these is NULL on every existing row, and NULL falls back to the row's
-- own edge_rate, which itself falls back to the rate card (Rs15 at 2 cm, Rs20 at
-- 3 cm). So on a row where nobody has typed anything:
--
--   top rate = bottom rate = side rate = the card
--   a shared side = card + card = 2 x card, which is exactly what summing the
--     two faces charged before this migration
--   a single side = card
--   the band      = card
--
-- The arithmetic is rearranged and the ANSWER IS IDENTICAL, to the paisa, on
-- every row already in the database. tests/fabHandPolish.test.ts asserts that
-- against the canonical row rather than asserting it in a comment.
--
-- ─────────────────────── LOCK PROFILE ───────────────────────────────────────
-- ADD COLUMN with no DEFAULT and no NOT NULL is metadata-only in Postgres 11+:
-- no table rewrite, no scan, ACCESS EXCLUSIVE only for the catalogue edit. The
-- CHECKs are added NOT VALID and validated separately, so the validation pass
-- takes SHARE UPDATE EXCLUSIVE and blocks nothing.
--
-- On Neon: branch first, then production against the DIRECT endpoint, not
-- -pooler.
--
-- ROLLBACK
--   ALTER TABLE "fab_requirement"
--     DROP COLUMN IF EXISTS "edge_rate_top",
--     DROP COLUMN IF EXISTS "edge_rate_bottom",
--     DROP COLUMN IF EXISTS "edge_rate_side";
--   ALTER TABLE "fab_piece"
--     DROP COLUMN IF EXISTS "hand_rate_top",
--     DROP COLUMN IF EXISTS "hand_rate_bottom",
--     DROP COLUMN IF EXISTS "hand_rate_side";
--   -- Loses only the per-face rates typed since. Every row falls back to its
--   -- edge_rate and prices exactly as it did before 0070.
-- ============================================================================

BEGIN;

-- ── the ordered row ─────────────────────────────────────────────────────────
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "edge_rate_top"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "edge_rate_bottom" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "edge_rate_side"   DOUBLE PRECISION;

COMMENT ON COLUMN "fab_requirement"."edge_rate_top" IS
  'Rupees per running foot for the TOP face. NULL falls back to edge_rate, which falls back to the rate card - so NULL prices exactly as this row priced before scripts/0070. A side polished on both faces uses pair_rate, or this plus edge_rate_bottom when pair_rate is NULL.';
COMMENT ON COLUMN "fab_requirement"."edge_rate_bottom" IS
  'Rupees per running foot for the BOTTOM face. NULL falls back to edge_rate then the card. See edge_rate_top.';
COMMENT ON COLUMN "fab_requirement"."edge_rate_side" IS
  'Rupees per running foot for the SIDE BAND - the vertical thickness face. NULL falls back to edge_rate then the card. The band never pairs with anything: it is its own pass over a different surface, and the owner prices it separately.';

-- Zero is a real rate - a face can genuinely be thrown in - so this is >= not >.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_face_rate_ck'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_face_rate_ck"
      CHECK (("edge_rate_top"    IS NULL OR "edge_rate_top"    >= 0)
         AND ("edge_rate_bottom" IS NULL OR "edge_rate_bottom" >= 0)
         AND ("edge_rate_side"   IS NULL OR "edge_rate_side"   >= 0))
      NOT VALID;
  END IF;
END $$;

-- ── and the hand bench, which quotes its own terms per piece ────────────────
ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "hand_rate_top"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "hand_rate_bottom" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "hand_rate_side"   DOUBLE PRECISION;

COMMENT ON COLUMN "fab_piece"."hand_rate_top" IS
  'This piece''s own TOP-face rate at the hand bench. NULL falls back to hand_rate. The per-piece counterpart of fab_requirement.edge_rate_top; see scripts/0067 for why a hand-bench piece carries its own terms.';
COMMENT ON COLUMN "fab_piece"."hand_rate_bottom" IS
  'This piece''s own BOTTOM-face rate at the hand bench. NULL falls back to hand_rate.';
COMMENT ON COLUMN "fab_piece"."hand_rate_side" IS
  'This piece''s own SIDE-BAND rate at the hand bench. NULL falls back to hand_rate.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_hand_face_rate_ck'
  ) THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_hand_face_rate_ck"
      CHECK (("hand_rate_top"    IS NULL OR "hand_rate_top"    >= 0)
         AND ("hand_rate_bottom" IS NULL OR "hand_rate_bottom" >= 0)
         AND ("hand_rate_side"   IS NULL OR "hand_rate_side"   >= 0))
      NOT VALID;
  END IF;
END $$;

COMMIT;

-- Separate transaction on purpose: validating outside the DDL transaction keeps
-- the weaker lock. Idempotent - validating an already-valid constraint is a
-- no-op.
ALTER TABLE "fab_requirement" VALIDATE CONSTRAINT "fab_requirement_face_rate_ck";
ALTER TABLE "fab_piece"       VALIDATE CONSTRAINT "fab_piece_hand_face_rate_ck";

-- ============================================================================
-- VERIFY (read-only)
-- ============================================================================
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE column_name IN ('edge_rate_top','edge_rate_bottom','edge_rate_side',
--                          'hand_rate_top','hand_rate_bottom','hand_rate_side')
--    ORDER BY table_name, column_name;
--   EXPECT six rows, all double precision, all YES, all default null
--
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conname IN ('fab_requirement_face_rate_ck','fab_piece_hand_face_rate_ck');
--   EXPECT both, convalidated = t
--
--   -- NOT ONE ROW WAS TOUCHED. Every row still falls back to edge_rate and
--   -- prices exactly as it did before this ran.
--   SELECT count(*)                                            AS rows_total,
--          count(*) FILTER (WHERE edge_rate_top    IS NOT NULL) AS with_top,
--          count(*) FILTER (WHERE edge_rate_bottom IS NOT NULL) AS with_bottom,
--          count(*) FILTER (WHERE edge_rate_side   IS NOT NULL) AS with_side
--     FROM fab_requirement;
--   EXPECT all three "with" counts = 0
-- ============================================================================
