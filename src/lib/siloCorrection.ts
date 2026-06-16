// Silo timeline CORRECTION engine — "correct at a point, ripple forward".
//
// We do NOT rebuild a silo's whole history from scratch (the data can't support
// that — a year of draw-down survives only as imported links + decremented
// weights). Instead we ANCHOR on the existing links: model the silo's FIFO from
// the recorded draws, apply the operator's fix to one bag, and apply only the
// DELTA between the before/after FIFO. Everything upstream of the change is
// identical in both models, so it is never touched; the difference ripples
// forward through the later cycles until it is absorbed (or lands on current
// stock). Every correction is previewed (dry-run diff) before commit.
//
//   wrong weight -> adjust the bag's kg, ripple forward
//   wrong bag    -> swap RM/identity at that position (kg flow unchanged)
//   skipped bag  -> insert a bag at the point (absorbs demand, pushes forward)
//   extra bag    -> delete the bag (its demand falls to the next bags)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { localId } from "@/lib/rbac";
import { classifySilo } from "@/lib/siloClass";
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

// ---------------- types ----------------
export interface LedgerDraw { batch: string | null; cycle: number | null; linkField: string; kg: number; }
export interface LedgerBag {
  id: string; airtableId: string; increment: number; date: string | null;
  weight: number; remaining: number; rmAirtableId: string | null;
  label: string; material: string; supplier: string | null; draws: LedgerDraw[]; consumed: number;
}
export interface SiloLedger { siloNo: string; bags: LedgerBag[]; totalDumped: number; totalRemaining: number; drawCount: number; }

export type Op =
  | { type: "editWeight"; bagId: string; newWeight: number }
  | { type: "swapBag"; bagId: string; rmAirtableId: string | null }
  | { type: "insert"; afterBagId: string | null; weight: number; rmAirtableId?: string | null; date?: string | null; invNoBagNo?: string | null; batch?: string | null }
  | { type: "delete"; bagId: string };

export interface CorrectionDiff {
  siloNo: string; kind: string;
  remainingChanges: { label: string; increment: number; before: number; after: number }[];
  linkChanges: { batch: string | null; cycle: number | null; linkField: string; before: string[]; after: string[] }[];
  shortfalls: { batch: string | null; cycle: number | null; linkField: string; short: number }[];
  affectedCycles: number; affectedBatches: string[]; note: string;
}

// ---------------- loading ----------------
function cycleSelect() {
  const sel: Record<string, boolean> = { id: true, airtableId: true, batch: true, cycle: true, createTime: true, mixerStartTime: true, importedAt: true, fillerSiloBuffer: true, fillerSiloIdIds: true };
  for (let m = 1; m <= 4; m++) { sel[`m${m}FW`] = true; for (let g = 1; g <= 5; g++) { sel[`m${m}W${g}`] = true; sel[`m${m}G${g}Sn`] = true; sel[`m${m}G${g}Ids`] = true; } }
  return sel;
}
// Only the cycles that can possibly reference this silo (by station-number
// field or by linking one of its bags) — the in-memory hit test in
// collectDraws() applies the exact same condition, so results are identical
// to a full-table scan while transferring a fraction of the bytes.
function cycleWhere(siloNo: string, bagAids: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const or: any[] = [];
  for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) {
    or.push({ [`m${m}G${g}Sn`]: siloNo });
    if (bagAids.length) or.push({ [`m${m}G${g}Ids`]: { hasSome: bagAids } });
  }
  or.push({ fillerSiloBuffer: siloNo });
  if (bagAids.length) or.push({ fillerSiloIdIds: { hasSome: bagAids } });
  return { OR: or };
}
async function loadCycles(siloNo: string, bags: any[]): Promise<any[]> {
  return db.mixerCycle.findMany({ where: cycleWhere(siloNo, bags.map((b) => b.airtableId)), select: cycleSelect() });
}

