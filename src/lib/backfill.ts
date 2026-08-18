// UNBACKED-DRAW support. When a mixer cycle needs material from a silo/resin
// tank that hasn't been digitally filled yet, the engines draw the FULL demand
// anyway: the uncovered part lands on a per-silo/per-tank DEFICIT PLACEHOLDER
// row (weight 0, remaining negative) that the cycle links to — so slab RM
// composition and stock totals stay truthful (stock simply shows negative).
// When the silo/tank is later filled, the new bag/prep ABSORBS the deficit
// FIFO and the affected cycles are re-pointed to the real bag automatically.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { localId } from "@/lib/rbac";

const db = prisma as any;
export const DEFICIT_PREFIX = "deficit_";
export const isDeficitId = (aid: unknown) => typeof aid === "string" && aid.startsWith(DEFICIT_PREFIX);
export const UNBACKED_LABEL = "⚠ UNBACKED — backfill pending";
// A deficit may instead be WRITTEN OFF ("start fresh"): the owed material is
// untraceable (already consumed, composition unknown), so we stop expecting a
// backfill. The placeholder is zeroed and retired — kept so old cycles still
// resolve to it (shown as composition unknown) — and ensure/absorb skip it,
// so the NEXT fill keeps its full weight for new draws.
export const WRITTEN_OFF_LABEL = "✕ WRITTEN OFF";

const GRIT_LINK_FIELDS: string[] = [];
for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) GRIT_LINK_FIELDS.push(`m${m}G${g}Ids`);
const SILO_LINK_FIELDS = [...GRIT_LINK_FIELDS, "fillerSiloIdIds"];
const RESIN_LINK_FIELDS = ["m1RIdIds", "m2RIdIds", "m3RIdIds", "m4RIdIds"];

/** Get (or create) the open deficit placeholder bag for a silo. */
export async function ensureSiloDeficitBag(siloNo: string): Promise<{ id: string; airtableId: string; remaining: number }> {
  const existing = await db.silo.findFirst({ where: { siloNo, airtableId: { startsWith: DEFICIT_PREFIX }, NOT: { invNoBagNo: { startsWith: WRITTEN_OFF_LABEL } } }, select: { id: true, airtableId: true, remainingWeight: true } });
  if (existing) return { id: existing.id, airtableId: existing.airtableId, remaining: existing.remainingWeight ?? 0 };
  // global sequence — same convention as the silo-fill form's auto increment
  const agg = await db.silo.aggregate({ _max: { siloIncrement: true } }).catch(() => null);
  const created = await db.silo.create({ data: {
    airtableId: DEFICIT_PREFIX + localId("silo").slice(5),
    siloNo, siloIncrement: (agg?._max?.siloIncrement ?? 0) + 1,
    weight: 0, remainingWeight: 0, invNoBagNo: UNBACKED_LABEL, date: new Date(),
  } });
  return { id: created.id, airtableId: created.airtableId, remaining: 0 };
}

/** Get (or create) the open deficit placeholder prep for a daily resin tank. */
export async function ensureTankDeficitPrep(tankNo: string): Promise<{ id: string; airtableId: string; remaining: number }> {
  const existing = await db.dailyResinTank.findFirst({ where: { dailyTankNo: tankNo, airtableId: { startsWith: DEFICIT_PREFIX }, NOT: { remarks: { startsWith: WRITTEN_OFF_LABEL } } }, select: { id: true, airtableId: true, remainingWeight: true } });
  if (existing) return { id: existing.id, airtableId: existing.airtableId, remaining: existing.remainingWeight ?? 0 };
  const created = await db.dailyResinTank.create({ data: {
    airtableId: DEFICIT_PREFIX + localId("drt").slice(4),
    dailyTankNo: tankNo, dailyResinId: 999999, quantity: 0, remainingWeight: 0,
    date: new Date(0), // epoch — never counted as the tank's "latest prep"
  } });
  return { id: created.id, airtableId: created.airtableId, remaining: 0 };
}

/** Re-point cycles from a placeholder to a real bag/prep.
 * full=true: replace the placeholder id; otherwise just add the real id. */
async function relinkCycles(tx: any, linkFields: string[], phAid: string, realAid: string, full: boolean) {
  const sel: Record<string, boolean> = { id: true };
  for (const f of linkFields) sel[f] = true;
  const cycles: any[] = await tx.mixerCycle.findMany({ where: { OR: linkFields.map((f) => ({ [f]: { has: phAid } })) }, select: sel });
  for (const c of cycles) {
    const data: Record<string, string[]> = {};
    for (const f of linkFields) {
      const arr = (c[f] ?? []) as string[];
      if (!arr.includes(phAid)) continue;
      const next = full ? arr.map((x) => (x === phAid ? realAid : x)) : [...arr, realAid];
      data[f] = [...new Set(next)];
    }
    if (Object.keys(data).length) await tx.mixerCycle.update({ where: { id: c.id }, data });
  }
  return cycles.length;
}

