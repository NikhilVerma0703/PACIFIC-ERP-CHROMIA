-- Consumables: which batch, which station, whose hand, and what it cost.
--
-- WHY. A consumption entry recorded four things — department, item, quantity,
-- unit — and put everything else in a free-text remark ("Logged at Press form
-- by Suresh"). That is enough for a dashboard that asks "how much grease did
-- Polishing draw this month" and not enough for the question the owner asked
-- on 2026-09-04: at batch sign-off, Satya and the store incharge must see what
-- was used AT EACH STATION, BY WHOM, ON THIS BATCH, and put a price against it.
-- None of those four facts could be answered from a remark string.
--
-- Every column is NULLABLE and nothing is backfilled, deliberately: the table
-- is empty today (0 rows, measured 2026-09-04), and a column that can be null
-- is one an older row can honestly leave blank rather than one a migration has
-- to invent an answer for.
--
-- THE PRICE IS PER LINE, BY DECISION (owner, 2026-09-04), not a rate card. A
-- consumable's price is what the store paid for that batch's drum of it, so it
-- is a fact about the line and not about the item. priced_by / priced_at carry
-- the name and time the way every other sign-off in this schema does, because a
-- number that decides money must say who put it there.
--
-- Read-only check before and after:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'consumable_consumption_entry' ORDER BY ordinal_position;

ALTER TABLE consumable_consumption_entry
  ADD COLUMN IF NOT EXISTS batch_key     TEXT,
  ADD COLUMN IF NOT EXISTS station       TEXT,
  ADD COLUMN IF NOT EXISTS operator_name TEXT,
  ADD COLUMN IF NOT EXISTS entered_by    TEXT,
  ADD COLUMN IF NOT EXISTS unit_price    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS priced_by     TEXT,
  ADD COLUMN IF NOT EXISTS priced_at     TIMESTAMP(3);

-- The sign-off screen reads one batch at a time and nothing else does; without
-- this it is a sequential scan of every consumption the plant has ever logged.
CREATE INDEX IF NOT EXISTS consumable_consumption_entry_batch_key_idx
  ON consumable_consumption_entry (batch_key);

-- One batch's rows are drawn grouped by station, so the screen's own ordering
-- is the index's ordering and the group-by is free.
CREATE INDEX IF NOT EXISTS consumable_consumption_entry_batch_station_idx
  ON consumable_consumption_entry (batch_key, station);
