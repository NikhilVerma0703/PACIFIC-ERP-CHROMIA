-- 0021 — OPTIONAL International Sales mail columns (Int'l Sales port, Phase 3).
-- ADDITIVE ONLY. Do NOT run automatically: the user applies this manually after review.
-- Unlike 0020 this is NOT a deploy blocker: none of these columns are in the
-- Prisma model — all access is raw SQL that degrades gracefully while they're
-- missing (mail no-ops, template editors fall back to defaults).
--
-- users.smtp_*            per-salesperson outbound mailbox (Sales -> Settings -> SMTP).
--                         Until applied (and configured) sendMail() logs + skips.
-- sales_config.mail_subjects / mail_bodies
--                         custom email templates (Sales -> Settings -> Mail texts);
--                         readers fall back to the built-in defaults.

ALTER TABLE users ADD COLUMN IF NOT EXISTS smtp_host text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS smtp_port integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS smtp_user text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS smtp_pass text;

ALTER TABLE sales_config ADD COLUMN IF NOT EXISTS mail_subjects jsonb NOT NULL DEFAULT '{}';
ALTER TABLE sales_config ADD COLUMN IF NOT EXISTS mail_bodies   jsonb NOT NULL DEFAULT '{}';
