"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canManageRm, currentUser, localId } from "@/lib/rbac";
import { canonSize } from "@/lib/categoricalFields";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const numOf = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v: unknown) => { const r = String(v ?? "").trim(); if (!r) return null; const n = parseFloat(r.replace(/[^\d.\-]/g, "")); return Number.isFinite(n) ? n : null; };
const strOrNull = (v: unknown) => { const r = String(v ?? "").trim(); return r || null; };
const dateOrNull = (v: unknown) => { if (v instanceof Date) return isNaN(v.getTime()) ? null : v; const r = String(v ?? "").trim(); if (!r) return null; const d = new Date(r); return isNaN(d.getTime()) ? null : d; };

// flexible column resolver — match a header by any of the given needles
function pick(row: Record<string, unknown>, needles: string[]): unknown {
  for (const k of Object.keys(row)) { const kn = k.toLowerCase().replace(/[^a-z0-9]/g, ""); if (needles.some((n) => kn.includes(n))) return row[k]; }
  return undefined;
}

export interface UploadResult { ok: boolean; added: number; skipped: number; rows: number; errors: string[]; message: string; }

export async function uploadUnassignedRm(_prev: UploadResult2 | null, fd: FormData): Promise<UploadResult2> {
  const empty: UploadResult2 = { ok: false, added: 0, skipped: 0, rows: 0, errors: [], message: "", dupes: [] };
  if (!(await canManageRm())) return { ...empty, message: "Only the Store Incharge can upload RM." };
  const file = fd.get("file") as File | null;
  if (!file || !file.size) return { ...empty, message: "Choose an .xlsx or .csv file first." };
  const me = await currentUser();
  const who = me?.name || me?.email || "store";

  let json: Record<string, unknown>[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    json = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch (e) { return { ...empty, message: `Could not read the file: ${(e as Error).message}` }; }

  let added = 0, skipped = 0; const errors: string[] = []; const dupes: DupeRow[] = [];
  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    const invNo = s(pick(row, ["invoice", "invno", "inv"]));
    const type = s(pick(row, ["type"]));
    const size = canonSize(pick(row, ["size"])) ?? "";
    const grade = s(pick(row, ["grade"]));
    const supplier = (await resolveSupplier(s(pick(row, ["supplier", "vendor", "name"])) || null));
    const kg = numOf(pick(row, ["totalkg", "kg", "weight", "quantity", "qty"]));
    if (!invNo) { errors.push(`Row ${i + 2}: missing invoice — skipped`); continue; }
    if (kg <= 0) { errors.push(`Row ${i + 2}: invoice ${invNo} has no/zero kg — skipped`); continue; }
    try {
      const existing = await db.unassignedRm.findFirst({ where: { invNo, type, size, grade }, select: { id: true } });
      if (existing) {
        skipped++;
        dupes.push({ kind: "pool", label: `INV ${invNo} · ${type} ${size} ${grade} · ${Math.round(kg)} kg`, data: {
          invNo, type, size, grade, supplier, totalKg: kg, remainingKg: kg,
          status: strOrNull(pick(row, ["status"])), testedBy: strOrNull(pick(row, ["testedby", "tester", "testby"])),
          availability: strOrNull(pick(row, ["availability", "avail"])), contamination: strOrNull(pick(row, ["contamination", "contam"])),
          gritShade: strOrNull(pick(row, ["gritshade"])), fillerShade: strOrNull(pick(row, ["fillershade"])),
          colourL: numOrNull(pick(row, ["colourl", "colorl"])), colourA: numOrNull(pick(row, ["coloura", "colora"])), colourB: numOrNull(pick(row, ["colourb", "colorb"])),
          consumablesIssue: strOrNull(pick(row, ["consumable"])), remarks: strOrNull(pick(row, ["remark"])),
        } });
        continue;
      }
      await db.unassignedRm.create({ data: {
        id: localId("urm"), invNo, type, size, grade, supplier, totalKg: kg, remainingKg: kg, uploadedBy: who,
        date: dateOrNull(pick(row, ["date"])),
        status: strOrNull(pick(row, ["status"])),
        testedBy: strOrNull(pick(row, ["testedby", "tester", "testby"])),
        availability: strOrNull(pick(row, ["availability", "avail"])),
        contamination: strOrNull(pick(row, ["contamination", "contam"])),
        gritShade: strOrNull(pick(row, ["gritshade"])),
        fillerShade: strOrNull(pick(row, ["fillershade"])),
        colourL: numOrNull(pick(row, ["colourl", "colorl"])),
        colourA: numOrNull(pick(row, ["coloura", "colora"])),
        colourB: numOrNull(pick(row, ["colourb", "colorb"])),
        consumablesIssue: strOrNull(pick(row, ["consumable"])),
        remarks: strOrNull(pick(row, ["remark"])),
      } });
      added++;
    } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
  }
  revalidatePath("/store/upload"); revalidatePath("/store/assign"); revalidatePath("/live");
  return { ok: true, added, skipped, rows: json.length, errors: errors.slice(0, 20), dupes, message: `Processed ${json.length} row(s): ${added} new invoice line(s) added${dupes.length ? ` · ${dupes.length} duplicate(s) need your decision below` : ""}.` };
}

