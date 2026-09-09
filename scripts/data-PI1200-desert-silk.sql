-- ============================================================================
-- DATA LOAD  ·  PI SAL-ORD/25-26/01200  ·  Desert Silk, 1st container, Kerasom
-- ============================================================================
-- THIS IS NOT A SCHEMA MIGRATION. It is deliberately NOT numbered into the
-- 00xx sequence, because that sequence is the schema of record and your DBA
-- replays it. This file inserts one customer order and nothing else. It can be
-- run on local now and on Neon whenever this order is real there; it never
-- needs to be replayed as part of a rebuild.
--
-- SOURCE DOCUMENT
--   Proforma Invoice  PI - SAL-ORD/25-26/01200,  dated 16-May-26
--   Buyer PO Ref      1612104578
--   Consignee         Kerasom, Ambachten 4, 5711 LC Someren, Netherlands
--   Terms             FOB Chennai Port, 100% CAD, Rotterdam
--   Totals            3,808 pcs  ·  544.681 SQMT  ·  USD 41,706.08
--
-- All three of those totals were recomputed line by line and reconcile exactly.
-- Four lines carry cent-level rounding in the customer's own sheet (103x11,
-- 101x25, 151x25 by 3-4 cents; 220x25 overstates area by 0.100 SQMT = USD 7.50).
-- Nothing was corrected here — the invoice is the customer's document and this
-- load reproduces it as sent.
--
-- ─────────────────────── CENTIMETRES BECOME INCHES ──────────────────────────
-- The PI is in CM. fab_requirement.length/width are INCHES — every downstream
-- figure depends on it: sqft_per_piece is L*W/144, and lib/fab/pricing.ts turns
-- the perimeter into RUNNING FEET at Rs15 (2 cm) / Rs20 (3 cm). Storing 103
-- where 40.5512 belongs would inflate every edge charge by 2.54x and would look
-- entirely plausible on screen.
--
-- So the inches are stored and THE CENTIMETRES ARE KEPT IN TWO PLACES that no
-- calculation reads: piece_label holds the customer's own description verbatim
-- ("DS - Thresholds (103 x 3)"), and description holds the cm size with the PI's
-- own rate and extended amount. The floor reads cm; the maths reads inches;
-- neither has to trust the other.
--
-- thickness is 20 (MM) on every row — the PI is 2CM throughout. That is what
-- puts these rows on the Rs15/ft edge and Rs230 sink side of the rate card.
--
-- ─────────────────────── WHAT IS DELIBERATELY LEFT NULL ─────────────────────
-- finished_edges, edge_faces, edges_top/bottom/side   — HE PICKS THE SIDES.
--   NULL is "nobody has chosen yet", which is a different and deliberate thing
--   from the empty string ("asked, this face gets nothing"). Writing a guess
--   here would put a priced decision in the supervisor's mouth.
-- sink_quantity — NULL is "the supervisor has not looked at this row",
--   matching what the PO importer does. It is not 0, which means "he looked
--   and said none".
-- edge_rate, pricing_mode, edge_total_override — the rate card serves until
--   somebody says otherwise.
--
-- ─────────────────────── THE 220 x 15 LINE APPEARS TWICE ────────────────────
-- Rows A..AJ follow the PI's line order exactly, and "DS - Window Sills(220 x
-- 15)" is on it twice — 35 pcs each, identical. Confirmed with the owner as two
-- separate rows, so they are rows V and AJ. Merging them would have broken the
-- 3,808 count; dropping one would have broken it by 35 pcs / USD 866.25.
--
-- ─────────────────────── IDEMPOTENT, AND SAFE TO RE-RUN ─────────────────────
-- Every insert is guarded. Re-running changes nothing and errors on nothing.
-- There is no UPDATE and no DELETE anywhere below: if a row is already there,
-- it is left exactly as it is, edges and all. That means this script can never
-- undo a supervisor's edge selection by being run a second time.
--
-- IDs are literal and readable ('pi1200', 'pi1200-po', 'pi1200-r-A'). The id
-- columns are plain TEXT with no database default — @default(cuid()) is applied
-- by Prisma in the application, not by Postgres — so raw SQL must supply them.
--
-- REQUIRES scripts/0068-dimension-unit.sql FIRST. This load writes dim_unit
-- = 'CM' on all 36 rows, which is the whole reason the floor reads "103 x 3 cm"
-- instead of "40.5512 x 1.1811". Without 0068 the column does not exist and
-- this script fails cleanly inside its transaction, changing nothing.
--
-- RUN 0068 FIRST, THEN THIS:
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/0068-dimension-unit.sql
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file scripts/data-PI1200-desert-silk.sql
-- ============================================================================

