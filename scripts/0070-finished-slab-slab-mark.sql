-- =====================================================================
-- 0070-finished-slab-slab-mark.sql
--
-- THE MARK, ON THE TABLE DISPATCH ACTUALLY READS.
--
-- The owner, in his developer's words: "grade should be A/B/C like normal,
-- and the MARK is CTS or sampling."
--
-- ─────────────────────────────────── WHY THIS EXISTS ───────────────────────
-- polish_qc got its mark column in scripts/0057. fg_finished_slab never did,
-- and fg_finished_slab is the table lib/inventory/finishedSlab.ts reads when
-- it decides whether a slab may be dispatched. So the mark existed but the
-- dispatch rule could not see it, and the only signal it had was the GRADE —
-- which is why lib/fab/markQcSlabCts.ts still OVERWRITES quality_grade with
-- 'CTS' when fabrication takes a slab, destroying the polishing line's A/B/C
-- verdict in the process. Its own header says so: "CTS is not a grade, it's
-- a mark", and both writes happen only "until dispatch reads the mark
-- instead".
--
-- This is the column that lets dispatch read the mark instead.
--
-- ─────────────────────────────────── MEASURED ON LIVE NEON, 2026-09-03 ─────
--   fg_finished_slab   62 rows grade = 'CTS' (60 in stock, 2 DISPATCHED).
--                      Those 62 are the ONLY slabs the dispatch grade-block
--                      refuses today. No row anywhere reads SAMPLE.
--   polish_qc          exactly 62 rows quality_grade = 'CTS', and ALL 62 also
--                      have slab_mark = 'CTS'. Every other row is FULL_SLAB.
--
-- The mark and the grade agree on every single one of the 62. That is what
-- makes moving the rule safe: after this script the same 62 slabs are refused
-- by the mark that are refused by the grade today, with no gap in between.
--
-- ─────────────────────────────────── EITHER DEPLOY ORDER IS SAFE ───────────
-- This script and the code that reads the column may land in either order.
--   * Code first, column later: readSlabForStatusChange falls back to a select
--     without slab_mark (P2022), and slabBlocksDispatch refuses on the grade
--     alone — exactly the 62 refused today.
--   * Column first, code later: the old code never selects it and behaves as
--     it does now.
-- Nothing that is refused today becomes dispatchable at any point in between.
-- That is the one failure this whole change is arranged to avoid.
--
-- ─────────────────────────────────── THE BACKFILL, BOTH WAYS ───────────────
-- Two independent UPDATEs, deliberately, though on today's data they touch
-- the same 62 rows:
--
--   (1) from polish_qc's mark — the LATEST QC row per slab number, by
--       created_time then imported_at, which is the ordering
--       autolinkFinishedSlabFromQc and scripts/0060 both use. This is the
--       real source of truth and the one that keeps working after the grade
--       write is removed.
--   (2) from fg_finished_slab's own grade — every row already reading CTS or
--       SAMPLE. This is the belt: it does not depend on a QC row existing, on
--       the mirror agreeing, or on scripts/0057 having been applied to the
--       rows in question.
--
-- Writing only (1) would make the rule depend on a coincidence that holds for
-- today's 62 and need not hold for the next slab — a slab whose fg grade says
-- CTS but whose latest QC row does not would quietly become dispatchable the
-- day the grade write goes. Nothing here may ever un-block a slab.
--
-- NOTHING IS INVENTED AND NO GRADE IS TOUCHED. The 62 slabs' original A/B/C
-- verdicts are unrecoverable — quality_grade_before_cts is NULL on all 48,377
-- polish_qc rows, it has never once been populated, and fg_slab_event holds no
-- grade field — so the owner is collecting them by hand. This script does not
-- guess at them and does not blank them.
--
-- STATUS IS NOT TOUCHED either. The 2 slabs already DISPATCHED stay
-- dispatched; that shipment happened. This only stops the next one.
--
-- IDEMPOTENT. Safe to re-run: the second run finds nothing left to change.
-- Apply after 0057.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0070-finished-slab-slab-mark.sql
--
-- THEN, and this is the part that bites: `npx prisma db push` DROPS any column
-- the schema does not declare — that is how alt_role and alt_branch were lost.
-- slabMark is declared on model FinishedSlab in prisma/schema.prisma for
-- exactly that reason. Do not remove it.
--
-- NOTE ON THE TABLE NAME: it is "fg_finished_slab" (@@map on model
-- FinishedSlab), not "finished_slab". scripts/0060 says finished_slab
-- throughout and no such relation exists on live Neon today — checked
-- 2026-09-03. Do not copy that name from it.
-- =====================================================================

BEGIN;

ALTER TABLE "fg_finished_slab"
  ADD COLUMN IF NOT EXISTS "slab_mark" TEXT NOT NULL DEFAULT 'FULL_SLAB';

COMMENT ON COLUMN "fg_finished_slab"."slab_mark" IS
  'What became of the physical slab: FULL_SLAB (whole, dispatchable), CTS '
  '(fabrication cut it) or SAMPLE (pushed to sampling). NOT a quality grade '
  '- that is grade, and the two are independent. THE DISPATCH RULE READS '
  'THIS (lib/inventory/grading.ts slabBlocksDispatch): a slab whose mark says '
  'cut cannot leave as a full slab. Mirrored from polish_qc.slab_mark. See '
  'src/lib/fab/slabMark.ts.';