async function loadBags(siloNo: string): Promise<any[]> {
  return db.silo.findMany({ where: { siloNo }, orderBy: [{ siloIncrement: "asc" }, { date: "asc" }], select: { id: true, airtableId: true, siloIncrement: true, date: true, weight: true, remainingWeight: true, invNoBagNo: true, rmIds: true, sizeFromUsedBag: true, gradeFromUsedBag: true, typeFromUsedBag: true, nameFromSupplierMasterFromUsedBag: true, batch: true } });
}

interface Draw { uid: string; cycleId: string; cycleAirtableId: string; batch: string | null; cycleNo: number; linkField: string; weight: number; time: number; }
// A draw = one (cycle, slot) that the EXISTING links say consumed from this silo.
function collectDraws(siloNo: string, bags: any[], cycles: any[]): Draw[] {
  const bagSet = new Set(bags.map((b) => b.airtableId));
  // Draws settled by a WRITTEN-OFF deficit are forgiven — never re-fed from real stock.
  const writtenOff = new Set(bags.filter((b: any) => isDeficitId(b.airtableId) && String(b.invNoBagNo ?? "").startsWith(WRITTEN_OFF_LABEL)).map((b: any) => b.airtableId));
  const draws: Draw[] = [];
  for (const r of cycles) {
    if (parseBatchNumber(r.batch) < FORGIVE_BEFORE_BATCH) continue; // forgive pre-cutoff draws
    // FIFO recency: Airtable createTime, else the entered start time, else the
    // moment the row was created in the ERP (always set) — the old batch-number
    // fallback stamped app-entered cycles as 1970 and broke the replay order.
    const ts = r.createTime ?? r.mixerStartTime ?? r.importedAt;
    const t = ts ? new Date(ts).getTime() : parseBatchNumber(r.batch) * 1e6 + num(r.cycle);
    for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) {
      const lf = `m${m}G${g}Ids`; const ids = (r[lf] ?? []) as string[];
      const w = num(r[`m${m}W${g}`]); const snHit = (r[`m${m}G${g}Sn`] ?? "").toString().trim() === siloNo;
      if (w > 0 && !ids.some((x) => writtenOff.has(x)) && (ids.some((x) => bagSet.has(x)) || snHit)) draws.push({ uid: `${r.id}:${lf}`, cycleId: r.id, cycleAirtableId: r.airtableId, batch: r.batch ?? null, cycleNo: num(r.cycle), linkField: lf, weight: w, time: t });
    }
    const ftot = num(r.m1FW) + num(r.m2FW) + num(r.m3FW) + num(r.m4FW);
    const fids = (r.fillerSiloIdIds ?? []) as string[];
    const fHit = (r.fillerSiloBuffer ?? "").toString().trim() === siloNo;
    if (ftot > 0 && !fids.some((x) => writtenOff.has(x)) && (fids.some((x) => bagSet.has(x)) || fHit)) draws.push({ uid: `${r.id}:fillerSiloIdIds`, cycleId: r.id, cycleAirtableId: r.airtableId, batch: r.batch ?? null, cycleNo: num(r.cycle), linkField: "fillerSiloIdIds", weight: ftot, time: t });
  }
  draws.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.cycleNo - b.cycleNo));
  return draws;
}

// ---------------- FIFO model ----------------
interface SimBag { aid: string; weight: number; }
interface Model { remaining: Map<string, number>; drawAlloc: Map<string, { aid: string; kg: number }[]>; bagDraws: Map<string, LedgerDraw[]>; consumed: Map<string, number>; }
function model(bags: SimBag[], draws: Draw[]): Model {
  const remaining = new Map(bags.map((b) => [b.aid, b.weight]));
  const consumed = new Map(bags.map((b) => [b.aid, 0]));
  const order = bags.map((b) => b.aid);
  const drawAlloc = new Map<string, { aid: string; kg: number }[]>();
  const bagDraws = new Map<string, LedgerDraw[]>();
  for (const d of draws) {
    let left = d.weight; const alloc: { aid: string; kg: number }[] = [];
    for (const aid of order) {
      if (left <= 1e-9) break; const rem = remaining.get(aid) ?? 0; if (rem <= 0) continue;
      const take = Math.min(rem, left); left -= take; remaining.set(aid, rem - take); consumed.set(aid, (consumed.get(aid) ?? 0) + take);
      alloc.push({ aid, kg: take }); const bd = bagDraws.get(aid) ?? []; bd.push({ batch: d.batch, cycle: d.cycleNo, linkField: d.linkField, kg: take }); bagDraws.set(aid, bd);
    }
    drawAlloc.set(d.uid, alloc);
  }
  return { remaining, drawAlloc, bagDraws, consumed };
}

