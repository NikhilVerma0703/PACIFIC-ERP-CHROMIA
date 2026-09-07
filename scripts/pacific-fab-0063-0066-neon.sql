-- ============================================================================
--  PACIFIC SURFACES ERP — FABRICATION SCHEMA CHANGE
--  Migrations 0063, 0064, 0065, 0066
--
--  TARGET   Neon Postgres, PRODUCTION branch
--  RUN AS   the direct (non-pooled) connection — NOT the -pooler host
--  HOW      four sections below, ONE AT A TIME, IN ORDER
--  FROM     the ERP developer. Questions before running, not after.
-- ============================================================================
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  1. BRANCH PRODUCTION FIRST. That is the backup and the rollback.      │
--  └────────────────────────────────────────────────────────────────────────┘
--  Neon console -> Branches -> Create branch, from the production branch, at
--  the current time. Copy-on-write, so it is instant and costs nothing until
--  the two diverge. If any figure moves that should not have, the whole
--  pre-migration database is still sitting there to compare against, row for
--  row. One change below cannot be undone any other way (see ROLLBACK).
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  2. USE THE DIRECT ENDPOINT, NOT -pooler.                              │
--  └────────────────────────────────────────────────────────────────────────┘
--  The application connects through DATABASE_URL_POOLED — Neon's PgBouncer
--  endpoint — because a Vercel lambda reusing a pooled connection is cheaper
--  than opening its own. DDL should not go through it: PgBouncer runs in
--  transaction mode, these scripts use explicit BEGIN/COMMIT blocks, and one
--  statement deliberately sits OUTSIDE a transaction. Use the plain
--  DATABASE_URL host, the one WITHOUT -pooler in it.
--
--  The Neon SQL Editor already uses the direct connection, so pasting there is
--  the simple answer. Check the BRANCH SELECTOR at the top of the editor first
--  — it remembers whatever was last used, and a migration applied to a dev
--  branch looks exactly like a successful one.
--
--  From psql instead:
--      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f pacific-fab-0063-0066-neon.sql
--  ON_ERROR_STOP=1 matters. Without it psql carries on past a failed statement
--  and reports success at the end.
--
--  If the first statement takes a few seconds, that is the Neon compute waking
--  from scale-to-zero. It is not a lock; nothing here waits on another session.
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  3. WHAT THIS TOUCHES, IN FULL                                         │
--  └────────────────────────────────────────────────────────────────────────┘
--  Three tables and one enum type. Nothing else is named anywhere below.
--
--    0063  FabShapeType                        enum gains CIRCLE, OVAL
--    0063  fab_requirement.shape_type          ADD COLUMN            (NULL)
--    0063  fab_piece.has_edge_polish           ADD COLUMN   NOT NULL DEFAULT false
--    0063  fab_requirement_finished_edges_ck   CHECK dropped and re-added, widened
--    0064  fab_slab_job.released_by_id         ADD COLUMN + FK -> users            (NULL)
--    0064  fab_slab_job.released_by_session_id ADD COLUMN + FK -> fab_machine_session (NULL)
--    0065  fab_requirement.edge_faces          ADD COLUMN TEXT + CHECK             (NULL)
--    0066  fab_piece.charged_edge              ADD COLUMN double precision         (NULL)
--    0066  fab_piece.charged_sink              ADD COLUMN double precision         (NULL)
--    0066  fab_piece.charged_at                ADD COLUMN timestamp(3)             (NULL)
--
--  Plus five indexes, every one of them PARTIAL, because on all five the
--  overwhelming majority of rows are NULL and an index over those is pages of
--  nothing: fab_piece_has_edge_polish_idx, fab_slab_job_released_by_idx,
--  fab_slab_job_released_session_idx, fab_requirement_edge_faces_both_idx,
--  fab_piece_charged_at_idx.
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  4. WHAT NEVER APPEARS BELOW                                           │
--  └────────────────────────────────────────────────────────────────────────┘
--      UPDATE      DELETE      TRUNCATE       DROP TABLE
--      DROP COLUMN             ALTER COLUMN ... TYPE
--      SET NOT NULL on an existing column     any backfill of any kind
--
--  NOT ONE EXISTING ROW IS WRITTEN. Every historical row keeps the values it
--  has, and every figure the reports already produce stays exactly where it is.
--  That is a deliberate property of all four scripts, not an accident of scope
--  — each one says in its own header why it does not backfill.
--
--  Nothing outside fabrication is created, altered, dropped, read or written:
--  not finance, office, vendor/bills, international sales, polish_qc,
--  sampling_*, chromia, entry/MIS, fab_slab, fab_package or fab_project. The
--  tables `users` and `fab_machine_session` appear ONLY as the targets of the
--  two foreign keys in 0064; neither table is altered.
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  5. LOCKS                                                              │
--  └────────────────────────────────────────────────────────────────────────┘
--  Run this first — these three numbers are how long the exclusive locks are
--  held, and at this shop's scale all of it is sub-second:
--
--      SELECT (SELECT count(*) FROM fab_piece)       AS pieces,
--             (SELECT count(*) FROM fab_requirement) AS ordered_rows,
--             (SELECT count(*) FROM fab_slab_job)    AS slab_jobs;
--
--  ADD COLUMN ... NOT NULL DEFAULT false is a catalog-only change on
--  PostgreSQL 11+ — no table rewrite. The two CHECK constraints each scan
--  their table once to validate. The two foreign keys validate against columns
--  that are NULL on every existing row, so they scan nothing. The five indexes
--  are built inside their transactions and briefly block writes to their own
--  table while they build.
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  6. ROLLBACK                                                           │
--  └────────────────────────────────────────────────────────────────────────┘
--  In reverse order — 0066, 0065, 0064, 0063 — if at all.
--
--    the 8 columns     DROP COLUMN IF EXISTS     reversible, loses nothing:
--                                                nothing was written to an
--                                                existing column
--    the 5 indexes     DROP INDEX IF EXISTS      reversible
--    the 2 CHECKs      DROP CONSTRAINT           reversible; the previous form
--                                                of finished_edges_ck is in
--                                                scripts/0055
--    CIRCLE and OVAL   *** NOT REVERSIBLE ***    PostgreSQL has no
--    on FabShapeType                             ALTER TYPE ... DROP VALUE.
--                                                Harmless — two unused labels
--                                                on an enum — but permanent.
--                                                The Neon branch taken in step
--                                                1 is the only real undo.
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  7. IS ANY OF IT ALREADY APPLIED?                                      │
--  └────────────────────────────────────────────────────────────────────────┘
--  All four counts should read 0, and `shapes` should not contain CIRCLE or
--  OVAL. If any reads 1 that section has already run — all four are idempotent,
--  so re-running is safe either way.
--
--      SELECT
--        (SELECT count(*) FROM information_schema.columns
--           WHERE table_name='fab_requirement' AND column_name='shape_type')     AS c0063,
--        (SELECT count(*) FROM information_schema.columns
--           WHERE table_name='fab_slab_job'    AND column_name='released_by_id') AS c0064,
--        (SELECT count(*) FROM information_schema.columns
--           WHERE table_name='fab_requirement' AND column_name='edge_faces')     AS c0065,
--        (SELECT count(*) FROM information_schema.columns
--           WHERE table_name='fab_piece'       AND column_name='charged_at')     AS c0066,
--        (SELECT array_agg(enumlabel ORDER BY enumsortorder)
--           FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
--           WHERE t.typname='FabShapeType')                                      AS shapes;
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  8. AFTERWARDS — THE ONE CHECK THAT MATTERS                            │
--  └────────────────────────────────────────────────────────────────────────┘
--  It is at the very foot of this file, after section 0066. The point of it is
--  NOT that the columns exist; it is that every already-quoted row still reads
--  faces = TOP and still measures the same running feet it measured before.
--
--  IF ANY FIGURE MOVED, STOP AND SAY SO. Nothing in these four scripts should
--  move an existing number.
--
--  ┌────────────────────────────────────────────────────────────────────────┐
--  │  9. AND THEN                                                           │
--  └────────────────────────────────────────────────────────────────────────┘
--  Tell the developer these are applied. THE CODE DEPLOY GOES AFTER THIS, NOT
--  BEFORE: the new application code reads shape_type, edge_faces,
--  has_edge_polish and released_by_id, and if the deploy lands first the
--  fabrication pages error until the columns exist. This order is harmless —
--  the columns sit unused until the code arrives.
-- ============================================================================



