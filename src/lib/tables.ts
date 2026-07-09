// Generic table layer — exposes every one of the 46 mirrored tables for
// browse / view / edit / create (the Airtable-grid equivalent). Field metadata
// is derived from scripts/fieldmap.json; editability follows the field kind.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { CURATED_TEXT_FIELDS } from "@/lib/categoricalFields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
export const delegateOf = (model: string) => db[model[0].toLowerCase() + model.slice(1)];

export type FieldKind = "scalar" | "number" | "int" | "bool" | "date" | "multiselect" | "link" | "json";
export interface FieldMeta { prismaField: string; airtableName: string; airtableType: string; kind: FieldKind; editable: boolean; column?: string; }
export interface TableMeta { model: string; tableName: string; tableMap?: string; fields: FieldMeta[]; }

const READONLY_AT = new Set(["formula", "rollup", "multipleLookupValues", "count", "autoNumber", "createdTime", "lastModifiedTime", "button", "externalSyncSource"]);
const SYSTEM = new Set(["id", "airtableId", "importedAt", "syncedAt", "batchKey"]);

let _meta: Record<string, TableMeta> | null = null;
function load(): Record<string, TableMeta> {
  if (_meta) return _meta;
  const fm = JSON.parse(readFileSync(join(process.cwd(), "scripts", "fieldmap.json"), "utf8")) as Record<string, { model: string; tableName: string; tableMap?: string; fields: Record<string, { airtableName: string; prismaField: string; airtableType: string; kind: string; column?: string }> }>;
  const out: Record<string, TableMeta> = {};
  for (const t of Object.values(fm)) {
    const fields: FieldMeta[] = Object.values(t.fields).map((f) => ({
      prismaField: f.prismaField,
      airtableName: f.airtableName,
      airtableType: f.airtableType,
      kind: f.kind as FieldKind,
      editable: !SYSTEM.has(f.prismaField) && !READONLY_AT.has(f.airtableType) && ["scalar", "number", "int", "bool", "date", "multiselect"].includes(f.kind),
      column: f.column,
    }));
    out[t.model] = { model: t.model, tableName: t.tableName, tableMap: t.tableMap, fields };
  }
  // Native addition: WHICH vacuum pumps ran (the Airtable field only held a count).
  {
    const press = out["Press"];
    if (press && !press.fields.some((f) => f.prismaField === "vacuumPumps")) {
      const i = press.fields.findIndex((f) => f.prismaField === "noOfVacuumPumps");
      const fm: FieldMeta = { prismaField: "vacuumPumps", airtableName: "Vacuum Pumps", airtableType: "singleLineText", kind: "scalar", editable: true, column: "vacuum_pumps" };
      press.fields.splice(i >= 0 ? i + 1 : press.fields.length, 0, fm);
    }
  }
  // Two-tier RM: the bulk, bag-less "unassigned pool" is a native table (not an
  // Airtable mirror), surfaced here so it's browsable alongside the assigned RM.
  out["UnassignedRm"] = {
    model: "UnassignedRm",
    tableName: "RM — Unassigned (pool)",
    fields: [
      { prismaField: "invNo", airtableName: "Invoice No", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "type", airtableName: "Type", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "size", airtableName: "Size", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "grade", airtableName: "Grade", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "supplier", airtableName: "Supplier", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "totalKg", airtableName: "Total KG", airtableType: "number", kind: "number", editable: false },
      { prismaField: "remainingKg", airtableName: "Remaining KG", airtableType: "number", kind: "number", editable: false },
      { prismaField: "date", airtableName: "Date", airtableType: "date", kind: "date", editable: false },
      { prismaField: "status", airtableName: "Status", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "testedBy", airtableName: "Tested By", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "availability", airtableName: "Availability", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "contamination", airtableName: "Contamination", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "gritShade", airtableName: "Grit Shade", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "fillerShade", airtableName: "Filler Shade", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "colourL", airtableName: "Colour L", airtableType: "number", kind: "number", editable: false },
      { prismaField: "colourA", airtableName: "Colour A", airtableType: "number", kind: "number", editable: false },
      { prismaField: "colourB", airtableName: "Colour B", airtableType: "number", kind: "number", editable: false },
      { prismaField: "consumablesIssue", airtableName: "Consumables Issue", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "remarks", airtableName: "Remarks", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "uploadedBy", airtableName: "Uploaded By", airtableType: "singleLineText", kind: "scalar", editable: false },
      { prismaField: "createdAt", airtableName: "Created", airtableType: "createdTime", kind: "date", editable: false },
    ],
  };
  _meta = out;
  return out;
}

