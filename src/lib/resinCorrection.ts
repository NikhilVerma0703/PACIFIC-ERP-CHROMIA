// Resin daily-tank CORRECTION engine — same "correct at a point, ripple forward"
// model as the silo engine, pointed at the resin chain:
//   DailyResinTank prep rows (FIFO by dailyResinId) are consumed by Mixer Cycle
//   resin slots (m{n}RW kg from tank m{n}RDtn, linked via m{n}RIdIds).
// We anchor on the existing links, fix one prep, and apply only the delta.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { isDeficitId, WRITTEN_OFF_LABEL } from "@/lib/backfill";

const db = prisma as any;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
function parseBatchNumber(b: unknown): number { if (!b) return Infinity; const n = parseInt(String(b).replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : Infinity; }

// "Forgive old draws" cutoff: the timeline + correction recompute ignores grit/
// filler/resin draws from cycles BEFORE this batch number (treated as settled
// before the ERP era, so fresh stock is never shown feeding them). Reversible —
// set to 0 to count every cycle again.
const FORGIVE_BEFORE_BATCH = 1334;
function lookup(v: unknown): string | null { if (v == null) return null; if (Array.isArray(v)) { const x = v.find((y) => y != null && y !== ""); return x == null ? null : String(x); } if (typeof v === "object") return null; const s = String(v).trim(); return s || null; }

export interface ResinDraw { batch: string | null; cycle: number | null; linkField: string; kg: number; }
export interface ResinPrep {
  id: string; airtableId: string; increment: number; date: string | null;
  weight: number; remaining: number; label: string; supplier: string | null;
  incharge: string | null; draws: ResinDraw[]; consumed: number;
}
export interface ResinLedger { tankNo: string; preps: ResinPrep[]; totalPrepared: number; totalRemaining: number; drawCount: number; }

export type ResinOp =
  | { type: "editWeight"; rowId: string; newWeight: number }
  | { type: "insert"; afterRowId: string | null; weight: number; date?: string | null }
  | { type: "delete"; rowId: string };

export interface ResinDiff {
  tankNo: string;
  remainingChanges: { label: string; before: number; after: number }[];
  linkChanges: { batch: string | null; cycle: number | null; linkField: string; before: string[]; after: string[] }[];
  shortfalls: { batch: string | null; cycle: number | null; linkField: string; short: number }[];
  affectedCycles: number; affectedBatches: string[]; note: string;
}

function cycleSelect() {
  const sel: Record<string, boolean> = { id: true, airtableId: true, batch: true, cycle: true, createTime: true, mixerStartTime: true, importedAt: true };
  for (let m = 1; m <= 4; m++) { sel[`m${m}RW`] = true; sel[`m${m}RDtn`] = true; sel[`m${m}RIdIds`] = true; }
  return sel;
}
// Only the cycles that can reference this tank (same predicate that
// collectDraws() applies in memory) — identical results, far fewer bytes.
function cycleWhere(tankNo: string, prepAids: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const or: any[] = [];
  for (let m = 1; m <= 4; m++) {
    or.push({ [`m${m}RDtn`]: tankNo });
    if (prepAids.length) or.push({ [`m${m}RIdIds`]: { hasSome: prepAids } });
  }
  return { OR: or };
}
async function loadCycles(tankNo: string, preps: any[]): Promise<any[]> {
  return db.mixerCycle.findMany({ where: cycleWhere(tankNo, preps.map((p) => p.airtableId)), select: cycleSelect() });
}

async function loadPreps(tankNo: string): Promise<any[]> {
  return db.dailyResinTank.findMany({ where: { dailyTankNo: tankNo }, orderBy: [{ dailyResinId: "asc" }, { date: "asc" }], select: { id: true, airtableId: true, dailyResinId: true, date: true, quantity: true, remainingWeight: true, dailyTankNo: true, supplierFromOutsideTankNo: true, remarks: true, incharge: true } });
}

interface Draw { uid: string; cycleId: string; cycleAirtableId: string; batch: string | null; cycleNo: number; linkField: string; weight: number; time: number; }
function collectDraws(tankNo: string, preps: any[], cycles: any[]): Draw[] {
  const prepSet = new Set(preps.map((p) => p.airtableId));
  // Draws settled by a WRITTEN-OFF deficit are forgiven — never re-fed from real stock.
  const writtenOff = new Set(preps.filter((p: any) => isDeficitId(p.airtableId) && String(p.remarks ?? "").startsWith(WRITTEN_OFF_LABEL)).map((p: any) => p.airtableId));
  const draws: Draw[] = [];
  for (const r of cycles) {
    if (parseBatchNumber(r.batch) < FORGIVE_BEFORE_BATCH) continue; // forgive pre-cutoff draws
    const ts = r.createTime ?? r.mixerStartTime ?? r.importedAt;
    const t = ts ? new Date(ts).getTime() : parseBatchNumber(r.batch) * 1e6 + num(r.cycle);
    for (let m = 1; m <= 4; m++) {
      const lf = `m${m}RIdIds`; const ids = (r[lf] ?? []) as string[];
      const w = num(r[`m${m}RW`]); const hit = (r[`m${m}RDtn`] ?? "").toString().trim() === tankNo;
      if (w > 0 && !ids.some((x) => writtenOff.has(x)) && (ids.some((x) => prepSet.has(x)) || hit)) draws.push({ uid: `${r.id}:${lf}`, cycleId: r.id, cycleAirtableId: r.airtableId, batch: r.batch ?? null, cycleNo: num(r.cycle), linkField: lf, weight: w, time: t });
    }
  }
  draws.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.cycleNo - b.cycleNo));
  return draws;
}