-- ############################################################################
-- ##  SECTION 0063   —   0063-hand-edge-polish-and-shapes.sql
-- ############################################################################

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


-- ############################################################################
-- ##  SECTION 0064   —   0064-slab-job-released-by.sql
-- ############################################################################

-- =====================================================================
-- 0064-slab-job-released-by.sql
--
-- WHO PUT THIS SLAB ON THE FLOOR.
--
-- Until scripts/0063's companion change, only a supervisor could send a slab to
-- cutting, so the question was answerable by implication: whoever the shift's
-- supervisor was. The owner then put the allocation board in the cutter's hands
-- — "we have slab allocation page made for supervisor, that need to be included
-- to the cutter as well" — and approve-slab widened from SUPERVISOR to EMPLOYEE.
-- The implication died with it, and nothing took its place.
--
-- ─────────────────── WHY NOT JUST A USER COLUMN ─────────────────────────────
-- Because on the floor a user id names nobody, and this codebase already learnt
-- that the hard way. From src/app/fab/cutting/page.tsx:
--
--     "Fabrication signs in on ONE shared operator account, so comparing
--      operatorId to currentUserId returns 'mine' for every job on the board no
--      matter who started it. The lock rendered, and could never fire."
--
-- A released_by_id alone would therefore record 'operator@...' for every
-- cutter-released slab — a column that looks like an answer and is not one. It
-- is still worth having for a supervisor or manager, who each have their own
-- login, so BOTH columns exist and each is honest about what it knows:
--
--   released_by_id          the authenticated login. A real person at a desk;
--                           the shared operator account on the floor.
--   released_by_session_id  the process session it was released from, which is
--                           what actually names the human. fab_machine_session
--                           carries worker_id (the named person standing at the
--                           station), machine_id, shift and login_time, so ONE
--                           foreign key answers who, where and on what shift
--                           without denormalising four fields that could drift.
--
-- ─────────────────── WHY THE SESSION IS TRUSTWORTHY ─────────────────────────
-- It is not a claim from the browser. readProcessSession() re-reads the row on
-- every request and returns null unless the session is still is_active, its
-- worker is still active, and the machine's type matches the process — see
-- src/lib/fab/processSessionServer.ts. The cookie carries an id, not an
-- identity.
--
-- ─────────────────── WHAT THE ROUTE DOES WITH THEM ──────────────────────────
-- An EMPLOYEE release REQUIRES a session and is refused without one, because
-- without it the record would be empty for exactly the person it exists for.
-- That costs him nothing: start-job and complete-job have always required a
-- CUTTING session, so he needs one two clicks later regardless.
--
-- A SUPERVISOR or MANAGER release does not require one — their login is the
-- identity — and records the session anyway if they happen to have one open.
--
-- ─────────────────── NOT BACKFILLED ─────────────────────────────────────────
-- Every job created before this script was released by a supervisor, because
-- nobody else could. That is a fact about the past, not a value to invent: a
-- guessed id is indistinguishable from a recorded one the moment it is written,
-- and "we do not know, and here is the date it was created" is the more useful
-- answer. Both columns stay NULL on historical rows.
--
-- ON DELETE SET NULL on both, deliberately. Neither is worth blocking the
-- deletion of a user or a session over, and a job whose releaser was deleted is
-- still a job — losing the name is better than losing the row.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0063.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0064-slab-job-released-by.sql
-- =====================================================================

