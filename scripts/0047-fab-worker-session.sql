-- 0047: floor roster (fab_worker) and who-did-this columns on sessions,
--       operations, and slab jobs.
--
-- PURELY ADDITIVE AND IDEMPOTENT. The operator login is shared; a process
-- session now names the person standing at that station.

CREATE TABLE IF NOT EXISTS fab_worker (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_id TEXT
);

CREATE INDEX IF NOT EXISTS fab_worker_active_idx ON fab_worker (active);

ALTER TABLE fab_machine_session
  ADD COLUMN IF NOT EXISTS worker_id TEXT;

ALTER TABLE fab_operation
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS shift TEXT;

ALTER TABLE fab_slab_job
  ADD COLUMN IF NOT EXISTS worker_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_machine_session_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_machine_session
      ADD CONSTRAINT fab_machine_session_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_operation_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_operation
      ADD CONSTRAINT fab_operation_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_slab_job_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_slab_job
      ADD CONSTRAINT fab_slab_job_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_worker_created_by_id_fkey'
  ) THEN
    ALTER TABLE fab_worker
      ADD CONSTRAINT fab_worker_created_by_id_fkey
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fab_machine_session_machine_id_is_active_idx
  ON fab_machine_session (machine_id, is_active);
