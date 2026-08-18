// Slab Lookup — traces a single slab from RM → Silo → Mixer → line → polishing.
// The slab's station journey is exact. The per-slab RM composition is FIFO-derived
// (no physical per-slab material link exists), yield-adjusted so each slab's RM
// sums to the slab's weight and batch wastage (mixer→distributor) is spread evenly.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { batchDrawAllocations } from "@/lib/siloCorrection";
import { WRITTEN_OFF_LABEL } from "@/lib/backfill";
import { tableMeta } from "@/lib/tables";

const db = prisma as any;

function lookup(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) { const x = v.find((y) => y != null && y !== ""); return x == null ? null : String(x); }
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s || null;
}
function dstr(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16).replace("T", " ");
}
// Render any column value for the expanded parameter list.
function fmtVal(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return dstr(v);
  if (typeof v === "number") return (Math.round(v * 100) / 100).toString();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) { const x = v.map((y) => lookup(y)).filter(Boolean); return x.length ? x.join(", ") : null; }
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s || null;
}

// Fields shown in the header / operator slot — not repeated in the param grid.
const PARAM_SKIP = new Set(["slabNumber", "batch", "batchNumber", "batchKey", "airtableId", "id", "importedAt", "syncedAt", "createdTime", "created", "operator", "calliberator", "inspector"]);
function allParams(model: string, row: any): { label: string; value: string }[] {
  const meta = tableMeta(model);
  if (!meta || !row) return [];
  const out: { label: string; value: string }[] = [];
  for (const f of meta.fields) {
    if (!f.editable) continue;
    if (PARAM_SKIP.has(f.prismaField)) continue;
    const v = fmtVal(row[f.prismaField]);
    if (v == null) continue;
    out.push({ label: f.airtableName, value: v });
  }
  return out;
}

export interface StationStop {
  key: string; label: string; model: string; present: boolean;
  /** set when this station's batch disagrees with the line head's batch for this slab */
  wrongBatch: { entered: string; lineHead: string } | null;
  date: string | null; operator: string | null;
  fields: { label: string; value: string }[];      // short summary line
  allFields: { label: string; value: string }[];   // every parameter set for this slab
  recordId: string | null;                          // link to the full record
}
export interface SlabRm {
  label: string;          // INV: x · Bag: y
  material: string;       // size · grade · type
  supplier: string | null;
  kg: number;             // attributed to THIS slab
}
export interface SlabReport {
  found: boolean;
  slabNumber: number;
  batch: string | null;
  design: string | null;
  thickness: string | null;
  slabWeight: number | null;
  journey: StationStop[];
  rm: SlabRm[];
  rmTotal: number;
  wastagePct: number | null;
  provisional: boolean;   // batch still running → numbers may finalize at close
  batchClosed: boolean;   // a later batch has started at the mixer → composition final
  closeReason: string | null; // human-readable explanation of provisional/final state
  rmNote: string | null;  // why RM is unavailable, if it is
  unbacked: boolean;      // some RM was drawn from a silo/tank not yet filled digitally
}

// Summary fields that are machine/dosing readings rather than slab identity. A basic
// read is limited to date, operator, design, thickness, status/quality and the slab's
// own weight, so these are dropped from it.
const BASIC_SKIP_FIELDS = new Set(["distributorHopperWeight"]);