BEGIN;

ALTER TABLE "fab_slab_job"
  ADD COLUMN IF NOT EXISTS "released_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "released_by_session_id" TEXT;

COMMENT ON COLUMN "fab_slab_job"."released_by_id" IS
  'The login that sent this slab to cutting. A named person at a desk; the '
  'SHARED operator account when released from the floor - use '
  'released_by_session_id to name the human in that case. NULL on jobs created '
  'before scripts/0064, which were all supervisor releases. Not the same as '
  'operator_id, which is who CUT it and is written when the job starts.';

COMMENT ON COLUMN "fab_slab_job"."released_by_session_id" IS
  'The fab_machine_session the release was made from - worker_id names the '
  'person, plus machine_id and shift. NULL when released from a desk with no '
  'station session open, which is the ordinary supervisor case. Required by the '
  'route for an EMPLOYEE release, because the shared login names nobody.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_slab_job_released_by_id_fkey'
  ) THEN
    ALTER TABLE "fab_slab_job"
      ADD CONSTRAINT "fab_slab_job_released_by_id_fkey"
      FOREIGN KEY ("released_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_slab_job_released_by_session_id_fkey'
  ) THEN
    ALTER TABLE "fab_slab_job"
      ADD CONSTRAINT "fab_slab_job_released_by_session_id_fkey"
      FOREIGN KEY ("released_by_session_id") REFERENCES "fab_machine_session"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- "What did this person put on the floor?" and "what came off this shift?" are