interface SimP { aid: string; weight: number; }
interface Model { remaining: Map<string, number>; drawAlloc: Map<string, { aid: string; kg: number }[]>; prepDraws: Map<string, ResinDraw[]>; consumed: Map<string, number>; }
function model(preps: SimP[], draws: Draw[]): Model {
  const remaining = new Map(preps.map((p) => [p.aid, p.weight]));
  const consumed = new Map(preps.map((p) => [p.aid, 0]));
  const order = preps.map((p) => p.aid);
  const drawAlloc = new Map<string, { aid: string; kg: number }[]>();
  const prepDraws = new Map<string, ResinDraw[]>();
  for (const d of draws) {
    let left = d.weight; const alloc: { aid: string; kg: number }[] = [];
    for (const aid of order) {
      if (left <= 1e-9) break; const rem = remaining.get(aid) ?? 0; if (rem <= 0) continue;
      const take = Math.min(rem, left); left -= take; remaining.set(aid, rem - take); consumed.set(aid, (consumed.get(aid) ?? 0) + take);
      alloc.push({ aid, kg: take }); const pd = prepDraws.get(aid) ?? []; pd.push({ batch: d.batch, cycle: d.cycleNo, linkField: d.linkField, kg: take }); prepDraws.set(aid, pd);
    }
    drawAlloc.set(d.uid, alloc);
  }
  return { remaining, drawAlloc, prepDraws, consumed };
}

const rowAid = (preps: any[], id: string) => preps.find((p) => p.id === id)?.airtableId ?? id;
function opPreps(preps: any[], op: ResinOp): SimP[] {
  let list = preps.map((p) => ({ aid: p.airtableId, weight: num(p.quantity), inc: num(p.dailyResinId) }));
  if (op.type === "editWeight") list = list.map((p) => (p.aid === rowAid(preps, op.rowId) ? { ...p, weight: op.newWeight } : p));
  if (op.type === "delete") { const a = rowAid(preps, op.rowId); list = list.filter((p) => p.aid !== a); }
  if (op.type === "insert") { const after = op.afterRowId ? preps.find((x) => x.id === op.afterRowId) : null; const inc = (after ? num(after.dailyResinId) : 0) + 0.5; list.push({ aid: "__new__", weight: op.weight, inc }); }
  list.sort((a, b) => a.inc - b.inc);
  return list.map((p) => ({ aid: p.aid, weight: p.weight }));
}

export async function getResinLedger(tankNo: string): Promise<ResinLedger> {
  const preps = await loadPreps(tankNo);
  const cycles = await loadCycles(tankNo, preps);
  const draws = collectDraws(tankNo, preps, cycles);
  const m = model(preps.map((p) => ({ aid: p.airtableId, weight: num(p.quantity) })), draws);
  const rows: ResinPrep[] = preps.map((p) => ({
    id: p.id, airtableId: p.airtableId, increment: num(p.dailyResinId),
    date: p.date ? new Date(p.date).toISOString().slice(0, 10) : null,
    weight: r2(num(p.quantity)), remaining: r2(num(p.remainingWeight)),
    label: `Prep #${num(p.dailyResinId)}`, supplier: lookup(p.supplierFromOutsideTankNo), incharge: p.incharge ?? null,
    draws: (m.prepDraws.get(p.airtableId) ?? []).map((d) => ({ ...d, kg: r2(d.kg) })), consumed: r2(m.consumed.get(p.airtableId) ?? 0),
  }));
  return { tankNo, preps: rows, totalPrepared: r2(rows.reduce((a, r) => a + r.weight, 0)), totalRemaining: r2(rows.reduce((a, r) => a + r.remaining, 0)), drawCount: draws.length };
}

