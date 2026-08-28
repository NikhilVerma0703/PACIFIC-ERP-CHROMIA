-- 0052-user-alt-role-context.sql
--
-- THE SECOND GRANTED JOB. One person is both Line Manager on the production
-- line and Fabrication Supervisor. That was two email accounts and two logins;
-- it is now one login holding two granted role+branch pairs, with a cookie
-- selecting which is live. See src/lib/roleContext.ts for the safety property.
--
-- NOT IN THE PRISMA MODEL, on purpose — the same convention scripts/0019 and
-- 0024 established for sales_role and amount_received. src/lib/users.ts reads
-- and writes these two columns with raw SQL only, and its reader swallows the
-- "column does not exist" error so a deploy that runs BEFORE this script simply
-- sees nobody holding a second job, rather than throwing P2022 on every screen
-- that lists a user.
--
-- Both columns are nullable with no default, and both move together: a role
-- without a branch is not a job, and lib/roleContext.ts treats a half-filled
-- grant as no grant at all. Granting nothing is the state of every existing
-- row, which is why there is no backfill here.
--
-- Additive only. No DROP, no UPDATE, no DELETE. Safe to re-run.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "alt_role"   "Role",
  ADD COLUMN IF NOT EXISTS "alt_branch" "Branch";

COMMENT ON COLUMN "users"."alt_role" IS
  'The role of a second job this login may switch into (NULL for almost everybody). Granted only by an admin; a cookie selects between this pair and the primary but can never widen either. Read/written by raw SQL in src/lib/users.ts, deliberately absent from the Prisma model.';

COMMENT ON COLUMN "users"."alt_branch" IS
  'The department of the second job. Meaningless without alt_role and cleared with it: src/lib/roleContext.ts treats a half-filled grant as no grant.';
