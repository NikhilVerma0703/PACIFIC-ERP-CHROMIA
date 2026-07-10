-- Branch (Shop Floor / Office) on users. Safe to run repeatedly.
DO $$ BEGIN
  CREATE TYPE "Branch" AS ENUM ('SHOP_FLOOR', 'OFFICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "branch" "Branch" NOT NULL DEFAULT 'SHOP_FLOOR';
