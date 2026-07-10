// Phase 4 — batch-level slab -> Mixer Cycle link assigners + Roy cycle backfill.
// Ports: Realtime/Final Distributor Mixer-Cycle Link, Roy Mixer Robot Slab link,
// Roy Mixer Cycle Update. These set links / fill cells, so they run post-cutover
// (event-triggered on data entry); not invoked during the parallel-run phase.
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/erp";
import { normalizeBatch } from "@/lib/normalizeBatch";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const deleg = (m: string) => db[m[0].toLowerCase() + m.slice(1)];

async function cyclesForBatch(batchKey: string) {
  const c: any[] = await db.mixerCycle.findMany({ where: { batchKey }, select: { airtableId: true, cycle: true, totalCycleWeight: true } });
  return c.map((x) => ({ aid: x.airtableId, cycle: x.cycle ?? 0, w: num(x.totalCycleWeight) })).sort((a, b) => a.cycle - b.cycle);
}

// Realtime Distributor link — assign slabs to cycles by count (No. of slabs per
// Mixer Cycle, from the latest applicable Change Parameters Distributor row).
export async function assignDistributorByCount(batchKey: string) {
  const cycles = await cyclesForBatch(batchKey);
  if (!cycles.length) return { skipped: true };
  const cps: any[] = await db.changeParametersDistributor.findMany({ select: { batch: true, effectiveFromSlabNumber: true, noOfSlabsPerMixerCycle: true } });
  const cp = cps.filter((c) => normalizeBatch(c.batch) === batchKey).sort((a, b) => (b.effectiveFromSlabNumber ?? 0) - (a.effectiveFromSlabNumber ?? 0))[0];
  const perCycle = cp?.noOfSlabsPerMixerCycle || 1;
  const slabs: any[] = (await db.distributor.findMany({ where: { batchKey }, select: { id: true, slabNumber: true } })).sort((a: any, b: any) => (a.slabNumber ?? 0) - (b.slabNumber ?? 0));
  let idx = 0, count = 0, n = 0;
  for (const s of slabs) {
    const cyc = cycles[idx];
    if (cyc) { count++; if (count >= perCycle) { idx++; count = 0; } }
    await db.distributor.update({ where: { id: s.id }, data: { mixerCycleIds: cyc ? [cyc.aid] : [] } }); n++;
  }
  return { assigned: n, perCycle };
}

// Weight-based slab -> cycle assignment (Distributor "final" + Robot). Moves to
// the next cycle once the running remainder drops below half a slab's weight.
async function assignByWeight(model: string, batchKey: string, weightField: string, useWastage: boolean) {
  const cycles = await cyclesForBatch(batchKey);
  if (!cycles.length) return { skipped: true };
  const rows: any[] = (await deleg(model).findMany({ where: { batchKey }, select: { id: true, slabNumber: true, [weightField]: true } }))
    .map((r: any) => ({ id: r.id, slab: r.slabNumber ?? 0, w: num(r[weightField]) })).sort((a: any, b: any) => a.slab - b.slab);
  let wastagePct = 0;
  if (useWastage) {
    const totalCycle = cycles.reduce((a, c) => a + c.w, 0);
    const totalSlab = rows.reduce((a, r) => a + r.w, 0);
    wastagePct = totalCycle > 0 ? (totalCycle - totalSlab) / totalCycle : 0;
  }
  const adj = cycles.map((c) => ({ ...c, rem: c.w * (1 - wastagePct) }));
  let ci = 0, remainder = adj[0].rem, n = 0;
  for (const r of rows) {
    if (remainder < r.w / 2 && ci + 1 < adj.length) { ci++; remainder = adj[ci].rem; }
    await deleg(model).update({ where: { id: r.id }, data: { mixerCycleIds: [adj[ci].aid] } }); n++;
    remainder -= r.w;
  }
  return { assigned: n, wastagePct };
}
export const assignDistributorByWeight = (batchKey: string) => assignByWeight("Distributor", batchKey, "totalWeightAtDistributor", true);
export const assignRobotByWeight = (batchKey: string) => assignByWeight("Robot", batchKey, "r2BodyWeight", false);

// Roy Mixer Cycle Update — cycle-based parameter backfill from Change Parameters
// Roy Mixer Cycle (latest From Cycle <= Cycle), filling empty scalar/select cells.
export async function royMixerCycleUpdate(royId: string) {
  const rec: any = await db.royMixerCycle.findUnique({ where: { id: royId } });
  if (!rec?.batch || rec.cycle == null) return { skipped: true };
  const src: any[] = await db.changeParametersRoyMixerCycle.findMany({ where: { batch: rec.batch } });
  const best = src.filter((s) => s.fromCycle != null && s.fromCycle <= rec.cycle).sort((a, b) => b.fromCycle - a.fromCycle)[0];
  if (!best) return { skipped: true };
  const skip = new Set(["id", "airtableId", "importedAt", "syncedAt", "batchKey", "fromCycle", "cycle", "batch"]);
  const data: Record<string, unknown> = {};
  for (const k of Object.keys(best)) {
    if (skip.has(k)) continue;
    const cur = rec[k], srcv = best[k];
    const empty = cur === null || cur === undefined || (Array.isArray(cur) && cur.length === 0);
    if (empty && srcv !== null && srcv !== undefined && !(Array.isArray(srcv) && srcv.length === 0) && rec[k] !== undefined) data[k] = srcv;
  }
  if (Object.keys(data).length) await db.royMixerCycle.update({ where: { id: royId }, data });
  return { filled: Object.keys(data).length };
}
