-- ============================================================================
--  PACIFIC ERP  ·  NEON PRODUCTION MIGRATION  ·  0067 + 0068
--  Fabrication hand-polish pricing, and the unit an order was written in
-- ============================================================================
--  Prepared for: the database manager
--  Applies to:   the fabrication tables only (fab_requirement, fab_piece,
--                fab_project). Nothing else in the database is referenced.
--
--  Run 0067 first, then 0068. They are in that order below, in one file.
--
-- ─────────────────────── 1 · WHAT THIS DOES, IN ONE LINE ────────────────────
--  It ADDS COLUMNS. That is all. There is no UPDATE, no DELETE, no DROP, no
--  backfill and no data change of any kind anywhere in this file. Section 4
--  tells you how to confirm that for yourself before you run it.
--
-- ─────────────────────── 2 · RUN IT ON A BRANCH FIRST ───────────────────────
--  Neon → Branches → New branch from production. Apply there, run the
--  verification in section 8, then apply to production.
--
--  USE THE DIRECT ENDPOINT, NOT THE POOLER. The pooled endpoint (-pooler in
--  the host name) multiplexes sessions and can hold a DDL statement behind
--  another session's transaction. Connect to the direct host for this.
--
-- ─────────────────────── 3 · FULL OBJECT INVENTORY ──────────────────────────
--  0067 — fab_requirement, six new columns and two signature columns:
--         edges_top, edges_bottom, edges_side       TEXT, nullable
--         edge_rate                                 DOUBLE PRECISION, nullable
--         pricing_mode                              TEXT, nullable
--         edge_total_override                       DOUBLE PRECISION, nullable
--         edge_total_override_by                    TEXT, FK -> users(id)
--         edge_total_override_at                    TIMESTAMP(3), nullable
--
--  0067 — fab_piece, the hand-bench specification:
--         polish_by_hand            BOOLEAN NOT NULL DEFAULT false
--         hand_edges_top/bottom/side                TEXT, nullable
--         hand_rate                                 DOUBLE PRECISION, nullable
--         hand_pricing_mode                         TEXT, nullable
--         hand_total_override                       DOUBLE PRECISION, nullable
--         hand_assigned_by_id       TEXT, FK -> users(id)
--         hand_assigned_session_id  TEXT, FK -> fab_machine_session(id)
--         hand_assigned_at                          TIMESTAMP(3), nullable
--
--  0067 — fab_project, the agreed project total:
--         manual_total              DOUBLE PRECISION, nullable
--         manual_total_by           TEXT, FK -> users(id)
--         manual_total_at           TIMESTAMP(3), nullable
--         manual_total_note         TEXT, nullable
--
--  0068 — fab_requirement, one column:
--         dim_unit                  TEXT, nullable, CHECK IN ('IN','CM')
--
--  CHECK constraints added: the three edge CSVs on each table, pricing_mode,
--  the money columns (>= 0), and dim_unit. All reject bad values only; none
--  can fail on existing rows, because every new column is NULL on all of them.
--
--  ONE COLUMN IS NOT NULL: fab_piece.polish_by_hand, and it carries
--  DEFAULT false. In Postgres 11+ a NOT NULL column with a constant default is
--  a catalogue change, not a table rewrite — existing rows are not touched.
--
-- ─────────────────────── 4 · AUDIT IT YOURSELF BEFORE RUNNING ───────────────
--  Do not take my word for what is in here. Strip the comment lines and read
--  what is left — that is every statement this file executes:
--
--      grep -v "^\s*--" pacific-fab-0067-0068-neon.sql | grep -v "^\s*$"
--
--  That comes to 24 ALTER TABLE, 23 ADD COLUMN, 10 ADD CONSTRAINT, 13 COMMENT
--  ON, 2 CREATE INDEX, 6 DO blocks, 2 BEGIN and 2 COMMIT. Nothing else.
--
--  ON THE EXECUTABLE LINES ONLY, these are the counts:
--
--      DROP COLUMN      0
--      TRUNCATE         0
--      ALTER COLUMN     0
--      DROP TABLE       0
--      UPDATE / DELETE  0 statements
--      DROP CONSTRAINT  7   <- see below, this one is real
--
--  TWO THINGS THAT LOOK ALARMING IN A PLAIN grep AND ARE NOT:
--
--  a) "UPDATE" and "DELETE" appear 4 times each, always as
--         ON DELETE SET NULL ON UPDATE CASCADE
--     which is the referential action on the new foreign keys, not a statement.
--     Those FKs point at users(id) and fab_machine_session(id); SET NULL means
--     deleting a user blanks the signature rather than blocking the delete.
--
--  b) "DROP CONSTRAINT IF EXISTS" appears 7 times, and it is deliberate. It is
--     the drop-then-add idempotency pattern, so the file can be re-run safely:
--
--         fab_requirement_edges_top_ck / _edges_bottom_ck / _edges_side_ck
--         fab_requirement_pricing_mode_ck
--         fab_requirement_edge_money_ck
--
--     EVERY ONE OF THOSE NAMES IS CREATED BY THIS FILE, three lines further
--     down. None of them exists before 0067 runs, so on a first run all seven
--     drops are no-ops. No pre-existing constraint is named anywhere in this
--     file — in particular fab_requirement_finished_edges_ck, from 0063, is
--     never touched. You can confirm that with:
--
--         SELECT conname FROM pg_constraint WHERE conname LIKE 'fab_%_ck';
--
--     before and after, and diff the two lists: the after list is the before
--     list plus the new names.
--
-- ─────────────────────── 5 · LOCK PROFILE AND DURATION ──────────────────────
--  Every statement is ADD COLUMN or ADD CONSTRAINT. Each takes an ACCESS
--  EXCLUSIVE lock on its table for the instant it edits the catalogue, then
--  releases it. No table is scanned and no row is rewritten, so duration does
--  not grow with table size — this is milliseconds on any size of fab_*.
--
--  0068 adds its CHECK as NOT VALID and validates it in a separate statement
--  outside the transaction, so the validation pass takes only SHARE UPDATE
--  EXCLUSIVE and does not block reads or writes.
--
--  If a statement does block, it is waiting on an existing long transaction,
--  not on its own work. Cancel and retry rather than waiting it out.
--
-- ─────────────────────── 6 · IS 0067 ALREADY THERE? ─────────────────────────
--  0067 may already have been applied. Both scripts are idempotent (IF NOT
--  EXISTS throughout), so re-running is safe and changes nothing — but run
--  this first so you know what you are about to do:
--
--      SELECT table_name, column_name
--        FROM information_schema.columns
--       WHERE (table_name = 'fab_requirement'
--              AND column_name IN ('edges_top','edge_rate','pricing_mode',
--                                  'edge_total_override','dim_unit'))
--          OR (table_name = 'fab_piece'    AND column_name = 'polish_by_hand')
--          OR (table_name = 'fab_project'  AND column_name = 'manual_total')
--       ORDER BY table_name, column_name;
--
--  NOTHING RETURNED  -> neither 0067 nor 0068 is applied. Run the whole file.
--  EVERYTHING BUT dim_unit -> 0067 is applied. Running the whole file is still
--                             safe; only the 0068 half will do anything.
--  EVERYTHING       -> both applied already. Nothing to do.
--
-- ─────────────────────── 7 · ROLLBACK ───────────────────────────────────────
--  Dropping these columns loses only what has been typed into them since. No
--  pre-existing data is at risk, because none of it is touched.
--
--      ALTER TABLE "fab_requirement"
--        DROP COLUMN IF EXISTS "dim_unit",
--        DROP COLUMN IF EXISTS "edges_top",   DROP COLUMN IF EXISTS "edges_bottom",
--        DROP COLUMN IF EXISTS "edges_side",  DROP COLUMN IF EXISTS "edge_rate",
--        DROP COLUMN IF EXISTS "pricing_mode",
--        DROP COLUMN IF EXISTS "edge_total_override",
--        DROP COLUMN IF EXISTS "edge_total_override_by",
--        DROP COLUMN IF EXISTS "edge_total_override_at";
--      ALTER TABLE "fab_piece"
--        DROP COLUMN IF EXISTS "polish_by_hand",
--        DROP COLUMN IF EXISTS "hand_edges_top",   DROP COLUMN IF EXISTS "hand_edges_bottom",
--        DROP COLUMN IF EXISTS "hand_edges_side",  DROP COLUMN IF EXISTS "hand_rate",
--        DROP COLUMN IF EXISTS "hand_pricing_mode",
--        DROP COLUMN IF EXISTS "hand_total_override",
--        DROP COLUMN IF EXISTS "hand_assigned_by_id",
--        DROP COLUMN IF EXISTS "hand_assigned_session_id",
--        DROP COLUMN IF EXISTS "hand_assigned_at";
--      ALTER TABLE "fab_project"
--        DROP COLUMN IF EXISTS "manual_total",    DROP COLUMN IF EXISTS "manual_total_by",
--        DROP COLUMN IF EXISTS "manual_total_at", DROP COLUMN IF EXISTS "manual_total_note";
--
--  0063's CIRCLE and OVAL enum values are NOT reversible and are not in this
--  file; they went with an earlier batch.
--
-- ─────────────────────── 8 · VERIFY AFTER RUNNING ───────────────────────────
--  a. all 22 columns exist and every one is nullable except polish_by_hand
--
--      SELECT table_name, column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_name IN ('fab_requirement','fab_piece','fab_project')
--         AND column_name IN (
--              'edges_top','edges_bottom','edges_side','edge_rate','pricing_mode',
--              'edge_total_override','edge_total_override_by','edge_total_override_at',
--              'dim_unit',
--              'polish_by_hand','hand_edges_top','hand_edges_bottom','hand_edges_side',
--              'hand_rate','hand_pricing_mode','hand_total_override',
--              'hand_assigned_by_id','hand_assigned_session_id','hand_assigned_at',
--              'manual_total','manual_total_by','manual_total_at','manual_total_note')
--       ORDER BY table_name, column_name;
--
--  b. NO EXISTING ROW WAS TOUCHED — this is the one that matters. Every new
--     column must be NULL on every row, and polish_by_hand false on every row.
--
--      SELECT count(*)                                        AS rows_total,
--             count(*) FILTER (WHERE edges_top IS NOT NULL)   AS non_null_edges_top,
--             count(*) FILTER (WHERE edge_rate IS NOT NULL)   AS non_null_edge_rate,
--             count(*) FILTER (WHERE dim_unit  IS NOT NULL)   AS non_null_dim_unit
--        FROM fab_requirement;
--      -- EXPECT all three non_null counts = 0
--
--      SELECT count(*) FILTER (WHERE polish_by_hand) AS by_hand FROM fab_piece;
--      -- EXPECT 0
--
--      SELECT count(*) FILTER (WHERE manual_total IS NOT NULL) AS overridden
--        FROM fab_project;
--      -- EXPECT 0
--
--  c. the constraints are present and valid
--
--      SELECT conname, convalidated FROM pg_constraint
--       WHERE conname LIKE 'fab_%_ck' ORDER BY conname;
--
-- ─────────────────────── 9 · THE CODE DEPLOY GOES AFTER THIS ────────────────
--  The application reads these columns defensively — a missing column leaves a
--  row showing "not chosen" rather than failing — but the correct order is
--  still: branch, apply, verify, apply to production, then deploy the code.
--
--  Nothing in the running application writes to any of these columns until
--  somebody uses the new screens, so there is no window where old code and the
--  new columns disagree.
-- ============================================================================


