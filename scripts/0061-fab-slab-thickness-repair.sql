-- 0061 — REPAIR fab_slab.thickness FOR SLABS WHOSE QC TEXT WAS IN MILLIMETRES.
--
-- Idempotent. Safe to run twice. Touches only the rows it can prove are wrong.
--
-- ─────────────────────────────────────── WHAT WENT WRONG ────────────────────
-- /api/fab/supervisor/slab-assignment stored a slab's thickness as
--
--     parseFloat(polish_qc.slab_thickness) * 10
--
-- which is right only when the inspector typed centimetres. The slab entry
-- screen offers "3cm", "2cm", "12mm" and "7mm", so:
--
--     "3cm"   ->  3 * 10 =  30   correct
--     "2cm"   ->  2 * 10 =  20   correct
--     "12mm"  -> 12 * 10 = 120   WRONG, should be 12
--     "7mm"   ->  7 * 10 =  70   WRONG, should be 7
--
-- The route now calls parseThicknessMm (lib/fab/qcSlabQuery.ts), the same
-- function the QC slab search uses: a leading figure under 10 is centimetres and
-- is multiplied; 10 or over is already millimetres and is left alone.
--
-- This repairs the slabs written before that fix. It matters because thickness
-- is the key of the rate card — 2 cm is ₹230 a sink and ₹15 a running foot,
-- 3 cm is ₹300 and ₹20 — and it is what the slab-loss maths measures against.
--
-- ─────────────────────────────────────── WHY IT CANNOT OVER-REACH ───────────
-- A row is repaired ONLY when all three hold:
--
--   1. its QC text's leading figure is 10 or more, i.e. millimetres; and
--   2. the stored thickness is EXACTLY that figure times ten — the fingerprint
--      of the old formula and of nothing else; and
--   3. the correct answer differs from what is stored.
--
-- A slab somebody has already corrected by hand fails (2) and is left alone. A
-- centimetre slab fails (1) and is left alone. Running this after the code fix
-- finds nothing, which is the point.

BEGIN;

-- ── BEFORE: what is about to change, and what it will become ────────────────
-- Read this. If it lists more rows than you expect, stop and ROLLBACK.
SELECT s.id,
       s.slab_code,
       q.slab_thickness              AS qc_text,
       s.thickness                   AS stored_mm,
       substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric
                                     AS corrected_mm
FROM   fab_slab s
JOIN   polish_qc q ON q.id = s.pacific_qc_id
WHERE  q.slab_thickness ~ '^\s*[0-9]+(\.[0-9]+)?'
  AND  substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric >= 10
  AND  s.thickness IS NOT NULL
  AND  abs(s.thickness
           - substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric * 10) < 0.001
ORDER  BY s.slab_code;

-- ── THE REPAIR ──────────────────────────────────────────────────────────────
UPDATE fab_slab s
SET    thickness = substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric
FROM   polish_qc q
WHERE  q.id = s.pacific_qc_id
  AND  q.slab_thickness ~ '^\s*[0-9]+(\.[0-9]+)?'
  AND  substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric >= 10
  AND  s.thickness IS NOT NULL
  AND  abs(s.thickness
           - substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric * 10) < 0.001
  AND  s.thickness
       <> substring(btrim(q.slab_thickness) from '^[0-9]+(?:\.[0-9]+)?')::numeric;

-- ── AFTER: nothing outlandish is left ───────────────────────────────────────
-- Quartz here is 7, 12, 15, 20, 25 or 30 mm. Anything outside that was typed
-- oddly rather than parsed wrongly, and wants a human, not a script.
SELECT s.thickness AS mm, count(*) AS slabs
FROM   fab_slab s
WHERE  s.thickness IS NOT NULL
GROUP  BY s.thickness
ORDER  BY s.thickness;

COMMIT;