export interface AssignBag { bagNo: number; weight: number; }
export async function assignRmBags(unassignedId: string, bags: AssignBag[]): Promise<{ ok: boolean; message: string }> {
  if (!(await canManageRm())) return { ok: false, message: "Only the Store Incharge can assign RM." };
  const line = await db.unassignedRm.findUnique({ where: { id: unassignedId } });
  if (!line) return { ok: false, message: "Unassigned invoice line not found." };
  const clean = bags.filter((b) => Number.isFinite(b.bagNo) && Number.isFinite(b.weight) && b.weight > 0);
  if (!clean.length) return { ok: false, message: "Add at least one bag with a number and weight." };
  const total = clean.reduce((a, b) => a + b.weight, 0);
  if (total > (line.remainingKg ?? 0) + 1e-6) return { ok: false, message: `Those bags total ${Math.round(total)} kg but only ${Math.round(line.remainingKg ?? 0)} kg remain unassigned on invoice ${line.invNo}.` };
  const me = await currentUser();
  const who = me?.name || me?.email || "store";

  try {
    await db.$transaction(async (tx: any) => {
      // guarded decrement: only succeeds if enough remains RIGHT NOW (safe under concurrent assigns)
      const upd = await tx.unassignedRm.updateMany({
        where: { id: line.id, remainingKg: { gte: total - 1e-6 } },
        data: { remainingKg: { decrement: total } },
      });
      if (!upd.count) throw new Error(`only ${Math.round(line.remainingKg ?? 0)} kg remain unassigned on invoice ${line.invNo} (someone may have assigned from it just now — refresh and retry)`);
      for (const b of clean) {
        const j = (v: unknown) => (v == null || v === "" ? [] : [v]);
        await tx.rm.create({ data: {
          airtableId: localId("rm"), invNo: line.invNo, bagNo: b.bagNo, bagWeight: b.weight,
          type: line.type || null, size: line.size || null, grade: line.grade || null,
          nameFromSupplierMaster: j(line.supplier), status: "Accepted",
          unassignedRmId: line.id, assignedBy: who, assignedAt: new Date(), date: new Date(), siloIds: [],
        } });
      }
    });
  } catch (e) { return { ok: false, message: `Assign failed: ${(e as Error).message}` }; }
  revalidatePath("/store/assign"); revalidatePath("/live"); revalidatePath("/entry/record/Silo");
  return { ok: true, message: `Assigned ${clean.length} bag(s) (${Math.round(total)} kg) to invoice ${line.invNo}. They're now available in the silo dump form.` };
}

