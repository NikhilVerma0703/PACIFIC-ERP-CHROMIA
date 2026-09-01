-- Finished goods: batches that disagree with the QC row they mirror.
--
-- fg_finished_slab is a PROJECTION of polish_qc — autolinkFinishedSlabFromQc
-- (src/lib/inventory/finishedSlab.ts) writes `batchNumber: qc.batchNumber,
-- batchKey: qc.batchKey` on every QC pass. 432 legacy BULK_UPLOAD rows never
-- went through that path and carry a batch their QC row disagrees with, e.g.
-- 27 slabs filed under "43" whose QC says 1343.
--
-- QC IS NOT TAKEN ON TRUST. Each disagreement is put to the five stations that
-- also record a slab's batch (press, jot, oven, distributor, polish entry).
-- Only rows where at least one station backs QC and NONE backs the finished-
-- goods value are corrected — 404 of the 432. Measured: no row anywhere has a
-- station backing finished goods against QC.
--
-- DELIBERATELY LEFT: 18 rows where the stations split (several are QC-side
-- typos — "130-1", "13227", "41329", "ROBO" — where finished goods is the
-- cleaner value, so copying QC over it would be a downgrade) and 10 rows whose
-- slab no station has ever seen. Both sets are listed in the commit message.
--
-- Re-running is a no-op: the WHERE clause only matches rows still disagreeing.

BEGIN;

CREATE TEMP TABLE fg_batch_fix ON COMMIT DROP AS
WITH latest AS (
  SELECT DISTINCT ON (slab_number) slab_number, batch_key, batch_number
    FROM polish_qc
   WHERE slab_number IS NOT NULL
   ORDER BY slab_number, created_time DESC NULLS LAST, imported_at DESC NULLS LAST
)
SELECT f.slab_number, f.batch_key AS old_key, f.batch_number AS old_raw,
       l.batch_key AS new_key, l.batch_number AS new_raw
  FROM fg_finished_slab f
  JOIN latest l ON l.slab_number = f.slab_number
 WHERE f.batch_key IS DISTINCT FROM l.batch_key
   -- at least one station agrees with QC ...
   AND EXISTS (
     SELECT 1 FROM (
       SELECT batch_key AS k, slab_number AS sn FROM press
       UNION ALL SELECT batch_key, slab_number FROM jot
       UNION ALL SELECT batch_key, slab_number FROM oven
       UNION ALL SELECT batch_key, slab_number FROM distributor
       UNION ALL SELECT batch_key, slab_number FROM polish_entry
     ) v WHERE v.sn = f.slab_number AND v.k = l.batch_key)
   -- ... and none backs the value finished goods currently holds
   AND NOT EXISTS (
     SELECT 1 FROM (
       SELECT batch_key AS k, slab_number AS sn FROM press
       UNION ALL SELECT batch_key, slab_number FROM jot
       UNION ALL SELECT batch_key, slab_number FROM oven
       UNION ALL SELECT batch_key, slab_number FROM distributor
       UNION ALL SELECT batch_key, slab_number FROM polish_entry
     ) v WHERE v.sn = f.slab_number AND v.k = f.batch_key);

UPDATE fg_finished_slab f
   SET batch_number = x.new_raw, batch_key = x.new_key
  FROM fg_batch_fix x
 WHERE f.slab_number = x.slab_number
   AND f.batch_key IS DISTINCT FROM x.new_key;

-- One audit line per slab, so the change shows in that slab's own history.
INSERT INTO fg_slab_event (id, slab_number, kind, field, old_value, new_value, changed_by, source, at)
SELECT md5(random()::text || x.slab_number::text), x.slab_number, 'batch_corrected', 'batch',
       x.old_raw, x.new_raw, 'data repair (scripts/0065)', 'QC record', now()
  FROM fg_batch_fix x;

INSERT INTO action_log (id, created_at, actor, batch_key, kind, model, summary, payload, undone)
SELECT 'fg-batch-from-qc-0065', now(), 'data repair (scripts/0065)', NULL,
       'fg_batch_projection_repair', 'FinishedSlab',
       'Finished-goods batch re-projected from the QC row it mirrors, for ' || count(*)::text ||
       ' legacy bulk-upload slabs where at least one station backed QC and none backed the stored value.',
       jsonb_build_object('slabs', count(*), 'authority', 'polish_qc + station corroboration'), false
  FROM fg_batch_fix
 ON CONFLICT (id) DO NOTHING;

COMMIT;
