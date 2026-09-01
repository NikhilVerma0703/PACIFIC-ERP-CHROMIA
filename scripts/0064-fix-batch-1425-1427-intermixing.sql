-- Batch 1425/1426/1427 intermixing — one-time data repair.
--
-- WHY NOTHING CAUGHT THIS. The app's wrong-batch detector (lib/batchMismatch)
-- treats the LINE HEAD (Distributor/Kreos) as the authority for a slab's true
-- batch, and neither 1426 nor 1427 was ever opened at the line head — so it
-- returns "cannot judge" and reports zero problems for both. The authority
-- used here instead is the agreement of Press + Jot + MIS, which match each
-- other exactly:
--     1425  156132-156366  (235 slabs)  Calacatta Gold
--     1426  156367-156571  (205 slabs)  Honey dew
--     1427  156572-156637  (66 slabs)   Calacatta Grey
--
-- Every statement below is written to match ONLY the rows described, and each
-- carries its old value in the WHERE clause, so re-running it is a no-op and a
-- row somebody has since corrected by hand is left alone.

BEGIN;

-- A1. OVEN, the big one. On 27 Aug 10:51-10:53 the oven operator entered the
-- whole of batch 1427 under "D 1426". For slabs 156572-156575 a CORRECT 1427
-- row already existed (entered 26 Aug 22:59 / 27 Aug 00:20), so these four are
-- duplicates and go, rather than being moved on top of the real rows.
DELETE FROM oven
 WHERE batch_key = '1426' AND slab_number BETWEEN 156572 AND 156575;

-- A2. The other 62 are the ONLY oven record for their slab, so they are moved,
-- not deleted. (Their `date` column also says 26 Aug where the correct rows say
-- 27 Aug; the date is deliberately NOT touched here — this repair is about the
-- batch, and a date move changes which day the work reports on.)
UPDATE oven
   SET batch = 'D1427', batch_key = '1427'
 WHERE batch_key = '1426' AND slab_number BETWEEN 156576 AND 156637;

-- B. PRESS. Batch 1424 ends at 156131 at every other station (distributor,
-- jot, oven, QC all stop there); press alone carries 156132-156133 under 1424,
-- entered 24 Aug 02:55, and then AGAIN under 1425 at 09:45. The 1424 pair is
-- the stray — the operator had not yet switched the batch on the form.
DELETE FROM press
 WHERE batch_key = '1424' AND slab_number IN (156132, 156133);

-- C. POLISH QC + its finished-goods mirror: slab 156615 sits in 1427's range
-- but was graded under 1426.
UPDATE polish_qc
   SET batch_number = 'D1427', batch_key = '1427'
 WHERE slab_number = 156615 AND batch_key = '1426';

UPDATE fg_finished_slab
   SET batch_number = 'D1427', batch_key = '1427'
 WHERE slab_number = 156615 AND batch_key = '1426';

-- D. FINISHED GOODS disagreeing with the QC row it mirrors: three slabs graded
-- under 1425 were written into finished goods as 1428.
UPDATE fg_finished_slab
   SET batch_number = 'D1425', batch_key = '1425'
 WHERE slab_number IN (156200, 156201, 156202) AND batch_key = '1428';

-- E. POLISH ENTRY, two mis-typed SLAB NUMBERS (not wrong batches). Both rows
-- are filed under 1406 and both name a slab 1406 never had, while the slab
-- they were plainly meant to name is a real 1406 slab — pressed and QC'd —
-- that has no polish entry at all. Only three 1406 slabs lack one, and these
-- two typos land exactly on two of them.
--   1531452 -> 153452  (a stray leading digit; 1531452 exists at no station)
--   156343  -> 153643  (a 3/6 transposition; 156343 is a 1425 slab that
--                       already has its own polish entry under 1425)
UPDATE polish_entry SET slab_number = 153452
 WHERE id = 'cmsmyoi6w001fkz04hi0hw8aa' AND slab_number = 1531452;

UPDATE polish_entry SET slab_number = 153643
 WHERE id = 'cmsnvjysh000gl704idacocu1' AND slab_number = 156343;

-- The repair, on the record.
INSERT INTO action_log (id, created_at, actor, batch_key, kind, model, summary, payload, undone)
VALUES (
  'fix-1425-1427-intermix', now(), 'data repair (scripts/0064)', '1427',
  'batch_intermix_repair', 'Oven/Press/PolishQc/PolishEntry/FinishedSlab',
  'Batch 1425-1427 intermixing: 62 oven rows moved 1426->1427, 4 duplicate oven rows and 2 stray press rows deleted, slab 156615 moved 1426->1427 in QC and finished goods, 156200-156202 corrected 1428->1425 in finished goods, and two mis-typed polish-entry slab numbers corrected (1531452->153452, 156343->153643).',
  '{"authority":"press+jot+MIS agreement","ranges":{"1425":"156132-156366","1426":"156367-156571","1427":"156572-156637"}}'::jsonb,
  false
) ON CONFLICT (id) DO NOTHING;

COMMIT;
