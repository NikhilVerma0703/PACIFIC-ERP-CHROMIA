-- Batch-level Sales approval: '' batch = the whole design is hidden;
-- a real batch value = only that design+batch is hidden from Sales.
ALTER TABLE fg_sales_hidden_design ADD COLUMN IF NOT EXISTS batch TEXT NOT NULL DEFAULT '';
ALTER TABLE fg_sales_hidden_design DROP CONSTRAINT IF EXISTS fg_sales_hidden_design_pkey;
ALTER TABLE fg_sales_hidden_design ADD PRIMARY KEY (design, batch);