export interface PoolLine { id: string; invNo: string; type: string; size: string; grade: string; supplier: string | null; totalKg: number; remainingKg: number; assignedKg: number; }
export async function listUnassignedPool(onlyRemaining = false): Promise<PoolLine[]> {
  if (!(await canManageRm())) return [];
  let rows: any[] = [];
  try { rows = await db.unassignedRm.findMany({ orderBy: [{ invNo: "asc" }, { type: "asc" }, { size: "asc" }], take: 1000 }); } catch { return []; }
  return rows.filter((r) => (onlyRemaining ? (r.remainingKg ?? 0) > 0.001 : true)).map((r) => ({
    id: r.id, invNo: r.invNo, type: r.type || "—", size: r.size || "—", grade: r.grade || "—", supplier: r.supplier ?? null,
    totalKg: Math.round((r.totalKg ?? 0) * 10) / 10, remainingKg: Math.round((r.remainingKg ?? 0) * 10) / 10, assignedKg: Math.round(((r.totalKg ?? 0) - (r.remainingKg ?? 0)) * 10) / 10,
  }));
}

/* ---------- Manual single-line entry (no Excel) ---------- */
export interface ManualEntryResult { ok: boolean; message: string; stamp: number; }

export async function createUnassignedRm(_prev: ManualEntryResult | null, fd: FormData): Promise<ManualEntryResult> {
  const fail = (message: string): ManualEntryResult => ({ ok: false, message, stamp: Date.now() });
  if (!(await canManageRm())) return fail("Only the Store Incharge can add RM.");

  const invNo = s(fd.get("invNo"));
  const type = s(fd.get("type"));
  const size = canonSize(fd.get("size")) ?? "";
  const grade = s(fd.get("grade"));
  const supplier = strOrNull(fd.get("supplier"));
  const kg = numOf(fd.get("totalKg"));
  if (!invNo) return fail("Invoice number is required.");
  if (kg <= 0) return fail("Total KG must be greater than zero.");

  const me = await currentUser();
  const who = me?.name || me?.email || "store";

  try {
    const existing = await db.unassignedRm.findFirst({ where: { invNo, type, size, grade }, select: { remainingKg: true } });
    if (existing) return fail(`Invoice ${invNo} (${type || "—"} ${size || "—"} ${grade || "—"}) is already on file with ${Math.round(existing.remainingKg ?? 0)} kg remaining — lines are never overwritten. Use a different size/grade, or assign from the existing line.`);
    await db.unassignedRm.create({ data: {
      id: localId("urm"), invNo, type, size, grade, supplier, totalKg: kg, remainingKg: kg, uploadedBy: who,
      date: dateOrNull(fd.get("date")),
      status: strOrNull(fd.get("status")),
      testedBy: strOrNull(fd.get("testedBy")),
      availability: strOrNull(fd.get("availability")),
      contamination: strOrNull(fd.get("contamination")),
      gritShade: strOrNull(fd.get("gritShade")),
      fillerShade: strOrNull(fd.get("fillerShade")),
      colourL: numOrNull(fd.get("colourL")),
      colourA: numOrNull(fd.get("colourA")),
      colourB: numOrNull(fd.get("colourB")),
      consumablesIssue: strOrNull(fd.get("consumablesIssue")),
      remarks: strOrNull(fd.get("remarks")),
    } });
  } catch (e) { return fail(`Could not save: ${(e as Error).message}`); }

  revalidatePath("/store/entry"); revalidatePath("/store/upload"); revalidatePath("/store/assign"); revalidatePath("/live");
  return { ok: true, message: `Added invoice ${invNo} — ${type || "RM"} ${size} ${grade}, ${Math.round(kg)} kg to the unassigned pool. Assign bags from the Assignment page when handing over.`, stamp: Date.now() };
}

/* ---------- Direct bag entry (skip the pool — straight into Assigned RM) ---------- */
export interface BagEntryResult { ok: boolean; message: string; stamp: number; }

