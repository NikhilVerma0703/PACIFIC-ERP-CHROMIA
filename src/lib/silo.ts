// Live silo status. 16 grit silos (101-108, 201-208) + filler buffer towers.
// Each Silo row is a bag dumped into a silo (FIFO by siloIncrement). Live
// contents = bags with remainingWeight > 0. Material (size / quality / type /
// supplier) is denormalised onto each Silo row as Airtable lookups from the
// Used Bag — read directly, no RM join needed. Works for grit and filler.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";

export const GRIT_SILOS: string[] = [
  "101", "102", "103", "104", "105", "106", "107", "108",
  "201", "202", "203", "204", "205", "206", "207", "208",
];

// The four filler buffer towers — always shown (even when empty), same as grit silos.
export const FILLER_SILOS: string[] = [
  "Filler A Buffer A", "Filler A Buffer B", "Filler B Buffer A", "Filler B Buffer B",
];

export type SiloKind = "grit" | "filler" | "other";
export function siloKind(siloNo: string): SiloKind {
  if (GRIT_SILOS.includes(siloNo)) return "grit";
  if (/filler|buffer/i.test(siloNo)) return "filler";
  return "other";
}

export interface Material { size: string | null; grade: string | null; type: string | null; supplier: string | null }

function lookup(v: any): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) { const u = [...new Set(v.map((x) => String(x).trim()).filter(Boolean))]; return u.length ? u.join(", ") : null; }
  if (typeof v === "object" && "value" in v) return lookup((v as any).value);
  const s = String(v).trim();
  return s && s !== "[object Object]" ? s : null;
}

// Material lookups present on each Silo row (from the Used Bag).
const SILO_MAT_SELECT = {
  sizeFromUsedBag: true,
  gradeFromUsedBag: true,
  typeFromUsedBag: true,
  nameFromSupplierMasterFromUsedBag: true,
} as const;

function bagMaterial(r: any): Material {
  return {
    size: lookup(r.sizeFromUsedBag),
    grade: lookup(r.gradeFromUsedBag),
    type: lookup(r.typeFromUsedBag),
    supplier: lookup(r.nameFromSupplierMasterFromUsedBag),
  };
}
const hasMat = (m: Material) => !!(m.size || m.grade || m.type || m.supplier);
const norm = (s: unknown) => String(s ?? "").trim();

export interface SiloCard {
  siloNo: string;
  kind: "grit" | "filler";
  remaining: number;
  bags: number;
  size: string | null;
  grade: string | null;
  type: string | null;
  supplier: string | null;
  mixed: boolean;
  active: boolean; // filled or drawn from in the last 30 min
}

const ACTIVE_MS = 30 * 60 * 1000;

/** Silos with activity in the last 30 min: a bag dumped in, or a mixer cycle
 * entered that names them (grit slots / filler buffer). */
async function recentlyActiveSilos(): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - ACTIVE_MS);
  const active = new Set<string>();
  try {
    const sel: Record<string, boolean> = { fillerSiloBuffer: true };
    for (let m = 1; m <= 4; m++) for (let g = 1; g <= 8; g++) sel[`m${m}G${g}Sn`] = true;
    const [fills, cycles] = await Promise.all([
      prisma.silo.findMany({ where: { importedAt: { gte: cutoff }, siloNo: { not: null } }, select: { siloNo: true } }),
      (prisma as any).mixerCycle.findMany({ where: { importedAt: { gte: cutoff } }, select: sel }),
    ]);
    for (const f of fills) { const s = norm(f.siloNo); if (s) active.add(s); }
    for (const c of cycles) for (const k of Object.keys(sel)) { const v = norm((c as any)[k]); if (v) active.add(v); }
  } catch { /* activity lights are best-effort */ }
  return active;
}

