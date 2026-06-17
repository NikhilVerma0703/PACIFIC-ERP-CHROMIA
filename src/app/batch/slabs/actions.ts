"use server";

import { currentBranchName } from "@/lib/branch";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canRectify, isManager, localId } from "@/lib/rbac";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { designForBatch, getMissingSlabs, type SlabStation } from "@/lib/erp";
import { tableMeta, delegateOf, coerceField, selectOptions, type FieldMeta } from "@/lib/tables";
import { hhmmToSeconds } from "@/lib/time";
import { OPERATOR_FIELDS } from "@/lib/operatorFields";
import { currentUser } from "@/lib/rbac";
import { THICKNESS_FIELDS, canonThickness } from "@/lib/thickness";
import { logAction } from "@/lib/actionLog";

type FixStation = Exclude<SlabStation, "mixer">;

interface StationCfg {
  model: string;
  delegate: () => any;
  recency: string;        // field used to decide "later" vs "earlier"
  weightField: string | null;
  designField: string;
  prefix: string;
}

const CFG: Record<FixStation, StationCfg> = {
  press:       { model: "Press",       delegate: () => prisma.press,       recency: "createdTime", weightField: "slabWeight", designField: "designName", prefix: "press" },
  distributor: { model: "Distributor", delegate: () => prisma.distributor, recency: "createdTime", weightField: null,         designField: "designName", prefix: "distributor" },
  kreos:       { model: "Kreos",       delegate: () => prisma.kreos,       recency: "createdTime", weightField: "slabWeight", designField: "designName", prefix: "kreos" },
  oven:        { model: "Oven",        delegate: () => prisma.oven,        recency: "importedAt",  weightField: null,         designField: "designName", prefix: "oven" },
  jot:         { model: "Jot",         delegate: () => prisma.jot,         recency: "createdTime", weightField: "slabWeight", designField: "designName", prefix: "jot" },
  polishEntry: { model: "PolishEntry", delegate: () => prisma.polishEntry, recency: "created",     weightField: null,         designField: "design",     prefix: "polishentry" },
  polishQc:    { model: "PolishQc",    delegate: () => prisma.polishQc,    recency: "createdTime", weightField: null,         designField: "design",     prefix: "polishqc" },
};

function tval(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" || typeof v === "number") { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : -Infinity; }
  return -Infinity;
}

async function avgBatchWeight(key: string): Promise<number | null> {
  const agg = await prisma.press.aggregate({ where: { batchKey: key, slabWeight: { not: null } }, _avg: { slabWeight: true } });
  const v = agg._avg.slabWeight;
  return v == null ? null : Math.round(v * 100) / 100;
}

export interface ActionResult { ok: boolean; message: string; }

/** De-dup a station: keep the LATEST record of each slab, delete the earlier ones. Logged + reversible. */
export async function rectifyDuplicates(batch: string, station: FixStation): Promise<ActionResult> {
  if (!(await canRectify())) return { ok: false, message: "Only incharge and above can rectify duplicates." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, message: "Production data can only be rectified from the Shop Floor branch." };
  const cfg = CFG[station];
  if (!cfg) return { ok: false, message: "This station does not support de-duplication." };
  const key = normalizeBatch(batch);
  const d = cfg.delegate();
  const rows: any[] = await d.findMany({ where: { batchKey: key }, select: { id: true, slabNumber: true, [cfg.recency]: true } });

  const groups = new Map<number, any[]>();
  for (const r of rows) {
    const s = r.slabNumber;
    if (typeof s !== "number" || !Number.isFinite(s)) continue;
    (groups.get(s) ?? groups.set(s, []).get(s)!).push(r);
  }
  const toDelete: string[] = [];
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    g.sort((a, b) => tval(b[cfg.recency]) - tval(a[cfg.recency]));
    for (let i = 1; i < g.length; i++) toDelete.push(g[i].id);
  }
  if (!toDelete.length) return { ok: true, message: "No duplicates to remove." };

  const full: any[] = await d.findMany({ where: { id: { in: toDelete } } }); // snapshot for undo
  await d.deleteMany({ where: { id: { in: toDelete } } });
  await logAction({ kind: "delete", batchKey: key, model: cfg.model, summary: `Removed ${toDelete.length} duplicate ${cfg.model} row(s) in ${key}`, payload: { model: cfg.model, records: full } });

  revalidatePath("/batch/slabs");
  revalidatePath("/batch");
  return { ok: true, message: `Removed ${toDelete.length} earlier duplicate row(s); kept the latest of each. (Undoable)` };
}

