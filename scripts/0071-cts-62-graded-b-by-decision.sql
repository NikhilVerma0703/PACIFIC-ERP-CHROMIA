-- 0071 — the 62 slabs whose polishing verdict was destroyed are graded B, by decision.
--
-- NOT A RECOVERY. THIS IS A DECISION, AND THE ROWS SAY SO.
--
-- Until scripts/0070 and the change that shipped with it, marking a slab CTS
-- OVERWROTE quality_grade with 'CTS'. The polishing line's verdict — A, A2, B or
-- C — was gone. quality_grade_before_cts exists to keep it and has never once
-- been populated (0 of 48,377 rows on 2026-09-03), so for these slabs it kept
-- nothing.
--
-- The verdicts are UNRECOVERABLE, and that was established before this was
-- written, not assumed:
--   * no earlier polish_qc row carries a real grade for ANY of the 62;
--   * fg_slab_event holds created / qc_update / location / dispatch for them and
--     NO grade field and NO old value.
-- Nothing in the database remembers whether they were A stone or C.
--
-- So the owner decided: grade them B. That is a judgement about how to value
-- stone nobody can re-inspect, not a measurement, and it is deliberately the
-- CONSERVATIVE one — B is worth half a slab where A is worth one, so any slab
-- that was really A is under-credited rather than over-credited. Every row gets
-- an fg_slab_event saying exactly that, so in six months the number is
-- explainable instead of mysterious.
--
-- ─────────────────────────── WHY THIS IS SAFE NOW AND WAS NOT YESTERDAY ─────
-- lib/inventory/grading.ts used to refuse dispatch on grade = 'CTS'. Running
-- this script a day ago would therefore have made all 62 DISPATCHABLE AS FULL
-- SLABS — already-cut stone, out on a lorry. It is safe today only because the
-- dispatch rule now reads the MARK as well (slabBlocksDispatch), 0070 added
-- fg_finished_slab.slab_mark, and all 63 CTS-graded rows carry slab_mark='CTS'.
-- Verified immediately before this ran: 63 CTS-graded, 63 protected by the mark,
-- 0 that would become dispatchable. THE PRE-CHECK BELOW RE-ASSERTS IT AND ABORTS
-- IF IT IS EVER UNTRUE — do not remove it.
--
-- ─────────────────────────── SCOPE: EXACTLY THE 62 ON THE OWNER'S LIST ──────
-- A 63rd slab (154757, Arva White 1413) was marked CTS while this work was in
-- progress, AFTER the list went to the owner. It is NOT in here. It has the same
-- destroyed verdict and will need the same decision, but it is his to make and
-- somebody on the floor may still remember what that slab actually graded.
--
-- ─────────────────────────── IT CHANGES THE INCENTIVE ───────────────────────
-- gradeCredit() (shiftScoreMath.ts) EXCLUDES CTS — it is a routing state, not a
-- verdict, so these slabs scored nothing for anybody. As B they are worth half a
-- good slab each. 51 of the 62 are claimed by a scored shift: 25 in Aug 2026,
-- 11 in Jun, 10 in Apr, 2 in May, 2 in Oct 2025, 1 in Nov 2025. August is the
-- month being settled, so its counted total rises by about 12.5 slabs. That is a
-- consequence of the decision, not a side effect to be hidden.
--
-- BOTH TABLES. polish_qc.quality_grade is the verdict; fg_finished_slab.grade is
-- its projection and is what inventory and dispatch read. Writing one and not the
-- other is how the two drift (see scripts/0065).
--
-- IDEMPOTENT: every UPDATE is narrowed to quality_grade = 'CTS' / grade = 'CTS',
-- so a re-run is a no-op and cannot turn a real A into a B.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0071-cts-62-graded-b-by-decision.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) THE ABORT. If any slab about to be regraded is not held by its mark, this
--    script would hand an already-cut slab to dispatch. Stop rather than do it.
DO $$
DECLARE unguarded int;
BEGIN
  SELECT count(*) INTO unguarded
    FROM "fg_finished_slab"
   WHERE upper(btrim(coalesce("grade", ''))) = 'CTS'
     AND coalesce("slab_mark", 'FULL_SLAB') NOT IN ('CTS', 'SAMPLE');
  IF unguarded > 0 THEN
    RAISE EXCEPTION
      'ABORTED: % slab(s) are graded CTS but not marked cut. Regrading them to B would make them dispatchable as full slabs. Apply scripts/0070 and its backfill first.',
      unguarded;
  END IF;
