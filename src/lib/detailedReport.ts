// "Detailed Production Report" — reproduces the Excel batch report:
// header block, cycle/weight rows, slab counts by thickness, silo status
// (reconstructed), and the material-consumption table with wastage totals.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { canonThickness } from "@/lib/thickness";

const db = prisma as any;

function lookup(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) { const x = (v as unknown[]).find((y) => y != null && y !== ""); return x == null ? null : String(x); }
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s || null;
}

export interface CycleGroupRow { cycles: number; m: [number, number, number, number]; total: number; }
export interface SiloStatRow { siloNo: string; material: string; supplier: string; startKg: number; endKg: number; }
export interface MaterialRow {
  desc: string; supplier: string; grade: string; invoices: string; bagNums: string;
  totalBags: number | null; weightPerBag: number | null; consumption: number;
}
export interface DetailedReport {
  found: boolean;
  batch: string;
  design: string | null;
  startAt: Date | null; endAt: Date | null;
  cycleGroups: CycleGroupRow[];
  totalCycles: number;
  batchWeightTotal: number;
  slabs: { mm12: number; mm20: number; mm30: number; from: number | null; to: number | null; total: number };
  silos: SiloStatRow[];
  materials: MaterialRow[];
  consumptionTotal: number;
  unbackedKg: number;   // mix drawn from an unbacked/written-off silo (no itemised source)
  avgByThickness: { mm12: number | null; mm20: number | null; mm30: number | null };
  outputKg: number;
  wastagePct: number | null;
  wastageKg: number | null;
}

const r1 = (n: number) => Math.round(n * 100) / 100;

