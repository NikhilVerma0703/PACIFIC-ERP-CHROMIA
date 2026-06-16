// Phase 4 — Grit & Filler SILO allocator (faithful port of the Airtable
// "Grit and Filler update in Mixer Cycle" automation: ~450 lines, FIFO).
//
// For each Mixer Cycle grit slot (M{m}_W{g} weight + M{m}_G{g}_SN silo name)
// and the filler slot (Filler_Silo/Buffer + M{m}_F_W), allocate the required
// weight from matching SILO records in FIFO order (by SILO Increment), only
// committing when the full demand is met, then link the silo(s) and decrement
// SILO "Remaining Weight". FIFO across cycles is by numeric batch then cycle.
//
// dryRun (default true): compute the plan WITHOUT writing — safe during the
// parallel-run phase where Airtable remains the source of truth. After cutover,
// call with { dryRun: false } so the new system owns allocation.
import { prisma } from "@/lib/prisma";
import { ensureSiloDeficitBag } from "@/lib/backfill";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function parseBatchNumber(b: unknown): number {
  if (!b) return Infinity;
  const n = parseInt(String(b).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : Infinity;
}

interface SiloMem { id: string; airtableId: string; siloNo: string; incr: number; remaining: number; }
interface AllocResult { fulfilled: number; unfulfilled: number; silosTouched: number; mixerLinksSet: number; dryRun: boolean; }

async function loadSilos(): Promise<Record<string, SiloMem[]>> {
  const rows: any[] = await db.silo.findMany({
    select: { id: true, airtableId: true, siloNo: true, siloIncrement: true, remainingWeight: true },
  });
  const map: Record<string, SiloMem[]> = {};
  for (const s of rows) {
    const key = (s.siloNo ?? "").toString().trim().toLowerCase();
    if (!key) continue;
    (map[key] ||= []).push({ id: s.id, airtableId: s.airtableId, siloNo: key, incr: s.siloIncrement ?? 0, remaining: s.remainingWeight ?? 0 });
  }
  for (const k in map) map[k].sort((a, b) => a.incr - b.incr);
  return map;
}

interface Demand { recordId: string; siloNo: string; weight: number; batchNum: number; cycle: number; linkField: string; }

/** Allocate one stream of demands FIFO; mutates siloMap in memory; returns updates. */
function allocate(demands: Demand[], siloMap: Record<string, SiloMem[]>) {
  demands.sort((a, b) => (a.batchNum !== b.batchNum ? a.batchNum - b.batchNum : a.cycle - b.cycle));
  const siloUpdates = new Map<string, number>();          // siloId -> new remaining
  const mixerUpdates = new Map<string, Record<string, string[]>>(); // recordId -> {linkField: [siloAirtableId]}
  let fulfilled = 0, unfulfilled = 0;
  for (const d of demands) {
    const silos = siloMap[d.siloNo.toLowerCase()];
    if (!silos?.length) { unfulfilled++; continue; }
    let left = d.weight;
    const staged: { silo: SiloMem; newVal: number }[] = [];
    const used: string[] = [];
    for (const silo of silos) {
      if (left <= 0) break;
      if (silo.remaining <= 0) continue;
      const take = Math.min(silo.remaining, left);
      left -= take;
      used.push(silo.airtableId);
      staged.push({ silo, newVal: silo.remaining - take });
    }
    if (left <= 1e-9 && used.length) {
      const mu = mixerUpdates.get(d.recordId) ?? {};
      mu[d.linkField] = used;
      mixerUpdates.set(d.recordId, mu);
      for (const { silo, newVal } of staged) { silo.remaining = newVal; siloUpdates.set(silo.id, newVal); }
      fulfilled++;
    } else unfulfilled++;
  }
  return { siloUpdates, mixerUpdates, fulfilled, unfulfilled };
}

function mixerSelect() {
  const sel: Record<string, boolean> = { id: true, batch: true, cycle: true, fillerSiloBuffer: true, fillerSiloIdIds: true };
  for (let m = 1; m <= 4; m++) {
    sel[`m${m}FW`] = true;
    for (let g = 1; g <= 5; g++) { sel[`m${m}W${g}`] = true; sel[`m${m}G${g}Sn`] = true; sel[`m${m}G${g}Ids`] = true; }
  }
  return sel;
}

export async function runGritFillerAllocator(opts: { dryRun?: boolean } = {}): Promise<AllocResult> {
  const dryRun = opts.dryRun ?? true;
  const siloMap = await loadSilos();
  const mixer: any[] = await db.mixerCycle.findMany({ select: mixerSelect() });

  // --- collect unlinked GRIT demands ---
  const grit: Demand[] = [];
  for (const r of mixer) {
    const batchNum = parseBatchNumber(r.batch);
    const cycle = r.cycle ?? 0;
    for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) {
      const weight = r[`m${m}W${g}`] ?? 0;
      const siloNo = (r[`m${m}G${g}Sn`] ?? "").toString().trim();
      const link = r[`m${m}G${g}Ids`] as string[] | null;
      if (!weight || !siloNo || (link && link.length > 0)) continue;
      grit.push({ recordId: r.id, siloNo, weight, batchNum, cycle, linkField: `m${m}G${g}Ids` });
    }
  }
  // --- collect unlinked FILLER demands (sum of M{m}_F_W) ---
  const filler: Demand[] = [];
  for (const r of mixer) {
    const siloNo = (r.fillerSiloBuffer ?? "").toString().trim();
    const link = r.fillerSiloIdIds as string[] | null;
    const total = (r.m1FW ?? 0) + (r.m2FW ?? 0) + (r.m3FW ?? 0) + (r.m4FW ?? 0);
    if (!siloNo || total <= 0 || (link && link.length > 0)) continue;
    filler.push({ recordId: r.id, siloNo, weight: total, batchNum: parseBatchNumber(r.batch), cycle: r.cycle ?? 0, linkField: "fillerSiloIdIds" });
  }

  const g = allocate(grit, siloMap);
  const f = allocate(filler, siloMap);

  const siloUpdates = new Map<string, number>([...g.siloUpdates, ...f.siloUpdates]);
  const mixerUpdates = new Map<string, Record<string, string[]>>();
  for (const [id, u] of [...g.mixerUpdates, ...f.mixerUpdates]) mixerUpdates.set(id, { ...(mixerUpdates.get(id) ?? {}), ...u });

  if (!dryRun) {
    for (const [siloId, remaining] of siloUpdates) await db.silo.update({ where: { id: siloId }, data: { remainingWeight: remaining } });
    for (const [recordId, fields] of mixerUpdates) await db.mixerCycle.update({ where: { id: recordId }, data: fields });
  }

  return {
    fulfilled: g.fulfilled + f.fulfilled,
    unfulfilled: g.unfulfilled + f.unfulfilled,
    silosTouched: siloUpdates.size,
    mixerLinksSet: mixerUpdates.size,
    dryRun,
  };
}

