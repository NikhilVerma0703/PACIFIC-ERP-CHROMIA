"use server";

import { revalidatePath } from "next/cache";
import { delegateOf, tableMeta, coerceField } from "@/lib/tables";
import { hhmmToSeconds } from "@/lib/time";
import { THICKNESS_FIELDS, canonThickness } from "@/lib/thickness";
import { canRectify, canEnterData, currentUser, currentRole, localId } from "@/lib/rbac";
import { AUTOFILL_PREFIX } from "@/lib/batchRange";
import { logAction } from "@/lib/actionLog";
import { canUseEntryModel, operatorTableModels } from "@/lib/stationAccess";
import { canWriteModel } from "@/lib/branch";
import { OPERATOR_FIELDS } from "@/lib/operatorFields";
import { allocateMixerCycle } from "@/lib/automations-silo";
import { absorbSiloDeficit, absorbTankDeficit, writeOffSiloDeficit } from "@/lib/backfill";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { parseSlabInput } from "@/lib/slabLabel";
import { RECORD_SMART } from "@/lib/recordSmart";
import { prisma } from "@/lib/prisma";

// tx-scoped equivalents of delegateOf() for $transaction blocks
const prismaTx = () => prisma;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txDelegate = (tx: any, model: string) => tx[model[0].toLowerCase() + model.slice(1)];

/** Auto-increment counters (silo increment, bag no, resin id) server-side so
 * they are always set even when the field is not operator-editable. */
async function stampIncrements(model: string, data: Record<string, unknown>) {
  const cfg = RECORD_SMART[model];
  for (const inc of cfg?.increments ?? []) {
    if (data[inc.field] != null && data[inc.field] !== "") continue;
    try {
      const where = inc.perKey && cfg?.keyField && typeof data[cfg.keyField] === "string" && data[cfg.keyField] ? { [cfg.keyField]: data[cfg.keyField] } : {};
      const agg = await delegateOf(model).aggregate({ where, _max: { [inc.field]: true } });
      const max = agg?._max?.[inc.field];
      data[inc.field] = (typeof max === "number" ? Math.floor(max) : 0) + 1;
    } catch { /* field may not exist */ }
  }
  // a freshly dumped bag is untouched: remaining = full weight
  if (model === "Silo" && data.remainingWeight == null && typeof data.weight === "number") data.remainingWeight = data.weight;
}

/** Press: the pump LIST ("1,3") is the source of truth; the legacy numeric
 * field auto-fills with the count so old reports keep working. */
function stampPumps(model: string, data: Record<string, unknown>) {
  if (model !== "Press" || typeof data.vacuumPumps !== "string") return;
  const list = data.vacuumPumps.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => n >= 1 && n <= 4);
  data.vacuumPumps = list.join(",") || null;
  data.noOfVacuumPumps = list.length || null;
}

/** Replicate Airtable's formula fields on Mixer Cycle: Total Cycle Weight and
 * Total Mixer 1 Weight = sum of every material entered (grits + filler + resin). */
function stampMixerTotals(model: string, data: Record<string, unknown>) {
  if (model !== "MixerCycle") return;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  let total = 0, m1 = 0;
  for (let m = 1; m <= 4; m++) {
    let mix = 0;
    for (let g = 1; g <= 5; g++) mix += n(data[`m${m}W${g}`]);
    mix += n(data[`m${m}FW`]) + n(data[`m${m}RW`]);
    total += mix;
    if (m === 1) m1 = mix;
  }
  if (total > 0) { data.totalCycleWeight = Math.round(total * 100) / 100; data.totalMixer1Weight = Math.round(m1 * 100) / 100; }
}

/** Models carrying batch/batchNumber also carry batchKey — keep it in sync. */
function stampBatchKey(data: Record<string, unknown>) {
  const b = data.batch ?? data.batchNumber;
  if (typeof b === "string" && b.trim()) data.batchKey = normalizeBatch(b);
}

