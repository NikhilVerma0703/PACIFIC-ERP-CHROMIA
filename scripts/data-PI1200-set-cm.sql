-- ============================================================================
-- ONE-TIME BACKFILL · mark the PI 1200 rows as ordered in CENTIMETRES
-- ============================================================================
-- WHY THIS FILE EXISTS AT ALL.
--
-- data-PI1200-desert-silk.sql inserts the 36 rows and contains NO UPDATE and NO
-- DELETE, on purpose: it is guarded with NOT EXISTS so that running it a second
-- time can never overwrite an edge selection a supervisor has since made. That
-- promise is worth keeping.
--
-- The cost of it is this: those rows were loaded BEFORE dim_unit existed, so
-- they carry NULL — which means INCHES — and re-running the loader will not
-- touch them, exactly as designed. The screens therefore still show
-- "59.4488 x 9.8425 in" where the purchase order says "151 x 25".
--
-- So the unit is set here instead, once, deliberately, in a file that says what
-- it does in its name.
--
-- ─────────────────────── WHAT IT TOUCHES, AND WHAT IT CANNOT ────────────────
-- ONE COLUMN, on ONE project's rows, and only where nobody has already set it.
--
--   * scoped to project_code = 'PI1200' — no other order can be reached
--   * only WHERE dim_unit IS NULL — an explicit 'IN' someone typed is left alone
--   * dim_unit is DISPLAY ONLY. length and width are not read, not written and
--     not converted. Not one figure of money changes: the running feet and the
--     square feet are computed from the inches in those columns and this script
--     does not go near them.
--
-- Re-running it is a no-op, because after the first run nothing is NULL.
--
-- REQUIRES scripts/0068-dimension-unit.sql. Without it the column does not
-- exist and this fails inside its transaction, changing nothing.
--
-- RUN IT:
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/data-PI1200-set-cm.sql
--
-- ROLLBACK (puts the screens back to inches, harms nothing else):
--   UPDATE fab_requirement r SET dim_unit = NULL
--     FROM fab_project p
--    WHERE p.id = r.project_id AND p.project_code = 'PI1200';
-- ============================================================================

BEGIN;

UPDATE "fab_requirement" r
   SET "dim_unit" = 'CM'
  FROM "fab_project" p
 WHERE p.id = r."project_id"
   AND p."project_code" = 'PI1200'
   AND r."dim_unit" IS NULL;

COMMIT;

-- ============================================================================
-- VERIFY (read-only)
-- ============================================================================
-- 1 · all 36, and nothing else in the database, is marked CM
--
--   SELECT p.project_code, r.dim_unit, count(*)
--     FROM fab_requirement r JOIN fab_project p ON p.id = r.project_id
--    GROUP BY 1, 2 ORDER BY 1, 2;
--
--   EXPECT  PI1200 | CM | 36     and every other project still NULL
--
-- 2 · THE STORED NUMBERS DID NOT MOVE. This is the one that matters.
--
--   SELECT row_letter, piece_label, dim_unit,
--          round(length::numeric, 4) AS stored_inches,
--          round((length * 2.54)::numeric, 2) AS screen_shows_cm,
--          round(width::numeric, 4)  AS stored_w_in,
--          round((width * 2.54)::numeric, 2)  AS screen_shows_w_cm
--     FROM fab_requirement r JOIN fab_project p ON p.id = r.project_id
--    WHERE p.project_code = 'PI1200' AND row_letter IN ('C', 'Z', 'AC');
--
--   EXPECT
--     C  | DS - Thresholds (103 x 3)   | CM | 40.5512 | 103.00 |  1.1811 |  3.00
--     Z  | DS - Window Sills(151 x 25) | CM | 59.4488 | 151.00 |  9.8425 | 25.00
--     AC | DS - Window Sills(88 x 30)  | CM | 34.6457 |  88.00 | 11.8110 | 30.00
--
--   The columns hold INCHES. The screen shows CM. That is the whole design.
--
-- 3 · no edge selection was disturbed
--
--   SELECT count(*) FILTER (WHERE finished_edges IS NOT NULL) AS still_chosen
--     FROM fab_requirement r JOIN fab_project p ON p.id = r.project_id
--    WHERE p.project_code = 'PI1200';
--
--   Whatever this was before the script, it is after it. This file writes one
--   column and that column is not this one.
-- ============================================================================
