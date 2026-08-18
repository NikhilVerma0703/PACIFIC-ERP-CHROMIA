-- 0022 — Int'l Sales P3: credit-note application + packing-list review columns.
-- ADDITIVE ONLY (safe to re-run). These are REQUIRED by the ported module:
-- /api/sales/credit-notes* filters on applied_to_order_id/applied_at (raw SQL)
-- and /api/sales/orders/[id]/packing-list-email drives the accept/reject flow
-- via rejection_reason/rejected_at/accepted_at. They existed in the fork only
-- through its ad-hoc prisma/migrate-pending.js, so 0019 missed them.

ALTER TABLE sales_credit_notes ADD COLUMN IF NOT EXISTS applied_to_order_id text;
ALTER TABLE sales_credit_notes ADD COLUMN IF NOT EXISTS applied_at timestamp(3);

ALTER TABLE sales_packing_lists ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE sales_packing_lists ADD COLUMN IF NOT EXISTS rejected_at timestamp(3);
ALTER TABLE sales_packing_lists ADD COLUMN IF NOT EXISTS accepted_at timestamp(3);
