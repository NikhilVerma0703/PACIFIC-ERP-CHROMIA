-- =====================================================================
-- 0063-hand-edge-polish-and-shapes.sql
--
-- HAND EDGE POLISH BECOMES ITS OWN JOB, AND PIECES CAN BE ROUND.
--
-- Two changes the owner asked for on the same screen, and they land together
-- because they are the same decision seen from two sides: what edge does this
-- piece have, and is that edge being polished by hand.
--
-- ─────────────────────────────── 1 · THE JOBS SEPARATE ──────────────────────
-- Until now the application held `fabricationRequired = sinkRequired`: edge
-- work was read as the hand-polish that comes WITH a sink cutout, so a row
-- with no sink was charged nothing however its edges were marked.
--
-- The owner: "we choose the sink, there itself we need to choose the edge
-- polish, which is NOT the polish of the operator. This edge polish is by
-- hand, where we need the running foot length and charge by thickness." And:
-- "any pieces can be assigned the edge hand polish or not — this is chosen and
-- done by supervisor, or else the one manager who uploads the PO."
--
-- So there are two hand jobs and only one of them is implied:
--   SINK POLISH   implied by the sink cut. "Once a piece or group have sink
--                 cut, they will sink cut polish." Priced inside the per-piece
--                 sink rate. Nobody chooses it and nothing here records it.
--   EDGE POLISH   chosen, independently, on any row — sink or plain. Charged
--                 by the running foot at the thickness rate.
--
-- fab_piece.has_edge_polish is the piece-level stamp, written at release
-- beside has_sink, so the fabricator's queue can be built from the pieces
-- themselves rather than by joining back to the order every time.
--
-- ─────────────────────────────── 2 · CIRCLES AND OVALS ──────────────────────
-- The owner: "regarding the cost, now it's like polish side only for a squares
-- or rect, need to include circle, oval as well. Default is rect shape fine."
-- On entry: "let the manager or anyone who uploads the PO mention the dia; if
-- it's oval enter a, b — long length and long width."
--
-- NO NEW DIMENSION COLUMNS. fab_requirement already has length and width, and
-- shape_type says how to read them:
--   RECTANGLE   length x width, as always
--   CIRCLE      length is the DIAMETER; width is written equal to it, so the
--               bounding box the slab actually loses falls out of the existing
--               maths with no special case anywhere else
--   OVAL        length is a (the long axis), width is b (the short one)
--
-- CIRCLE and OVAL are added to the FabShapeType enum. ROUND was already there
-- and is left alone: rows written under it still read as circles (parseShape
-- in lib/fab/shape.ts accepts both), and dropping an enum value that live rows
-- may hold would fail the migration rather than fix anything.
--
-- ─────────────────────────────── 3 · THE CHECK CONSTRAINT WIDENS ────────────
-- finished_edges holds a canonical CSV of edge names. A round piece has ONE
-- edge and no sides to choose between, so it carries the single word 'round'
-- in the same column. The 0055 constraint knows only the four rectangle names
-- and would refuse it, so it is replaced.
--
-- One column, one question — "what edge work does this row have" — answered in
-- the vocabulary of the shape being asked about. Greppable in psql either way.
--
-- ─────────────────────────────── WHAT THIS SCRIPT DOES NOT DO ───────────────
-- IT DOES NOT BACKFILL has_edge_polish FROM finished_edges, and that is
-- deliberate. Under the old rule an edge selection could only exist on a sink
-- row, and those pieces were already charged for their edges inside the old
-- fabrication count. Stamping them now would not change a rupee that has been
-- invoiced, but it WOULD move historical pieces into the hand-polish queue as
-- though the work were still to do. The stamp starts empty and is written by
-- releases from here on.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0062.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0063-hand-edge-polish-and-shapes.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · THE SHAPE ENUM
--
-- Outside a transaction, and each value in its own statement. Postgres will
-- not let a value added to an enum be USED in the same transaction that adds
-- it, and while nothing below uses these, keeping them out of the BEGIN block
-- means a re-run cannot half-open a transaction that later statements need.
--
-- The type may not exist at all on a database built purely from these numbered
-- scripts — fab_requirement predates them — so it is created if missing, with
-- the full value list the application knows.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FabShapeType') THEN
    CREATE TYPE "FabShapeType" AS ENUM
      ('RECTANGLE','L_SHAPE','CURVE','ROUND','CUSTOM','CIRCLE','OVAL');
  END IF;
END $$;

ALTER TYPE "FabShapeType" ADD VALUE IF NOT EXISTS 'CIRCLE';
ALTER TYPE "FabShapeType" ADD VALUE IF NOT EXISTS 'OVAL';


-- ---------------------------------------------------------------------
-- 2 · THE COLUMNS
-- ---------------------------------------------------------------------
BEGIN;