export async function createAssignedBag(_prev: BagEntryResult | null, fd: FormData): Promise<BagEntryResult> {
  const fail = (message: string): BagEntryResult => ({ ok: false, message, stamp: Date.now() });
  if (!(await canManageRm())) return fail("Only the Store Incharge can add bags.");

  const invNo = s(fd.get("invNo"));
  const bagNo = numOrNull(fd.get("bagNo"));
  const weight = numOf(fd.get("weight"));
  const type = s(fd.get("type"));
  if (!invNo) return fail("Invoice number is required.");
  if (bagNo == null) return fail("Bag number is required.");
  if (weight <= 0) return fail("Bag weight must be greater than zero.");
  if (!type) return fail("Type is required.");

  const me = await currentUser();
  const who = me?.name || me?.email || "store";
  const j = (v: unknown) => (v == null || v === "" ? [] : [v]);

  try {
    // duplicate = same invoice + bag + FULL MATERIAL IDENTITY (type, size, shade) —
    // suppliers reuse bag numbers across materials AND shades within one invoice
    const size0 = canonSize(fd.get("size"));
    const shadeIn = strOrNull(fd.get("shade"));
    const shadeWhere = type === "Filler" ? { fillerShade: shadeIn } : { gritShade: shadeIn };
    const dupe = await db.rm.findFirst({ where: { invNo, bagNo, type, size: size0, ...shadeWhere }, select: { id: true } });
    if (dupe) return fail(`Invoice ${invNo} bag ${bagNo} (${type} ${size0 ?? ""}${shadeIn ? " " + shadeIn : ""}) already exists in Assigned RM — duplicate not saved.`);
    await db.rm.create({ data: {
      airtableId: localId("rm"), invNo, bagNo, bagWeight: weight,
      type, size: size0, grade: strOrNull(fd.get("grade")),
      gritShade: type.toLowerCase().includes("grit") ? strOrNull(fd.get("shade")) : null,
      fillerShade: type === "Filler" ? strOrNull(fd.get("shade")) : null,
      nameFromSupplierMaster: j(strOrNull(fd.get("supplier"))),
      colourL: numOrNull(fd.get("colourL")), colourA: numOrNull(fd.get("colourA")), colourB: numOrNull(fd.get("colourB")),
      status: "Accepted", siloIds: [],
      date: dateOrNull(fd.get("date")) ?? new Date(),
      assignedBy: who, assignedAt: new Date(),
    } });
  } catch (e) { return fail(`Could not save: ${(e as Error).message}`); }

  revalidatePath("/store/bag"); revalidatePath("/live"); revalidatePath("/entry/record/Silo");
  return { ok: true, message: `Bag ${bagNo} (${Math.round(weight)} kg, invoice ${invNo}) added to Assigned RM — it's available in the silo dump form now.`, stamp: Date.now() };
}

/* ---------- master-driven dropdown options for the direct bag form ---------- */
export interface BagFormOptions { suppliers: string[]; sizes: string[]; grades: string[]; shades: string[]; }
export async function getBagFormOptions(): Promise<BagFormOptions> {
  if (!(await canManageRm())) return { suppliers: [], types: [], sizes: [], grades: [] } as unknown as BagFormOptions;
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  try {
    const [sup, rmSizes, gmSizes, grades, shades] = await Promise.all([
      db.$queryRaw`SELECT DISTINCT name FROM supplier_master WHERE name IS NOT NULL ORDER BY name`,
      db.$queryRaw`SELECT DISTINCT size AS v FROM rm WHERE size IS NOT NULL AND size <> '' ORDER BY 1`,
      db.$queryRaw`SELECT DISTINCT name AS v FROM grit_master WHERE name IS NOT NULL ORDER BY 1`,
      db.$queryRaw`SELECT DISTINCT grade AS v FROM rm WHERE grade IS NOT NULL AND grade <> '' ORDER BY 1`,
      db.$queryRaw`SELECT DISTINCT filler_shade AS v FROM rm WHERE filler_shade IS NOT NULL UNION SELECT DISTINCT grit_shade FROM rm WHERE grit_shade IS NOT NULL ORDER BY 1`,
    ]);
    // sizes: live stock vocabulary first, then master entries that aren't already covered
    const sizes: string[] = (rmSizes as { v: string }[]).map((r) => r.v);
    const seen = new Set(sizes.map(norm));
    for (const r of gmSizes as { v: string }[]) if (!seen.has(norm(r.v))) { sizes.push(r.v); seen.add(norm(r.v)); }
    return {
      suppliers: (sup as { name: string }[]).map((r) => r.name),
      sizes,
      grades: (grades as { v: string }[]).map((r) => r.v),
      shades: (shades as { v: string }[]).map((r) => r.v),
    };
  } catch { return { suppliers: [], sizes: [], grades: ["Premium", "Supreme"], shades: [] }; }
}

