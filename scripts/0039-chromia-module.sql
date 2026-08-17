-- 0039 — Chromia module: 33 tables + 19 enum types (all chromia_-prefixed)
-- and the CHROMIA value on the Branch enum. Merged from the CHROMIA_MODULE
-- standalone app; the Prisma models live at the foot of prisma/schema.prisma
-- under the CHROMIA MODULE banner.
--
-- WHY a script and not db push / migrate dev: the live Neon DB is the source
-- of truth and has drifted from schema.prisma in known-safe ways (FK renames,
-- updated_at DROP DEFAULT on Sales tables, 3 index tweaks). A push would try
-- to "fix" that drift; this script is the chromia-only slice of
--   npx prisma migrate diff --from-url <DATABASE_URL> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- filtered and VERIFIED (scratchpad filter0039.py) so that every statement
-- names only chromia_* objects — zero DROPs, zero statements touching any
-- existing table. The module's own 8 migrations are history, not replayed.
--
-- User attribution columns (*_by_id, user_id, operator_id, inspector_id) are
-- plain TEXT holding users.id with NO foreign key — the Sales precedent —
-- so no FK ties Chromia rows to the User table. chromia_user is the module's
-- dormant login table, kept but unused (logins are ERP users, branch CHROMIA).
--
-- APPLIED to Neon 2026-08-14 with:
--   npx prisma db execute --file scripts/0039-chromia-module.sql --schema prisma/schema.prisma
-- Idempotent — safe to re-run: types and FKs are wrapped in duplicate_object
-- guards, tables and indexes use IF NOT EXISTS, the enum value uses
-- ADD VALUE IF NOT EXISTS. All statements are ADDITIVE ONLY.

ALTER TYPE "Branch" ADD VALUE IF NOT EXISTS 'CHROMIA';

