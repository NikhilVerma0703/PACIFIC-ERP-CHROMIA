// Phase 4 — automation logic (server-side, runs in Node via Inngest functions).
// Faithful ports of the Airtable automations, operating on the Postgres mirror.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/erp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const delegate = (model: string) => db[model[0].toLowerCase() + model.slice(1)];

// ---- field map access -----------------------------------------------------
type FMField = { airtableName: string; prismaField: string; airtableType: string; kind: string };
type FMTable = { model: string; tableName: string; fields: Record<string, FMField> };
let _fm: Record<string, FMTable> | null = null;
function fieldmap(): Record<string, FMTable> {
  if (!_fm) _fm = JSON.parse(readFileSync(join(process.cwd(), "scripts", "fieldmap.json"), "utf8"));
  return _fm!;
}
function tableByModel(model: string): FMTable | undefined {
  return Object.values(fieldmap()).find((t) => t.model === model);
}

// ============================ Batch wastage ================================
export async function distinctBatchKeys(): Promise<string[]> {
  const [m, p] = await Promise.all([
    prisma.mixerCycle.findMany({ where: { batchKey: { not: null } }, select: { batchKey: true }, distinct: ["batchKey"] }),
    prisma.press.findMany({ where: { batchKey: { not: null } }, select: { batchKey: true }, distinct: ["batchKey"] }),
  ]);
  const set = new Set<string>();
  for (const r of [...m, ...p]) if (r.batchKey) set.add(r.batchKey);
  return [...set];
}

export interface WastageResult { batchKey: string; totalCycleWeight: number; totalSlabWeight: number; wastageKg: number; wastagePct: number | null; mixerCount: number; pressCount: number; }

export async function computeWastage(batchKey: string): Promise<WastageResult> {
  const [mixer, press] = await Promise.all([
    prisma.mixerCycle.findMany({ where: { batchKey }, select: { totalCycleWeight: true } }),
    prisma.press.findMany({ where: { batchKey }, select: { slabWeight: true } }),
  ]);
  const totalCycleWeight = mixer.reduce((a, m) => a + num(m.totalCycleWeight), 0);
  const totalSlabWeight = press.reduce((a, p) => a + (p.slabWeight ?? 0), 0);
  const wastageKg = totalCycleWeight - totalSlabWeight;
  const wastagePct = totalCycleWeight > 0 && totalSlabWeight > 0 ? (wastageKg / totalCycleWeight) * 100 : null;
  return { batchKey, totalCycleWeight, totalSlabWeight, wastageKg, wastagePct, mixerCount: mixer.length, pressCount: press.length };
}

export async function runBatchWastageRollup(): Promise<number> {
  const keys = await distinctBatchKeys();
  let n = 0;
  for (const batchKey of keys) {
    const r = await computeWastage(batchKey);
    if (r.totalCycleWeight === 0 && r.totalSlabWeight === 0) continue;
    const airtableId = `wst_${batchKey}`;
    const status = r.wastagePct == null ? "incomplete" : r.wastagePct > 12 ? "high" : r.wastagePct >= 8 ? "normal" : "low";
    const data = { batch: batchKey, batchKey, totalCycleWeightMixerCycle: r.totalCycleWeight, totalSlabWeightPress: r.totalSlabWeight, wastage: r.wastagePct ?? undefined, status, notes: `auto rollup ${new Date().toISOString().slice(0, 10)} · ${r.mixerCount} cycles / ${r.pressCount} slabs` };
    await prisma.batchWastage.upsert({ where: { airtableId }, create: { airtableId, ...data }, update: data });
    n++;
  }
  return n;
}

// ===================== Slab Update family (parameter backfill) =============
// Ports "Press/Oven/Distributor/Kreos Slab Update": copy machine parameters
// from the matching "Change Parameters X" record (latest whose Effective-from
// slab number <= the slab) into empty cells of each target slab record.

const READONLY_AT = new Set(["formula", "rollup", "multipleLookupValues", "count", "createdTime", "lastModifiedTime", "autoNumber", "button", "externalSyncSource"]);
const CONTROL_FIELDS = new Set(["effectiveFromSlabNumber", "effectiveFromSlabCount", "slabNumber", "batchKey", "airtableId", "id", "importedAt", "syncedAt"]);

