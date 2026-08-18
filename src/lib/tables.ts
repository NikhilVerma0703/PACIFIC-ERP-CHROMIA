// Generic table layer — exposes every one of the 46 mirrored tables for
// browse / view / edit / create (the Airtable-grid equivalent). Field metadata
// is derived from scripts/fieldmap.json; editability follows the field kind.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
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

// Prisma field names per model, from the generated client's DMMF — the source of
// truth for what a `select` may name. Used to validate caller-requested columns so a
// field that exists in the UI metadata but not on the model can never 500 the page.
const _modelFields = new Map<string, Set<string>>();
export function modelFieldSet(model: string): Set<string> | undefined {
  let s = _modelFields.get(model);
  if (!s) {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
    if (!m) return undefined;
    s = new Set(m.fields.map((f) => f.name));
    _modelFields.set(model, s);
  }
  return s;
}

// `fields` (optional): the columns the caller actually renders. When given, the row
// query selects ONLY those columns (+ id). WHY (measured 2026-08-14, live Neon): the
// grid renders 6 columns but the unselected findMany shipped every column — 25 rows
// weighed 69.0 KB on MixerCycle (137 cols), 29.4 KB Press, 26.0 KB PolishQc, vs ~3–4 KB
// for what the page shows. Same rows, same order — only unrendered bytes are dropped.
// Unknown names are silently skipped (see modelFieldSet); no `fields` = full rows.
export async function listRows(model: string, page: number, pageSize = 25, batch?: string, q?: string, sort?: string, dir?: string, empty?: string, fields?: string[]) {
  const d = delegateOf(model);
  if (!d) throw new Error("unknown table");
  const meta = tableMeta(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = batch ? { batchKey: batch } : {};
  const query = q?.trim();
  if (query) {
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
  if (empty && meta?.fields.some((x) => x.prismaField === empty)) {
    where.OR = [{ [empty]: null }, { [empty]: "" }];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any = model === "UnassignedRm" ? { createdAt: "desc" as const } : { importedAt: "desc" as const };
  if (sort) {
    const sf = meta?.fields.find((x) => x.prismaField === sort);
    if (sf && ["scalar", "number", "int", "bool", "date"].includes(sf.kind)) orderBy = { [sort]: dir === "asc" ? "asc" : "desc" };
  }
  let select: Record<string, true> | undefined;
  if (fields?.length) {
    const known = modelFieldSet(model);
    if (known) {
      const cols = [...new Set(["id", ...fields])].filter((f) => known.has(f));
      if (cols.length) select = Object.fromEntries(cols.map((c) => [c, true]));
    }
  }
  const [rows, total] = await Promise.all([
    d.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy, ...(select ? { select } : {}) }),
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
  // Postgres text can NEVER hold 0x00 — strip NULs or the whole insert dies
  // with 22021 "invalid byte sequence for encoding UTF8" (seen on MIS saves).
  const s = raw == null ? "" : String(raw).replace(/\u0000/g, "").trim();
  if (s === "") return kind === "multiselect" ? [] : null;
  switch (kind) {
    case "number": { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }
    case "int": { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
    case "date": { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
    case "multiselect": return s.split(",").map((x) => x.trim()).filter(Boolean);
    default: return s;
  }
}

/** Option values a field must STOP offering, without touching the rows that already
 *  hold them. The MIS "Reason for deviation" list is not authored anywhere — it is the
 *  set of distinct values present in the data — so retiring a reason means excluding it
 *  here, not deleting it from history.
 *
 *  History is deliberately left intact: 728 MIS rows carry one of the retired values
 *  (measured 2026-07-25), 269 of them one of the five machine faults, which all classify
 *  as "breakdown" in the downtime report. The keywords in classifyReason (lib/downtime.ts)
 *  MUST therefore keep matching FAULT ALARM, HMI and BELT DAMAGE even though nobody can
 *  pick them again — remove those and past reports silently re-bucket as "process".
 *
 *  Matched case-insensitively and trimmed, because the data is hand-entered. */
const RETIRED_OPTIONS: Record<string, string[]> = {
  reasonForDeviation: [
    "BELT DAMAGE",
    "ELECTRICAL - SUPPLY ISSUE",
    "FAULT ALARM",
    "HMI ISSUE",
    "MECHANICAL - BELT ISSUE",
    // Renamed, not dropped -> "Liquid / Powder issue at Robos" (scripts/0030 relabels
    // the 37 rows that used the old wording).
    "Pigment Issue (Liquid or Powder pigment)",
    // Split in two on 2026-07-25: operators now choose RAW MATERIAL DELAY or MATERIAL
    // DELAY FROM MIXER deliberately. The 469 rows that used the ambiguous old value keep
    // it rather than being reassigned: 170 of them do name the mixer in details or area
    // of problem, but 293 say nothing either way, so any rule would be inventing the
    // split for most of the history. Left for the owner to reclassify if ever needed.
    "MATERIAL DELAY",
    // Relabelled by scripts/0032 -> "HALF CLEANING/ INTERMEDIATE CLEANING", so no row
    // holds it any more. Listed anyway: mis is still an Airtable-mirrored table, and if
    // that base keeps the old option a re-sync would put it back on the form.
    "INTERMEDIATE CLEANING",
  ],
};
const _retired = new Map<string, Set<string>>(
  Object.entries(RETIRED_OPTIONS).map(([k, v]) => [k, new Set(v.map((x) => x.trim().toLowerCase()))])
);
/** Drop retired values from a computed option list. */
const liveOptions = (field: string, vals: string[]): string[] => {
  const gone = _retired.get(field);
  return gone ? vals.filter((v) => !gone.has(String(v).trim().toLowerCase())) : vals;
};

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
  // MIS "Reason for deviation". The list is otherwise whatever the data contains, so a
  // new or renamed reason needs a preset to appear at all before the first row uses it.
  // UPPERCASE to match the reasons already in the column; the multipleSelects option
  // builder does NOT fold case (unlike the singleSelect one), so "Full cleaning" beside
  // "FULL CLEANING" would render as two identical-looking chips.
  reasonForDeviation: [
    "DESIGN CHANGE OVER/ ORDER CODE CHANGE",
    "DRY CLEANING",
    "FULL CLEANING",
    "HALF CLEANING/ INTERMEDIATE CLEANING",
    "MATERIAL DELAY FROM MIXER",
    "MOULD DELAY",
    "PIGMENT DELAY (NON ROBO)",
    "RAW MATERIAL DELAY",
    "SHADE VARIATION/ CRACKS",
    // Kept from before: a liquid/powder FAULT at the robos, distinct from waiting on
    // pigment (which is PIGMENT DELAY (NON ROBO)).
    "Liquid / Powder issue at Robos",
  ],
  // MIS sheet: machine areas exactly as printed on the paper daily report
  areaOfProblem: ["Silos", "Mixer", "Distributor", "Kreos", "Chessboard", "Robot", "Press", "Oven", "Rubber Line", "Cooling Tower", "Jot"],
  slabThickness: ["1.2 cm", "2 cm", "3 cm", "7 mm"],
  thickness: ["1.2 cm", "2 cm", "3 cm", "7 mm"],
};

// Derive dropdown options for singleSelect / multipleSelects fields from the
// distinct values already present in the data (the choices actually in use).
// Options change rarely (a new value only appears when someone saves it), but
// they were recomputed with a dozen distinct-queries on EVERY form load — slow
// on cold Neon, and one failed query silently degraded that dropdown into a
// free-text box. Warm-lambda cache with stale-on-miss: instant repeat loads,
// and a DB hiccup can never take options away that a previous run had.
const OPT_TTL_MS = 5 * 60_000;
const _optCache = new Map<string, { at: number; data: Record<string, string[]> }>();

export async function selectOptions(model: string): Promise<Record<string, string[]>> {
  const meta = tableMeta(model);
  if (!meta) return {};
  const hit = _optCache.get(model);
  if (hit && Date.now() - hit.at < OPT_TTL_MS) return hit.data;
  const d = delegateOf(model);
  const out: Record<string, string[]> = {};

  // The two merge steps, shared by the one-shot path and the per-field fallback so
  // both produce byte-identical option lists.
  // Preset (canonical) first so its casing wins; dedupe case-insensitively so
  // "Direct ok" can't appear next to "Direct Ok". Presets guarantee the field
  // always has options (so it renders as a dropdown, not a free-text box).
  const mergeSingle = (field: string, raw: unknown[]) => {
    const vals = raw.filter((v) => v != null && v !== "").map((v) => String(v).trim()).filter(Boolean);
    const preset = PRESET_OPTIONS[field] ?? [];
    const seen = new Set(preset.map((x) => x.toLowerCase()));
    const extras: string[] = [];
    for (const v of vals) { const k = v.toLowerCase(); if (!seen.has(k)) { seen.add(k); extras.push(v); } }
    const merged = liveOptions(field, [...preset, ...extras.sort()]); // preset in authored order, extras sorted after
    if (merged.length) out[field] = merged;
  };
  // Trimmed like the singleSelect branch: a value differing only by stray whitespace
  // is a different string, so it would render as a second, identical-looking chip
  // and split the same reason across both.
  const mergeMulti = (field: string, raw: unknown[]) => {
    const set = new Set<string>(PRESET_OPTIONS[field] ?? []);
    for (const v of raw) if (v) { const t = String(v).trim(); if (t) set.add(t); }
    const vals = liveOptions(field, [...set].sort());
    if (vals.length) out[field] = vals;
  };

  const isSingle = (f: FieldMeta) => f.airtableType === "singleSelect" || (CURATED_TEXT_FIELDS.has(f.prismaField) && f.kind === "scalar");
  const isMulti = (f: FieldMeta) => f.airtableType === "multipleSelects";

  // One distinct-values query per select field, all fired in ONE parallel wave.
  // They used to run in serialized batches of 8 — MixerCycle's 26 queries took 4
  // round-trip waves, measured 3,075 ms on a cold lambda (2026-08-14). One wave
  // costs roughly the slowest single query instead of the sum of four; Prisma's
  // own pool queues anything beyond its connection limit, so a wider wave cannot
  // exhaust connections — the pool throttles it exactly like the batches did.
  //
  // DELIBERATELY NOT folded into one UNION ALL round trip (measured 18x faster
  // cold): mergeSingle keeps the FIRST casing it sees of each option, so the
  // option lists' casing follows the row order the exact current queries return.
  // A different query shape returns a different order and silently relabels
  // options ("Chinna" -> "chinna" in live data). Same queries = same dropdowns.
  const fieldJob = async (f: (typeof meta.fields)[number]) => {
    try {
      if (isSingle(f)) {
        const rows: Record<string, unknown>[] = await d.findMany({ where: { [f.prismaField]: { not: null } }, select: { [f.prismaField]: true }, distinct: [f.prismaField], take: 500 });
        mergeSingle(f.prismaField, rows.map((r) => r[f.prismaField]));
      } else if (isMulti(f) && meta.tableMap && f.column) {
        // distinct values computed in the DB (covers the whole table, returns a handful of rows)
        const rows: { v: unknown }[] = await db.$queryRawUnsafe(`SELECT DISTINCT unnest("${f.column}") AS v FROM "${meta.tableMap}" LIMIT 500`);
        mergeMulti(f.prismaField, rows.map((r) => r.v));
      } else if (isMulti(f)) {
        const rows: Record<string, unknown>[] = await d.findMany({ select: { [f.prismaField]: true }, take: 3000 });
        mergeMulti(f.prismaField, rows.flatMap((r) => ((r[f.prismaField] as unknown[] | null | undefined) ?? [])));
      }
    } catch { /* ignore */ }
  };
  await Promise.all(meta.fields.map(fieldJob));
  // Never DEGRADE: a field whose query failed this run (no values) keeps the
  // values the previous run had — a select must not fall back to a text box.
  // (filtered again: a cache entry written before a value was retired would resurrect it)
  if (hit) for (const [k, v] of Object.entries(hit.data)) if (!(out[k]?.length) && v.length) out[k] = liveOptions(k, v);
  _optCache.set(model, { at: Date.now(), data: out });
  return out;
}

// Fields to hide from entry forms (cross-references / automation outputs, not
// operator inputs). Keyed by model.
export const HIDDEN_FORM_FIELDS: Record<string, string[]> = {
  MixerCycle: ["slabSegregation", "gritFillerResinCalculation", "slabSummary3", "slabSummary4", "inventoryTransactions", "productionReport"],
  Silo: ["slabSummary", "slabSummary2", "slabSummary3", "usedBagsCopy", "inventoryTransactions", "rmNotFound", "remainingWeight"],
  // maintenanceInchargeName is a dead legacy column (only 11 of ~5,900 rows ever filled) —
  // maintenance staff are captured as Electrical + Mechanical Incharge instead, so hide the
  // duplicate field from every MIS form. The column is kept (old rows) but no longer offered.
  Mis: ["rcaNo", "maintenanceInchargeName"],
  // the "Date" field carries date+time, so separate In Times are redundant;
  // Out Time exists only at the Oven (cooking time = out − in).
  Press: ["inTime", "automationLog", "productionReport", "noOfVacuumPumps"], // count derives from Vacuum Pumps
  Oven: ["inTime"],
  Distributor: ["mouldInTime", "mouldOutTime", "slabSegregation"],
  Kreos: ["mouldInTime", "slabSegregation"],
  // day-tank prep: remaining auto-equals quantity; usage is derived by FIFO
  DailyResinTank: ["remainingWeight", "usageStatus", "processed"],
};