-- the two ways this will be read. Partial, because the overwhelming majority of
-- rows are historical and NULL, and an index over those is pages of nothing.
CREATE INDEX IF NOT EXISTS "fab_slab_job_released_by_idx"
  ON "fab_slab_job" ("released_by_id", "created_at" DESC)
  WHERE "released_by_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "fab_slab_job_released_session_idx"
  ON "fab_slab_job" ("released_by_session_id")
  WHERE "released_by_session_id" IS NOT NULL;

COMMIT;


-- =====================================================================
-- AFTERWARDS — who has been putting stone on the floor.
--
-- The join that makes the pair readable. released_by_id answers for a desk
-- release; the session answers for a floor one; coalesce puts them in one
-- column so a report does not have to care which kind it is looking at.
-- =====================================================================

-- SELECT j.created_at,
--        s.slab_code,
--        coalesce(w.name, u.name, u.email, 'not recorded')  AS released_by,
--        CASE WHEN j.released_by_session_id IS NOT NULL THEN 'floor'
--             WHEN j.released_by_id IS NOT NULL          THEN 'desk'
--             ELSE 'before 0064' END                      AS released_from,
--        m.name                                            AS machine,
--        ms.shift,
--        j.status,
--        j.used_area_sqft,
--        j.total_wastage_pct
-- FROM   fab_slab_job j
-- JOIN   fab_slab s             ON s.id  = j.slab_id
-- LEFT   JOIN users u           ON u.id  = j.released_by_id
-- LEFT   JOIN fab_machine_session ms ON ms.id = j.released_by_session_id
-- LEFT   JOIN fab_worker w      ON w.id  = ms.worker_id
-- LEFT   JOIN fab_machine m     ON m.id  = ms.machine_id
-- ORDER  BY j.created_at DESC
-- LIMIT  50;

-- And the one the shop will actually ask: released and cut by different people?
-- (operator_id / worker_id are written when the job STARTS — who cut it.)
-- SELECT s.slab_code,
--        coalesce(rw.name, ru.name, 'not recorded') AS released_by,
--        cw.name                                    AS cut_by,
--        j.created_at, j.start_time, j.end_time
-- FROM   fab_slab_job j
-- JOIN   fab_slab s              ON s.id  = j.slab_id
-- LEFT   JOIN fab_machine_session rs ON rs.id = j.released_by_session_id
-- LEFT   JOIN fab_worker rw      ON rw.id = rs.worker_id
-- LEFT   JOIN users ru           ON ru.id = j.released_by_id
-- LEFT   JOIN fab_worker cw      ON cw.id = j.worker_id
-- WHERE  j.created_at > now() - interval '7 days'
-- ORDER  BY j.created_at DESC;


-- ############################################################################
-- ##  SECTION 0065   —   0065-edge-faces.sql
-- ############################################################################

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


-- ############################################################################
-- ##  SECTION 0066   —   0066-freeze-piece-charge.sql
-- ############################################################################

