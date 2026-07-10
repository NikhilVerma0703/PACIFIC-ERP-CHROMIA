// Current raw-material stock — Accepted RM bags not yet dumped into a silo,
// grouped by material (type · size · grade) with invoice/bag-number detail,
// plus resin lots with remaining quantity. Shown on the Live Status page.
import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface RmInvoice { invNo: string; bags: number; minBag: number | null; maxBag: number | null; }
export interface RmGroup { type: string; size: string; grade: string; supplier: string; bags: number; kg: number; invoices: RmInvoice[]; }
export interface ResinLot { tankNo: string; supplier: string; invNo: string; remaining: number; quantity: number; active: boolean; }
export interface DailyTank { tankNo: string; remaining: number; quantity: number; silane: number | null; cobalt: number | null; incharge: string | null; status: string | null; at: Date | null; active: boolean; deficit: number; }
export interface RmStock { grit: RmGroup[]; filler: RmGroup[]; other: RmGroup[]; resin: ResinLot[]; daily: DailyTank[]; }

const normSize = (s: unknown) => String(s ?? "").replace(/\s+/g, "") || "?";
// Filler mesh sizes appear as both "400#" and "#400"; move the hash to the end
// so the two variants group as one size.
const canonSize = (sz: string) => { const t = sz.replace(/\s+/g, ""); return t.includes("#") ? t.replace(/#/g, "") + "#" : t; };
const ACTIVE_MS = 30 * 60 * 1000;

/** Daily resin tanks used by a mixer cycle entered in the last 30 min. */
async function recentlyUsedTanks(cutoff: Date): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const rows: any[] = await db.mixerCycle.findMany({ where: { importedAt: { gte: cutoff } }, select: { m1RDtn: true, m2RDtn: true, m3RDtn: true, m4RDtn: true } });
    for (const r of rows) for (const k of ["m1RDtn", "m2RDtn", "m3RDtn", "m4RDtn"]) { const v = String(r[k] ?? "").trim(); if (v) out.add(v); }
  } catch { /* best-effort */ }
  return out;
}

interface InvAgg { bags: number; min: number | null; max: number | null; latest: number; }
interface GroupAgg { type: string; size: string; grade: string; suppliers: Set<string>; bags: number; kg: number; inv: Map<string, InvAgg>; }