BEGIN;

-- ── 1 · the project ─────────────────────────────────────────────────────────
-- kind = 'PO' (not SAMPLE), status PLANNING. number_of_pieces is the PI total.
INSERT INTO "fab_project"
  (id, project_code, kind, customer_name, status, number_of_pieces, remarks, created_at)
VALUES
  ('pi1200', 'PI1200', 'PO', 'Kerasom', 'PLANNING', 3808,
   'Desert Silk, 1st container. PI SAL-ORD/25-26/01200 dated 16-May-26. Buyer PO 1612104578. Kerasom, Someren NL. FOB Chennai, 100% CAD, discharge Rotterdam. 3,808 pcs / 544.681 SQMT / USD 41,706.08. Sizes on the PI are CENTIMETRES; stored here in inches.',
   CURRENT_TIMESTAMP)
ON CONFLICT (project_code) DO NOTHING;

-- ── 2 · the purchase order ──────────────────────────────────────────────────
-- po_number is the BUYER's reference, which is what the customer will quote
-- back at you, not our own invoice number. The invoice number lives in the
-- project remarks above.
--
-- pdf_imported_at IS SET ON PURPOSE. It is the flag the importer checks, and
-- setting it stops anyone uploading this PI at /fab/manager and getting a 422:
-- src/lib/fab/poParser.ts reads a two-page US packing list in inches and sqft,
-- and this document is a one-page proforma invoice in cm and SQMT. The rows are
-- already loaded below; there is nothing left for the importer to do.
INSERT INTO "fab_po"
  (id, project_id, po_number, pdf_file_name, pdf_imported_at, created_at)
SELECT 'pi1200-po', p.id, '1612104578',
       'Dessert Silk  1st container PI 1200 PO 1612104578 1.pdf',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "fab_project" p
 WHERE p.project_code = 'PI1200'
ON CONFLICT (project_id, po_number) DO NOTHING;

-- ── 3 · the 36 ordered rows ─────────────────────────────────────────────────
-- slab_code = 'UNASSIGNED' — the column is NOT NULL and a purchase order has no
-- slab; the supervisor chooses one later. Same constant the importer writes
-- (PO_REQUIREMENT_SLAB_CODE in src/lib/fab/poParser.ts).
--
-- Routing flags match deriveRoutingFlags({ sinkQuantity: null }) exactly:
-- polish yes, sink no, fabrication no. Do not hand-edit these to something
-- else — the release path recomputes from the same function and a disagreement
-- would route pieces to a station nobody expects.
--
-- row_letter is assigned ONCE, here, and must never be recomputed: it is half
-- of the piece code {projectCode}-{LETTER}-{n} that gets written on stone, and
-- a label on stone cannot be migrated. A..Z then AA..AJ, bijective base-26,
-- which is what src/lib/fab/pieceNaming.ts produces for 36 rows.
INSERT INTO "fab_requirement"
  (id, project_id, po_id, row_letter, piece_label, description,
   slab_code, length, width, dim_unit, thickness, quantity, shape_type,
   sqft_per_piece, total_sqft,
   sink_required, fabrication_required, polish_required,
   sink_cuts, faucet_count, joint_count, radius_corners,
   status, created_at)
