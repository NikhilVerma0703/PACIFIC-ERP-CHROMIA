-- =====================================================================
-- 0059-sample-orders.sql
--
-- SAMPLE ORDERS ON THE FABRICATION FLOOR.
--
-- The owner: "sampling page, they create the request — catalogue requirement —
-- and request the samples and send to supervisor. He the same way chooses the
-- slab and adds pieces and quantity and sends to cutting, then polished (no
-- sink and fabri in the samples) and pushed to package."
--
-- Sample stock arrives two ways, and they are not the same event:
--
--   OFFCUT    a PO slab has been cut and usable pieces are left over.
--             Recorded on the supervisor's slab card where they are found.
--             The slab stays CTS. Already built (sampling_intake).
--   ORDERED   somebody wants forty 11x11 Carrara Royale in suede. That is a
--             JOB: a slab must be chosen, pieces cut, polished and packed
--             before the stock exists. That is what this adds.
--
-- ─────────────────────────────────── SAME PIPELINE, ON PURPOSE ─────────────
-- A sample order is a fab_project with kind = 'SAMPLE'. Its rows are
-- fab_requirement, its pieces are fab_piece, and they cross the same slab
-- board and the same cutting / polishing / packaging queues as everything
-- else. One set of screens, one set of piece codes, one place an operator
-- looks.
--
-- The alternative — parallel tables and parallel queues — means an operator
-- choosing between two cutting screens depending on what is on the saw, and
-- two copies of every rule, which then drift. Sampling work is not a different
-- kind of work; it is the same work for a different customer.
--
-- ─────────────────────────────────── WHAT THE ROWS CARRY ───────────────────
-- A sample requirement has to know WHICH SHELF it will credit when its pieces
-- are packed:
--
--   colour_finish_id   product_colour_finish — the colour AND its finish.
--                      Never the colour alone: "50 Carrara Royale 11x11" is
--                      not a stock figure until you know it is suede.
--   sampling_size_id   sampling_size — the exact shelf size. The requirement
--                      also has its own length/width in inches for the saw;
--                      this is the catalogue row those inches came from, so
--                      packing credits the shelf that was ordered rather than
--                      one that merely measures the same.
--
-- Both NULL on every purchase-order row, which is what they are.
--
-- NO SINK, NO FABRICATION on a sample: enforced in the application
-- (lib/fab/sampleOrder.ts checkSampleSink) and by the CHECK below, because a
-- sink count on a sample row is not a preference somebody could hold.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0058.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0059-sample-orders.sql
--
-- THEN: `npx prisma db push` DROPS any column the schema does not declare.
-- kind, colour_finish_id and sampling_size_id are all declared on the models
-- in prisma/schema.prisma for that reason. Do not remove them.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. What a project is FOR.
-- ---------------------------------------------------------------------
ALTER TABLE "fab_project"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'PO';

COMMENT ON COLUMN "fab_project"."kind" IS
  'PO or SAMPLE. Every project that predates sample orders is a PO, which is '
  'what they all were. A SAMPLE project is the sampling desk''s own job and '
  'runs the same pipeline with sink and fabrication switched off. '
  'See src/lib/fab/sampleOrder.ts.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_project_kind_ck') THEN
    ALTER TABLE "fab_project"
      ADD CONSTRAINT "fab_project_kind_ck" CHECK ("kind" IN ('PO', 'SAMPLE'));
  END IF;
END $$;

-- Sample orders are the minority and are always asked for by name.
CREATE INDEX IF NOT EXISTS "fab_project_kind_idx"
  ON "fab_project" ("kind") WHERE "kind" <> 'PO';

-- ---------------------------------------------------------------------
-- 2. Which shelf a sample row credits when its pieces are packed.
-- ---------------------------------------------------------------------
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "colour_finish_id" TEXT,
  ADD COLUMN IF NOT EXISTS "sampling_size_id" TEXT;

COMMENT ON COLUMN "fab_requirement"."colour_finish_id" IS
  'product_colour_finish this sample row was ordered against - the colour AND '
  'its finish. NULL on every purchase-order row. Packing a piece of this row '
  'credits this shelf.';
