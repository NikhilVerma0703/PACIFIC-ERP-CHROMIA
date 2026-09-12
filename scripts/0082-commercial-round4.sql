-- 0082: the owner's round-four answers (2026-09-12).
--       docs/commercial-module/DECISIONS-4.md is the record.
--
--   * ANSWER 1 — A CUT PIECE IS CHECKED LIKE A SLAB. "A cut to size also gets a
--     physical check piece by piece with mark crate as correct and even the
--     slabs get slab by slab and mark crate as correct also a global mark all
--     as correct." commercial_packed_slab has carried fit / unfit_reason /
--     checked_by_id / checked_at since 0076; commercial_packed_piece gets the
--     SAME four columns and the same enum, because it is the same act by the
--     same person on the same list. The crate-level and list-level "mark all
--     correct" need no column at all — they are a bulk write of these.
--
--   * ANSWER 2 — NO TWO ARTICLES SHARE A BARCODE. "Do not let duplicate
--     barcodes be entered." An EAN-13 identifies one article to the whole
--     retail world; two of ours carrying one code is not a preference, it is
--     wrong. So a UNIQUE index, not a warning. His own file breaks it —
--     220x19.5x2 and 220x15x2 both read 8720847172266 — so the losing row must
--     still be storable WITHOUT a code and must SAY why it has none, which is
--     ean_blocked_reason. "Don't generate barcodes till it's fixed" is then a
--     readable condition: any article of this client with a blocked reason
--     stops that client's labels.
--
--   * ANSWER 2, SECOND HALF — AUTOGENERATE IN HIS CUSTOMER'S OWN SCHEME. Read
--     off the nine valid codes in Desert Silk Crate BARCODE.docx:
--
--         8720847 17222 8      GS1 company prefix  8720847   (872 = GS1 NL)
--         8720847 17223 5      item reference      17222 … 17232, consecutive
--         8720847 17224 2      check digit         computed, never stored typed
--         … 17225 9, 17226 6, 17228 0, 17230 3, 17231 0, 17232 7
--
--     Seven digits of company prefix + five of item reference + the check
--     digit. The prefix is the CUSTOMER'S, not ours, so it is keyed by client;
--     the reference is a plain running number under it.
--
--   * ANSWER 3 needs no schema: the label is geometry, and geometry lives in
--     lib/commercial/barcode.ts with the modules it is about.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0082-commercial-round4.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. 1 new table, 6 new columns, 3 indexes, 2 foreign
-- keys, 3 checks. No backfill, no UPDATE, no DROP. Every commercial_* table
-- holds 0 rows today, so nothing existing is touched in practice either.
-- Re-running is a no-op.

-- ───────────────── answer 1: a packed piece gets a verdict ───────────────────
-- The same four columns commercial_packed_slab has had since 0076, and the
-- same commercial_fit_status enum. NOT a new enum: a checker looking at a
-- crate of sills and a crate of slabs is doing one job, and two enums with the
-- same three labels would let the two halves drift the first time a label is
-- added to one of them.
ALTER TABLE commercial_packed_piece ADD COLUMN IF NOT EXISTS fit "commercial_fit_status" NOT NULL DEFAULT 'PENDING';
ALTER TABLE commercial_packed_piece ADD COLUMN IF NOT EXISTS unfit_reason TEXT;
ALTER TABLE commercial_packed_piece ADD COLUMN IF NOT EXISTS checked_by_id TEXT;   -- -> users.id (no hard FK, as on the slab)
ALTER TABLE commercial_packed_piece ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP(3);
-- The dispatch check reads "everything on this list still PENDING", list-wide
-- and crate by crate, on every screen refresh and on every bulk mark.
CREATE INDEX IF NOT EXISTS commercial_packed_piece_fit_idx ON commercial_packed_piece (packing_list_id, fit);
CREATE INDEX IF NOT EXISTS commercial_packed_slab_fit_idx ON commercial_packed_slab (packing_list_id, fit);
COMMENT ON COLUMN commercial_packed_piece.fit IS 'Answer 1 of round four: a cut piece is inspected piece by piece exactly as a slab is inspected slab by slab.';

