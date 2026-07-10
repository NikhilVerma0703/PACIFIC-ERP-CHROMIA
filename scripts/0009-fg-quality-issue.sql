-- Finished goods: mirror PolishQc's quality issues on the inventory row.
-- Additive only; no existing data touched.
ALTER TABLE "fg_finished_slab" ADD COLUMN IF NOT EXISTS "quality_issue" TEXT[] NOT NULL DEFAULT '{}';
