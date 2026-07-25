-- 0031: strip the trailing space from one MIS "Reason for deviation" value.
--
--   'MATERIAL DELAY '  ->  'MATERIAL DELAY'   (469 rows)
--
-- The option list on the MIS form is the set of DISTINCT values in this column, so a
-- stray trailing space is not cosmetic: 'MATERIAL DELAY ' and 'MATERIAL DELAY' are two
-- different strings and would render as two identical-looking chips, splitting the same
-- reason across both in every report and filter. Only one value is affected, and no
-- trimmed twin exists yet, so this is a pure rename - nothing collapses together.
--
-- Root cause was the Airtable importers, which copied multiselect values verbatim
-- (v.map(String), no trim). Fixed in the same commit. The sync engine and its CLI were
-- removed entirely on 2026-07-25; scripts/import.ts is the last remaining copy and
-- carries the trim.
--
-- array_replace, not a general trim: it rewrites the element in place, so array ORDER is
-- preserved. Idempotent - re-running matches nothing once applied.
--
-- classifyReason (lib/downtime.ts) buckets both spellings as "process", so no past
-- downtime report changes shape.

UPDATE mis
   SET reason_for_deviation = array_replace(reason_for_deviation, 'MATERIAL DELAY ', 'MATERIAL DELAY')
 WHERE 'MATERIAL DELAY ' = ANY(reason_for_deviation);