SELECT v.id, p.id, 'pi1200-po', v.row_letter, v.piece_label, v.description,
       'UNASSIGNED', v.length_in, v.width_in, 'CM', 20, v.quantity, 'RECTANGLE',
       v.sqft_per_piece, v.total_sqft,
       false, false, true,
       0, 0, 0, 0,
       'PENDING', CURRENT_TIMESTAMP
  FROM "fab_project" p
  CROSS JOIN (VALUES
  ('pi1200-r-A', 'A', 'DS - ROLSTOELDORPEL (120X 12)', '120 x 12 cm | USD 105.00/SQMT | 18.000 SQMT | USD 1,890.00', 47.2441, 4.7244, 125, 1.55, 193.75),
  ('pi1200-r-B', 'B', 'DS - SCHUIN (120 X 7)', '120 x 7 cm | USD 105.00/SQMT | 10.500 SQMT | USD 1,102.50', 47.2441, 2.7559, 125, 0.9, 113.02),
  ('pi1200-r-C', 'C', 'DS - Thresholds (103 x 3)', '103 x 3 cm | USD 75.00/SQMT | 15.450 SQMT | USD 1,158.75', 40.5512, 1.1811, 500, 0.33, 166.3),
  ('pi1200-r-D', 'D', 'DS - Thresholds (103 x 4)', '103 x 4 cm | USD 75.00/SQMT | 8.200 SQMT | USD 615.00', 40.5512, 1.5748, 200, 0.44, 88.69),
  ('pi1200-r-E', 'E', 'DS - Thresholds (103 x 5)', '103 x 5 cm | USD 75.00/SQMT | 7.700 SQMT | USD 577.50', 40.5512, 1.9685, 150, 0.55, 83.15),
  ('pi1200-r-F', 'F', 'DS - Thresholds (103 x 6)', '103 x 6 cm | USD 75.00/SQMT | 15.400 SQMT | USD 1,155.00', 40.5512, 2.3622, 250, 0.67, 166.3),
  ('pi1200-r-G', 'G', 'DS - Thresholds (103 x 7)', '103 x 7 cm | USD 75.00/SQMT | 27.000 SQMT | USD 2,025.00', 40.5512, 2.7559, 375, 0.78, 291.03),
  ('pi1200-r-H', 'H', 'DS - Thresholds (103 x 8)', '103 x 8 cm | USD 75.00/SQMT | 14.400 SQMT | USD 1,080.00', 40.5512, 3.1496, 175, 0.89, 155.22),
  ('pi1200-r-I', 'I', 'DS - Thresholds (103 x 9)', '103 x 9 cm | USD 75.00/SQMT | 13.905 SQMT | USD 1,042.88', 40.5512, 3.5433, 150, 1.0, 149.67),
  ('pi1200-r-J', 'J', 'DS - Thresholds (103 x 10)', '103 x 10 cm | USD 75.00/SQMT | 15.450 SQMT | USD 1,158.75', 40.5512, 3.937, 150, 1.11, 166.3),
  ('pi1200-r-K', 'K', 'DS - Thresholds (103 x 11)', '103 x 11 cm | USD 75.00/SQMT | 14.163 SQMT | USD 1,062.19', 40.5512, 4.3307, 125, 1.22, 152.44),
  ('pi1200-r-L', 'L', 'DS - Thresholds (103 x 11.5)', '103 x 11.5 cm | USD 75.00/SQMT | 14.806 SQMT | USD 1,110.47', 40.5512, 4.5276, 125, 1.27, 159.37),
  ('pi1200-r-M', 'M', 'DS - Thresholds (103 x 12)', '103 x 12 cm | USD 75.00/SQMT | 15.450 SQMT | USD 1,158.75', 40.5512, 4.7244, 125, 1.33, 166.3),
  ('pi1200-r-N', 'N', 'DS - Thresholds (103 x 13)', '103 x 13 cm | USD 75.00/SQMT | 13.390 SQMT | USD 1,004.25', 40.5512, 5.1181, 100, 1.44, 144.13),
  ('pi1200-r-O', 'O', 'DS - Thresholds (103 x 14)', '103 x 14 cm | USD 75.00/SQMT | 14.420 SQMT | USD 1,081.50', 40.5512, 5.5118, 100, 1.55, 155.22),
  ('pi1200-r-P', 'P', 'DS - Window Sills(88 x 19.5)', '88 x 19.5 cm | USD 75.00/SQMT | 18.000 SQMT | USD 1,350.00', 34.6457, 7.6772, 105, 1.85, 193.95),
  ('pi1200-r-Q', 'Q', 'DS - Window Sills(101 x 19.5)', '101 x 19.5 cm | USD 75.00/SQMT | 27.600 SQMT | USD 2,070.00', 39.7638, 7.6772, 140, 2.12, 296.79),
  ('pi1200-r-R', 'R', 'DS - Window Sills(126 x 19.5)', '126 x 19.5 cm | USD 75.00/SQMT | 34.400 SQMT | USD 2,580.00', 49.6063, 7.6772, 140, 2.64, 370.26),
  ('pi1200-r-S', 'S', 'DS - Window Sills(151 x 19.5)', '151 x 19.5 cm | USD 75.00/SQMT | 30.900 SQMT | USD 2,317.50', 59.4488, 7.6772, 105, 3.17, 332.79),
  ('pi1200-r-T', 'T', 'DS - Window Sills(176 x 19.5)', '176 x 19.5 cm | USD 75.00/SQMT | 12.012 SQMT | USD 900.90', 69.2913, 7.6772, 35, 3.69, 129.3),
  ('pi1200-r-U', 'U', 'DS - Window Sills(220 x 19.5)', '220 x 19.5 cm | USD 75.00/SQMT | 15.015 SQMT | USD 1,126.13', 86.6142, 7.6772, 35, 4.62, 161.62),
  ('pi1200-r-V', 'V', 'DS - Window Sills(220 x 15)', '220 x 15 cm | USD 75.00/SQMT | 11.550 SQMT | USD 866.25', 86.6142, 5.9055, 35, 3.55, 124.32),
  ('pi1200-r-W', 'W', 'DS - Window Sills(88 x 25)', '88 x 25 cm | USD 75.00/SQMT | 7.700 SQMT | USD 577.50', 34.6457, 9.8425, 35, 2.37, 82.88),
  ('pi1200-r-X', 'X', 'DS - Window Sills(101 x 25)', '101 x 25 cm | USD 75.00/SQMT | 8.838 SQMT | USD 662.81', 39.7638, 9.8425, 35, 2.72, 95.13),
  ('pi1200-r-Y', 'Y', 'DS - Window Sills(126 x 25)', '126 x 25 cm | USD 75.00/SQMT | 11.025 SQMT | USD 826.88', 49.6063, 9.8425, 35, 3.39, 118.67),
  ('pi1200-r-Z', 'Z', 'DS - Window Sills(151 x 25)', '151 x 25 cm | USD 75.00/SQMT | 13.213 SQMT | USD 990.94', 59.4488, 9.8425, 35, 4.06, 142.22),
  ('pi1200-r-AA', 'AA', 'DS - Window Sills(176 x 25)', '176 x 25 cm | USD 75.00/SQMT | 15.400 SQMT | USD 1,155.00', 69.2913, 9.8425, 35, 4.74, 165.76),
  ('pi1200-r-AB', 'AB', 'DS - Window Sills(220 x 25)', '220 x 25 cm | USD 75.00/SQMT | 27.600 SQMT | USD 2,070.00', 86.6142, 9.8425, 50, 5.92, 296.01),
  ('pi1200-r-AC', 'AC', 'DS - Window Sills(88 x 30)', '88 x 30 cm | USD 75.00/SQMT | 9.240 SQMT | USD 693.00', 34.6457, 11.811, 35, 2.84, 99.46),
  ('pi1200-r-AD', 'AD', 'DS - Window Sills(101 x 30)', '101 x 30 cm | USD 75.00/SQMT | 10.605 SQMT | USD 795.38', 39.7638, 11.811, 35, 3.26, 114.15),
  ('pi1200-r-AE', 'AE', 'DS - Window Sills(126 x 30)', '126 x 30 cm | USD 75.00/SQMT | 13.230 SQMT | USD 992.25', 49.6063, 11.811, 35, 4.07, 142.41),
  ('pi1200-r-AF', 'AF', 'DS - Window Sills(151 x 30)', '151 x 30 cm | USD 75.00/SQMT | 13.590 SQMT | USD 1,019.25', 59.4488, 11.811, 30, 4.88, 146.28),
  ('pi1200-r-AG', 'AG', 'DS - Window Sills(220 x 30)', '220 x 30 cm | USD 75.00/SQMT | 15.180 SQMT | USD 1,138.50', 86.6142, 11.811, 23, 7.1, 163.4),
  ('pi1200-r-AH', 'AH', 'DS - Window Sills(220 x 40)', '220 x 40 cm | USD 75.00/SQMT | 13.200 SQMT | USD 990.00', 86.6142, 15.748, 15, 9.47, 142.08),
  ('pi1200-r-AI', 'AI', 'DS - Window Sills(220 x 60)', '220 x 60 cm | USD 75.00/SQMT | 6.600 SQMT | USD 495.00', 86.6142, 23.622, 5, 14.21, 71.04),
  ('pi1200-r-AJ', 'AJ', 'DS - Window Sills(220 x 15)', '220 x 15 cm | USD 75.00/SQMT | 11.550 SQMT | USD 866.25', 86.6142, 5.9055, 35, 3.55, 124.32)
  ) AS v(id, row_letter, piece_label, description,
         length_in, width_in, quantity, sqft_per_piece, total_sqft)
 WHERE p.project_code = 'PI1200'
   AND NOT EXISTS (
     SELECT 1 FROM "fab_requirement" r
      WHERE r.project_id = p.id AND r.row_letter = v.row_letter
   );