export async function getSiloOverview(): Promise<{ grit: SiloCard[]; filler: SiloCard[] }> {
  let bags: any[] = [];
  let activeSet = new Set<string>();
  try {
    [bags, activeSet] = await Promise.all([
      prisma.silo.findMany({
        // include NEGATIVE remainders (unbacked draws) so totals stay truthful
        where: { siloNo: { not: null }, NOT: { remainingWeight: 0 }, remainingWeight: { not: null } },
        select: { siloNo: true, remainingWeight: true, ...SILO_MAT_SELECT },
      }),
      recentlyActiveSilos(),
    ]);
  } catch {
    return { grit: GRIT_SILOS.map((s) => emptyCard(s, "grit")), filler: [] };
  }

  interface Acc { remaining: number; bags: number; combos: Set<string>; size: string | null; grade: string | null; type: string | null; supplier: string | null }
  const bySilo = new Map<string, Acc>();
  for (const b of bags) {
    const s = norm(b.siloNo);
    if (!s) continue;
    const m = bagMaterial(b);
    const a = bySilo.get(s) ?? { remaining: 0, bags: 0, combos: new Set<string>(), size: null, grade: null, type: null, supplier: null };
    a.remaining += b.remainingWeight ?? 0;
    if ((b.remainingWeight ?? 0) > 0) a.bags += 1; // deficit placeholders aren't bags
    if (hasMat(m)) {
      a.combos.add(`${m.size ?? ""}|${m.grade ?? ""}|${m.type ?? ""}`);
      a.size ??= m.size; a.grade ??= m.grade; a.type ??= m.type; a.supplier ??= m.supplier;
    }
    bySilo.set(s, a);
  }

  const card = (s: string, kind: "grit" | "filler"): SiloCard => {
    const a = bySilo.get(s);
    if (!a) return { ...emptyCard(s, kind), active: activeSet.has(s) };
    return { siloNo: s, kind, remaining: Math.round(a.remaining), bags: a.bags, size: a.size, grade: a.grade, type: a.type, supplier: a.supplier, mixed: a.combos.size > 1, active: activeSet.has(s) };
  };

  const grit = GRIT_SILOS.map((s) => card(s, "grit"));
  const fillerNames = [...new Set([...FILLER_SILOS, ...[...bySilo.keys()].filter((s) => !GRIT_SILOS.includes(s))])].sort();
  const filler = fillerNames.map((s) => card(s, "filler"));
  return { grit, filler };
}

function emptyCard(siloNo: string, kind: "grit" | "filler"): SiloCard {
  return { siloNo, kind, remaining: 0, bags: 0, size: null, grade: null, type: null, supplier: null, mixed: false, active: false };
}

export interface SiloBagRow {
  increment: number | null;
  bag: string | null;
  size: string | null;
  grade: string | null;
  type: string | null;
  supplier: string | null;
  weight: number | null;
  remaining: number | null;
  date: Date | null;
  batch: string | null;
  assignee: string | null;
}

export async function getSiloDetail(siloNo: string): Promise<{ siloNo: string; bags: SiloBagRow[]; totalRemaining: number; activeBags: number }> {
  const s = norm(siloNo);
  const rows: any[] = await prisma.silo.findMany({
    where: { siloNo: s },
    select: { siloIncrement: true, invNoBagNo: true, weight: true, remainingWeight: true, date: true, batch: true, assignee: true, ...SILO_MAT_SELECT },
    orderBy: { siloIncrement: "desc" },
  });
  let totalRemaining = 0, activeBags = 0;
  const bags: SiloBagRow[] = rows.map((r) => {
    const m = bagMaterial(r);
    const remaining = r.remainingWeight ?? null;
    if ((remaining ?? 0) > 0) { totalRemaining += remaining ?? 0; activeBags += 1; }
    return {
      increment: r.siloIncrement ?? null,
      bag: r.invNoBagNo ?? null,
      size: m.size, grade: m.grade, type: m.type, supplier: m.supplier,
      weight: r.weight ?? null,
      remaining,
      date: r.date ?? null,
      batch: r.batch ?? null,
      assignee: r.assignee ?? null,
    };
  });
  return { siloNo: s, bags, totalRemaining: Math.round(totalRemaining), activeBags };
}

export interface SiloFormInfo {
  siloNo: string;
  kind: SiloKind;
  size: string | null;
  grade: string | null;
  type: string | null;
  supplier: string | null;
  // No `sku` (design). A silo is FIFO — a filling mixes with what is already
  // inside — so this aggregate could only ever report the OLDEST bag's design
  // as if it described the whole silo. Removed with the form field that fed it.
  remaining: number;
  bags: number;
  bagNos: string[];
  bagList: { id: string; bagNo: string | null; weight: number | null; remaining: number | null }[];
  deficitKg?: number; // outstanding UNBACKED demand on this silo (negative deficit placeholders), if any
}

const emptyFormInfo = (s: string): SiloFormInfo =>
  ({ siloNo: s, kind: siloKind(s), size: null, grade: null, type: null, supplier: null, remaining: 0, bags: 0, bagNos: [], bagList: [] });

