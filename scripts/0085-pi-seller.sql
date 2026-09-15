-- 0085: which of the group's companies is SELLING this order (the owner,
--       2026-09-15: "monolith is our subsidery and we are selling with the
--       name of monolith to m&g imports llc").
--
-- Until today the module knew exactly one seller — Pacific Engineered Surfaces
-- Private Limited, an Indian exporter — and every proforma was built from it
-- without asking. A second company now sells: MONOLITH SURFACES INC, a US
-- subsidiary with its own address and its own bank, and the owner chose a
-- genuine US invoice over merely swapping the name on the Indian one. So the
-- Indian block that made no sense for it — GSTIN, IEC, RBI code, the
-- jurisdictional customs office, the "goods of Indian Origin" declaration —
-- is not printed for that seller at all.
--
-- A KEY, NOT AN ADDRESS. The column names which selling entity, and everything
-- printed about that entity lives in settings beside the company master, where
-- an address or a bank can be corrected once for every future document. A
-- column holding the name would have frozen a typo into the order.
--
-- NULLABLE, AND NULL MEANS PACIFIC. Every order raised before today has no
-- seller and must keep printing exactly as it did; the same is true of every
-- proforma already frozen, which carries no seller key in its snapshot. Absent
-- is not "unknown, ask somebody" — it is the default seller, and the code says
-- so in one place.
--
-- WHY IT SITS ON THE ORDER. The seller is a property of the deal, not of the
-- piece of paper: every proforma, invoice and challan of one order goes out
-- under one company, and a revision must not be able to change which. The PI
-- copies it into its frozen snapshot at draft time, so a printed document keeps
-- the identity it was printed with.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0085-pi-seller.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. One nullable column. No backfill, no UPDATE, no DROP.

ALTER TABLE commercial_order ADD COLUMN IF NOT EXISTS seller_key TEXT;

COMMENT ON COLUMN commercial_order.seller_key IS
  'Which group company sells this order — a key into the selling entities in commercial settings (owner, 2026-09-15). NULL means the default, Pacific Engineered Surfaces, so every order raised before this column existed prints unchanged. Copied into the PI snapshot at draft time.';