-- Three words, nothing else. A typo must not create a fourth state that no
-- screen knows how to draw and, far worse on this table, that no dispatch
-- rule knows how to refuse. Same constraint as polish_qc's (scripts/0057).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fg_finished_slab_slab_mark_ck'
  ) THEN
    ALTER TABLE "fg_finished_slab"
      ADD CONSTRAINT "fg_finished_slab_slab_mark_ck"
      CHECK ("slab_mark" IN ('FULL_SLAB', 'CTS', 'SAMPLE'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- BACKFILL (1): what QC says became of the slab.
--
-- DISTINCT ON, NOT A LATERAL — the same trap scripts/0060 documents: an
-- UPDATE's target table is not in its own FROM list, so a lateral subquery
-- cannot reference fs and Postgres refuses the statement outright. DISTINCT
-- ON with this ORDER BY picks exactly the same row: one per slab_number,
-- newest first by created_time then imported_at, which is the ordering
-- autolinkFinishedSlabFromQc uses. This must agree with it, or the mirror
-- and the live path would disagree about which QC row is authoritative.
-- ---------------------------------------------------------------------
UPDATE "fg_finished_slab" fs
SET    "slab_mark" = latest.mark
FROM   (
         SELECT DISTINCT ON (q."slab_number")
                q."slab_number",
                upper(btrim(coalesce(q."slab_mark", ''))) AS mark
         FROM   "polish_qc" q
         ORDER  BY q."slab_number", q."created_time" DESC NULLS LAST, q."imported_at" DESC
       ) latest
WHERE  latest."slab_number" = fs."slab_number"
  AND  latest.mark IN ('CTS', 'SAMPLE')
  -- FULL_SLAB is the only mark that moves (src/lib/fab/slabMark.ts
  -- checkMarkTransition). A slab already marked cut is never re-marked here,
  -- so a re-run is a no-op and CTS is never overwritten with SAMPLE or the
  -- other way about.
  AND  fs."slab_mark" = 'FULL_SLAB';

-- ---------------------------------------------------------------------
-- BACKFILL (2): what this table's OWN grade already says.
--
-- Independent of (1) on purpose. Every row here is refused dispatch TODAY on
-- its grade; after this change the mark must refuse it too, whether or not a
-- QC row backs it up. All 62 live rows are caught by (1) as well — write both
-- anyway, because the code must not depend on that coincidence holding for
-- the next slab.
-- ---------------------------------------------------------------------
UPDATE "fg_finished_slab"
SET    "slab_mark" = upper(btrim("grade"))
WHERE  upper(btrim(coalesce("grade", ''))) IN ('CTS', 'SAMPLE')
  AND  "slab_mark" = 'FULL_SLAB';

-- "Which of these are still whole" is the common read — the dispatch screen,
-- the stock list and the CEO board all ask it. Partial, so the index holds
-- only the minority of rows that are not FULL_SLAB (62 of them today).
CREATE INDEX IF NOT EXISTS "fg_finished_slab_slab_mark_idx"
  ON "fg_finished_slab" ("slab_mark")
  WHERE "slab_mark" <> 'FULL_SLAB';

COMMIT;


-- =====================================================================
-- AFTERWARDS — check it landed, and that nothing was un-blocked.
-- =====================================================================

-- Expect 62 CTS and 0 SAMPLE, the rest FULL_SLAB.
-- SELECT slab_mark, count(*) AS slabs
-- FROM   fg_finished_slab
-- GROUP  BY slab_mark
-- ORDER  BY slabs DESC;

-- MUST RETURN 0 ROWS. This is the safety property of the whole change, as a
-- query: every slab refused dispatch today (by grade) is still refused
-- afterwards (by mark). A row here is a slab that just became dispatchable.
-- SELECT slab_number, grade, slab_mark, status
-- FROM   fg_finished_slab
-- WHERE  upper(btrim(coalesce(grade, ''))) IN ('CTS', 'SAMPLE')
--   AND  slab_mark = 'FULL_SLAB';

-- MUST ALSO RETURN 0 ROWS: a slab QC calls cut whose mirror still calls whole.
-- SELECT fs.slab_number, fs.slab_mark AS inventory_says, qc.slab_mark AS qc_says, fs.status
-- FROM   fg_finished_slab fs
-- JOIN   LATERAL (
--          SELECT slab_mark FROM polish_qc q
--          WHERE  q.slab_number = fs.slab_number
--          ORDER  BY q.created_time DESC NULLS LAST, q.imported_at DESC
--          LIMIT  1
--        ) qc ON TRUE
-- WHERE  qc.slab_mark IN ('CTS', 'SAMPLE')
--   AND  fs.slab_mark = 'FULL_SLAB';

-- The two facts side by side, which is the point of the exercise: the mark
-- says what became of the slab, the grade says how good the stone was. The 62
-- read "CTS / CTS" until the owner supplies their real verdicts by hand;
-- after that they should read "CTS / A", "CTS / B" and so on.
-- SELECT slab_mark, coalesce(grade, '(none)') AS verdict, count(*) AS slabs
-- FROM   fg_finished_slab
-- GROUP  BY 1, 2
-- ORDER  BY 1, 3 DESC;