// build the proposed in-memory bag list for an op
function opBags(bags: any[], op: Op): SimBag[] {
  let list = bags.map((b) => ({ aid: b.airtableId, weight: num(b.weight), inc: num(b.siloIncrement) }));
  if (op.type === "editWeight") list = list.map((b) => (b.aid === bagAid(bags, op.bagId) ? { ...b, weight: op.newWeight } : b));
  if (op.type === "delete") { const a = bagAid(bags, op.bagId); list = list.filter((b) => b.aid !== a); }
  if (op.type === "insert") { const after = op.afterBagId ? bags.find((x) => x.id === op.afterBagId) : null; const inc = (after ? num(after.siloIncrement) : 0) + 0.5; list.push({ aid: "__new__", weight: op.weight, inc }); }
  // swapBag: kg flow unchanged
  list.sort((a, b) => a.inc - b.inc);
  return list.map((b) => ({ aid: b.aid, weight: b.weight }));
}
const bagAid = (bags: any[], id: string) => bags.find((b) => b.id === id)?.airtableId ?? id;

// ---------------- ledger (display) ----------------
export async function getSiloLedger(siloNo: string): Promise<SiloLedger> {
  const bags = await loadBags(siloNo);
  const cycles = await loadCycles(siloNo, bags);
  const draws = collectDraws(siloNo, bags, cycles);
  const m = model(bags.map((b) => ({ aid: b.airtableId, weight: num(b.weight) })), draws);
  const rows: LedgerBag[] = bags.map((b) => ({
    id: b.id, airtableId: b.airtableId, increment: num(b.siloIncrement),
    date: b.date ? new Date(b.date).toISOString().slice(0, 10) : null,
    weight: r2(num(b.weight)), remaining: r2(num(b.remainingWeight)), rmAirtableId: (b.rmIds && b.rmIds[0]) ?? null,
    label: b.invNoBagNo ? String(b.invNoBagNo) : `inc#${num(b.siloIncrement)}`,
    material: [lookup(b.sizeFromUsedBag), lookup(b.gradeFromUsedBag), lookup(b.typeFromUsedBag)].filter(Boolean).join(" · ") || "—",
    supplier: lookup(b.nameFromSupplierMasterFromUsedBag),
    draws: (m.bagDraws.get(b.airtableId) ?? []).map((d) => ({ ...d, kg: r2(d.kg) })),
    consumed: r2(m.consumed.get(b.airtableId) ?? 0),
  }));
  return { siloNo, bags: rows, totalDumped: r2(rows.reduce((a, r) => a + r.weight, 0)), totalRemaining: r2(rows.reduce((a, r) => a + r.remaining, 0)), drawCount: draws.length };
}

