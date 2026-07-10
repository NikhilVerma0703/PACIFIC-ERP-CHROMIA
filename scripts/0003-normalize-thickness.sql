-- Canonicalise nominal slab thickness across all tables so "2cm", "2 cm",
-- "20mm", "2" all become "2 cm" (and likewise for 1.2 cm / 3 cm).
-- Idempotent; only touches recognised values, leaves anything else untouched.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('polish_entry','slab_thickness'),
    ('polish_qc','slab_thickness'),
    ('jot','thickness'),
    ('distributor','slab_thickness'),
    ('kreos','slab_thickness')
  ) AS t(tbl, col)
  LOOP
    EXECUTE format($f$
      UPDATE %I SET %I = CASE regexp_replace(lower(%I), '\s', '', 'g')
        WHEN '1.2cm' THEN '1.2 cm' WHEN '1.2' THEN '1.2 cm' WHEN '12mm' THEN '1.2 cm' WHEN '12' THEN '1.2 cm'
        WHEN '2cm'   THEN '2 cm'   WHEN '2'   THEN '2 cm'   WHEN '2.0cm' THEN '2 cm'   WHEN '2.0' THEN '2 cm' WHEN '20mm' THEN '2 cm' WHEN '20' THEN '2 cm'
        WHEN '3cm'   THEN '3 cm'   WHEN '3'   THEN '3 cm'   WHEN '3.0cm' THEN '3 cm'   WHEN '3.0' THEN '3 cm' WHEN '30mm' THEN '3 cm' WHEN '30' THEN '3 cm'
        ELSE %I END
      WHERE %I IS NOT NULL
    $f$, r.tbl, r.col, r.col, r.col, r.col);
  END LOOP;
END $$;
