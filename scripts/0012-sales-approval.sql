-- Sales-view approval: rows here are designs HIDDEN from the Sales register.
-- Empty table = everything approved (the default). Additive only.
CREATE TABLE IF NOT EXISTS fg_sales_hidden_design (
  design    TEXT PRIMARY KEY,
  hidden_by TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
