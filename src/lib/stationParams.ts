// Per-station "process parameter" change-log for the slab drill-down page.
// These are the NOT-per-slab parameters that should hold steady for a whole
// batch. We surface each one's value, flag any that CHANGED partway through the
// batch (with the full change timeline), and group related ones together.
// Mixer is handled separately (per-cycle grit/filler/resin, flag >= 3 kg moves).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";
import type { SlabStation } from "@/lib/erp";

export interface ParamDef { key: string; label: string; group: string; kind?: "num" | "text"; }

function buildSpec(): Partial<Record<SlabStation, ParamDef[]>> {
  // ---- PRESS ----
  const press: ParamDef[] = [];
  for (let p = 1; p <= 5; p++) press.push({ key: `phase${p}Rev`, label: `Phase ${p}`, group: "Phase - revolutions", kind: "num" });
  for (let p = 1; p <= 5; p++) press.push({ key: `phase${p}PressingTime`, label: `Phase ${p}`, group: "Phase - pressing time", kind: "num" });
  for (let p = 1; p <= 5; p++) press.push({ key: `phase${p}Pressure`, label: `Phase ${p}`, group: "Phase - pressure", kind: "num" });
  for (let p = 1; p <= 5; p++) press.push({ key: `phase${p}AccelerationTime`, label: `Phase ${p}`, group: "Phase - acceleration", kind: "num" });
  press.push(
    { key: "noOfStages", label: "No. of stages", group: "Vacuum & pinhole", kind: "num" },
    { key: "noOfVacuumPumps", label: "Vacuum pumps (count)", group: "Vacuum & pinhole", kind: "num" },
    { key: "vacuumPumps", label: "Vacuum pumps", group: "Vacuum & pinhole", kind: "text" },
    { key: "vacuumDelayInSeconds", label: "Vacuum delay (s)", group: "Vacuum & pinhole", kind: "num" },
    { key: "loweChamberVacuumInMbar", label: "Lower-chamber vacuum (mbar)", group: "Vacuum & pinhole", kind: "num" },
    { key: "pinholeCycle", label: "Pinhole cycle", group: "Vacuum & pinhole", kind: "text" },
    { key: "pinholeCyclePhase", label: "Pinhole cycle phase", group: "Vacuum & pinhole", kind: "text" },
    { key: "pinholeCycleDelay", label: "Pinhole cycle delay", group: "Vacuum & pinhole", kind: "num" },
  );

  // ---- OVEN ----
  const oven: ParamDef[] = [
    { key: "upperTemp", label: "Upper temp", group: "Oven recipe", kind: "num" },
    { key: "lowerTemp", label: "Lower temp", group: "Oven recipe", kind: "num" },
    { key: "setCookingTime", label: "Set cooking time", group: "Oven recipe", kind: "num" },
  ];

  // ---- DISTRIBUTOR (line head) ----
  const distributor: ParamDef[] = [
    { key: "roller1Rpm", label: "Roller 1 RPM", group: "Rollers", kind: "num" },
    { key: "roller2Rpm", label: "Roller 2 RPM", group: "Rollers", kind: "num" },
    { key: "lumpCrusherGap", label: "Lump crusher gap", group: "Rollers", kind: "num" },
    { key: "s1", label: "S1", group: "Shuttle (S/E + speed)", kind: "num" },
    { key: "e1", label: "E1", group: "Shuttle (S/E + speed)", kind: "num" },
    { key: "s2", label: "S2", group: "Shuttle (S/E + speed)", kind: "num" },
    { key: "e2", label: "E2", group: "Shuttle (S/E + speed)", kind: "num" },
    { key: "shuttleSpeedP1", label: "Shuttle speed P1", group: "Shuttle (S/E + speed)", kind: "num" },
    { key: "shuttleSpeedP2", label: "Shuttle speed P2", group: "Shuttle (S/E + speed)", kind: "num" },
    { key: "veinDesignName", label: "Vein design", group: "Veins", kind: "text" },
    { key: "distributorVein1", label: "Vein 1", group: "Veins", kind: "text" },
    { key: "distributorVein1BatcherRpm", label: "Vein 1 batcher RPM", group: "Veins", kind: "num" },
    { key: "distributorVein2", label: "Vein 2", group: "Veins", kind: "text" },
    { key: "distributorVein2BatcherRpm", label: "Vein 2 batcher RPM", group: "Veins", kind: "num" },
    { key: "distributorLoadingBeltLoadingSpeed", label: "Loading belt load speed", group: "Distributor feed", kind: "num" },
    { key: "distributorLoadingBeltUnloadingSpeed", label: "Loading belt unload speed", group: "Distributor feed", kind: "num" },
    { key: "distributorMaterialUnloadingSpeed", label: "Material unload speed", group: "Distributor feed", kind: "num" },
    { key: "distributorFractionatorSpeed", label: "Fractionator speed", group: "Distributor feed", kind: "num" },
    { key: "distributorFractionatorType", label: "Fractionator type", group: "Distributor feed", kind: "text" },
    { key: "distributorHopperGap", label: "Hopper gap", group: "Distributor feed", kind: "num" },
    { key: "distributorHopperWeight", label: "Hopper weight", group: "Distributor feed", kind: "num" },
    { key: "distributorManualRollerHeight", label: "Manual roller height", group: "Distributor feed", kind: "num" },
    { key: "crusherEnableDisable", label: "Crusher enable", group: "Crusher", kind: "text" },
    { key: "crusherLoadingBeltLoadingSpeed", label: "Crusher belt load speed", group: "Crusher", kind: "num" },
    { key: "crusherLoadingBeltUnloadingSpeed", label: "Crusher belt unload speed", group: "Crusher", kind: "num" },
  ];

  // ---- KREOS (line head alternative) ----
  const kreos: ParamDef[] = [
    { key: "gevDesignName", label: "GEV design", group: "GEV", kind: "text" },
    { key: "gev1", label: "GEV 1", group: "GEV", kind: "text" },
    { key: "gev1SlotSize", label: "GEV 1 slot", group: "GEV", kind: "num" },
    { key: "gev1Rpm", label: "GEV 1 RPM", group: "GEV", kind: "num" },
    { key: "gev2", label: "GEV 2", group: "GEV", kind: "text" },
    { key: "gev2SlotSize", label: "GEV 2 slot", group: "GEV", kind: "num" },
    { key: "gev2Rpm", label: "GEV 2 RPM", group: "GEV", kind: "num" },
    { key: "gev3", label: "GEV 3", group: "GEV", kind: "text" },
    { key: "gev3SlotSize", label: "GEV 3 slot", group: "GEV", kind: "num" },
    { key: "gev3Rpm", label: "GEV 3 RPM", group: "GEV", kind: "num" },
    { key: "slabSetWeight", label: "Set weight", group: "Lamination & rollers", kind: "num" },
    { key: "kreosWorkingPositionInMm", label: "Working position (mm)", group: "Lamination & rollers", kind: "num" },
    { key: "numberOfLaminations", label: "Laminations", group: "Lamination & rollers", kind: "text" },
    { key: "laminationSpeed", label: "Lamination speed", group: "Lamination & rollers", kind: "num" },
    { key: "beltRotationK1", label: "Belt rotation K1", group: "Lamination & rollers", kind: "num" },
    { key: "fixedRollerRotationK2", label: "Fixed roller K2", group: "Lamination & rollers", kind: "num" },
    { key: "mobileRollerRotationK3", label: "Mobile roller K3", group: "Lamination & rollers", kind: "num" },
    { key: "crusherLoadingBeltSpeedInMMin", label: "Crusher belt speed", group: "Crusher & feed", kind: "num" },
    { key: "distributorLoadingBeltLoadingSpeed", label: "Loading belt load speed", group: "Crusher & feed", kind: "num" },
    { key: "distributorLoadingBeltUnloadingSpeed", label: "Loading belt unload speed", group: "Crusher & feed", kind: "num" },
  ];

  return { press, oven, distributor, kreos };
}