/* ---------- Bag-wise Excel upload, straight into Assigned RM (incl. LAB colours) ---------- */
export async function uploadAssignedBags(_prev: UploadResult2 | null, fd: FormData): Promise<UploadResult2> {
  const empty: UploadResult2 = { ok: false, added: 0, skipped: 0, rows: 0, errors: [], message: "", dupes: [] };
  if (!(await canManageRm())) return { ...empty, message: "Only the Store Incharge can upload bags." };
  const file = fd.get("file") as File | null;
  if (!file || !file.size) return { ...empty, message: "Choose an .xlsx or .csv file first." };
  const me = await currentUser();
  const who = me?.name || me?.email || "store";

  let json: Record<string, unknown>[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  } catch (e) { return { ...empty, message: `Could not read the file: ${(e as Error).message}` }; }

  const j = (v: unknown) => (v == null || v === "" ? [] : [v]);
  let added = 0, skipped = 0; const errors: string[] = []; const dupes: DupeRow[] = [];
  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    const invNo = s(pick(row, ["invoice", "invno", "inv"]));
    const bagNo = numOrNull(pick(row, ["bagno", "bag"]));
    const weight = numOf(pick(row, ["weight", "kg", "qty"]));
    const type = s(pick(row, ["type"]));
    if (!invNo) { errors.push(`Row ${i + 2}: missing invoice — skipped`); continue; }
    if (bagNo == null) { errors.push(`Row ${i + 2}: invoice ${invNo} missing bag no — skipped`); continue; }
    if (weight <= 0) { errors.push(`Row ${i + 2}: invoice ${invNo} bag ${bagNo} has no/zero weight — skipped`); continue; }
    if (!type) { errors.push(`Row ${i + 2}: invoice ${invNo} bag ${bagNo} missing type — skipped`); continue; }
    try {
      const shade0 = strOrNull(pick(row, ["shade"]));
      const size1 = canonSize(pick(row, ["size"]));
      const shadeWhere0 = type === "Filler" ? { fillerShade: shade0 } : { gritShade: shade0 };
      const dupe = await db.rm.findFirst({ where: { invNo, bagNo, type, size: size1, ...shadeWhere0 }, select: { id: true } });
      if (dupe) {
        skipped++;
        dupes.push({ kind: "bag", label: `INV ${invNo} · bag ${bagNo} · ${type} ${canonSize(pick(row, ["size"])) ?? ""} · ${Math.round(weight)} kg`, data: {
          invNo, bagNo, bagWeight: weight, type, size: canonSize(pick(row, ["size"])), grade: strOrNull(pick(row, ["grade"])),
          gritShade: type.toLowerCase().includes("grit") ? shade0 : null, fillerShade: type === "Filler" ? shade0 : null,
          nameFromSupplierMaster: j(strOrNull(pick(row, ["supplier", "vendor"]))),
          colourL: numOrNull(pick(row, ["colourl", "colorl", "labl"])), colourA: numOrNull(pick(row, ["coloura", "colora", "laba"])), colourB: numOrNull(pick(row, ["colourb", "colorb", "labb"])),
          testedBy: strOrNull(pick(row, ["testedby", "tester", "lab"])),
        } });
        continue;
      }
      const shade = shade0;
      await db.rm.create({ data: {
        airtableId: localId("rm"), invNo, bagNo, bagWeight: weight,
        type, size: canonSize(pick(row, ["size"])), grade: strOrNull(pick(row, ["grade"])),
        gritShade: type.toLowerCase().includes("grit") ? shade : null,
        fillerShade: type === "Filler" ? shade : null,
        nameFromSupplierMaster: j(await resolveSupplier(strOrNull(pick(row, ["supplier", "vendor"])))),
        colourL: numOrNull(pick(row, ["colourl", "colorl", "labl"])),
        colourA: numOrNull(pick(row, ["coloura", "colora", "laba"])),
        colourB: numOrNull(pick(row, ["colourb", "colorb", "labb"])),
        testedBy: strOrNull(pick(row, ["testedby", "tester", "lab"])),
        status: "Accepted", siloIds: [],
        date: dateOrNull(pick(row, ["date"])) ?? new Date(),
        assignedBy: who, assignedAt: new Date(),
      } });
      added++;
    } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
  }
  revalidatePath("/store/bag"); revalidatePath("/live"); revalidatePath("/entry/record/Silo");
  return { ok: true, added, skipped, rows: json.length, errors: errors.slice(0, 20), dupes, message: `Processed ${json.length} row(s): ${added} bag(s) added${dupes.length ? ` · ${dupes.length} duplicate(s) need your decision below` : ""}.` };
}

