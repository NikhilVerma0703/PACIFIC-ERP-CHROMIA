-- Creates the action_log table that powers "Undo last action".
CREATE TABLE IF NOT EXISTS "action_log" (
  "id"         TEXT PRIMARY KEY,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor"      TEXT,
  "batch_key"  TEXT,
  "kind"       TEXT NOT NULL,
  "model"      TEXT,
  "summary"    TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "undone"     BOOLEAN NOT NULL DEFAULT false,
  "undone_at"  TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "action_log_batch_key_undone_created_at_idx"
  ON "action_log" ("batch_key", "undone", "created_at");