export function allTables(): TableMeta[] {
  return Object.values(load()).sort((a, b) => a.tableName.localeCompare(b.tableName));
}
export function tableMeta(model: string): TableMeta | undefined {
  return load()[model];
}

export async function listRows(model: string, page: number, pageSize = 25, batch?: string, q?: string, sort?: string, dir?: string, empty?: string) {
  const d = delegateOf(model);
  if (!d) throw new Error("unknown table");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = batch ? { batchKey: batch } : {};
  const query = q?.trim();
  if (query) {
    const meta = tableMeta(model);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const or: any[] = [];
    const asNum = parseFloat(query);
    for (const f of meta?.fields ?? []) {
      if (or.length >= 12) break;
      if (f.kind === "scalar") or.push({ [f.prismaField]: { contains: query, mode: "insensitive" } });
      else if ((f.kind === "number" || f.kind === "int") && Number.isFinite(asNum)) or.push({ [f.prismaField]: { equals: asNum } });
    }
    if (or.length) where.OR = or;
  }
  // Filter rows whose given field is unset (null or empty string) -- powers the
  // "—" (ungraded / no-value) buckets on the batch charts, which can't be matched
  // by a text search because "—" is only a display placeholder.
  if (empty) {
    const fm = tableMeta(model)?.fields.find((x) => x.prismaField === empty);
    if (fm) where.OR = [{ [empty]: null }, { [empty]: "" }];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any = model === "UnassignedRm" ? { createdAt: "desc" as const } : { importedAt: "desc" as const };
  if (sort) {
    const sf = tableMeta(model)?.fields.find((x) => x.prismaField === sort);
    if (sf && ["scalar", "number", "int", "bool", "date"].includes(sf.kind)) orderBy = { [sort]: dir === "asc" ? "asc" : "desc" };
  }
  const [rows, total] = await Promise.all([
    d.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy }),
    d.count({ where }),
  ]);
  return { rows: rows as Record<string, unknown>[], total, pageSize };
}

export async function getRow(model: string, id: string) {
  return (await delegateOf(model).findUnique({ where: { id } })) as Record<string, unknown> | null;
}

