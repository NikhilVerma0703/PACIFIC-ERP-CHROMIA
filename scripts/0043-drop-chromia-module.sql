-- 0043 — Drop the previous (department-style) Chromia integration.
--
-- 0039 created 33 chromia_* tables and 19 chromia_* enum types on 2026-08-14 for
-- an integration wired as a DEPARTMENT (Branch.CHROMIA), which is not how a
-- shop-floor module is mounted in this ERP — Robo is a capped ROLE. That
-- integration has been removed from the codebase; this removes it from Neon so
-- 0044 can create the module fresh.
--
-- DESTRUCTIVE. Every chromia_* row goes, including any master data (locations,
-- stage definitions, defect types, recalibration reasons) that was hand-seeded.
-- The guard below refuses to run if ANY of the 33 tables holds a row, so this
-- cannot quietly delete work; if you mean it, export first, then comment the
-- guard out.
--
-- Run order: 0043 (this) -> 0044 (create) -> 0045 (move any legacy CHROMIA-branch
-- logins onto the new role). Nothing here depends on the application being
-- stopped: the new code never reads these tables, and the old code is gone.
--
-- Ordering inside the script: one DROP TABLE ... CASCADE for all 33 tables, so
-- the foreign keys between them do not dictate an order; then the enum types,
-- which are only droppable once no column uses them. Wrapped in an explicit
-- transaction so a guard that fires leaves nothing half-dropped — psql does not
-- stop on error by default, and the guards are the point of this file.
--
-- (`prisma db execute` already wraps the file in a transaction of its own, so it
-- will log "there is already a transaction in progress" for the BEGIN below.
-- Expected and harmless; the explicit form is there for psql.)
--
-- Apply with either:
--   npx prisma db execute --file scripts/0043-drop-chromia-module.sql --schema prisma/schema.prisma
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/0043-drop-chromia-module.sql
--
-- Nothing outside the chromia_* namespace is named here. In particular the
-- legacy Airtable mirrors chromia_1 and chromia_par_1 (models Chromia1 /
-- ChromiaPar1) are NOT touched — they are a different thing that happens to
-- share the word.

BEGIN;

-- Notice — logins left on the retired CHROMIA department. They keep working
-- (Branch.CHROMIA is deliberately still in the Prisma enum, and middleware
-- contains them to /chromia), but they should move to the new role. 0045 does
-- that, and must run after 0044 has added the role.
DO $$ DECLARE n bigint; BEGIN
  SELECT count(*) INTO n FROM "users" WHERE "branch"::text = 'CHROMIA';
  IF n > 0 THEN
    RAISE NOTICE '% user(s) still on branch CHROMIA — run scripts/0045-migrate-chromia-branch-users.sql after 0044.', n;
  END IF;
END $$;

