-- Cross-instance login throttle (10 failed attempts per email+IP per 15 min).
-- Additive only.
CREATE TABLE IF NOT EXISTS login_attempt (
  key      TEXT PRIMARY KEY,          -- "<email>|<ip>"
  n        INT  NOT NULL DEFAULT 1,
  first_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