COMMENT ON COLUMN "fab_requirement"."sampling_size_id" IS
  'sampling_size this sample row was ordered against. The row also carries '
  'length/width in inches for the saw; this is the catalogue row those inches '
  'came from, so packing credits the shelf that was ORDERED rather than one '
  'that merely measures the same. NULL on purchase-order rows.';

-- Real foreign keys, unlike sampling_intake's slab reference: these two tables
-- exist and are curated, so a row pointing at a deleted shelf is a bug and not
-- a fact of life. ON DELETE RESTRICT — a colour or size with sample orders
-- against it must not vanish underneath them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_colour_finish_fkey') THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_colour_finish_fkey"
      FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_sampling_size_fkey') THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_sampling_size_fkey"
      FOREIGN KEY ("sampling_size_id") REFERENCES "sampling_size" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- "The rows of this sample order that still owe stock" is the sampling desk's
-- own question, and it is asked by colour+finish.
CREATE INDEX IF NOT EXISTS "fab_requirement_colour_finish_idx"
  ON "fab_requirement" ("colour_finish_id") WHERE "colour_finish_id" IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Which sample pieces have already been credited to the shelf.
-- ---------------------------------------------------------------------
--
-- WITHOUT THIS, PACKING TWICE COUNTS TWICE. Packaging can be re-run — an
-- operator re-scans a trolley, a request is retried on a flaky tablet — and a
-- sample piece that credited stock on the first pass must not credit it again
-- on the second. One row per piece, unique, written in the same transaction as
-- the stock increment.
ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "sampling_intake_id" TEXT;

COMMENT ON COLUMN "fab_piece"."sampling_intake_id" IS
  'The sampling_intake row this piece created when it was packed, if it is a '
  'sample piece. NULL for a purchase-order piece, and NULL for a sample piece '
  'not yet packed. Its presence is what stops a re-run crediting twice.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_sampling_intake_fkey') THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_sampling_intake_fkey"
      FOREIGN KEY ("sampling_intake_id") REFERENCES "sampling_intake" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- PLAIN, not partial: Prisma's @unique on a nullable column emits exactly this,
-- and Postgres already treats NULLs as distinct — so nothing here conflicts and
-- `prisma db push` sees no drift to "fix". A partial index would be marginally
-- smaller and would make every push want to rewrite it.
CREATE UNIQUE INDEX IF NOT EXISTS "fab_piece_sampling_intake_id_key"
  ON "fab_piece" ("sampling_intake_id");

COMMIT;


-- =====================================================================
-- AFTERWARDS
-- =====================================================================

-- The sample orders on the floor and how far along they are:
-- SELECT p.project_code, p.status,
--        count(pc.id)                                        AS pieces,
--        count(pc.id) FILTER (WHERE pc.status = 'PACKAGED')  AS packed,
--        count(pc.sampling_intake_id)                        AS credited
-- FROM   fab_project p
-- LEFT   JOIN fab_piece pc ON pc.project_id = p.id
-- WHERE  p.kind = 'SAMPLE'
-- GROUP  BY p.project_code, p.status
-- ORDER  BY p.project_code;

-- Must return 0 rows: a packed sample piece that credited no shelf. Each one is
-- a row that could not say which colour+finish and size it was ordered against.
-- SELECT pc.piece_code, p.project_code
-- FROM   fab_piece pc
-- JOIN   fab_project p ON p.id = pc.project_id
-- JOIN   fab_requirement r ON r.id = pc.requirement_id
-- WHERE  p.kind = 'SAMPLE' AND pc.status = 'PACKAGED'
--   AND  pc.sampling_intake_id IS NULL;

-- Must return 0 rows: a sink on a sample row.
-- SELECT r.id, p.project_code, r.sink_quantity
-- FROM   fab_requirement r
-- JOIN   fab_project p ON p.id = r.project_id
-- WHERE  p.kind = 'SAMPLE' AND coalesce(r.sink_quantity, 0) > 0;