// ---------------- diff helpers ----------------
function buildDiff(siloNo: string, kind: string, bags: any[], before: Model, after: Model, draws: Draw[], labelOf: (aid: string) => string): CorrectionDiff {
  const remainingChanges: CorrectionDiff["remainingChanges"] = [];
  const recRemaining = new Map<string, number>(bags.map((b) => [b.airtableId, num(b.remainingWeight)]));
  const aids = new Set<string>([...before.remaining.keys(), ...after.remaining.keys()]);
  for (const aid of aids) {
    const delta = (after.remaining.get(aid) ?? 0) - (before.remaining.get(aid) ?? 0);
    if (Math.abs(delta) < 1e-6) continue;
    const baseline = recRemaining.has(aid) ? (recRemaining.get(aid) ?? 0) : (after.remaining.get(aid) ?? 0) - delta;
    remainingChanges.push({ label: labelOf(aid), increment: 0, before: r2(baseline), after: r2(baseline + delta) });
  }
  const linkChanges: CorrectionDiff["linkChanges"] = [];
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
  // Only report shortfalls this correction NEWLY creates or worsens (the silo
  // may already be slightly over-subscribed; that's not caused by the fix).
  const shortOf = (m: Model, d: Draw) => d.weight - (m.drawAlloc.get(d.uid) ?? []).reduce((s, x) => s + x.kg, 0);
  const shortAfter: CorrectionDiff["shortfalls"] = [];
  for (const d of draws) { const worse = shortOf(after, d) - shortOf(before, d); if (worse > 1) shortAfter.push({ batch: d.batch, cycle: d.cycleNo, linkField: d.linkField, short: r2(shortOf(after, d)) }); }
  const affectedCycles = new Set(linkChanges.map((l) => `${l.batch}·${l.cycle}`)).size;
  const note = `Upstream of the change is untouched; ${affectedCycles} downstream cycle(s) re-balanced${remainingChanges.length ? `, ${remainingChanges.length} bag weight(s) shift` : ""}.`;
  return { siloNo, kind, remainingChanges, linkChanges, shortfalls: shortAfter, affectedCycles, affectedBatches: [...affectedBatches], note };
}

// ---------------- preview ----------------
export async function previewCorrection(siloNo: string, op: Op): Promise<CorrectionDiff> {
  const bags = await loadBags(siloNo);
  const cycles = await loadCycles(siloNo, bags);
  const draws = collectDraws(siloNo, bags, cycles);
  return previewWith(siloNo, op, bags, draws);
}

// Pure preview on already-loaded data (no extra DB scans — applyCorrection reuses its own load).
function previewWith(siloNo: string, op: Op, bags: any[], draws: Draw[]): CorrectionDiff {
  const labels = new Map<string, string>(bags.map((b) => [b.airtableId, b.invNoBagNo ? String(b.invNoBagNo) : `inc#${num(b.siloIncrement)}`]));
  labels.set("__new__", "new bag");
  const labelOf = (aid: string) => labels.get(aid) ?? aid;

  if (op.type === "swapBag") {
    // kg flow unchanged — only RM/material re-attributes for the cycles this bag fed.
    const m = model(bags.map((b) => ({ aid: b.airtableId, weight: num(b.weight) })), draws);
    const aid = bagAid(bags, op.bagId);
    const fed = new Set((m.bagDraws.get(aid) ?? []).map((d) => `${d.batch}·${d.cycle}`));
    return { siloNo, kind: "swap", remainingChanges: [], linkChanges: [], shortfalls: [], affectedCycles: fed.size, affectedBatches: [...new Set((m.bagDraws.get(aid) ?? []).map((d) => d.batch).filter(Boolean))] as string[], note: `Material/RM of bag ${labelOf(aid)} re-attributes for ${fed.size} cycle(s). kg flow and all links are unchanged.` };
  }
  const before = model(bags.map((b) => ({ aid: b.airtableId, weight: num(b.weight) })), draws);
  const after = model(opBags(bags, op), draws);
  return buildDiff(siloNo, op.type, bags, before, after, draws, labelOf);
}

// ---------------- RM reversal ----------------
async function returnRm(rmAirtableId: string | null | undefined, siloAirtableId: string) {
  if (!rmAirtableId) return;
  try { const rm = await db.rm.findUnique({ where: { airtableId: rmAirtableId }, select: { siloIds: true } }); if (rm) await db.rm.update({ where: { airtableId: rmAirtableId }, data: { siloIds: { set: ((rm.siloIds as string[]) ?? []).filter((x) => x !== siloAirtableId) } } }); } catch { /* ignore */ }
}
async function consumeRm(rmAirtableId: string, siloAirtableId: string): Promise<Record<string, unknown>> {
  const rm = await db.rm.findUnique({ where: { airtableId: rmAirtableId } });
  if (!rm) return {};
  const j = (v: unknown) => (v == null || v === "" ? [] : [v]);
  await db.rm.update({ where: { airtableId: rmAirtableId }, data: { siloIds: { set: [...(((rm.siloIds as string[]) ?? [])), siloAirtableId] } } });
  return { rmIds: [rmAirtableId], sizeFromUsedBag: j(rm.size), gradeFromUsedBag: j(rm.grade), typeFromUsedBag: j(rm.type), nameFromSupplierMasterFromUsedBag: rm.nameFromSupplierMaster ?? [], invNoFromUsedBag: j(rm.invNo), bagNoFromUsedBag: j(rm.bagNo), invNoBagNo: [rm.invNo, rm.bagNo].filter(Boolean).join(" ; Bag: ") || null };
}
async function renumberSilo(siloNo: string) {
  const bags = await db.silo.findMany({ where: { siloNo }, orderBy: [{ siloIncrement: "asc" }, { date: "asc" }], select: { id: true, siloIncrement: true } });
  let i = 1; for (const b of bags) { if (num(b.siloIncrement) !== i) await db.silo.update({ where: { id: b.id }, data: { siloIncrement: i } }); i++; }
}

