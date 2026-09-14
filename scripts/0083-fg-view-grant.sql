-- 0083: "add finished good's visibility for chromia@thepacific.group,
--        gibin@thepacific.group (full visibility but no edit options)"
--        — the owner, 2026-09-14.
--
-- WHY A PER-LOGIN COLUMN AND NOT A ROLE. Both of those logins are LINE_MANAGER:
-- chromia@ on the CHROMIA branch, gibin@ on FABRICATION. Finished goods is an
-- OFFICE module and hasInventoryAccess() asks for branch = OFFICE, so there is
-- no role+branch pair that means "these two people and nobody else":
--
--   * adding LINE_MANAGER to INVENTORY_ROLES would hand finished goods to every
--     line manager on every branch, now and every one created afterwards;
--   * moving either login to OFFICE would take away the Chromia and Fabrication
--     screens they are on the branch FOR;
--   * the altRole/altBranch second job is the right shape but the wrong grant —
--     the smallest office role that carries inventory is ACCOUNTS, which also
--     carries the edit buttons this answer explicitly withholds, and it would
--     put their own module behind a context switch.
--
-- So the grant is what it says: this login may LOOK at finished goods. It is
-- one boolean, it defaults to false, and it is visible in Users & Roles next to
-- the person it belongs to rather than buried in a role table that somebody
-- later widens for an unrelated reason.
--
-- VIEW, AND ONLY VIEW. The column is read by inventoryReadGate(); every route
-- that changes anything keeps the older inventoryGate(), which refuses it. That
-- direction is deliberate: a write route added later and gated the usual way is
-- refused to these logins by default, and a read has to opt in by name. The
-- fail-open version of this — a new "write" gate that routes must remember to
-- use — would have given a viewer whatever the next author forgot.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0083-fg-view-grant.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. One column, defaulted false, plus a partial index so
-- "who has this" is one lookup rather than a scan of every login. No backfill,
-- no UPDATE, no DROP: the two grants are made separately and verified, because
-- handing out access is a thing to do with the names in front of you.

ALTER TABLE users ADD COLUMN IF NOT EXISTS fg_view BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.fg_view IS
  'May READ finished-goods inventory, whatever branch this login is on, and may change nothing in it (owner, 2026-09-14). Read by inventoryReadGate(); inventoryGate(), which guards every write, refuses it.';

-- Granted to very few people, asked about on every render of the sidebar.
CREATE INDEX IF NOT EXISTS users_fg_view_idx ON users (fg_view) WHERE fg_view;
