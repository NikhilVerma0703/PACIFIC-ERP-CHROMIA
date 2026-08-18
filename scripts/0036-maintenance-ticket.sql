-- 0036: a maintenance log anyone from incharge up can raise against, and that
-- maintenance answers.
--
-- APPLY to Neon with
--   npx prisma db execute --file scripts/0036-maintenance-ticket.sql --schema prisma/schema.prisma
-- Additive and idempotent: one new table, no existing table touched.
--
-- WHY. Maintenance could only ever be asked something THROUGH a downtime
-- incident: downtime_response hangs off an MIS hourly row, so a fault with no
-- stoppage behind it — a bearing starting to sing, a guard that will not latch,
-- a gauge reading wrong — had nowhere to be written down at all. Those are
-- exactly the ones worth catching before they become an incident.
--
-- WHY IT LINKS TO THE DOWNTIME ROW rather than replacing it. mis_id is nullable
-- and carries the incident a ticket came from, when it came from one. The two
-- are kept in step in both directions by src/lib/maintenanceLog.ts: answering
-- here writes the downtime response, and answering on the MIS card writes back
-- here. Making the log a separate island would have given maintenance two
-- inboxes and production two places to look for the same answer.
--
-- The status vocabulary is downtime_response's, deliberately — DOWNTIME_STATUSES
-- in src/lib/downtimeResponse.ts. Two spellings of "Resolved" across two screens
-- is how a fault ends up looking closed on one and open on the other.
CREATE TABLE IF NOT EXISTS "maintenance_ticket" (
  "id"           text PRIMARY KEY,
  -- Human reference. Printed, spoken across a noisy floor, and written on a
  -- whiteboard, so it is short and sequential rather than the cuid.
  "ref"          text NOT NULL UNIQUE,
  "title"        text NOT NULL,
  "detail"       text,
  -- Free text, not an enum: the machine list changes faster than a migration
  -- can, and "the compressor line near Kreos" is a legitimate answer.
  "area"         text,
  "priority"     text NOT NULL DEFAULT 'Normal',
  "status"       text NOT NULL DEFAULT 'Pending',
  "raised_by"    text,
  "raised_at"    timestamp NOT NULL DEFAULT now(),
  -- The downtime incident this came from. NULL for a standalone report, which
  -- is the case the table exists for.
  "mis_id"       text,
  "response"     text,
  "responded_by" text,
  "responded_at" timestamp,
  "closed_at"    timestamp,
  "updated_at"   timestamp NOT NULL DEFAULT now()
);

-- The open queue is the page's default view and the only query that runs on
-- every load.
CREATE INDEX IF NOT EXISTS "maintenance_ticket_status_idx" ON "maintenance_ticket" ("status");
-- The MIS card looks tickets up by incident to show the reference; without this
-- it is a sequential scan on every downtime row rendered.
CREATE INDEX IF NOT EXISTS "maintenance_ticket_mis_idx" ON "maintenance_ticket" ("mis_id");
-- Newest first is the list order.
CREATE INDEX IF NOT EXISTS "maintenance_ticket_raised_idx" ON "maintenance_ticket" ("raised_at" DESC);
