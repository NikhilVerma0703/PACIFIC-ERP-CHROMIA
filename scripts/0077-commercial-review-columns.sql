-- 0077: four gaps the Commercial module's adversarial review and its builders
--       found in 0076. All four are places where a fact had nowhere to live and
--       was being written into a free-text field or rounded away.
--
-- 1. A CANCELLATION IS AN AUDIT FACT, NOT A NOTE. commercial_invoice records one
--    properly (cancelled_at + cancel_reason). commercial_proforma has neither,
--    and commercial_delivery_challan has the timestamp but no reason, so both
--    cancel routes were appending "Cancelled: <reason>" to `notes` — the same
--    column a human types remarks into. Three columns end it.
--
-- 2. AN EXPORT INVOICE CARRIES THREE DECIMALS. commercial_invoice.subtotal is
--    already NUMERIC(16,3) — the reference PI's own figure is USD 17,324.657 —
--    but grand_total was NUMERIC(16,2), so the register row read 17,324.66 while
--    the PDF and the amount in words said .657. Two figures for one document,
--    and the register's "Billed value" total (a SUM over this column) inherited
--    the truncation on every export row. Widening 2 -> 3 is lossless.
--
-- 3. THE BILL OF LADING AND THE SHIPPING BILL HAVE NOWHERE TO GO. The packing
--    list prints boxes for both; the numbers are issued by the shipping line and
--    by customs AFTER the container leaves, so they are typed in later. With no
--    column the generator could only ever print them blank, and the office
--    writes them on the sheet by hand.
--
-- Applied 2026-09-06 (verified: 5 columns present, grand_total numeric scale 3,
-- `prisma migrate diff` shows no drift on commercial_*). To re-run (a no-op):
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0077-commercial-review-columns.sql
--   npx prisma generate
-- (NOT `prisma db push` — it drops undeclared columns; see CLAUDE.md and
-- scripts/NEON-PRODUCTION-RUNBOOK.md.)
--
-- ADDITIVE AND IDEMPOTENT. 5 new nullable columns on 3 tables, 1 widening type
-- change, 0 new tables, 0 enum changes, 0 indexes, 0 foreign keys. No backfill,
-- no UPDATE, no DROP. Re-running is a no-op.
--
-- THE ONE NON-ADDITIVE LINE is the NUMERIC(16,2) -> NUMERIC(16,3) widening.
-- Postgres rewrites the column; it cannot lose a value, because every scale-2
-- number is representable at scale 3. All four tables hold 0 rows today
-- (verified on live Neon 2026-09-06), so the rewrite is on empty tables.
--
-- Read-only check before and after:
--   SELECT table_name, column_name, data_type, numeric_scale, is_nullable
--     FROM information_schema.columns
--    WHERE table_name IN ('commercial_proforma','commercial_delivery_challan','commercial_invoice','commercial_packing_list')
--      AND column_name IN ('cancelled_at','cancel_reason','grand_total','bl_no','sb_no')
--    ORDER BY 1, 2;

-- 1. cancellation, recorded where a cancellation belongs
ALTER TABLE commercial_proforma
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP(3);

ALTER TABLE commercial_proforma
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE commercial_delivery_challan
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- 2. an export invoice's third decimal
ALTER TABLE commercial_invoice
  ALTER COLUMN grand_total TYPE NUMERIC(16,3);

-- 3. the two numbers that arrive after the container does
ALTER TABLE commercial_packing_list
  ADD COLUMN IF NOT EXISTS bl_no TEXT;

ALTER TABLE commercial_packing_list
  ADD COLUMN IF NOT EXISTS sb_no TEXT;

COMMENT ON COLUMN commercial_proforma.cancel_reason IS 'Why this revision was cancelled — an audit fact, kept out of notes.';
COMMENT ON COLUMN commercial_delivery_challan.cancel_reason IS 'Why this challan was cancelled — an audit fact, kept out of notes.';
COMMENT ON COLUMN commercial_packing_list.bl_no IS 'Bill of lading number, issued by the shipping line after the container leaves.';
COMMENT ON COLUMN commercial_packing_list.sb_no IS 'Shipping bill number, issued by customs after the container leaves.';
