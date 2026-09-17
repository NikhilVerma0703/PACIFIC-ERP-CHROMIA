-- 0087: what the Salesforce sync remembers between runs.
--
-- NUMBERED 0087, AND THE REQUEST LOOP BECOMES 0088. docs/salesforce-link/
-- DESIGN.md allocated 0084 and 0085 on 2026-09-14; the proforma work took both
-- the next day, boxes and stands took 0086, and this takes 0087. The design
-- document is right about everything except the numbers.
--
-- TWO TABLES, AND THE FIRST IS THE ONE THAT SAVES MONEY.
--
-- sf_stock_mirror is what Salesforce was last TOLD. Every run computes what it
-- would say, hashes it, and sends only the rows whose hash has moved. Without
-- it every run would push ~500 rows whether or not anything changed: at ten
-- runs an hour that is the whole self-imposed daily budget of 1,000 calls spent
-- repeating yesterday. (The org allows 160,000 a day and had used ~3,700 when
-- the administrator checked on 2026-09-16, so the budget is ours, not
-- Salesforce's, and he asked us to keep it fixed rather than grow into the
-- headroom.)
--
-- THE HASH IS A CHANGE DETECTOR, NOT A SECURITY PRIMITIVE. It decides whether
-- to spend an API call. A collision costs one stale row until the next real
-- change, which is why a short hash is the right trade and why this column is
-- text rather than anything fussier.
--
-- sf_sync_run is one row per run, so a failure is visible on the admin page
-- instead of only in a Vercel log nobody opens. `finished_at IS NULL` is the
-- lease: a partial unique index on it means two runs cannot overlap, and the
-- second answers "already running" rather than pushing the same rows twice.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0087-salesforce-sync-state.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- ADDITIVE AND IDEMPOTENT. Two new tables, nothing dropped, nothing back-filled.
-- A DRY RUN NEEDS NEITHER: the reader tolerates their absence and returns an
-- empty mirror, so the first dry read works whether or not this has been
-- applied. They are needed the moment anything is written.

CREATE TABLE IF NOT EXISTS sf_stock_mirror (
  -- The ERP_Key__c of the row in Salesforce: SLAB|QZ-ARVAWHITE-20,
  -- SAMPLE|<id>, FINISH|<id>, UNIT|<id>. Text(80) over there, so the same here.
  sf_key       TEXT PRIMARY KEY,
  -- The hash of the payload we last sent for it.
  payload_hash TEXT NOT NULL,
  pushed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The last per-record error Salesforce returned for this key, if any, so a
  -- row that keeps failing is visible rather than merely retried for ever.
  push_error   TEXT
);

COMMENT ON TABLE sf_stock_mirror IS
  'What Salesforce was last told, per ERP_Stock__c external id, so only changed rows cost an API call (2026-09-16).';

CREATE TABLE IF NOT EXISTS sf_sync_run (
  id           TEXT PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  phase        TEXT,
  dry          BOOLEAN NOT NULL DEFAULT FALSE,
  ok           BOOLEAN,
  -- The summary JSON the route returns, kept so the admin page can show the
  -- last run without re-running it.
  summary      JSONB,
  error        TEXT
);

-- ONE RUN AT A TIME. A partial unique index on a constant, restricted to rows
-- with no finish time: at most one unfinished run can exist. The second
-- invocation collides and answers "already running" rather than pushing the
-- same rows twice and doubling the call count.
CREATE UNIQUE INDEX IF NOT EXISTS sf_sync_run_one_open ON sf_sync_run ((1)) WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS sf_sync_run_started_idx ON sf_sync_run (started_at DESC);

COMMENT ON TABLE sf_sync_run IS
  'One row per Salesforce sync run. finished_at IS NULL is the lease that keeps two runs from overlapping.';
