-- 0029: dispute columns on the maintenance downtime response.
--
-- The Maintenance Manager can record a DISAGREEMENT with a production-logged downtime
-- duration: his own minutes for one delay type, stored BESIDE production's figure in
-- downtime_response, never over it. Nothing reads these into a KPI, chart or total —
-- src/lib/downtimeResponse.ts documents the model.
--
-- Idempotent. The code tolerates this not having run (reads fall back on 42703, and a
-- dispute save reports "not migrated yet" instead of saving), so order relative to the
-- deploy does not matter — but until it runs, disputes cannot be recorded.
--
-- `timestamp` (no tz), NOT timestamptz: matching responded_at / updated_at on this table.
-- Nullable, no default: NULL means "no dispute", and clearing a dispute nulls all four.

ALTER TABLE downtime_response ADD COLUMN IF NOT EXISTS disputed_type    text;
ALTER TABLE downtime_response ADD COLUMN IF NOT EXISTS disputed_minutes double precision;
ALTER TABLE downtime_response ADD COLUMN IF NOT EXISTS disputed_by      text;
ALTER TABLE downtime_response ADD COLUMN IF NOT EXISTS disputed_at      timestamp;
