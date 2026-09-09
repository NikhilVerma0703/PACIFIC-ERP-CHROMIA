-- 0081: what the owner's round-three answers (2026-09-09) need from the
--       database. docs/commercial-module/DECISIONS-3.md is the record, and the
--       five files he sent are what the shapes here are read off.
--
--   * THE CUSTOMER'S ARTICLE (answer 4). His crate label reads
--         CQBE 101x19.5x2 / WINDOW SILLS 101x19.5x2 / BARCODE: 8720847172228
--     — an item code, a description and an EAN-13 that belong to the DESIGN AT
--     ONE SIZE, not to our slab and not to our piece. Twelve of them in one
--     file for one design. So they live in their own table, keyed by the
--     client, the design and the size, and every crate of that article prints
--     the same barcode.
--
--   * CUT-TO-SIZE PACKING LINES (answer 5). A packing list packs SLABS today.
--     His three workbooks pack PIECES: crate no, drawing no, piece no,
--     material, L x W, thickness, sqft, quantity, room and weight, with totals
--     per crate. That is a second kind of line, not a change to the first.
--
--   * THE OUTSIDE WORK (answers 7, 8). Container booking, CHA, the BL draft,
--     COO and CEFA, the Daltile upload, TiO2, the RFID lock, container
--     pictures, fumigation, the ETA sheet: "for now if we cannot add anything
--     we'll add a tickbox". One row per task per order — a tick, a date, who,
--     and a note.
--
--   * A MANUAL EXCHANGE RATE PER INVOICE (answer 10), which is also what lets
--     a receipt in another currency count towards the advance.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0081-commercial-round3.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. 2 new tables, 1 new enum, 1 new column (the rate
-- itself predates this file), 6 indexes, 4 foreign keys. No backfill, no UPDATE, no DROP.
-- Every commercial_* table holds 0 rows today, so nothing existing is touched
-- in practice either. Re-running is a no-op.

