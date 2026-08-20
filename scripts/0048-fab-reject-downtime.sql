-- 0048: piece rejection (status + reason) and machine downtime log.
-- PURELY ADDITIVE AND IDEMPOTENT.

ALTER TYPE "FabPieceStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE fab_piece
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS reject_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by_worker_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_rejected_by_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_piece
      ADD CONSTRAINT fab_piece_rejected_by_worker_id_fkey
      FOREIGN KEY (rejected_by_worker_id) REFERENCES fab_worker(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fab_machine_downtime (
  id            TEXT PRIMARY KEY,
  machine_id    TEXT NOT NULL,
  process_type  TEXT NOT NULL,
  reason        TEXT NOT NULL,
  notes         TEXT,
  started_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at      TIMESTAMP(3),
  worker_id     TEXT,
  shift         TEXT,
  session_id    TEXT,
  user_id       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS fab_machine_downtime_machine_ended_idx
  ON fab_machine_downtime (machine_id, ended_at);
CREATE INDEX IF NOT EXISTS fab_machine_downtime_process_ended_idx
  ON fab_machine_downtime (process_type, ended_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_machine_downtime_machine_id_fkey'
  ) THEN
    ALTER TABLE fab_machine_downtime
      ADD CONSTRAINT fab_machine_downtime_machine_id_fkey
      FOREIGN KEY (machine_id) REFERENCES fab_machine(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_machine_downtime_worker_id_fkey'
  ) THEN
    ALTER TABLE fab_machine_downtime
      ADD CONSTRAINT fab_machine_downtime_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES fab_worker(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
