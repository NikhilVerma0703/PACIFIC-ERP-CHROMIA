-- Sales approval allow-list: (design, batch) combos visible in the Sales
-- register. Combos absent from this table are PENDING (admin approves them
-- from the strip above the register). Seeded from stock at rollout.
CREATE TABLE IF NOT EXISTS fg_sales_approved_batch (
  design      TEXT NOT NULL,
  batch       TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (design, batch)
);
