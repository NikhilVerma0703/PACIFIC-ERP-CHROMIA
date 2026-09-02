-- 0047 — Per-slab Production Date for the Robo module.
--
-- A batch can run past midnight: slabs 1-80 on 1 Sep, slab 81 at 00:03 on
-- 2 Sep. The operator now sets a production date per slab, so slab 81 reads
-- 2 Sep while slabs 1-80 stay 1 Sep — same batch, same shift, same running
-- S.No. This adds the column that holds that per-slab date.
--
-- Modelled in prisma/schema.prisma as `RoboProductionRecord.productionDate
-- String?`. Nullable and additive: existing and imported slabs are NULL and
-- keep falling back to the setup's date, then the shift's, exactly as before —
-- so this is SAFE to run against the live database before the new code ships,
-- and the currently-deployed code, which does not reference the column, is
-- unaffected.
--
-- RUN THIS ON NEON BEFORE DEPLOYING the round with the per-slab date. The app
-- writes a real yyyy-mm-dd string or NULL, never "".

ALTER TABLE "RoboProductionRecord" ADD COLUMN IF NOT EXISTS "productionDate" TEXT;