export async function getDetailedReport(input: string): Promise<DetailedReport> {
  const key = normalizeBatch(input);

  const cycleSelect: Record<string, boolean> = { cycle: true, createTime: true, mixerStartTime: true, mixerEndTime: true, fillerSiloBuffer: true, fillerSiloIdIds: true };
  for (let n = 1; n <= 4; n++) {
    cycleSelect[`mixer${n}`] = true;
    cycleSelect[`m${n}FW`] = true;
    cycleSelect[`m${n}RW`] = true;
    for (let g = 1; g <= 5; g++) {
      cycleSelect[`m${n}W${g}`] = true;
      cycleSelect[`m${n}G${g}Sn`] = true;
      cycleSelect[`m${n}G${g}Ids`] = true;
    }
  }

  const [cycles, press] = await Promise.all([
    db.mixerCycle.findMany({ where: { batchKey: key }, select: cycleSelect, orderBy: { cycle: "asc" } }),
    db.press.findMany({ where: { batchKey: key }, select: { slabNumber: true, slabWeight: true, designName: true, date: true } }),
  ]);
  if (!cycles.length && !press.length) {
    return { found: false, batch: key, design: null, startAt: null, endAt: null, cycleGroups: [], totalCycles: 0, batchWeightTotal: 0, slabs: { mm12: 0, mm20: 0, mm30: 0, from: null, to: null, total: 0 }, silos: [], materials: [], consumptionTotal: 0, unbackedKg: 0, avgByThickness: { mm12: null, mm20: null, mm30: null }, outputKg: 0, wastagePct: null, wastageKg: null };
  }

  // ---- header times & design ----
  const starts = cycles.map((c: any) => c.mixerStartTime ?? c.createTime).filter(Boolean).map((d: Date) => d.getTime());
  const ends = [...cycles.map((c: any) => c.mixerEndTime ?? c.createTime), ...press.map((p: any) => p.date)].filter(Boolean).map((d: Date) => d.getTime());
  const startAt = starts.length ? new Date(Math.min(...starts)) : null;
  const endAt = ends.length ? new Date(Math.max(...ends)) : null;
  const design = press.map((p: any) => p.designName).find(Boolean) ?? null;

  // ---- cycle groups (per-mixer per-cycle weight signatures) ----
  const groups = new Map<string, { cycles: number; sumM: [number, number, number, number]; total: number }>();
  let resinKg = 0;
  const consumptionBySilo = new Map<string, number>();
  const bagIdsBySilo = new Map<string, Set<string>>();

  for (const c of cycles as any[]) {
    const w: [number, number, number, number] = [0, 0, 0, 0];
    for (let n = 1; n <= 4; n++) {
      let sum = 0;
      for (let g = 1; g <= 5; g++) {
        const v = c[`m${n}W${g}`] ?? 0;
        sum += v;
        const sn = c[`m${n}G${g}Sn`];
        if (sn && v) consumptionBySilo.set(sn, (consumptionBySilo.get(sn) ?? 0) + v);
        const ids: string[] = c[`m${n}G${g}Ids`] ?? [];
        if (sn && ids.length) {
          const set = bagIdsBySilo.get(sn) ?? new Set<string>();
          ids.forEach((i) => set.add(i));
          bagIdsBySilo.set(sn, set);
        }
      }
      const fw = c[`m${n}FW`] ?? 0;
      const rw = c[`m${n}RW`] ?? 0;
      sum += fw + rw;
      resinKg += rw;
      const fillerSilo = c.fillerSiloBuffer;
      if (fillerSilo && fw) consumptionBySilo.set(fillerSilo, (consumptionBySilo.get(fillerSilo) ?? 0) + fw);
      if (fillerSilo && (c.fillerSiloIdIds ?? []).length) {
        const set = bagIdsBySilo.get(fillerSilo) ?? new Set<string>();
        (c.fillerSiloIdIds as string[]).forEach((i) => set.add(i));
        bagIdsBySilo.set(fillerSilo, set);
      }
      w[n - 1] = sum;
    }
    // bucket per-mixer weight to the nearest 100 kg so 1,189 vs 1,201 group together
    const sig = w.map((x) => Math.round(x / 100)).join("|");
    const g = groups.get(sig) ?? { cycles: 0, sumM: [0, 0, 0, 0] as [number, number, number, number], total: 0 };
    g.cycles++;
    for (let i = 0; i < 4; i++) g.sumM[i] += w[i];
    g.total += w[0] + w[1] + w[2] + w[3];
    groups.set(sig, g);
  }
  const cycleGroups: CycleGroupRow[] = [...groups.values()]
    .map((g) => ({ cycles: g.cycles, m: g.sumM.map((x) => Math.round(x / g.cycles)) as [number, number, number, number], total: Math.round(g.total) }))
    .sort((a, b) => b.cycles - a.cycles);
  const batchWeightTotal = cycleGroups.reduce((a, g) => a + g.total, 0);

  // ---- slabs: counts by thickness, from/to ----
  const slabNos = press.map((p: any) => p.slabNumber).filter((n: any) => typeof n === "number");
  const from = slabNos.length ? Math.min(...slabNos) : null;
  const to = slabNos.length ? Math.max(...slabNos) : null;
  // thickness source: first slab station carrying slabThickness with data for this batch
  let thicknessRows: { slabNumber: number | null; slabThickness: string | null }[] = [];
  {
    // all stations queried in parallel; first (in priority order) with data wins
    const stations = ["oven", "jot", "distributor", "kreos", "polishEntry"];
    const results = await Promise.all(stations.map((station) =>
      db[station].findMany({ where: { batchKey: key, slabThickness: { not: null } }, select: { slabNumber: true, slabThickness: true } }).catch(() => [] as any[])
    ));
    thicknessRows = results.find((rows) => rows.length) ?? [];
  }
  const counts = { mm12: 0, mm20: 0, mm30: 0 };
  const thicknessBySlab = new Map<number, string>();
  for (const r of thicknessRows) {
    const t = canonThickness(r.slabThickness);
    if (typeof r.slabNumber === "number") thicknessBySlab.set(r.slabNumber, t);
    if (t === "1.2 cm") counts.mm12++;
    else if (t === "2 cm") counts.mm20++;
    else if (t === "3 cm") counts.mm30++;
  }
  const slabs = { ...counts, from, to, total: press.length };

  // ---- silo materials & bag detail ----
  const allBagIds = [...new Set([...bagIdsBySilo.values()].flatMap((s) => [...s]))];
  const bagRows: any[] = allBagIds.length
    ? await db.silo.findMany({ where: { airtableId: { in: allBagIds } }, select: { airtableId: true, siloNo: true, weight: true, sizeFromUsedBag: true, gradeFromUsedBag: true, typeFromUsedBag: true, nameFromSupplierMasterFromUsedBag: true, invNoFromUsedBag: true, bagNoFromUsedBag: true } })
    : [];
  const bagById = new Map(bagRows.map((b) => [b.airtableId, b]));

  // current remaining per used silo (for status reconstruction)
  const usedSilos = [...consumptionBySilo.keys()];
  // fallback material info: latest bag with lookups per silo (older cycles lack bag links)
  const fallbackBySilo = new Map<string, any>();
  for (const sn of usedSilos) {
    if ([...(bagIdsBySilo.get(sn) ?? [])].length) continue;
    try {
      const row = await db.silo.findFirst({ where: { siloNo: sn, sizeFromUsedBag: { not: { equals: null } } }, orderBy: { siloIncrement: "desc" }, select: { sizeFromUsedBag: true, gradeFromUsedBag: true, nameFromSupplierMasterFromUsedBag: true, invNoFromUsedBag: true, weight: true } });
      if (row) fallbackBySilo.set(sn, row);
    } catch { /* ignore */ }
  }
  const remainingBySilo = new Map<string, number>();
  if (usedSilos.length) {
    try {
      const rem: any[] = await db.silo.groupBy({ by: ["siloNo"], where: { siloNo: { in: usedSilos } }, _sum: { remainingWeight: true } });
      for (const r of rem) remainingBySilo.set(r.siloNo, r._sum?.remainingWeight ?? 0);
    } catch { /* ignore */ }
  }

  const silos: SiloStatRow[] = usedSilos.map((sn) => {
    const bags = [...(bagIdsBySilo.get(sn) ?? [])].map((id) => bagById.get(id)).filter(Boolean) as any[];
    const sample = bags[0] ?? fallbackBySilo.get(sn);
    const material = sample ? [lookup(sample.sizeFromUsedBag), lookup(sample.gradeFromUsedBag)].filter(Boolean).join(" · ") : "—";
    const supplier = sample ? (lookup(sample.nameFromSupplierMasterFromUsedBag) ?? "—") : "—";
    const endKg = Math.round(remainingBySilo.get(sn) ?? 0);
    return { siloNo: sn, material: material || "—", supplier, endKg, startKg: Math.round(endKg + (consumptionBySilo.get(sn) ?? 0)) };
  }).sort((a, b) => a.siloNo.localeCompare(b.siloNo));

  // ---- materials consumption table ----
  const materials: MaterialRow[] = [];
  // resin
  if (resinKg > 0) {
    let resinSupplier = "—";
    try {
      const rs = await db.resinStorage.findFirst({ orderBy: { date: "desc" }, select: { supplier: true } });
      resinSupplier = rs?.supplier ?? "—";
    } catch { /* ignore */ }
    materials.push({ desc: "Resin", supplier: resinSupplier, grade: "Premium", invoices: "", bagNums: "", totalBags: null, weightPerBag: null, consumption: r1(resinKg) });
  }
  // silane & cobalt from daily-tank dosing ratios
  try {
    const tanks: any[] = await db.dailyResinTank.findMany({ orderBy: { date: "desc" }, take: 10, select: { silane: true, cobalt: true } });
    const sil = tanks.map((t) => t.silane).filter((x) => typeof x === "number");
    const cob = tanks.map((t) => t.cobalt).filter((x) => typeof x === "number");
    if (resinKg > 0 && sil.length) materials.push({ desc: "Silane", supplier: "—", grade: "Premium", invoices: "", bagNums: "", totalBags: null, weightPerBag: null, consumption: r1(resinKg * (sil.reduce((a, b) => a + b, 0) / sil.length)) });
    if (resinKg > 0 && cob.length) materials.push({ desc: "Cobalt", supplier: "—", grade: "Premium", invoices: "", bagNums: "", totalBags: null, weightPerBag: null, consumption: r1(resinKg * (cob.reduce((a, b) => a + b, 0) / cob.length)) });
  } catch { /* ignore */ }
  // grit / filler per silo-material
  for (const s of silos) {
    const bags = [...(bagIdsBySilo.get(s.siloNo) ?? [])].map((id) => bagById.get(id)).filter(Boolean) as any[];
    const sample = bags[0] ?? fallbackBySilo.get(s.siloNo);
    const invoices = [...new Set(bags.map((b) => lookup(b.invNoFromUsedBag)).filter(Boolean))].join(", ");
    const bagNos = bags.map((b) => lookup(b.bagNoFromUsedBag)).filter(Boolean).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const bagNums = bagNos.length ? (bagNos.length === 1 ? `#${bagNos[0]}` : `#${bagNos[0]}–${bagNos[bagNos.length - 1]}`) : "";
    const weights = bags.map((b) => b.weight).filter((w) => typeof w === "number");
    materials.push({
      desc: sample ? (lookup(sample.sizeFromUsedBag) ?? s.siloNo) : s.siloNo,
      supplier: s.supplier,
      grade: sample ? (lookup(sample.gradeFromUsedBag) ?? "—") : "—",
      invoices, bagNums,
      totalBags: bags.length || null,
      weightPerBag: weights.length ? r1(weights.reduce((a, b) => a + b, 0) / weights.length) : null,
      consumption: r1(consumptionBySilo.get(s.siloNo) ?? 0),
    });
  }
  const consumptionTotal = r1(materials.reduce((a, m) => a + m.consumption, 0));

  // ---- output & wastage ----
  const outputKg = Math.round(press.reduce((a: number, p: any) => a + (p.slabWeight ?? 0), 0));
  const sums = { mm12: [0, 0], mm20: [0, 0], mm30: [0, 0] } as Record<string, [number, number]>;
  for (const p of press as any[]) {
    if (typeof p.slabNumber !== "number" || typeof p.slabWeight !== "number") continue;
    const t = thicknessBySlab.get(p.slabNumber);
    const k = t === "1.2 cm" ? "mm12" : t === "2 cm" ? "mm20" : t === "3 cm" ? "mm30" : null;
    if (k) { sums[k][0] += p.slabWeight; sums[k][1]++; }
  }
  const avg = (k: string) => (sums[k][1] ? Math.round(sums[k][0] / sums[k][1]) : null);
  // Wastage is measured against the FULL mix input (the mixer weight), not just
  // the silo-attributable materials — material drawn from an unbacked/written-off
  // silo still went into the mix. unbackedKg bridges the itemised total to the input.
  const unbackedKg = r1(Math.max(0, batchWeightTotal - consumptionTotal));
  const wastageKg = batchWeightTotal > 0 ? r1(batchWeightTotal - outputKg) : null;
  const wastagePct = batchWeightTotal > 0 ? r1(((batchWeightTotal - outputKg) / batchWeightTotal) * 100) : null;

  return {
    found: true, batch: key, design, startAt, endAt,
    cycleGroups, totalCycles: cycles.length, batchWeightTotal,
    slabs, silos, materials, consumptionTotal, unbackedKg,
    avgByThickness: { mm12: avg("mm12"), mm20: avg("mm20"), mm30: avg("mm30") },
    outputKg, wastagePct, wastageKg,
  };
}
