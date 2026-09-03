-- 0072 — slab 154757 graded B, by decision. The 63rd, and the last of them.
--
-- THE SAME DECISION AS scripts/0071, on the one slab that script deliberately
-- left out. Read 0071's header first; everything it says about why these
-- verdicts are unrecoverable, why B is the conservative value, and why this is a
-- decision rather than a measurement applies here unchanged.
--
-- ─────────────────────────── WHY IT WAS HELD BACK, AND WHY IT NO LONGER IS ──
-- 154757 (Arva White, batch 1413) was marked CTS on 2026-09-03 while the CTS
-- work was in progress — AFTER the list of 62 had gone to the owner. It was left
-- out of 0071 on purpose: it had been cut that same day, so somebody on the floor
-- might still have remembered what it actually graded, and a remembered verdict
-- beats a default. The owner has now made the same call for it. So it is B, on
-- his instruction, and for the same stated reason.
--
-- ITS VERDICT WAS DESTROYED THE SAME WAY, and that is the part worth recording:
-- quality_grade_before_cts was NULL for it too, on a row written the day the
-- preservation was supposed to be working. That is the evidence that the
-- preservation still had not fired at that moment — the fix was pushed but not
-- yet deployed — and it is why the root cause is still open after this script.
--
-- ─────────────────────────── SAFE, AND CHECKED THREE WAYS ───────────────────
-- Regrading away from CTS is only safe because dispatch no longer depends on the
-- grade. This slab is held by:
--   * polish_qc.slab_mark        = 'CTS'
--   * fg_finished_slab.slab_mark = 'CTS'   <- what slabBlocksDispatch reads
--   * fg_finished_slab.status    = 'CTS'   <- and CTS is not in TRANSITIONS.dispatch.from
-- Any one of those refuses it. The abort below re-asserts the mark and stops the
-- script rather than risk handing already-cut stone to a lorry.
--
-- INCENTIVE: this slab is claimed by an August 2026 shift (the hour that claimed
-- 154746-154757), so August's counted total rises by half a slab (CTS scores
-- nothing; B is worth 0.5).
--
-- AUGUST, ONCE, IN ONE PLACE — added 2026-09-03, after both scripts had run.
-- 0071's header originally counted this slab in ITS August figure too ("25 in
-- Aug 2026 ... about 12.5 slabs"), and then this line added the same half slab
-- again: 13.0 slabs disclosed where the truth is 12.5. Only 24 of 0071's 62 fall
-- in August by COALESCE(created_time, imported_at); 154757 is the 25th and it is
-- this script's. 0071's header now reads 24 slabs / 12 slabs of credit, so:
--
--     AUGUST 2026 RISES BY 12.5 SLABS ACROSS THE TWO SCRIPTS — 12 from 0071's
--     24 August slabs and 0.5 from this one. That is the whole figure; do not
--     add the two headers together again.
--
-- THE UPDATES ARE IDEMPOTENT. THE SCRIPT IS NOT — same correction as 0071's
-- header carries, and for the same reason. Steps 1 and 2 are narrowed to
-- quality_grade / grade = 'CTS', so a re-run changes no grade. Step 3's event
-- insert is gated on the finished-goods row EXISTING, not on the update having
-- changed anything, and step 4 is an unconditional VALUES — so a re-run today
-- would add a second 'grade_decision' event claiming a CTS -> B transition that
-- did not happen, plus another action_log line, and the slab's history would
-- assert a fiction. The live trail is correct as it stands (one event for
-- 154757, checked 2026-09-03). DO NOT RE-RUN. A future script of this shape
-- must gate its inserts on rows actually updated.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0072-cts-154757-graded-b-by-decision.sql

BEGIN;

-- 0) THE ABORT — the same one 0071 carries, for the same reason.
DO $$
DECLARE unguarded int;
BEGIN
  SELECT count(*) INTO unguarded
    FROM "fg_finished_slab"
   WHERE "slab_number" = 154757
     AND upper(btrim(coalesce("grade", ''))) = 'CTS'
     AND coalesce("slab_mark", 'FULL_SLAB') NOT IN ('CTS', 'SAMPLE');
  IF unguarded > 0 THEN
    RAISE EXCEPTION
      'ABORTED: slab 154757 is graded CTS but not marked cut. Regrading it to B would make it dispatchable as a full slab.';
  END IF;
END $$;

-- 1) The verdict. before_cts records what was actually there — the routing
--    state, not a grade — so nobody later reads B as something that was measured.
UPDATE "polish_qc"
   SET "quality_grade"            = 'B',
       "quality_grade_before_cts" = coalesce("quality_grade_before_cts", 'CTS')
 WHERE "slab_number" = 154757
   AND upper(btrim(coalesce("quality_grade", ''))) = 'CTS';

-- 2) Its projection. slab_mark and status are untouched: the slab is still cut,
--    and those are the columns that say so.
UPDATE "fg_finished_slab"
   SET "grade" = 'B'
 WHERE "slab_number" = 154757
   AND upper(btrim(coalesce("grade", ''))) = 'CTS';

-- 3) The slab's own history.
INSERT INTO "fg_slab_event" (id, slab_number, kind, field, old_value, new_value, changed_by, source, at)
SELECT gen_random_uuid()::text, 154757, 'grade_decision', 'grade', 'CTS', 'B',
       'owner', 'scripts/0072 — verdict destroyed by the old CTS grade write and unrecoverable; graded B by decision, not measured. Held back from 0071 in case the floor remembered it; the owner decided B.',
       now()
 WHERE EXISTS (SELECT 1 FROM "fg_finished_slab" WHERE "slab_number" = 154757);

-- 4) And the repair line.
INSERT INTO "action_log" (id, created_at, actor, kind, model, summary, payload, undone)
VALUES (gen_random_uuid()::text, now(), 'owner', 'grade_decision', 'PolishQc',
        'Graded slab 154757 B by decision — the 63rd CTS slab, held back from scripts/0071 and settled the same way',
        jsonb_build_object(
          'script', '0072-cts-154757-graded-b-by-decision.sql',
          'slabs', 1, 'slab_number', 154757,
          'from', 'CTS', 'to', 'B',
          'recoverable', false,
          'note', 'Not a measurement. Marked CTS 2026-09-03 with quality_grade_before_cts still NULL, which is the evidence the preservation had not yet deployed. Dispatch still refused via slab_mark and status.'),
        false);

COMMIT;

-- =====================================================================
-- AFTERWARDS — all must hold.
-- =====================================================================
-- (a) No slab anywhere is graded CTS any more:
--     SELECT count(*) FROM polish_qc        WHERE quality_grade = 'CTS';   -- 0
--     SELECT count(*) FROM fg_finished_slab WHERE grade         = 'CTS';   -- 0
-- (b) 154757 is still refused dispatch, by mark and by status:
--     SELECT slab_mark, status FROM fg_finished_slab WHERE slab_number = 154757;  -- CTS, CTS
-- (c) From here, a slab graded CTS is a REGRESSION — it means something is still
--     writing the routing state into the verdict. That query is the standing
--     check on whether the root cause is really closed.