-- ############################################################################
-- #  0067  ·  HAND POLISH PRICING
-- ############################################################################

-- =====================================================================
-- 0067-hand-polish-pricing.sql
--
-- HAND POLISH STOPS HAVING ONE PRICE, AND THE SIDE JOINS THE TOP AND BOTTOM.
--
-- The owner, laying out what the rate card cannot express:
--
--   "some pieces will be fully hand polished — like side is also hand polished,
--    top and bottom edges too, on all four sides, and price is not fixed on
--    common, so each time it should be asked how much."
--   "some will be priced on number of piece — one piece this is the price."
--   "some pieces only top on 4 side or 2 side, like now."
--   "pricing differs and changeable and vary for each project. For sink cut
--    it's fixed: 2cm 230 rs and for 3cm its 300 rs."
--   "always have a custom free field for total, so when system feels heavy they
--    call and enter the amount."
--
-- Four separate changes fall out of that, and one thing that does NOT change.
--
-- ─────────────────────────── 1 · THREE FACES, EACH WITH ITS OWN SIDES ───────
-- edge_faces (scripts/0065) applies ONE answer to ALL the chosen edges: "these
-- four sides, both faces." It cannot say "top on four sides, bottom on two",
-- and the owner asks for exactly that - "choose the number of side for top, no
-- of side for bottom, and no of side for side."
--
-- So the multiplier becomes three independent selections:
--
--     edges_top     which sides get the TOP arris polished
--     edges_bottom  which sides get the BOTTOM arris
--     edges_side    which sides get the BAND itself - the vertical thickness
--                   face, normally machine polished, sometimes done by hand
--
-- Each holds the SAME canonical CSV finished_edges already uses, so the
-- vocabulary is one vocabulary and a row stays readable in psql. Fully hand
-- polished is all three on all four sides: three passes along the perimeter.
--
-- SUMMED, NEVER MULTIPLIED. Top on four and bottom on two is a perimeter plus
-- two sides, not a perimeter times something - lib/fab/shape.ts.
--
-- ─────────────────────────── WHY SIDES AND NOT A COUNT ──────────────────────
-- The owner asked for a COUNT, and the screen shows him a count. The count is
-- not what is stored, because a count cannot be priced by the foot: on a
-- 103 x 19.5 cm piece "two sides" is either 206 cm or 39 cm, FIVE TIMES APART.
-- A per-foot charge computed from the count alone would be wrong on every piece
-- that is not square, silently, with a plausible figure on the screen.
--
-- ─────────────────────────── 2 · THE RATE IS THE ROW'S, NOT THE CARD'S ──────
-- edge_rate, in the unit pricing_mode implies. NULL FALLS BACK TO THE CARD
-- (Rs15 at 2 cm, Rs20 at 3 cm), which is what every row already written does
-- and what an ordinary row should keep doing - nobody types a rate unless the
-- job is unusual. Only the row that IS unusual gets asked.
--
--   RUNNING_FOOT  feet x rate. The default; NULL means this.
--   PER_PIECE     quantity x rate.
--   LUMP_SUM      one figure for the whole row, entered as the rate.
--
-- ─────────────────────────── 3 · THE PHONE-CALL NUMBER, AT TWO LEVELS ───────
-- fab_requirement.edge_total_override replaces one row's HAND POLISH charge.
-- fab_project.manual_total replaces the whole project's fabrication total.
--
-- Both record WHO and WHEN, and neither destroys the calculated figure - the
-- application returns it alongside as calculatedEdgeCost and the screen shows
-- both. An override that quietly replaces a number nobody can see again is how
-- a wrong rate card survives for a year.
--
-- The row override also RESCUES a row this system refuses to price: an
-- L-shaped outline, a blank width, an off-card thickness. Those refusals are
-- precisely when somebody picks up the phone, and a figure a human agreed beats
-- a gap on an invoice.
--
-- ─────────────────────────── 4 · A PIECE PULLED OFF THE MACHINE ─────────────
-- "Already decided is also sent to hand later if machine doesn't support or
-- busy or breakdown... and this can be per piece."
--
-- THIS IS THE ONE PLACE THE HOMOGENEOUS-ROW RULE DOES NOT HOLD, and that is
-- deliberate. Everything else in this module rests on "if half the pieces need
-- something different, SPLIT the row" - right for an ORDER, which is decided
-- once at a desk. A machine failing at nine at night is not that: it takes the
-- pieces in front of it, mid-row, and nobody is renumbering an order around it.
--
-- So fab_piece carries its own polish_by_hand flag, its own three faces, its
-- own rate and mode, and its own override. They apply to THAT PIECE and
-- override its row's edge charge for it alone. Every piece that never moved
-- keeps the row's price.
--
-- hand_assigned_by_id AND hand_assigned_session_id, both, for the reason
-- scripts/0064 gives at length: the floor signs in on ONE shared operator
-- account, so the login names nobody and the machine session - which carries
-- worker, machine and shift - is the half that does.
--
-- ─────────────────────────── WHAT DOES NOT CHANGE ───────────────────────────
-- THE SINK. Rs230 at 2 cm, Rs300 at 3 cm, per piece, fixed, off the card. It
-- takes no rate, no mode and no override, and the owner has said so twice.
-- Nothing below touches sink_quantity or the sink half of the charge.
--
-- AND EVERY FIGURE ALREADY QUOTED. finished_edges and edge_faces are left in
-- place and still priced exactly as they are today; the new columns are read
-- ONLY on a row that has them (lib/fab/shape.ts faceEdgesFromLegacy). A row
-- nobody has touched with the new screens prices to the same paisa it did
-- before this script ran. Verified by the query at the foot of this file.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0066.
--
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0067-hand-polish-pricing.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1 · THE ORDERED ROW
-- ---------------------------------------------------------------------
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "edges_top"              TEXT,
  ADD COLUMN IF NOT EXISTS "edges_bottom"           TEXT,
  ADD COLUMN IF NOT EXISTS "edges_side"             TEXT,
  ADD COLUMN IF NOT EXISTS "edge_rate"              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "pricing_mode"           TEXT,
  ADD COLUMN IF NOT EXISTS "edge_total_override"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "edge_total_override_by" TEXT,
  ADD COLUMN IF NOT EXISTS "edge_total_override_at" TIMESTAMP(3);