function buildDiff(tankNo: string, preps: any[], before: Model, after: Model, draws: Draw[], labelOf: (aid: string) => string): ResinDiff {
  const remainingChanges: ResinDiff["remainingChanges"] = [];
  const recRemaining = new Map<string, number>(preps.map((p) => [p.airtableId, num(p.remainingWeight)]));
  const aids = new Set<string>([...before.remaining.keys(), ...after.remaining.keys()]);
  for (const aid of aids) {
    const delta = (after.remaining.get(aid) ?? 0) - (before.remaining.get(aid) ?? 0);
    if (Math.abs(delta) < 1e-6) continue;
    const baseline = recRemaining.has(aid) ? (recRemaining.get(aid) ?? 0) : (after.remaining.get(aid) ?? 0) - delta;
    remainingChanges.push({ label: labelOf(aid), before: r2(baseline), after: r2(baseline + delta) });
  }
  const linkChanges: ResinDiff["linkChanges"] = [];
  const affectedBatches = new Set<string>();
  for (const d of draws) {
    const b = (before.drawAlloc.get(d.uid) ?? []).map((x) => x.aid);
    const a = (after.drawAlloc.get(d.uid) ?? []).map((x) => x.aid);
    const bs = new Set(b), as = new Set(a);
    if (b.length !== a.length || [...as].some((x) => !bs.has(x)) || [...bs].some((x) => !as.has(x))) {
      linkChanges.push({ batch: d.batch, cycle: d.cycleNo, linkField: d.linkField, before: b.map(labelOf), after: a.map(labelOf) });
      if (d.batch) affectedBatches.add(d.batch);
    }
  }
  const shortOf = (mm: Model, d: Draw) => d.weight - (mm.drawAlloc.get(d.uid) ?? []).reduce((s, x) => s + x.kg, 0);
  const shortfalls: ResinDiff["shortfalls"] = [];
  for (const d of draws) { const worse = shortOf(after, d) - shortOf(before, d); if (worse > 1) shortfalls.push({ batch: d.batch, cycle: d.cycleNo, linkField: d.linkField, short: r2(shortOf(after, d)) }); }
  const affectedCycles = new Set(linkChanges.map((l) => `${l.batch}·${l.cycle}`)).size;
  const note = `Upstream of the change is untouched; ${affectedCycles} downstream cycle(s) re-balanced${remainingChanges.length ? `, ${remainingChanges.length} prep weight(s) shift` : ""}.`;
  return { tankNo, remainingChanges, linkChanges, shortfalls, affectedCycles, affectedBatches: [...affectedBatches], note };
}

export async function previewResinCorrection(tankNo: string, op: ResinOp): Promise<ResinDiff> {
  const preps = await loadPreps(tankNo);
  const cycles = await loadCycles(tankNo, preps);
  const draws = collectDraws(tankNo, preps, cycles);
  return previewWith(tankNo, op, preps, draws);
}

// Pure preview on already-loaded data (applyResinCorrection reuses its own load).
function previewWith(tankNo: string, op: ResinOp, preps: any[], draws: Draw[]): ResinDiff {
  const labels = new Map<string, string>(preps.map((p) => [p.airtableId, `Prep #${num(p.dailyResinId)}`]));
  labels.set("__new__", "new prep");
  const labelOf = (aid: string) => labels.get(aid) ?? aid;
  const before = model(preps.map((p) => ({ aid: p.airtableId, weight: num(p.quantity) })), draws);
  const after = model(opPreps(preps, op), draws);
  return buildDiff(tankNo, preps, before, after, draws, labelOf);
}

// return a deleted prep's quantity to its ResinStorage (best-effort, mirrors RM reversal)
async function returnToStorage(prepId: string) {
  try {
    const p = await db.dailyResinTank.findUnique({ where: { id: prepId }, select: { quantity: true, outsideTankNoIds: true } });
    const link = (p?.outsideTankNoIds ?? []) as string[];
    if (!p || !link.length) return;
    const st = await db.resinStorage.findUnique({ where: { airtableId: link[0] }, select: { id: true, quantityRemaining: true } });
    if (st) await db.resinStorage.update({ where: { id: st.id }, data: { quantityRemaining: num(st.quantityRemaining) + num(p.quantity) } });
  } catch { /* ignore */ }
}
async function renumberTank(tankNo: string) {
  const preps = await db.dailyResinTank.findMany({ where: { dailyTankNo: tankNo }, orderBy: [{ dailyResinId: "asc" }, { date: "asc" }], select: { id: true, dailyResinId: true } });
  let i = 1; for (const p of preps) { if (num(p.dailyResinId) !== i) await db.dailyResinTank.update({ where: { id: p.id }, data: { dailyResinId: i } }); i++; }
}