// Stations where a slab number is mandatory — a row without one is a ghost that
// breaks counts. Enforced server-side on both create and edit (the form's
// `required` is client-only and was being bypassed).
const SLAB_REQUIRED = new Set(["Press", "Oven", "Jot", "Distributor", "Kreos", "PolishEntry", "PolishQc"]);
const hasSlab = (v: unknown): boolean => { if (v == null || v === "") return false; const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n); };

function buildData(model: string, fd: FormData): Record<string, unknown> {
  const meta = tableMeta(model);
  if (!meta) throw new Error("unknown table");
  const data: Record<string, unknown> = {};
  for (const f of meta.fields) {
    if (!f.editable) continue;
    if (f.kind === "multiselect") {
      data[f.prismaField] = fd.getAll(f.prismaField).map(String).filter(Boolean);
      continue;
    }
    if (f.airtableType === "duration") {
      if (!fd.has(f.prismaField)) continue;
      data[f.prismaField] = hhmmToSeconds(fd.get(f.prismaField));
      continue;
    }
    if (THICKNESS_FIELDS.has(f.prismaField)) {
      if (!fd.has(f.prismaField)) continue;
      data[f.prismaField] = canonThickness(fd.get(f.prismaField)) || null;
      continue;
    }
    if (!fd.has(f.prismaField) && f.kind !== "bool") continue;
    data[f.prismaField] = coerceField(f.kind, fd.get(f.prismaField));
  }
  return data;
}

/** Stamp operator/inspector/etc. fields with the logged-in user's name. */
function stampOperator(model: string, data: Record<string, unknown>, name: string) {
  const meta = tableMeta(model);
  for (const f of meta?.fields ?? []) {
    if (f.editable && OPERATOR_FIELDS.has(f.prismaField)) data[f.prismaField] = name;
  }
}


/** Map raw Prisma errors to operator-friendly messages. */
function friendlyDbError(e: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = e as any;
  const code = err?.code as string | undefined;
  if (code === "P2002") {
    const target = Array.isArray(err?.meta?.target) ? err.meta.target.join(", ") : String(err?.meta?.target ?? "");
    return `A record with this ${target || "value"} already exists — it must be unique.`;
  }
  if (code === "P2025") return "That record no longer exists — it may have been deleted. Refresh and try again.";
  if (code === "P2003") return "This record is linked to other records and can't be saved this way.";
  const msg = String(err?.message ?? "Unknown error");
  // strip Prisma's multi-line invocation noise down to the last meaningful line
  const last = msg.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? msg;
  return last.length > 200 ? last.slice(0, 200) + "…" : last;
}