// Coerce a submitted form value to the column's type.
export function coerceField(kind: FieldKind, raw: FormDataEntryValue | null): unknown {
  if (kind === "bool") return raw === "on" || raw === "true";
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return kind === "multiselect" ? [] : null;
  switch (kind) {
    case "number": return Number.isFinite(parseFloat(s)) ? parseFloat(s) : null;
    case "int": return Number.isFinite(parseInt(s, 10)) ? parseInt(s, 10) : null;
    case "date": { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
    case "multiselect": return s.split(",").map((x) => x.trim()).filter(Boolean);
    default: return s;
  }
}

// Options that must ALWAYS be offered, regardless of what's in the data yet.
const PRESET_OPTIONS: Record<string, string[]> = {
  distributorVein1GevSlot: ["7mm", "9mm", "11mm"],
  distributorVein2GevSlot: ["7mm", "9mm", "11mm"],
  // SKU / design name on the Silo form — always offered on its dropdown, even
  // before any record uses them; SKUs already in the data are appended after.
  sku: ["Tokyo", "Maple Haze"],
  // Design names that should always be offered on every design dropdown, even
  // before any record uses them. Designs already in the data are appended after.
  // (designName: Press, Kreos, Jot, Distributor, Oven, Robot… · design: MIS, Polish…)
  designName: ["Tokyo", "Maple Haze"],
  design: ["Tokyo", "Maple Haze"],
  // QC dropdowns — canonical options so the field is always a dropdown (never a
  // text box) and free-text/case typos can't multiply.
  repolishStatus: ["Direct Ok", "Polish Ok", "Repolish Done", "Repolish Required"],
  rwStatus: ["Direct Ok", "RW Done Ok", "RW Required and ongoing", "Can't be Reworked"],
  qualityGrade: ["Not graded yet", "A", "A2", "B", "C (Reject)", "CTS", "Printing"],
  polishType: ["Polish", "Suede", "Honed", "Leathered"],
  bay: ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5"],
  // MIS sheet: machine areas exactly as printed on the paper daily report
  areaOfProblem: ["Silos", "Mixer", "Distributor", "Kreos", "Chessboard", "Robot", "Press", "Oven", "Rubber Line", "Cooling Tower", "Jot"],
  slabThickness: ["1.2 cm", "2 cm", "3 cm", "7 mm"],
  thickness: ["1.2 cm", "2 cm", "3 cm", "7 mm"],
};

// Derive dropdown options for singleSelect / multipleSelects fields from the
// distinct values already present in the data (the choices actually in use).
export async function selectOptions(model: string): Promise<Record<string, string[]>> {
  const meta = tableMeta(model);
  if (!meta) return {};
  const d = delegateOf(model);
  const out: Record<string, string[]> = {};
  // One distinct-values query per select field — run them in PARALLEL batches
  // (sequentially this was the slowest part of loading every entry form; small
  // batches keep well under the Prisma/Neon connection-pool limit).
  const BATCH = 8;
  const fieldJob = async (f: (typeof meta.fields)[number]) => {
    try {
      if (f.airtableType === "singleSelect" || (CURATED_TEXT_FIELDS.has(f.prismaField) && f.kind === "scalar")) {
        const rows: any[] = await d.findMany({ where: { [f.prismaField]: { not: null } }, select: { [f.prismaField]: true }, distinct: [f.prismaField], take: 500 });
        const vals = rows.map((r) => r[f.prismaField]).filter((v) => v != null && v !== "").map((v) => String(v).trim()).filter(Boolean);
        // Preset (canonical) first so its casing wins; dedupe case-insensitively so
        // "Direct ok" can't appear next to "Direct Ok". Presets guarantee the field
        // always has options (so it renders as a dropdown, not a free-text box).
        const preset = PRESET_OPTIONS[f.prismaField] ?? [];
        const seen = new Set(preset.map((x) => x.toLowerCase()));
        const extras: string[] = [];
        for (const v of vals) { const k = v.toLowerCase(); if (!seen.has(k)) { seen.add(k); extras.push(v); } }
        const merged = [...preset, ...extras.sort()]; // preset in authored order, extras sorted after
        if (merged.length) out[f.prismaField] = merged;
      } else if (f.airtableType === "multipleSelects" && meta.tableMap && f.column) {
        // distinct values computed in the DB (covers the whole table, returns a handful of rows)
        const rows: any[] = await db.$queryRawUnsafe(`SELECT DISTINCT unnest("${f.column}") AS v FROM "${meta.tableMap}" LIMIT 500`);
        const set = new Set<string>(PRESET_OPTIONS[f.prismaField] ?? []);
        for (const r of rows) if (r.v) set.add(String(r.v));
        if (set.size) out[f.prismaField] = [...set].sort();
      } else if (f.airtableType === "multipleSelects") {
        const rows: any[] = await d.findMany({ select: { [f.prismaField]: true }, take: 3000 });
        const set = new Set<string>(PRESET_OPTIONS[f.prismaField] ?? []);
        for (const r of rows) for (const v of (r[f.prismaField] ?? [])) if (v) set.add(String(v));
        if (set.size) out[f.prismaField] = [...set].sort();
      }
    } catch { /* ignore */ }
  };
  for (let i = 0; i < meta.fields.length; i += BATCH)
    await Promise.all(meta.fields.slice(i, i + BATCH).map(fieldJob));
  return out;
}

// Fields to hide from entry forms (cross-references / automation outputs, not
// operator inputs). Keyed by model.
export const HIDDEN_FORM_FIELDS: Record<string, string[]> = {
  MixerCycle: ["slabSegregation", "gritFillerResinCalculation", "slabSummary3", "slabSummary4", "inventoryTransactions", "productionReport"],
  Silo: ["slabSummary", "slabSummary2", "slabSummary3", "usedBagsCopy", "inventoryTransactions", "rmNotFound", "remainingWeight"],
  Mis: ["rcaNo"],
  // the "Date" field carries date+time, so separate In Times are redundant;
  // Out Time exists only at the Oven (cooking time = out − in).
  Press: ["inTime", "automationLog", "productionReport", "noOfVacuumPumps"], // count derives from Vacuum Pumps
  Oven: ["inTime"],
  Distributor: ["mouldInTime", "mouldOutTime", "slabSegregation"],
  Kreos: ["mouldInTime", "slabSegregation"],
  // day-tank prep: remaining auto-equals quantity; usage is derived by FIFO
  DailyResinTank: ["remainingWeight", "usageStatus", "processed"],
};
