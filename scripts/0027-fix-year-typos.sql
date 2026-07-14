-- 0027 — Correct the operator-entered YEAR typos on production dates.
--
-- ROOT CAUSE (established from the data, not guessed):
--   Every bad row was created through the ERP entry form by a real user ("airtableId" is a
--   local id, entered_by_user_id is set), on the very day the slabs were produced — but with
--   the PREVIOUS YEAR typed in the date field. Right month, right day, wrong year. Nothing
--   validated it: coerceField() in src/lib/tables.ts simply does `new Date(s)` and stores
--   whatever parses. Because press rows are entered slab-by-slab, one wrong year rode
--   through an entire shift — 208 rows in a single sitting on batch 1360.
--   Proof, per group: date + 1 year lands within ±2 days of imported_at (the real entry
--   moment) in EVERY case. That is what makes the correction safe rather than a guess.
--
--   The entry form now refuses these: src/app/tables/actions.ts dateSanity() blocks any
--   production date that is in the future, or that sits more than 21 days from its batch's
--   latest real entry (a year typo is 365 days out), or — on a brand-new batch — is more
--   than 90 days old. So this script is a one-off cleanup, not a recurring chore.
--
-- PART A — 603 ERP-entered rows, shifted forward exactly 1 year:
--   press 1360  2025-06-26 x208, 2025-06-27 x188
--   press 1375  2025-07-07 x134
--   press 1359  2025-06-25 x47
--   jot   1348  2025-06-17 x26
--   Rule: only rows where (date + 1 year) lands within ±2 days of imported_at. Anything
--   that does not satisfy that is left alone.
--
-- PART B — 5 single rows that came in from Airtable with a bad month or year. Each one's
--   true date is pinned by BOTH its Airtable created_time and the rest of its batch, so
--   they are fixed individually rather than by a clever rule:
--     1281  2026-10-15 -> 2026-04-15   (month typo; batch ran 04-13..04-16, created 04-15)
--     1194  2028-12-28 -> 2025-12-28   (year typo; 42 sibling rows on 2025-12-28)
--     1189  2025-04-23 -> 2025-12-23   (month typo; batch ran 12-22..12-24, created 12-23)
--     1280  2023-04-13 -> 2026-04-13   (year typo; batch ran 04-09..04-13, created 04-13)
--     1143  2025-05-19 -> 2025-11-19   (month typo; batch ran 11-18..11-19, created 11-19)
--
-- NOT TOUCHED: anything that isn't provably one of the above. Auto-added placeholders were
-- already handled by 0026 and are excluded here.
--
-- Reversible: every changed row is snapshotted into year_typo_backup_0027 first.

BEGIN;

