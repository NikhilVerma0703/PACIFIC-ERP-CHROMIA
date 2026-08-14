-- 0038: Hot-path indexes for the whole-app slowness complaint (2026-08-14).
-- APPLIED to Neon 2026-08-14 with:
--   npx prisma db execute --file scripts/0038-hot-path-indexes.sql --schema prisma/schema.prisma
-- Matching @@index lines added to prisma/schema.prisma the same day (Prisma's default index
-- names equal the names below, so migrate diff stays clean). Idempotent — safe to re-run.
-- Post-apply EXPLAIN re-run confirmed the flips: Q1 slab_number IN(250) 7.2 ms seq scan ->
-- 0.71 ms bitmap; /live findFirst 20.5 -> 0.05 ms; /tables page-1 41.2 -> 0.08 ms;
-- QC dup guard 2.8 -> 0.02 ms; mis OR-window BitmapOr 0.32 ms; press date window 0.58 ms.
--
-- Every index below is backed by an EXPLAIN (ANALYZE, BUFFERS) run against live Neon on
-- 2026-08-14 showing a seq scan on the exact predicate the app issues. Row counts are
-- exact (SELECT count(*)) from the same day. Tables are small-to-mid (max 45k rows), so
-- plain CREATE INDEX (no CONCURRENTLY — db execute runs in a transaction) is fine: each
-- build is well under a second and takes only a brief write lock.
--
-- Nothing here changes what any query returns — indexes only change how rows are found.

-- ---------------------------------------------------------------------------
-- 1) polish_qc.slab_number — 44,574 rows, 181 MB table. THE top offender.
--    shiftScore.scoreShift / scoreStations / claimedSlabs grade slabs with
--    slab_number IN (...) — 11 ms seq scan over 3,624 buffers PER SHIFT INSTANCE
--    (a month scoreboard scores ~90 instances; scoreStations repeats it per station).
--    Also: the duplicate-slab guard on EVERY PolishQc save (slab_number = X, 2.4 ms
--    seq scan), /api/inventory/polishing-report, and the fab slab lookups.
CREATE INDEX IF NOT EXISTS polish_qc_slab_number_idx ON polish_qc (slab_number);

-- 2) imported_at on the station tables. Two whole-page hot paths order by it:
--    /live (getLiveStatus): findFirst ORDER BY imported_at DESC on 7 tables per poll
--      — measured 20.6 ms top-N heapsort over all 44k polish_qc rows, same shape on
--      the other six; with the index it is a 1-page backward scan.
--    /tables/[model] (listRows): default sort is imported_at DESC LIMIT 25 —
--      measured 41.7 ms on polish_entry (11,768 buffers) for page 1.
--    Row counts: polish_qc 44,574 · polish_entry 44,677 · press 28,813 · jot 17,788 ·
--    oven 16,364 · silo 16,154 · distributor 13,024 · mixer_cycle 7,577 ·
--    used_bags 7,404 · mis 6,644 · rm 6,008 · kreos 2,546.
CREATE INDEX IF NOT EXISTS polish_qc_imported_at_idx    ON polish_qc (imported_at);
CREATE INDEX IF NOT EXISTS polish_entry_imported_at_idx ON polish_entry (imported_at);
CREATE INDEX IF NOT EXISTS press_imported_at_idx        ON press (imported_at);
CREATE INDEX IF NOT EXISTS jot_imported_at_idx          ON jot (imported_at);
CREATE INDEX IF NOT EXISTS oven_imported_at_idx         ON oven (imported_at);
CREATE INDEX IF NOT EXISTS silo_imported_at_idx         ON silo (imported_at);
CREATE INDEX IF NOT EXISTS distributor_imported_at_idx  ON distributor (imported_at);
CREATE INDEX IF NOT EXISTS mixer_cycle_imported_at_idx  ON mixer_cycle (imported_at);
CREATE INDEX IF NOT EXISTS used_bags_imported_at_idx    ON used_bags (imported_at);
CREATE INDEX IF NOT EXISTS mis_imported_at_idx          ON mis (imported_at);
CREATE INDEX IF NOT EXISTS rm_imported_at_idx           ON rm (imported_at);
CREATE INDEX IF NOT EXISTS kreos_imported_at_idx        ON kreos (imported_at);

-- 3) mis shift-window columns — 6,644 rows. claimedSlabs + scoreShift + crewOnShift
--    each run the OR shape (date_and_time in window) OR (date_and_time IS NULL AND
--    date in window): ~3 scans per shift instance, ~270 seq scans (1.2 ms / 445
--    buffers each) per month scoreboard load. The planner BitmapOrs these two
--    single-column indexes for that exact shape; also serves /entry/mis, misShift,
--    telegramReports and downtime date filters.
CREATE INDEX IF NOT EXISTS mis_date_and_time_idx ON mis (date_and_time);
CREATE INDEX IF NOT EXISTS mis_date_idx          ON mis (date);

-- 4) date on the line tables — scoreStations boards, downtime.ts and the
--    dashboard's press-today count filter WHERE date >= X AND date < Y:
--    press measured 4.2 ms seq scan discarding 27,720 of 28,813 rows per call.
CREATE INDEX IF NOT EXISTS press_date_idx       ON press (date);
CREATE INDEX IF NOT EXISTS oven_date_idx        ON oven (date);
CREATE INDEX IF NOT EXISTS jot_date_idx         ON jot (date);
CREATE INDEX IF NOT EXISTS distributor_date_idx ON distributor (date);
CREATE INDEX IF NOT EXISTS kreos_date_idx       ON kreos (date);

-- 5) polish_entry.created — 44,677 rows, 102 MB. scoreStations' polishing board
--    filters COALESCE(created, imported_at) in-window: 27.9 ms seq scan over 11,768
--    buffers. COALESCE defeats a plain index, so the fix phase also rewrites that
--    predicate to the equivalent OR shape ((created in window) OR (created IS NULL
--    AND imported_at in window)) which BitmapOrs this index with
--    polish_entry_imported_at_idx above. erp.ts 7/30-day counts use the same OR
--    shape already. slab_number covers the duplicate-entry guard on every save.
CREATE INDEX IF NOT EXISTS polish_entry_created_idx     ON polish_entry (created);
CREATE INDEX IF NOT EXISTS polish_entry_slab_number_idx ON polish_entry (slab_number);

-- 6) jot.slab_number — 17,788 rows. avgThicknessFor (per shift scored) hits
--    slab_number IN (...): 1.9 ms seq scan discarding 17,759 rows.
CREATE INDEX IF NOT EXISTS jot_slab_number_idx ON jot (slab_number);

-- 7) silo.silo_no — 16,154 rows. /tables/Silo pinned-bag query and the
--    silo-filling FIFO transaction (which holds pg_advisory_xact_lock while it
--    scans) filter WHERE silo_no = X AND remaining_weight > 0.
CREATE INDEX IF NOT EXISTS silo_silo_no_idx ON silo (silo_no);