// ---------------- apply (commit the delta) ----------------
export async function applyCorrection(siloNo: string, op: Op): Promise<{ ok: boolean; message: string; diff: CorrectionDiff }> {
  const bags = await loadBags(siloNo);
  const cycles = await loadCycles(siloNo, bags);
  const draws = collectDraws(siloNo, bags, cycles);
  const diff = previewWith(siloNo, op, bags, draws); // same data — no second full scan

  // swap: just re-point RM + copy material, no ripple
  if (op.type === "swapBag") {
    const bag = bags.find((b) => b.id === op.bagId); if (!bag) return { ok: false, message: "Bag not found.", diff };
    await returnRm((bag.rmIds as string[])?.[0] ?? null, bag.airtableId);
    const data = op.rmAirtableId ? await consumeRm(op.rmAirtableId, bag.airtableId) : { rmIds: [] };
    await db.silo.update({ where: { id: op.bagId }, data });
    return { ok: true, message: `Bag re-pointed. ${diff.affectedCycles} cycle(s) re-attributed (kg unchanged).`, diff };
  }

  // models for the delta
  const before = model(bags.map((b) => ({ aid: b.airtableId, weight: num(b.weight) })), draws);

  // structural ledger edit (+ RM reversal)
  let newBagAid: string | null = null;
  if (op.type === "editWeight") {
    await db.silo.update({ where: { id: op.bagId }, data: { weight: op.newWeight } });
  } else if (op.type === "delete") {
    const bag = bags.find((b) => b.id === op.bagId); if (!bag) return { ok: false, message: "Bag not found.", diff };
    await returnRm((bag.rmIds as string[])?.[0] ?? null, bag.airtableId);
    await db.silo.delete({ where: { id: op.bagId } });
    await renumberSilo(siloNo);
  } else if (op.type === "insert") {
    const after = op.afterBagId ? bags.find((x) => x.id === op.afterBagId) : null;
    const airtableId = localId("silo"); newBagAid = airtableId;
    const base: Record<string, unknown> = { airtableId, siloNo, siloIncrement: (after ? num(after.siloIncrement) : 0) + 0.5, weight: op.weight, remainingWeight: op.weight, date: op.date ? new Date(op.date) : new Date(), batch: op.batch ?? null };
    if (op.rmAirtableId) Object.assign(base, await consumeRm(op.rmAirtableId, airtableId)); else if (op.invNoBagNo) base.invNoBagNo = op.invNoBagNo;
    await db.silo.create({ data: base }); await renumberSilo(siloNo);
  }

  // recompute AFTER model on the fresh ledger, map "__new__" to the real id.
  // Re-load cycles too — one may have been entered while the operator reviewed.
  const bags2 = await loadBags(siloNo);
  const cycles2 = await loadCycles(siloNo, bags2);
  const draws2 = collectDraws(siloNo, bags2, cycles2);
  const after = model(bags2.map((b) => ({ aid: b.airtableId, weight: num(b.weight) })), draws2);

  // 1) apply remaining DELTA on top of recorded baseline (upstream delta = 0 -> untouched)
  const recById = new Map<string, any>(bags2.map((b) => [b.airtableId, b]));
  const aidsAll = new Set<string>([...before.remaining.keys(), ...after.remaining.keys()]);
  for (const aid of aidsAll) {
    const bag = recById.get(aid); if (!bag) continue;
    const beforeRem = before.remaining.has(aid) ? (before.remaining.get(aid) ?? 0) : num(bag.weight);
    const delta = (after.remaining.get(aid) ?? 0) - beforeRem;
    if (Math.abs(delta) < 1e-6 && aid !== newBagAid) continue;
    const baseline = aid === newBagAid ? num(bag.weight) : num(bag.remainingWeight);
    const target = aid === newBagAid ? (after.remaining.get(aid) ?? num(bag.weight)) : baseline + delta;
    // deficit placeholders legitimately hold negative remaining (unbacked draws) — don't clamp them
    const isDeficit = String(bag.airtableId ?? "").startsWith("deficit_");
    await db.silo.update({ where: { id: bag.id }, data: { remainingWeight: r2(isDeficit ? target : Math.max(0, target)) } });
  }

  // 2) rewrite cycle links only for draws whose bag-set changed (downstream)
  const siloBagSet = new Set(bags2.map((b) => b.airtableId));
  const cyById = new Map<string, any>(cycles2.map((c: any) => [c.id, c]));
  for (const d of draws2) {
    const b = (before.drawAlloc.get(d.uid) ?? []).map((x) => x.aid).filter((x) => x !== "__new__");
    const a = (after.drawAlloc.get(d.uid) ?? []).map((x) => x.aid);
    const bs = new Set(b), as = new Set(a);
    const changed = b.length !== a.length || [...as].some((x) => !bs.has(x)) || [...bs].some((x) => !as.has(x));
    if (!changed) continue;
    const cyc = cyById.get(d.cycleId); if (!cyc) continue;
    const keepOther = ((cyc[d.linkField] ?? []) as string[]).filter((x) => !siloBagSet.has(x));
    await db.mixerCycle.update({ where: { id: d.cycleId }, data: { [d.linkField]: [...keepOther, ...a] } });
  }

  // 3) refresh silo-side reverse arrays for bags whose draws changed
  const touchedBags = new Set<string>();
  for (const d of draws2) { for (const x of [...(before.drawAlloc.get(d.uid) ?? []), ...(after.drawAlloc.get(d.uid) ?? [])]) touchedBags.add(x.aid); }
  for (const aid of touchedBags) {
    const bag = recById.get(aid); if (!bag) continue;
    const rev: Record<string, Set<string>> = {};
    for (const d of draws2) { const a = after.drawAlloc.get(d.uid) ?? []; if (a.some((x) => x.aid === aid)) { const cyc = cyById.get(d.cycleId); if (cyc) (rev[d.linkField] ||= new Set()).add(cyc.airtableId); } }
    const data: Record<string, string[]> = {};
    for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) { const lf = `m${m}G${g}Ids`; if (rev[lf]) data[lf] = [...rev[lf]]; }
    if (rev.fillerSiloIdIds) data.fillerSiloIdIds = [...rev.fillerSiloIdIds];
    if (Object.keys(data).length) await db.silo.update({ where: { id: bag.id }, data });
  }

  return { ok: true, message: `Corrected — ${diff.affectedCycles} downstream cycle(s) re-balanced, ${diff.remainingChanges.length} bag weight(s) adjusted.`, diff };
}

