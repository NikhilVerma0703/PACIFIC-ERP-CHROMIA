-- =====================================================================
-- 0067-maintenance-ticket-ref-seq.sql
--
-- MT- NUMBERS COME FROM A SEQUENCE, NOT FROM READING THE HIGHEST ONE.
--
-- src/lib/maintenanceLog.ts built the next reference by selecting the largest
-- existing `ref` and adding one. That is wrong twice over, and both are the
-- kind of wrong that only shows up on a busy day or in two years' time.
--
-- ─────────────────────────────────── THE RACE ─────────────────────────────
-- Two incharges raising a fault in the same second both read the same MAX and
-- both proposed the same reference. `maintenance_ticket.ref` is UNIQUE (see
-- 0036 — deliberately, because the number is spoken across the floor and must
-- mean one fault), so the loser's INSERT failed and the maintenance page told
-- them "Could not raise it" for a fault that was real. A floor that gets told
-- that twice stops reporting, which is the failure mode the whole log exists
-- to prevent. nextval() cannot issue the same number twice and does not wait
-- on anybody else's uncommitted row.
--
-- ─────────────────────────────────── THE JAM AT FIVE DIGITS ───────────────
-- `ORDER BY ref DESC` is a TEXT sort. 'MT-9999' > 'MT-10000' as strings, so
-- the moment the ten-thousandth ticket existed the scan kept naming MT-9999 as
-- the newest, kept proposing MT-10000 — and every raise from then on collided
-- with the row already holding it. Not a slowdown: a permanent hard stop on
-- raising faults, arriving with no warning. (The code's fallback path now
-- orders on substring(ref from 4)::bigint, so the jam is gone even where this
-- script has not been applied.)
--
-- ─────────────────────────────────── BOTH SHAPES KEEP WORKING ─────────────
-- nextRef() asks the sequence first and falls back to the (now numerically
-- ordered) scan when the sequence is not there. So this script is not a
-- prerequisite for the code — deploy order does not matter, and a database
-- that never runs it still raises tickets correctly, just without the race
-- protection. Nothing reads the sequence except nextRef().
--
-- IDEMPOTENT. Safe to re-run: setval() is recomputed from the table each time,
-- and it only ever moves the sequence FORWARD (the GREATEST against
-- last_value), so re-running after tickets have been raised cannot hand out a
-- number that is already on a row.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0067-maintenance-ticket-ref-seq.sql
--
-- NOT declared in prisma/schema.prisma, and that is fine: `prisma db push`
-- drops columns and tables it does not know about, not sequences it was never
-- told to manage. The `ref` column itself is declared on model
-- MaintenanceTicket and stays plain text — the sequence supplies the number,
-- the application still formats it as MT-0001. Do NOT make ref a serial or
-- attach a DEFAULT: the padding and the "MT-" belong to one place, and that
-- place is nextRef().
-- =====================================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS "maintenance_ticket_ref_seq" AS bigint START WITH 1;

COMMENT ON SEQUENCE "maintenance_ticket_ref_seq" IS
  'Supplies the number in maintenance_ticket.ref (MT-0001 ...). Read only by '
  'nextRef() in src/lib/maintenanceLog.ts, which formats and prefixes it. '
  'Exists because deriving the next ref from MAX(ref) both raced under '
  'concurrent raises and jammed for ever at MT-10000 on a text sort. '
  'See scripts/0067-maintenance-ticket-ref-seq.sql.';

-- Start above every reference already on the table, so the first ticket raised
-- after this lands next to the last one raised before it and the floor sees an
-- unbroken run of numbers. GREATEST against last_value makes the re-run safe:
-- a second execution after new tickets exist can only push the sequence up.
--
-- The regex filter is not decoration. Any ref that is not exactly MT-<digits>
-- was not produced by nextRef(), and substring(...)::bigint on it would abort
-- the whole script; skipping those rows is right, because a malformed ref
-- cannot tell us anything about how high the real numbering has climbed.
DO $$
DECLARE
  high bigint;   -- highest MT- number already on the table
  cur  bigint;   -- highest number the sequence has already handed out
BEGIN
  SELECT COALESCE(MAX(substring("ref" from 4)::bigint), 0) INTO high
    FROM "maintenance_ticket"
   WHERE "ref" ~ '^MT-[0-9]+$';

  -- is_called FALSE means "created, never drawn from" — last_value reads 1 but
  -- no 1 has been issued. Treating that as 1 would burn MT-0001 on a virgin
  -- database, so it counts as 0 here.
  SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO cur
    FROM "maintenance_ticket_ref_seq";

  IF GREATEST(high, cur) = 0 THEN
    -- Nothing raised yet anywhere: the FIRST nextval() must return 1, so the
    -- first ticket on the floor is MT-0001 and not MT-0002.
    PERFORM setval('maintenance_ticket_ref_seq', 1, false);
  ELSE
    -- is_called TRUE: this number is spent, the next nextval() is one past it.
    PERFORM setval('maintenance_ticket_ref_seq', GREATEST(high, cur), true);
  END IF;
END $$;

COMMIT;


-- =====================================================================
-- AFTERWARDS — check the sequence sits above the table, not inside it.
-- =====================================================================

-- Must show last_value >= the highest MT- number on the table. If it does not,
-- the very next raise will collide with an existing ref.
-- SELECT (SELECT last_value FROM maintenance_ticket_ref_seq)            AS seq_at,
--        (SELECT MAX(substring(ref from 4)::bigint)
--           FROM maintenance_ticket WHERE ref ~ '^MT-[0-9]+$')          AS highest_ref;

-- Must return 0 rows: refs nextRef() could not have written, which the setval
-- above deliberately ignored. Worth a look if any appear.
-- SELECT id, ref, raised_at FROM maintenance_ticket WHERE ref !~ '^MT-[0-9]+$';
