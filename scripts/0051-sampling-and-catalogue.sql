-- 0051: the Sampling module — sample pieces cut from slabs, stored, packed and
--       shipped — plus the shared product catalogue it counts stock against,
--       and the SAMPLING value on the Role enum.
--
-- NOT YET APPLIED. Run with:
--   npx prisma db execute --url "$DATABASE_URL" --file scripts/0051-sampling-and-catalogue.sql
-- (NOT `prisma db push`. This repo keeps several model-less tables and
-- raw-SQL-only columns that push proposes dropping — see the note at the top of
-- the sales section in schema.prisma and scripts/0039 onwards.)
--
-- PURELY ADDITIVE AND IDEMPOTENT. Eight new tables, three new enum types, one
-- new value on an existing enum, sixteen indexes and nine foreign keys — all
-- guarded. NO backfill, no UPDATE, no DROP, no DEFAULT applied to an existing
-- column, nothing rewritten, and not one statement that names an existing
-- table. Re-running it is a no-op. Applying it changes no existing row and no
-- existing query.
--
-- THE ROLE VALUE IS THE ONLY THING THIS SHARES WITH ANYTHING, and it is a ROLE,
-- not a Branch. Sampling was designed as a DEPARTMENT — Branch SAMPLING with
-- the shared OPERATOR / INCHARGE / LINE_MANAGER ranks, so that "Sampling
-- Incharge" would be SAMPLING + INCHARGE — back when Chromia was one too.
-- Chromia has since been RETIRED as a department: scripts/0044 dropped the
-- old integration, scripts/0045 added 'CHROMIA' to the Role enum, and
-- scripts/0046 moved the last logins off Branch CHROMIA onto that role. The
-- surviving shape for a single-purpose module is a capped ROLE, so this adds
-- 'SAMPLING' to "Role" and NOTHING to "Branch". scripts/0045 is the precedent
-- for this exact statement; scripts/0023 is the precedent for the ADD VALUE
-- form itself.
--
-- NOTE ON THE ENUM AND TRANSACTIONS: PostgreSQL runs a multi-statement script
-- as one implicit transaction (prisma db execute sends the whole file as a
-- single command), and a NEW ENUM VALUE CANNOT BE USED IN THE TRANSACTION THAT
-- ADDS IT. Nothing below references 'SAMPLING' — and nothing appended to this
-- file may either. There is no backfill here and none is wanted: the value is
-- only ever written to users.role by Users & Roles, afterwards. (Chromia needed
-- a second script, 0046, for exactly this reason; sampling does not, because it
-- is a new module with no logins to move.)
--
-- THREE TABLES ARE NOT sampling_-PREFIXED, ON PURPOSE. product_series,
-- product_colour and product_colour_finish are the colour chart, and the chart
-- is not sampling's property: fabrication already buys against these names
-- ("Arva White" is the material on PO 10026) and the polishing line calls the
-- same string a "design" (polish_qc.design). Naming them sampling_* would have
-- meant a second copy the first time fabrication wanted one.
-- product_colour.name is UNIQUE ACROSS ALL SERIES so those callers can resolve
-- a colour by name without knowing its series.
--
-- FINISH IS A VARIANT OF A COLOUR, NOT A COLOUR. Cappuccino comes in Polished
-- and Leather: one product_colour row, two product_colour_finish rows. Stock,
-- intake and dispatch lines all reference the colour+finish row, never the
-- colour, because a count that does not know the finish is not a count. The
-- finish itself is TEXT rather than an enum so adding one is a seed edit
-- instead of a migration; the canonical spellings live in
-- src/lib/catalogue/colours.ts.
--
-- UNITS. sampling_size.length_in and .width_in are INCHES; .thickness_mm is
-- whole MILLIMETRES. The column names carry the unit because
-- src/lib/fab/slabLoss.ts is this repo's standing warning about what happens
-- when they do not — fab_requirement is inches, fab_slab is millimetres, and
-- nothing in the schema said so. Inches match fab_requirement and
-- fab_residual_piece (an offcut becomes sample stock with no conversion);
-- millimetres match fab_slab.thickness and
-- chromia_base_material.default_thickness_mm.
--
-- NUMERIC(10,2), NOT double precision, for the two edges: the unique index on
-- (length_in, width_in, thickness_mm) IS the "a size typed twice is the same
-- size" rule, and NUMERIC makes 4, 4.0 and 4.00 the same value in that index.
-- The canonical ordering (length >= width, so 4x6 and 6x4 are one size) is
-- enforced in src/lib/sampling/size.ts and NOT by a CHECK constraint: Prisma
-- cannot model a CHECK, so one here would show up forever as drift to be
-- dropped.
--
-- NO FOREIGN KEY TO fab_residual_piece. The offcut side has purpose-built
-- models (fab_residual_bag / fab_residual_piece) and NOTHING writes them —
-- they are dead, so a hard link would make sampling intake wait on a
-- fabrication feature with no owner, and they cannot carry what a sample needs
-- anyway (a residual piece has length and width but no thickness and no
-- colour). sampling_intake.source_ref is the seam: the slab or bag number as
-- written on the piece, to match on later.
--
-- USER ATTRIBUTION columns (created_by_id, released_by_id, dispatched_by_id,
-- delivered_by_id) are plain TEXT holding users.id with NO foreign key — the
-- Sales and Chromia precedent. sampling_intake.created_by_id in particular is
-- not always sampling staff: a Fabrication Supervisor may add stock, and only
-- add stock (src/lib/sampling/actions.ts).
--
-- INDEXES. Sixteen, and every one of them names the query it serves in the
-- comment above it. The fabrication tables carried no index at all until
-- scripts/0044-0046 — every fab lookup was a sequential scan — and these
-- tables are not going to repeat that. The names are Prisma's own defaults for
-- the @@unique / @@index lines added to prisma/schema.prisma alongside this
-- file, so `prisma migrate diff` stays clean after it is applied (the same
-- discipline as scripts/0038, 0044, 0045 and 0046).
--
-- SIZING: every table here starts empty, so plain CREATE INDEX (no
-- CONCURRENTLY — db execute runs in a transaction) is instant.