-- =====================================================================
-- 0066-freeze-piece-charge.sql
--
-- WHAT A PIECE EARNED, WRITTEN DOWN ON THE DAY IT EARNED IT.
--
-- ─────────────────────────────── THE PROBLEM ────────────────────────────────
-- The period report (api/fab/ceo -> lib/fab/periodReport.ts) re-prices from the
-- LIVE fab_requirement row every time it is opened. So editing a row in
-- September changes what July earned:
--
--     July       60 pieces packed, one face  ->  505 ft   ->  Rs7,575
--     September  somebody sets edge_faces = 'BOTH'
--     July       the same report, reopened   ->  1,010 ft ->  Rs15,150
--
-- Nothing was re-done and nothing was re-billed. A closed month simply reads
-- differently than it did, and there is no record anywhere of what it used to
-- say. Every input to priceRow does this: finished_edges, edge_faces,
-- shape_type, length, width, sink_quantity, and the thickness of the slab the
-- row happens to be allocated to.
--
-- THIS IS OLDER THAN THE SHAPE AND FACE WORK. The report has always re-priced.
-- What scripts/0063 and 0065 changed is how easy it is to trip: BOTH is a
-- doubling, and it is chosen on a screen the supervisor uses every day.
--
-- ─────────────────────────────── THE FIX ────────────────────────────────────
-- PACKING IS WHEN A PIECE EARNS. That is already the moment the report counts
-- the money - "money is earned on the day a piece is packed", api/fab/ceo - so
-- it is the moment to write the figure down. These three columns hold it, and
-- the report prefers the stamp to a fresh calculation whenever one is there.
--
--   charged_edge   this piece's share of its row's hand edge polish charge
--   charged_sink   this piece's share of its row's sink charge
--   charged_at     WHEN it was stamped, and the flag that says a stamp exists
--
-- ─────────────────── WHY charged_at AND NOT "charged_edge IS NOT NULL" ──────
-- Because ZERO IS A REAL ANSWER. A plain piece on a row with no sink and no
-- edge work earns 0.00 and is stamped 0.00, and it must STAY zero even if
-- somebody marks that row's edges next month. There is no rupee value that can
-- mean "never asked", so the timestamp carries that fact instead.
--
-- ─────────────────── WHY DOUBLE PRECISION AND NOT NUMERIC(12,2) ─────────────
-- Because the per-piece share is deliberately NOT rounded, and rounding it here
-- would quietly reintroduce the drift these columns exist to stop. Rs100 spread
-- over 3 pieces is 33.333..., and three of those must still add to Rs100;
-- storing 33.33 loses a paisa here and a rupee across a project, which is how a
-- total stops equalling its own column. The rounding happens ONCE, when the day
-- is summed - tests/fabPeriodReport.test.ts pins exactly this.
--
-- ─────────────────── NOT BACKFILLED, AND CANNOT HONESTLY BE ─────────────────
-- Pieces packed before this script have no stamp and keep being re-priced live,
-- exactly as they are today. Nothing about them changes.
--
-- A backfill would write TODAY'S answer and present it as history, and it could
-- not even be written here: the round-shape perimeter is Ramanujan's
-- approximation (lib/fab/shape.ts) and does not belong in a CASE expression.
-- The freeze starts the day this lands and moves forward. That is the honest
-- shape of it, and the same choice scripts/0063, 0064 and 0065 each made.
--
-- ─────────────────── SAFE TO APPLY BEFORE THE CODE, AND AFTER ───────────────
-- Nothing reads or writes these columns until the deploy that carries
-- lib/fab/pieceCharge.ts. The write side is best-effort and wrapped, so a
-- deploy that runs AHEAD of this script still packs pieces normally - it simply
-- does not stamp them. The read side falls back to live pricing when the
-- columns are absent, so the money card cannot go blank either way.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0065.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0066-freeze-piece-charge.sql
-- =====================================================================

BEGIN;

ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "charged_edge" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "charged_sink" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "charged_at"   TIMESTAMP(3);

COMMENT ON COLUMN "fab_piece"."charged_edge" IS
  'This piece''s share of its row''s HAND EDGE POLISH charge, in rupees, frozen '
  'at packing. NOT rounded - the per-piece share is exact and the rounding '
  'happens once when a day is summed. NULL means this piece was packed before '
  'scripts/0066 and the report re-prices it from the live row.';

COMMENT ON COLUMN "fab_piece"."charged_sink" IS
  'This piece''s share of its row''s SINK CUTTING charge, in rupees, frozen at '
  'packing. 0 on a piece with no sink - which is a real answer, not a missing '
  'one; charged_at is what says whether a stamp exists.';

COMMENT ON COLUMN "fab_piece"."charged_at" IS
  'When the two charge columns were written - at packing, in the same request '
  'that set status = PACKAGED. THE FLAG THAT SAYS A STAMP EXISTS: 0.00/0.00 is '
  'a legitimate frozen charge, so no rupee value can mean "never asked". NULL '
  'means re-price from the live fab_requirement row, which is what every piece '
  'packed before scripts/0066 does.';

-- The report reads "the stamps for these packed pieces" - a lookup by id with a
-- NOT NULL test. Partial, because every historical piece is NULL here and an
-- index over those is pages of nothing.
CREATE INDEX IF NOT EXISTS "fab_piece_charged_at_idx"
  ON "fab_piece" ("charged_at")
  WHERE "charged_at" IS NOT NULL;