// Journey stations in line order, with the fields to surface per stop.
const STATIONS: { key: string; model: string; label: string; date: string; op: string; fields: [string, string][] }[] = [
  { key: "distributor", model: "Distributor", label: "Distributor", date: "date", op: "operator", fields: [["designName", "Design"], ["slabThickness", "Thickness"], ["distributorHopperWeight", "Hopper kg"]] },
  { key: "kreos", model: "Kreos", label: "Kreos", date: "date", op: "operator", fields: [["designName", "Design"], ["slabThickness", "Thickness"], ["slabWeight", "Slab kg"]] },
  { key: "press", model: "Press", label: "Press", date: "date", op: "operator", fields: [["designName", "Design"], ["slabWeight", "Slab kg"]] },
  { key: "oven", model: "Oven", label: "Oven", date: "date", op: "operator", fields: [["designName", "Design"]] },
  { key: "jot", model: "Jot", label: "Jot", date: "date", op: "operator", fields: [["designName", "Design"], ["thickness", "Thickness"], ["slabWeight", "Slab kg"]] },
  { key: "polishEntry", model: "PolishEntry", label: "Polish Entry", date: "created", op: "calliberator", fields: [["design", "Design"], ["polishingStatus", "Status"], ["slabThickness", "Thickness"]] },
  { key: "polishQc", model: "PolishQc", label: "Polish QC", date: "createdTime", op: "inspector", fields: [["design", "Design"], ["qualityGrade", "Quality"], ["dispatchStatus", "Dispatch"]] },
];

function val(row: any, f: string): string | null {
  const v = row?.[f];
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100 + "";
  return lookup(v);
}

/** Human-readable explanation of the provisional/final state. Shared by the full and
 *  the basic read — the close state is the same question either way. */
function closeReasonFor(batchClosed: boolean, lineHeadMovedOn: boolean, pendingPress: number): string {
  if (batchClosed) return "Batch closed — a later batch has opened at the line head (Distributor / Kreos) and every slab in this batch has a Press weight, so neither the slab set nor the yield can change. This composition is final.";
  if (lineHeadMovedOn) return `Almost final — the line head has moved to a newer batch, but ${pendingPress} slab(s) in this batch still have no Press weight. The material identity is settled; the yield finalizes once those slabs are weighed.`;
  return "Batch still running — it is the most recent batch at the line head (Distributor / Kreos). More slabs can still be added; it finalizes once the next batch opens at the line head and all slabs are weighed.";
}

export interface SlabReportOptions {
  /** Basic details only — the station journey summary plus the slab header. No machine
   *  parameters, no per-record links, no RM composition. None of it is FETCHED either:
   *  allParams() is skipped and the function returns before the mixer-cycle, silo-bag,
   *  resin-tank and FIFO-allocation queries run, so there is no parameter or material
   *  data on the returned payload for the caller to have to strip. */
  basic?: boolean;
}

