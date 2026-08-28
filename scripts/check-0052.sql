-- Run against the SAME database DATABASE_URL points at.
--   docker:  psql "postgresql://postgres:postgres@localhost:5432/pacific_erp" -f check-0052.sql
--   Neon:    paste into the Neon SQL editor

-- 1. Which database am I actually in?
SELECT current_database() AS db, current_user AS role, version() AS server;

-- 2. Do the two columns exist?  Expect 2 rows. Zero rows = 0052 not applied HERE.
SELECT column_name, data_type, udt_name
FROM   information_schema.columns
WHERE  table_name = 'users' AND column_name IN ('alt_role','alt_branch')
ORDER  BY column_name;

-- 3. Does the Role enum know every role the app uses?
--    SAMPLING arrives with scripts/0051-sampling-and-catalogue.sql.
SELECT enumlabel AS role FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'Role' ORDER BY e.enumsortorder;

-- 4. And the Branch enum?
SELECT enumlabel AS branch FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'Branch' ORDER BY e.enumsortorder;

-- 5. Who currently holds a second job? (Fails if step 2 returned nothing.)
SELECT email, role::text AS primary_role, branch::text AS primary_branch,
       alt_role::text, alt_branch::text
FROM   users WHERE alt_role IS NOT NULL OR alt_branch IS NOT NULL;