COMMIT;


-- =====================================================================
-- AFTERWARDS — how much of the floor is frozen, and what it is worth.
-- =====================================================================

-- How far the freeze has spread. Straight after applying this, `frozen` is 0
-- and `live_priced` is every packed piece you have; the first number grows as
-- packages are closed from here on.
-- SELECT count(*) FILTER (WHERE charged_at IS NOT NULL)                  AS frozen,
--        count(*) FILTER (WHERE charged_at IS NULL
--                          AND status = 'PACKAGED')                      AS live_priced,
--        round(sum(coalesce(charged_edge,0))::numeric, 2)                AS frozen_edge,
--        round(sum(coalesce(charged_sink,0))::numeric, 2)                AS frozen_sink
-- FROM   fab_piece;

-- What a given day earned, from the stamps alone - the figure that can no
-- longer move. Compare it against the CEO period report for the same day: they
-- agree for pieces packed after this script, and the report is the wider number
-- because it still live-prices everything older.
-- SELECT to_char(charged_at, 'YYYY-MM-DD')                  AS day,
--        count(*)                                           AS pieces,
--        round(sum(charged_edge)::numeric, 2)               AS edge,
--        round(sum(charged_sink)::numeric, 2)               AS sink,
--        round(sum(charged_edge + charged_sink)::numeric, 2) AS total
-- FROM   fab_piece
-- WHERE  charged_at IS NOT NULL
-- GROUP  BY 1
-- ORDER  BY 1 DESC;

-- A piece that was packed but never stamped, AFTER the deploy that writes them.
-- Expected to be empty; anything here means the best-effort stamp failed and
-- the [fab/packaging] warning in the logs will say why.
-- SELECT p.piece_code, p.status, o.completed_at
-- FROM   fab_piece p
-- JOIN   fab_piece_operation o
--          ON o.piece_id = p.id AND o.operation_type = 'PACKAGING' AND o.is_completed
-- WHERE  p.charged_at IS NULL
--   AND  o.completed_at > now() - interval '7 days'
-- ORDER  BY o.completed_at DESC;



-- ############################################################################
-- ##  AFTERWARDS — PROVE NOTHING MOVED
-- ##
-- ##  Run this once, after all four sections. Every row should read
-- ##  faces = TOP and the same running_ft it had before the migration.
-- ##
-- ##  Rectangles only. The perimeter of a circle or an oval is Ramanujan's
-- ##  approximation and does not belong in a CASE expression — the application
-- ##  computes those in lib/fab/shape.ts.
-- ############################################################################

-- SELECT p.project_code, r.row_letter, r.quantity,
--        r.finished_edges, coalesce(r.edge_faces,'TOP') AS faces,
--        round(((
--            (CASE WHEN r.finished_edges LIKE '%front%' THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%back%'  THEN r.length ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%left%'  THEN r.width  ELSE 0 END)
--          + (CASE WHEN r.finished_edges LIKE '%right%' THEN r.width  ELSE 0 END))
--          * r.quantity
--          * (CASE WHEN r.edge_faces = 'BOTH' THEN 2 ELSE 1 END) / 12.0)::numeric, 2)
--                                                             AS running_ft
-- FROM   fab_requirement r
-- JOIN   fab_project p ON p.id = r.project_id
-- WHERE  coalesce(r.finished_edges,'') <> ''
--   AND  coalesce(r.shape_type::text,'RECTANGLE') = 'RECTANGLE'
-- ORDER  BY p.project_code, r.row_letter;

-- And the state of the freeze 0066 introduces. IMMEDIATELY AFTER APPLYING,
-- `frozen` is 0 and `live_priced` is every packed piece in the database. That
-- is correct and expected: 0066 does not backfill, so the freeze starts now and
-- moves forward. `frozen` grows from here as packages are closed.

-- SELECT count(*) FILTER (WHERE charged_at IS NOT NULL)      AS frozen,
--        count(*) FILTER (WHERE charged_at IS NULL
--                          AND status = 'PACKAGED')          AS live_priced,
--        round(sum(coalesce(charged_edge,0))::numeric, 2)    AS frozen_edge,
--        round(sum(coalesce(charged_sink,0))::numeric, 2)    AS frozen_sink
-- FROM   fab_piece;

-- ############################################################################
-- ##  END — 0063, 0064, 0065, 0066 applied.
-- ############################################################################
