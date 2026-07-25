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
-- Root cause is scripts/sync.ts, which copied Airtable multiselect values verbatim
-- (v.map(String), no trim). That is fixed in the same commit; without it the next sync
-- would write the untrimmed value straight back.
--
-- array_replace, not a general trim: it rewrites the element in place, so array ORDER is
-- preserved. Idempotent - re-running matches nothing once applied.
--
-- classifyReason (lib/downtime.ts) buckets both spellings as "process", so no past
-- downtime report changes shape.

UPDATE mis
   SET reason_for_deviation = array_replace(reason_for_deviation, 'MATERIAL DELAY ', 'MATERIAL DELAY')
 WHERE 'MATERIAL DELAY ' = ANY(reason_for_deviation);
