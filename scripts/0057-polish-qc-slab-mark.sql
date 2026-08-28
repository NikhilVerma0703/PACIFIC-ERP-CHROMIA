-- =====================================================================
-- 0057-polish-qc-slab-mark.sql
--
-- WHAT HAPPENED TO THE SLAB, kept apart from HOW GOOD IT IS.
--
-- The owner, correcting an earlier reading of this:
--
--     "CTS is not a grade, it's a mark. Marks should be full slab, CTS,
--      sample. That's it. Initially full slab; if fabrication happened,
--      CTS; if it's pushed to sample, sample."
--
-- Today polish_qc.quality_grade carries BOTH facts, because
-- lib/fab/markQcSlabCts.ts overwrites it with 'CTS' when a supervisor picks
-- a slab for fabrication. So the column answers two different questions:
--
--     GRADE   A, A2, B, C          the polishing line's verdict on the stone
--     MARK    FULL_SLAB, CTS,      what has become of the physical slab
--             SAMPLE
--
-- A grade C slab that has been cut to size is grade C AND CTS. Neither
-- replaces the other, and the CEO dashboard was showing one where the other
-- belonged — every fabrication slab read "CTS" in a Grade column, coloured
-- red by its first letter, so the whole floor looked like it was cutting
-- rejects.
--
-- This gives the mark its own column. Three values, nothing else.
--
-- ─────────────────────────────────── WHAT THIS DOES *NOT* CHANGE ────────
-- quality_grade is still written 'CTS' by markQcSlabCts, deliberately.
-- lib/inventory/grading.ts REFUSES TO DISPATCH a slab whose grade reads CTS
-- (gradeBlocksDispatch), and that refusal is load-bearing — it is what stops
-- an already-cut slab leaving the yard as a full one. Moving dispatch onto
-- the mark is a separate change to a working module and is not made here.
-- Until it is made, the two writes happen together and cannot disagree.
--
-- SAMPLE is the new fact. A slab pushed to sampling was previously not
-- marked at all: sampling_intake recorded the pieces, and the slab itself
-- still read as whole.
--
-- ─────────────────────────────────── THE BACKFILL IS REAL, NOT INVENTED ─
-- Every row already reading quality_grade = 'CTS' is a slab fabrication has
-- cut. That is a fact the database already holds, so it is copied across.
-- Nothing is invented: rows with a real verdict get FULL_SLAB, which is what
-- they are.
--
-- No SAMPLE backfill is possible. sampling_intake.source_qc_id only exists
-- from scripts/0053, and rows older than that recorded no slab at all.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0056.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0057-polish-qc-slab-mark.sql
--
-- THEN, and this is the part that bites: `npx prisma db push` DROPS any
-- column the schema does not declare. slab_mark and quality_grade_before_cts
-- are both declared on model PolishQc in prisma/schema.prisma for exactly
-- that reason. Do not remove them.
-- =====================================================================

BEGIN;

ALTER TABLE "polish_qc"
  ADD COLUMN IF NOT EXISTS "slab_mark" TEXT NOT NULL DEFAULT 'FULL_SLAB';

COMMENT ON COLUMN "polish_qc"."slab_mark" IS
  'What became of the physical slab: FULL_SLAB (whole, dispatchable), CTS '
  '(fabrication cut it) or SAMPLE (pushed to sampling). NOT a quality grade '
  '- that is quality_grade, and the two are independent. A slab is cut once: '
  'only FULL_SLAB moves. See src/lib/fab/slabMark.ts.';

-- Three words, nothing else. A typo must not create a fourth state that no
-- screen knows how to draw and no rule knows how to refuse.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'polish_qc_slab_mark_ck'
  ) THEN
    ALTER TABLE "polish_qc"
      ADD CONSTRAINT "polish_qc_slab_mark_ck"
      CHECK ("slab_mark" IN ('FULL_SLAB', 'CTS', 'SAMPLE'));
  END IF;
END $$;

-- The slabs fabrication has already cut. quality_grade = 'CTS' is the only
-- record of it, and it is a reliable one - markQcSlabCts is the sole writer
-- of that value.
UPDATE "polish_qc"
SET    "slab_mark" = 'CTS'
WHERE  "slab_mark" = 'FULL_SLAB'
  AND  upper(btrim(coalesce("quality_grade", ''))) = 'CTS';

-- Finding a cut slab is the common read: the fabrication supervisor's picker
-- and the CEO board both ask "which of these are still whole". Partial, so
-- the index holds only the minority of rows that are not FULL_SLAB.
CREATE INDEX IF NOT EXISTS "polish_qc_slab_mark_idx"
  ON "polish_qc" ("slab_mark")
  WHERE "slab_mark" <> 'FULL_SLAB';

COMMIT;


-- =====================================================================
-- AFTERWARDS — check it landed, and how the floor divides.
-- =====================================================================

-- SELECT slab_mark, count(*) AS slabs
-- FROM   polish_qc
-- GROUP  BY slab_mark
-- ORDER  BY slabs DESC;

-- The two facts side by side. Every row here should read as a sentence:
-- "grade A stone, cut to size" and so on. A CTS mark beside a null grade is
-- a slab whose verdict was destroyed before scripts/0056 existed.
-- SELECT slab_mark,
--        coalesce(quality_grade_before_cts, quality_grade) AS verdict,
--        count(*)                                          AS slabs
-- FROM   polish_qc
-- GROUP  BY 1, 2
-- ORDER  BY 1, 3 DESC;

-- Must return 0 rows. If it does not, something other than markQcSlabCts is
-- writing quality_grade = 'CTS' and the two columns have drifted.
-- SELECT id, slab_number, quality_grade, slab_mark
-- FROM   polish_qc
-- WHERE  upper(btrim(coalesce(quality_grade, ''))) = 'CTS'
--   AND  slab_mark <> 'CTS';
