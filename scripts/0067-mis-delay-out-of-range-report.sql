-- 0066: MIS delay minutes outside 0..60 — REPORT FIRST, repair only on a decision.
--
-- NOT APPLIED. Run the SELECTs; the UPDATEs at the bottom stay commented until
-- somebody has read the rows and said what each one should have been.
--
-- WHY THIS EXISTS. Until the fix that ships with this script, the only server
-- rule on the four delay columns was `total > 60` (src/app/tables/actions.ts, on
-- create AND on edit) and coerceField() was a bare parseFloat with no floor, so
-- a MINUS figure sailed straight into the column: min="0" on the MIS sheet is
-- browser decoration, and the sheet's own guard was the same blind sum.
--
-- A negative is not a harmless typo. src/lib/shiftScore.ts SUMS these four
-- columns across the whole shift BEFORE anything in shiftScoreMath.ts clamps
-- them, so breakdown = -45 in one hour cancels a real 45-minute breakdown in
-- another; the shift then scores perfect uptime, which is a weight in the
-- incentive payout and a term in the OEE. src/lib/delayReclass.ts already
-- refuses a negative on the reclassification path for exactly this reason ("a
-- negative ... would score as bonus uptime"); createRow/saveRow now refuse one
-- on the entry path, and cap each bucket at 60 as well (an hour cannot lose more
-- than the sixty minutes it holds).
--
-- MEASURED on live Neon 2026-09-03, before the fix: mis holds 7,101 rows, and
--   * 0 rows have a negative value in any of the four columns,
--   * 0 rows have a single bucket above 60,
--   * 3 rows have a TOTAL above 60 — the same three delayReclass.ts's header
--     notes as pre-existing and deliberately left correctable.
-- So this script is expected to report NOTHING today. It is written anyway: the
-- hole was open for the whole life of the table, the check that closes it is new,
-- and the next person to ask "did anything get through?" should have the query
-- rather than have to reconstruct it.

-- 1) Negative minutes — the ones that BUY uptime. Read with the shift in view:
--    the row's own hour is only half the story, the cancelled stoppage is in
--    another hour of the same shift.
SELECT id, date, hour, production_incharge_name,
       process_delay_duration_minutes                            AS process,
       cleaning_delay_duration_minutes                           AS cleaning,
       breakdown_delay_duration_mechanical_or_electrical_minutes AS breakdown,
       powerout_delay_duration_minutes                           AS powerout
  FROM mis
 WHERE process_delay_duration_minutes < 0
    OR cleaning_delay_duration_minutes < 0
    OR breakdown_delay_duration_mechanical_or_electrical_minutes < 0
    OR powerout_delay_duration_minutes < 0
 ORDER BY date DESC NULLS LAST, hour;

-- 2) A single bucket claiming more than the hour holds.
SELECT id, date, hour, production_incharge_name,
       process_delay_duration_minutes                            AS process,
       cleaning_delay_duration_minutes                           AS cleaning,
       breakdown_delay_duration_mechanical_or_electrical_minutes AS breakdown,
       powerout_delay_duration_minutes                           AS powerout
  FROM mis
 WHERE process_delay_duration_minutes > 60
    OR cleaning_delay_duration_minutes > 60
    OR breakdown_delay_duration_mechanical_or_electrical_minutes > 60
    OR powerout_delay_duration_minutes > 60
 ORDER BY date DESC NULLS LAST, hour;

-- 3) The rows whose TOTAL exceeds 60 (3 of them on 2026-09-03). Listed for
--    completeness only — these are NOT repaired here. delayReclass.ts keeps them
--    editable on purpose, and rewriting them would be inventing a split between
--    buckets that nobody recorded.
SELECT id, date, hour, production_incharge_name,
       coalesce(process_delay_duration_minutes, 0)
     + coalesce(cleaning_delay_duration_minutes, 0)
     + coalesce(breakdown_delay_duration_mechanical_or_electrical_minutes, 0)
     + coalesce(powerout_delay_duration_minutes, 0) AS total_minutes
  FROM mis
 WHERE coalesce(process_delay_duration_minutes, 0)
     + coalesce(cleaning_delay_duration_minutes, 0)
     + coalesce(breakdown_delay_duration_mechanical_or_electrical_minutes, 0)
     + coalesce(powerout_delay_duration_minutes, 0) > 60
 ORDER BY total_minutes DESC;

-- ---------------------------------------------------------------------------
-- REPAIR — COMMENTED OUT ON PURPOSE. Zeroing a negative is a judgement, not a
-- correction: the operator meant SOMETHING by it, and only the shift that logged
-- it knows whether the minutes belong in another bucket, another hour, or
-- nowhere. Zero is the safe floor for the score (it stops the row cancelling a
-- real stoppage) and is the right answer only once someone has confirmed the
-- true figure is unrecoverable. If that decision is taken, un-comment, run
-- inside BEGIN/COMMIT, and write one fg-style audit line per row.
--
-- UPDATE mis SET process_delay_duration_minutes = 0
--  WHERE process_delay_duration_minutes < 0;
-- UPDATE mis SET cleaning_delay_duration_minutes = 0
--  WHERE cleaning_delay_duration_minutes < 0;
-- UPDATE mis SET breakdown_delay_duration_mechanical_or_electrical_minutes = 0
--  WHERE breakdown_delay_duration_mechanical_or_electrical_minutes < 0;
-- UPDATE mis SET powerout_delay_duration_minutes = 0
--  WHERE powerout_delay_duration_minutes < 0;
