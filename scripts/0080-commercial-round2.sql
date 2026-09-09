-- 0080: what the owner's second set of answers (2026-09-08) needs from the
--       database. docs/commercial-module/DECISIONS-2.md is the record.
--
--   * Three more Commercial roles, one per set of tasks (answers 1 and 2):
--     COMMERCIAL_DOCS      Raghav — invoices, the checklist, export documents
--     COMMERCIAL_EXEC      Setumani — all of that plus stock, PI, packing
--     COMMERCIAL_LOGISTICS Murali — enquiries, orders, challans, and the
--                          checklist APPROVAL the owner gave him on 2026-09-07
--     (COMMERCIAL_MANAGER, Santosh Thapa, already exists: everything except
--     the production planner, which answer 16 keeps admin-only.)
--   * The PI's advance percentage and the manager's override of it (answers
--     11 and 12): the truck leaves when the advance RECEIVED reaches the
--     percentage the PI asked for, or when the manager waives it in writing.
--   * The number that replaced a cancelled PI (answer 8), so the register can
--     print the cancelled one struck through with its replacement beside it.
--   * A design's colour (answer 15): a name, the L*a*b* the owner reads off
--     the sample, and the hex he may set by hand. Answer 14 makes the six-hour
--     cleaning a question of how far the colour jumps, not of a category.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0080-commercial-round2.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. 3 enum values, 10 new nullable columns on 3 tables.
-- No backfill, no UPDATE, no DROP. Re-running is a no-op.
--
-- THE ROLE VALUES CANNOT BE USED IN THIS SCRIPT (Postgres refuses a new enum
-- label inside the transaction that adds it — scripts/0051 learned this, and
-- 0079 repeated it). They are added first, standing alone.
--
-- Read-only check before and after:
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='Role' ORDER BY enumsortorder;

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMMERCIAL_DOCS';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMMERCIAL_EXEC';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMMERCIAL_LOGISTICS';

-- ───────────────────────── the advance the truck waits for ────────────────────
ALTER TABLE commercial_order ADD COLUMN IF NOT EXISTS advance_pct            NUMERIC(5,2);
ALTER TABLE commercial_order ADD COLUMN IF NOT EXISTS advance_waived_at      TIMESTAMP(3);
ALTER TABLE commercial_order ADD COLUMN IF NOT EXISTS advance_waived_by_id   TEXT;
ALTER TABLE commercial_order ADD COLUMN IF NOT EXISTS advance_waived_by_name TEXT;
ALTER TABLE commercial_order ADD COLUMN IF NOT EXISTS advance_waived_reason  TEXT;
COMMENT ON COLUMN commercial_order.advance_pct IS 'Answer 11: the percentage of the PI that must be RECEIVED before dispatch. NULL = the settings default. 0 = no advance is required.';
COMMENT ON COLUMN commercial_order.advance_waived_at IS 'Answer 12: the Commercial Manager let this truck go without the advance. Set with a reason, never silently.';

-- ───────────────────────── the PI that replaced a cancelled one ───────────────
ALTER TABLE commercial_proforma ADD COLUMN IF NOT EXISTS replaced_by_id TEXT;
CREATE INDEX IF NOT EXISTS commercial_proforma_replaced_by_id_idx ON commercial_proforma (replaced_by_id);
COMMENT ON COLUMN commercial_proforma.replaced_by_id IS 'Answer 8: the PI issued in place of this cancelled one. The register prints this one struck through with that number beside it. No FK: the row it points at is in the same table and a cascade would delete the history.';

-- ───────────────────────── a design''s colour ─────────────────────────────────
-- The owner reads L*a*b* off the sample and may overrule the hex by hand
-- (answer 15). L* is what decides an abrupt changeover (answer 14: "sudden
-- very dark like Alabaster Noir to super white"), which is why it is stored
-- as a number and not only inside the hex.
ALTER TABLE commercial_design_code ADD COLUMN IF NOT EXISTS colour_name TEXT;
ALTER TABLE commercial_design_code ADD COLUMN IF NOT EXISTS hex         TEXT;
ALTER TABLE commercial_design_code ADD COLUMN IF NOT EXISTS lab_l       NUMERIC(6,2);
ALTER TABLE commercial_design_code ADD COLUMN IF NOT EXISTS lab_a       NUMERIC(6,2);
ALTER TABLE commercial_design_code ADD COLUMN IF NOT EXISTS lab_b       NUMERIC(6,2);
COMMENT ON COLUMN commercial_design_code.lab_l IS 'CIE L* 0..100. The lightness the planning queue sequences on; the shade column stays as the readable label.';
COMMENT ON COLUMN commercial_design_code.hex IS 'The swatch. Derived from L*a*b* when the owner enters one, or typed by hand — the hand-typed value wins.';
