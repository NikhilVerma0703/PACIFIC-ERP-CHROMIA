-- Optional photo attachment on shop-floor entry forms. Additive only.
CREATE TABLE IF NOT EXISTS entry_photo (
  id        TEXT PRIMARY KEY,
  model     TEXT NOT NULL,
  record_id TEXT NOT NULL,
  filename  TEXT NOT NULL,
  mime      TEXT NOT NULL,
  data      BYTEA NOT NULL,
  taken_by  TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entry_photo_record ON entry_photo (model, record_id);
