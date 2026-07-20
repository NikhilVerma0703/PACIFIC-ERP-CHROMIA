/**
 * Phase 6 — Airtable -> Postgres sync worker (one-way, upsert).
 *
 * For the operational "hot" tables, pages through Airtable and UPSERTS each
 * record by airtableId, so new and edited records are reflected in Postgres
 * without clearing existing rows. Safe to run repeatedly on a schedule during
 * the parallel-run phase (Option A). After each run it refreshes the batch
 * wastage rollup so derived data stays current.
 *
 * Usage:
 *   npm run sync                 # sync the hot tables
 *   npm run sync -- --all        # sync all 46 tables
 *   npm run sync -- --table=Press
 *
 * Requires AIRTABLE_PAT, AIRTABLE_BASE_ID, DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { fetchPage } from "../src/lib/airtable";
import { normalizeBatch } from "../src/lib/normalizeBatch";

const prisma = new PrismaClient();

type FieldDef = { prismaField: string; kind: string };
type TableDef = { model: string; tableName: string; batchFieldId: string | null; fields: Record<string, FieldDef> };
const fieldmap: Record<string, TableDef> = JSON.parse(
  readFileSync(join(process.cwd(), "scripts", "fieldmap.json"), "utf8")
);

const HOT = ["Mixer Cycle", "Press", "Polish Entry", "Polish QC", "MIS", "SILO", "Slab Summary", "Production Report", "Batch Wastage"];

const args = process.argv.slice(2);
const onlyTable = args.find((a) => a.startsWith("--table="))?.split("=")[1];
const all = args.includes("--all");

const delegate = (model: string) =>
  (prisma as unknown as Record<string, { upsert: Function }>)[model[0].toLowerCase() + model.slice(1)];

function coerce(kind: string, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  switch (kind) {
    case "scalar": return String(v);
    case "number": case "int": { const n = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(n) ? (kind === "int" ? Math.trunc(n) : n) : undefined; }
    case "bool": return v === true || v === "true";
    case "date": { const d = new Date(String(v)); return isNaN(d.getTime()) ? undefined : d; }
    case "multiselect": case "link": return Array.isArray(v) ? v.map(String) : [String(v)];
    default: return v;
  }
}

function toRow(rec: { id: string; fields: Record<string, unknown> }, def: TableDef): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [fieldId, fd] of Object.entries(def.fields)) {
    const val = coerce(fd.kind, rec.fields[fieldId]);
    if (val !== undefined) row[fd.prismaField] = val;
  }
  if (def.batchFieldId) {
    const b = normalizeBatch(rec.fields[def.batchFieldId]);
    if (b) row.batchKey = b;
  }
  return row;
}

// Same rule as src/lib/airtableSync.ts (keep in sync): mixerCycleIds on the line-head
// tables is ERP-owned — the confirm-and-split writes it, so no Airtable re-sync may
// overwrite it. Still flows in on CREATE (a first-time mirror keeps historical links).
const ERP_OWNED_FIELDS: Record<string, string[]> = {
  Distributor: ["mixerCycleIds"],
  Kreos: ["mixerCycleIds"],
};

async function syncTable(tableId: string, def: TableDef) {
  let offset: string | undefined;
  let upserted = 0;
  do {
    const page = await fetchPage(tableId, offset);
    for (const rec of page.records) {
      const data = toRow(rec, def);
      const update = { ...data };
      for (const f of ERP_OWNED_FIELDS[def.model] ?? []) delete update[f];
      await delegate(def.model).upsert({
        where: { airtableId: rec.id },
        create: { airtableId: rec.id, ...data },
        update,
      });
      upserted++;
    }
    offset = page.offset;
  } while (offset);
  console.log(`↻ ${def.tableName} — ${upserted} upserted`);
  return upserted;
}

async function main() {
  const entries = Object.entries(fieldmap).filter(([, def]) =>
    onlyTable ? def.model === onlyTable || def.tableName === onlyTable : all || HOT.includes(def.tableName)
  );
  console.log(`Syncing ${entries.length} table(s) from Airtable -> Postgres…`);
  let total = 0;
  for (const [tableId, def] of entries) total += await syncTable(tableId, def);
  console.log(`\nSYNC COMPLETE — ${total} records upserted.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nSync error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