END $$;

-- The 62 on the owner's list, and nothing else.
CREATE TEMP TABLE cts62 (slab_number int PRIMARY KEY) ON COMMIT DROP;
INSERT INTO cts62 (slab_number) VALUES
  (34790),(34848),(45725),(45726),(67196),(67294),(118552),(118561),(121980),
  (136612),(136650),(136664),(136782),(136784),(136796),(136814),(136841),
  (136842),(136845),(140109),(140115),(142341),(143388),(143453),(143464),
  (143465),(143470),(143485),(143487),(143811),(143812),(143816),(143823),
  (143835),(143842),(143843),(143845),(143850),(154294),(154325),(154365),
  (154366),(154381),(154399),(154437),(154495),(154571),(154580),(154601),
  (154612),(154614),(154638),(154641),(154660),(154674),(154689),(154700),
  (154707),(154728),(154734),(154744),(154791);

-- ---------------------------------------------------------------------------
-- 1) THE VERDICT. quality_grade_before_cts is set to 'CTS' at the same time —
--    not as a recovered grade, but as an honest record that what this row held
--    before the regrade was the routing state and not a verdict. It stops a
--    future reader believing B was ever measured.
UPDATE "polish_qc" q
   SET "quality_grade"            = 'B',
       "quality_grade_before_cts" = coalesce(q."quality_grade_before_cts", 'CTS')
  FROM cts62 c
 WHERE q."slab_number" = c.slab_number
   AND upper(btrim(coalesce(q."quality_grade", ''))) = 'CTS';

-- 2) ITS PROJECTION, which is what inventory and dispatch actually read.
--    slab_mark is NOT touched: the slab is still cut, and that is the column
--    that now says so.
UPDATE "fg_finished_slab" f
   SET "grade" = 'B'
  FROM cts62 c
 WHERE f."slab_number" = c.slab_number
   AND upper(btrim(coalesce(f."grade", ''))) = 'CTS';

-- 3) ONE EVENT PER SLAB, in the slab's own history, saying this was a decision.
INSERT INTO "fg_slab_event" (id, slab_number, kind, field, old_value, new_value, changed_by, source, at)
SELECT gen_random_uuid()::text, c.slab_number, 'grade_decision', 'grade', 'CTS', 'B',
       'owner', 'scripts/0071 — verdict destroyed by the old CTS grade write and unrecoverable; graded B by decision, not measured',
       now()
  FROM cts62 c
  JOIN "fg_finished_slab" f ON f."slab_number" = c.slab_number;

-- 4) AND ONE LINE FOR THE WHOLE REPAIR.
INSERT INTO "action_log" (id, created_at, actor, kind, model, summary, payload, undone)
SELECT gen_random_uuid()::text, now(), 'owner', 'grade_decision', 'PolishQc',
       'Graded the 62 CTS slabs B by decision — their polishing verdicts were destroyed by the old CTS grade write and are unrecoverable',
       jsonb_build_object(
         'script', '0071-cts-62-graded-b-by-decision.sql',
         'slabs', (SELECT count(*) FROM cts62),
         'from', 'CTS', 'to', 'B',
         'recoverable', false,
         'note', 'Not a measurement. B chosen as the conservative value: A would over-credit. Dispatch is still refused via slab_mark=CTS.'),
       false;

COMMIT;

-- =====================================================================
-- AFTERWARDS — all three must hold.
-- =====================================================================
-- (a) None of the 62 still reads CTS in either table:
--     SELECT count(*) FROM polish_qc WHERE slab_number IN (...) AND quality_grade = 'CTS';   -- 0
--     SELECT count(*) FROM fg_finished_slab WHERE slab_number IN (...) AND grade = 'CTS';    -- 0
-- (b) THE LOAD-BEARING ONE — every one of them is still refused dispatch, now by
--     its mark instead of its grade:
--     SELECT count(*) FROM fg_finished_slab WHERE slab_number IN (...)
--       AND slab_mark NOT IN ('CTS','SAMPLE');                                               -- 0
-- (c) Slab 154757 is untouched and still reads CTS, awaiting the owner's call.
