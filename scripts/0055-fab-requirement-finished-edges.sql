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