/* ---------- Resin storage intake (tanker deliveries) — Store Incharge ---------- */
export interface ResinEntryResult { ok: boolean; message: string; stamp: number; }

export async function createResinDelivery(_prev: ResinEntryResult | null, fd: FormData): Promise<ResinEntryResult> {
  const fail = (message: string): ResinEntryResult => ({ ok: false, message, stamp: Date.now() });
  if (!(await canManageRm())) return fail("Only the Store Incharge can log resin deliveries.");
  const tankNo = s(fd.get("tankNo"));
  const invoiceNo = s(fd.get("invoiceNo"));
  const qty = numOf(fd.get("quantity"));
  if (!tankNo) return fail("Tank no is required.");
  if (!invoiceNo) return fail("Invoice no is required.");
  if (qty <= 0) return fail("Quantity must be greater than zero.");
  try {
    const dupe = await db.resinStorage.findFirst({ where: { tankNo, invoiceNo }, select: { id: true } });
    if (dupe) return fail(`Tank ${tankNo} already has a delivery for invoice ${invoiceNo} — duplicate not saved. Use the upload's "save as Batch" option if this is genuinely a second consignment.`);
    const agg = await db.resinStorage.aggregate({ _max: { resinId: true } }).catch(() => null);
    await db.resinStorage.create({ data: {
      airtableId: localId("resinstorage"), resinId: (agg?._max?.resinId ?? 0) + 1,
      tankNo, invoiceNo, supplier: await resolveSupplier(strOrNull(fd.get("supplier"))),
      quantity: qty, quantityRemaining: qty,
      vehicleNumberAllCapsNoSpace: strOrNull(fd.get("vehicle"))?.toUpperCase().replace(/\s+/g, "") ?? null,
      date: dateOrNull(fd.get("date")) ?? new Date(),
    } });
  } catch (e) { return fail(`Could not save: ${(e as Error).message}`); }
  revalidatePath("/store/resin"); revalidatePath("/live");
  return { ok: true, message: `Delivery logged — ${Math.round(qty)} kg into tank ${tankNo} (invoice ${invoiceNo}).`, stamp: Date.now() };
}

/* ---------- supplier normalisation: free-typed names -> Supplier Master ---------- */
let _supplierCache: { at: number; names: string[] } | null = null;
async function masterSuppliers(): Promise<string[]> {
  if (_supplierCache && Date.now() - _supplierCache.at < 60_000) return _supplierCache.names;
  try {
    const rows: { name: string }[] = await db.$queryRaw`SELECT DISTINCT name FROM supplier_master WHERE name IS NOT NULL`;
    _supplierCache = { at: Date.now(), names: rows.map((r) => r.name) };
  } catch { _supplierCache = { at: Date.now(), names: [] }; }
  return _supplierCache.names;
}
const supKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]+/g, " ").replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|suppliers?|industries|enterprises?)\b/g, "").replace(/\s+/g, " ").trim();
/** "Vinayaka Suppliers LLP" -> "Vinayaka" (the master name), when the match is unambiguous. */
async function resolveSupplier(raw: string | null): Promise<string | null> {
  if (!raw) return null;
  const names = await masterSuppliers();
  const k = supKey(raw);
  if (!k) return raw;
  const exact = names.find((n) => supKey(n) === k);
  if (exact) return exact;
  const contains = names.filter((n) => { const nk = supKey(n); return nk.includes(k) || k.includes(nk); });
  return contains.length === 1 ? contains[0] : raw; // ambiguous or unknown -> keep as typed
}

