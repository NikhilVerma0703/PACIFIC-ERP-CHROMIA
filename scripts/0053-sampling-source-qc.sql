-- =====================================================================
-- 0053-sampling-source-qc.sql
--
-- Link a sample intake back to the QC slab it was cut from.
--
-- WHY
-- ---
-- sampling_intake.source_ref already carries the slab NUMBER as text, and
-- fab_slab.slab_code is already that number: slab-assignment writes
-- `slabCode: String(qc.slabNumber)` when a supervisor puts a QC slab on the
-- board. Text is what a person reads and argues about. It is not a link —
-- polish_qc is re-imported from the polishing line, and a number can be
-- re-typed — so "which QC slab" and "what did the supervisor call it" are
-- two different questions. source_ref answers the second; this column
-- answers the first, and is what "show me every sample cut off this slab"
-- joins on.
--
-- NO FOREIGN KEY TO polish_qc, deliberately, and for the same reason the
-- module's other cross-boundary references carry none (see the note on
-- SamplingIntake.createdById and the Sales/Chromia precedent): polish_qc
-- rows are re-imported wholesale from the line. A constraint here would
-- make a routine QC re-import fail on sampling history that must not be
-- deleted. The column is a reference, and a dangling one is still a better
-- record than none.
--
-- NULLABLE, and that is not laziness. The sampling desk adds stock that
-- never came off a slab; those rows have no QC record to point at. What is
-- refused is a FABRICATION intake with no readable slab number at all, and
-- that refusal lives in the route (requireSlabSource in
-- lib/sampling/fabIntake.ts) rather than in a CHECK, because the rule is
-- "one of two references must exist" and it applies to two of the three
-- ways a row can be created.
--
-- IDEMPOTENT. Safe to re-run. Apply AFTER 0051 (which creates the table).
--
-- HOW TO RUN
--     psql "$DATABASE_URL" -f scripts/0053-sampling-source-qc.sql
-- or paste into the Neon SQL editor.
-- =====================================================================

BEGIN;

-- 1. The columns.
ALTER TABLE "sampling_intake"
  ADD COLUMN IF NOT EXISTS "source_qc_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "source_slab_id" TEXT;

COMMENT ON COLUMN "sampling_intake"."source_slab_id" IS
  'fab_slab.id of the slab card these pieces came off. source_qc_id answers '
  '"which stone"; this answers "which slab card", and fabrication accounting '
  'is per fab_slab. Summed into computeSlabLoss.sampledAreaSqft so sampled '
  'stone stops being reported as scrap and stops leaving PO capacity '
  'unchanged. No FK: deleting fab test data must not reason about sampling.';

COMMENT ON COLUMN "sampling_intake"."source_qc_id" IS
  'polish_qc.id of the slab these pieces were cut from. No FK on purpose: '
  'polish_qc is re-imported from the polishing line and a constraint would '
  'make a re-import fail on sampling history. source_ref carries the same '
  'slab as human-readable text.';

-- 2. The index that makes the traceability question cheap in the direction
--    it is actually asked: from a slab, to everything taken off it.
CREATE INDEX IF NOT EXISTS "sampling_intake_source_qc_id_idx"
  ON "sampling_intake" ("source_qc_id");

-- 3. The hotter of the two: read on every send-to-cutter and every board load,
--    because the slab's remaining PO capacity now depends on it.
CREATE INDEX IF NOT EXISTS "sampling_intake_source_slab_id_idx"
  ON "sampling_intake" ("source_slab_id");

COMMIT;


-- =====================================================================
-- BACKFILL (optional, run once, read the note first)
--
-- Existing rows have source_ref but no source_qc_id. Where the text in
-- source_ref is exactly one polish_qc slab number, the link can be
-- recovered. Where it matches several — the same slab number can appear
-- more than once across re-imports — it is LEFT NULL rather than guessed,
-- because a wrong link is worse than a missing one.
--
-- Run the SELECT first and read the counts. Only then run the UPDATE.
-- =====================================================================

-- What the backfill would do, before it does it:
-- SELECT
--   count(*) FILTER (WHERE m.qc_id IS NOT NULL)                        AS will_link,
--   count(*) FILTER (WHERE m.qc_id IS NULL AND i.source_ref IS NOT NULL) AS ambiguous_or_unknown,
--   count(*) FILTER (WHERE i.source_ref IS NULL)                       AS no_reference_at_all
-- FROM sampling_intake i
-- LEFT JOIN LATERAL (
--   SELECT CASE WHEN count(*) = 1 THEN min(q.id) END AS qc_id
--   FROM polish_qc q
--   WHERE q.slab_number::text = btrim(i.source_ref)
-- ) m ON true
-- WHERE i.source_qc_id IS NULL;

-- The backfill itself:
-- UPDATE sampling_intake i
-- SET    source_qc_id = m.qc_id
-- FROM LATERAL (
--   SELECT CASE WHEN count(*) = 1 THEN min(q.id) END AS qc_id
--   FROM polish_qc q
--   WHERE q.slab_number::text = btrim(i.source_ref)
-- ) m
-- WHERE i.source_qc_id IS NULL
--   AND i.source_ref IS NOT NULL
--   AND m.qc_id IS NOT NULL;


-- =====================================================================
-- AFTERWARDS — the question this was all for:
--
--   SELECT q.slab_number, q.design, ps.name AS series,
--          pc.name AS colour, pcf.finish,
--          s.length_in, s.width_in, s.thickness_mm,
--          i.quantity, i.source, i.created_at
--   FROM sampling_intake i
--   JOIN polish_qc q              ON q.id  = i.source_qc_id
--   JOIN sampling_size s          ON s.id  = i.size_id
--   JOIN product_colour_finish pcf ON pcf.id = i.colour_finish_id
--   JOIN product_colour pc        ON pc.id = pcf.colour_id
--   JOIN product_series ps        ON ps.id = pc.series_id
--   WHERE q.slab_number = 154700
--   ORDER BY i.created_at;
-- =====================================================================
