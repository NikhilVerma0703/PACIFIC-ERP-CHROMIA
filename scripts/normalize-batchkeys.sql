-- One-time data fix: collapse inner whitespace and thousands-separator commas
-- in batch_key so that "1 194", "1,194" and "1194" become the same batch.
-- Runs across every public table that has a batch_key column (31 tables).
-- Safe to run more than once (idempotent).

-- 1) How many rows will change (run before):
--    SELECT table_name FROM information_schema.columns WHERE column_name='batch_key';

DO $$
DECLARE
  r record;
  n bigint;
  total bigint := 0;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'batch_key' AND table_schema = 'public'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I
         SET batch_key = regexp_replace(upper(batch_key), ''[[:space:],]+'', '''', ''g'')
       WHERE batch_key IS NOT NULL
         AND batch_key <> regexp_replace(upper(batch_key), ''[[:space:],]+'', '''', ''g'')',
      r.table_schema, r.table_name
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN
      RAISE NOTICE '% : % rows re-keyed', r.table_name, n;
    END IF;
  END LOOP;
  RAISE NOTICE 'Total rows re-keyed: %', total;
END $$;
