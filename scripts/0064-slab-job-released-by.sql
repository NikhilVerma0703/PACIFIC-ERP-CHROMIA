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
