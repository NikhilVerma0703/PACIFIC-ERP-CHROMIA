-- Consumables module: 8 new tables + 2 enum types, namespaced consumable_*.
-- Fully additive; column names stay camelCase (module convention).
DO $$ BEGIN
  CREATE TYPE "DirectMaterialStatus" AS ENUM ('ACTIVE','INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ItemCategory" AS ENUM ('DIRECT_MATERIAL','PRODUCTION_CONSUMABLE','POLISHING_CONSUMABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS consumable_department (
  id text PRIMARY KEY,
  name text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT consumable_department_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS consumable_direct_material (
  id text PRIMARY KEY,
  name text NOT NULL,
  variant text,
  unit text NOT NULL,
  "dailyConsumption" double precision NOT NULL DEFAULT 0,
  status "DirectMaterialStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consumable_production (
  id text PRIMARY KEY,
  name text NOT NULL,
  unit text NOT NULL,
  "dailyConsumption" double precision NOT NULL DEFAULT 0,
  "currentStock" double precision NOT NULL DEFAULT 0,
  "minStock" double precision NOT NULL DEFAULT 0,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "departmentId" text NOT NULL REFERENCES consumable_department(id)
);

CREATE TABLE IF NOT EXISTS consumable_polishing (
  id text PRIMARY KEY,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'PCS',
  "dailyConsumption" double precision NOT NULL DEFAULT 0,
  "currentStock" double precision NOT NULL DEFAULT 0,
  "minStock" double precision NOT NULL DEFAULT 0,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "departmentId" text NOT NULL REFERENCES consumable_department(id)
);

CREATE TABLE IF NOT EXISTS consumable_inventory_stock (
  id text PRIMARY KEY,
  "itemName" text NOT NULL,
  category "ItemCategory" NOT NULL,
  unit text NOT NULL,
  "currentStock" double precision NOT NULL DEFAULT 0,
  "minStock" double precision NOT NULL DEFAULT 0,
  "maxStock" double precision NOT NULL DEFAULT 0,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consumable_film_roll (
  id text PRIMARY KEY,
  "rollNumber" text NOT NULL,
  "filmType" text NOT NULL,
  machine text NOT NULL,
  "initialWeight" double precision NOT NULL,
  "layersUsed" integer NOT NULL DEFAULT 0,
  "weightPerLayer" double precision NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT consumable_film_roll_rollnumber_key UNIQUE ("rollNumber")
);

CREATE TABLE IF NOT EXISTS consumable_consumption_entry (
  id text PRIMARY KEY,
  date timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "itemName" text NOT NULL,
  quantity double precision NOT NULL,
  unit text NOT NULL,
  remarks text,
  "departmentId" text NOT NULL REFERENCES consumable_department(id),
  "inventoryStockId" text REFERENCES consumable_inventory_stock(id),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consumable_inventory_entry (
  id text PRIMARY KEY,
  date timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  quantity double precision NOT NULL,
  unit text NOT NULL,
  "inventoryStockId" text NOT NULL REFERENCES consumable_inventory_stock(id),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS consumable_consumption_dept_idx ON consumable_consumption_entry ("departmentId", date);
CREATE INDEX IF NOT EXISTS consumable_consumption_stock_idx ON consumable_consumption_entry ("inventoryStockId");
CREATE INDEX IF NOT EXISTS consumable_inventory_entry_stock_idx ON consumable_inventory_entry ("inventoryStockId");