export async function applyResinCorrection(tankNo: string, op: ResinOp): Promise<{ ok: boolean; message: string; diff: ResinDiff }> {
  const preps = await loadPreps(tankNo);
  const cycles = await loadCycles(tankNo, preps);
  const draws = collectDraws(tankNo, preps, cycles);
  const diff = previewWith(tankNo, op, preps, draws); // same data — no second full scan
  const before = model(preps.map((p) => ({ aid: p.airtableId, weight: num(p.quantity) })), draws);

  let newAid: string | null = null;
  if (op.type === "editWeight") {
    await db.dailyResinTank.update({ where: { id: op.rowId }, data: { quantity: op.newWeight } });
  } else if (op.type === "delete") {
    const p = preps.find((x) => x.id === op.rowId); if (!p) return { ok: false, message: "Prep not found.", diff };
    await returnToStorage(op.rowId);
    await db.dailyResinTank.delete({ where: { id: op.rowId } });
    await renumberTank(tankNo);
  } else if (op.type === "insert") {
    const after = op.afterRowId ? preps.find((x) => x.id === op.afterRowId) : null;
    const airtableId = `imp_${crypto.randomUUID()}`; newAid = airtableId;
    await db.dailyResinTank.create({ data: { airtableId, dailyTankNo: tankNo, dailyResinId: (after ? num(after.dailyResinId) : 0) + 0.5, quantity: op.weight, remainingWeight: op.weight, date: op.date ? new Date(op.date) : new Date() } });
    await renumberTank(tankNo);
  }

  const preps2 = await loadPreps(tankNo);
  const cycles2 = await loadCycles(tankNo, preps2);
  const draws2 = collectDraws(tankNo, preps2, cycles2);
  const after = model(preps2.map((p) => ({ aid: p.airtableId, weight: num(p.quantity) })), draws2);

  const recById = new Map<string, any>(preps2.map((p) => [p.airtableId, p]));
  const aidsAll = new Set<string>([...before.remaining.keys(), ...after.remaining.keys()]);
  for (const aid of aidsAll) {
    const p = recById.get(aid); if (!p) continue;
    const beforeRem = before.remaining.has(aid) ? (before.remaining.get(aid) ?? 0) : num(p.quantity);
    const delta = (after.remaining.get(aid) ?? 0) - beforeRem;
    if (Math.abs(delta) < 1e-6 && aid !== newAid) continue;
    const baseline = aid === newAid ? num(p.quantity) : num(p.remainingWeight);
    const target = aid === newAid ? (after.remaining.get(aid) ?? num(p.quantity)) : baseline + delta;
    const isDeficit = String(p.airtableId ?? "").startsWith("deficit_");
    await db.dailyResinTank.update({ where: { id: p.id }, data: { remainingWeight: r2(isDeficit ? target : Math.max(0, target)) } });
  }

  const tankPrepSet = new Set(preps2.map((p) => p.airtableId));
  const cyById = new Map<string, any>(cycles2.map((c: any) => [c.id, c]));
  for (const d of draws2) {
    const b = (before.drawAlloc.get(d.uid) ?? []).map((x) => x.aid).filter((x) => x !== "__new__");
    const a = (after.drawAlloc.get(d.uid) ?? []).map((x) => x.aid);
    const bs = new Set(b), as = new Set(a);
    const changed = b.length !== a.length || [...as].some((x) => !bs.has(x)) || [...bs].some((x) => !as.has(x));
    if (!changed) continue;
    const cyc = cyById.get(d.cycleId); if (!cyc) continue;
    const keepOther = ((cyc[d.linkField] ?? []) as string[]).filter((x) => !tankPrepSet.has(x));
    await db.mixerCycle.update({ where: { id: d.cycleId }, data: { [d.linkField]: [...keepOther, ...a] } });
  }

  return { ok: true, message: `Corrected — ${diff.affectedCycles} downstream cycle(s) re-balanced, ${diff.remainingChanges.length} prep weight(s) adjusted.`, diff };
}

export async function listResinTanks(): Promise<{ tankNo: string; preps: number; remaining: number }[]> {
  // aggregate in the DB instead of pulling every prep row
  const rows: any[] = await db.dailyResinTank.groupBy({ by: ["dailyTankNo"], _count: { _all: true }, _sum: { remainingWeight: true } });
  return rows
    .map((r) => ({ tankNo: (r.dailyTankNo ?? "").toString().trim(), preps: r._count?._all ?? 0, remaining: r2(num(r._sum?.remainingWeight)) }))
    .filter((r) => r.tankNo)
    .sort((a, b) => a.tankNo.localeCompare(b.tankNo));
}
