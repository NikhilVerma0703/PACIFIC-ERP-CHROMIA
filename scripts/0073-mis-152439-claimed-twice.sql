-- 0073 — slab 152439 was claimed by two hours on 5 August 2026. One of them lets go.
--
-- THE OWNER ASKED FOR THIS, having put the two screens side by side: the CEO
-- monthly report's headline read "6,262 SLABS PRODUCED" for August while the
-- month-incentive table read "6,261 SLABS", and he asked which was right and
-- said to remove the slab from one of the two hours.
--
-- 6,261 IS RIGHT. The plant made 6,261 slabs in August 2026. The report's 6,262
-- counts one slab twice, because `made` sums what the hours DECLARED and two
-- consecutive hours declared the same number:
--
--     10 - 11    152409 -> 152423   width 15
--     11 - 12    152424 -> 152439   width 16   <-- the outlier
--     12 - 13    152439 -> 152448   width 10
--     13 - 14    152449 -> 152463   width 15
--
-- Measured by expanding every August MIS range with generate_series: EXACTLY
-- ONE slab number in the whole month is claimed by two hours, and this is it.
--
-- ─────────────────────────── WHY 11-12 IS THE ONE THAT IS WRONG ─────────────
-- Either row could have been trimmed and the duplicate would be gone; the
-- owner said either. This one is chosen on evidence, not by coin toss:
--
--   * EVERY complete hour on 5 August declares exactly 15 slabs, against a
--     recorded standard of 15/hr. All 23 rows of that day are contiguous —
--     each starts exactly one after the previous one ends — and 11-12's width
--     of 16 is the ONLY anomalous width in the day. A width of 15 conforms; 16
--     exceeds the standard the same row records. So the END was typed one too
--     high, and 12-13 correctly began at the next number.
--   * The alternative (moving 12-13 up to 152440) would leave 11-12 at an
--     unexplained 16 and push 12-13 down to 9. This way 11-12 becomes 15 like
--     every other hour and 12-13 is untouched at 10.
--   * The jot table has real per-slab timestamps and they do NOT decide it:
--     152438 at 14:24, 152439 at 14:28, 152440 at 14:32 — an even four-minute
--     run with no discontinuity at the boundary. Jot is downstream of pressing,
--     so it cannot name the press hour. Checked rather than assumed; press
--     .created_time is NULL for all of these rows.
--
-- ─────────────────────────── WHAT THIS DOES NOT TOUCH ───────────────────────
-- THE INCENTIVE DOES NOT MOVE, AND THAT IS MEASURED, NOT HOPED. Both hours are
-- 11-12 and 12-13 IST, so BOTH fall inside shift A (06:00-14:00). claimedByMonth
-- keys its double-claim test on the SHIFT, not the row, so two rows of one shift
-- claiming one slab was never contested and 152439 was already counted exactly
-- once in the 6,261. After this it is still claimed once, by the same shift, with
-- the same design and batch. No shift's count, credit, share or pool changes.
--
-- WHAT DOES MOVE, and it is the point: the CEO report's August `made` goes
-- 6,262 -> 6,261 and now equals its own distinct-slab count, so the six grade
-- columns add across to the Slabs cell beside them and the two screens agree.
-- Achievement moves 84.2% -> 84.2% (6,261/7,439 = 84.16%, 6,262/7,439 = 84.18%);
-- the 5 August day row goes 322 -> 321 and its own achievement with it.
--
-- ─────────────────────────── CORRECTED AFTER THE FACT ───────────────────────
-- THE DAY FIGURE ON THE LINE ABOVE WAS WRONG, AND THIS SCRIPT HAD ALREADY RUN.
-- It said the day fell from 313 to 312, and no reading of the data produces
-- either number; the figure was asserted, never measured. Measured on live Neon
-- 2026-09-03, after the trim:
--   * the REPORT DAY — 06:00 5 Aug to 06:00 6 Aug IST, the window every figure
--     on these screens uses — holds 24 filed hours and reads
--     getDailyReport('2026-08-05').day = {made 321, target 345, pct 93.04}; the
--     CEO monthly's 2026-08-05 row reads the same 321.
--   * before this trim the same day read 322. One hour narrowed by one slab,
--     so the day moved by exactly one.
--   * the MIS CALENDAR-LABEL day (00:00-24:00 IST, off the `date` column) is a
--     different question with a different answer, 325. Neither is 312 or 313.
-- Re-derive rather than quoting any of these — MIS rows can still be edited:
--   npx tsx scripts/check-monthly-vs-daily.mts 2026-08
--
-- AND THE POINT OF LEAVING THIS NOTE HERE: a sentence in an applied script is
-- not true merely because the script ran. The action_log payload below
-- ('august_made', '6262 -> 6261') was measured and is right; the day figure
-- printed beside it in prose was not, and it survived review because it sat in
-- a script whose SQL was correct. Measure the numbers in the comment too.
--
-- ONE ROW, ONE COLUMN. The design, batch, standard, delays, crew and timestamp
-- are all untouched — the only thing wrong with this row is the last slab
-- number on it.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0073-mis-152439-claimed-twice.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) THE ABORT. Refuse unless the row is EXACTLY as it was measured. If
--    somebody has already corrected it, or the id has moved, this script must
--    do nothing rather than trim a range that is now correct — a second run
--    would otherwise eat slab 152438 as well.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM "mis"
   WHERE "id" = 'cmsfrirzm0000jb0b4q05pgva'
     AND "hour" = '11 - 12'
     AND "starting_slab_number" = 152424
     AND "ending_slab_number"   = 152439;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'ABORTED: the 11-12 row of 2026-08-05 is not the 152424-152439 row this script was written against (matched % rows). Re-measure before trimming anything.', n;
  END IF;

  -- And the other half of the pair must still be there, or the premise is gone.
  SELECT count(*) INTO n
    FROM "mis"
   WHERE "id" = 'cmsfsd0w5000njw04634k8fap'
     AND "starting_slab_number" = 152439;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'ABORTED: the 12-13 row no longer starts at 152439, so there is no duplicate claim to resolve.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) THE TRIM. 152424-152439 becomes 152424-152438: fifteen slabs, like every