-- shape_type on the ordered row. Almost certainly already present — it came in
-- with the original schema — but no numbered script ever created it, so a
-- database built from scripts/ alone would not have it. Idempotent either way.
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "shape_type" "FabShapeType";

COMMENT ON COLUMN "fab_requirement"."shape_type" IS
  'RECTANGLE (default, and NULL means this) / CIRCLE / OVAL. Says how length '
  'and width are read: a CIRCLE keeps its DIAMETER in length; an OVAL keeps a '
  'in length and b in width. Decides which perimeter the running-foot edge '
  'charge is measured along - lib/fab/shape.ts.';

ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "has_edge_polish" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "fab_piece"."has_edge_polish" IS
  'This piece gets HAND edge polish - the outsourced running-foot job, not the '
  'machine polish the operator does. Independent of has_sink since 0063: a '
  'plain piece can have it and a sink piece can go without. Stamped at release '
  'from the row finished_edges, which under the group rule applies to every '
  'piece of the row.';

-- The fabricator's queue is "pieces with a sink OR hand edge polish that are
-- not done yet". Before 0063 that was has_sink alone and the existing index
-- covered it; this is the other half.
CREATE INDEX IF NOT EXISTS "fab_piece_has_edge_polish_idx"
  ON "fab_piece" ("has_edge_polish")
  WHERE "has_edge_polish" = true;


-- ---------------------------------------------------------------------
-- 3 · finished_edges LEARNS THE WORD 'round'
--
-- Dropped and re-added rather than altered: Postgres has no ALTER CONSTRAINT
-- for a CHECK expression, and doing it in one transaction means the column is
-- never unguarded from another session's point of view.
--
-- The application already refuses an unknown word (the finished-edges route
-- rejects rather than silently dropping it). This is the second door, on the
-- column itself, and it is the one that holds when somebody edits a row by
-- hand in psql at eleven at night.
-- ---------------------------------------------------------------------
ALTER TABLE "fab_requirement"
  DROP CONSTRAINT IF EXISTS "fab_requirement_finished_edges_ck";

ALTER TABLE "fab_requirement"
  ADD CONSTRAINT "fab_requirement_finished_edges_ck"
  CHECK ("finished_edges" IS NULL
         OR "finished_edges" = ''
         -- a round piece: exactly the one word, never mixed with side names,
         -- because a circle has no sides and 'round,front' is a contradiction
         -- written by a screen that had the wrong shape for the row
         OR "finished_edges" = 'round'
         OR "finished_edges" ~ '^(front|back|left|right)(,(front|back|left|right))*$');

COMMENT ON COLUMN "fab_requirement"."finished_edges" IS
  'Canonical CSV of finished edges: front,back,left,right - front/back run the '
  'length, left/right the width. A CIRCLE or OVAL has one edge and stores the '
  'single word ''round'' instead. Empty = none finished; NULL = not yet chosen. '
  'Per ordered row, not per piece. Priced per running foot - lib/fab/pricing.ts.';

COMMIT;


-- =====================================================================
-- AFTERWARDS — what the split is worth, straight from SQL.
--
-- The application computes this in lib/fab/pricing.ts; this is the same sum,
-- for checking a figure without opening the app. Rectangles only — the round
-- perimeter is Ramanujan's and does not belong in a CASE expression.
--
-- Note the quantity: the feet run over r.quantity, NOT over sink_quantity.
-- That is the whole change. The same query before 0063 multiplied by the sink
-- count and left every plain row's hand polish unbilled.
-- =====================================================================

-- SELECT p.project_code,
--        sum(
--          ( (CASE WHEN r.finished_edges LIKE '%front%' THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%back%'  THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%left%'  THEN r.width  ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%right%' THEN r.width  ELSE 0 END)
--          ) * r.quantity / 12.0
--        ) FILTER (WHERE coalesce(r.shape_type::text,'RECTANGLE') = 'RECTANGLE')
--                                                             AS running_ft_rect,
--        sum(coalesce(r.sink_quantity, 0))                    AS sink_pieces,
--        count(*) FILTER (WHERE r.finished_edges IS NULL)     AS edges_not_chosen,
--        count(*) FILTER (WHERE r.shape_type::text IN ('CIRCLE','OVAL','ROUND'))
--                                                             AS round_rows
-- FROM   fab_requirement r
-- JOIN   fab_project p ON p.id = r.project_id
-- GROUP  BY p.project_code
-- ORDER  BY p.project_code;

-- Pieces waiting on the hand bench, by job:
-- SELECT count(*) FILTER (WHERE has_sink)                        AS sink_pieces,
--        count(*) FILTER (WHERE has_edge_polish)                 AS edge_pieces,
--        count(*) FILTER (WHERE has_sink AND has_edge_polish)    AS both
-- FROM   fab_piece
-- WHERE  status NOT IN ('PACKAGED','REJECTED');
