-- Office 'Commercial' role (slabs table + dispatch with invoice) + invoice store.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMMERCIAL';
CREATE TABLE IF NOT EXISTS fg_dispatch_invoice (
  id            TEXT PRIMARY KEY,
  pi            TEXT,
  customer      TEXT,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  data          BYTEA NOT NULL,
  slab_numbers  DOUBLE PRECISION[] NOT NULL,
  dispatched_by TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