function copyableFields(target: FMTable, change: FMTable): string[] {
  const targetPrisma = new Set(Object.values(target.fields).map((f) => f.prismaField));
  const out: string[] = [];
  for (const f of Object.values(change.fields)) {
    if (!targetPrisma.has(f.prismaField)) continue;
    if (CONTROL_FIELDS.has(f.prismaField)) continue;
    if (READONLY_AT.has(f.airtableType)) continue;
    if (f.kind === "json" || f.kind === "link") continue; // skip computed/links
    out.push(f.prismaField);
  }
  return out;
}

export interface SlabUpdateOpts { computeCookingTime?: boolean; maxRecords?: number; }

export async function applyChangeParameters(targetModel: string, changeModel: string, opts: SlabUpdateOpts = {}): Promise<number> {
  const target = tableByModel(targetModel);
  const change = tableByModel(changeModel);
  if (!target || !change) throw new Error(`fieldmap missing for ${targetModel}/${changeModel}`);
  const fields = copyableFields(target, change);
  const max = opts.maxRecords ?? 5000;

  const changeRows: any[] = await delegate(changeModel).findMany({
    select: Object.fromEntries([["effectiveFromSlabNumber", true], ...fields.map((f) => [f, true])]),
  });
  // sort changes by effective asc so the last <= slab wins
  changeRows.sort((a, b) => (a.effectiveFromSlabNumber ?? -Infinity) - (b.effectiveFromSlabNumber ?? -Infinity));
  const findBest = (slab: number) => {
    let best: any = null;
    for (const c of changeRows) {
      const eff = c.effectiveFromSlabNumber;
      if (typeof eff === "number" && eff <= slab) best = c; else if (typeof eff === "number" && eff > slab) break;
    }
    return best;
  };

  const targetSel: Record<string, boolean> = { id: true, slabNumber: true };
  for (const f of fields) targetSel[f] = true;
  if (opts.computeCookingTime) { targetSel.inTime = true; targetSel.outTime = true; targetSel.cookingTime = true; }
  const targetRows: any[] = await delegate(targetModel).findMany({ select: targetSel, take: max });

  let updated = 0;
  for (const row of targetRows) {
    const slab = typeof row.slabNumber === "number" ? row.slabNumber : parseFloat(row.slabNumber);
    if (!Number.isFinite(slab)) continue;
    const patch: Record<string, unknown> = {};
    const best = findBest(slab);
    if (best) {
      for (const f of fields) {
        const cur = row[f];
        const src = best[f];
        const empty = cur === null || cur === undefined || (Array.isArray(cur) && cur.length === 0);
        if (empty && src !== null && src !== undefined && !(Array.isArray(src) && src.length === 0)) patch[f] = src;
      }
    }
    if (opts.computeCookingTime && (row.cookingTime === null || row.cookingTime === undefined)) {
      const i = row.inTime, o = row.outTime;
      if (typeof i === "number" && typeof o === "number") {
        patch.cookingTime = o >= i ? Math.round((o - i) / 60) : Math.round((24 * 3600 - i + o) / 60);
      }
    }
    if (Object.keys(patch).length) { await delegate(targetModel).update({ where: { id: row.id }, data: patch }); updated++; }
  }
  return updated;
}

export async function runSlabUpdateFamily(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.Press = await applyChangeParameters("Press", "ChangeParametersPress");
  out.Oven = await applyChangeParameters("Oven", "ChangeParametersOven", { computeCookingTime: true });
  out.Distributor = await applyChangeParameters("Distributor", "ChangeParametersDistributor");
  out.Kreos = await applyChangeParameters("Kreos", "ChangeParametersKreos");
  return out;
}

// ============================ misc =========================================
export async function runSlabSummaryRefreshStats(): Promise<{ batches: number; slabs: number }> {
  const slabs = await prisma.polishEntry.count();
  const batches = (await distinctBatchKeys()).length;
  return { batches, slabs };
}