export const STATION_PARAMS = buildSpec();

const MODEL_KEY: Partial<Record<SlabStation, string>> = { press: "press", oven: "oven", distributor: "distributor", kreos: "kreos" };

export interface ParamSegment { value: string; fromSlab: number | null; count: number; }
export interface ParamRow { key: string; label: string; changed: boolean; segments: ParamSegment[]; }
export interface ParamGroup { title: string; params: ParamRow[]; changed: number; }
export interface StationParamLog {
  key: string;
  station: SlabStation;
  slabs: number;
  groups: ParamGroup[];
  changedCount: number;
  notRecorded: string[];
}

function canon(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) { const j = v.filter((x) => x != null && x !== "").join(", "); return j || null; }
  const s = String(v).trim();
  return s || null;
}

function segmentsFor(rows: any[], key: string): ParamSegment[] {
  const segs: ParamSegment[] = [];
  for (const r of rows) {
    const cv = canon(r[key]);
    if (cv == null) continue;
    const last = segs[segs.length - 1];
    if (!last || last.value !== cv) segs.push({ value: cv, fromSlab: typeof r.slabNumber === "number" ? r.slabNumber : null, count: 1 });
    else last.count++;
  }
  return segs;
}

export async function getStationParamLog(input: string, station: SlabStation): Promise<StationParamLog | null> {
  const defs = STATION_PARAMS[station];
  const mk = MODEL_KEY[station];
  if (!defs || !mk) return null;
  const key = normalizeBatch(input);
  if (!key) return null;

  const select: Record<string, boolean> = { slabNumber: true };
  for (const d of defs) select[d.key] = true;
  const rows: any[] = await (prisma as any)[mk]
    .findMany({ where: { batchKey: key }, select, orderBy: { slabNumber: "asc" } })
    .catch(() => [] as any[]);
  if (!rows.length) return null;

  const order: string[] = [];
  const byGroup = new Map<string, ParamRow[]>();
  const notRecorded: string[] = [];
  let changedCount = 0;

  for (const d of defs) {
    const segs = segmentsFor(rows, d.key);
    if (!segs.length) { notRecorded.push(`${d.group}: ${d.label}`); continue; }
    const changed = segs.length > 1;
    if (changed) changedCount++;
    if (!byGroup.has(d.group)) { byGroup.set(d.group, []); order.push(d.group); }
    byGroup.get(d.group)!.push({ key: d.key, label: d.label, changed, segments: segs });
  }

  const groups: ParamGroup[] = order.map((title) => {
    const params = byGroup.get(title)!;
    return { title, params, changed: params.filter((p) => p.changed).length };
  });

  return { key, station, slabs: rows.length, groups, changedCount, notRecorded };
}

