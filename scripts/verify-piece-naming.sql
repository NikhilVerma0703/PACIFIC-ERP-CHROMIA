-- =====================================================================
-- verify-piece-naming.sql   (READ ONLY — nothing is written)
--
-- Checks that {projectCode}-{LETTER}-{n} is actually what the database
-- holds. Run after scripts/0054 and after sending a slab to the cutter.
--
--   psql "postgresql://postgres:postgres@localhost:5432/pacific_erp" \
--        -f scripts/verify-piece-naming.sql
-- =====================================================================

\echo '=== 1. Is the column there? (expect 1 row) ==='
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name = 'fab_requirement' AND column_name = 'row_letter';

\echo ''
\echo '=== 2. Rows and their letters, per project ==='
\echo '    Expect A, B, C ... in import order. NULL = imported before 0054.'
SELECT p.project_code,
       po.po_number,
       r.row_letter,
       r.piece_label            AS imported_label,
       r.length || ' x ' || r.width AS size_in,
       r.quantity               AS ordered
FROM   fab_requirement r
JOIN   fab_project p  ON p.id = r.project_id
LEFT   JOIN fab_po   po ON po.id = r.po_id
ORDER  BY p.project_code, r.created_at, r.id;

\echo ''
\echo '=== 3. NO TWO ROWS OF A PROJECT MAY SHARE A LETTER (expect 0 rows) ==='
SELECT project_id, row_letter, count(*)
FROM   fab_requirement
WHERE  row_letter IS NOT NULL
GROUP  BY 1, 2 HAVING count(*) > 1;

\echo ''
\echo '=== 4. The piece codes themselves ==='
\echo '    Expect PRJ-A-1, PRJ-A-2 ... then PRJ-B-1. Sorted by NUMBER,'
\echo '    not by string, because the codes are not zero-padded.'
SELECT pc.piece_code,
       r.row_letter,
       (regexp_match(pc.piece_code, '-([0-9]+)$'))[1]::int AS piece_no,
       r.length || ' x ' || r.width AS size_in,
       s.slab_code,
       pc.has_sink
FROM   fab_piece pc
JOIN   fab_project p        ON p.id = pc.project_id
LEFT   JOIN fab_requirement r ON r.id = pc.requirement_id
LEFT   JOIN fab_slab s      ON s.id = pc.slab_id
WHERE  pc.piece_code ~ '^.+-[A-Z]+-[0-9]+$'
ORDER  BY p.project_code,
          r.row_letter,
          (regexp_match(pc.piece_code, '-([0-9]+)$'))[1]::int;

\echo ''
\echo '=== 5. WHICH FORMAT IS EACH PIECE IN? ==='
\echo '    new     {project}-{LETTER}-{n}      <- what you want'
\echo '    legacy  {project}-{NNNN}            <- created before 0054, fine'
\echo '    other   anything else               <- investigate'
SELECT CASE
         WHEN piece_code ~ '^.+-[A-Z]+-[0-9]+$' THEN 'new'
         WHEN piece_code ~ '^.+-[0-9]{4}$'      THEN 'legacy'
         ELSE 'other'
       END AS format,
       count(*)
FROM   fab_piece GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 6. A ROW SPLIT ACROSS SLABS MUST NOT RESTART AT 1 ==='
\echo '    Expect one contiguous run per letter: min 1, max = count.'
\echo '    A gap or a repeat means numbering restarted somewhere.'
SELECT p.project_code,
       r.row_letter,
       count(DISTINCT s.slab_code)                                   AS slabs,
       count(*)                                                      AS pieces,
       min((regexp_match(pc.piece_code, '-([0-9]+)$'))[1]::int)      AS first_no,
       max((regexp_match(pc.piece_code, '-([0-9]+)$'))[1]::int)      AS last_no,
       CASE WHEN count(*) = max((regexp_match(pc.piece_code,'-([0-9]+)$'))[1]::int)
             AND min((regexp_match(pc.piece_code,'-([0-9]+)$'))[1]::int) = 1
            THEN 'OK' ELSE 'GAP OR RESTART - LOOK' END               AS verdict
FROM   fab_piece pc
JOIN   fab_project p          ON p.id = pc.project_id
JOIN   fab_requirement r      ON r.id = pc.requirement_id
LEFT   JOIN fab_slab s        ON s.id = pc.slab_id
WHERE  pc.piece_code ~ '^.+-[A-Z]+-[0-9]+$'
GROUP  BY 1, 2 ORDER BY 1, 2;

\echo ''
\echo '=== 7. Duplicate piece codes (expect 0 rows — the column is UNIQUE) ==='
SELECT piece_code, count(*) FROM fab_piece GROUP BY 1 HAVING count(*) > 1;