COMMIT;

-- ============================================================================
-- VERIFY  (read-only — run these after, and read them)
-- ============================================================================
-- 1 · the row count, the piece count, and the area
--
--   SELECT count(*) AS rows, sum(quantity) AS pieces,
--          round(sum(total_sqft)::numeric, 2) AS sqft
--     FROM fab_requirement r JOIN fab_project p ON p.id = r.project_id
--    WHERE p.project_code = 'PI1200';
--
--   EXPECT  rows = 36,  pieces = 3808,  sqft ~ 5863.73
--           (5,863.73 sqft = 544.76 m2, which is the PI's 544.681 SQMT)
--
-- 2 · every letter present exactly once, A..Z then AA..AJ
--
--   SELECT row_letter, piece_label, length, width, quantity
--     FROM fab_requirement r JOIN fab_project p ON p.id = r.project_id
--    WHERE p.project_code = 'PI1200'
--    ORDER BY length(row_letter), row_letter;
--
-- 3 · nothing has been edged yet — every one of these must be NULL
--
--   SELECT count(*) AS unchosen
--     FROM fab_requirement r JOIN fab_project p ON p.id = r.project_id
--    WHERE p.project_code = 'PI1200'
--      AND r.finished_edges IS NULL AND r.edges_top IS NULL
--      AND r.edges_bottom IS NULL AND r.edges_side IS NULL;
--
--   EXPECT 36 on a first run. A smaller number after somebody has started
--   picking sides is correct and is not a fault.
--
-- 4 · the two 220 x 15 rows are both there and are distinct
--
--   SELECT row_letter, quantity FROM fab_requirement r
--     JOIN fab_project p ON p.id = r.project_id
--    WHERE p.project_code = 'PI1200' AND r.piece_label LIKE '%220 x 15%';
--
--   EXPECT two rows: V and AJ, 35 each.
--
-- 5 - the display unit is set, and the stored numbers are still inches
--
--   SELECT row_letter, piece_label, dim_unit,
--          round(length::numeric, 4) AS length_in,
--          round((length * 2.54)::numeric, 2) AS shows_as_cm
--     FROM fab_requirement r JOIN fab_project p ON p.id = r.project_id
--    WHERE p.project_code = 'PI1200' AND row_letter = 'C';
--
--   EXPECT  C | DS - Thresholds (103 x 3) | CM | 40.5512 | 103.00
--           The column holds INCHES. The screen shows CM. That is the design.
-- ============================================================================
