-- 0063: CHROMIA on the SlabStatus enum — a finished slab taken into the
-- Chromia printing module. Written only by the Chromia intake hook (after its
-- transaction, never by hand); the slab-intake extension reads it.
--
-- Run with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0063-slab-status-chromia.sql
-- (NOT `prisma db push` — see the note at the top of the sales section in
-- schema.prisma.)
--
-- ADDITIVE AND IDEMPOTENT. One enum value, nothing else. A new enum value
-- cannot be USED in the transaction that adds it, so this ships alone and the
-- code that writes 'CHROMIA' deploys after it — the same order as scripts/0023
-- and 0045, and the same database-first rule as the NEON runbook.

ALTER TYPE "SlabStatus" ADD VALUE IF NOT EXISTS 'CHROMIA';