// ---- MIXER: per-cycle grit/filler/resin, flag cycles that moved >= 3 kg ----
export const MIX_FLAG_KG = 3;
export interface MixerChange { what: "grit" | "filler" | "resin"; delta: number; }
export interface MixerFlag { cycle: number; grit: number; filler: number; resin: number; changes: MixerChange[]; }
export interface MixerCycleLog { key: string; totalCycles: number; flagged: MixerFlag[]; }

export async function getMixerCycleLog(input: string): Promise<MixerCycleLog | null> {
  const key = normalizeBatch(input);
  if (!key) return null;
  const select: Record<string, boolean> = { cycle: true };
  for (let n = 1; n <= 4; n++) {
    select[`m${n}FW`] = true;
    select[`m${n}RW`] = true;
    for (let g = 1; g <= 5; g++) select[`m${n}W${g}`] = true;
  }
  const rows: any[] = await (prisma as any).mixerCycle
    .findMany({ where: { batchKey: key }, select, orderBy: { cycle: "asc" } })
    .catch(() => [] as any[]);
  if (!rows.length) return null;

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const totals = rows.map((r) => {
    let grit = 0, filler = 0, resin = 0;
    for (let n = 1; n <= 4; n++) {
      filler += r[`m${n}FW`] ?? 0;
      resin += r[`m${n}RW`] ?? 0;
      for (let g = 1; g <= 5; g++) grit += r[`m${n}W${g}`] ?? 0;
    }
    return { cycle: typeof r.cycle === "number" ? r.cycle : 0, grit, filler, resin };
  });

  const flagged: MixerFlag[] = [];
  for (let i = 1; i < totals.length; i++) {
    const cur = totals[i], prev = totals[i - 1];
    const changes: MixerChange[] = [];
    if (Math.abs(cur.grit - prev.grit) >= MIX_FLAG_KG) changes.push({ what: "grit", delta: r1(cur.grit - prev.grit) });
    if (Math.abs(cur.filler - prev.filler) >= MIX_FLAG_KG) changes.push({ what: "filler", delta: r1(cur.filler - prev.filler) });
    if (Math.abs(cur.resin - prev.resin) >= MIX_FLAG_KG) changes.push({ what: "resin", delta: r1(cur.resin - prev.resin) });
    if (changes.length) flagged.push({ cycle: cur.cycle, grit: Math.round(cur.grit), filler: Math.round(cur.filler), resin: Math.round(cur.resin), changes });
  }
  return { key, totalCycles: rows.length, flagged };
}