/** Bulk add of every missing slab (weight = batch average). Logged + reversible. */
export async function addAllMissing(batch: string, station: FixStation): Promise<ActionResult> {
  if (!(await canRectify())) return { ok: false, message: "Only incharge and above can add slabs." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, message: "Production data can only be rectified from the Shop Floor branch." };
  const cfg = CFG[station];
  if (!cfg) return { ok: false, message: "Unknown station." };
  const key = normalizeBatch(batch);
  const [missing, design, avg] = await Promise.all([
    getMissingSlabs(batch, station),
    designForBatch(key).then((x) => x.primary),
    avgBatchWeight(key),
  ]);
  if (!missing.rows.length) return { ok: true, message: "Nothing missing to add." };

  const ids: string[] = [];
  try {
    for (const r of missing.rows) {
      const rec: Record<string, unknown> = { airtableId: localId(cfg.prefix), batchKey: key, slabNumber: r.slab };
      if (design) rec[cfg.designField] = design;
      if (cfg.weightField && avg != null) rec[cfg.weightField] = avg;
      const created = await cfg.delegate().create({ data: rec });
      ids.push(created.id);
    }
  } catch (e) {
    return { ok: false, message: `Could not add slabs: ${(e as Error).message}` };
  }
  await logAction({ kind: "create", batchKey: key, model: cfg.model, summary: `Added ${ids.length} missing ${cfg.model} slab(s) in ${key}`, payload: { model: cfg.model, ids } });

  revalidatePath("/batch/slabs");
  revalidatePath("/batch");
  return { ok: true, message: `Added ${ids.length} missing slab(s)${cfg.weightField && avg != null ? ` at ${avg} kg (batch avg)` : ""}. (Undoable)` };
}

// ---- Verify-and-add a single missing slab -------------------------------
export interface AddSlabForm {
  model: string;
  station: FixStation;
  batch: string;
  slab: number;
  fields: FieldMeta[];
  values: Record<string, unknown>;
  options: Record<string, string[]>;
  templateSlab: number | null;
  avgWeight: number | null;
  weightField: string | null;
}

const STRIP = new Set(["id", "airtableId", "importedAt", "syncedAt", "createdTime", "created", "batchKey"]);

export async function getAddSlabForm(batch: string, station: FixStation, slab: number): Promise<AddSlabForm | { error: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can add slabs." };
  const cfg = CFG[station];
  if (!cfg) return { error: "Unknown station." };
  const meta = tableMeta(cfg.model);
  if (!meta) return { error: "Unknown table." };
  const key = normalizeBatch(batch);
  const d = cfg.delegate();

  const [prevBelow, design, avg, options] = await Promise.all([
    d.findFirst({ where: { batchKey: key, slabNumber: { lt: slab } }, orderBy: { slabNumber: "desc" } }),
    designForBatch(key).then((x) => x.primary),
    avgBatchWeight(key),
    selectOptions(cfg.model),
  ]);
  let template = prevBelow;
  let templateSlab: number | null = prevBelow?.slabNumber ?? null;
  if (!template) {
    const above = await d.findFirst({ where: { batchKey: key, slabNumber: { gt: slab } }, orderBy: { slabNumber: "asc" } });
    template = above ?? null;
    templateSlab = above?.slabNumber ?? null;
  }

  const values: Record<string, unknown> = {};
  if (template) for (const [k, v] of Object.entries(template)) if (!STRIP.has(k)) values[k] = v;
  values.slabNumber = slab;
  if (design) values[cfg.designField] = design;
  if (cfg.weightField && avg != null) values[cfg.weightField] = avg;
  values.batch = (values.batch as string) ?? batch;

  return { model: cfg.model, station, batch, slab, fields: meta.fields, values, options, templateSlab, avgWeight: avg, weightField: cfg.weightField };
}

/** Create the verified slab. Logged + reversible. */
export async function createVerifiedSlab(model: string, batch: string, fd: FormData): Promise<{ ok: boolean; id?: string; message: string }> {
  if (!(await canRectify())) return { ok: false, message: "Only incharge and above can add slabs." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, message: "Production data can only be rectified from the Shop Floor branch." };
  const meta = tableMeta(model);
  if (!meta) return { ok: false, message: "Unknown table." };
  const data: Record<string, unknown> = {};
  for (const f of meta.fields) {
    if (!f.editable) continue;
    if (f.kind === "multiselect") { data[f.prismaField] = fd.getAll(f.prismaField).map(String).filter(Boolean); continue; }
    if (f.airtableType === "duration") { if (fd.has(f.prismaField)) data[f.prismaField] = hhmmToSeconds(fd.get(f.prismaField)); continue; }
    if (THICKNESS_FIELDS.has(f.prismaField)) { if (fd.has(f.prismaField)) data[f.prismaField] = canonThickness(fd.get(f.prismaField)) || null; continue; }
    if (!fd.has(f.prismaField) && f.kind !== "bool") continue;
    data[f.prismaField] = coerceField(f.kind, fd.get(f.prismaField));
  }
  const key = normalizeBatch(batch);
  data.batchKey = key;
  const me = await currentUser();
  const opName = me?.name || me?.email || "operator";
  for (const f of meta.fields) if (f.editable && OPERATOR_FIELDS.has(f.prismaField)) data[f.prismaField] = opName;
  let id: string;
  try {
    const rec = await delegateOf(model).create({ data: { airtableId: localId(model.toLowerCase()), ...data } });
    id = rec.id;
  } catch (e) {
    return { ok: false, message: `Create failed: ${(e as Error).message}` };
  }
  await logAction({ kind: "create", batchKey: key, model, summary: `Added ${model} slab ${String(data.slabNumber ?? "")} in ${key}`, payload: { model, ids: [id] } });
  revalidatePath("/batch/slabs");
  revalidatePath("/batch");
  return { ok: true, id, message: `Slab ${String(data.slabNumber ?? "")} added. (Undoable)` };
}