/* ---------- interactive duplicate handling for ALL store uploads ---------- */
export interface DupeRow { kind: "bag" | "resin" | "pool"; data: Record<string, unknown>; label: string; }
export interface UploadResult2 { ok: boolean; added: number; skipped: number; rows: number; errors: string[]; message: string; dupes: DupeRow[]; }

/** next free "-Batch-N" suffix for an invoice (checked against the right table+keys) */
async function nextBatchSuffix(kind: DupeRow["kind"], data: Record<string, unknown>): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const inv = `${data.invNo ?? data.invoiceNo}-Batch-${n}`;
    let exists = null;
    if (kind === "bag") exists = await db.rm.findFirst({ where: { invNo: inv, bagNo: data.bagNo, type: data.type, size: data.size, gritShade: data.gritShade ?? null, fillerShade: data.fillerShade ?? null }, select: { id: true } });
    else if (kind === "resin") exists = await db.resinStorage.findFirst({ where: { invoiceNo: inv, tankNo: data.tankNo }, select: { id: true } });
    else exists = await db.unassignedRm.findFirst({ where: { invNo: inv, type: String(data.type ?? ""), size: String(data.size ?? ""), grade: String(data.grade ?? "") }, select: { id: true } });
    if (!exists) return inv;
  }
  return `${data.invNo ?? data.invoiceNo}-Batch-${Date.now()}`;
}

/** Resolve duplicates the user reviewed: mode "batch" saves them under
 * "<invoice>-Batch-N"; mode "skip" drops them. */
/** Whitelist the fields we accept back from the client dupe-resolver — never
 * spread the raw payload (it could carry siloIds, assignedBy, relation ids…). */
function pickBagData(d: Record<string, unknown>) {
  return {
    invNo: d.invNo, bagNo: typeof d.bagNo === "number" ? d.bagNo : numOrNull(d.bagNo), bagWeight: typeof d.bagWeight === "number" ? d.bagWeight : numOf(d.bagWeight),
    type: strOrNull(d.type), size: strOrNull(d.size), grade: strOrNull(d.grade),
    gritShade: strOrNull(d.gritShade), fillerShade: strOrNull(d.fillerShade),
    nameFromSupplierMaster: Array.isArray(d.nameFromSupplierMaster) ? d.nameFromSupplierMaster : [],
    colourL: numOrNull(d.colourL), colourA: numOrNull(d.colourA), colourB: numOrNull(d.colourB), testedBy: strOrNull(d.testedBy),
  };
}
function pickResinData(d: Record<string, unknown>) {
  return {
    tankNo: strOrNull(d.tankNo), supplier: strOrNull(d.supplier), quantity: numOf(d.quantity), quantityRemaining: numOf(d.quantityRemaining ?? d.quantity),
    vehicleNumberAllCapsNoSpace: strOrNull(d.vehicleNumberAllCapsNoSpace),
  };
}
function pickPoolData(d: Record<string, unknown>) {
  return {
    type: strOrNull(d.type) ?? "", size: strOrNull(d.size) ?? "", grade: strOrNull(d.grade) ?? "", supplier: strOrNull(d.supplier),
    totalKg: numOf(d.totalKg), remainingKg: numOf(d.remainingKg ?? d.totalKg),
    status: strOrNull(d.status), testedBy: strOrNull(d.testedBy), availability: strOrNull(d.availability), contamination: strOrNull(d.contamination),
    gritShade: strOrNull(d.gritShade), fillerShade: strOrNull(d.fillerShade),
    colourL: numOrNull(d.colourL), colourA: numOrNull(d.colourA), colourB: numOrNull(d.colourB),
    consumablesIssue: strOrNull(d.consumablesIssue), remarks: strOrNull(d.remarks),
  };
}