-- The capped login the module is gated by, exactly like ROBO and CHROMIA.
-- Nothing below uses it; see the transaction note above.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SAMPLING';

-- ---------------------------------------------------------------- enums ----

DO $$ BEGIN
  CREATE TYPE "sampling_intake_source" AS ENUM ('SAMPLE_CUTTING', 'FAB_OFFCUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "sampling_destination" AS ENUM ('DOMESTIC', 'INTERNATIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RELEASED / DISPATCHED / DELIVERED only. "In stock" is deliberately not a
-- status: it is where a piece is BEFORE any dispatch claims it, which is a
-- sampling_stock quantity. Creating the dispatch is the first transition.
DO $$ BEGIN
  CREATE TYPE "sampling_dispatch_status" AS ENUM ('RELEASED', 'DISPATCHED', 'DELIVERED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------- product catalogue ----

CREATE TABLE IF NOT EXISTS "product_series" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_colour" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_colour_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_colour_finish" (
    "id" TEXT NOT NULL,
    "colour_id" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_colour_finish_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------ sampling ----

CREATE TABLE IF NOT EXISTS "sampling_size" (
    "id" TEXT NOT NULL,
    "length_in" DECIMAL(10,2) NOT NULL,
    "width_in" DECIMAL(10,2) NOT NULL,
    "thickness_mm" INTEGER NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sampling_size_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_stock" (
    "id" TEXT NOT NULL,
    "colour_finish_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sampling_stock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_intake" (
    "id" TEXT NOT NULL,
    "colour_finish_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" "sampling_intake_source" NOT NULL,
    "source_ref" TEXT,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sampling_intake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_dispatch" (
    "id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "destination" "sampling_destination" NOT NULL,
    "reference" TEXT,
    "status" "sampling_dispatch_status" NOT NULL DEFAULT 'RELEASED',
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "dispatched_by_id" TEXT,
    "delivered_at" TIMESTAMP(3),
    "delivered_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sampling_dispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sampling_dispatch_line" (
    "id" TEXT NOT NULL,
    "dispatch_id" TEXT NOT NULL,
    "colour_finish_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sampling_dispatch_line_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------- indexes ----

-- The series pick-list, and the seed's upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS "product_series_name_key"
  ON "product_series" ("name");

-- Unique ACROSS SERIES, not within one: fabrication and QC name a colour
-- without naming its series, and a duplicate would make that lookup ambiguous.
-- Also the seed's upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS "product_colour_name_key"
  ON "product_colour" ("name");

-- "The colours of this series" — step 2 of adding stock, and the foreign key,
-- which Postgres does not index for you.
CREATE INDEX IF NOT EXISTS "product_colour_series_id_idx"
  ON "product_colour" ("series_id");

-- One row per colour+finish. Its colour_id prefix is also "the finishes of
-- this colour" (step 3) and the foreign key's index.
CREATE UNIQUE INDEX IF NOT EXISTS "product_colour_finish_colour_id_finish_key"
  ON "product_colour_finish" ("colour_id", "finish");

-- THE RULE THAT KEEPS THE PICK-LIST HONEST: one row per distinct size. A size
-- typed a second time has to land on the row it already has, or the stock
-- splits into two half-counts nobody reconciles.
CREATE UNIQUE INDEX IF NOT EXISTS "sampling_size_length_in_width_in_thickness_mm_key"
  ON "sampling_size" ("length_in", "width_in", "thickness_mm");

-- The point lookup every intake and every release performs, and the index for
-- "every size of this colour+finish" — one row of the inventory screen.
CREATE UNIQUE INDEX IF NOT EXISTS "sampling_stock_colour_finish_id_size_id_key"
  ON "sampling_stock" ("colour_finish_id", "size_id");

-- The other direction: "who has 4x4 in 2 cm, across every colour" — what a
-- customer asking for a size rather than a colour needs. Also the size_id
-- foreign key.
CREATE INDEX IF NOT EXISTS "sampling_stock_size_id_idx"
  ON "sampling_stock" ("size_id");

-- "What came in recently", newest first.
CREATE INDEX IF NOT EXISTS "sampling_intake_created_at_idx"
  ON "sampling_intake" ("created_at");

-- "How did this stock row reach that number" — the audit when a count looks
-- wrong. Also the colour_finish_id foreign key.
CREATE INDEX IF NOT EXISTS "sampling_intake_colour_finish_id_size_id_idx"
  ON "sampling_intake" ("colour_finish_id", "size_id");

-- "How much of this month's stock is offcut rather than cut-to-sample" — the
-- question the source column exists to answer.
CREATE INDEX IF NOT EXISTS "sampling_intake_source_created_at_idx"
  ON "sampling_intake" ("source", "created_at");

-- The dispatch board: "packed but not gone", "gone but not confirmed".
CREATE INDEX IF NOT EXISTS "sampling_dispatch_status_created_at_idx"
  ON "sampling_dispatch" ("status", "created_at");

-- "What have we sent this customer before". The name is free text, so this
-- serves the exact and prefix match a lookup starts from.
CREATE INDEX IF NOT EXISTS "sampling_dispatch_customer_name_idx"
  ON "sampling_dispatch" ("customer_name");

-- One line per item on a package — the same item added twice is a quantity
-- change, not a second line. The dispatch_id prefix is also "the lines of this
-- package", which every read of a dispatch performs, and the foreign key.
--
-- THE ONE HAND-PICKED NAME IN THIS FILE. Prisma's default would be
-- sampling_dispatch_line_dispatch_id_colour_finish_id_size_id_key: exactly 63
-- characters, which is Postgres's identifier limit to the character. It fits,
-- but a single letter added to any of those column names would truncate
-- Prisma's name and not this one. The schema carries the matching
-- `map: "sampling_dispatch_line_item_key"`.
CREATE UNIQUE INDEX IF NOT EXISTS "sampling_dispatch_line_item_key"
  ON "sampling_dispatch_line" ("dispatch_id", "colour_finish_id", "size_id");

-- "Where did our 4x4 Cappuccino go" — the reverse lookup from a stock row.
CREATE INDEX IF NOT EXISTS "sampling_dispatch_line_colour_finish_id_size_id_idx"
  ON "sampling_dispatch_line" ("colour_finish_id", "size_id");

-- The size_id foreign key on the two line-level tables. Neither is covered by
-- an index above (both composites lead with colour_finish_id), and an
-- unindexed FK turns a size lookup into a sequential scan.
CREATE INDEX IF NOT EXISTS "sampling_intake_size_id_idx"
  ON "sampling_intake" ("size_id");

CREATE INDEX IF NOT EXISTS "sampling_dispatch_line_size_id_idx"
  ON "sampling_dispatch_line" ("size_id");

-- -------------------------------------------------------- foreign keys ----
-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so each one is wrapped in a
-- duplicate_object guard (the scripts/0039 form). Referential actions are
-- Prisma's defaults for each relation's optionality: RESTRICT for the required
-- links (a colour with stock against it must not vanish under it), CASCADE
-- from a dispatch to its own lines, which have no meaning without it.

DO $$ BEGIN
  ALTER TABLE "product_colour" ADD CONSTRAINT "product_colour_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "product_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_colour_finish" ADD CONSTRAINT "product_colour_finish_colour_id_fkey" FOREIGN KEY ("colour_id") REFERENCES "product_colour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_stock" ADD CONSTRAINT "sampling_stock_colour_finish_id_fkey" FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_stock" ADD CONSTRAINT "sampling_stock_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sampling_size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_intake" ADD CONSTRAINT "sampling_intake_colour_finish_id_fkey" FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_intake" ADD CONSTRAINT "sampling_intake_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sampling_size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_dispatch_line" ADD CONSTRAINT "sampling_dispatch_line_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "sampling_dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_dispatch_line" ADD CONSTRAINT "sampling_dispatch_line_colour_finish_id_fkey" FOREIGN KEY ("colour_finish_id") REFERENCES "product_colour_finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sampling_dispatch_line" ADD CONSTRAINT "sampling_dispatch_line_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sampling_size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------ comments ----

COMMENT ON TABLE "product_colour" IS
  'One colour in one series. NOT sampling-only: fabrication buys against these names (PO 10026 is Arva White) and polish_qc calls the same string a design, so name is unique across every series and callers resolve a colour without knowing its series. "Cappuccino (Leather)" is NOT a row here — it is the Leather finish of Cappuccino. "Cappuccino Dark" IS.';

COMMENT ON TABLE "product_colour_finish" IS
  'A colour in one finish (Polished / Leather / Suede / Honed) — the row sample stock is actually counted against, because a count that does not know the finish is not a count. TEXT rather than an enum so adding a finish needs no migration; canonical spellings in src/lib/catalogue/colours.ts.';

COMMENT ON TABLE "sampling_size" IS
  'A sample size, created the first time it is typed and reused from then on — there are no standard sizes and nobody curates this list. length_in/width_in are INCHES, thickness_mm is whole MILLIMETRES. length_in is the LONGER edge: 4x6 and 6x4 are one size, because a sample piece has no orientation. Normalisation and the ordering rule live in src/lib/sampling/size.ts.';

COMMENT ON COLUMN "sampling_intake"."source_ref" IS
  'Free text: the slab or bag number the pieces came off. The seam to fab_residual_bag / fab_residual_piece, which are deliberately NOT linked by a foreign key — nothing writes them, and a residual piece carries neither thickness nor colour.';

COMMENT ON TABLE "sampling_dispatch" IS
  'One package to one customer. Free-form by decision: customer name, domestic/international and an optional reference, with no link to the Sales module. status is RELEASED -> DISPATCHED -> DELIVERED, one step forward only, each stamped with its own time and user; "in stock" is the absence of a dispatch, not a status. Rules in src/lib/sampling/lifecycle.ts.';
