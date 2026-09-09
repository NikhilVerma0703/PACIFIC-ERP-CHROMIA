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