DO $$ BEGIN
  CREATE TYPE "chromia_role" AS ENUM ('ADMIN', 'PRODUCTION_MANAGER', 'SUPERVISOR', 'OPERATOR', 'QUALITY_INSPECTOR', 'STORE_KEEPER', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_user_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_process_stage" AS ENUM ('INCOMING', 'INCOMING_DETAILS', 'BASE_PRIMER', 'PRINTING', 'MOULDING', 'COOLING', 'POLISHING', 'UV_POLISHING', 'QUALITY_CHECK', 'GRADE_DECISION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_stage_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_slab_status" AS ENUM ('RECEIVED', 'IN_PROCESS', 'UNDER_INSPECTION', 'GRADED', 'OUT_FOR_RECALIBRATION', 'RECEIVED_FROM_RECALIBRATION', 'IN_STOCK', 'SAMPLE_CUT', 'DISPATCHED', 'WASTE', 'ON_HOLD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_cycle_status" AS ENUM ('ACTIVE', 'COMPLETED', 'ABORTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_slab_grade" AS ENUM ('A', 'B', 'C');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_disposition" AS ENUM ('DISPATCH', 'STOCK', 'SAMPLE_CUTTING', 'RECALIBRATION', 'WASTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_print_result" AS ENUM ('FULLY_PRINTED', 'HALF_PRINT', 'BYPASSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_qc_verdict" AS ENUM ('PASS', 'CONDITIONAL_PASS', 'FAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_qc_check_result" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_defect_severity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_recalibration_status" AS ENUM ('PENDING_DISPATCH', 'SENT', 'AT_FACILITY', 'RECEIVED', 'RESTARTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_location_type" AS ENUM ('YARD', 'RACK', 'MACHINE_BAY', 'COOLING_ZONE', 'QC_AREA', 'DISPATCH_BAY', 'STOCK_RACK', 'SAMPLE_AREA', 'EXTERNAL_FACILITY', 'WASTE_AREA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_machine_type" AS ENUM ('PRIMER_LINE', 'PRINTER', 'MOULDING_PRESS', 'COOLING_RACK', 'POLISHING_LINE', 'UV_LINE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_movement_reason" AS ENUM ('INTAKE', 'STAGE_TRANSFER', 'QC_TRANSFER', 'RECALIBRATION_OUT', 'RECALIBRATION_IN', 'DISPATCH', 'STOCK_PUTAWAY', 'SAMPLE_CUTTING', 'WASTE_DISPOSAL', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_slab_event_type" AS ENUM ('SLAB_CREATED', 'STAGE_STARTED', 'STAGE_COMPLETED', 'STAGE_HELD', 'STAGE_RESUMED', 'CYCLE_STARTED', 'CYCLE_COMPLETED', 'QC_RECORDED', 'GRADE_ASSIGNED', 'RECALIBRATION_SENT', 'RECALIBRATION_RECEIVED', 'RECALIBRATION_RESTARTED', 'LOCATION_CHANGED', 'STATUS_CHANGED', 'DISPATCHED', 'STOCKED', 'SAMPLE_CUT', 'DECLARED_WASTE', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_import_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chromia_audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "chromia_user" (
    "id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "chromia_role" NOT NULL DEFAULT 'OPERATOR',
    "status" "chromia_user_status" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "shift" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_audit_log" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" "chromia_audit_action" NOT NULL,
    "user_id" TEXT,
    "changes" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chromia_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_base_material" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_thickness_mm" DECIMAL(18,3),
    "min_usable_thickness_mm" DECIMAL(18,3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_base_material_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_design" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "version" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_design_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_machine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "chromia_machine_type" NOT NULL,
    "stage" "chromia_process_stage",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_machine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "chromia_location_type" NOT NULL,
    "capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_stage_definition" (
    "id" TEXT NOT NULL,
    "stage" "chromia_process_stage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "expected_duration_minutes" INTEGER NOT NULL,
    "warn_after_minutes" INTEGER,
    "requires_machine" BOOLEAN NOT NULL DEFAULT false,
    "requires_operator" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_stage_definition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_defect_type" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin_stage" "chromia_process_stage",
    "default_severity" "chromia_defect_severity" NOT NULL DEFAULT 'MAJOR',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_defect_type_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_recalibration_reason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin_stage" "chromia_process_stage",
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_recalibration_reason_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_batch" (
    "id" TEXT NOT NULL,
    "batch_no" TEXT NOT NULL,
    "received_date" TIMESTAMP(3) NOT NULL,
    "total_slabs" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "base_material_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_batch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_slab" (
    "id" TEXT NOT NULL,
    "slab_no" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "base_material_id" TEXT NOT NULL,
    "planned_design_id" TEXT,
    "original_thickness_mm" DECIMAL(18,3),
    "current_thickness_mm" DECIMAL(18,3),
    "length_mm" DECIMAL(18,3),
    "width_mm" DECIMAL(18,3),
    "status" "chromia_slab_status" NOT NULL DEFAULT 'RECEIVED',
    "current_stage" "chromia_process_stage",
    "current_cycle_number" INTEGER NOT NULL DEFAULT 1,
    "current_location_id" TEXT,
    "current_grade" "chromia_slab_grade",
    "current_disposition" "chromia_disposition",
    "recalibration_count" INTEGER NOT NULL DEFAULT 0,
    "is_recalibration_out" BOOLEAN NOT NULL DEFAULT false,
    "received_date" TIMESTAMP(3) NOT NULL,
    "condition_on_arrival" TEXT,
    "remarks" TEXT,
    "legacy_source_file" TEXT,
    "legacy_sheet_name" TEXT,
    "legacy_source_row" INTEGER,
    "legacy_remark" TEXT,
    "import_batch_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "chromia_slab_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_process_cycle" (
    "id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "status" "chromia_cycle_status" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "slab_id" TEXT NOT NULL,
    "design_id" TEXT,
    "in_time" TIMESTAMP(3),
    "out_time" TIMESTAMP(3),
    "processing_minutes" INTEGER,
    "fully_printed_date" DATE,
    "print_result" "chromia_print_result",
    "final_grade" "chromia_slab_grade",
    "disposition" "chromia_disposition",
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_process_cycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_stage_record" (
    "id" TEXT NOT NULL,
    "stage" "chromia_process_stage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "chromia_stage_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "hold_minutes" INTEGER,
    "is_overdue" BOOLEAN NOT NULL DEFAULT false,
    "cycle_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,
    "operator_id" TEXT,
    "machine_id" TEXT,
    "location_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_stage_record_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_slab_event" (
    "id" TEXT NOT NULL,
    "event_type" "chromia_slab_event_type" NOT NULL,
    "slab_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "stage" "chromia_process_stage",
    "from_stage" "chromia_process_stage",
    "to_stage" "chromia_process_stage",
    "from_status" "chromia_slab_status",
    "to_status" "chromia_slab_status",
    "location_id" TEXT,
    "user_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "payload" JSONB,
    CONSTRAINT "chromia_slab_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_slab_movement" (
    "id" TEXT NOT NULL,
    "reason" "chromia_movement_reason" NOT NULL,
    "moved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "slab_id" TEXT NOT NULL,
    "from_location_id" TEXT,
    "to_location_id" TEXT NOT NULL,
    "moved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chromia_slab_movement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_incoming_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "confirmed_length_mm" DECIMAL(18,3),
    "confirmed_width_mm" DECIMAL(18,3),
    "confirmed_thickness_mm" DECIMAL(18,3),
    "material_grade" TEXT,
    "surface_condition" TEXT,
    "planned_production_date" TIMESTAMP(3),
    "planned_shift" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_incoming_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_primer_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "primer_type" TEXT,
    "primer_batch_code" TEXT,
    "coating_thickness_micron" DECIMAL(18,3),
    "drying_minutes" INTEGER,
    "ambient_temp_c" DECIMAL(18,3),
    "humidity_percent" DECIMAL(18,3),
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_primer_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_printing_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "design_id" TEXT,
    "file_name" TEXT,
    "print_result" "chromia_print_result",
    "fully_printed_at" TIMESTAMP(3),
    "bypassed_at" TIMESTAMP(3),
    "pass_count" INTEGER,
    "ink_set" TEXT,
    "colour_profile" TEXT,
    "colour_deviation" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_printing_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_moulding_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "mould_ref" TEXT,
    "temperature_c" DECIMAL(18,3),
    "pressure_bar" DECIMAL(18,3),
    "cycle_time_minutes" INTEGER,
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_moulding_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_cooling_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "required_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "cooling_zone" TEXT,
    "ambient_temp_c" DECIMAL(18,3),
    "stress_cracks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_cooling_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_polishing_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "grit_sequence" TEXT,
    "pass_count" INTEGER,
    "gloss_achieved" DECIMAL(18,3),
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_polishing_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_uv_polishing_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "coat_type" TEXT,
    "coat_batch_code" TEXT,
    "coat_count" INTEGER,
    "lamp_intensity" DECIMAL(18,3),
    "line_speed" DECIMAL(18,3),
    "cure_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "final_gloss" DECIMAL(18,3),
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_uv_polishing_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_qc_record" (
    "id" TEXT NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" "chromia_qc_verdict" NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,
    "inspector_id" TEXT,
    "print_quality_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "colour_match_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "surface_finish_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "gloss_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "dimensional_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "edge_condition_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "gloss_reading" DECIMAL(18,3),
    "colour_deviation" TEXT,
    "photo_urls" TEXT[],
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_qc_record_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_qc_defect" (
    "id" TEXT NOT NULL,
    "severity" "chromia_defect_severity" NOT NULL,
    "area_on_slab" TEXT,
    "description" TEXT,
    "photo_url" TEXT,
    "qc_record_id" TEXT NOT NULL,
    "defect_type_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chromia_qc_defect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_grade_decision" (
    "id" TEXT NOT NULL,
    "grade" "chromia_slab_grade" NOT NULL,
    "disposition" "chromia_disposition" NOT NULL,
    "reason" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "cycle_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "target_location_id" TEXT,
    "attempt_number_at_decision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_grade_decision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_recalibration_cycle" (
    "id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "chromia_recalibration_status" NOT NULL DEFAULT 'PENDING_DISPATCH',
    "slab_id" TEXT NOT NULL,
    "failed_cycle_id" TEXT,
    "restarted_cycle_id" TEXT,
    "reason_id" TEXT,
    "reason_notes" TEXT,
    "sent_date" TIMESTAMP(3),
    "expected_return_date" TIMESTAMP(3),
    "facility_name" TEXT,
    "gate_pass_no" TEXT,
    "transporter" TEXT,
    "vehicle_no" TEXT,
    "condition_on_send" TEXT,
    "issued_by_id" TEXT,
    "received_date" TIMESTAMP(3),
    "turnaround_days" INTEGER,
    "condition_on_return" TEXT,
    "work_accepted" BOOLEAN,
    "received_by_id" TEXT,
    "thickness_before_mm" DECIMAL(18,3),
    "thickness_after_mm" DECIMAL(18,3),
    "material_removed_mm" DECIMAL(18,3),
    "within_min_thickness" BOOLEAN,
    "photo_urls" TEXT[],
    "notes" TEXT,
    "restarted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_recalibration_cycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_dispatch" (
    "id" TEXT NOT NULL,
    "dispatch_date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "order_no" TEXT,
    "invoice_no" TEXT,
    "vehicle_no" TEXT,
    "destination" TEXT,
    "notes" TEXT,
    "slab_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "dispatched_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_dispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_stock_entry" (
    "id" TEXT NOT NULL,
    "stock_date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "released_at" TIMESTAMP(3),
    "notes" TEXT,
    "slab_id" TEXT NOT NULL,
    "location_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_stock_entry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_sample_cutting" (
    "id" TEXT NOT NULL,
    "cut_date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "pieces_produced" INTEGER,
    "purpose" TEXT,
    "destination" TEXT,
    "notes" TEXT,
    "slab_id" TEXT NOT NULL,
    "done_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_sample_cutting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_waste_record" (
    "id" TEXT NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slab_id" TEXT NOT NULL,
    "cycles_consumed" INTEGER NOT NULL DEFAULT 0,
    "recalibrations_attempted" INTEGER NOT NULL DEFAULT 0,
    "final_defect_type_id" TEXT,
    "root_cause" TEXT,
    "disposal_ref" TEXT,
    "notes" TEXT,
    "authorised_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_waste_record_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chromia_import_batch" (
    "id" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "sheet_name" TEXT,
    "period_label" TEXT,
    "status" "chromia_import_status" NOT NULL DEFAULT 'PENDING',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_log" JSONB,
    "notes" TEXT,
    "imported_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chromia_import_batch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_user_employee_code_key" ON "chromia_user"("employee_code");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_user_email_key" ON "chromia_user"("email");

CREATE INDEX IF NOT EXISTS "chromia_user_role_status_idx" ON "chromia_user"("role", "status");

CREATE INDEX IF NOT EXISTS "chromia_user_deleted_at_idx" ON "chromia_user"("deleted_at");

CREATE INDEX IF NOT EXISTS "chromia_audit_log_entity_entity_id_idx" ON "chromia_audit_log"("entity", "entity_id");

CREATE INDEX IF NOT EXISTS "chromia_audit_log_user_id_idx" ON "chromia_audit_log"("user_id");

CREATE INDEX IF NOT EXISTS "chromia_audit_log_occurred_at_idx" ON "chromia_audit_log"("occurred_at");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_base_material_code_key" ON "chromia_base_material"("code");

CREATE INDEX IF NOT EXISTS "chromia_base_material_is_active_idx" ON "chromia_base_material"("is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_design_code_key" ON "chromia_design"("code");

CREATE INDEX IF NOT EXISTS "chromia_design_is_active_idx" ON "chromia_design"("is_active");

CREATE INDEX IF NOT EXISTS "chromia_design_file_name_idx" ON "chromia_design"("file_name");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_machine_code_key" ON "chromia_machine"("code");

CREATE INDEX IF NOT EXISTS "chromia_machine_type_is_active_idx" ON "chromia_machine"("type", "is_active");

CREATE INDEX IF NOT EXISTS "chromia_machine_stage_idx" ON "chromia_machine"("stage");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_location_code_key" ON "chromia_location"("code");

CREATE INDEX IF NOT EXISTS "chromia_location_type_is_active_idx" ON "chromia_location"("type", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_stage_definition_stage_key" ON "chromia_stage_definition"("stage");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_stage_definition_sequence_key" ON "chromia_stage_definition"("sequence");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_defect_type_code_key" ON "chromia_defect_type"("code");

CREATE INDEX IF NOT EXISTS "chromia_defect_type_origin_stage_is_active_idx" ON "chromia_defect_type"("origin_stage", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_recalibration_reason_code_key" ON "chromia_recalibration_reason"("code");

CREATE INDEX IF NOT EXISTS "chromia_recalibration_reason_is_active_idx" ON "chromia_recalibration_reason"("is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_supplier_code_key" ON "chromia_supplier"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_customer_code_key" ON "chromia_customer"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_batch_batch_no_key" ON "chromia_batch"("batch_no");

CREATE INDEX IF NOT EXISTS "chromia_batch_received_date_idx" ON "chromia_batch"("received_date");

CREATE INDEX IF NOT EXISTS "chromia_batch_base_material_id_idx" ON "chromia_batch"("base_material_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_slab_slab_no_key" ON "chromia_slab"("slab_no");

CREATE INDEX IF NOT EXISTS "chromia_slab_status_idx" ON "chromia_slab"("status");

CREATE INDEX IF NOT EXISTS "chromia_slab_status_current_stage_idx" ON "chromia_slab"("status", "current_stage");

CREATE INDEX IF NOT EXISTS "chromia_slab_current_stage_idx" ON "chromia_slab"("current_stage");

CREATE INDEX IF NOT EXISTS "chromia_slab_batch_id_idx" ON "chromia_slab"("batch_id");

CREATE INDEX IF NOT EXISTS "chromia_slab_current_location_id_idx" ON "chromia_slab"("current_location_id");

CREATE INDEX IF NOT EXISTS "chromia_slab_is_recalibration_out_idx" ON "chromia_slab"("is_recalibration_out");

CREATE INDEX IF NOT EXISTS "chromia_slab_received_date_idx" ON "chromia_slab"("received_date");

CREATE INDEX IF NOT EXISTS "chromia_slab_deleted_at_idx" ON "chromia_slab"("deleted_at");

CREATE INDEX IF NOT EXISTS "chromia_process_cycle_status_idx" ON "chromia_process_cycle"("status");

CREATE INDEX IF NOT EXISTS "chromia_process_cycle_slab_id_idx" ON "chromia_process_cycle"("slab_id");

CREATE INDEX IF NOT EXISTS "chromia_process_cycle_out_time_idx" ON "chromia_process_cycle"("out_time");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_process_cycle_slab_id_cycle_number_key" ON "chromia_process_cycle"("slab_id", "cycle_number");

CREATE INDEX IF NOT EXISTS "chromia_stage_record_slab_id_stage_idx" ON "chromia_stage_record"("slab_id", "stage");

CREATE INDEX IF NOT EXISTS "chromia_stage_record_stage_status_idx" ON "chromia_stage_record"("stage", "status");

CREATE INDEX IF NOT EXISTS "chromia_stage_record_status_started_at_idx" ON "chromia_stage_record"("status", "started_at");

CREATE INDEX IF NOT EXISTS "chromia_stage_record_operator_id_idx" ON "chromia_stage_record"("operator_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_stage_record_cycle_id_stage_key" ON "chromia_stage_record"("cycle_id", "stage");

CREATE INDEX IF NOT EXISTS "chromia_slab_event_slab_id_occurred_at_idx" ON "chromia_slab_event"("slab_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "chromia_slab_event_event_type_occurred_at_idx" ON "chromia_slab_event"("event_type", "occurred_at");

CREATE INDEX IF NOT EXISTS "chromia_slab_event_cycle_id_idx" ON "chromia_slab_event"("cycle_id");

CREATE INDEX IF NOT EXISTS "chromia_slab_movement_slab_id_moved_at_idx" ON "chromia_slab_movement"("slab_id", "moved_at");

CREATE INDEX IF NOT EXISTS "chromia_slab_movement_to_location_id_idx" ON "chromia_slab_movement"("to_location_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_incoming_detail_stage_record_id_key" ON "chromia_incoming_detail"("stage_record_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_primer_detail_stage_record_id_key" ON "chromia_primer_detail"("stage_record_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_printing_detail_stage_record_id_key" ON "chromia_printing_detail"("stage_record_id");

CREATE INDEX IF NOT EXISTS "chromia_printing_detail_print_result_idx" ON "chromia_printing_detail"("print_result");

CREATE INDEX IF NOT EXISTS "chromia_printing_detail_design_id_idx" ON "chromia_printing_detail"("design_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_moulding_detail_stage_record_id_key" ON "chromia_moulding_detail"("stage_record_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_cooling_detail_stage_record_id_key" ON "chromia_cooling_detail"("stage_record_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_polishing_detail_stage_record_id_key" ON "chromia_polishing_detail"("stage_record_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_uv_polishing_detail_stage_record_id_key" ON "chromia_uv_polishing_detail"("stage_record_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_qc_record_cycle_id_key" ON "chromia_qc_record"("cycle_id");

CREATE INDEX IF NOT EXISTS "chromia_qc_record_slab_id_inspected_at_idx" ON "chromia_qc_record"("slab_id", "inspected_at");

CREATE INDEX IF NOT EXISTS "chromia_qc_record_verdict_inspected_at_idx" ON "chromia_qc_record"("verdict", "inspected_at");

CREATE INDEX IF NOT EXISTS "chromia_qc_record_inspector_id_idx" ON "chromia_qc_record"("inspector_id");

CREATE INDEX IF NOT EXISTS "chromia_qc_defect_qc_record_id_idx" ON "chromia_qc_defect"("qc_record_id");

CREATE INDEX IF NOT EXISTS "chromia_qc_defect_defect_type_id_idx" ON "chromia_qc_defect"("defect_type_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_grade_decision_cycle_id_key" ON "chromia_grade_decision"("cycle_id");

CREATE INDEX IF NOT EXISTS "chromia_grade_decision_slab_id_decided_at_idx" ON "chromia_grade_decision"("slab_id", "decided_at");

CREATE INDEX IF NOT EXISTS "chromia_grade_decision_grade_decided_at_idx" ON "chromia_grade_decision"("grade", "decided_at");

CREATE INDEX IF NOT EXISTS "chromia_grade_decision_disposition_idx" ON "chromia_grade_decision"("disposition");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_recalibration_cycle_failed_cycle_id_key" ON "chromia_recalibration_cycle"("failed_cycle_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_recalibration_cycle_restarted_cycle_id_key" ON "chromia_recalibration_cycle"("restarted_cycle_id");

CREATE INDEX IF NOT EXISTS "chromia_recalibration_cycle_status_sent_date_idx" ON "chromia_recalibration_cycle"("status", "sent_date");

CREATE INDEX IF NOT EXISTS "chromia_recalibration_cycle_slab_id_idx" ON "chromia_recalibration_cycle"("slab_id");

CREATE INDEX IF NOT EXISTS "chromia_recalibration_cycle_reason_id_idx" ON "chromia_recalibration_cycle"("reason_id");

CREATE INDEX IF NOT EXISTS "chromia_recalibration_cycle_received_date_idx" ON "chromia_recalibration_cycle"("received_date");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_recalibration_cycle_slab_id_attempt_number_key" ON "chromia_recalibration_cycle"("slab_id", "attempt_number");

CREATE INDEX IF NOT EXISTS "chromia_dispatch_dispatch_date_idx" ON "chromia_dispatch"("dispatch_date");

CREATE INDEX IF NOT EXISTS "chromia_dispatch_slab_id_idx" ON "chromia_dispatch"("slab_id");

CREATE INDEX IF NOT EXISTS "chromia_stock_entry_stock_date_idx" ON "chromia_stock_entry"("stock_date");

CREATE INDEX IF NOT EXISTS "chromia_stock_entry_slab_id_idx" ON "chromia_stock_entry"("slab_id");

CREATE INDEX IF NOT EXISTS "chromia_sample_cutting_cut_date_idx" ON "chromia_sample_cutting"("cut_date");

CREATE INDEX IF NOT EXISTS "chromia_sample_cutting_slab_id_idx" ON "chromia_sample_cutting"("slab_id");

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_waste_record_slab_id_key" ON "chromia_waste_record"("slab_id");

CREATE INDEX IF NOT EXISTS "chromia_waste_record_declared_at_idx" ON "chromia_waste_record"("declared_at");

CREATE INDEX IF NOT EXISTS "chromia_import_batch_status_idx" ON "chromia_import_batch"("status");

DO $$ BEGIN
  ALTER TABLE "chromia_machine" ADD CONSTRAINT "chromia_machine_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_location" ADD CONSTRAINT "chromia_location_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_batch" ADD CONSTRAINT "chromia_batch_base_material_id_fkey" FOREIGN KEY ("base_material_id") REFERENCES "chromia_base_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_batch" ADD CONSTRAINT "chromia_batch_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "chromia_supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "chromia_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_base_material_id_fkey" FOREIGN KEY ("base_material_id") REFERENCES "chromia_base_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_planned_design_id_fkey" FOREIGN KEY ("planned_design_id") REFERENCES "chromia_design"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "chromia_import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_process_cycle" ADD CONSTRAINT "chromia_process_cycle_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_process_cycle" ADD CONSTRAINT "chromia_process_cycle_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "chromia_design"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "chromia_machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab_event" ADD CONSTRAINT "chromia_slab_event_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab_event" ADD CONSTRAINT "chromia_slab_event_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab_event" ADD CONSTRAINT "chromia_slab_event_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab_movement" ADD CONSTRAINT "chromia_slab_movement_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab_movement" ADD CONSTRAINT "chromia_slab_movement_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_slab_movement" ADD CONSTRAINT "chromia_slab_movement_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "chromia_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_incoming_detail" ADD CONSTRAINT "chromia_incoming_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_primer_detail" ADD CONSTRAINT "chromia_primer_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_printing_detail" ADD CONSTRAINT "chromia_printing_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_printing_detail" ADD CONSTRAINT "chromia_printing_detail_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "chromia_design"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_moulding_detail" ADD CONSTRAINT "chromia_moulding_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_cooling_detail" ADD CONSTRAINT "chromia_cooling_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_polishing_detail" ADD CONSTRAINT "chromia_polishing_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_uv_polishing_detail" ADD CONSTRAINT "chromia_uv_polishing_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_qc_record" ADD CONSTRAINT "chromia_qc_record_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_qc_record" ADD CONSTRAINT "chromia_qc_record_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_qc_defect" ADD CONSTRAINT "chromia_qc_defect_qc_record_id_fkey" FOREIGN KEY ("qc_record_id") REFERENCES "chromia_qc_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_qc_defect" ADD CONSTRAINT "chromia_qc_defect_defect_type_id_fkey" FOREIGN KEY ("defect_type_id") REFERENCES "chromia_defect_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_grade_decision" ADD CONSTRAINT "chromia_grade_decision_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_grade_decision" ADD CONSTRAINT "chromia_grade_decision_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_grade_decision" ADD CONSTRAINT "chromia_grade_decision_target_location_id_fkey" FOREIGN KEY ("target_location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_failed_cycle_id_fkey" FOREIGN KEY ("failed_cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_restarted_cycle_id_fkey" FOREIGN KEY ("restarted_cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "chromia_recalibration_reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_dispatch" ADD CONSTRAINT "chromia_dispatch_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_dispatch" ADD CONSTRAINT "chromia_dispatch_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "chromia_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_stock_entry" ADD CONSTRAINT "chromia_stock_entry_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_stock_entry" ADD CONSTRAINT "chromia_stock_entry_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_sample_cutting" ADD CONSTRAINT "chromia_sample_cutting_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_waste_record" ADD CONSTRAINT "chromia_waste_record_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chromia_waste_record" ADD CONSTRAINT "chromia_waste_record_final_defect_type_id_fkey" FOREIGN KEY ("final_defect_type_id") REFERENCES "chromia_defect_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