// ---- One-line QC vs parameter-change summary (below the slab discrepancy table) ----
const isReject = (g: unknown) => typeof g === "string" && /reject/i.test(g);
const isGraded = (g: unknown) => typeof g === "string" && g.trim() !== "" && g !== "Not graded yet";
const pct = (x: number) => `${Math.round(x * 100)}%`;

export async function getQcParamSummary(input: string): Promise<string | null> {
  const key = normalizeBatch(input);
  if (!key) return null;
  const qc: any[] = await (prisma as any).polishQc
    .findMany({ where: { batchKey: key }, select: { slabNumber: true, qualityGrade: true } })
    .catch(() => [] as any[]);
  const graded = qc.filter((r) => isGraded(r.qualityGrade));
  if (!graded.length) return null;

  const bad = graded.filter((r) => isReject(r.qualityGrade));
  const rejectRate = bad.length / graded.length;

  const logs = await Promise.all((["press", "oven", "distributor", "kreos"] as SlabStation[]).map((s) => getStationParamLog(input, s).catch(() => null)));
  const changeSlabs = logs.flatMap((l) => (l ? l.groups.flatMap((g) => g.params) : []))
    .flatMap((p) => p.segments.slice(1).map((s) => s.fromSlab))
    .filter((n): n is number => typeof n === "number");
  const firstChange = changeSlabs.length ? Math.min(...changeSlabs) : null;

  if (rejectRate < 0.08) {
    return `QC came out good - ${pct(1 - rejectRate)} passed (${bad.length} reject${bad.length === 1 ? "" : "s"} of ${graded.length} graded); parameters held steady${changeSlabs.length ? " apart from minor tweaks" : ""}.`;
  }

  if (firstChange != null) {
    const before = graded.filter((r) => typeof r.slabNumber === "number" && r.slabNumber < firstChange);
    const after = graded.filter((r) => typeof r.slabNumber === "number" && r.slabNumber >= firstChange);
    const rb = before.length ? before.filter((r) => isReject(r.qualityGrade)).length / before.length : 0;
    const ra = after.length ? after.filter((r) => isReject(r.qualityGrade)).length / after.length : 0;
    if (after.length >= 5 && ra >= 0.1 && ra > rb + 0.05) {
      return `QC started slipping around slab ${firstChange} - rejects rose from ${pct(rb)} to ${pct(ra)} after parameters changed; worth a check.`;
    }
  }
  return `QC had ${bad.length} reject${bad.length === 1 ? "" : "s"} (${pct(rejectRate)} of ${graded.length}), spread across the batch rather than tied to a parameter change.`;
}
