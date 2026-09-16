-- 0086: BOXES AND STANDS in the sampling module (the owner, 2026-09-14: "we
--       want to add to track sample boxes and stands in the sampling modules").
--
-- NUMBERED 0086, NOT 0084. docs/salesforce-link/DESIGN.md allocated 0084 to
-- this work on 2026-09-14 and 0085 to the sample-request loop. Both numbers
-- were taken the next day by the proforma work — 0084 is the PI salesperson
-- column, 0085 the selling entity — so this is 0086 and the request loop will
-- be 0087. The design document is right about everything except the number.
--
-- WHAT A BOX AND A STAND ARE. Until now the module tracked PIECES and nothing
-- else: a shelf of colour+finish+size with a quantity on it. But a sample kit
-- goes out IN something, and a display stand is a capital item that sits in a
-- customer's showroom for years. Salesforce already treats both as trackable
-- units — Sample_Stand__c.Stand_Type__c is Floor Stand / Wall Display /
-- Counter Display / Sample Kit Box / Other — so the ERP mirrors THOSE WORDS
-- rather than inventing its own, and `sf_stand_type` below records the exact
-- picklist value each type maps to. Inventing a parallel vocabulary is how two
-- systems come to disagree about what a thing is called.
--
-- COUNTED OR SERIALISED, AND THE DIFFERENCE IS REAL. A box is a consumable:
-- you have eleven, you send one, you have ten, and nobody asks which. A stand
-- is an asset: it carries a number stencilled on its frame, it is installed at
-- a named customer on a date, and "where is FS-0007" is a question somebody
-- will ask. So a counted type carries a quantity in sampling_unit_stock and a
-- serialised type carries one row per physical object in sampling_unit_serial.
-- ON HAND FOR A SERIALISED TYPE IS NEVER STORED: it is
-- count(*) WHERE status = 'IN_STOCK', computed on every read. A stored count
-- beside the rows it summarises is a second source of truth, and the two
-- disagree the first time a transaction half-fails.
--
-- APPEND-ONLY LEDGER, like sampling_intake. Every change to a count or a
-- serial writes one sampling_unit_ledger row in the SAME transaction, so the
-- admin page can assert quantity = sum(delta) per counted type and show the
-- drift rather than quietly carrying it.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0086-sampling-units.sql
--   npx prisma generate
-- (NOT `prisma db push` — it drops columns the schema does not declare.)
--
-- ADDITIVE AND IDEMPOTENT throughout: CREATE TYPE guarded by a catalog check,
-- CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, the seed ON CONFLICT
-- DO NOTHING. Nothing is dropped, renamed or back-filled.

-- ── the enums ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE sampling_unit_kind AS ENUM ('BOX', 'STAND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The six states a physical stand passes through. RELEASED and DISPATCHED
-- mirror sampling_dispatch_status exactly, because a stand leaves on a package
-- and must not tell a different story from the package it left on. INSTALLED
-- and RETURNED come from Salesforce (Sample_Stand__c.Status__c). RETIRED is
-- the end of the line and is only ever set by a person.
DO $$ BEGIN
  CREATE TYPE sampling_unit_serial_status AS ENUM
    ('IN_STOCK', 'RELEASED', 'DISPATCHED', 'INSTALLED', 'RETURNED', 'RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Why a unit moved. ADJUST is a correction and the route refuses one without a
-- reason: an unexplained adjustment is how a count stops meaning anything.
DO $$ BEGIN
  CREATE TYPE sampling_unit_ledger_reason AS ENUM
    ('INTAKE', 'RELEASE', 'RETURN', 'ADJUST', 'RETIRE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PIECES THAT COME BACK. A request cancelled after the desk packed it leaves
-- real pieces on a real table, and today the only way to put them back is to
-- call them SAMPLE_CUTTING — a lie in an append-only ledger, which is the one
-- place a lie compounds. RETURNED is the honest value, with source_ref holding
-- the request number they came back from.
--
-- ADD VALUE IF NOT EXISTS is idempotent by itself and, unlike the CREATE TYPE
-- above, cannot run inside a DO block in older Postgres — it is its own
-- statement.
ALTER TYPE sampling_intake_source ADD VALUE IF NOT EXISTS 'RETURNED';

-- ── the kinds of unit that exist ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sampling_unit_type (
  id              TEXT PRIMARY KEY,
  kind            sampling_unit_kind NOT NULL,
  name            TEXT NOT NULL,
  -- The exact Sample_Stand__c.Stand_Type__c picklist value this mirrors, so
  -- the push in Part A/C never has to guess or translate.
  sf_stand_type   TEXT,
  serialised      BOOLEAN NOT NULL DEFAULT TRUE,
  capacity_pieces INTEGER,
  -- Below this, the shelf card goes red. Two is not a policy, it is a starting
  -- point the incharge can change per type.
  min_qty         INTEGER NOT NULL DEFAULT 2,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sampling_unit_type_name_key ON sampling_unit_type (name);

-- ── the running count, for the counted kinds ─────────────────────────────────
-- THE QUANTITY MOVES, THE ROW DOES NOT — the same shape as sampling_stock, so
-- a reader who knows one knows the other. The CHECK is the floor: a negative
-- count of physical objects is not a number anybody should be able to store,
-- whatever a route forgets to validate.

CREATE TABLE IF NOT EXISTS sampling_unit_stock (
  id           TEXT PRIMARY KEY,
  unit_type_id TEXT NOT NULL UNIQUE REFERENCES sampling_unit_type(id) ON DELETE CASCADE,
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── one row per physical stand ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sampling_unit_serial (
  id               TEXT PRIMARY KEY,
  unit_type_id     TEXT NOT NULL REFERENCES sampling_unit_type(id),
  -- What is stencilled on the frame. The ERP proposes <PREFIX>-<seq>; the
  -- incharge may overtype it, because the number on the metal wins over the
  -- number the software would have liked.
  serial_no        TEXT NOT NULL,
  status           sampling_unit_serial_status NOT NULL DEFAULT 'IN_STOCK',
  customer_name    TEXT,
  sales_request_id TEXT,
  dispatch_id      TEXT,
  -- The Sample_Stand__c Id once this has been pushed, so a retried send
  -- updates the same Salesforce record instead of creating a twin.
  sf_stand_id      TEXT,
  installed_at     TIMESTAMPTZ,
  location_note    TEXT,
  -- users.id, deliberately without a hard FK — the precedent the Sales and
  -- Chromia tables set, so deactivating a login never blocks a delete.
  created_by_id    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sampling_unit_serial_no_key ON sampling_unit_serial (serial_no);
-- "How many Floor Stands are in stock" and "show me this type's serials",
-- which is every read the units screen makes.
CREATE INDEX IF NOT EXISTS sampling_unit_serial_type_status_idx ON sampling_unit_serial (unit_type_id, status);

-- ── why every count is what it is ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sampling_unit_ledger (
  id               TEXT PRIMARY KEY,
  unit_type_id     TEXT NOT NULL REFERENCES sampling_unit_type(id),
  serial_id        TEXT,
  delta            INTEGER NOT NULL,
  reason           sampling_unit_ledger_reason NOT NULL,
  reference        TEXT,
  sales_request_id TEXT,
  dispatch_id      TEXT,
  note             TEXT,
  created_by_id    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sampling_unit_ledger_type_time_idx ON sampling_unit_ledger (unit_type_id, created_at);

-- ── what a package was packed in ─────────────────────────────────────────────
-- Nullable, and NULL means what every package before today means: pieces went
-- out and nobody recorded a container. No back-fill, because there is no
-- honest value to back-fill with.

ALTER TABLE sampling_dispatch ADD COLUMN IF NOT EXISTS unit_type_id     TEXT;
ALTER TABLE sampling_dispatch ADD COLUMN IF NOT EXISTS unit_serial_id   TEXT;
ALTER TABLE sampling_dispatch ADD COLUMN IF NOT EXISTS sales_request_id TEXT;

CREATE INDEX IF NOT EXISTS sampling_dispatch_unit_type_idx     ON sampling_dispatch (unit_type_id);
CREATE INDEX IF NOT EXISTS sampling_dispatch_sales_request_idx ON sampling_dispatch (sales_request_id);

-- ── the four types Salesforce already knows ──────────────────────────────────
-- Seeded rather than left to an admin because these four are not a local
-- choice: they are the picklist values in the org today, and a type whose
-- sf_stand_type does not match one of them cannot be pushed. "Other" is NOT
-- seeded — it is Salesforce's escape hatch, not a thing we stock.
--
-- ON CONFLICT DO NOTHING on the NAME, so re-running this script never disturbs
-- a min_qty or a position the incharge has since changed.

INSERT INTO sampling_unit_type (id, kind, name, sf_stand_type, serialised, capacity_pieces, min_qty, position)
VALUES
  ('sut_sample_kit_box',  'BOX',   'Sample Kit Box',   'Sample Kit Box',   FALSE, 20, 5, 10),
  ('sut_floor_stand',     'STAND', 'Floor Stand',      'Floor Stand',      TRUE,  NULL, 1, 20),
  ('sut_wall_display',    'STAND', 'Wall Display',     'Wall Display',     TRUE,  NULL, 1, 30),
  ('sut_counter_display', 'STAND', 'Counter Display',  'Counter Display',  TRUE,  NULL, 1, 40)
ON CONFLICT (name) DO NOTHING;

-- Opening stock is NOT seeded. The incharge counts the cupboard and records
-- what is actually there as an INTAKE, which is the first row of the ledger
-- and the only honest way for a count to begin.

COMMENT ON TABLE sampling_unit_type   IS 'Kinds of sample box and display stand, mirroring Salesforce Sample_Stand__c.Stand_Type__c (owner, 2026-09-14).';
COMMENT ON TABLE sampling_unit_stock  IS 'Running count for COUNTED unit types. Serialised types are counted from sampling_unit_serial instead, never stored here.';
COMMENT ON TABLE sampling_unit_serial IS 'One physical stand, by the number stencilled on it. On hand = count(*) WHERE status = IN_STOCK.';
COMMENT ON TABLE sampling_unit_ledger IS 'Append-only: every change to a unit count or serial, in the same transaction as the change itself.';
