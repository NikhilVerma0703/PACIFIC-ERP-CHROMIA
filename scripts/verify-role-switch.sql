-- =====================================================================
-- verify-role-switch.sql   (READ ONLY — nothing is written)
--
-- The DATA half of testing the dual-role switcher. Run it before you
-- click anything, and again after, against the database DATABASE_URL
-- points at:
--
--   psql "postgresql://postgres:postgres@localhost:5432/pacific_erp" \
--        -f scripts/verify-role-switch.sql
-- =====================================================================

\echo '=== 1. Are the columns there? (expect 2 rows) ==='
SELECT column_name, udt_name AS type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'users' AND column_name IN ('alt_role','alt_branch')
ORDER  BY column_name;

\echo ''
\echo '=== 2. WHO HOLDS TWO JOBS ==='
\echo '    Both halves must be set. A row with one half filled is NOT a'
\echo '    grant - lib/roleContext.ts treats it as none - so it appears'
\echo '    here as BROKEN and the switcher will not show for that login.'
SELECT email,
       role::text        AS primary_role,
       branch::text      AS primary_branch,
       alt_role::text    AS second_role,
       alt_branch::text  AS second_branch,
       session_version,
       CASE
         WHEN alt_role IS NULL AND alt_branch IS NULL              THEN 'one job'
         WHEN alt_role IS NULL OR  alt_branch IS NULL              THEN 'BROKEN - half a grant'
         WHEN alt_role = role AND alt_branch = branch              THEN 'BROKEN - same as primary'
         WHEN branch::text = 'INTERNATIONAL_SALES'
           OR alt_branch::text = 'INTERNATIONAL_SALES'             THEN 'BROKEN - sales cannot hold two'
         ELSE 'two jobs - switcher shows'
       END AS verdict
FROM   users
WHERE  active = true
ORDER  BY (alt_role IS NOT NULL) DESC, email;

\echo ''
\echo '=== 3. THE ESCALATION CHECK (audit C1) ==='
\echo '    A login ranked by its PRIMARY alone that is really more senior'
\echo '    through its SECOND job. canManageTarget now ranks by the higher'
\echo '    of the two; this lists who that changes the answer for.'
WITH r(name, rank) AS (VALUES
  ('OPERATOR',1),('STORE',1),('MAINTENANCE',1),('SALES',1),('COMMERCIAL',1),
  ('ROBO',1),('CHROMIA',1),('SAMPLING',1),
  ('INCHARGE',2),('FINANCE',2),('ACCOUNTS',2),
  ('LINE_MANAGER',3),('ADMIN',4))
SELECT u.email,
       u.role::text     AS primary_role,   rp.rank AS primary_rank,
       u.alt_role::text AS second_role,    ra.rank AS second_rank,
       greatest(rp.rank, coalesce(ra.rank, 0)) AS effective_rank
FROM   users u
JOIN   r rp ON rp.name = u.role::text
LEFT   JOIN r ra ON ra.name = u.alt_role::text
WHERE  u.alt_role IS NOT NULL
  AND  coalesce(ra.rank, 0) > rp.rank
ORDER  BY 6 DESC;

\echo ''
\echo '=== 4. Does the Role enum know every role in use? ==='
\echo '    A grant of a role the enum lacks fails with 22P02, and the'
\echo '    screen now says so by name instead of blaming scripts/0052.'
SELECT enumlabel AS role FROM pg_enum e
JOIN   pg_type t ON t.oid = e.enumtypid
WHERE  t.typname = 'Role' ORDER BY e.enumsortorder;

\echo ''
\echo '=== 5. AFTER YOU REVOKE A GRANT ==='
\echo '    session_version must have gone UP for that user. That is what'
\echo '    signs them out of every device; without it a revoked second'
\echo '    job stays usable for up to 8 hours (the cookie max-age).'
\echo '    Note the number in section 2 before revoking, and compare.'
