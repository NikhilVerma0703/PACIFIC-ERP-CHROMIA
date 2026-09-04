-- Two things the review of 0074 found missing, both cheap now and dear later.
--
-- 1. WHICH PATH WROTE THE LINE. The sign-off sheet badges lines "from the
--    floor" so the verifier can tell a figure the station reported while
--    working from one the office typed a week later. It was inferring that
--    from operator_name being set — and the sheet ALSO sets operator_name (it
--    pre-fills the station's operator on every blank row), so a sheet-typed
--    line came back badged as the floor's, and a floor line whose name was
--    cleared lost its badge. A fact about provenance has to be written by the
--    path that has it, not guessed from a field both paths share.
--    Values: 'floor' (the machine-form panel) | 'signoff' (the verify screen).
--    Nullable and unbackfilled: the table holds 0 rows (2026-09-04).
--
-- 2. ONE ITEM, ONE ROW. The floor can now create stock items by typing a name
--    (0074's reason). The guard against "Gloves" and "gloves" becoming two rows
--    was a findFirst-then-create in application code, which two incharges at
--    two stations can race through in one Neon round-trip — and once two rows
--    exist, the floor's decrement lands on whichever one findMany returned
--    last while the store's top-up lands on the other, and the stock is split
--    for good. A unique index on lower("itemName") makes the second insert
--    fail instead.
--
--    THE FLOOR NO LONGER CREATES ITEMS (owner, later on 2026-09-04: "only
--    dropdown"), so the race this was written for cannot start from a machine
--    form any more. The index STAYS: the store's own add-item screen
--    (/api/consumables/inventory) does the same findFirst-then-create, and two
--    store logins can race it just the same. There it surfaces as a 500 on the
--    loser rather than a second row, which is the right outcome.
--
--    PRISMA CANNOT DECLARE A FUNCTIONAL INDEX, so `prisma migrate diff` will
--    list this as a DROP INDEX from now on. That is an index tweak of the kind
--    CLAUDE.md already classes as safe drift — not a table or a column — and it
--    is named here so nobody reads it as an accident. A `db push` would drop
--    the guard, not any data; re-run this script after one.
--
-- Read-only check before and after:
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'consumable_inventory_stock';
--   SELECT lower("itemName"), count(*) FROM consumable_inventory_stock GROUP BY 1 HAVING count(*) > 1;

ALTER TABLE consumable_consumption_entry
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS consumable_inventory_stock_item_name_lower_key
  ON consumable_inventory_stock (lower("itemName"));
