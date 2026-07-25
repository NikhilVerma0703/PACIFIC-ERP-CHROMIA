-- 0030: rename one MIS "Reason for deviation" value in place.
--
--   "Pigment Issue (Liquid or Powder pigment)"  ->  "Liquid / Powder issue at Robos"
--
-- A pure relabel: same meaning, clearer words, so the 37 rows already using the old
-- wording read consistently with new entries instead of the two spellings sitting side
-- by side in every report. classifyReason (lib/downtime.ts) buckets BOTH strings as
-- "process" - neither contains a CLEANING / POWER / ELECTRICAL / MECHANICAL / FAULT
-- ALARM / HMI / BELT DAMAGE keyword - so no past downtime report changes shape.
--
-- The five reasons retired alongside this one (BELT DAMAGE, ELECTRICAL - SUPPLY ISSUE,
-- FAULT ALARM, HMI ISSUE, MECHANICAL - BELT ISSUE) are deliberately NOT touched: they
-- are real distinct causes on 270 historical rows, and are merely no longer offered on
-- the form (lib/tables.ts RETIRED_OPTIONS).
--
-- Idempotent: re-running matches nothing once applied. reason_for_deviation is a text[],
-- so this rewrites the array element rather than the row.

UPDATE mis
   SET reason_for_deviation = array_replace(
         reason_for_deviation,
         'Pigment Issue (Liquid or Powder pigment)',
         'Liquid / Powder issue at Robos'
       )
 WHERE 'Pigment Issue (Liquid or Powder pigment)' = ANY(reason_for_deviation);