export async function saveRow(_prev: string | undefined, fd: FormData): Promise<string | undefined> {
  const model = String(fd.get("__model") || "");
  const id = String(fd.get("__id") || "");
  if (!model || !id) return "Missing record reference.";
  if (!(await canWriteModel(model))) return "Your branch cannot edit this table.";
  if (!(await canRectify())) {
    // operators may correct ONLY rows they created themselves, in their own station's tables
    const me = await currentUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isOp = String((me as any)?.role ?? "") === "OPERATOR";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const myStation = ((me as any)?.station as string | null) ?? null;
    if (!isOp || !operatorTableModels(myStation).has(model)) return "Only incharge and above can edit records.";
    // Polish QC is shared — any QC operator may correct any QC row; every other
    // table stays self-edit-only for operators.
    if (model !== "PolishQc") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = await delegateOf(model).findUnique({ where: { id }, select: { enteredById: true } }).catch(() => null);
      if (!row || !row.enteredById || row.enteredById !== me?.id) return "You can only edit entries you created yourself — ask your incharge for other corrections.";
    }
  }
  const data = buildData(model, fd);
  stampBatchKey(data);
  stampPumps(model, data);
  // Don't let an edit blank out a slab station's slab number (only enforce when the
  // form actually carried the field, so partial edits aren't blocked).
  if (SLAB_REQUIRED.has(model) && fd.has("slabNumber") && !hasSlab(data.slabNumber)) {
    return "⚠ Slab number can't be blank — enter it before saving.";
  }
  // Clearing the QC grade falls back to "Not graded yet" (only when the form
  // actually submitted the grade field, so edits to other fields don't touch it).
  if (model === "PolishQc" && fd.has("qualityGrade") && !String(data.qualityGrade ?? "").trim()) data.qualityGrade = "Not graded yet";
  try {
    await delegateOf(model).update({ where: { id }, data });
    if (model === "MixerCycle") {
      // recompute the formula totals from the full row after the edit
      const sel: Record<string, boolean> = {};
      for (let m = 1; m <= 4; m++) { sel[`m${m}FW`] = true; sel[`m${m}RW`] = true; for (let g = 1; g <= 5; g++) sel[`m${m}W${g}`] = true; }
      const row = await delegateOf(model).findUnique({ where: { id }, select: sel });
      if (row) { const t: Record<string, unknown> = { ...row }; stampMixerTotals(model, t); await delegateOf(model).update({ where: { id }, data: { totalCycleWeight: t.totalCycleWeight ?? null, totalMixer1Weight: t.totalMixer1Weight ?? null } }); }
    }
  }
  catch (e) { return `Save failed: ${friendlyDbError(e)}`; }
  revalidatePath(`/tables/${model}`);
  if (model === "PolishQc") {
    await logAction({ kind: "edit", batchKey: (data.batchKey as string | undefined) ?? null, model: "PolishQc", summary: `Edited Polish QC slab ${String(data.slabNumber ?? "")}`.trim(), payload: { id, slabNumber: data.slabNumber ?? null } });
  }
  return "ok";
}