export async function getRmStock(): Promise<RmStock> {
  // Aggregated in Postgres: one row per material x invoice (dozens of rows)
  // instead of every in-stock bag (thousands) — identical grouping rules.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agg: any[] = [];
  try {
    agg = await db.$queryRaw`
      SELECT COALESCE(type, '?')                                                AS type,
             COALESCE(NULLIF(regexp_replace(COALESCE(size, ''), '\s+', '', 'g'), ''), '?') AS size,
             COALESCE(grade, '—')                                               AS grade,
             COALESCE(name_from_supplier_master->>0, '—') AS supplier,
             COALESCE(inv_no, '?')                                              AS inv,
             COUNT(*)::int                                                      AS bags,
             COALESCE(SUM(bag_weight), 0)::float                                AS kg,
             MIN(bag_no)::float                                                 AS min_bag,
             MAX(bag_no)::float                                                 AS max_bag,
             MAX(date)                                                          AS latest
      FROM rm
      WHERE cardinality(silo) = 0
        AND (status IS NULL OR status = 'Accepted')
        AND NOT (COALESCE(type, '') = '' AND COALESCE(size, '') = '')
      GROUP BY 1, 2, 3, 4, 5`;
  } catch { agg = []; }

  const groups = new Map<string, GroupAgg>();
  for (const r of agg) {
    const size = canonSize(r.size);
    const k = `${r.type}|${size}|${r.grade}`;
    let g = groups.get(k);
    if (!g) { g = { type: r.type, size, grade: r.grade, suppliers: new Set<string>(), bags: 0, kg: 0, inv: new Map() }; groups.set(k, g); }
    if (r.supplier && r.supplier !== "—") g.suppliers.add(r.supplier);
    g.bags += r.bags; g.kg += r.kg ?? 0;
    g.inv.set(r.inv, {
      bags: r.bags,
      min: r.min_bag ?? null,
      max: r.max_bag ?? null,
      latest: r.latest ? new Date(r.latest).getTime() : 0,
    });
  }

  const toGroup = (g: GroupAgg): RmGroup => ({
    type: g.type, size: g.size, grade: g.grade, supplier: [...g.suppliers].sort().join(", ") || "—", bags: g.bags, kg: Math.round(g.kg),
    invoices: [...g.inv.entries()].sort((a, b) => b[1].latest - a[1].latest)
      .map(([invNo, i]) => ({ invNo, bags: i.bags, minBag: i.min, maxBag: i.max })),
  });
  const all = [...groups.values()].map(toGroup).sort((a, b) => b.kg - a.kg);

  // storage tanks — the latest delivery per tank is its current state
  let resin: ResinLot[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rs: any[] = await db.resinStorage.findMany({
      orderBy: { date: "desc" }, take: 300,
      select: { tankNo: true, supplier: true, invoiceNo: true, quantity: true, quantityRemaining: true, importedAt: true },
    });
    const cutoff = new Date(Date.now() - ACTIVE_MS);
    const seen = new Set<string>();
    for (const r of rs) {
      const t = r.tankNo ?? "?";
      if (seen.has(t)) continue;
      seen.add(t);
      resin.push({ tankNo: t, supplier: r.supplier ?? "—", invNo: r.invoiceNo ?? "—", remaining: Math.round(r.quantityRemaining ?? 0), quantity: Math.round(r.quantity ?? 0), active: r.importedAt ? new Date(r.importedAt) >= cutoff : false });
    }
    resin.sort((a, b) => a.tankNo.localeCompare(b.tankNo));
  } catch { resin = []; }

  // daily resin tanks — the latest preparation per tank is its current state
  let daily: DailyTank[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cutoff2 = new Date(Date.now() - ACTIVE_MS);
    const [rows, usedTanks]: [any[], Set<string>] = await Promise.all([
      db.dailyResinTank.findMany({
        orderBy: { date: "desc" }, take: 300,
        select: { dailyTankNo: true, quantity: true, remainingWeight: true, silane: true, cobalt: true, incharge: true, usageStatus: true, date: true, importedAt: true },
      }),
      recentlyUsedTanks(cutoff2),
    ]);
    const prepRecent = new Set<string>();
    const deficitByTank = new Map<string, number>();
    for (const r of rows) {
      if (r.importedAt && new Date(r.importedAt) >= cutoff2 && r.dailyTankNo) prepRecent.add(String(r.dailyTankNo));
      const rem = r.remainingWeight ?? 0;
      if (rem < 0 && r.dailyTankNo) deficitByTank.set(String(r.dailyTankNo), (deficitByTank.get(String(r.dailyTankNo)) ?? 0) + rem);
    }
    const seen = new Set<string>();
    for (const r of rows) {
      const t = r.dailyTankNo ?? "?";
      if (seen.has(t)) continue;
      seen.add(t);
      daily.push({ tankNo: t, remaining: Math.round((r.remainingWeight ?? 0) * 10) / 10, quantity: Math.round(r.quantity ?? 0), silane: r.silane ?? null, cobalt: r.cobalt ?? null, incharge: r.incharge ?? null, status: r.usageStatus ?? null, at: r.date ?? null, active: usedTanks.has(t) || prepRecent.has(t), deficit: Math.round((deficitByTank.get(t) ?? 0) * 10) / 10 });
    }
    daily.sort((a, b) => a.tankNo.localeCompare(b.tankNo));
  } catch { daily = []; }

  return {
    grit: all.filter((g) => g.type === "Grit"),
    filler: all.filter((g) => g.type === "Filler"),
    other: all.filter((g) => g.type !== "Grit" && g.type !== "Filler"),
    resin,
    daily,
  };
}
