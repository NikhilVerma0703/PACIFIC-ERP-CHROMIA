-- Generated from scripts/pacific-fab-0067-0070-neon.sql by stripping comment-only lines.
-- Verified 2026-09-09: applied to a scratch DB rolled back to commit 6b2e8bc's schema,
-- reproduced the working schema byte-identically, and re-ran with zero changes.
-- Adds 31 columns + 4 FKs + 19 CHECK constraints. No UPDATE/DELETE/DROP COLUMN/TRUNCATE.
BEGIN;
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
CREATE INDEX IF NOT EXISTS "fab_requirement_edge_override_idx"
  ON "fab_requirement" ("edge_total_override_at" DESC)
  WHERE "edge_total_override" IS NOT NULL;
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
CREATE INDEX IF NOT EXISTS "fab_piece_polish_by_hand_idx"
  ON "fab_piece" ("requirement_id", "hand_assigned_at" DESC)
  WHERE "polish_by_hand" = true;
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
BEGIN;
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "dim_unit" TEXT;
COMMENT ON COLUMN "fab_requirement"."dim_unit" IS
  'The unit the CUSTOMER ordered this row in, for display only: ''CM'' or ''IN''. NULL means IN and is not a missing answer - every row predating scripts/0068 is an inch row. length/width are ALWAYS stored in inches regardless of this column, because sqft_per_piece (L*W/144) and the running-foot edge charge (perimeter/12) are built on inches. See src/lib/fab/dimensions.ts, which is the only thing that reads this.';
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
ALTER TABLE "fab_requirement" VALIDATE CONSTRAINT "fab_requirement_dim_unit_ck";
BEGIN;
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "pair_rate" DOUBLE PRECISION;
COMMENT ON COLUMN "fab_requirement"."pair_rate" IS
  'Rupees per running foot for a side polished on BOTH top and bottom, replacing two passes at edge_rate. NULL means no pair discount - the two faces are summed at edge_rate, which is what every row predating scripts/0069 is charged. Applies to the sides that share both faces and to nothing else; the side band never pairs. RUNNING_FOOT only. See facePairSplit() in src/lib/fab/shape.ts.';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_pair_rate_ck'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_pair_rate_ck"
      CHECK ("pair_rate" IS NULL OR "pair_rate" >= 0)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "hand_pair_rate" DOUBLE PRECISION;
COMMENT ON COLUMN "fab_piece"."hand_pair_rate" IS
  'This piece''s own pair rate at the hand bench - rupees per running foot for a side polished on both top and bottom. NULL means no pair discount for this piece. The per-piece counterpart of fab_requirement.pair_rate; see scripts/0067 for why a hand-bench piece carries its own terms at all.';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_hand_pair_rate_ck'
  ) THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_hand_pair_rate_ck"
      CHECK ("hand_pair_rate" IS NULL OR "hand_pair_rate" >= 0)
      NOT VALID;
  END IF;
END $$;
COMMIT;
ALTER TABLE "fab_requirement" VALIDATE CONSTRAINT "fab_requirement_pair_rate_ck";
ALTER TABLE "fab_piece"       VALIDATE CONSTRAINT "fab_piece_hand_pair_rate_ck";
BEGIN;
ALTER TABLE "fab_requirement"
  ADD COLUMN IF NOT EXISTS "edge_rate_top"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "edge_rate_bottom" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "edge_rate_side"   DOUBLE PRECISION;
COMMENT ON COLUMN "fab_requirement"."edge_rate_top" IS
  'Rupees per running foot for the TOP face. NULL falls back to edge_rate, which falls back to the rate card - so NULL prices exactly as this row priced before scripts/0070. A side polished on both faces uses pair_rate, or this plus edge_rate_bottom when pair_rate is NULL.';
COMMENT ON COLUMN "fab_requirement"."edge_rate_bottom" IS
  'Rupees per running foot for the BOTTOM face. NULL falls back to edge_rate then the card. See edge_rate_top.';
COMMENT ON COLUMN "fab_requirement"."edge_rate_side" IS
  'Rupees per running foot for the SIDE BAND - the vertical thickness face. NULL falls back to edge_rate then the card. The band never pairs with anything: it is its own pass over a different surface, and the owner prices it separately.';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_requirement_face_rate_ck'
  ) THEN
    ALTER TABLE "fab_requirement"
      ADD CONSTRAINT "fab_requirement_face_rate_ck"
      CHECK (("edge_rate_top"    IS NULL OR "edge_rate_top"    >= 0)
         AND ("edge_rate_bottom" IS NULL OR "edge_rate_bottom" >= 0)
         AND ("edge_rate_side"   IS NULL OR "edge_rate_side"   >= 0))
      NOT VALID;
  END IF;
END $$;
ALTER TABLE "fab_piece"
  ADD COLUMN IF NOT EXISTS "hand_rate_top"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "hand_rate_bottom" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "hand_rate_side"   DOUBLE PRECISION;
COMMENT ON COLUMN "fab_piece"."hand_rate_top" IS
  'This piece''s own TOP-face rate at the hand bench. NULL falls back to hand_rate. The per-piece counterpart of fab_requirement.edge_rate_top; see scripts/0067 for why a hand-bench piece carries its own terms.';
COMMENT ON COLUMN "fab_piece"."hand_rate_bottom" IS
  'This piece''s own BOTTOM-face rate at the hand bench. NULL falls back to hand_rate.';
COMMENT ON COLUMN "fab_piece"."hand_rate_side" IS
  'This piece''s own SIDE-BAND rate at the hand bench. NULL falls back to hand_rate.';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fab_piece_hand_face_rate_ck'
  ) THEN
    ALTER TABLE "fab_piece"
      ADD CONSTRAINT "fab_piece_hand_face_rate_ck"
      CHECK (("hand_rate_top"    IS NULL OR "hand_rate_top"    >= 0)
         AND ("hand_rate_bottom" IS NULL OR "hand_rate_bottom" >= 0)
         AND ("hand_rate_side"   IS NULL OR "hand_rate_side"   >= 0))
      NOT VALID;
  END IF;
END $$;
COMMIT;
ALTER TABLE "fab_requirement" VALIDATE CONSTRAINT "fab_requirement_face_rate_ck";
ALTER TABLE "fab_piece"       VALIDATE CONSTRAINT "fab_piece_hand_face_rate_ck";
