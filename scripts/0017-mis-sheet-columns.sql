-- MIS shift sheet (paper Daily Production & Utilization Report parity).
-- Slabs/hour are ENTERED, not calculated: std = from cycle time, actual = counted.
ALTER TABLE mis
  ADD COLUMN IF NOT EXISTS slabs_per_hour_std double precision,
  ADD COLUMN IF NOT EXISTS slabs_per_hour_actual double precision,
  ADD COLUMN IF NOT EXISTS cycles_unloaded double precision,
  ADD COLUMN IF NOT EXISTS cycles_mixed double precision,
  ADD COLUMN IF NOT EXISTS thk_at_mixer_mm double precision,
  ADD COLUMN IF NOT EXISTS thk_at_press_mm double precision,
  ADD COLUMN IF NOT EXISTS area_of_problem text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS production_incharge_name text,
  ADD COLUMN IF NOT EXISTS maintenance_incharge_name text;
