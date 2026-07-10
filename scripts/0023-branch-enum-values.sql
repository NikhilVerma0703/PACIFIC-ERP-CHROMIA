-- 0023 — Branch enum: add the department values the code already uses.
-- The type was created in 0005 with only SHOP_FLOOR/OFFICE; FABRICATION was
-- added by hand at some point and INTERNATIONAL_SALES never was — so every
-- users query filtered by INTERNATIONAL_SALES throws (invalid enum value),
-- Users & roles fell back to the UNFILTERED list, and sales logins can't be
-- created. ADDITIVE ONLY, safe to run repeatedly. Apply manually (Neon SQL).
ALTER TYPE "Branch" ADD VALUE IF NOT EXISTS 'FABRICATION';
ALTER TYPE "Branch" ADD VALUE IF NOT EXISTS 'INTERNATIONAL_SALES';
