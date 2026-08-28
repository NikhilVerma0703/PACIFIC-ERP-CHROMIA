-- =====================================================================
-- 0058-sampling-finish-vocabulary.sql
--
-- THE FOUR FINISHES, IN THE OWNER'S WORDS.
--
--     "I need the finish type of all — polished, suede, matte, leathered."
--
-- product_colour_finish.finish was seeded with the spellings transcribed off
-- the printed chart: Polished, Leather, Suede, Honed. Two of those are the
-- same finishes under different names:
--
--     Leather -> Leathered   the owner's word, and the one the ERP already
--                            uses in finished_slab.polish_type
--     Honed   -> Matte       honed IS the matte finish. The trade says one,
--                            the owner says the other, and a vocabulary
--                            carrying both counts one shelf of stock as two.
--
-- Only THREE rows in the whole chart carry a non-default finish — Cappuccino
-- (Leather), Taj Vein (Leather) and Alabaster Noir – Suede — so this touches
-- two rows in practice. Nothing was ever seeded as Honed; that arm exists
-- because somebody may have typed it since.
--
-- ─────────────────────────────────── THE MERGE, AND WHY IT IS NEEDED ───────
-- (colour_id, finish) is UNIQUE. If a colour somehow holds BOTH "Leather" and
-- "Leathered" — one seeded, one created by hand — a plain UPDATE violates that
-- constraint and the whole script fails. So the duplicates are folded first:
-- stock, intake and dispatch lines are re-pointed at the surviving row and the
-- loser is deleted. NO COUNT IS LOST; the two shelves become one, which is
-- what they always were.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0057.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0058-sampling-finish-vocabulary.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Fold any colour that holds BOTH spellings onto the new one.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT old_row.id AS old_id, new_row.id AS new_id
    FROM   product_colour_finish old_row
    JOIN   product_colour_finish new_row
           ON new_row.colour_id = old_row.colour_id
    WHERE  (old_row.finish = 'Leather' AND new_row.finish = 'Leathered')
       OR  (old_row.finish = 'Honed'   AND new_row.finish = 'Matte')
  LOOP
    -- Every table that points at a colour+finish row. Stock is SUMMED rather
    -- than moved: both shelves are the same shelf, and dropping one would
    -- lose its count.
    UPDATE sampling_stock s
    SET    quantity = s.quantity + old_s.quantity
    FROM   sampling_stock old_s
    WHERE  s.colour_finish_id = pair.new_id
      AND  old_s.colour_finish_id = pair.old_id
      AND  old_s.size_id = s.size_id;

    -- A size the old row had and the new one did not simply changes hands.
    UPDATE sampling_stock
    SET    colour_finish_id = pair.new_id
    WHERE  colour_finish_id = pair.old_id
      AND  size_id NOT IN (
             SELECT size_id FROM sampling_stock WHERE colour_finish_id = pair.new_id
           );

    DELETE FROM sampling_stock WHERE colour_finish_id = pair.old_id;

    -- The ledgers are append-only history and are simply re-pointed.
    UPDATE sampling_intake        SET colour_finish_id = pair.new_id WHERE colour_finish_id = pair.old_id;
    UPDATE sampling_dispatch_line SET colour_finish_id = pair.new_id WHERE colour_finish_id = pair.old_id;

    DELETE FROM product_colour_finish WHERE id = pair.old_id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Rename what is left. No duplicates can remain after step 1.
-- ---------------------------------------------------------------------
UPDATE product_colour_finish SET finish = 'Leathered' WHERE finish = 'Leather';
UPDATE product_colour_finish SET finish = 'Matte'     WHERE finish = 'Honed';

COMMENT ON COLUMN "product_colour_finish"."finish" IS
  'One of src/lib/catalogue/colours.ts FINISHES: Polished, Suede, Matte, '
  'Leathered. TEXT rather than an enum so adding a finish is a seed edit '
  'and not a migration. A row is created on first use — every colour can be '
  'cut in any finish, and the chart only ever printed the photographed ones.';

COMMIT;


-- =====================================================================
-- AFTERWARDS — what the chart now holds.
-- =====================================================================

-- Must return only the four words:
-- SELECT finish, count(*) AS colours
-- FROM   product_colour_finish
-- GROUP  BY finish
-- ORDER  BY colours DESC;

-- Must return 0 rows — anything here is a spelling nothing in the app knows:
-- SELECT DISTINCT finish
-- FROM   product_colour_finish
-- WHERE  finish NOT IN ('Polished', 'Suede', 'Matte', 'Leathered');

-- The colours that have more than one finish on the shelf:
-- SELECT c.name, string_agg(f.finish, ' + ' ORDER BY f.finish) AS finishes
-- FROM   product_colour_finish f
-- JOIN   product_colour c ON c.id = f.colour_id
-- GROUP  BY c.name
-- HAVING count(*) > 1
-- ORDER  BY c.name;
