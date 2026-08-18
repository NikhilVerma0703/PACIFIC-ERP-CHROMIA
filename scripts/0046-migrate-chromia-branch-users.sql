-- 0046 — Move any login left on the retired CHROMIA department onto the new
-- role. Run AFTER 0045: it is 0045 that adds 'CHROMIA' to the Role enum, and
-- PostgreSQL will not let a new enum value be used in the transaction that
-- added it.
--
-- The old integration made Chromia a department (branch = CHROMIA, with the
-- shared LINE_MANAGER / INCHARGE / OPERATOR ranks). The new one makes it a
-- capped role on the Shop Floor, exactly like Robo. This is the one-way door
-- between the two, and it is deliberately narrow: only rows whose branch is
-- CHROMIA are touched, and each becomes a Shop Floor login with role CHROMIA.
--
-- Ranks do not survive, because the new module does not have them: a Chromia
-- login sees the module and nothing else, and anything above that is an admin.
-- If a Chromia manager needs ERP-wide rights, give them ADMIN explicitly after
-- this runs — do not leave them on the old branch.
--
-- Apply with:
--   npx prisma db execute --file scripts/0046-migrate-chromia-branch-users.sql --schema prisma/schema.prisma
--
-- Idempotent: after the first run there is nothing left matching the WHERE.

BEGIN;

DO $$ DECLARE n bigint; BEGIN
  SELECT count(*) INTO n FROM "users" WHERE "branch"::text = 'CHROMIA';
  RAISE NOTICE 'Moving % login(s) from branch CHROMIA to role CHROMIA on SHOP_FLOOR.', n;
END $$;

UPDATE "users"
   SET "branch" = 'SHOP_FLOOR',
       "role"   = 'CHROMIA',
       "station" = NULL
 WHERE "branch"::text = 'CHROMIA';

COMMIT;

-- Verify: this must return 0.
--   SELECT count(*) FROM "users" WHERE "branch"::text = 'CHROMIA';
--
-- Once it does, the transitional clauses can go — all of them, together:
--   src/auth.config.ts — the `branch === "CHROMIA"` escape
--   src/middleware.ts  — the two `branch === "CHROMIA"` arms
--   src/lib/chromia/tier.ts — the branch arm of chromiaTierOf
--   src/components/Nav.tsx — the branch arm of the Chromia nav takeover
--   src/app/admin/users/page.tsx — the `visible` list (fold back into assignable)
--   src/lib/consumables/access.ts — the `|| b === "CHROMIA"` clause
--   tests/chromiaAccess.test.ts — the transitional test
--   src/lib/branch.ts  — the CHROMIA member of BranchName and BRANCH_LABEL
--   prisma/schema.prisma — CHROMIA in enum Branch (then the DB-side recipe in
--                          the footer of 0044)