export interface AbsorbResult { absorbedKg: number; cyclesRelinked: number; cleared: boolean; }

/** After a NEW bag is dumped into a silo: absorb any open deficit FIFO. */
export async function absorbSiloDeficit(siloNo: string, newBagId: string): Promise<AbsorbResult | null> {
  const out: AbsorbResult = { absorbedKg: 0, cyclesRelinked: 0, cleared: false };
  // Serialize per-silo: two concurrent fills can't both absorb the same deficit.
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"silo:" + siloNo}))`;
    const ph = await tx.silo.findFirst({ where: { siloNo, airtableId: { startsWith: DEFICIT_PREFIX }, remainingWeight: { lt: 0 } }, select: { id: true, airtableId: true, remainingWeight: true } });
    if (!ph) return null;
    const bag = await tx.silo.findUnique({ where: { id: newBagId }, select: { id: true, airtableId: true, remainingWeight: true } });
    if (!bag || (bag.remainingWeight ?? 0) <= 0) return null;
    const deficit = -(ph.remainingWeight ?? 0);
    const transfer = Math.min(bag.remainingWeight ?? 0, deficit);
    const full = transfer >= deficit - 1e-6;
    await tx.silo.update({ where: { id: bag.id }, data: { remainingWeight: (bag.remainingWeight ?? 0) - transfer } });
    out.absorbedKg = Math.round(transfer * 100) / 100;
    out.cyclesRelinked = await relinkCycles(tx, SILO_LINK_FIELDS, ph.airtableId, bag.airtableId, full);
    if (full) { await tx.silo.delete({ where: { id: ph.id } }); out.cleared = true; }
    else await tx.silo.update({ where: { id: ph.id }, data: { remainingWeight: (ph.remainingWeight ?? 0) + transfer } });
    return out;
  });
}

/** After a NEW daily-tank prep is entered: absorb any open deficit FIFO. */
export async function absorbTankDeficit(tankNo: string, newPrepId: string): Promise<AbsorbResult | null> {
  const out: AbsorbResult = { absorbedKg: 0, cyclesRelinked: 0, cleared: false };
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tank:" + tankNo}))`;
    const ph = await tx.dailyResinTank.findFirst({ where: { dailyTankNo: tankNo, airtableId: { startsWith: DEFICIT_PREFIX }, remainingWeight: { lt: 0 } }, select: { id: true, airtableId: true, remainingWeight: true } });
    if (!ph) return null;
    const prep = await tx.dailyResinTank.findUnique({ where: { id: newPrepId }, select: { id: true, airtableId: true, remainingWeight: true } });
    if (!prep || (prep.remainingWeight ?? 0) <= 0) return null;
    const deficit = -(ph.remainingWeight ?? 0);
    const transfer = Math.min(prep.remainingWeight ?? 0, deficit);
    const full = transfer >= deficit - 1e-6;
    await tx.dailyResinTank.update({ where: { id: prep.id }, data: { remainingWeight: (prep.remainingWeight ?? 0) - transfer } });
    out.absorbedKg = Math.round(transfer * 100) / 100;
    out.cyclesRelinked = await relinkCycles(tx, RESIN_LINK_FIELDS, ph.airtableId, prep.airtableId, full);
    if (full) { await tx.dailyResinTank.delete({ where: { id: ph.id } }); out.cleared = true; }
    else await tx.dailyResinTank.update({ where: { id: ph.id }, data: { remainingWeight: (ph.remainingWeight ?? 0) + transfer } });
    return out;
  });
}

/** Hours of "backfill drought" before the UI offers a write-off. */
export const WRITE_OFF_AFTER_HOURS = 6;

export interface OpenDeficit { kg: number; droughtHours: number; }
/** The silo's open (not written-off) deficit, if any, with hours since the
 * placeholder was last touched (a draw deepening it or a fill absorbing it
 * both bump syncedAt — any activity resets the drought clock). */
