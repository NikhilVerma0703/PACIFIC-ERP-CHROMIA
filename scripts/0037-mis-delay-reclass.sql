-- 0037: the delay-reclassification log — an audit trail for corrections the
-- Maintenance Manager applies to a production-logged delay type.
--
-- APPLY to Neon with
--   npx prisma db execute --file scripts/0037-mis-delay-reclass.sql --schema prisma/schema.prisma
-- Additive and idempotent: one new table, no existing table touched. Applied
-- 2026-08-14. Until it runs the feature is off — the reclass action reports
-- "not enabled yet" on 42P01 rather than half-applying anything.
--
-- WHY IT EXISTS. Production incharges fill the MIS hourly form, and they put the
-- stoppage under the wrong delay type — most often charging maintenance for what
-- was really a cleaning changeover, sometimes the reverse. Until now the only
-- remedy was downtime_response's DISPUTE, which deliberately records maintenance's
-- own figure BESIDE production's and changes nothing (see the header of
-- src/lib/downtimeResponse.ts). That is still right for "we disagree about how
-- long it was". It is the wrong shape for "those minutes are in the wrong bucket",
-- because the four buckets feed every downtime total, chart and KPI, and a
-- counter-claim nothing reads leaves all of them wrong. So this is a deliberate
-- second, stronger action, not a replacement: the reclass MOVES the minutes on the
-- mis row itself, and this table is the record of who moved them and why.
--
-- WHY A LOG AND NOT A FLAG ON mis. Three questions have to be answerable long
-- after the fact — what was it before, who changed it, and on what grounds — and
-- a boolean column answers none of them. Keeping the corrected figure on the mis
-- row means the scoreboard and every existing chart pick the correction up with no
-- code change; keeping the history here means the before-figure is still
-- reconstructible (current minutes minus the net of this log).
--
-- WHY IT MATTERS MORE THAN A NORMAL AUDIT TABLE. src/lib/shiftScore.ts computes
-- uptime from breakdown_delay_duration_mechanical_or_electrical_minutes and
-- powerout_delay_duration_minutes, and the ELECTRICAL and MECHANICAL incharges'
-- share of the monthly incentive pool is ranked on that uptime. Moving minutes OUT
-- of `breakdown` therefore raises the maintenance team's own payout. The manager is
-- editing an input to his own incentive. Every row here is append-only and carries
-- a required reason and a user id for exactly that reason; an undo is a new row
-- with from/to swapped, never a DELETE.

CREATE TABLE IF NOT EXISTS "mis_delay_reclass" (
  "id"      text PRIMARY KEY,
  -- The MIS hourly row corrected. No FK, matching downtime_response: mis is an
  -- Airtable mirror that gets rewritten by the importer, and a hard FK would
  -- have the importer fail on rows this table references.
  "mis_id"  text NOT NULL,
  -- DELAY_FIELDS keys from src/lib/downtimeShared.ts: process | cleaning |
  -- breakdown | powerout. Not a CHECK against a literal list, because the
  -- vocabulary belongs to that file — src/lib/delayReclass.ts validates it, and
  -- a fifth bucket must not need a migration to become loggable.
  "from_type" text NOT NULL,
  "to_type"   text NOT NULL,
  -- Whole minutes moved. double precision to match the four delay columns on
  -- mis that it moves between (all double precision); planReclass refuses
  -- anything non-integer, and all 3,754 mis rows carrying delay today hold whole
  -- minutes, so nothing legitimate is blocked by that.
  "minutes"   double precision NOT NULL,
  "reason"    text NOT NULL,
  "changed_by"         text,
  "changed_by_user_id" text,
  "changed_at" timestamp NOT NULL DEFAULT now(),

  -- The three rules that must hold even if someone writes this table by hand.
  -- delayReclass.ts enforces all of them with better messages; these are the
  -- floor, not the user-facing check. NOTE for whoever runs `prisma migrate
  -- diff`: Prisma does not model CHECK constraints, so it neither reports nor
  -- drops these — they simply do not appear in its output.
  CONSTRAINT "mis_delay_reclass_minutes_positive" CHECK ("minutes" > 0),
  CONSTRAINT "mis_delay_reclass_types_differ"     CHECK ("from_type" <> "to_type"),
  -- Same 4-char bar as the finance duplicate-override
  -- (src/app/api/office/finance/[...path]/route.ts). "ok" is not a reason.
  CONSTRAINT "mis_delay_reclass_reason_given"     CHECK (length(btrim("reason")) >= 4)
);

-- Index names are Prisma's own defaults (<table>_<column>_idx), NOT the shorter
-- names the older scripts here use. This table is modelled in schema.prisma, so a
-- different name would show up forever as an index rename in
--   npx prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ...
-- which is the command CLAUDE.md tells the next person to read before any push.
-- Three such renames are already noise in that output; this one does not join them.
--
-- The MIS page and the downtime log both fetch the reclass rows for the hours on
-- screen, keyed by mis_id, on every render. Without this it is a sequential scan
-- per page load.
CREATE INDEX IF NOT EXISTS "mis_delay_reclass_mis_id_idx" ON "mis_delay_reclass" ("mis_id");
-- "What did maintenance reclassify this month" — the review query that has to be
-- cheap, since it is the one an argument about a payout starts from. Plain ASC to
-- match what Prisma models; a b-tree scans backwards just as fast, so DESC here
-- would buy nothing and cost a permanent diff.
CREATE INDEX IF NOT EXISTS "mis_delay_reclass_changed_at_idx" ON "mis_delay_reclass" ("changed_at");
