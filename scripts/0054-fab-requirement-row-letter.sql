-- =====================================================================
-- 0054-fab-requirement-row-letter.sql
--
-- ONE CONSISTENT PIECE NAME:  {projectCode}-{LETTER}-{n}
--
--     PRJ1-A-1    first piece of the first ordered row
--     PRJ1-A-12   twelfth piece of that same row
--     PRJ1-B-1    first piece of the second row
--
-- A letter per ORDERED ROW, a number per PIECE, so a cutter reading a piece
-- of stone knows which row it belongs to without a lookup.
--
-- WHAT THIS REPLACES. Three formats were live at once:
--     PRJ1-0007              approve-slab / release-project (one sequence
--                            across a whole project, said nothing about the row)
--     PRJ1-2B-003-9f1c       the retired cutting-queue auto-create branch
--     "Row 3"                fab_requirement.piece_label, from the PO importer
-- The first two are retired in code (lib/fab/releasePlan.ts). The third stays
-- in piece_label as provenance — which row of which PDF this came from — and
-- the LETTER becomes what the floor sees.
--
-- WHY THE LETTER IS STORED AND NOT DERIVED. Deriving it from row order would
-- re-letter every existing piece the moment a second PO joined the project or
-- a row was deleted. Stone that has already been cut and stickered cannot be
-- migrated.
--
-- PAST Z it continues bijectively: A…Z, AA, AB…  The Kerasom sheet is 28 rows
-- and PO 10026 is 23, so 26 letters was never enough.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0044-fab-po.sql.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0054-fab-requirement-row-letter.sql
-- =====================================================================

BEGIN;

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "row_letter" TEXT;

COMMENT ON COLUMN "fab_requirement"."row_letter" IS
  'Letter in the piece code {projectCode}-{LETTER}-{n}. Assigned once at '
  'import, never recomputed: re-lettering would rename pieces already cut. '
  'Unique per project. Bijective base-26 past Z (A..Z, AA, AB, ...).';

-- One letter per row within a project. A partial index so the rows that
-- predate this script (row_letter IS NULL) do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "fab_requirement_project_row_letter_key"
  ON "fab_requirement" ("project_id", "row_letter")
  WHERE "row_letter" IS NOT NULL;

COMMIT;


-- =====================================================================
-- BACKFILL — give every existing row a letter, in creation order.
--
-- SAFE ONLY WHILE A PROJECT HAS NO PIECES CUT UNDER THE NEW FORMAT. Rows
-- are lettered by created_at, which is the order they were imported, so a
-- project whose pieces are all still {projectCode}-{NNNN} simply starts
-- using letters from its next send. A project already carrying
-- {projectCode}-{LETTER}-{n} codes must NOT be re-lettered — check first.
--
-- 1. Look before you write: which projects already use the new format?
-- =====================================================================

-- SELECT p.project_code, count(*) AS new_format_pieces
-- FROM   fab_piece pc
-- JOIN   fab_project p ON p.id = pc.project_id
-- WHERE  pc.piece_code ~ '^.+-[A-Z]+-[0-9]+$'
-- GROUP  BY p.project_code;

-- 2. The backfill itself. Only touches rows with no letter, and skips any
--    project that already has new-format pieces.
-- =====================================================================

-- WITH numbered AS (
--   SELECT r.id,
--          row_number() OVER (PARTITION BY r.project_id
--                             ORDER BY r.created_at, r.id) - 1 AS idx
--   FROM   fab_requirement r
--   WHERE  r.row_letter IS NULL
--     AND  r.project_id NOT IN (
--            SELECT DISTINCT pc.project_id FROM fab_piece pc
--            WHERE pc.piece_code ~ '^.+-[A-Z]+-[0-9]+$')
-- )
-- UPDATE fab_requirement r
-- SET    row_letter = (
--          -- bijective base-26: 0->A, 25->Z, 26->AA
--          WITH RECURSIVE b(rem, acc) AS (
--            SELECT n.idx, ''::text
--            UNION ALL
--            SELECT (rem / 26) - 1, chr(65 + (rem % 26)) || acc FROM b WHERE rem >= 0
--          )
--          SELECT acc FROM b WHERE rem < 0 LIMIT 1
--        )
-- FROM   numbered n
-- WHERE  r.id = n.id;

-- 3. Check: no project may have two rows sharing a letter.
-- SELECT project_id, row_letter, count(*)
-- FROM   fab_requirement WHERE row_letter IS NOT NULL
-- GROUP  BY 1,2 HAVING count(*) > 1;