-- ───────────────── answer 2: one barcode, one article ────────────────────────
-- WHY THIS IS UNIQUE ACROSS THE WHOLE TABLE AND NOT PER CLIENT. An EAN-13 is
-- globally unique by construction — the company prefix inside it already says
-- whose it is. Scoping the index by client would permit two clients to be sold
-- the same code, which is the failure the standard exists to prevent, and it
-- would let our own duplicate hide behind a client boundary.
--
-- Partial, because "no barcode yet" is a normal state for an article and NULLs
-- must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_customer_article_ean_unique
  ON commercial_customer_article (ean) WHERE ean IS NOT NULL;

-- Why this article has no code. NULL is the ordinary case (nobody has given it
-- one yet); a sentence here means one was offered and REFUSED, and that is
-- what stops the client's labels until a human settles it.
ALTER TABLE commercial_customer_article ADD COLUMN IF NOT EXISTS ean_blocked_reason TEXT;
COMMENT ON COLUMN commercial_customer_article.ean_blocked_reason IS 'Answer 2: set when a code could not be taken because another article already owns it. While any article of a client carries one, that client''s barcodes are not generated and not printed.';

-- Where the code came from. A code the CUSTOMER sent is never overwritten by
-- one we made up, which is the whole reason this column is not a boolean on
-- the side of the generator.
ALTER TABLE commercial_customer_article ADD COLUMN IF NOT EXISTS ean_source TEXT;
DO $$ BEGIN
  ALTER TABLE commercial_customer_article ADD CONSTRAINT commercial_customer_article_ean_source_ck
    CHECK (ean_source IS NULL OR ean_source IN ('CUSTOMER', 'GENERATED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN commercial_customer_article.ean_source IS 'CUSTOMER = off the customer''s own file and never regenerated; GENERATED = allocated by us under their GS1 prefix.';

-- ───────────────── answer 2: the customer's own GS1 prefix ───────────────────
-- One row per client. The prefix belongs to THEM: 8720847 is the Dutch
-- company prefix on every code in Desert Silk Crate BARCODE.docx, and the next
-- customer will have a different one of a different length.
CREATE TABLE IF NOT EXISTS commercial_client_barcode (
  client_id   TEXT PRIMARY KEY,                        -- -> sales_clients.id
  -- 6 to 11 digits. GS1 issues prefixes of varying length and the item
  -- reference simply takes what is left of the twelve: a 7-digit prefix leaves
  -- 5 digits (00000-99999), a 9-digit prefix leaves 3.
  gs1_prefix  TEXT NOT NULL,
  -- A FLOOR, not a counter. The allocator takes the greater of this and the
  -- highest reference actually in use, so a hand-entered code can never be
  -- handed out again and a lost row cannot rewind the series.
  next_ref    BIGINT NOT NULL DEFAULT 0,
  notes       TEXT,
  updated_by_id TEXT,                                  -- -> users.id (no hard FK)
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP(3) NOT NULL
);
DO $$ BEGIN
  ALTER TABLE commercial_client_barcode ADD CONSTRAINT commercial_client_barcode_client_fkey
    FOREIGN KEY (client_id) REFERENCES sales_clients(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE commercial_client_barcode ADD CONSTRAINT commercial_client_barcode_prefix_ck
    CHECK (gs1_prefix ~ '^[0-9]{6,11}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE commercial_client_barcode ADD CONSTRAINT commercial_client_barcode_next_ck
    CHECK (next_ref >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TABLE commercial_client_barcode IS 'The customer''s own GS1 company prefix (answer 2 of round four), so a new article''s EAN-13 is allocated in the same series as the ones they already sent: prefix + running item reference + computed check digit.';