// ---------------- RM bag options (in-store bags of this silo's material kind) ----------------
export interface RmOption { airtableId: string; label: string; material: string; }
export async function getRmOptions(siloNo: string): Promise<RmOption[]> {
  const kind = classifySilo(siloNo); // "grit" | "filler"
  let rows: any[] = [];
  try { rows = await db.rm.findMany({ where: { siloIds: { isEmpty: true } }, select: { airtableId: true, invNo: true, bagNo: true, size: true, grade: true, type: true, nameFromSupplierMaster: true }, take: 400, orderBy: [{ invNo: "asc" }, { bagNo: "asc" }] }); } catch { return []; }
  return rows
    .filter((r) => { const t = (r.type ?? "").toString().toLowerCase(); return kind === "grit" ? t.includes("grit") : kind === "filler" ? t.includes("filler") : true; })
    .map((r) => ({ airtableId: r.airtableId, label: `INV ${r.invNo ?? "—"}${r.bagNo != null ? ` · Bag ${Math.round(r.bagNo)}` : ""}`, material: [lookup(r.size), lookup(r.grade), lookup(r.type)].filter(Boolean).join(" · ") || "—" }));
}

/** Exact per-bag takes for every draw touching the given bags, ANCHORED ON
 * LINKS (a full-history FIFO replay is infeasible — see header). Each draw is
 * replayed only across the bags it is actually linked to, in bag-FIFO order,
 * sharing bag capacity with the other draws that link the same bags.
 * Key: "<cycleId>:<linkField>" -> [{ aid, kg }]. Used by Slab Lookup. */
