-- 0035: give fin_vendor_entry somewhere to keep the reviewer's chosen tax heads.
--
-- APPLIED to Neon on 2026-08-10 with
--   npx prisma db execute --file scripts/0035-fin-vendor-entry-tax-lines.sql --schema prisma/schema.prisma
-- Additive, nullable, idempotent. fin_vendor_entry was empty (the vendor-invoice
-- path had never run), so this could not touch existing data.
--
-- WHY: api.py's /confirm-vendor stored the reviewer's chosen input-tax heads and
-- TDS head verbatim. The ported table kept only cgst/sgst/igst amounts and a TDS
-- *section*, and (tax, rate, eligible) does not identify one ledger — 9% CGST
-- matches both "INPUT CGST @ 9%" and "CGST @ 9% ON SERVICE". Re-deriving at
-- export time would overrule the human on the one statutory decision the vendor
-- panel exists to ask.
ALTER TABLE "fin_vendor_entry" ADD COLUMN IF NOT EXISTS "tax_lines_json" JSONB;
ALTER TABLE "fin_vendor_entry" ADD COLUMN IF NOT EXISTS "tds_ledger" TEXT;
