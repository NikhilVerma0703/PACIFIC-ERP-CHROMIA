-- 0026 — Re-date the auto-added placeholder rows that carry their RECTIFY date.
--
-- WHAT WENT WRONG
--   autoFillBatch() stamped `date = now()` on every placeholder it created. So a batch
--   rectified days after it ran has placeholders dated the rectify day. All 1,394 of them
--   land inside the last 30 days by construction, which pollutes every date-bucketed
--   number: "Pressed today", the dashboard's 30-day thickness card, Recent Batches, and
--   the downtime / daily Telegram reports.
--   (The code no longer does this — placeholders now inherit the slab's own date.
--    This script fixes the rows created BEFORE that change.)
--
-- WHAT THIS DOES
--   For every auto-added row (remarks LIKE '⚙ auto-added%'), set `date` to the date of
--   the SAME SLAB's real row at another station — press > distributor > kreos > oven > jot.
--   Per slab, not per batch: batches routinely span 2-3 days.
--
-- SAFETY RULES (this data is dirty — these are not optional)
--   1. Only REAL rows are a source. Other placeholders are excluded, so a wrong date
--      cannot be copied forward.
--   2. A source date must be PLAUSIBLE: within 14 days of the batch's latest real date.
--      The DB contains year-typos — batch 1360 has 396 press rows dated 2025-06-26/27
--      (366 days off), 1375 has 134, 1359 has 47, and there is a stray 2023-04-13.
--      Real batches span 0-8 days, so 14 days is generous. Without this guard the typos
--      would be copied onto placeholders and shift 200+ slabs a year into the past.
--   3. Rows with NO plausible source are LEFT ALONE — never guessed at. (63 rows, all
--      batch 1359, whose only source dates are the 2025 typos.)
--   4. `date` only. `created_time` is deliberately NOT touched on existing rows: it is
--      the tie-break key for de-duplication (rectifyDuplicates keeps the latest row), and
--      back-filling it could make a placeholder outrank a real row.
--   5. Every changed row is snapshotted first, so this is fully reversible (see the
--      rollback at the bottom).
--
-- EXPECTED (rehearsed against live data on 2026-07-14 inside a rolled-back transaction):
--   press       143 rows -> 143 re-dated,   0 skipped
--   distributor 211 rows -> 190 re-dated,  21 skipped
--   kreos         0 rows
--   oven        684 rows -> 663 re-dated,  21 skipped
--   jot         356 rows -> 335 re-dated,  21 skipped
--   TOTAL      1394 rows -> 1331 re-dated, 63 skipped (all batch 1359)
--
--   1,249 of those move to a different DAY. The other 82 are already on the right day and
--   only have their time-of-day aligned to the real row's midnight (placeholders carry the
--   rectify clock-time; real rows are date-only). Harmless, and it makes them identical.
--
-- SEPARATE PROBLEM, NOT FIXED HERE: the year-typos themselves (batches 1359, 1360, 1375,
-- 1348, 1280 …). Those are REAL rows with wrong dates and need a human decision — this
-- script only refuses to propagate them.
--
-- Run it as one transaction. Read the counts it prints BEFORE you COMMIT.

BEGIN;

-- ---------------------------------------------------------------- snapshot (rollback data)
CREATE TABLE IF NOT EXISTS autofill_date_backup_0026 (
  station    text        NOT NULL,
  row_id     text        NOT NULL,
  batch_key  text,
  slab_number double precision,
  old_date   timestamp,
  new_date   timestamp,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station, row_id)
);

-- ---------------------------------------------------------------- the plausible source date, per slab
CREATE TEMP VIEW _real_rows AS
  SELECT batch_key, slab_number::float8 AS s, date, 1 AS pr FROM press        WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 2 FROM distributor WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 3 FROM kreos       WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 4 FROM oven        WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 5 FROM jot         WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL;

CREATE TEMP VIEW _ok AS                    -- real, dated, not future-dated (+2d grace)
  SELECT * FROM _real_rows WHERE date <= now() + interval '2 days' AND batch_key IS NOT NULL;

CREATE TEMP VIEW _batch_max AS
  SELECT batch_key, max(date) AS m FROM _ok GROUP BY 1;

CREATE TEMP VIEW _plausible AS             -- RULE 2: drop the year-typos
  SELECT o.* FROM _ok o JOIN _batch_max b ON b.batch_key = o.batch_key
  WHERE b.m::date - o.date::date <= 14;

CREATE TEMP VIEW _by_slab AS               -- the slab's own date, highest-priority station wins
  SELECT DISTINCT ON (batch_key, s) batch_key, s, date
  FROM _plausible WHERE s IS NOT NULL
  ORDER BY batch_key, s, pr, date;