export async function batchDrawAllocations(bagAids: string[]): Promise<Map<string, { aid: string; kg: number }[]>> {
  const out = new Map<string, { aid: string; kg: number }[]>();
  const aids = [...new Set(bagAids.filter(Boolean))];
  if (!aids.length) return out;
  try {
    const bags: any[] = await db.silo.findMany({ where: { airtableId: { in: aids } }, select: { airtableId: true, weight: true, siloIncrement: true }, orderBy: [{ siloIncrement: "asc" }, { date: "asc" }] });
    const pos = new Map<string, number>(bags.map((b, i) => [b.airtableId, i]));
    const remaining = new Map<string, number>(bags.map((b) => [b.airtableId, num(b.weight)]));

    // every cycle that links any of these bags (any batch — bags can span batches)
    const linkFields: string[] = [];
    for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) linkFields.push(`m${m}G${g}Ids`);
    linkFields.push("fillerSiloIdIds");
    const cycles: any[] = await db.mixerCycle.findMany({ where: { OR: linkFields.map((f) => ({ [f]: { hasSome: aids } })) }, select: cycleSelect() });

    interface D { uid: string; t: number; w: number; links: string[]; }
    const draws: D[] = [];
    for (const r of cycles) {
      const ts = r.createTime ?? r.mixerStartTime ?? r.importedAt;
      const t = ts ? new Date(ts).getTime() : parseBatchNumber(r.batch) * 1e6 + num(r.cycle);
      for (let m = 1; m <= 4; m++) for (let g = 1; g <= 5; g++) {
        const lf = `m${m}G${g}Ids`; const ids = ((r[lf] ?? []) as string[]).filter((x) => pos.has(x) || x.startsWith("deficit_"));
        const w = num(r[`m${m}W${g}`]);
        if (w > 0 && ids.length) draws.push({ uid: `${r.id}:${lf}`, t, w, links: ids });
      }
      const fids = ((r.fillerSiloIdIds ?? []) as string[]).filter((x) => pos.has(x) || x.startsWith("deficit_"));
      const ftot = num(r.m1FW) + num(r.m2FW) + num(r.m3FW) + num(r.m4FW);
      if (ftot > 0 && fids.length) draws.push({ uid: `${r.id}:fillerSiloIdIds`, t, w: ftot, links: fids });
    }
    draws.sort((a, b) => a.t - b.t);

    for (const d of draws) {
      let left = d.w;
      const alloc: { aid: string; kg: number }[] = [];
      const ordered = d.links.filter((x) => pos.has(x)).sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
      for (const aid of ordered) {
        if (left <= 1e-9) break;
        const rem = remaining.get(aid) ?? 0;
        if (rem <= 0) continue;
        const take = Math.min(rem, left);
        left -= take; remaining.set(aid, rem - take);
        alloc.push({ aid, kg: take });
      }
      if (left > 1e-9) {
        const ph = d.links.find((x) => x.startsWith("deficit_"));
        alloc.push({ aid: ph ?? "deficit_implicit", kg: left }); // unbacked share, shown as its own line
      }
      out.set(d.uid, alloc);
    }
  } catch { /* best effort — caller falls back to ratio split */ }
  return out;
}