export async function getSiloFormStatus(): Promise<SiloFormInfo[]> {
  // outstanding unbacked demand (deficit placeholders) — fetched in PARALLEL
  // with the live bags; null when the query fails (deficit info is optional).
  const defsP = prisma.silo.findMany({ where: { airtableId: { startsWith: "deficit_" }, remainingWeight: { lt: 0 } }, select: { siloNo: true, remainingWeight: true } }).catch(() => null);
  let bags: any[] = [];
  try {
    bags = await prisma.silo.findMany({
      where: { siloNo: { not: null }, remainingWeight: { gt: 0 } },
      select: { id: true, siloNo: true, weight: true, remainingWeight: true, invNoBagNo: true, siloIncrement: true, ...SILO_MAT_SELECT },
      orderBy: { siloIncrement: "asc" },
    });
  } catch {
    return GRIT_SILOS.map((s) => emptyFormInfo(s));
  }
  const by = new Map<string, SiloFormInfo>();
  for (const b of bags) {
    const s = norm(b.siloNo);
    if (!s) continue;
    const m = bagMaterial(b);
    const info = by.get(s) ?? emptyFormInfo(s);
    info.remaining += b.remainingWeight ?? 0;
    info.bags += 1;
    if (b.invNoBagNo) info.bagNos.push(String(b.invNoBagNo));
    info.bagList.push({ id: b.id, bagNo: b.invNoBagNo ?? null, weight: b.weight ?? null, remaining: b.remainingWeight ?? null });
    if (hasMat(m)) { info.size ??= m.size; info.grade ??= m.grade; info.type ??= m.type; info.supplier ??= m.supplier; }
    by.set(s, info);
  }
  const out: SiloFormInfo[] = GRIT_SILOS.map((s) => by.get(s) ?? emptyFormInfo(s));
  for (const s of FILLER_SILOS) out.push(by.get(s) ?? emptyFormInfo(s));
  for (const [s, info] of by) if (!GRIT_SILOS.includes(s) && !FILLER_SILOS.includes(s)) out.push(info);
  out.forEach((i) => (i.remaining = Math.round(i.remaining)));
  // attach each silo's outstanding unbacked demand (deficit placeholders, negative remaining)
  const defs = await defsP;
  if (defs) {
    const dmap = new Map<string, number>();
    for (const d of defs) { const s2 = norm(d.siloNo); if (!s2) continue; dmap.set(s2, (dmap.get(s2) ?? 0) + -(d.remainingWeight ?? 0)); }
    out.forEach((i) => { i.deficitKg = Math.round((dmap.get(i.siloNo) ?? 0) * 100) / 100; });
  }
  return out;
}

// Available RM inventory bags for the silo-filling form — accepted bags not yet
// dumped into a silo. The picker lists these; choosing one sets the silo bag's
// weight and material.
export interface RmBagOption {
  id: string;        // RM airtableId
  invNo: string | null;
  bagNo: number | null;
  weight: number | null;
  size: string | null;
  grade: string | null;
  type: string | null;
  supplier: string | null;
  invBag: string;    // "inv 281 · #3"
  label: string;     // full descriptive label
}

// first non-empty supplier value (the column may hold an array lookup)
const supplierOf = (v: unknown): string | null => {
  if (Array.isArray(v)) { const x = v.find((y) => y != null && y !== ""); return x == null ? null : String(x); }
  return v == null ? null : String(v);
};

function toRmBagOption(r: any): RmBagOption {
  const invBag = `INV: ${r.invNo ?? "-"} ; Bag: ${r.bagNo ?? "-"}`;
  const mat = [r.size, r.grade].filter(Boolean).join(" ");
  return {
    id: r.airtableId, invNo: r.invNo ?? null, bagNo: r.bagNo ?? null, weight: r.bagWeight ?? null,
    size: r.size ?? null, grade: r.grade ?? null, type: r.type ?? null, supplier: supplierOf(r.nameFromSupplierMaster),
    invBag, label: `${invBag}${mat ? ` — ${mat}` : ""}${r.bagWeight != null ? ` (${r.bagWeight} kg)` : ""}`,
  };
}

export async function getAvailableRmBags(): Promise<RmBagOption[]> {
  let rows: any[] = [];
  try {
    rows = await (prisma as any).rm.findMany({
      where: { siloIds: { isEmpty: true }, OR: [{ status: null }, { status: "Accepted" }] },
      orderBy: { date: "desc" },
      take: 1500,
      select: { airtableId: true, invNo: true, bagNo: true, bagWeight: true, size: true, grade: true, type: true, nameFromSupplierMaster: true },
    });
  } catch { rows = []; }
  return rows.map(toRmBagOption);
}

/** Server-side search over ALL available (un-dumped, Accepted) bags — by invoice,
 *  bag number, supplier, grade, size or type. Unlike getAvailableRmBags this is NOT
 *  capped to a preloaded slice, so any bag is findable however large the stock. */
export async function searchAvailableRmBags(q: string): Promise<RmBagOption[]> {
  const term = (q ?? "").trim();
  if (!term) return [];
  const like = `%${term}%`;
  let rows: any[] = [];
  try {
    rows = await (prisma as any).$queryRawUnsafe(
      `SELECT "airtableId", inv_no AS "invNo", bag_no AS "bagNo", bag_weight AS "bagWeight",
              size, grade, type, name_from_supplier_master AS "nameFromSupplierMaster"
         FROM rm
        WHERE cardinality(silo) = 0 AND (status IS NULL OR status = 'Accepted')
          AND ( inv_no ILIKE $1 OR grade ILIKE $1 OR size ILIKE $1 OR type ILIKE $1
                OR bag_no::text ILIKE $1
                OR name_from_supplier_master::text ILIKE $1 )
        ORDER BY date DESC NULLS LAST
        LIMIT 100`,
      like,
    );
  } catch { rows = []; }
  return rows.map(toRmBagOption);
}