-- ---------------------------------------------------------------- dry run: read this before committing
SELECT 'press' station, count(*) FILTER (WHERE b.date IS NOT NULL AND b.date <> a.date) AS will_change,
       count(*) FILTER (WHERE b.date = a.date) AS already_right,
       count(*) FILTER (WHERE b.date IS NULL)  AS left_alone
  FROM press a LEFT JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%'
UNION ALL
SELECT 'distributor', count(*) FILTER (WHERE b.date IS NOT NULL AND b.date <> a.date),
       count(*) FILTER (WHERE b.date = a.date), count(*) FILTER (WHERE b.date IS NULL)
  FROM distributor a LEFT JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%'
UNION ALL
SELECT 'kreos', count(*) FILTER (WHERE b.date IS NOT NULL AND b.date <> a.date),
       count(*) FILTER (WHERE b.date = a.date), count(*) FILTER (WHERE b.date IS NULL)
  FROM kreos a LEFT JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%'
UNION ALL
SELECT 'oven', count(*) FILTER (WHERE b.date IS NOT NULL AND b.date <> a.date),
       count(*) FILTER (WHERE b.date = a.date), count(*) FILTER (WHERE b.date IS NULL)
  FROM oven a LEFT JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%'
UNION ALL
SELECT 'jot', count(*) FILTER (WHERE b.date IS NOT NULL AND b.date <> a.date),
       count(*) FILTER (WHERE b.date = a.date), count(*) FILTER (WHERE b.date IS NULL)
  FROM jot a LEFT JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%';

-- ---------------------------------------------------------------- snapshot + update, per station
-- press
INSERT INTO autofill_date_backup_0026 (station, row_id, batch_key, slab_number, old_date, new_date)
SELECT 'press', a.id, a.batch_key, a.slab_number, a.date, b.date
  FROM press a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE press a SET date = b.date
  FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

-- distributor
INSERT INTO autofill_date_backup_0026 (station, row_id, batch_key, slab_number, old_date, new_date)
SELECT 'distributor', a.id, a.batch_key, a.slab_number, a.date, b.date
  FROM distributor a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE distributor a SET date = b.date
  FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

-- kreos (0 rows today; kept so the script is complete)
INSERT INTO autofill_date_backup_0026 (station, row_id, batch_key, slab_number, old_date, new_date)
SELECT 'kreos', a.id, a.batch_key, a.slab_number, a.date, b.date
  FROM kreos a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE kreos a SET date = b.date
  FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

-- oven
INSERT INTO autofill_date_backup_0026 (station, row_id, batch_key, slab_number, old_date, new_date)
SELECT 'oven', a.id, a.batch_key, a.slab_number, a.date, b.date
  FROM oven a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE oven a SET date = b.date
  FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

-- jot
INSERT INTO autofill_date_backup_0026 (station, row_id, batch_key, slab_number, old_date, new_date)
SELECT 'jot', a.id, a.batch_key, a.slab_number, a.date, b.date
  FROM jot a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE jot a SET date = b.date
  FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

-- ---------------------------------------------------------------- verify, then COMMIT
-- how many rows were touched, and does anything still sit on a rectify date?
SELECT station, count(*) AS rows_changed, min(old_date)::date AS oldest_old, max(old_date)::date AS newest_old
  FROM autofill_date_backup_0026 GROUP BY 1 ORDER BY 1;

-- sanity: no placeholder should now be dated in the future, and none before 2026 unless it
-- was already (we never copy a typo). Expect 0 rows.
SELECT 'FUTURE-DATED PLACEHOLDER' AS problem, station, count(*)
  FROM autofill_date_backup_0026 WHERE new_date > now() + interval '2 days' GROUP BY 1,2;

COMMIT;

-- ================================================================ ROLLBACK (if needed)
-- Restores every row this script changed, exactly:
--
-- BEGIN;
-- UPDATE press       a SET date = b.old_date FROM autofill_date_backup_0026 b WHERE b.station = 'press'       AND b.row_id = a.id;
-- UPDATE distributor a SET date = b.old_date FROM autofill_date_backup_0026 b WHERE b.station = 'distributor' AND b.row_id = a.id;
-- UPDATE kreos       a SET date = b.old_date FROM autofill_date_backup_0026 b WHERE b.station = 'kreos'       AND b.row_id = a.id;
-- UPDATE oven        a SET date = b.old_date FROM autofill_date_backup_0026 b WHERE b.station = 'oven'        AND b.row_id = a.id;
-- UPDATE jot         a SET date = b.old_date FROM autofill_date_backup_0026 b WHERE b.station = 'jot'         AND b.row_id = a.id;
-- COMMIT;
--
-- The backup table is kept on purpose. Drop it only once you're satisfied:
--   DROP TABLE autofill_date_backup_0026;