CREATE TABLE IF NOT EXISTS year_typo_backup_0027 (
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

-- ---------------------------------------------------------------- PART A: +1 year
-- press
INSERT INTO year_typo_backup_0027 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'press', id, batch_key, slab_number, date, date + interval '1 year', 'A'
  FROM press
 WHERE "airtableId" NOT LIKE 'rec%' AND date IS NOT NULL
   AND (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%')
   AND imported_at::date - date::date > 30
   AND (date + interval '1 year')::date BETWEEN imported_at::date - 2 AND imported_at::date + 2
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE press SET date = date + interval '1 year'
 WHERE id IN (SELECT row_id FROM year_typo_backup_0027 WHERE station = 'press' AND part = 'A');

-- jot
INSERT INTO year_typo_backup_0027 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'jot', id, batch_key, slab_number, date, date + interval '1 year', 'A'
  FROM jot
 WHERE "airtableId" NOT LIKE 'rec%' AND date IS NOT NULL
   AND (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%')
   AND imported_at::date - date::date > 30
   AND (date + interval '1 year')::date BETWEEN imported_at::date - 2 AND imported_at::date + 2
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE jot SET date = date + interval '1 year'
 WHERE id IN (SELECT row_id FROM year_typo_backup_0027 WHERE station = 'jot' AND part = 'A');

-- the other three stations: same rule, expected to match 0 rows today (kept so the script
-- is complete and safe to re-run)
INSERT INTO year_typo_backup_0027 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'distributor', id, batch_key, slab_number, date, date + interval '1 year', 'A'
  FROM distributor
 WHERE "airtableId" NOT LIKE 'rec%' AND date IS NOT NULL
   AND (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%')
   AND imported_at::date - date::date > 30
   AND (date + interval '1 year')::date BETWEEN imported_at::date - 2 AND imported_at::date + 2
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE distributor SET date = date + interval '1 year'
 WHERE id IN (SELECT row_id FROM year_typo_backup_0027 WHERE station = 'distributor' AND part = 'A');

INSERT INTO year_typo_backup_0027 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'kreos', id, batch_key, slab_number, date, date + interval '1 year', 'A'
  FROM kreos
 WHERE "airtableId" NOT LIKE 'rec%' AND date IS NOT NULL
   AND (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%')
   AND imported_at::date - date::date > 30
   AND (date + interval '1 year')::date BETWEEN imported_at::date - 2 AND imported_at::date + 2
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE kreos SET date = date + interval '1 year'
 WHERE id IN (SELECT row_id FROM year_typo_backup_0027 WHERE station = 'kreos' AND part = 'A');

INSERT INTO year_typo_backup_0027 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'oven', id, batch_key, slab_number, date, date + interval '1 year', 'A'
  FROM oven
 WHERE "airtableId" NOT LIKE 'rec%' AND date IS NOT NULL
   AND (remarks IS NULL OR remarks NOT LIKE '⚙ auto-added%')
   AND imported_at::date - date::date > 30
   AND (date + interval '1 year')::date BETWEEN imported_at::date - 2 AND imported_at::date + 2
ON CONFLICT (station, row_id) DO NOTHING;
UPDATE oven SET date = date + interval '1 year'
 WHERE id IN (SELECT row_id FROM year_typo_backup_0027 WHERE station = 'oven' AND part = 'A');

-- ---------------------------------------------------------------- PART B: the 5 strays
-- Matched by batch + the exact bad date, so nothing else can be caught by accident.
INSERT INTO year_typo_backup_0027 (station, row_id, batch_key, slab_number, old_date, new_date, part)
SELECT 'press', p.id, p.batch_key, p.slab_number, p.date, v.good, 'B'
  FROM press p
  JOIN (VALUES
        ('1281', DATE '2026-10-15', TIMESTAMP '2026-04-15 00:00:00'),
        ('1194', DATE '2028-12-28', TIMESTAMP '2025-12-28 00:00:00'),
        ('1189', DATE '2025-04-23', TIMESTAMP '2025-12-23 00:00:00'),
        ('1280', DATE '2023-04-13', TIMESTAMP '2026-04-13 00:00:00'),
        ('1143', DATE '2025-05-19', TIMESTAMP '2025-11-19 00:00:00')
       ) AS v(bk, bad, good)
    ON p.batch_key = v.bk AND p.date::date = v.bad
 WHERE p.remarks IS NULL OR p.remarks NOT LIKE '⚙ auto-added%'
ON CONFLICT (station, row_id) DO NOTHING;

UPDATE press p SET date = b.new_date
  FROM year_typo_backup_0027 b
 WHERE b.station = 'press' AND b.part = 'B' AND b.row_id = p.id;

-- ---------------------------------------------------------------- verify, then COMMIT
SELECT part, station, count(*) AS rows_changed,
       min(old_date)::date AS oldest_bad, max(old_date)::date AS newest_bad
  FROM year_typo_backup_0027 GROUP BY 1, 2 ORDER BY 1, 2;

-- Expect: A/press 603-26=577… (press 577, jot 26) and B/press 5. Total 608.
SELECT count(*) AS total_rows_changed FROM year_typo_backup_0027;

-- Sanity: nothing should now be dated in the future or before 2025 unless it always was.
SELECT 'STILL BAD' AS problem, station, count(*)
  FROM year_typo_backup_0027 WHERE new_date > now() + interval '2 days' GROUP BY 1, 2;

COMMIT;

-- ================================================================ ROLLBACK (if needed)
-- BEGIN;
-- UPDATE press       a SET date = b.old_date FROM year_typo_backup_0027 b WHERE b.station = 'press'       AND b.row_id = a.id;
-- UPDATE distributor a SET date = b.old_date FROM year_typo_backup_0027 b WHERE b.station = 'distributor' AND b.row_id = a.id;
-- UPDATE kreos       a SET date = b.old_date FROM year_typo_backup_0027 b WHERE b.station = 'kreos'       AND b.row_id = a.id;
-- UPDATE oven        a SET date = b.old_date FROM year_typo_backup_0027 b WHERE b.station = 'oven'        AND b.row_id = a.id;
-- UPDATE jot         a SET date = b.old_date FROM year_typo_backup_0027 b WHERE b.station = 'jot'         AND b.row_id = a.id;
-- COMMIT;
--
-- Keep the backup table until you're satisfied:  DROP TABLE year_typo_backup_0027;