-- Guard — nothing here is recoverable once dropped.
DO $$
DECLARE
  t text;
  n bigint;
  found text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chromia_audit_log',
    'chromia_base_material',
    'chromia_batch',
    'chromia_cooling_detail',
    'chromia_customer',
    'chromia_defect_type',
    'chromia_design',
    'chromia_dispatch',
    'chromia_grade_decision',
    'chromia_import_batch',
    'chromia_incoming_detail',
    'chromia_location',
    'chromia_machine',
    'chromia_moulding_detail',
    'chromia_polishing_detail',
    'chromia_primer_detail',
    'chromia_printing_detail',
    'chromia_process_cycle',
    'chromia_qc_defect',
    'chromia_qc_record',
    'chromia_recalibration_cycle',
    'chromia_recalibration_reason',
    'chromia_sample_cutting',
    'chromia_slab',
    'chromia_slab_event',
    'chromia_slab_movement',
    'chromia_stage_definition',
    'chromia_stage_record',
    'chromia_stock_entry',
    'chromia_supplier',
    'chromia_user',
    'chromia_uv_polishing_detail',
    'chromia_waste_record'
  ] LOOP
    IF to_regclass(quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n > 0 THEN found := found || t || '=' || n || ' '; END IF;
    END IF;
  END LOOP;
  IF found <> '' THEN
    RAISE EXCEPTION 'Chromia tables are not empty (%). Export what you need, then comment out this guard to proceed.', found;
  END IF;
END $$;

DROP TABLE IF EXISTS
  "chromia_audit_log",
  "chromia_base_material",
  "chromia_batch",
  "chromia_cooling_detail",
  "chromia_customer",
  "chromia_defect_type",
  "chromia_design",
  "chromia_dispatch",
  "chromia_grade_decision",
  "chromia_import_batch",
  "chromia_incoming_detail",
  "chromia_location",
  "chromia_machine",
  "chromia_moulding_detail",
  "chromia_polishing_detail",
  "chromia_primer_detail",
  "chromia_printing_detail",
  "chromia_process_cycle",
  "chromia_qc_defect",
  "chromia_qc_record",
  "chromia_recalibration_cycle",
  "chromia_recalibration_reason",
  "chromia_sample_cutting",
  "chromia_slab",
  "chromia_slab_event",
  "chromia_slab_movement",
  "chromia_stage_definition",
  "chromia_stage_record",
  "chromia_stock_entry",
  "chromia_supplier",
  "chromia_user",
  "chromia_uv_polishing_detail",
  "chromia_waste_record"
CASCADE;

DROP TYPE IF EXISTS "chromia_audit_action";
DROP TYPE IF EXISTS "chromia_cycle_status";
DROP TYPE IF EXISTS "chromia_defect_severity";
DROP TYPE IF EXISTS "chromia_disposition";
DROP TYPE IF EXISTS "chromia_import_status";
DROP TYPE IF EXISTS "chromia_location_type";
DROP TYPE IF EXISTS "chromia_machine_type";
DROP TYPE IF EXISTS "chromia_movement_reason";
DROP TYPE IF EXISTS "chromia_print_result";
DROP TYPE IF EXISTS "chromia_process_stage";
DROP TYPE IF EXISTS "chromia_qc_check_result";
DROP TYPE IF EXISTS "chromia_qc_verdict";
DROP TYPE IF EXISTS "chromia_recalibration_status";
DROP TYPE IF EXISTS "chromia_role";
DROP TYPE IF EXISTS "chromia_slab_event_type";
DROP TYPE IF EXISTS "chromia_slab_grade";
DROP TYPE IF EXISTS "chromia_slab_status";
DROP TYPE IF EXISTS "chromia_stage_status";
DROP TYPE IF EXISTS "chromia_user_status";

COMMIT;

-- The Branch enum keeps its 'CHROMIA' value, on purpose. PostgreSQL cannot drop
-- an enum value, and prisma/schema.prisma still lists it so that any users row
-- created by the old integration still decodes — Prisma throws on reading a row
-- whose enum value the client does not know. It is offered nowhere in the UI
-- (BRANCHES and the admin assignable lists no longer contain it), so no new one
-- can be created.
--
-- Once 0045 has run and `SELECT count(*) FROM users WHERE branch::text='CHROMIA'`
-- is 0, the value can be retired from both sides — code first (src/lib/branch.ts
-- + the Branch enum in schema.prisma), then, in its own maintenance window, the
-- database (the DROP/SET DEFAULT pair is required: users.branch is NOT NULL
-- DEFAULT 'SHOP_FLOOR', and the default cannot be cast automatically):
--   BEGIN;
--   ALTER TABLE "users" ALTER COLUMN "branch" DROP DEFAULT;
--   ALTER TYPE "Branch" RENAME TO "Branch_old";
--   CREATE TYPE "Branch" AS ENUM ('SHOP_FLOOR','OFFICE','FABRICATION','INTERNATIONAL_SALES');
--   ALTER TABLE "users" ALTER COLUMN "branch" TYPE "Branch" USING "branch"::text::"Branch";
--   ALTER TABLE "users" ALTER COLUMN "branch" SET DEFAULT 'SHOP_FLOOR';
--   DROP TYPE "Branch_old";
--   COMMIT;
