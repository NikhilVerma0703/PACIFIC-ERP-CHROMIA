-- =====================================================================
-- 0065-edge-faces.sql
--
-- TOP, BOTTOM, OR BOTH — the second half of the hand edge polish charge.
--
-- The owner: "hand edge polish have like not only 4 direction N E S W, also
-- whether this on top or bottom or both as well."
--
-- finished_edges (scripts/0055, widened in 0063) says WHICH edges are hand
-- polished. It does not say how many times each one is walked. An edge is a
-- band of stone with two arrises, and doing both is the same line twice:
--
--     feet = perimeter of the chosen edges x FACES x quantity / 12
--
-- ─────────────────── WHY THIS IS NOT A ROUNDING ERROR ───────────────────────
-- Row A of PO 10026 — 60 pieces of 28 x 22.5 in, all four edges:
--
--     one face   505 ft   x Rs15 =  Rs7,575
--     both faces 1,010 ft x Rs15 = Rs15,150
--
-- Every row polished top and bottom has been billed at half. This column is
-- what stops that, and the multiply is in lib/fab/pricing.ts.
--
-- ─────────────────── WHY A COLUMN AND NOT A SECOND EDGE LIST ────────────────
-- 'front_top,front_bottom,left_top' was the alternative and it is the wrong
-- shape twice over: it multiplies the vocabulary the CHECK constraint has to
-- know by three, and it lets a row say something physically odd (front polished
-- on top, left on the bottom) that nobody would ever quote for. The owner asks
-- the question once per row, so it is stored once per row.
--
-- PER ROW, like the edge selection itself. A row is homogeneous — one where
-- some pieces want both faces and some want one is SPLIT, the same rule that
-- removed the need for an edge_quantity column in 0063.
--
-- ─────────────────── TOP IS THE DEFAULT, AND NULL MEANS TOP ─────────────────
-- The overwhelming case: a countertop's visible edge is the top one and the
-- underside is never seen. NULL is left meaning TOP rather than "not chosen",
-- and that is deliberate and different from finished_edges, where NULL is a
-- real unanswered question.
--
-- The reason is which way the mistake runs. An unanswered EDGE question shows
-- as unpriced and somebody goes and asks. An unanswered FACE question, if it
-- were also unpriced, would take every existing row off the invoice the moment
-- this script ran. NULL therefore keeps charging exactly what it charged
-- yesterday, and BOTH has to be chosen — the expensive direction is never
-- fallen into.
--
-- ─────────────────── NOT BACKFILLED ─────────────────────────────────────────
-- Every row that exists was priced as one face, and no record survives of which
-- of them the bench actually did twice. Writing 'TOP' everywhere would look
-- like a decision somebody made; leaving NULL says plainly that nobody was
-- asked. Both price identically, so no historical figure moves either way.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0064.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0065-edge-faces.sql
-- =====================================================================

BEGIN;

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "edge_faces" TEXT;

COMMENT ON COLUMN "fab_requirement"."edge_faces" IS
  'Which face(s) of the chosen edges get HAND polish: TOP / BOTTOM / BOTH. '
  'BOTH is the same line walked twice and DOUBLES the running feet - it is a '
  'multiplier, not a surcharge. NULL means TOP, which is what every row was '
  'charged as before scripts/0065; it is NOT an unanswered question, unlike '
  'NULL on finished_edges. Per ordered row - lib/fab/shape.ts.';

-- TEXT with a CHECK rather than an enum: three values that will not grow, and a
-- CHECK can be widened inside an ordinary transaction while ALTER TYPE ... ADD
-- VALUE cannot. The application refuses an unknown word first; this is the
-- second door, and it is the one that holds when somebody edits a row by hand.
ALTER TABLE "fab_requirement"
  DROP CONSTRAINT IF EXISTS "fab_requirement_edge_faces_ck";

ALTER TABLE "fab_requirement"
  ADD CONSTRAINT "fab_requirement_edge_faces_ck"
  CHECK ("edge_faces" IS NULL OR "edge_faces" IN ('TOP','BOTTOM','BOTH'));

-- "What is on the bench for both faces?" — the only way this is queried, and
-- partial because the overwhelming majority of rows are NULL or TOP.
CREATE INDEX IF NOT EXISTS "fab_requirement_edge_faces_both_idx"
  ON "fab_requirement" ("edge_faces")
  WHERE "edge_faces" = 'BOTH';

COMMIT;


-- =====================================================================
-- AFTERWARDS — what the second face is worth, straight from SQL.
--
-- Rectangles only; the round perimeter is Ramanujan's and does not belong in a
-- CASE expression. This is the same sum lib/fab/pricing.ts makes.
-- =====================================================================

-- SELECT p.project_code,
--        r.row_letter,
--        r.finished_edges,
--        coalesce(r.edge_faces,'TOP')                              AS faces,
--        r.quantity,
--        round((
--          ( (CASE WHEN r.finished_edges LIKE '%front%' THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%back%'  THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%left%'  THEN r.width  ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%right%' THEN r.width  ELSE 0 END)
--          ) * r.quantity
--            * (CASE WHEN r.edge_faces = 'BOTH' THEN 2 ELSE 1 END)
--            / 12.0
--        )::numeric, 2)                                            AS running_ft
-- FROM   fab_requirement r
-- JOIN   fab_project p ON p.id = r.project_id
-- WHERE  coalesce(r.finished_edges,'') <> ''
--   AND  coalesce(r.shape_type::text,'RECTANGLE') = 'RECTANGLE'
-- ORDER  BY p.project_code, r.row_letter;

-- How much of the floor is double-faced at all:
-- SELECT coalesce(edge_faces,'TOP') AS faces, count(*)
-- FROM   fab_requirement
-- WHERE  coalesce(finished_edges,'') <> ''
-- GROUP  BY 1 ORDER BY 2 DESC;
