-- 0079: what the owner's 31 answers of 2026-09-07 need from the database.
--       docs/commercial-module/DECISIONS.md is the record; this is its schema.
--
--   * A COMMERCIAL_MANAGER role (answer 9: "a commercial manager role"; answers
--     10 and 24 name what it does — approve the checklist, cancel a PI).
--   * Receipts on an order (answer 29: "yes record"), because answer 2 makes
--     the first ADVANCE receipt the one thing that lets a truck leave.
--   * A design master (answer 20: "each design has a different code, I will
--     supply them"; answer 13: light/dark sequencing needs a shade per design).
--   * The production plan's editable figures and its change log (answer 13:
--     "admin can add, remove or edit the hours or the number of slabs … if
--     something is decreased from the planned, put it on another table").
--   * The unit a packing list prints in (answer 17: switch cm to inches).
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0079-commercial-decisions.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. 1 enum value on Role, 3 new tables, 2 enum types,
-- 5 new nullable/defaulted columns on 2 existing tables, 4 indexes, 3 foreign
-- keys. No backfill, no UPDATE, no DROP. Every commercial_* table holds 0 rows
-- today (verified 2026-09-07), so nothing existing is touched in practice
-- either. Re-running is a no-op.
--
-- THE ROLE VALUE CANNOT BE USED IN THIS SCRIPT (Postgres refuses a new enum
-- label inside the transaction that adds it — scripts/0051 learned this). It
-- is added first, standing alone, and nothing below references it.
--
-- Read-only check before and after:
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='Role' ORDER BY enumsortorder;
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('commercial_receipt','commercial_design_code','commercial_production_plan_change');

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMMERCIAL_MANAGER';

DO $$ BEGIN
  CREATE TYPE "commercial_receipt_kind" AS ENUM ('ADVANCE', 'CAD', 'BALANCE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "commercial_plan_change_status" AS ENUM ('OPEN', 'ADDED_BACK', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────── receipts ───────────────────────────────────────
-- Money received against an order. ADVANCE is the kind that opens dispatch.
CREATE TABLE IF NOT EXISTS commercial_receipt (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL,
  kind             "commercial_receipt_kind" NOT NULL,
  amount           NUMERIC(16,2) NOT NULL,
  currency         TEXT NOT NULL,
  received_at      DATE NOT NULL,
  mode             TEXT,                                   -- TT / cheque / cash / LC …
  reference        TEXT,                                   -- bank ref / UTR
  notes            TEXT,
  recorded_by_id   TEXT,                                   -- -> users.id (no hard FK)
  recorded_by_name TEXT,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS commercial_receipt_order_id_idx ON commercial_receipt (order_id);
DO $$ BEGIN
  ALTER TABLE commercial_receipt ADD CONSTRAINT commercial_receipt_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES commercial_order(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────── design master ──────────────────────────────────
-- One row per canonical finished-goods design name: the customer-facing item
-- code the owner will supply, and the shade the planning queue orders by.
CREATE TABLE IF NOT EXISTS commercial_design_code (
  design           TEXT PRIMARY KEY,                       -- canonical FG design name
  code             TEXT,                                   -- the owner's code, e.g. OSWT10305A
  shade            TEXT,                                   -- LIGHT / MEDIUM / DARK
  shade_confirmed  BOOLEAN NOT NULL DEFAULT false,         -- false = a first guess from the name
  notes            TEXT,
  updated_by_id    TEXT,                                   -- -> users.id (no hard FK)
  updated_at       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_design_code_code_key ON commercial_design_code (code);

-- ───────────────────────────── the plan's own figures ─────────────────────────
ALTER TABLE commercial_production_request ADD COLUMN IF NOT EXISTS planned_slabs  INTEGER;
ALTER TABLE commercial_production_request ADD COLUMN IF NOT EXISTS planned_hours  NUMERIC(6,1);
ALTER TABLE commercial_production_request ADD COLUMN IF NOT EXISTS cleaning_hours NUMERIC(4,1);
ALTER TABLE commercial_production_request ADD COLUMN IF NOT EXISTS shade          TEXT;
COMMENT ON COLUMN commercial_production_request.planned_slabs  IS 'What the planner intends to run; starts equal to qty_short. Editable by ADMIN / COMMERCIAL_MANAGER; a reduction is logged in commercial_production_plan_change.';
COMMENT ON COLUMN commercial_production_request.cleaning_hours IS 'Cleaning before this run: 3 by default, 6 when the previous row is DARK and this one is LIGHT. Editable.';

-- What was planned and then taken away, so it is never simply gone.
CREATE TABLE IF NOT EXISTS commercial_production_plan_change (
  id             TEXT PRIMARY KEY,
  request_id     TEXT NOT NULL,
  field          TEXT NOT NULL,                            -- plannedSlabs / plannedHours / cleaningHours
  from_value     NUMERIC(10,1),
  to_value       NUMERIC(10,1),
  delta          NUMERIC(10,1) NOT NULL,                   -- to - from (negative = reduced)
  reason         TEXT,
  status         "commercial_plan_change_status" NOT NULL DEFAULT 'OPEN',
  changed_by_id  TEXT,                                     -- -> users.id (no hard FK)
  changed_by_name TEXT,
  changed_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at    TIMESTAMP(3),
  resolved_by_id TEXT                                      -- -> users.id (no hard FK)
);
CREATE INDEX IF NOT EXISTS commercial_production_plan_change_request_id_idx ON commercial_production_plan_change (request_id);
-- The "not planned" panel: open reductions, newest first.
CREATE INDEX IF NOT EXISTS commercial_production_plan_change_status_changed_at_idx ON commercial_production_plan_change (status, changed_at);
DO $$ BEGIN
  ALTER TABLE commercial_production_plan_change ADD CONSTRAINT commercial_production_plan_change_request_id_fkey
    FOREIGN KEY (request_id) REFERENCES commercial_production_request(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────── packing list unit ──────────────────────────────
ALTER TABLE commercial_packing_list ADD COLUMN IF NOT EXISTS measurement_unit TEXT NOT NULL DEFAULT 'cm';
COMMENT ON COLUMN commercial_packing_list.measurement_unit IS 'cm or in: the unit the packing and measurement lists print. Answer 17.';
