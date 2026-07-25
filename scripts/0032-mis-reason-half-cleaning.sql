-- 0032: rename one MIS "Reason for deviation" value in place.
--
--   'INTERMEDIATE CLEANING'  ->  'HALF CLEANING/ INTERMEDIATE CLEANING'   (551 rows)
--
-- Part of a reason-list revision agreed 2026-07-25. The other changes need no data work:
--   * FULL CLEANING already matches the wanted label exactly - untouched.
--   * MATERIAL DELAY is RETIRED, not renamed (lib/tables.ts RETIRED_OPTIONS). It is
--     replaced by two options - RAW MATERIAL DELAY and MATERIAL DELAY FROM MIXER - and
--     its 469 historical rows keep the old value rather than being reassigned: 170 do
--     name the mixer in details or area of problem, but 293 say nothing either way, so
--     any rule would invent the split for most of them.
--   * DESIGN CHANGE OVER/ ORDER CODE CHANGE, DRY CLEANING, MOULD DELAY,
--     PIGMENT DELAY (NON ROBO), SHADE VARIATION/ CRACKS are new - no history to migrate.
--
-- A pure relabel: same meaning, clearer words. classifyReason (lib/downtime.ts) buckets
-- BOTH strings as "cleaning" (each contains "CLEANING"), so no downtime figure moves
-- between types. The by-reason table keys on the raw string, so that row simply reads
-- under the new label.
--
-- array_replace, not a general trim: it rewrites the element in place, so array ORDER is
-- preserved. Idempotent - re-running matches nothing once applied.
--
-- DURABILITY: when this was written, mis was still an Airtable-mirrored table and a sync
-- would have overwritten these rows and undone the relabel. The whole sync feature was
-- removed later the same day, so nothing pulls from Airtable any more and this is now
-- permanent -- with ONE exception: scripts/import.ts, the original one-off importer, is
-- still present and still deletes and re-pulls every 'rec%'-origin row. Its cutover guard
-- reads sync_state.source = 'ERP', and every row is 'AIRTABLE', so the guard never fires.
-- Do not run npm run import unless that has been dealt with.

UPDATE mis
   SET reason_for_deviation = array_replace(reason_for_deviation, 'INTERMEDIATE CLEANING', 'HALF CLEANING/ INTERMEDIATE CLEANING')
 WHERE 'INTERMEDIATE CLEANING' = ANY(reason_for_deviation);