// Allocate the grit + filler demands of ONE Mixer Cycle record against current
// SILO stock, FIFO (oldest bag first), committing a slot only if fully met.
// Links the consumed bag(s) to the cycle and decrements SILO Remaining Weight.
export interface MixerAllocResult { message: string; gritFulfilled: number; gritUnfulfilled: number; fillerFulfilled: number; fillerUnfulfilled: number; bagsLinked: number; shortfalls: { slot: string; siloNo: string; short: number }[]; }

export async function allocateMixerCycle(recordId: string): Promise<MixerAllocResult> {
  const empty: MixerAllocResult = { message: "", gritFulfilled: 0, gritUnfulfilled: 0, fillerFulfilled: 0, fillerUnfulfilled: 0, bagsLinked: 0, shortfalls: [] };
  const rec: any = await db.mixerCycle.findUnique({ where: { id: recordId }, select: mixerSelect() });
  if (!rec) return { ...empty, message: "record not found" };

  const siloMap = await loadSilos();
  const siloUpdates = new Map<string, number>();          // siloId -> new remaining
  const mixerData: Record<string, string[]> = {};         // linkField -> [siloAirtableId]
  const res: MixerAllocResult = { ...empty, shortfalls: [] };

  // Draw the FULL demand. Whatever the silo's recorded bags can't cover lands
  // on the silo's deficit placeholder (remaining goes negative) — physical
  // material is ahead of data entry; a later fill absorbs it and re-links.
  const consume = async (siloName: string, weight: number, linkField: string): Promise<boolean> => {
    const key = (siloName || "").trim();
    const silos = siloMap[key.toLowerCase()] ?? [];
    let left = weight; const staged: { silo: SiloMem; newVal: number }[] = []; const used: string[] = [];
    for (const silo of silos) {
      if (left <= 0) break;
      if (silo.remaining <= 0 || silo.airtableId.startsWith("deficit_")) continue;
      const take = Math.min(silo.remaining, left);
      left -= take; used.push(silo.airtableId); staged.push({ silo, newVal: silo.remaining - take });
    }
    for (const { silo, newVal } of staged) { silo.remaining = newVal; siloUpdates.set(silo.id, newVal); }
    if (left > 1e-9) {
      // overflow -> deficit placeholder (use the EXACT silo name as recorded)
      const ph = await ensureSiloDeficitBag(key);
      const mem = silos.find((s) => s.airtableId === ph.airtableId);
      const cur = mem ? mem.remaining : ph.remaining;
      const newVal = cur - left;
      if (mem) mem.remaining = newVal;
      siloUpdates.set(ph.id, newVal);
      used.push(ph.airtableId);
      res.shortfalls.push({ slot: linkField, siloNo: siloName, short: left });
    }
    if (used.length) mixerData[linkField] = used;
    return left <= 1e-9;
  };

  // Grit slots M1..M4 G1..G5
  for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) {
    const weight = rec[`m${m}W${g}`] ?? 0;
    const sn = (rec[`m${m}G${g}Sn`] ?? "").toString().trim();
    const link = rec[`m${m}G${g}Ids`] as string[] | null;
    if (!weight || !sn || (link && link.length > 0)) continue;
    if (await consume(sn, weight, `m${m}G${g}Ids`)) res.gritFulfilled++; else res.gritUnfulfilled++;
  }
  // Filler slot
  const fillerName = (rec.fillerSiloBuffer ?? "").toString().trim();
  const fillerTotal = (rec.m1FW ?? 0) + (rec.m2FW ?? 0) + (rec.m3FW ?? 0) + (rec.m4FW ?? 0);
  const fillerLink = rec.fillerSiloIdIds as string[] | null;
  if (fillerName && fillerTotal > 0 && !(fillerLink && fillerLink.length > 0)) {
    if (await consume(fillerName, fillerTotal, "fillerSiloIdIds")) res.fillerFulfilled++; else res.fillerUnfulfilled++;
  }

  // Persist (real)
  for (const [siloId, remaining] of siloUpdates) await db.silo.update({ where: { id: siloId }, data: { remainingWeight: remaining } });
  if (Object.keys(mixerData).length) await db.mixerCycle.update({ where: { id: recordId }, data: mixerData });

  res.bagsLinked = siloUpdates.size;
  const gTotal = res.gritFulfilled + res.gritUnfulfilled;
  const fTotal = res.fillerFulfilled + res.fillerUnfulfilled;
  const unbackedKg = Math.round(res.shortfalls.reduce((a, s) => a + s.short, 0));
  res.message = `✓ Saved — FIFO linked ${res.bagsLinked} bag(s)` +
    (gTotal ? ` · grit ${res.gritFulfilled}/${gTotal}` : "") +
    (fTotal ? ` · filler ${res.fillerFulfilled}/${fTotal}` : "") +
    (res.shortfalls.length ? ` · ⚠ ${unbackedKg} kg drawn UNBACKED (${[...new Set(res.shortfalls.map((s) => s.siloNo))].join(", ")} below zero — fill the silo and it auto-links)` : "");
  return res;
}