--    other complete hour of that day.
UPDATE "mis"
   SET "ending_slab_number" = 152438
 WHERE "id" = 'cmsfrirzm0000jb0b4q05pgva'
   AND "starting_slab_number" = 152424
   AND "ending_slab_number"   = 152439;

-- ---------------------------------------------------------------------------
-- 2) THE RECORD. A production figure the owner reads changed, so the reason is
--    written down where the rest of the repairs are.
INSERT INTO "action_log" (id, created_at, actor, kind, model, summary, payload, undone)
VALUES (gen_random_uuid()::text, now(), 'owner', 'mis_correction', 'Mis',
        'Trimmed the 11-12 hour of 2026-08-05 from 152424-152439 to 152424-152438 — slab 152439 was claimed by two consecutive hours',
        jsonb_build_object(
          'script', '0073-mis-152439-claimed-twice.sql',
          'mis_id', 'cmsfrirzm0000jb0b4q05pgva',
          'hour', '11 - 12', 'day', '2026-08-05',
          'from', '152424-152439', 'to', '152424-152438',
          'slab', 152439,
          'also_claimed_by', '12 - 13 (152439-152448), left untouched',
          'why', 'Every complete hour of that day declares 15 slabs at std 15 and all 23 rows are contiguous; width 16 was the only anomaly in the day, so the END was one too high.',
          'august_made', '6262 -> 6261, now equal to the distinct slab count',
          'incentive_effect', 'none — both hours are in shift A, so the slab was never contested and was already counted once'),
        false);

COMMIT;

-- =====================================================================
-- AFTERWARDS — all must hold.
-- =====================================================================
-- (a) No slab number in August 2026 is claimed by two hours any more. Zero rows:
--     WITH r AS (SELECT generate_series(starting_slab_number::int, ending_slab_number::int) sn
--                  FROM mis
--                 WHERE date_and_time >= '2026-08-01T00:30:00Z'
--                   AND date_and_time <  '2026-09-01T00:30:00Z'
--                   AND starting_slab_number > 0
--                   AND ending_slab_number >= starting_slab_number
--                   AND ending_slab_number - starting_slab_number < 60
--                   AND hour IS NOT NULL AND btrim(hour) <> '')
--     SELECT sn, count(*) FROM r GROUP BY sn HAVING count(*) > 1;
--
-- (b) The CEO report and the incentive screen now agree on August:
--     npx tsx scripts/verify-grade-columns.mts 2026-08
--     -> made 6,261 = distinct 6,261 = the incentive's claimed 6,261, and the
--        mix table's grade columns add across to the Slabs cell.
--
-- (c) The day still reconciles: sum(mix.made) === r.made, and the 5 August
--     REPORT day (06:00-06:00 IST) reads one slab below whatever it read before
--     this ran — 321 against 322 when checked on 2026-09-03. This checklist
--     said "312", which nothing produces; see CORRECTED AFTER THE FACT above.
--     Derive it, do not quote it:
--     npx tsx scripts/check-monthly-vs-daily.mts 2026-08
--
-- (d) NOTHING in the incentive moved: /scoreboard/incentive?month=2026-08 still
--     reads 6,261 claimed, the same shift A count, the same pool.
--
-- AND THE STANDING POINT, which outlives this one row: a duplicate claim is a
-- DATA fault, not a reporting one, and the report can only ever disclose it.
-- The entry form should refuse a range that overlaps a range already declared
-- by another hour of the same day — that is the fix that stops the next one.