export async function resolveUploadDupes(dupes: DupeRow[], mode: "batch" | "skip"): Promise<{ ok: boolean; message: string }> {
  if (!(await canManageRm())) return { ok: false, message: "Only the Store Incharge can do this." };
  if (mode === "skip" || !dupes.length) return { ok: true, message: `${dupes.length} duplicate(s) skipped.` };
  const me = await currentUser();
  const who = me?.name || me?.email || "store";
  let saved = 0; const errors: string[] = [];
  for (const d of dupes) {
    try {
      const inv = await nextBatchSuffix(d.kind, d.data);
      const dt = d.data.date ? new Date(String(d.data.date)) : null;
      if (d.kind === "bag") {
        await db.rm.create({ data: { ...pickBagData(d.data), invNo: inv, airtableId: localId("rm"), status: "Accepted", siloIds: [], assignedBy: who, assignedAt: new Date(), date: dt ?? new Date() } });
      } else if (d.kind === "resin") {
        const agg = await db.resinStorage.aggregate({ _max: { resinId: true } }).catch(() => null);
        await db.resinStorage.create({ data: { ...pickResinData(d.data), invoiceNo: inv, airtableId: localId("resinstorage"), resinId: (agg?._max?.resinId ?? 0) + 1, date: dt ?? new Date() } });
      } else {
        await db.unassignedRm.create({ data: { ...pickPoolData(d.data), invNo: inv, id: localId("urm"), uploadedBy: who, date: dt } });
      }
      saved++;
    } catch (e) { errors.push(`${d.label}: ${(e as Error).message}`); }
  }
  revalidatePath("/store/bag"); revalidatePath("/store/resin"); revalidatePath("/store/upload"); revalidatePath("/live");
  return { ok: errors.length === 0, message: `${saved} duplicate(s) saved as new Batch consignments${errors.length ? ` · ${errors.length} failed: ${errors.join("; ").slice(0, 200)}` : ""}.` };
}

/* ---------- Resin storage Excel upload (interactive dupes) ---------- */
export async function uploadResinDeliveries(_prev: UploadResult2 | null, fd: FormData): Promise<UploadResult2> {
  const empty: UploadResult2 = { ok: false, added: 0, skipped: 0, rows: 0, errors: [], message: "", dupes: [] };
  if (!(await canManageRm())) return { ...empty, message: "Only the Store Incharge can upload." };
  const file = fd.get("file") as File | null;
  if (!file || !file.size) return { ...empty, message: "Choose an .xlsx or .csv file first." };
  let json: Record<string, unknown>[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  } catch (e) { return { ...empty, message: `Could not read the file: ${(e as Error).message}` }; }

  let added = 0; const errors: string[] = []; const dupes: DupeRow[] = [];
  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    const tankNo = s(pick(row, ["tank"]));
    const invoiceNo = s(pick(row, ["invoice", "invno", "inv"]));
    const qty = numOf(pick(row, ["quantity", "qty", "kg", "weight"]));
    if (!tankNo || !invoiceNo) { errors.push(`Row ${i + 2}: missing tank/invoice — skipped`); continue; }
    if (qty <= 0) { errors.push(`Row ${i + 2}: tank ${tankNo} invoice ${invoiceNo} has no quantity — skipped`); continue; }
    const data: Record<string, unknown> = {
      tankNo, invoiceNo, quantity: qty, quantityRemaining: qty,
      supplier: await resolveSupplier(strOrNull(pick(row, ["supplier", "vendor"]))),
      vehicleNumberAllCapsNoSpace: strOrNull(pick(row, ["vehicle"]))?.toUpperCase().replace(/\s+/g, "") ?? null,
      date: dateOrNull(pick(row, ["date"])),
    };
    try {
      const dupe = await db.resinStorage.findFirst({ where: { tankNo, invoiceNo }, select: { id: true } });
      if (dupe) { dupes.push({ kind: "resin", data, label: `Tank ${tankNo} · invoice ${invoiceNo} · ${Math.round(qty)} kg` }); continue; }
      const agg = await db.resinStorage.aggregate({ _max: { resinId: true } }).catch(() => null);
      await db.resinStorage.create({ data: { ...data, airtableId: localId("resinstorage"), resinId: (agg?._max?.resinId ?? 0) + 1, date: data.date ?? new Date() } });
      added++;
    } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
  }
  revalidatePath("/store/resin"); revalidatePath("/live");
  return { ok: true, added, skipped: dupes.length, rows: json.length, errors: errors.slice(0, 20), dupes,
    message: `Processed ${json.length} row(s): ${added} delivery(ies) added${dupes.length ? ` · ${dupes.length} duplicate(s) need your decision below` : ""}.` };
}