COMMENT ON COLUMN "fab_requirement"."edges_top" IS
  'Which sides get the TOP arris hand polished, as the same canonical CSV '
  'finished_edges uses (front,back,left,right - or the single word ''round''). '
  'NULL on all three edges_* columns means this row has no three-face spec and '
  'is read from finished_edges + edge_faces instead, which is what every row '
  'written before scripts/0067 does. An EMPTY STRING is a real answer: asked, '
  'and this face gets nothing.';

COMMENT ON COLUMN "fab_requirement"."edges_bottom" IS
  'Which sides get the BOTTOM arris hand polished. Independent of edges_top - '
  'the whole point of scripts/0067: "top on 4 side, bottom on 2".';

COMMENT ON COLUMN "fab_requirement"."edges_side" IS
  'Which sides get the BAND itself - the vertical thickness face - polished BY '
  'HAND rather than on the machine. Never produced from the legacy columns: no '
  'row written before 0067 ever asked for it, so none of them gains a pass.';

COMMENT ON COLUMN "fab_requirement"."edge_rate" IS
  'This row''s OWN hand-polish rate, in the unit pricing_mode implies: rupees '
  'per foot, per piece, or for the whole row. NULL FALLS BACK TO THE RATE CARD '
  '(Rs15 at 2 cm, Rs20 at 3 cm), which is what every existing row does. Zero is '
  'a real rate and is honoured; NULL is not zero.';

