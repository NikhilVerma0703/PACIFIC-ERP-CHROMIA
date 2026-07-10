// Phase 4 — reporting / sync / misc automations.
//   • Polishing Tables Update: QC <- linked Polish Entry (fill empties)
//   • Barcode Creation: SKU = Slab Number; barcode image from API link
//   • Automation 1: split a Slab Segregation row into per-slab rows (destructive)
//   • Update MIS Entry: backfill A/B/C category counts + Design/Batch (scheduled)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/erp";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

type FM = Record<string, { model: string; tableName: string; fields: Record<string, { prismaField: string; airtableType: string; kind: string }> }>;
let _fm: FM | null = null;
const fm = (): FM => (_fm ||= JSON.parse(readFileSync(join(process.cwd(), "scripts", "fieldmap.json"), "utf8")));
const fieldsOf = (model: string) => { const t = Object.values(fm()).find((x) => x.model === model); return t ? Object.values(t.fields) : []; };

const EDIT_KINDS = new Set(["scalar", "number", "int", "bool", "date", "multiselect"]);
const RO = new Set(["formula", "rollup", "multipleLookupValues", "count", "autoNumber", "createdTime", "lastModifiedTime", "button", "externalSyncSource"]);

// Polishing Tables Update — copy shared fields from the linked Polish Entry
// into empty Polish QC cells.
export async function polishingTablesUpdate(qcId: string) {
  const qc: any = await db.polishQc.findUnique({ where: { id: qcId } });
  if (!qc) return { skipped: true };
  const link = (qc.linkIds ?? []) as string[];
  if (!link.length) return { skipped: true };
  const pe: any = await db.polishEntry.findUnique({ where: { airtableId: link[0] } });
  if (!pe) return { skipped: true };
  const peFields = new Set(fieldsOf("PolishEntry").map((f) => f.prismaField));
  const data: Record<string, unknown> = {};
  for (const f of fieldsOf("PolishQc")) {
    if (f.prismaField === "printed") continue;
    if (RO.has(f.airtableType) || !EDIT_KINDS.has(f.kind)) continue;
    if (!peFields.has(f.prismaField)) continue;
    const cur = qc[f.prismaField];
    if (cur !== null && cur !== undefined && !(Array.isArray(cur) && cur.length === 0)) continue;
    const v = pe[f.prismaField];
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) data[f.prismaField] = v;
  }
  if (Object.keys(data).length) await db.polishQc.update({ where: { id: qcId }, data });
  return { filled: Object.keys(data).length };
}

// Barcode Creation — SKU = Slab Number; barcode image from Barcode API Link.
export async function barcodeCreation(polishEntryId: string) {
  const r: any = await db.polishEntry.findUnique({ where: { id: polishEntryId }, select: { slabNumber: true, barcodeApiLink: true, sku: true } });
  if (!r?.slabNumber) return { skipped: true };
  const data: Record<string, unknown> = { sku: String(r.slabNumber) };
  const link = typeof r.barcodeApiLink === "string" ? r.barcodeApiLink : (r.barcodeApiLink as any)?.url;
  if (typeof link === "string" && link.startsWith("http")) data.barcode = [{ url: link, filename: `${r.slabNumber}.png` }];
  await db.polishEntry.update({ where: { id: polishEntryId }, data });
  return { sku: data.sku };
}

// Automation 1 — split one Slab Segregation row into per-slab rows, then delete
// the parent. Destructive; runs on entry post-cutover.
export async function slabSegregationSplit(segId: string) {
  const rec: any = await db.slabSegregation.findUnique({ where: { id: segId } });
  if (!rec) return { skipped: true };
  const linked = (rec.slabNumbersQcIds ?? []) as string[];
  let items: { type: "linked" | "text"; value: string }[] = [];
  if (linked.length) items = linked.map((v) => ({ type: "linked", value: v }));
  else if (typeof rec.slabNumber === "string" && rec.slabNumber.trim()) items = rec.slabNumber.split(" ").map((s: string) => s.trim()).filter(Boolean).map((v: string) => ({ type: "text", value: v }));
  if (!items.length) return { skipped: true };

  const base: Record<string, unknown> = {};
  const skip = new Set(["id", "airtableId", "importedAt", "syncedAt", "slabNumbersQcIds", "slabNumber", "sno"]);
  for (const k of Object.keys(rec)) if (!skip.has(k) && rec[k] !== undefined) base[k] = rec[k];

  for (const it of items) {
    const data: any = { ...base, airtableId: `seg-${segId}-${it.value}-${Math.random().toString(36).slice(2, 7)}` };
    if (it.type === "linked") data.slabNumbersQcIds = [it.value]; else data.slabNumber = it.value;
    await db.slabSegregation.create({ data });
  }
  await db.slabSegregation.delete({ where: { id: segId } });
  return { created: items.length };
}

// Update MIS Entry — fill A/B/C category counts from Polish QC grades over each
// MIS row's [start,end] slab range, and Design/Batch from Change Parameters
// Press (latest effective <= start). Fills only empty values. Scheduled.
export async function updateMisEntry() {
  const [mis, qc, press] = await Promise.all([
    db.mis.findMany({ select: { id: true, startingSlabNumber: true, endingSlabNumber: true, numberOfSlabsProduced: true, aCategory: true, bCategory: true, cCategory: true, design: true, batch: true } }),
    db.polishQc.findMany({ select: { slabNumber: true, qualityGrade: true } }),
    db.changeParametersPress.findMany({ select: { effectiveFromSlabNumber: true, designName: true, batch: true } }),
  ]);
  const grade = new Map<number, string>();
  for (const q of qc) if (typeof q.slabNumber === "number" && q.qualityGrade) grade.set(q.slabNumber, String(q.qualityGrade).trim().toUpperCase());
  const sortedPress = press.filter((p: any) => typeof p.effectiveFromSlabNumber === "number").sort((a: any, b: any) => b.effectiveFromSlabNumber - a.effectiveFromSlabNumber);
  let updated = 0;
  for (const m of mis) {
    const start = m.startingSlabNumber, end = m.endingSlabNumber, produced = num(m.numberOfSlabsProduced);
    if (typeof start !== "number" || typeof end !== "number") continue;
    const aCat = m.aCategory ?? 0, bCat = m.bCategory ?? 0, cCat = m.cCategory ?? 0;
    const catsFilled = Math.round(aCat + bCat + cCat) === Math.round(produced) && produced > 0;
    const detailsFilled = !!m.design && !!m.batch;
    if (catsFilled && detailsFilled) continue;
    const data: Record<string, unknown> = {};
    if (!catsFilled) {
      let a = 0, b = 0, c = 0;
      for (let s = start; s <= end; s++) { const g = grade.get(s); if (g === "A") a++; else if (g === "B") b++; else if (g === "C") c++; }
      if (a + b + c > 0) { data.aCategory = a; data.bCategory = b; data.cCategory = c; }
    }
    if (!detailsFilled) {
      const mp: any = sortedPress.find((p: any) => p.effectiveFromSlabNumber <= start);
      if (mp) { if (!m.design && mp.designName) data.design = mp.designName; if (!m.batch && mp.batch) data.batch = mp.batch; }
    }
    if (Object.keys(data).length) { await db.mis.update({ where: { id: m.id }, data }); updated++; }
  }
  return { updated };
}