export async function openSiloDeficit(siloNo: string): Promise<OpenDeficit | null> {
  const phs: any[] = await db.silo.findMany({ where: { siloNo, airtableId: { startsWith: DEFICIT_PREFIX }, remainingWeight: { lt: 0 } }, select: { remainingWeight: true, syncedAt: true } }).catch(() => []);
  if (!phs.length) return null;
  const kg = phs.reduce((a, p) => a + -(p.remainingWeight ?? 0), 0);
  const last = Math.max(...phs.map((p) => new Date(p.syncedAt ?? 0).getTime()));
  return { kg: Math.round(kg * 100) / 100, droughtHours: Math.max(0, (Date.now() - last) / 36e5) };
}
/** Resin twin. */
export async function openTankDeficit(tankNo: string): Promise<OpenDeficit | null> {
  const phs: any[] = await db.dailyResinTank.findMany({ where: { dailyTankNo: tankNo, airtableId: { startsWith: DEFICIT_PREFIX }, remainingWeight: { lt: 0 } }, select: { remainingWeight: true, syncedAt: true } }).catch(() => []);
  if (!phs.length) return null;
  const kg = phs.reduce((a, p) => a + -(p.remainingWeight ?? 0), 0);
  const last = Math.max(...phs.map((p) => new Date(p.syncedAt ?? 0).getTime()));
  return { kg: Math.round(kg * 100) / 100, droughtHours: Math.max(0, (Date.now() - last) / 36e5) };
}

export interface WriteOffResult { writtenOffKg: number; cyclesAffected: number; }
const r2 = (n: number) => Math.round(n * 100) / 100;
const stampNow = () => new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** WRITE OFF a silo's open deficit ("start fresh"). Zeroes + retires the
 * placeholder(s); old cycles keep their links (composition unknown forever);
 * the next fill is NOT absorbed. Same advisory lock as absorb — a write-off
 * and a fill can't race each other. */
export async function writeOffSiloDeficit(siloNo: string, by: string): Promise<WriteOffResult | null> {
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"silo:" + siloNo}))`;
    const phs: any[] = await tx.silo.findMany({ where: { siloNo, airtableId: { startsWith: DEFICIT_PREFIX }, remainingWeight: { lt: 0 } }, select: { id: true, airtableId: true, remainingWeight: true } });
    if (!phs.length) return null;
    let total = 0; const aids: string[] = [];
    for (const ph of phs) {
      const kg = r2(-(ph.remainingWeight ?? 0)); total += kg; aids.push(ph.airtableId);
      await tx.silo.update({ where: { id: ph.id }, data: { remainingWeight: 0, invNoBagNo: `${WRITTEN_OFF_LABEL} ${kg} kg — composition unknown (${by}, ${stampNow()})` } });
    }
    const cyclesAffected = await tx.mixerCycle.count({ where: { OR: SILO_LINK_FIELDS.map((f) => ({ [f]: { hasSome: aids } })) } });
    return { writtenOffKg: r2(total), cyclesAffected };
  });
}

/** WRITE OFF a daily resin tank's open deficit ("start fresh") — resin twin. */
export async function writeOffTankDeficit(tankNo: string, by: string): Promise<WriteOffResult | null> {
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tank:" + tankNo}))`;
    const phs: any[] = await tx.dailyResinTank.findMany({ where: { dailyTankNo: tankNo, airtableId: { startsWith: DEFICIT_PREFIX }, remainingWeight: { lt: 0 } }, select: { id: true, airtableId: true, remainingWeight: true } });
    if (!phs.length) return null;
    let total = 0; const aids: string[] = [];
    for (const ph of phs) {
      const kg = r2(-(ph.remainingWeight ?? 0)); total += kg; aids.push(ph.airtableId);
      await tx.dailyResinTank.update({ where: { id: ph.id }, data: { remainingWeight: 0, remarks: `${WRITTEN_OFF_LABEL} ${kg} kg — composition unknown (${by}, ${stampNow()})` } });
    }
    const cyclesAffected = await tx.mixerCycle.count({ where: { OR: RESIN_LINK_FIELDS.map((f) => ({ [f]: { hasSome: aids } })) } });
    return { writtenOffKg: r2(total), cyclesAffected };
  });
}

/** Does any mixer cycle of this batch carry an unbacked (deficit) link? */
export async function batchHasUnbacked(batchKey: string): Promise<boolean> {
  if (!batchKey) return false;
  try {
    const arrs = [...SILO_LINK_FIELDS, ...RESIN_LINK_FIELDS]
      .map((f) => f.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/_ids$/, "").replace(/_id_ids$/, "_id"))
      .map((c) => `array_to_string(COALESCE(${c}, '{}'), ',')`).join(" || ',' || ");
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT 1 FROM mixer_cycle WHERE batch_key = $1 AND (${arrs}) LIKE '%deficit_%' LIMIT 1`, batchKey);
    return rows.length > 0;
  } catch { return false; }
}
