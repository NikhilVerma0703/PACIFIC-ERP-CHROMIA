-- 0024: part-payment support on payment divisions (ADDITIVE ONLY)
--
-- Adds a single nullable column to sales_payment_divisions:
--   amount_received double precision NULL
--     Cumulative amount received against this division. NULL/0 = nothing
--     received; 0 < amount_received < amount = partial (division stays
--     PENDING/OVERDUE and the UI shows the balance); when a payment brings
--     amount_received to >= amount the API marks the division fully paid
--     (paid_at + status PAID) exactly like the old "Mark Paid" button.
--
-- Following the 0019 convention for post-launch columns, this column is NOT
-- added to the Prisma model: it is read/written with raw SQL only, so stale
-- deploys keep working while the column rolls out (no P2022 class of failure).
--
-- Applied to the live Neon DB on 2026-07-10 (trivially additive: new nullable
-- column, no defaults, no rewrites, no locks beyond a fast catalog update).

ALTER TABLE sales_payment_divisions
  ADD COLUMN IF NOT EXISTS amount_received double precision;
