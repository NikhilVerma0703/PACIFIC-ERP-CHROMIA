-- 0067: one MIS row per (date, hour) — the rule the app enforces, put in the DB.
--
-- NOT APPLIED, AND IT CANNOT BE YET: the index below FAILS on today's data. Read
-- the dedupe section first; the CREATE UNIQUE INDEX is the last step, after the
-- duplicates it reports have been resolved by someone who can say which of each
-- pair is the real hour.
--
-- WHY. createRow has refused a second row for the same date+hour for a long time
-- ("it would double-count slabs and downtime downstream"), but saveRow never
-- repeated the check, and `hour` and `date` are both editable in /tables/Mis/[id]
-- — so a clean row could be saved and then retyped onto an hour already logged.
-- Both paths check it now (misDuplicateHourError, src/app/tables/actions.ts) and
-- a failed lookup blocks the save instead of allowing it; a unique index is the
-- backstop the application layer cannot be, because it also covers the importer,
-- a manual psql session and two tablets racing each other.
--
-- MEASURED on live Neon 2026-09-03: mis holds 7,101 rows; 1 has date IS NULL
-- (hence the partial index); 247 exact (date, hour) groups hold 501 rows between
-- them. NONE of them is newer than 2026-07-01 — every duplicate predates the
-- create-path guard, which is evidence the guard works and evidence the DB
-- constraint is the only thing that would have caught the edit path.
--
-- ONE SUBTLETY, because it decides what the index actually promises: `date` is a
-- timestamp, and the app stores the IST day at UTC MIDNIGHT — but 539 legacy rows
-- carry a non-midnight time, so 2026-06-30 05:00 and 2026-06-30 00:00 are two
-- different keys to this index and one calendar day can still hold two rows.
-- Counted by calendar day the duplicate groups are 277, not 247. The index is
-- deliberately on the raw column all the same: it matches EXACTLY what
-- misDuplicateHourError treats as one slot for new rows, an expression index on
-- date::date would refuse legacy rows the app considers distinct, and normalising
-- those 539 timestamps is a separate decision about which day the work reports on
-- (see scripts/0064's note on not moving dates in a batch repair).

-- ---------------------------------------------------------------------------
-- 1) DEDUPE FIRST — what currently violates the constraint. One line per clash,
--    with both rows' figures side by side so the reader can tell a genuine
--    double-entry (same batch, same slabs) from two different hours that share a
--    key by accident.
SELECT m.date, m.hour, count(*) AS rows,
       array_agg(m.id ORDER BY m.imported_at)                        AS ids,
       array_agg(m.batch ORDER BY m.imported_at)                     AS batches,
       array_agg(m.starting_slab_number ORDER BY m.imported_at)      AS start_slabs,
       array_agg(m.ending_slab_number ORDER BY m.imported_at)        AS end_slabs,
       array_agg(m.slabs_per_hour_actual ORDER BY m.imported_at)     AS actual,
       array_agg(m.production_incharge_name ORDER BY m.imported_at)  AS incharge
  FROM mis m
 WHERE m.date IS NOT NULL AND m.hour IS NOT NULL
 GROUP BY m.date, m.hour
HAVING count(*) > 1
 ORDER BY m.date DESC;

-- 1b) The wider view: same hour on the same CALENDAR day, which is how a person
--     reads the sheet even when the stored timestamps differ. 277 groups.
SELECT date::date AS day, hour, count(*) AS rows, array_agg(id) AS ids
  FROM mis
 WHERE date IS NOT NULL AND hour IS NOT NULL
 GROUP BY 1, 2
HAVING count(*) > 1
 ORDER BY 1 DESC;

-- 2) THE INDEX. Run ONLY after (1) returns no rows. Partial because one row has
--    no date at all and legacy rows may carry only date_and_time — those are
--    outside this promise, exactly as the WHERE clause says.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS mis_date_hour_unique_idx
--     ON mis (date, hour)
--  WHERE date IS NOT NULL;
--
-- When it is applied, add the matching line to prisma/schema.prisma so
-- `migrate diff` stays clean (Prisma's default name for it is the one above):
--   @@unique([date, hour], map: "mis_date_hour_unique_idx")
-- and note that createRow/saveRow will then also see P2002 for this pair —
-- friendlyDbError already renders that as "A record with this date, hour already
-- exists", which is a worse message than misDuplicateHourError's; the guards stay
-- where they are so the operator keeps the message that tells them what to do.
