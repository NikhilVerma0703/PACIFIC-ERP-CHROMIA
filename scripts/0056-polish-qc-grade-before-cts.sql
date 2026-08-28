-- =====================================================================
-- 0056-polish-qc-grade-before-cts.sql
--
-- KEEP THE POLISHING LINE'S VERDICT WHEN FABRICATION TAKES THE SLAB.
--
-- polish_qc.quality_grade holds SIX values, and they are not six points on
-- one scale:
--
--     A, A2, B, C   the polishing line's VERDICT on the stone
--     CTS           cut-to-size: taken for fabrication, no longer
--                   dispatchable as a full slab. A routing state.
--     Printing      routed to printing. Also a routing state.
--
-- lib/fab/markQcSlabCts.ts OVERWRITES the column with 'CTS' the moment a
-- supervisor picks a slab for fabrication. That is correct as far as
-- dispatch is concerned — the slab genuinely cannot go out whole any more,
-- and lib/inventory/grading.ts refuses it on exactly that grade.
--
-- But it DESTROYS the verdict. Every slab that has ever reached fabrication
-- now reads CTS and nothing records whether it was grade A stone or a C
-- reject. The CEO asked to see the grade beside the slab; without this
-- column the honest answer for every fabrication slab is "we no longer
-- know".
--
-- This adds a place to keep it. markQcSlabCts writes the outgoing value here
-- BEFORE overwriting, and only when this column is still empty — so a slab
-- marked CTS twice keeps its ORIGINAL verdict rather than recording "CTS"
-- as its own history.
--
-- WHAT IT CANNOT DO: recover the grades already overwritten. Those are gone.
-- From here on they are kept.
--
-- IDEMPOTENT. Safe to re-run. No backfill — there is nothing to backfill
-- from, and inventing one would be inventing quality data.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0056-polish-qc-grade-before-cts.sql
-- =====================================================================

BEGIN;

ALTER TABLE "polish_qc"
  ADD COLUMN IF NOT EXISTS "quality_grade_before_cts" TEXT;

COMMENT ON COLUMN "polish_qc"."quality_grade_before_cts" IS
  'The polishing line''s verdict (A/A2/B/C) as it was immediately before '
  'fabrication overwrote quality_grade with the CTS routing state. Written '
  'once, by lib/fab/markQcSlabCts.ts, and only while still NULL. Null means '
  'the slab was never routed, or was routed before scripts/0056.';

COMMIT;


-- =====================================================================
-- HOW MUCH WAS ALREADY LOST — run this to see the scale.
-- =====================================================================

-- SELECT quality_grade,
--        count(*)                                              AS slabs,
--        count(quality_grade_before_cts)                       AS verdict_kept
-- FROM   polish_qc
-- GROUP  BY quality_grade
-- ORDER  BY slabs DESC;

-- Every CTS row with no preserved verdict is one where the grade is
-- unrecoverable:
-- SELECT count(*) AS cts_with_no_verdict
-- FROM   polish_qc
-- WHERE  quality_grade = 'CTS' AND quality_grade_before_cts IS NULL;
