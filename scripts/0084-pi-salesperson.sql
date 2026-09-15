-- 0084: the salesperson a DTA proforma is raised for (the owner, 2026-09-15:
--       "for dta a small section for salesperson — who has asked for the PI
--       for his customer/consignee").
--
-- WHY IT IS NOT createdByName. The person who TYPES the PI is the commercial
-- desk; the person it is FOR is the salesperson who brought the customer and
-- who will be asked about it when the buyer calls. On a domestic invoice those
-- are routinely two different people, and the whole value of the new block is
-- naming the second one. Reusing the stamp would print the desk's own name and
-- answer nobody's question.
--
-- WHY IT SITS ON THE ORDER AND NOT ON THE PROFORMA. Every PI of an order is
-- raised for the same salesperson, and a revision must not be able to change
-- who that was. The PI copies it into its frozen snapshot at draft time, so a
-- printed PI keeps the name it was printed with even if the order is later
-- reassigned — the same rule the rest of the snapshot follows.
--
-- EXPORT ORDERS MAY CARRY IT TOO, and simply do not print it: the block is
-- domestic-only by the owner's words, and a column that refused to hold a value
-- on an export order would make reassigning an order between the two kinds lose
-- data for no reason.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0084-pi-salesperson.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. One nullable column. No backfill, no UPDATE, no DROP.

ALTER TABLE commercial_order ADD COLUMN IF NOT EXISTS salesperson_name TEXT;

COMMENT ON COLUMN commercial_order.salesperson_name IS
  'The salesperson this order''s PI is raised for — who asked for it on behalf of his customer (owner, 2026-09-15). Printed on the DTA proforma only; copied into the PI snapshot at draft time so a printed PI keeps the name it carried.';