/** Delete a single station row by id. Manager-and-above only; logged + reversible (Undo recreates it). */
export async function deleteSlabRow(model: string, id: string, batch: string): Promise<ActionResult> {
  if (!(await isManager())) return { ok: false, message: "Only the production manager and above can delete a row." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, message: "Production data can only be edited from the Shop Floor branch." };
  if (!model || !id) return { ok: false, message: "Nothing to delete." };
  const d: any = delegateOf(model);
  if (!d?.findUnique) return { ok: false, message: "Unknown table." };
  const key = normalizeBatch(batch);
  const row: any = await d.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Row not found — it may already be deleted." };
  if (row.batchKey && key && row.batchKey !== key) return { ok: false, message: "That row does not belong to this batch." };
  const slabLabel = row.slabNumber != null && Number.isFinite(row.slabNumber) ? `slab ${row.slabNumber}` : "blank-slab row";
  try {
    await d.delete({ where: { id } });
  } catch (e) {
    return { ok: false, message: `Delete failed: ${(e as Error).message}` };
  }
  await logAction({ kind: "delete", batchKey: key, model, summary: `Deleted ${model} ${slabLabel} in ${key}`, payload: { model, records: [row] } });
  revalidatePath("/batch/slabs");
  revalidatePath("/batch");
  return { ok: true, message: `Deleted ${model} ${slabLabel}. (Undoable)` };
}

/** Remove every slab-less (blank) row in a batch across the slab stations. Manager
 * and above only; logged as ONE undoable action (Undo recreates all rows). */
export async function removeBlankSlabRows(batch: string): Promise<ActionResult> {
  if (!(await isManager())) return { ok: false, message: "Only the production manager and above can remove blank rows." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, message: "Production data can only be edited from the Shop Floor branch." };
  const key = normalizeBatch(batch);
  if (!key) return { ok: false, message: "No batch specified." };
  const MODELS = ["Press", "Distributor", "Kreos", "Oven", "Jot", "PolishEntry", "PolishQc"];
  // "blank" = no usable slab number (null or non-finite) -- the same definition the
  // slab audit uses for blankTotal, so the shown count and the delete agree.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isBlank = (r: any) => r.slabNumber == null || !Number.isFinite(r.slabNumber);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups: { model: string; records: any[] }[] = [];
  let total = 0;
  try {
    for (const m of MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = delegateOf(m);
      if (!d?.findMany) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blank: any[] = (await d.findMany({ where: { batchKey: key } })).filter(isBlank);
      if (!blank.length) continue;
      // Delete exactly the rows we snapshot (by id): no re-query race, and the
      // snapshot equals the deleted set so Undo restores precisely these rows.
      await d.deleteMany({ where: { id: { in: blank.map((r: { id: string }) => r.id) } } });
      groups.push({ model: m, records: blank });
      total += blank.length;
    }
  } catch (e) {
    // Partial failure: still log what was already deleted so it stays undoable.
    if (groups.length) await logAction({ kind: "delete", batchKey: key, model: null, summary: `Removed ${total} blank-slab row(s) in ${key} (partial, stopped on error)`, payload: { groups } });
    revalidatePath("/batch"); revalidatePath("/batch/slabs");
    return { ok: false, message: `Removed ${total} row(s) before an error: ${(e as Error).message}` };
  }
  if (!total) return { ok: true, message: "No blank-slab rows to remove." };
  const parts = groups.map((g) => `${g.model} ${g.records.length}`).join(", ");
  await logAction({ kind: "delete", batchKey: key, model: null, summary: `Removed ${total} blank-slab row(s) in ${key} (${parts})`, payload: { groups } });
  revalidatePath("/batch"); revalidatePath("/batch/slabs");
  return { ok: true, message: `Removed ${total} blank-slab row(s). (Undoable)` };
}
