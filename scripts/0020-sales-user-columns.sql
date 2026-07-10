-- 0020 — International Sales columns on users (Int'l Sales port, Phase 2).
-- ADDITIVE ONLY. Do NOT run automatically: the user applies this manually after review.
-- Must be applied BEFORE this branch is deployed (the Prisma client now selects these columns).
--
-- sales_role: the fork's SalesRole stored as plain text (e.g. SALESPERSON, MANAGER, ADMIN).
--             PRODUCTION_MANAGER is retired — those duties belong to ADMIN users now.
-- sales_factory: factory scope for stock checks / production visibility inside the module.

ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_role text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_factory text;