DO $$ BEGIN
  CREATE TYPE "commercial_task_status" AS ENUM ('PENDING', 'DONE', 'NOT_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────── the customer's article and its barcode ────────────────
-- One row per (client, design, size). The EAN is the customer's, so two
-- customers may sell the same design at the same size under different codes —
-- which is why client_id is part of the key rather than a column beside it.
CREATE TABLE IF NOT EXISTS commercial_customer_article (
  id            TEXT PRIMARY KEY,
  client_id     TEXT,                                   -- -> sales_clients.id; NULL = ours, any customer
  design        TEXT NOT NULL,
  -- The size AS THE LABEL PRINTS IT, in centimetres: 101 x 19.5 x 2. Numeric so
  -- a list can be ordered and a duplicate found; the label re-renders them.
  length_cm     NUMERIC(8,2) NOT NULL,
  width_cm      NUMERIC(8,2) NOT NULL,
  thickness_cm  NUMERIC(6,2) NOT NULL,
  item_code     TEXT,                                   -- CQBE 101x19.5x2
  description   TEXT,                                   -- WINDOW SILLS 101x19.5x2
  ean           TEXT,                                   -- 8720847172228, EAN-13
  notes         TEXT,
  updated_by_id TEXT,                                   -- -> users.id (no hard FK)
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_customer_article_key
  ON commercial_customer_article (COALESCE(client_id, ''), design, length_cm, width_cm, thickness_cm);
CREATE INDEX IF NOT EXISTS commercial_customer_article_design_idx ON commercial_customer_article (design);
CREATE INDEX IF NOT EXISTS commercial_customer_article_ean_idx ON commercial_customer_article (ean);
DO $$ BEGIN
  ALTER TABLE commercial_customer_article ADD CONSTRAINT commercial_customer_article_client_fkey
    FOREIGN KEY (client_id) REFERENCES sales_clients(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- An EAN-13 is thirteen digits. Checked here so a mistyped code is refused at
-- entry rather than at the customer's gate; the check digit is verified in the
-- application (lib/commercial/barcode.ts), which can say WHICH digit is wrong.
DO $$ BEGIN
  ALTER TABLE commercial_customer_article ADD CONSTRAINT commercial_customer_article_ean_ck
    CHECK (ean IS NULL OR ean ~ '^[0-9]{13}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TABLE commercial_customer_article IS 'The customer''s own article: item code, description and EAN-13 for one design at one size (answer 4). Every crate of it prints the same barcode.';

-- ───────────────────── cut-to-size packing lines ─────────────────────────────
-- A packed PIECE, beside commercial_packed_slab's packed SLAB. Sizes are
-- MILLIMETRES: his workbooks head the column "SIZE(Inches)" on one block and
-- "SIZE(IN CM)" on another and the numbers are millimetres in both, so the
-- unit is stored explicitly here and the printed unit follows the packing
-- list's measurement_unit (answer 17).
CREATE TABLE IF NOT EXISTS commercial_packed_piece (
  id              TEXT PRIMARY KEY,
  packing_list_id TEXT NOT NULL,
  crate_id        TEXT,                                 -- -> commercial_crate.id
  crate_no        TEXT,                                 -- as printed, when there is no crate row
  drawing_no      TEXT,
  piece_no        TEXT,                                 -- 1A, 2B, 03 …
  design          TEXT NOT NULL,
  length_mm       NUMERIC(10,2),
  width_mm        NUMERIC(10,2),
  thickness_mm    NUMERIC(8,2),
  sqft            NUMERIC(12,4),
  quantity        INTEGER NOT NULL DEFAULT 1,
  room            TEXT,                                 -- BUILDING / AREA: "KITCHEN", "BATH ROOM VANITY"
  weight_kg       NUMERIC(12,3),
  notes           TEXT,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS commercial_packed_piece_list_idx ON commercial_packed_piece (packing_list_id);
CREATE INDEX IF NOT EXISTS commercial_packed_piece_crate_idx ON commercial_packed_piece (crate_id);
DO $$ BEGIN
  ALTER TABLE commercial_packed_piece ADD CONSTRAINT commercial_packed_piece_list_fkey
    FOREIGN KEY (packing_list_id) REFERENCES commercial_packing_list(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE commercial_packed_piece ADD CONSTRAINT commercial_packed_piece_crate_fkey
    FOREIGN KEY (crate_id) REFERENCES commercial_crate(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE commercial_packed_piece ADD CONSTRAINT commercial_packed_piece_qty_ck CHECK (quantity > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────── the outside work, as ticks ────────────────────────────
CREATE TABLE IF NOT EXISTS commercial_order_task (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL,
  task_key     TEXT NOT NULL,                           -- bl_draft, coo, cefa, fumigation, container_booking …
  label        TEXT NOT NULL,
  status       "commercial_task_status" NOT NULL DEFAULT 'PENDING',
  done_at      TIMESTAMP(3),
  done_by_id   TEXT,                                    -- -> users.id (no hard FK)
  done_by_name TEXT,
  note         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_order_task_key ON commercial_order_task (order_id, task_key);
DO $$ BEGIN
  ALTER TABLE commercial_order_task ADD CONSTRAINT commercial_order_task_order_fkey
    FOREIGN KEY (order_id) REFERENCES commercial_order(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TABLE commercial_order_task IS 'The work around an order this module does not do itself (answers 7, 8): container booking, CHA, BL draft, COO, CEFA, fumigation, the portal uploads. A tick, a date, a name and a note, so the desk can see what is done without the software pretending to do it.';

-- ───────────────────── the invoice's own exchange rate ───────────────────────
-- exchange_rate ALREADY EXISTS, from scripts/0076, as NUMERIC(12,4). The line
-- below is therefore a NO-OP and is left in only so this file states the whole
-- shape it depends on: ADD COLUMN IF NOT EXISTS does not widen an existing
-- column, so the live type stays 12,4 — which is what the Prisma model has
-- always said and is ample for a rate. What is genuinely new is the stamp.
ALTER TABLE commercial_invoice ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12,4);
ALTER TABLE commercial_invoice ADD COLUMN IF NOT EXISTS exchange_rate_at TIMESTAMP(3);
COMMENT ON COLUMN commercial_invoice.exchange_rate IS 'Answer 10: typed by hand, rupees per unit of the invoice currency. Also what lets a receipt in another currency count towards the advance (answer 11 of round two).';
