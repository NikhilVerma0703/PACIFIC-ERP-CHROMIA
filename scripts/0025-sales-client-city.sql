-- 0025: sales_clients.city (ADDITIVE ONLY)
--
-- The Add/Edit Client form has always had a City input and the clients table
-- renders "Country, City" — but sales_clients never had the column, so the
-- value was silently discarded on create/edit. Adds the single nullable
-- column the UI was built for:
--
--   ALTER TABLE sales_clients ADD COLUMN IF NOT EXISTS city text;
--
-- Applied to the live Neon DB on 2026-07-10 (trivially additive: nullable, no
-- default, no rewrite). Unlike the raw-SQL-only 0019-style columns this one IS
-- added to the Prisma model: the column was applied before any code depending
-- on it deploys, so there is no P2022 window.

ALTER TABLE sales_clients ADD COLUMN IF NOT EXISTS city text;
