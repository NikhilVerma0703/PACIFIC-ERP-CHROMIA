-- 0050: grit TYPE on the silo, and a per-tonne RATE on each supplier line.
--
-- PURELY ADDITIVE AND IDEMPOTENT. Creates no table, drops nothing, moves no
-- data, and changes no existing column. Every grit row already stored keeps
-- exactly the value it has; the two new columns start empty and mean
-- "not entered yet", which is the truth for every batch costed before today.
--
-- WHY TYPE SITS ON THE SILO AND RATE SITS ON THE SUPPLIER LINE
--
-- A silo runs one material at a time, so its SIZE and its TYPE are the same
-- kind of fact and belong in the same row - which is why type goes here rather
-- than on the split, and why the unique index on (batch_key, silo_no) already
-- guarantees one of each per batch without a new constraint.
--
-- The RATE cannot live there. One silo's tonnage is split across suppliers
-- precisely because the supplier differs, and a different supplier is a
-- different invoice at a different price - the same reason resin is split into
-- x and (1000 - x) and priced twice. A rate on the silo would force one price
-- onto both halves and silently lose the cheaper one.
--
-- WHY THIS COLUMN IS THE FIRST RUPEE FIGURE IN THIS TABLE
--
-- costing_batch_grit_supplier was written with no rate column on purpose: the
-- assignment screen sat in batch signoff, and the guarantee that verifiers saw
-- no money was structural rather than a promise - there was no rupee figure to
-- send because there was none to store.
--
-- That guarantee is now deliberately retired. The owner's instruction
-- (2026-08-21) is that the grit rate is ENTERED BY THE TWO WEIGHT VERIFIERS,
-- because they are the people who know what the grit in that silo cost; the
-- admin can see and correct it but is not the one filling it in. So the money
-- belongs on their screen, and the old structural silence would now be the
-- wrong shape rather than a safeguard.
--
-- UNIT IS RUPEES PER TONNE, matching the rate card and what the office already
-- types. The weight beside it stays in KILOGRAMS, because that is what the
-- mixer records. The single conversion lives in src/lib/costing/report.ts and
-- must not be repeated anywhere else - doing it twice is how somebody enters
-- 14,780 against a kilogram.

ALTER TABLE "costing_batch_grit_silo"
  -- What was in the silo: "Premium Supreme G2", "Glass", "Cristobalite", or
  -- whatever the plant starts running next. VERBATIM as typed, exactly like
  -- "size" beside it, and for the same two reasons: normalising on the way in
  -- would create a second source of truth that can disagree with the first,
  -- and a typed value must never mint a rate-card catalogue key.
  --
  -- '' means "not chosen yet" rather than "none" - a row exists as soon as a
  -- silo is touched, so an empty type is the normal state of a half-finished
  -- entry and never an error.
  --
  -- The dropdown is DERIVED from this column (SELECT DISTINCT grit_type), the
  -- way the size list already is: a type typed once is offered on every batch
  -- afterwards, with no dictionary table to administer and no way for the list
  -- and the data to drift apart.
  ADD COLUMN IF NOT EXISTS "grit_type" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "costing_batch_grit_silo_grit_type_idx"
  ON "costing_batch_grit_silo" ("grit_type");

ALTER TABLE "costing_batch_grit_supplier"
  -- Rupees per TONNE for this supplier's share of this silo.
  --
  -- NULLABLE, and null is not zero. Null means "nobody has priced this line
  -- yet"; 0 would mean "this grit was free", and a costing that quietly treats
  -- the first as the second under-reports the batch and looks finished while
  -- doing it. report.ts must therefore surface an unpriced line rather than
  -- summing it as nothing.
  ADD COLUMN IF NOT EXISTS "rate_per_t" DOUBLE PRECISION,
  -- Who typed the rate and when - kept separately from assigned_by/assigned_at,
  -- which record who assigned the SPLIT. The two are usually the same verifier
  -- but need not be: the admin may correct a rate long after the split was
  -- entered, and collapsing them would erase that.
  ADD COLUMN IF NOT EXISTS "rate_by" TEXT,
  ADD COLUMN IF NOT EXISTS "rate_at" TIMESTAMP(3);

-- "Which batches still have grit nobody has priced?" - the question the
-- costing dashboard asks to flag an incomplete batch. Partial, because the
-- rows worth finding are exactly the ones where rate_per_t IS NULL, and a
-- partial index over them stays small however many priced rows accumulate.
CREATE INDEX IF NOT EXISTS "costing_batch_grit_supplier_unpriced_idx"
  ON "costing_batch_grit_supplier" ("batch_key")
  WHERE "rate_per_t" IS NULL;