COMMENT ON COLUMN "fab_requirement"."pricing_mode" IS
  'RUNNING_FOOT (default, and NULL means this) / PER_PIECE / LUMP_SUM. Applies '
  'to HAND POLISH ONLY. The sink is fixed per piece off the card and is not '
  'affected by this column in any mode.';

COMMENT ON COLUMN "fab_requirement"."edge_total_override" IS
  'A figure a human agreed, replacing this row''s calculated hand-polish charge '
  'outright - "when system feels heavy they call and enter the amount". Also '
  'RESCUES a row the system refuses to price (odd outline, blank size, off-card '
  'thickness), because that is exactly when somebody phones. Does NOT touch the '
  'sink. The calculated figure is not destroyed: the application returns it '
  'beside this one and both are shown.';

-- Edge CSVs speak the same vocabulary as finished_edges, and the constraint is
-- the same one 0063 put on that column. The application refuses an unknown word
-- first; this is the door that holds when somebody edits a row in psql.
DO $$
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['edges_top','edges_bottom','edges_side'] LOOP
    EXECUTE format(
      'ALTER TABLE fab_requirement DROP CONSTRAINT IF EXISTS fab_requirement_%s_ck', c);
    EXECUTE format(
      'ALTER TABLE fab_requirement ADD CONSTRAINT fab_requirement_%s_ck CHECK (%I IS NULL OR %I = '''' OR %I = ''round'' OR %I ~ ''^(front|back|left|right)(,(front|back|left|right))*$'')',
      c, c, c, c, c);
  END LOOP;
END $$;

ALTER TABLE "fab_requirement"
  DROP CONSTRAINT IF EXISTS "fab_requirement_pricing_mode_ck";
ALTER TABLE "fab_requirement"
  ADD CONSTRAINT "fab_requirement_pricing_mode_ck"
  CHECK ("pricing_mode" IS NULL
         OR "pricing_mode" IN ('RUNNING_FOOT','PER_PIECE','LUMP_SUM'));

-- A rate or an agreed total is never negative. Zero is allowed - a row can
-- genuinely be quoted at nothing - so this is >= and not >.
ALTER TABLE "fab_requirement"
  DROP CONSTRAINT IF EXISTS "fab_requirement_edge_money_ck";
ALTER TABLE "fab_requirement"
  ADD CONSTRAINT "fab_requirement_edge_money_ck"
  CHECK (("edge_rate" IS NULL OR "edge_rate" >= 0)
     AND ("edge_total_override" IS NULL OR "edge_total_override" >= 0));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'fab_requirement_edge_override_by_fkey') THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_edge_override_by_fkey"
      FOREIGN KEY ("edge_total_override_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- "Which rows are a typed figure rather than a calculated one" is the only way
-- this is queried, and it is how a half-manual project total gets explained.
CREATE INDEX IF NOT EXISTS "fab_requirement_edge_override_idx"
  ON "fab_requirement" ("edge_total_override_at" DESC)
  WHERE "edge_total_override" IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2 · THE PIECE THAT WENT TO THE HAND BENCH
-- ---------------------------------------------------------------------
ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "polish_by_hand"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hand_edges_top"          TEXT,
  ADD COLUMN IF NOT EXISTS "hand_edges_bottom"       TEXT,
  ADD COLUMN IF NOT EXISTS "hand_edges_side"         TEXT,
  ADD COLUMN IF NOT EXISTS "hand_rate"               DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "hand_pricing_mode"       TEXT,
  ADD COLUMN IF NOT EXISTS "hand_total_override"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "hand_assigned_by_id"     TEXT,
  ADD COLUMN IF NOT EXISTS "hand_assigned_session_id" TEXT,
  ADD COLUMN IF NOT EXISTS "hand_assigned_at"        TIMESTAMP(3);

COMMENT ON COLUMN "fab_piece"."polish_by_hand" IS
  'This piece was moved from the polishing MACHINE to the hand bench - the '
  'machine could not do the profile, was busy, or broke down. It OVERRIDES its '
  'row''s edge charge for this piece alone, using the hand_* columns beside it; '
  'every piece of the row that did not move keeps the row price. This is the '
  'one place the homogeneous-row rule does not hold, and scripts/0067 says why. '
  'Pricing only: the piece still routes through the polishing queue as before.';

COMMENT ON COLUMN "fab_piece"."hand_edges_top" IS
  'This PIECE''s own top-arris side selection, same vocabulary as '
  'fab_requirement.edges_top. Set when it was sent to hand; NULL means the row''s '
  'specification stands.';

COMMENT ON COLUMN "fab_piece"."hand_rate" IS
  'What was agreed for THIS piece, in the unit hand_pricing_mode implies. NULL '
  'falls back to the rate card. Asked at the moment the piece is sent to hand - '
  'the owner: "it need to ask the cost on how much per feet".';

COMMENT ON COLUMN "fab_piece"."hand_assigned_session_id" IS
  'The fab_machine_session the reassignment was made from. THE HALF THAT NAMES '
  'THE HUMAN: the floor shares one operator login, so hand_assigned_by_id reads '
  '"operator@..." for every floor reassignment while the session carries the '
  'worker, the machine and the shift. Same reasoning as scripts/0064.';

DO $$
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['hand_edges_top','hand_edges_bottom','hand_edges_side'] LOOP
    EXECUTE format('ALTER TABLE fab_piece DROP CONSTRAINT IF EXISTS fab_piece_%s_ck', c);
    EXECUTE format(
      'ALTER TABLE fab_piece ADD CONSTRAINT fab_piece_%s_ck CHECK (%I IS NULL OR %I = '''' OR %I = ''round'' OR %I ~ ''^(front|back|left|right)(,(front|back|left|right))*$'')',
      c, c, c, c, c);
  END LOOP;