export async function createRow(_prev: string | undefined, fd: FormData): Promise<string | undefined> {
  if (!(await canEnterData())) return "Please sign in to enter data.";
  const model = String(fd.get("__model") || "");
  if (!model) return "Missing table.";
  if (!(await canWriteModel(model))) return "This table can't be written to from your branch.";
  // STORE is capped to RM-store tables; never let it create production records
  // even though canUseEntryModel already returns [] for it.
  if ((await currentRole()) === "STORE") return "The Store Incharge can't enter production records.";
  if (!(await canUseEntryModel(model))) return "This form isn't assigned to your station.";
  const me = await currentUser();
  const opName = me?.name || me?.email || "operator";
  const data = buildData(model, fd);
  // Accept "1a"/"1b" insert labels in the slab-number field -> decimal (1.1/1.2).
  if (fd.has("slabNumber")) { const ps = parseSlabInput(fd.get("slabNumber")); if (ps != null) data.slabNumber = ps; }
  stampOperator(model, data, opName);
  stampBatchKey(data);
  stampMixerTotals(model, data);
  stampPumps(model, data);
  await stampIncrements(model, data);

  // MIS: a single hour can log at most 60 minutes of downtime — block impossible totals.
  if (model === "Mis") {
    const dt = Number(data.processDelayDurationMinutes ?? 0) + Number(data.cleaningDelayDurationMinutes ?? 0)
      + Number(data.breakdownDelayDurationMechanicalOrElectricalMinutes ?? 0) + Number(data.poweroutDelayDurationMinutes ?? 0);
    if (dt > 60) return `\u26a0 Total delay for this hour is ${Math.round(dt)} min \u2014 an hour can have at most 60 minutes of downtime. Reduce the delay entries before saving.`;
  }

  // Require a slab number on slab stations (manual or smart entry) — no blank rows.
  if (SLAB_REQUIRED.has(model) && !hasSlab(data.slabNumber)) {
    return "⚠ Slab number is required — enter the slab number (manually or via smart entry) before saving.";
  }

  // QC grade defaults to "Not graded yet" when the operator never picked one
  // (dropdown untouched or left at "—") — keeps it out of the blank/"—" bucket.
  if (model === "PolishQc" && !String(data.qualityGrade ?? "").trim()) data.qualityGrade = "Not graded yet";

  // ---- DOUBLE-ENTRY GUARDS (the dedupe tool exists for history; new entries are blocked up front) ----
  try {
    const SLAB_STATIONS = new Set(["Press", "Oven", "Jot", "Distributor", "Kreos"]);
    if (SLAB_STATIONS.has(model) && data.slabNumber != null && data.batchKey) {
      const dupe = await delegateOf(model).findFirst({ where: { slabNumber: data.slabNumber, batchKey: data.batchKey }, select: { id: true, remarks: true } });
      if (dupe) {
        // Completing an auto-added placeholder: overwrite it with the real entry
        // (and clear the flag) instead of blocking as a duplicate.
        if (String((dupe as { remarks?: string | null }).remarks ?? "").startsWith(AUTOFILL_PREFIX)) {
          try {
            await delegateOf(model).update({ where: { id: dupe.id }, data: { ...data, remarks: (data.remarks as string | undefined) ?? null, enteredById: me?.id ?? null } });
            revalidatePath(`/tables/${model}`); revalidatePath("/batch");
            return "ok";
          } catch (e) { return `Save failed: ${friendlyDbError(e)}`; }
        }
        return `⚠ Slab ${data.slabNumber} is already entered at this station for batch ${data.batch ?? data.batchNumber ?? data.batchKey} — not saved (duplicate).`;
      }
    }
    if ((model === "PolishEntry" || model === "PolishQc") && data.slabNumber != null) {
      const dupe = await delegateOf(model).findFirst({ where: { slabNumber: data.slabNumber }, select: { id: true } });
      if (dupe) return `⚠ Slab ${data.slabNumber} is already in ${model === "PolishQc" ? "Polish QC" : "Polish Entry"} — not saved (duplicate).`;
    }
    if (model === "MixerCycle" && data.cycle != null && data.batchKey) {
      const dupe = await delegateOf(model).findFirst({ where: { cycle: data.cycle, batchKey: data.batchKey }, select: { id: true } });
      if (dupe) return `⚠ Cycle ${data.cycle} of batch ${data.batch ?? data.batchKey} is already entered — not saved (duplicate). Editing a mistake? Ask your incharge (Tables → Mixer Cycle).`;
    }
  } catch { /* guard is best-effort; never blocks on its own failure */ }
  // Silo filling: pull material from the chosen RM bag and mark it consumed.
  let rmBag: Record<string, unknown> | null = null;
  const rmBagId = String(fd.get("__rmBagId") || "");
  if (model === "Silo" && rmBagId) {
    try {
      rmBag = await delegateOf("Rm").findUnique({ where: { airtableId: rmBagId } });
      if (rmBag && Array.isArray(rmBag.siloIds) && (rmBag.siloIds as string[]).length > 0) {
        return `⚠ Bag ${rmBag.bagNo ?? ""} (invoice ${rmBag.invNo ?? "?"}) is already dumped into a silo — not saved (duplicate).`;
      }
      if (rmBag) {
        const j = (v: unknown) => (v == null || v === "" ? [] : [v]);
        Object.assign(data, {
          rmIds: [rmBagId],
          sizeFromUsedBag: j(rmBag.size), gradeFromUsedBag: j(rmBag.grade), typeFromUsedBag: j(rmBag.type),
          nameFromSupplierMasterFromUsedBag: rmBag.nameFromSupplierMaster ?? [],
          invNoFromUsedBag: j(rmBag.invNo), bagNoFromUsedBag: j(rmBag.bagNo),
        });
      }
    } catch { /* ignore */ }
  }
  let createdId: string;
  let createdAirtableId: string;
  try {
    const base = { airtableId: localId(model.toLowerCase()), ...data, enteredById: me?.id ?? null };
    if (model === "Silo" && rmBag) {
      // Silo fill + RM-bag consumption is ONE atomic unit: if the bag can't be
      // marked consumed (or was consumed by a concurrent dump), nothing saves —
      // otherwise the bag stays "available" and can be dumped twice.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = await (prismaTx() as any).$transaction(async (tx: any) => {
        const fresh = await tx.rm.findUnique({ where: { airtableId: rmBagId }, select: { siloIds: true } });
        if (!fresh) throw new Error("RM bag no longer exists — refresh and pick again.");
        if (Array.isArray(fresh.siloIds) && fresh.siloIds.length > 0) throw new Error("This bag was just dumped into a silo by someone else — refresh and pick another bag.");
        const created = await txDelegate(tx, model).create({ data: base });
        await tx.rm.update({ where: { airtableId: rmBagId }, data: { siloIds: { set: [...(fresh.siloIds ?? []), created.airtableId] } } });
        return created;
      });
      createdId = rec.id; createdAirtableId = rec.airtableId;
    } else {
      const rec = await delegateOf(model).create({ data: base });
      createdId = rec.id; createdAirtableId = rec.airtableId;
    }
  }
  catch (e) { return `Create failed: ${friendlyDbError(e)}`; }
  void createdAirtableId;
  revalidatePath(`/tables/${model}`);
  if (model === "MixerCycle") {
    try { const r = await allocateMixerCycle(createdId); return r.message || "ok"; } catch { return "ok"; }
  }
  // a fresh fill absorbs any UNBACKED deficit and re-links the waiting cycles (FIFO)
  if (model === "Silo" && typeof data.siloNo === "string" && data.siloNo) {
    try {
      const r = await absorbSiloDeficit(data.siloNo, createdId);
      if (r) return `✓ Saved — ${r.absorbedKg} kg of this bag covered the silo's unbacked draws (${r.cyclesRelinked} cycle(s) re-linked${r.cleared ? ", deficit cleared" : ", deficit partly remains"}).`;
    } catch { /* best-effort */ }
  }
  // Silo emptying (manual unload): subtract the entered Bag Weight from the silo
  // FIFO (oldest bag first). If it CLEARS the silo (>= current stock) the silo is
  // zeroed AND any outstanding unbacked demand is WRITTEN OFF so it starts fresh.
  // Already-consumed material stays linked to its cycles. We do NOT recreate RM bags.
  if (model === "SiloEmptyingLog" && typeof data.siloNo === "string" && data.siloNo) {
    const siloNo = data.siloNo;
    const want = typeof data.bagWeight === "number" ? data.bagWeight : 0;
    if (want <= 0) return "\u26a0 Enter the empty bag weight (kg) to subtract from the silo.";
    let res: { full: boolean; took: number; after: number };
    try {
      // Advisory-locked per silo (same key as deficit-absorb / write-off) so the
      // subtraction can't race a concurrent fill/absorb on the same silo.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res = await (prismaTx() as any).$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"silo:" + siloNo}))`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bags: any[] = await tx.silo.findMany({ where: { siloNo, remainingWeight: { gt: 0 } }, orderBy: { siloIncrement: "asc" }, select: { id: true, airtableId: true, remainingWeight: true } });
        const real = bags.filter((b: any) => !String(b.airtableId).startsWith("deficit_"));
        const stock = real.reduce((a: number, b: any) => a + (b.remainingWeight ?? 0), 0);
        const full = want >= stock - 1e-6;            // clears the silo
        let left = full ? stock : want;
        let took = 0;
        for (const b of real) {
          if (left <= 1e-6) break;
          const rem = b.remainingWeight ?? 0;
          const take = Math.min(rem, left);
          await tx.silo.update({ where: { id: b.id }, data: { remainingWeight: Math.round((rem - take) * 100) / 100 } });
          left -= take; took += take;
        }
        return { full, took: Math.round(took * 100) / 100, after: Math.round((stock - took) * 100) / 100 };
      });
    } catch (e) {
      return `\u26a0 Saved the emptying log, but subtracting from silo ${siloNo} FAILED (${friendlyDbError(e)}). Tell your incharge \u2014 silo stock was NOT changed.`;
    }
    if (res.full) {
      // Silo cleared \u2014 write off any outstanding unbacked demand (separate tx,
      // same advisory lock) so the silo starts fresh.
      try {
        const wo = await writeOffSiloDeficit(siloNo, opName);
        if (wo && wo.writtenOffKg > 0) return `\u2713 Emptied silo ${siloNo}: ${res.took} kg zeroed \u00b7 wrote off ${wo.writtenOffKg} kg unbacked demand (${wo.cyclesAffected} cycle(s)) \u2014 started fresh.`;
      } catch { /* best-effort: stock is already zeroed */ }
      return `\u2713 Emptied silo ${siloNo}: ${res.took} kg zeroed \u2014 started fresh.`;
    }
    return `\u2713 Subtracted ${res.took} kg from silo ${siloNo} \u2014 ${res.after} kg remaining.`;
  }
  if (model === "DailyResinTank") {
    // Deduct the prep's kg from the chosen STORAGE tank (FIFO by delivery date)
    // and link the storage lots — this is what the "Resin from storage tank"
    // picker is for. Goes negative (backfilled later) if storage entry lags.
    const st = String(fd.get("__storageTank") || "").trim();
    const qty = typeof data.quantity === "number" ? data.quantity : 0;
    if (st && qty > 0) {
      try {
        // Storage-tank deduction is atomic (advisory-locked per tank): the lots
        // and the prep's links can never half-update.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prismaTx() as any).$transaction(async (tx: any) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"storage:" + st}))`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lots: any[] = await tx.resinStorage.findMany({ where: { tankNo: st }, orderBy: [{ date: "asc" }, { resinId: "asc" }], select: { id: true, airtableId: true, quantityRemaining: true } });
          let left = qty; const usedAids: string[] = [];
          for (const lot of lots) {
            if (left <= 1e-9) break;
            const rem = lot.quantityRemaining ?? 0;
            if (rem <= 0) continue;
            const take = Math.min(rem, left);
            await tx.resinStorage.update({ where: { id: lot.id }, data: { quantityRemaining: Math.round((rem - take) * 100) / 100 } });
            usedAids.push(lot.airtableId); left -= take;
          }
          if (left > 1e-9) {
            // storage short — drive the newest lot negative so totals stay truthful
            const last = lots[lots.length - 1];
            if (last) {
              const cur = await tx.resinStorage.findUnique({ where: { id: last.id }, select: { quantityRemaining: true } });
              await tx.resinStorage.update({ where: { id: last.id }, data: { quantityRemaining: Math.round((((cur?.quantityRemaining ?? 0) as number) - left) * 100) / 100 } });
              if (!usedAids.includes(last.airtableId)) usedAids.push(last.airtableId);
            }
          }
          if (usedAids.length) await txDelegate(tx, model).update({ where: { id: createdId }, data: { outsideTankNoIds: usedAids } });
        });
      } catch (e) {
        // The prep row IS saved; the storage deduction failed — say so loudly
        // instead of silently drifting stock.
        return `⚠ Saved, but deducting from storage tank ${st} FAILED (${friendlyDbError(e)}). Tell your incharge — storage stock was NOT reduced.`;
      }
    }
  }
  if (model === "DailyResinTank" && typeof data.dailyTankNo === "string" && data.dailyTankNo) {
    try {
      const r = await absorbTankDeficit(data.dailyTankNo, createdId);
      if (r) return `✓ Saved — ${r.absorbedKg} kg of this prep covered the tank's unbacked draws (${r.cyclesRelinked} cycle(s) re-linked${r.cleared ? ", deficit cleared" : ", deficit partly remains"}).`;
    } catch { /* best-effort */ }
  }
  return "ok";
}
