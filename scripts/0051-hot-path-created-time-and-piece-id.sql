-- 0051: the five hot-path indexes the perf commit (3a9e6ff) annotated in
-- schema.prisma but never landed as a script — the schema comments say
-- "0051 hot-path" and this file did not exist, so a rebuilt or restored
-- environment would silently lack all five while the schema asserts them.
--
-- Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0051-hot-path-created-time-and-piece-id.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and
-- raw-SQL-only columns that push proposes dropping -- see the note at the top
-- of the sales section in schema.prisma and scripts/0040/0043/0044/0045.)
--
-- NO NEW TABLES, NO NEW COLUMNS, NO BACKFILL. Idempotent: IF NOT EXISTS
-- no-ops wherever the one-off migrate-diff apply already created the index.
--
-- Why each exists (measured on production data, 2026-08-23 — the full notes
-- sit beside the matching @@index lines in schema.prisma):
--   * polish_qc / press / kreos / distributor (created_time): the standard
--     recency window is "created_time in range OR (created_time IS NULL AND
--     imported_at in range)" — Airtable-era rows carry created_time, ERP rows
--     leave it NULL. imported_at got its indexes in 0038; without created_time
--     indexed too, Postgres cannot BitmapOr the two arms and seq-scans on
--     every /mis load (2-3x + every 45 s), every /entry/mis prefill, and the
--     hourly Telegram press check.
--   * fab_piece_operation (piece_id): Postgres does not index FK columns on
--     its own; every pieceOperations include (one child query per queue poll,
--     every 15-20 s per station), the pending-CUTTING EXISTS probe, and the
--     per-piece updateMany in the complete/undo routes walked the whole table.

CREATE INDEX IF NOT EXISTS "polish_qc_created_time_idx"          ON "polish_qc" ("created_time");
CREATE INDEX IF NOT EXISTS "press_created_time_idx"              ON "press" ("created_time");
CREATE INDEX IF NOT EXISTS "kreos_created_time_idx"              ON "kreos" ("created_time");
CREATE INDEX IF NOT EXISTS "distributor_created_time_idx"        ON "distributor" ("created_time");
CREATE INDEX IF NOT EXISTS "fab_piece_operation_piece_id_idx"    ON "fab_piece_operation" ("piece_id");