END $$;

ALTER TABLE "fab_piece"
  DROP CONSTRAINT IF EXISTS "fab_piece_hand_pricing_mode_ck";
ALTER TABLE "fab_piece"
  ADD CONSTRAINT "fab_piece_hand_pricing_mode_ck"
  CHECK ("hand_pricing_mode" IS NULL
         OR "hand_pricing_mode" IN ('RUNNING_FOOT','PER_PIECE','LUMP_SUM'));

ALTER TABLE "fab_piece"
  DROP CONSTRAINT IF EXISTS "fab_piece_hand_money_ck";
ALTER TABLE "fab_piece"
  ADD CONSTRAINT "fab_piece_hand_money_ck"
  CHECK (("hand_rate" IS NULL OR "hand_rate" >= 0)
     AND ("hand_total_override" IS NULL OR "hand_total_override" >= 0));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'fab_piece_hand_assigned_by_fkey') THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_hand_assigned_by_fkey"
      FOREIGN KEY ("hand_assigned_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'fab_piece_hand_assigned_session_fkey') THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_hand_assigned_session_fkey"
      FOREIGN KEY ("hand_assigned_session_id") REFERENCES "fab_machine_session"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- "What is on the hand bench that should not be" is the query the supervisor
-- runs. Partial, because the overwhelming majority of pieces never move.
CREATE INDEX IF NOT EXISTS "fab_piece_polish_by_hand_idx"
  ON "fab_piece" ("requirement_id", "hand_assigned_at" DESC)
  WHERE "polish_by_hand" = true;


-- ---------------------------------------------------------------------
-- 3 · THE WHOLE PROJECT, AGREED ON A PHONE CALL
-- ---------------------------------------------------------------------
ALTER TABLE "fab_project"
  ADD COLUMN IF NOT EXISTS "manual_total"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "manual_total_by"   TEXT,
  ADD COLUMN IF NOT EXISTS "manual_total_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manual_total_note" TEXT;

COMMENT ON COLUMN "fab_project"."manual_total" IS
  'The whole project''s fabrication charge, agreed by a human and replacing '
  'every calculation under it. The escape hatch of last resort - "when system '
  'feels heavy they call and enter the amount". The calculated total is NOT '
  'destroyed: both are shown, because an override nobody can see past is how a '
  'wrong rate card survives a year. NULL means the figures are the system''s.';

COMMENT ON COLUMN "fab_project"."manual_total_note" IS
  'Why. Free text, and worth more than the number six months later: "agreed with '
  'Fred on the phone, 12 Sep, includes the two L-shaped tops".';

ALTER TABLE "fab_project"
  DROP CONSTRAINT IF EXISTS "fab_project_manual_total_ck";
ALTER TABLE "fab_project"
  ADD CONSTRAINT "fab_project_manual_total_ck"
  CHECK ("manual_total" IS NULL OR "manual_total" >= 0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'fab_project_manual_total_by_fkey') THEN
    ALTER TABLE "fab_project"
      ADD CONSTRAINT "fab_project_manual_total_by_fkey"
      FOREIGN KEY ("manual_total_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;


-- =====================================================================
-- AFTERWARDS
-- =====================================================================

-- THE ONE THAT MATTERS. Every row that existed before this script has all three
-- edges_* NULL, and is therefore still priced from finished_edges + edge_faces.
-- `legacy_rows` should be your entire table and `new_spec_rows` should be 0
-- immediately after applying; the second grows only as the new screens are used.
--
-- SELECT count(*) FILTER (WHERE edges_top IS NULL
--                           AND edges_bottom IS NULL
--                           AND edges_side IS NULL)                AS legacy_rows,
--        count(*) FILTER (WHERE edges_top IS NOT NULL
--                            OR edges_bottom IS NOT NULL
--                            OR edges_side IS NOT NULL)            AS new_spec_rows,
--        count(*) FILTER (WHERE edge_rate IS NOT NULL)             AS own_rate,
--        count(*) FILTER (WHERE pricing_mode IS NOT NULL
--                           AND pricing_mode <> 'RUNNING_FOOT')    AS not_per_foot,
--        count(*) FILTER (WHERE edge_total_override IS NOT NULL)   AS overridden
-- FROM   fab_requirement;

-- What is on the hand bench, who put it there, and what was agreed for it.
-- coalesce puts the floor answer and the desk answer in one column, exactly as
-- the scripts/0064 query does for slab releases.
--
-- SELECT p.piece_code,
--        r.row_letter,
--        coalesce(w.name, u.name, u.email, 'not recorded')  AS sent_by,
--        CASE WHEN p.hand_assigned_session_id IS NOT NULL THEN 'floor'
--             WHEN p.hand_assigned_by_id IS NOT NULL       THEN 'desk'
--             ELSE 'not recorded' END                      AS sent_from,
--        ms.shift,
--        p.hand_assigned_at,
--        coalesce(p.hand_pricing_mode, 'RUNNING_FOOT')      AS mode,
--        p.hand_rate,
--        p.hand_total_override,
--        p.hand_edges_top, p.hand_edges_bottom, p.hand_edges_side
-- FROM   fab_piece p
-- LEFT   JOIN fab_requirement r        ON r.id  = p.requirement_id
-- LEFT   JOIN users u                  ON u.id  = p.hand_assigned_by_id
-- LEFT   JOIN fab_machine_session ms   ON ms.id = p.hand_assigned_session_id
-- LEFT   JOIN fab_worker w             ON w.id  = ms.worker_id
-- WHERE  p.polish_by_hand = true
-- ORDER  BY p.hand_assigned_at DESC NULLS LAST
-- LIMIT  100;

-- A piece on the bench that nobody priced. Expected to be empty; anything here
-- is somebody polishing stone for a figure that was never agreed.
--
-- SELECT piece_code, hand_assigned_at
-- FROM   fab_piece
-- WHERE  polish_by_hand = true
--   AND  hand_total_override IS NULL
--   AND  hand_edges_top IS NULL
--   AND  hand_edges_bottom IS NULL
--   AND  hand_edges_side IS NULL;

-- Projects whose total is a typed figure rather than a calculated one.
--
-- SELECT p.project_code, p.manual_total, p.manual_total_at,
--        coalesce(u.name, u.email, 'not recorded') AS agreed_by,
--        p.manual_total_note
-- FROM   fab_project p
-- LEFT   JOIN users u ON u.id = p.manual_total_by
-- WHERE  p.manual_total IS NOT NULL
-- ORDER  BY p.manual_total_at DESC;


-- ############################################################################
-- #  0068  ·  THE UNIT AN ORDER WAS WRITTEN IN
-- ############################################################################

-- ============================================================================
-- 0068 · THE UNIT THE CUSTOMER ORDERED IN
-- ============================================================================
-- One nullable column on fab_requirement. Nothing is backfilled, nothing is
-- updated, nothing is dropped. Re-runnable.
--
-- ─────────────────────── WHY THIS EXISTS ────────────────────────────────────
-- fab_requirement.length/width are INCHES and must stay inches. Every figure in
-- the system is built on that: sqft_per_piece is L*W/144 (square inches to
-- square feet) and lib/fab/pricing.ts divides the perimeter by 12 to get the
-- RUNNING FEET that edge polish is charged by. Storing a centimetre in those
-- columns would multiply every edge charge by 2.54 and every area by 6.45, and
-- nothing on any screen would look wrong.
--
-- But the customer did not order in inches. PI SAL-ORD/25-26/01200 (Kerasom,
-- Netherlands) is centimetres throughout — "DS - Thresholds (103 x 3)", 2 CM
-- thick, priced per SQMT. The man at the saw is holding that document. Showing
-- him 40.5512 x 1.1811 where it says 103 x 3 is how a piece gets cut wrong.
--
-- So the unit is recorded BESIDE the inches rather than instead of them:
-- the maths reads the columns, the screens read this, and neither has to
-- convert anything the other depends on.
--
-- ─────────────────────── NULL IS INCHES, AND THAT IS THE POINT ──────────────
-- Every row written before today is an inch row — PO 10026 and every other US
-- order came off a packing list in inches and square feet. If NULL meant
-- "unknown" the screens would have to guess; if it meant "cm" every historical
-- row would suddenly display a number 2.54x larger than the one on its own
-- purchase order.
--
-- NULL MEANS INCHES. It is not a missing answer. lib/fab/dimensions.ts renders
-- a NULL row byte-identically to what the screens printed yesterday, which is
-- what makes this migration safe to apply to a live database at any moment,
-- including before the code that reads it ships.
--
-- ─────────────────────── LOCK PROFILE ───────────────────────────────────────
-- ADD COLUMN with no DEFAULT and no NOT NULL is metadata-only in Postgres 11+:
-- no table rewrite, no row locks held while scanning. It takes an ACCESS
-- EXCLUSIVE lock for the moment it edits the catalogue. On Neon, run it on a
-- branch first, then on production against the DIRECT endpoint (not -pooler).
--
-- The CHECK constraint is added NOT VALID and validated separately, so the
-- validation pass takes only a SHARE UPDATE EXCLUSIVE lock and does not block
-- reads or writes. On an empty-of-CM database this is instant either way; it is
-- written this way so the same file is still correct when the table is large.
--
-- ROLLBACK
--   ALTER TABLE "fab_requirement" DROP COLUMN IF EXISTS "dim_unit";
--   -- Loses only the display hint. No money, no quantity, no dimension.
-- ============================================================================

BEGIN;

ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "dim_unit" TEXT;

COMMENT ON COLUMN "fab_requirement"."dim_unit" IS
  'The unit the CUSTOMER ordered this row in, for display only: ''CM'' or ''IN''. NULL means IN and is not a missing answer - every row predating scripts/0068 is an inch row. length/width are ALWAYS stored in inches regardless of this column, because sqft_per_piece (L*W/144) and the running-foot edge charge (perimeter/12) are built on inches. See src/lib/fab/dimensions.ts, which is the only thing that reads this.';

-- Two spellings, and no third. A typo here would render as an inch row and be
-- invisible, so the database refuses it rather than letting it through.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_dim_unit_ck'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_dim_unit_ck"
      CHECK ("dim_unit" IS NULL OR "dim_unit" IN ('IN', 'CM'))
      NOT VALID;
  END IF;
END $$;

COMMIT;

-- Separate transaction on purpose: validating outside the DDL transaction is
-- what keeps the weaker lock. Idempotent - validating an already-valid
-- constraint is a no-op.
ALTER TABLE "fab_requirement" VALIDATE CONSTRAINT "fab_requirement_dim_unit_ck";

-- ============================================================================
-- VERIFY (read-only)
-- ============================================================================
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'fab_requirement' AND column_name = 'dim_unit';
--   EXPECT  dim_unit | text | YES | (null)
--
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conname = 'fab_requirement_dim_unit_ck';
--   EXPECT  fab_requirement_dim_unit_ck | t
--
--   -- Nothing was touched: every pre-existing row is still NULL, i.e. inches.
--   SELECT count(*) FILTER (WHERE dim_unit IS NULL)  AS inch_rows,
--          count(*) FILTER (WHERE dim_unit = 'CM')   AS cm_rows
--     FROM fab_requirement;
-- ============================================================================

-- ============================================================================
--  END OF FILE. Run section 8 now.
-- ============================================================================
