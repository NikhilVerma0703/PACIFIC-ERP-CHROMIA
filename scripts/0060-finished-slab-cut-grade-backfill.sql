-- =====================================================================
-- 0060-finished-slab-cut-grade-backfill.sql
--
-- ALREADY-CUT SLABS THAT ARE STILL DISPATCHABLE. A one-off repair.
--
-- ─────────────────────────────────── THE BUG, PLAINLY ──────────────────────
-- finished_slab is a MIRROR of the latest polish_qc row for a slab number, and
-- inventory's dispatch rule reads finished_slab.grade — not polish_qc. The
-- mirror is only ever refreshed by autolinkFinishedSlabFromQc().
--
-- Nothing on the fabrication side was calling it. So when a supervisor picked a
-- slab for fabrication, markQcSlabCts wrote polish_qc.quality_grade = 'CTS' by
-- raw SQL and inventory carried on showing the old A/B/C. The CTS dispatch
-- block therefore NEVER FIRED for a slab fabrication took — it only ever worked
-- when QC itself typed CTS, because that path re-saves the QC row and refreshes
-- the mirror on the way past.
--
-- That is, word for word, the failure lib/inventory/grading.ts says it exists to
-- prevent: "which is how already-cut slabs left as full slabs."
--
-- The live path is fixed — refreshInventoryMirror() now runs on every CTS and
-- SAMPLE write. This script repairs the slabs cut BEFORE that fix, which would
-- otherwise stay wrongly dispatchable until somebody happened to re-save their
-- QC row.
--
-- ─────────────────────────────────── WHAT IT CHANGES ───────────────────────
-- ONE COLUMN, ON THE SLABS THAT ARE ALREADY CUT: finished_slab.grade is set to
-- what polish_qc actually says, for every slab whose QC row reads CTS or SAMPLE
-- and whose mirror does not.
--
-- IT ONLY EVER BLOCKS MORE, never less. Slabs graded A/B/C are untouched, so
-- nothing that can be dispatched today stops being dispatchable. That is the
-- only safe direction for a rule that is the last thing between an already-cut
-- slab and a lorry.
--
-- STATUS IS NOT TOUCHED. A slab already DISPATCHED stays dispatched — that
-- shipment happened, and rewriting history would not bring the stone back. This
-- only stops the NEXT one.
--
-- ─────────────────────────────────── WHICH QC ROW ──────────────────────────
-- The LATEST for that slab number, by created_time then imported_at — exactly
-- the ordering autolinkFinishedSlabFromQc uses, so this script and the live
-- path can never disagree about which row is authoritative.
--
-- IDEMPOTENT. Safe to re-run: the second run finds nothing left to change.
-- Apply after 0057.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Before: how many slabs are cut in QC but still read as sellable stone.
-- ---------------------------------------------------------------------
-- SELECT count(*) AS wrongly_dispatchable
-- FROM   finished_slab fs
-- JOIN   LATERAL (
--          SELECT quality_grade FROM polish_qc q
--          WHERE  q.slab_number = fs.slab_number
--          ORDER  BY q.created_time DESC NULLS LAST, q.imported_at DESC
--          LIMIT  1
--        ) qc ON TRUE
-- WHERE  upper(btrim(coalesce(qc.quality_grade,''))) IN ('CTS','SAMPLE')
--   AND  upper(btrim(coalesce(fs.grade,''))) NOT IN ('CTS','SAMPLE');

-- DISTINCT ON, NOT A LATERAL. The obvious way to write this is
-- `UPDATE finished_slab fs ... FROM LATERAL (... WHERE q.slab_number =
-- fs.slab_number)`, and Postgres refuses it: the UPDATE's target table is not
-- part of the FROM list, so a lateral subquery cannot reference it —
-- "invalid reference to FROM-clause entry for table fs". A hard parse error,
-- so the script stops here rather than doing anything partial.
--
-- DISTINCT ON with the same ORDER BY selects exactly the same rows: one per
-- slab_number, newest first by created_time then imported_at. That is the
-- ordering autolinkFinishedSlabFromQc uses, and this must agree with it or the
-- repair and the live path would disagree about which QC row is authoritative.
UPDATE finished_slab fs
SET    grade = latest.grade
FROM   (
         SELECT DISTINCT ON (q.slab_number)
                q.slab_number,
                upper(btrim(coalesce(q.quality_grade, ''))) AS grade
         FROM   polish_qc q
         ORDER  BY q.slab_number, q.created_time DESC NULLS LAST, q.imported_at DESC
       ) latest
WHERE  latest.slab_number = fs.slab_number
  AND  latest.grade IN ('CTS', 'SAMPLE')
  -- Only where the mirror actually disagrees, so a re-run is a no-op and the
  -- row count reported is the number genuinely repaired.
  AND  upper(btrim(coalesce(fs.grade, ''))) NOT IN ('CTS', 'SAMPLE');

COMMIT;


-- =====================================================================
-- AFTERWARDS
-- =====================================================================

-- MUST RETURN 0 ROWS. Any row here is a slab QC calls cut and inventory still
-- calls sellable — the exact state this script exists to remove.
-- SELECT fs.slab_number, fs.grade AS inventory_says, qc.quality_grade AS qc_says, fs.status
-- FROM   finished_slab fs
-- JOIN   LATERAL (
--          SELECT quality_grade FROM polish_qc q
--          WHERE  q.slab_number = fs.slab_number
--          ORDER  BY q.created_time DESC NULLS LAST, q.imported_at DESC
--          LIMIT  1
--        ) qc ON TRUE
-- WHERE  upper(btrim(coalesce(qc.quality_grade,''))) IN ('CTS','SAMPLE')
--   AND  upper(btrim(coalesce(fs.grade,''))) NOT IN ('CTS','SAMPLE');

-- WORTH READING ONCE, and it may be uncomfortable: cut slabs that were
-- DISPATCHED while the block was not firing. Nothing can be done about them
-- now — the stone has gone — but it says how long this was happening and how
-- much left as full slabs that should not have.
-- SELECT fs.slab_number, fs.grade, fs.status, fs.customer, fs.reserved_for_pi
-- FROM   finished_slab fs
-- WHERE  upper(btrim(coalesce(fs.grade,''))) IN ('CTS','SAMPLE')
--   AND  fs.status = 'DISPATCHED'
-- ORDER  BY fs.slab_number;
