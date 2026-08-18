/**
 * Phase 2 — Airtable -> Postgres importer (resumable).
 *
 * Reads scripts/fieldmap.json, pulls every record of every table from Airtable
 * (by stable field ID), coerces each field to its Prisma type, and loads into
 * Postgres keyed on `airtableId`.
 *
 * Resumable: progress is saved to .import-state.json after every page, so an
 * interrupted run continues where it left off. Set IMPORT_BUDGET_MS to run in
 * time-boxed chunks (used when the runner caps command duration); unset = run
 * to completion.
 *
 * Usage:
 *   npm run import                 # import all 46 tables to completion
 *   npm run import -- --table=Press
 *   npm run import -- --append     # don't clear tables first
 *
 * Requires AIRTABLE_PAT and AIRTABLE_BASE_ID in the environment.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { fetchPage } from "../src/lib/airtable";
import { normalizeBatch } from "../src/lib/normalizeBatch";

const prisma = new PrismaClient();

type FieldDef = { airtableName: string; prismaField: string; column: string; airtableType: string; kind: string };
type TableDef = { model: string; tableName: string; tableMap: string; primaryFieldId: string | null; batchFieldId: string | null; fields: Record<string, FieldDef> };

const ROOT = process.cwd();
const fieldmap: Record<string, TableDef> = JSON.parse(readFileSync(join(ROOT, "scripts", "fieldmap.json"), "utf8"));
const STATE_FILE = join(ROOT, ".import-state.json");

const args = process.argv.slice(2);
const onlyTable = args.find((a) => a.startsWith("--table="))?.split("=")[1];
const append = args.includes("--append");
const BUDGET = parseInt(process.env.IMPORT_BUDGET_MS || "0", 10); // 0 = unlimited
const startedAt = Date.now();
const outOfTime = () => BUDGET > 0 && Date.now() - startedAt > BUDGET;

interface State { done: string[]; cleared: string[]; current?: { tableId: string; offset?: string }; counts: Record<string, number>; }
function loadState(): State {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return { done: [], cleared: [], counts: {} };
}
function saveState(s: State) { writeFileSync(STATE_FILE, JSON.stringify(s)); }

const delegate = (model: string) =>
  (prisma as unknown as Record<string, { createMany: Function; deleteMany: Function }>)[model[0].toLowerCase() + model.slice(1)];

function coerce(kind: string, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  switch (kind) {
    case "scalar": return String(v);
    case "number": case "int": {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? (kind === "int" ? Math.trunc(n) : n) : undefined;
    }
    case "bool": return v === true || v === "true";
    case "date": { const d = new Date(String(v)); return isNaN(d.getTime()) ? undefined : d; }
    // Trimmed: an Airtable option with a stray trailing space ("MATERIAL DELAY ") is a
    // DIFFERENT string, and option lists are built from the DISTINCT values in the column
    // (lib/tables.ts), so it renders as a second identical-looking chip and splits the
    // same value across both. Empty strings dropped for the same reason; record IDs never
    // contain whitespace, so `link` is unaffected. This was one of three copies of the
    // rule; the sync engine and its CLI were removed 2026-07-25, leaving this one.
    case "multiselect": case "link": return (Array.isArray(v) ? v.map(String) : [String(v)]).map((x) => x.trim()).filter(Boolean);
    case "json": return v;
    default: return String(v);
  }
}

function toRow(rec: { id: string; fields: Record<string, unknown> }, def: TableDef): Record<string, unknown> {
  const row: Record<string, unknown> = { airtableId: rec.id };
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

async function main() {
  const state = loadState();
  const entries = Object.entries(fieldmap).filter(
    ([, def]) => !onlyTable || def.model === onlyTable || def.tableName === onlyTable
  );

  for (const [tableId, def] of entries) {
    if (state.done.includes(tableId)) continue;

    // Clear the table once (mirror semantics) before the first page.
    if (!append && !state.cleared.includes(tableId)) {
      // CUTOVER GUARD: tables whose source of truth is the ERP are never touched.
      try {
        const st: Array<{ source: string }> = await (prisma as any).$queryRaw`SELECT source FROM sync_state WHERE model = ${def.model}`;
        if (st[0]?.source === "ERP") { console.log(`⏭  ${def.tableName} — cut over to ERP, skipped`); state.done.push(tableId); saveState(state); continue; }
      } catch { /* sync_state not migrated yet — proceed */ }
      // Only clear rows that came FROM Airtable ("rec…"); ERP-native rows survive.
      await delegate(def.model).deleteMany({ where: { airtableId: { startsWith: "rec" } } });
      state.cleared.push(tableId);
      state.counts[tableId] = 0;
      saveState(state);
    }

    let offset = state.current?.tableId === tableId ? state.current.offset : undefined;
    do {
      const page = await fetchPage(tableId, offset);
      const rows = page.records.map((r) => toRow(r, def));
      if (rows.length) await delegate(def.model).createMany({ data: rows, skipDuplicates: true });
      state.counts[tableId] = (state.counts[tableId] ?? 0) + rows.length;
      offset = page.offset;
      state.current = { tableId, offset };
      saveState(state);
      if (outOfTime()) {
        console.log(`PARTIAL — stopped in ${def.tableName} at ${state.counts[tableId]} records (budget hit)`);
        await prisma.$disconnect();
        return;
      }
    } while (offset);

    state.done.push(tableId);
    state.current = undefined;
    saveState(state);
    console.log(`✓ ${def.tableName} (${def.model}) — ${state.counts[tableId]} records`);
  }

  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  console.log(`\nIMPORT COMPLETE — ${total} records across ${entries.length} tables.`);
  rmSync(STATE_FILE, { force: true });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nImport error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
