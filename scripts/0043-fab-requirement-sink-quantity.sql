-- 0043: fab_requirement.sink_quantity — the supervisor's per-row sink count.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0043-fab-requirement-sink-quantity.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and raw-SQL-only
-- columns that push proposes dropping — see the note at the top of the sales
-- section in schema.prisma and scripts/0040.)
--
-- WHY. The manager's upload used to carry a sink-cut count per drawing row and
-- routing was derived from it. The new intake is a flat Length / Width / Qty /
-- SFT list with no sink information at all, so the sink decision moves to the
-- supervisor, who marks a requirement row and says how many of its pieces get
-- one — 3 of 10 is a normal answer, and the default when he picks a row is the
-- full quantity. fabrication_required still tracks the sink exactly, and
-- polish_required is now true for every piece, so this is the only new fact the
-- database has to hold.
--
-- PURELY ADDITIVE AND IDEMPOTENT. One nullable column, no default, no backfill,
-- no index, nothing dropped, nothing rewritten. Re-running it is a no-op.
-- Applying it changes no existing row and no existing query: every read path
-- today selects named columns or Prisma-generated ones, and code that does not
-- know about sink_quantity behaves exactly as it did.
--
-- NULLABLE, AND NO DEFAULT — on purpose.
--   * NULL means "the supervisor has not looked at this row yet". 0 means "he
--     looked and said no sinks". Those are different facts about a decision a
--     human has to make, and a DEFAULT 0 would assert the second one on behalf
--     of every requirement that already exists, including several thousand rows
--     whose sinks were driven by the old sink_cuts column.
--   * They route identically: resolveSinkQuantity() in
--     src/lib/fab/requirement-derive.ts folds NULL and 0 to the same 0, so the
--     distinction costs nothing at read time and is there when a UI wants to
--     badge the un-reviewed rows.
--   * A nullable column with no default is also the cheapest DDL Postgres has —
--     a catalogue entry, no table rewrite, no lock held while 10k rows are
--     touched.
--
-- The value is a count of PIECES, so 0 <= sink_quantity <= quantity. That is not
-- enforced by a CHECK: quantity is editable, and a constraint that can be
-- violated by a legitimate edit elsewhere turns a routine quantity change into a
-- failed transaction. The application clamps instead (resolveSinkQuantity), so a
-- stale over-large value degrades to "all pieces", which is the safe reading.

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "sink_quantity" INTEGER;

COMMENT ON COLUMN "fab_requirement"."sink_quantity" IS
  'How many of this requirement''s pieces get a sink (supervisor-set). NULL = not yet reviewed, 0 = none, = quantity means all. fabrication_required follows the sink; polish applies to every piece.';
