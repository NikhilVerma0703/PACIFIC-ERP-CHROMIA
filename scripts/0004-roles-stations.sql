-- Role hierarchy + operator station assignment + created-by tracking.
-- (Easiest path is `npx prisma db push`; this SQL is the manual equivalent.)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'INCHARGE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LINE_MANAGER';
-- migrate any legacy MANAGER users to LINE_MANAGER
UPDATE "users" SET role = 'LINE_MANAGER' WHERE role = 'MANAGER';

DO $$ BEGIN
  CREATE TYPE "Station" AS ENUM ('PRESS','OVEN','JOT','MIXER','KREOS','DISTRIBUTOR','SILO','POLISH_QC','POLISH_ENTRY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "station" "Station";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "users"
  ADD CONSTRAINT "users_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