export async function getSlabReport(input: string | number, opts: SlabReportOptions = {}): Promise<SlabReport> {
  const basic = opts.basic === true;
  const slabNumber = typeof input === "number" ? input : parseFloat(String(input).replace(/[^\d.]/g, ""));
  const empty: SlabReport = { found: false, slabNumber, batch: null, design: null, thickness: null, slabWeight: null, journey: [], rm: [], rmTotal: 0, wastagePct: null, provisional: false, batchClosed: false, closeReason: null, rmNote: null , unbacked: false };
  if (!Number.isFinite(slabNumber)) return empty;

  // ---- station journey (exact) ----
  const journey: StationStop[] = [];
  const rowKeys: (string | null)[] = [];   // each station row's batchKey
  const rowRaw: (string | null)[] = [];    // each station row's raw batch text
  let batchKey: string | null = null;
  let design: string | null = null;
  let thickness: string | null = null;
  let slabWeight: number | null = null;

  for (const st of STATIONS) {
    let row: any = null;
    try { row = await db[st.model[0].toLowerCase() + st.model.slice(1)].findFirst({ where: { slabNumber } }); } catch { /* ignore */ }
    if (row) {
      batchKey ??= row.batchKey ?? lookup(row.batch) ?? lookup(row.batchNumber);
      design ??= lookup(row.designName) ?? lookup(row.design);
      thickness ??= lookup(row.slabThickness) ?? (row.thickness != null ? String(row.thickness) : null);
      if (slabWeight == null && typeof row.slabWeight === "number") slabWeight = Math.round(row.slabWeight);
    }
    rowKeys.push(row ? ((row.batchKey as string | null) ?? null) : null);
    rowRaw.push(row ? (lookup(row.batch) ?? lookup(row.batchNumber)) : null);
    journey.push({
      key: st.key, label: st.label, model: st.model, present: !!row, wrongBatch: null,
      date: row ? dstr(row[st.date] ?? row.createdTime ?? row.date) : null,
      operator: row ? (lookup(row[st.op]) ?? lookup(row.operator)) : null,
      fields: row ? st.fields.filter(([f]) => !(basic && BASIC_SKIP_FIELDS.has(f))).map(([f, l]) => ({ label: l, value: val(row, f) ?? "—" })).filter((x) => x.value !== "—") : [],
      // Machine settings / recipe and the full-record link are the two things a basic
      // read must not carry — neither is built, so neither is serialised to the client.
      allFields: row && !basic ? allParams(st.model, row) : [],
      recordId: basic ? null : (row?.id ?? null),
    });
  }

  // The line head (Distributor idx 0 / Kreos idx 1) owns the slab's true batch.
  // Flag any later station whose batch disagrees (wrong-batch entry).
  const lineHeadKey = rowKeys[0] ?? rowKeys[1];
  if (lineHeadKey) {
    for (let i = 2; i < journey.length; i++) {
      if (journey[i].present && rowKeys[i] && rowKeys[i] !== lineHeadKey) {
        journey[i].wrongBatch = { entered: rowRaw[i] ?? rowKeys[i]!, lineHead: lineHeadKey };
      }
    }
  }

  if (!journey.some((j) => j.present)) return { ...empty, batch: batchKey };
  if (!batchKey) return { ...empty, found: true, journey, slabWeight, design, thickness, rmNote: basic ? null : "This slab has no batch recorded — it can’t be linked to any mixer cycle." };

  // ---- batch close (airtight) — two conditions must BOTH hold:
  //  (a) the line head (Distributor / Kreos) has moved on to a newer batch, so
  //      no more slabs will ever be created for this batch; AND
  //  (b) every slab this batch created has a Press weight recorded, so the
  //      total slab weight — and therefore the yield — can no longer change.
  // Until both are true the composition is provisional. ----
  let lineHeadMovedOn = false;
  try {
    let originBatch: string | null = null; let originTime = -1;
    for (const m of ["distributor", "kreos"]) {
      const row = await db[m].findFirst({ orderBy: { importedAt: "desc" }, select: { batchKey: true, importedAt: true } });
      const t = row?.importedAt ? new Date(row.importedAt).getTime() : -1;
      if (row?.batchKey && t > originTime) { originTime = t; originBatch = row.batchKey; }
    }
    if (originBatch && originBatch !== batchKey) lineHeadMovedOn = true;
  } catch { /* ignore */ }

  // ---- batch slabs, this slab's weight, and the close state. None of this reads the
  // RM stream, so it is computed BEFORE it: a basic read still needs the slab's own
  // weight and the final/provisional badge, and nothing else. ----
  const slabs: any[] = await db.press.findMany({ where: { batchKey, slabNumber: { not: null } }, select: { slabNumber: true, slabWeight: true }, orderBy: { slabNumber: "asc" } });

  // every slab created at the line head for this batch (the full slab set)
  const lineHeadNums = new Set<number>();
  try {
    for (const m of ["distributor", "kreos"]) {
      const rows: any[] = await db[m].findMany({ where: { batchKey, slabNumber: { not: null } }, select: { slabNumber: true } });
      for (const r of rows) if (typeof r.slabNumber === "number") lineHeadNums.add(r.slabNumber);
    }
  } catch { /* ignore */ }
  const weighed = new Set<number>(slabs.filter((s) => s.slabWeight != null).map((s) => s.slabNumber));
  // slabs still awaiting a Press weight (these would still move the yield)
  const pendingPress = lineHeadNums.size
    ? [...lineHeadNums].filter((n) => !weighed.has(n)).length
    : slabs.filter((s) => s.slabWeight == null).length;
  const batchClosed = lineHeadMovedOn && pendingPress === 0;
  const totalSlabW = slabs.reduce((a, s) => a + (s.slabWeight ?? 0), 0);
  const myW = slabWeight ?? slabs.find((s) => s.slabNumber === slabNumber)?.slabWeight ?? 0;

  // A basic read stops HERE — everything below is RM: mixer cycles, silo bags, resin
  // tanks, FIFO allocation, yield and wastage. Returning before those queries is what
  // makes "no RM data for Commercial" a property of the fetch, not of the markup.
  if (basic) {
    return {
      found: true, slabNumber, batch: batchKey, design, thickness, slabWeight: myW || slabWeight,
      journey, rm: [], rmTotal: 0, wastagePct: null,
      provisional: !batchClosed, batchClosed,
      closeReason: closeReasonFor(batchClosed, lineHeadMovedOn, pendingPress),
      rmNote: null, unbacked: false,
    };
  }

  // ---- batch RM consumption stream (FIFO order: cycle → slot → bags) ----
  const cycleSel: Record<string, boolean> = { id: true, cycle: true, fillerSiloIdIds: true, fillerSiloBuffer: true };
  for (let n = 1; n <= 4; n++) { cycleSel[`m${n}FW`] = true; cycleSel[`m${n}RW`] = true; cycleSel[`m${n}RIdIds`] = true; for (let g = 1; g <= 5; g++) { cycleSel[`m${n}W${g}`] = true; cycleSel[`m${n}G${g}Ids`] = true; cycleSel[`m${n}G${g}Sn`] = true; } }
  const cycles: any[] = await db.mixerCycle.findMany({ where: { batchKey }, select: cycleSel, orderBy: { cycle: "asc" } });

  const bagIds = new Set<string>();
  for (const c of cycles) {
    for (let n = 1; n <= 4; n++) { for (let g = 1; g <= 5; g++) (c[`m${n}G${g}Ids`] ?? []).forEach((i: string) => bagIds.add(i)); }
    (c.fillerSiloIdIds ?? []).forEach((i: string) => bagIds.add(i));
  }

  // Exact FIFO takes per bag, anchored on the recorded links.
  let allocMap = new Map<string, { aid: string; kg: number }[]>();
  try { allocMap = await batchDrawAllocations([...bagIds].filter((x) => !x.startsWith("deficit_"))); } catch { /* fall back to ratio split */ }

  // resin deficit placeholders referenced by this batch: written off vs pending
  const resinPhAids = new Set<string>();
  for (const c of cycles) for (let n = 1; n <= 4; n++) for (const aid of (c[`m${n}RIdIds`] ?? []) as string[]) if (aid.startsWith("deficit_")) resinPhAids.add(aid);
  const resinWrittenOff = new Map<string, boolean>();
  if (resinPhAids.size) {
    try {
      const rows: any[] = await db.dailyResinTank.findMany({ where: { airtableId: { in: [...resinPhAids] } }, select: { airtableId: true, remarks: true } });
      for (const r of rows) resinWrittenOff.set(r.airtableId, String(r.remarks ?? "").startsWith(WRITTEN_OFF_LABEL));
    } catch { /* label stays generic */ }
  }

  const bagRows: any[] = bagIds.size ? await db.silo.findMany({ where: { airtableId: { in: [...bagIds] } }, select: { airtableId: true, invNoBagNo: true, weight: true, sizeFromUsedBag: true, gradeFromUsedBag: true, typeFromUsedBag: true, nameFromSupplierMasterFromUsedBag: true } }) : [];
  const bagMap = new Map<string, any>(bagRows.map((b) => [b.airtableId, b]));

  type Stop = { key: string; label: string; material: string; supplier: string | null; kg: number; cyc: number };
  const stream: Stop[] = [];
  let cycIdx = 0;
  const emit = (ids: string[], weight: number) => {
    if (!weight || !ids?.length) return;
    const bags = ids.map((id) => bagMap.get(id)).filter(Boolean);
    if (!bags.length) return;
    const totW = bags.reduce((a, b) => a + (b.weight ?? 0), 0);
    for (const b of bags) {
      const share = totW > 0 ? (b.weight ?? 0) / totW : 1 / bags.length;
      const sz = lookup(b.sizeFromUsedBag); const label = b.invNoBagNo ? String(b.invNoBagNo) : (sz ? `${sz} (silo bag)` : "silo bag");
      const material = [lookup(b.sizeFromUsedBag), lookup(b.gradeFromUsedBag), lookup(b.typeFromUsedBag)].filter(Boolean).join(" · ");
      stream.push({ key: label, label, material: material || "—", supplier: lookup(b.nameFromSupplierMasterFromUsedBag), kg: weight * share, cyc: cycIdx });
    }
  };
  const pushAlloc = (alloc: { aid: string; kg: number }[]) => {
    for (const a of alloc) {
      if (a.kg <= 0) continue;
      if (a.aid.startsWith("deficit_")) {
        const ph = bagMap.get(a.aid);
        const wo = String(ph?.invNoBagNo ?? "").startsWith(WRITTEN_OFF_LABEL);
        if (wo) stream.push({ key: "__writtenoff", label: "✕ Grit/Filler written off", material: "composition unknown — deficit was written off", supplier: null, kg: a.kg, cyc: cycIdx });
        else stream.push({ key: "__unbacked", label: "⚠ Grit/Filler unlinked — silo entry not done", material: "unbacked — fills auto-link later", supplier: null, kg: a.kg, cyc: cycIdx });
        continue;
      }
      const b = bagMap.get(a.aid);
      const sz = b ? lookup(b.sizeFromUsedBag) : null;
      const label = b?.invNoBagNo ? String(b.invNoBagNo) : (sz ? `${sz} (silo bag)` : "silo bag");
      const material = b ? [lookup(b.sizeFromUsedBag), lookup(b.gradeFromUsedBag), lookup(b.typeFromUsedBag)].filter(Boolean).join(" · ") : "";
      stream.push({ key: label, label, material: material || "—", supplier: b ? lookup(b.nameFromSupplierMasterFromUsedBag) : null, kg: a.kg, cyc: cycIdx });
    }
  };

  for (const c of cycles) {
    for (let n = 1; n <= 4; n++) {
      for (let g = 1; g <= 5; g++) {
        const w = c[`m${n}W${g}`] ?? 0;
        if (!w) continue;
        const alloc = allocMap.get(`${c.id}:m${n}G${g}Ids`);
        if (alloc?.length) pushAlloc(alloc);
        else emit(c[`m${n}G${g}Ids`] ?? [], w);
      }
    }
    const ftot = (c.m1FW ?? 0) + (c.m2FW ?? 0) + (c.m3FW ?? 0) + (c.m4FW ?? 0);
    if (ftot > 0) {
      const alloc = allocMap.get(`${c.id}:fillerSiloIdIds`);
      if (alloc?.length) pushAlloc(alloc);
      else for (let n = 1; n <= 4; n++) emit(c.fillerSiloIdIds ?? [], c[`m${n}FW`] ?? 0);
    }
    const resinKg = (c.m1RW ?? 0) + (c.m2RW ?? 0) + (c.m3RW ?? 0) + (c.m4RW ?? 0);
    if (resinKg > 0) {
      const rLinks: string[] = []; for (let n = 1; n <= 4; n++) rLinks.push(...(((c[`m${n}RIdIds`] ?? []) as string[])));
      const phs = rLinks.filter((x) => x.startsWith("deficit_"));
      if (phs.length && phs.every((x) => resinWrittenOff.get(x))) stream.push({ key: "__resin_wo", label: "✕ Resin written off", material: "resin composition unknown — deficit was written off", supplier: null, kg: resinKg, cyc: cycIdx });
      else if (phs.length) stream.push({ key: "__resin_ub", label: "⚠ Resin unbacked — tank prep not entered", material: "unbacked — preps auto-link later", supplier: null, kg: resinKg, cyc: cycIdx });
      else stream.push({ key: "__resin", label: "Resin", material: "Resin (additive)", supplier: null, kg: resinKg, cyc: cycIdx });
    }
    cycIdx++;
  }

  // ---- yield: the RM stream measured against the batch's slab weight ----
  const totalRm = stream.reduce((a, s) => a + s.kg, 0);
  const yieldF = totalRm > 0 && totalSlabW > 0 ? Math.min(1, totalSlabW / totalRm) : 1;
  const wastagePct = totalRm > 0 && totalSlabW > 0 ? Math.round((1 - yieldF) * 1000) / 10 : null;

  // cumulative weight window for this slab (yield-adjusted stream)
  let before = 0;
  for (const s of slabs) {
    if (s.slabNumber === slabNumber) break;
    before += (s.slabWeight ?? 0);
  }
  const winStart = before, winEnd = before + myW;

  // Slice the stream CYCLE BY CYCLE (FIFO across cycles), but BLENDED within
  // each cycle: the mixer's output is mixed material, so every kg that leaves
  // a cycle carries that cycle's full grit:filler:resin ratio.
  const byBag = new Map<string, SlabRm>();
  const groups: { stops: Stop[]; kg: number }[] = [];
  for (const st of stream) {
    const last = groups[groups.length - 1];
    if (last && last.stops[0].cyc === st.cyc) { last.stops.push(st); last.kg += st.kg; }
    else groups.push({ stops: [st], kg: st.kg });
  }
  let pos = 0;
  for (const grp of groups) {
    const span = grp.kg * yieldF;
    const lo = Math.max(pos, winStart), hi = Math.min(pos + span, winEnd);
    if (hi > lo && span > 0) {
      const share = (hi - lo) / span; // fraction of this cycle's output in this slab
      for (const st of grp.stops) {
        const kg = st.kg * yieldF * share;
        if (kg <= 0) continue;
        const cur = byBag.get(st.key) ?? { label: st.label, material: st.material, supplier: st.supplier, kg: 0 };
        cur.kg += kg;
        byBag.set(st.key, cur);
      }
    }
    pos += span;
    if (pos > winEnd) break;
  }
  const rm = [...byBag.values()].map((r) => ({ ...r, kg: Math.round(r.kg * 10) / 10 })).filter((r) => r.kg > 0).sort((a, b) => b.kg - a.kg);
  const rmTotal = Math.round(rm.reduce((a, r) => a + r.kg, 0) * 10) / 10;

  // provisional until the batch is closed (line head moved on AND all slabs weighed)
  const provisional = !batchClosed;
  const closeReason = closeReasonFor(batchClosed, lineHeadMovedOn, pendingPress);
  let rmNote: string | null = null;
  if (cycles.length === 0) rmNote = `No mixer cycles found for batch ${batchKey}. The batch may not have been entered at the mixer, or was entered under a different number.`;
  else if (totalRm === 0) rmNote = `Batch ${batchKey} has ${cycles.length} mixer cycle(s) but none are linked to silo bags yet — RM allocation may be pending.`;
  else if (myW === 0) rmNote = "This slab has no weight recorded at Press, so its share of the RM can't be computed.";

  const unbacked = [...bagIds].some((id) => id.startsWith("deficit_"));
  return { found: true, slabNumber, batch: batchKey, design, thickness, slabWeight: myW || slabWeight, journey, rm, rmTotal, wastagePct, provisional, batchClosed, closeReason, rmNote, unbacked };
}
