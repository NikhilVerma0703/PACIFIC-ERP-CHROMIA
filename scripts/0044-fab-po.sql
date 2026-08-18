-- 0044: fab_po — the purchase order that sits between a project and its
--       requirements, and fab_requirement.po_id pointing at it.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0044-fab-po.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and
-- raw-SQL-only columns that push proposes dropping — see the note at the top of
-- the sales section in schema.prisma and scripts/0040/0043.)
--
-- WHY. The manager's surface is three steps: create a project by hand, create a
-- PO under it, upload that PO's PDF. A project holds SEVERAL purchase orders
-- (one customer, several orders), and the piece rows of each PO's PDF become
-- fab_requirement rows. Without this table those rows hang off the project with
-- no record of which document they came from, so a second PO's 780 pieces are
-- indistinguishable from the first's and neither can be re-checked against its
-- own totals row.
--
-- PURELY ADDITIVE AND IDEMPOTENT. One new table, one new nullable column, three
-- indexes and two foreign keys, all guarded. No backfill, no UPDATE, no DROP,
-- no DEFAULT applied to an existing column, nothing rewritten. Re-running it is
-- a no-op. Applying it changes no existing row and no existing query: every
-- read path selects named columns or Prisma-generated ones, and code that does
-- not know about fab_po behaves exactly as it did.
--
-- po_number IS UNIQUE WITHIN A PROJECT, NOT GLOBALLY. Two projects may
-- legitimately quote the same external PO number — the number belongs to the
-- customer's system, not ours, and two customers number from 1. A global unique
-- would reject the second one with a constraint error the manager cannot act
-- on. The composite unique is also the index for "this project's PO 10026".
--
-- po_id IS NULLABLE, and there is no backfill. Every requirement that exists
-- today came from the Excel intake and belongs to no purchase order; that is
-- the truth about them, and inventing a PO to point at would be worse than a
-- NULL. ON DELETE SET NULL matches Prisma's default for an optional relation:
-- deleting a PO must not take its requirements' history with it.
--
-- INDEXES, and why each one. The fabrication tables carry no @@index at all
-- today while the rest of the schema carries 59 — every fab lookup is a
-- sequential scan. These three are the ones this feature's own queries need:
--   * fab_po_project_id_po_number_key   — enforces the per-project uniqueness
--                                         AND serves "find PO n of project p";
--                                         its project_id prefix serves the FK.
--   * fab_po_project_id_created_at_idx  — the PO list on the project screen,
--                                         WHERE project_id = ? ORDER BY created_at DESC.
--   * fab_requirement_po_id_idx         — every read of one PO's piece rows.
--                                         Postgres does not index a foreign key
--                                         for you; without this, opening one PO
--                                         scans every requirement in the system.
-- The names are Prisma's own defaults for these models, so `prisma migrate
-- diff` stays clean after this is applied (same discipline as scripts/0038).

CREATE TABLE IF NOT EXISTS "fab_po" (
  "id"              TEXT         NOT NULL,
  "project_id"      TEXT         NOT NULL,
  "po_number"       TEXT         NOT NULL,
  "pdf_file_name"   TEXT,
  "pdf_imported_at" TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fab_po_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fab_po_project_id_po_number_key"
  ON "fab_po" ("project_id", "po_number");

CREATE INDEX IF NOT EXISTS "fab_po_project_id_created_at_idx"
  ON "fab_po" ("project_id", "created_at");

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "po_id" TEXT;

CREATE INDEX IF NOT EXISTS "fab_requirement_po_id_idx"
  ON "fab_requirement" ("po_id");

-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so both foreign keys are
-- guarded by name. Referential actions are Prisma's defaults for the relation's
-- optionality — RESTRICT for the required project link (a project with POs must
-- not vanish under them), SET NULL for the optional requirement link.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_po_project_id_fkey'
  ) THEN
    ALTER TABLE "fab_po"
      ADD CONSTRAINT "fab_po_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "fab_project" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_po_id_fkey'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_po_id_fkey"
      FOREIGN KEY ("po_id") REFERENCES "fab_po" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMENT ON TABLE "fab_po" IS
  'A customer purchase order under a fab_project. po_number is the customer''s own number and is unique within the project only. pdf_file_name/pdf_imported_at record the PO PDF whose piece table produced this PO''s fab_requirement rows.';

COMMENT ON COLUMN "fab_requirement"."po_id" IS
  'The purchase order this requirement came off, when it came from a PO PDF. NULL for every row created by the older Excel intake.';
