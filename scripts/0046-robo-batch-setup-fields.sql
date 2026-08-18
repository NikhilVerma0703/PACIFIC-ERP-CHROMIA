-- 0046 — Production date and batch number on the Robo setup.
--
-- Two fields the operator now writes at the top of Batch setup, before Design:
-- the date the run was produced (RoboShift.date is when the tablet was opened,
-- which is not the same thing for a run entered late or corrected the next
-- morning) and the plant's own number for the batch.
--
-- Both nullable and additive: every setup saved before this has neither, the
-- form does not require either, and nothing reads them yet beyond the form
-- itself. No backfill — a date invented for an old run would be a guess
-- recorded as a fact.
--
-- Apply with:
--   npx prisma db execute --file scripts/0046-robo-batch-setup-fields.sql --schema prisma/schema.prisma
--
-- Idempotent: IF NOT EXISTS on both.

ALTER TABLE "RoboBatchRecipe" ADD COLUMN IF NOT EXISTS "productionDate" TEXT;
ALTER TABLE "RoboBatchRecipe" ADD COLUMN IF NOT EXISTS "batchNo" TEXT;
