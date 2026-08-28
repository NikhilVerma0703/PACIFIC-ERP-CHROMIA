-- 0062: the six columns the sampling-module branch declares on the Prisma
-- models but the NEON-01 runbook never carried — caught by `prisma migrate
-- diff` against production before the merge deployed.
--
-- WHY THIS IS DEPLOY-BLOCKING, not nice-to-have: these are in the PRISMA
-- MODELS, not raw-SQL-only columns. Prisma selects every scalar field of a
-- model by default, so with the new client deployed and these columns absent,
-- ANY read of users (login included) or sales_config answers P2022 "column
-- does not exist". Database first, code second — same order as NEON-01.
--
-- Run with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0062-mail-bodies-and-smtp.sql
-- (NOT `prisma db push` — see the note at the top of the sales section in
-- schema.prisma.) Or paste into the Neon SQL editor.
--
-- PURELY ADDITIVE AND IDEMPOTENT. Types and defaults are exactly what
-- `prisma migrate diff` emitted for the declared models. Re-running is a
-- no-op; the deployed (old) code ignores the new columns.

ALTER TABLE "sales_config"
  ADD COLUMN IF NOT EXISTS "mail_bodies"   JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "mail_subjects" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "smtp_host" TEXT,
  ADD COLUMN IF NOT EXISTS "smtp_pass" TEXT,
  ADD COLUMN IF NOT EXISTS "smtp_port" INTEGER,
  ADD COLUMN IF NOT EXISTS "smtp_user" TEXT;
