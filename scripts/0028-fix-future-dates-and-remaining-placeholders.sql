-- 0028 — The last of the bad production dates: the FUTURE-dated typos, and the 63
--        placeholders that 0026 correctly refused to guess at.
--
-- Same root cause as 0027 (operator typed the wrong year/month on the entry form, nothing
-- validated it). These two groups point FORWARD instead of backward, so 0027's "+1 year"
-- rule did not catch them. The new dateSanity() guard in src/app/tables/actions.ts now
-- rejects both shapes at the door — a future date is refused outright.
--
-- PART A — press, batch 1348: 3 rows dated 2030-06-15 -> 2026-06-15
--   Entered 2026-06-16. The batch's other 102 press rows are all 2026-06-15. Year typo.
--
-- PART B — kreos, batch 1370: 89 rows dated 2026-08-01 -> 2026-07-01
--   Entered 2026-07-02. Month typo: the batch's other 57 kreos rows AND all 146 of its
--   press rows say 2026-07-01, and 2026-08-01 has not happened yet.
--
-- PART C — the 63 placeholders on batch 1359 that 0026 left alone.
--   0026 refused them because 1359's only source dates were the 2025 typos. 0027 has now
--   corrected those, so the same per-slab rule finally has a plausible source to copy.
--   This is exactly 0026's logic, re-applied to the rows it skipped.
--
-- Reversible: snapshotted into date_fix_backup_0028.

BEGIN;

CREATE TABLE IF NOT EXISTS date_fix_backup_0028 (
  station      text NOT NULL,
  row_id       text NOT NULL,
  batch_key    text,
  slab_number  double precision,
  old_date     timestamp,
  new_date     timestamp,
  part         text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station, row_id)
);

-- ---------------------------------------------------------------- PART A: press 1348
INSERT INTO date_fix_backup_0028 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'press', id, batch_key, slab_number, date, TIMESTAMP '2026-06-15 00:00:00', 'A'
  FROM press
 WHERE batch_key = '1348' AND date::date = DATE '2030-06-15'
   AND (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%')
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE press p SET date = b.new_date
  FROM date_fix_backup_0028 b
 WHERE b.station = 'press' AND b.part = 'A' AND b.row_id = p.id;

-- ---------------------------------------------------------------- PART B: kreos 1370
INSERT INTO date_fix_backup_0028 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'kreos', id, batch_key, slab_number, date, TIMESTAMP '2026-07-01 00:00:00', 'B'
  FROM kreos
 WHERE batch_key = '1370' AND date::date = DATE '2026-08-01'
   AND (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%')
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE kreos k SET date = b.new_date
  FROM date_fix_backup_0028 b
 WHERE b.station = 'kreos' AND b.part = 'B' AND b.row_id = k.id;

-- ---------------------------------------------------------------- PART C: 0026's leftovers
-- (identical rule to 0026: the slab's own real row, plausible = within 14 days of the
--  batch's latest real date; anything without a plausible source is still left alone)
CREATE TEMP VIEW _real AS
  SELECT batch_key, slab_number::float8 AS s, date, 1 AS pr FROM press        WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 2 FROM distributor WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 3 FROM kreos       WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 4 FROM oven        WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL
  UNION ALL SELECT batch_key, slab_number::float8, date, 5 FROM jot         WHERE (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%') AND date IS NOT NULL;

CREATE TEMP VIEW _ok AS
  SELECT * FROM _real WHERE date <= now() + interval '2 days' AND batch_key IS NOT NULL;

CREATE TEMP VIEW _plausible AS
  SELECT o.* FROM _ok o
  JOIN (SELECT batch_key, max(date) m FROM _ok GROUP BY 1) b ON b.batch_key = o.batch_key
  WHERE b.m::date - o.date::date <= 14;

CREATE TEMP VIEW _by_slab AS
  SELECT DISTINCT ON (batch_key, s) batch_key, s, date FROM _plausible WHERE s IS NOT NULL
  ORDER BY batch_key, s, pr, date;

INSERT INTO date_fix_backup_0028 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'distributor', a.id, a.batch_key, a.slab_number, a.date, b.date, 'C'
  FROM distributor a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE distributor a SET date = b.date FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

INSERT INTO date_fix_backup_0028 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'oven', a.id, a.batch_key, a.slab_number, a.date, b.date, 'C'
  FROM oven a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE oven a SET date = b.date FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

INSERT INTO date_fix_backup_0028 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'jot', a.id, a.batch_key, a.slab_number, a.date, b.date, 'C'
  FROM jot a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE jot a SET date = b.date FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

INSERT INTO date_fix_backup_0028 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'press', a.id, a.batch_key, a.slab_number, a.date, b.date, 'C'
  FROM press a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE press a SET date = b.date FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

INSERT INTO date_fix_backup_0028 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'kreos', a.id, a.batch_key, a.slab_number, a.date, b.date, 'C'
  FROM kreos a JOIN _by_slab b ON b.batch_key = a.batch_key AND b.s = a.slab_number::float8
 WHERE a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE kreos a SET date = b.date FROM _by_slab b
 WHERE b.batch_key = a.batch_key AND b.s = a.slab_number::float8
   AND a.remarks LIKE '⚙ auto-added%' AND a.date IS DISTINCT FROM b.date;

-- ---------------------------------------------------------------- verify, then COMMIT
SELECT part, station, count(*) AS rows_changed FROM date_fix_backup_0028 GROUP BY 1,2 ORDER BY 1,2;

-- Must be 0: nothing anywhere still dated in the future.
SELECT 'press' AS station, count(*) AS future FROM press WHERE date > now() + interval '2 days'
UNION ALL SELECT 'kreos', count(*) FROM kreos WHERE date > now() + interval '2 days'
UNION ALL SELECT 'oven',  count(*) FROM oven  WHERE date > now() + interval '2 days'
UNION ALL SELECT 'jot',   count(*) FROM jot   WHERE date > now() + interval '2 days'
UNION ALL SELECT 'distributor', count(*) FROM distributor WHERE date > now() + interval '2 days';

COMMIT;

-- ================================================================ ROLLBACK (if needed)
-- BEGIN;
-- UPDATE press       a SET date = b.old_date FROM date_fix_backup_0028 b WHERE b.station = 'press'       AND b.row_id = a.id;
-- UPDATE distributor a SET date = b.old_date FROM date_fix_backup_0028 b WHERE b.station = 'distributor' AND b.row_id = a.id;
-- UPDATE kreos       a SET date = b.old_date FROM date_fix_backup_0028 b WHERE b.station = 'kreos'       AND b.row_id = a.id;
-- UPDATE oven        a SET date = b.old_date FROM date_fix_backup_0028 b WHERE b.station = 'oven'        AND b.row_id = a.id;
-- UPDATE jot         a SET date = b.old_date FROM date_fix_backup_0028 b WHERE b.station = 'jot'         AND b.row_id = a.id;
-- COMMIT;
--
-- Keep the backup table until you're satisfied:  DROP TABLE date_fix_backup_0028;
