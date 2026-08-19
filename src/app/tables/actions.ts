"use server";

import { revalidatePath } from "next/cache";
import { delegateOf, tableMeta, coerceField } from "@/lib/tables";
import { hhmmToSeconds } from "@/lib/time";
import { THICKNESS_FIELDS, canonThickness } from "@/lib/thickness";
import { canRectify, canEnterData, currentUser, currentRole, localId, isAdmin } from "@/lib/rbac";
import { AUTOFILL_PREFIX } from "@/lib/batchRange";
import { logAction } from "@/lib/actionLog";
import { canUseEntryModel, operatorTableModels } from "@/lib/stationAccess";
import { canWriteModel, canSeeModel } from "@/lib/branch";
import { OPERATOR_FIELDS } from "@/lib/operatorFields";
import { allocateMixerCycle } from "@/lib/automations-silo";
import { absorbSiloDeficit, absorbTankDeficit, writeOffSiloDeficit } from "@/lib/backfill";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { parseSlabInput } from "@/lib/slabLabel";
import { RECORD_SMART, nextIncrementValue } from "@/lib/recordSmart";
import { prisma } from "@/lib/prisma";
import { autolinkFinishedSlabFromQc, relinkFinishedSlabAfterNumberChange } from "@/lib/inventory/finishedSlab";
import { REQUIRED_FORM_FIELDS, REQUIRED_FIELD_LABELS } from "@/lib/requiredFields";
import { MAX_SLABS_PER_HOUR } from "@/lib/shiftScoreMath";
import { savePhotoFromForm } from "@/lib/entryPhoto";

// tx-scoped equivalent of delegateOf() for $transaction blocks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txDelegate = (tx: any, model: string) => tx[model[0].toLowerCase() + model.slice(1)];

/** Postgres text columns reject NUL bytes (22021) — strip 0x00 from every
 * string / string-array value in place (stray tablet-keyboard/clipboard
 * artifacts must never 500 a save). */
function stripNuls(values: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string" && v.includes("\u0000")) values[k] = v.replaceAll("\u0000", "");
    else if (Array.isArray(v)) values[k] = v.map((x) => (typeof x === "string" ? x.replaceAll("\u0000", "") : x));
  }
}

/** Auto-increment counters (silo increment, bag no, resin id) server-side so
 * they are always set even when the field is not operator-editable. */
async function stampIncrements(model: string, data: Record<string, unknown>) {
  const cfg = RECORD_SMART[model];
  for (const inc of cfg?.increments ?? []) {
    if (data[inc.field] != null && data[inc.field] !== "") continue;
    const where = inc.perKey && cfg?.keyField && typeof data[cfg.keyField] === "string" && data[cfg.keyField] ? { [cfg.keyField]: data[cfg.keyField] } : {};
    const next = await nextIncrementValue(model, inc.field, where); // null when the field doesn't exist
    if (next != null) data[inc.field] = next;
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
    for (let g = 1; g <= 8; g++) mix += n(data[`m${m}W${g}`]);
    mix += n(data[`m${m}FW`]) + n(data[`m${m}RW`]);
    total += mix;
    if (m === 1) m1 = mix;
  }
  if (total > 0) { data.totalCycleWeight = Math.round(total * 100) / 100; data.totalMixer1Weight = Math.round(m1 * 100) / 100; }
}

/** Mixer cycle: filler weight without a silo/buffer name can never be deducted
 * from stock — block it at save time (both create and edit). */
function fillerBufferMissing(model: string, data: Record<string, unknown>, fd: FormData): string | null {
  if (model !== "MixerCycle") return null;
  const fw = ["m1FW", "m2FW", "m3FW", "m4FW"].reduce((a, k) => a + (typeof data[k] === "number" ? (data[k] as number) : 0), 0);
  if (fw <= 0) return null;
  if (fd.has("fillerSiloBuffer") && !String(data.fillerSiloBuffer ?? "").trim())
    return "Filler weight entered but no Filler Silo/Buffer selected — pick the buffer so stock gets deducted.";
  return null;
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
// Slab stations where slab number + batch must be unique (double-entry guard on create).
const SLAB_STATIONS = new Set(["Press", "Oven", "Jot", "Distributor", "Kreos"]);

// ---- DATE SANITY -----------------------------------------------------------------
// ROOT CAUSE of the 603 mis-dated rows (batches 1359/1360/1375 press, 1348 jot): operators
// typed the PREVIOUS YEAR on the entry form — right month, right day, wrong year — and
// nothing checked it. coerceField() just does `new Date(s)` and stores whatever parses, so
// a "2025-06-26" typed on 2026-06-26 sailed straight in, and because press rows are entered
// slab-by-slab one wrong year rode through a whole shift (208 rows in one sitting).
// Two rules, both cheap, both server-side (the form's own validation can be bypassed):
//   1. never more than 2 days in the future (the grace absorbs IST/UTC skew), and
//   2. the date must sit NEAR ITS BATCH — within 21 days of the batch's LATEST real date.
//      Deliberately anchored to the latest date, not to a min..max window: a batch that
//      already contains a year-old typo would have a year-wide window and would happily
//      swallow more of them (verified — that exact window ACCEPTED all 603 bad rows).
//      Production only moves forward, so the newest real row is the honest anchor, and a
//      year typo sits 365 days behind it. 21 days covers the longest real batch (17 days).
//      For the first row of a brand-new batch there is nothing to compare against, so it
//      must instead be within the last 90 days — which still catches a wrong year.
// Auto-added placeholders are excluded from the comparison window: they are copies, not
// evidence. Genuine historical loads go through scripts/import.ts, which does not run this.
const DATED_STATIONS = new Set(["Press", "Oven", "Jot", "Distributor", "Kreos"]);
const DAY_MS = 86400000;
const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);

/**
 * MIS slab range — refuse a typo, and refuse to claim another hour's slabs.
 *
 * The shift scoreboard pays on these two numbers: a shift owns the slabs its own
 * MIS rows declare. So a range that is wrong here moves money, and a range that
 * overlaps another shift's takes it from them — the scoreboard drops a slab both
 * shifts claim, so ONE typo costs BOTH crews the whole overlap. That happened on
 * 2026-07-17: an hour typed 148551-148662 instead of ~148551-148562 and took 100
 * slabs off a shift that had already declared them.
 *
 * Catching it here means the person who typed it fixes it while they still
 * remember the hour, instead of an admin reading a red banner at payroll.
 *
 * `selfId` is the row being edited, so an edit does not collide with itself.
 */
async function misSlabRangeError(model: string, data: Record<string, unknown>, selfId: string | null): Promise<string | null> {
  if (model !== "Mis") return null;
  const a = Number(data.startingSlabNumber ?? NaN), b = Number(data.endingSlabNumber ?? NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  if (b < a) return `⚠ Ending slab ${b} is before the starting slab ${a} — check the range.`;
  if (b - a >= MAX_SLABS_PER_HOUR) {
    return `⚠ Slabs ${a}-${b} is ${b - a + 1} slabs in one hour. The line's widest real hour is 35, so this is a typo — the scoreboard will ignore the whole hour. Check the starting and ending slab number.`;
  }
  // Any other MIS row whose range overlaps this one. Rows with an impossible
  // width are skipped: they are already-known typos and would match everything.
  let clash: { id: string; date: Date | null; hour: string | null; productionInchargeName: string | null; startingSlabNumber: number | null; endingSlabNumber: number | null } | null = null;
  try {
    const rows = await delegateOf(model).findMany({
      where: {
        startingSlabNumber: { lte: b, gte: a - MAX_SLABS_PER_HOUR },
        endingSlabNumber: { gte: a },
        ...(selfId ? { NOT: { id: selfId } } : {}),
      },
      select: { id: true, date: true, hour: true, productionInchargeName: true, startingSlabNumber: true, endingSlabNumber: true },
      take: 20,
    });
    clash = rows.find((r: { startingSlabNumber: number | null; endingSlabNumber: number | null }) => {
      const s = Number(r.startingSlabNumber), e = Number(r.endingSlabNumber);
      return Number.isFinite(s) && Number.isFinite(e) && e >= s && e - s < MAX_SLABS_PER_HOUR && s <= b && e >= a;
    }) ?? null;
  } catch { return null; }   // never block an entry because the check itself failed
  if (!clash) return null;
  const when = clash.date ? istDay(new Date(clash.date)) : "another day";
  const who = clash.productionInchargeName ? ` by ${clash.productionInchargeName}` : "";
  return `⚠ Slabs ${a}-${b} overlap ${clash.startingSlabNumber}-${clash.endingSlabNumber}, already logged on ${when} hour ${clash.hour ?? "?"}${who}. Two hours cannot both make the same slab, and the scoreboard gives a disputed slab to neither shift — check the range before saving.`;
}

async function dateSanity(model: string, data: Record<string, unknown>, batchKeyFallback?: string | null, currentDate?: Date | null): Promise<string | null> {
  if (!DATED_STATIONS.has(model)) return null;
  const d = data.date;
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() > now + 2 * DAY_MS)
    return `\u26a0 Date ${istDay(d)} is in the future — check the year and the month, then save again.`;
  // On an EDIT, a small correction near the row's existing date is always allowed — an old
  // row on a long-running batch must stay correctable, and a wrong year is never "small"
  // (365 days), so this cannot reopen the hole. Nudging a date by a day or two always works.
  if (currentDate && Math.abs(d.getTime() - currentDate.getTime()) <= 21 * DAY_MS) return null;

  const key = (typeof data.batchKey === "string" && data.batchKey) || batchKeyFallback || "";
  if (key) {
    let win: { hi: Date | null } | undefined;
    try {
      const rows = await prisma.$queryRaw<{ hi: Date | null }[]>`
        SELECT max(date) hi FROM (
          SELECT date, remarks FROM press        WHERE batch_key = ${key}
          UNION ALL SELECT date, remarks FROM distributor WHERE batch_key = ${key}
          UNION ALL SELECT date, remarks FROM kreos       WHERE batch_key = ${key}
          UNION ALL SELECT date, remarks FROM oven        WHERE batch_key = ${key}
          UNION ALL SELECT date, remarks FROM jot         WHERE batch_key = ${key}
        ) t
        WHERE date IS NOT NULL AND date <= now() + interval '2 days'
          AND (remarks IS NULL OR remarks NOT LIKE '\u2699 auto-added%')`;
      win = rows[0];
    } catch { /* if the window can't be read, fall through to the 90-day rule */ }
    if (win?.hi) {
      const anchor = new Date(win.hi);
      const lo = anchor.getTime() - 21 * DAY_MS;
      const hi = anchor.getTime() + 21 * DAY_MS;
      if (d.getTime() < lo || d.getTime() > hi)
        return `\u26a0 Date ${istDay(d)} doesn't fit batch ${key} — the batch's latest entry is ${istDay(anchor)}. Check the YEAR (a wrong year is the usual cause), then save again.`;
      return null;
    }
  }
  if (d.getTime() < now - 90 * DAY_MS)
    return `\u26a0 Date ${istDay(d)} is more than 90 days old — check the year, then save again.`;
  return null;
}
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
  stripNuls(data);
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
  const me = await currentUser(); // request-cached; reused by the checks and stamps below
  if (!(await canRectify())) {
    // operators may correct ONLY rows they created themselves, in their own station's tables
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
  // Mandatory fields: block clearing them on edit (only when the form sent the field).
  for (const rf of REQUIRED_FORM_FIELDS[model] ?? [])
    if (fd.has(rf) && !String(data[rf] ?? "").trim()) return `${REQUIRED_FIELD_LABELS[rf] ?? rf} is required.`;
  { const fbErr = fillerBufferMissing(model, data, fd); if (fbErr) return fbErr; }
  // MIS on EDIT carries the same two money guards as the create path. The slab
  // range and the delay minutes are BOTH editable here, so enforcing them only
  // on create left the front door locked and the back door open: an incharge
  // could save a clean row and then widen its range over another shift's slabs,
  // or set an old hour's breakdown to 480 minutes and buy perfect uptime.
  if (model === "Mis" && (fd.has("startingSlabNumber") || fd.has("endingSlabNumber"))) {
    const cur = await delegateOf(model).findUnique({ where: { id }, select: { startingSlabNumber: true, endingSlabNumber: true } }).catch(() => null);
    const merged = {
      startingSlabNumber: fd.has("startingSlabNumber") ? data.startingSlabNumber : cur?.startingSlabNumber,
      endingSlabNumber: fd.has("endingSlabNumber") ? data.endingSlabNumber : cur?.endingSlabNumber,
    };
    const sErr = await misSlabRangeError(model, merged, id);
    if (sErr) return sErr;
  }
  if (model === "Mis") {
    const DELAY_FIELDS = ["processDelayDurationMinutes", "cleaningDelayDurationMinutes",
      "breakdownDelayDurationMechanicalOrElectricalMinutes", "poweroutDelayDurationMinutes"] as const;
    if (DELAY_FIELDS.some((k) => fd.has(k))) {
      const cur = await delegateOf(model).findUnique({
        where: { id },
        select: Object.fromEntries(DELAY_FIELDS.map((k) => [k, true])),
      }).catch(() => null);
      const dt = DELAY_FIELDS.reduce((a, k) =>
        a + Number((fd.has(k) ? data[k] : (cur as Record<string, unknown> | null)?.[k]) ?? 0), 0);
      if (dt > 60) return `⚠ Total delay for this hour is ${Math.round(dt)} min — an hour can have at most 60 minutes of downtime. Reduce the delay entries before saving.`;
    }
  }
  // Date sanity on EDIT — only when the date is actually being changed. An old row whose
  // date is legitimately months old must stay editable (its unchanged date would otherwise
  // trip the 90-day rule), so an untouched date is never re-validated.
  if (DATED_STATIONS.has(model) && fd.has("date") && data.date instanceof Date) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cur: any = await delegateOf(model).findUnique({ where: { id }, select: { date: true, batchKey: true } }).catch(() => null);
    const changed = !cur?.date || new Date(cur.date).getTime() !== (data.date as Date).getTime();
    if (changed) { const dErr = await dateSanity(model, data, cur?.batchKey ?? null, cur?.date ? new Date(cur.date) : null); if (dErr) return dErr; }
  }
  // If this QC edit changes the slab number, the old number's inventory row must
  // be re-projected (or removed) — capture it before the update.
  let qcPrevSlabNumber: number | null = null;
  if (model === "PolishQc" && data.slabNumber !== undefined) {
    try { qcPrevSlabNumber = Number((await delegateOf(model).findUnique({ where: { id }, select: { slabNumber: true } }))?.slabNumber ?? NaN) || null; } catch { /* best-effort */ }
  }
  try {
    await delegateOf(model).update({ where: { id }, data });
    if (model === "MixerCycle") {
      // recompute the formula totals from the full row after the edit
      const sel: Record<string, boolean> = {};
      for (let m = 1; m <= 4; m++) { sel[`m${m}FW`] = true; sel[`m${m}RW`] = true; for (let g = 1; g <= 8; g++) sel[`m${m}W${g}`] = true; }
      const row = await delegateOf(model).findUnique({ where: { id }, select: sel });
      if (row) { const t: Record<string, unknown> = { ...row }; stampMixerTotals(model, t); await delegateOf(model).update({ where: { id }, data: { totalCycleWeight: t.totalCycleWeight ?? null, totalMixer1Weight: t.totalMixer1Weight ?? null } }); }
    }
  }
  catch (e) { return `Save failed: ${friendlyDbError(e)}`; }
  await savePhotoFromForm(fd, model, id, me?.name ?? null); // optional photo, best-effort
  // Self-heal: an edited mixer cycle re-runs FIFO allocation (already-linked
  // slots are skipped) so filling in a missing silo/buffer deducts stock.
  if (model === "MixerCycle") { try { await allocateMixerCycle(id); } catch { /* best-effort */ } }
  revalidatePath(`/tables/${model}`);
  if (model === "PolishQc") {
    await logAction({ kind: "edit", batchKey: (data.batchKey as string | undefined) ?? null, model: "PolishQc", summary: `Edited Polish QC slab ${String(data.slabNumber ?? "")}`.trim(), payload: { id, slabNumber: data.slabNumber ?? null } });
    try {
      const by = me?.name ?? null;
      const sn = typeof data.slabNumber === "number" ? data.slabNumber : Number((await delegateOf(model).findUnique({ where: { id }, select: { slabNumber: true } }))?.slabNumber);
      await autolinkFinishedSlabFromQc(sn, { by });
      if (qcPrevSlabNumber != null && qcPrevSlabNumber !== sn) await relinkFinishedSlabAfterNumberChange(qcPrevSlabNumber, by);
    } catch { /* inventory autolink is best-effort */ }
  }
  return "ok";
}

/**
 * Permanently delete a record — ADMIN ONLY. The full row is captured in the
 * action log first, so the in-app Undo can restore it. Deleting a PolishQc row
 * also re-projects (or removes) the slab's finished-goods inventory entry.
 */
export async function deleteRow(model: string, id: string): Promise<string> {
  if (!(await isAdmin())) return "Only an administrator can delete records.";
  if (!model || !id) return "Missing table or record.";
  if (!(await canSeeModel(model))) return "Unknown table.";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let row: any;
  try { row = await delegateOf(model).findUnique({ where: { id } }); } catch { return "Delete failed: table unavailable."; }
  if (!row) return "Record not found — it may already be deleted.";
  // Log FIRST (so the row is always recoverable), then delete. A phantom log
  // entry from a failed delete is harmless: undo's create skips existing ids.
  const batchKey = typeof row.batchKey === "string" ? row.batchKey : null;
  const label = row.slabNumber != null ? ` (slab ${row.slabNumber})` : row.batch ? ` (batch ${row.batch})` : "";
  await logAction({ kind: "delete", batchKey, model, summary: `Deleted ${model} record${label} — admin`, payload: { model, records: [row] } });
  try { await delegateOf(model).delete({ where: { id } }); }
  catch (e) { return `Delete failed: ${friendlyDbError(e)}`; }
  if (model === "PolishQc" && typeof row.slabNumber === "number") {
    try { await relinkFinishedSlabAfterNumberChange(row.slabNumber, (await currentUser())?.name ?? null); } catch { /* best-effort */ }
  }
  revalidatePath(`/tables/${model}`);
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
  // Mandatory fields (client `required` can be bypassed — enforce here too).
  for (const rf of REQUIRED_FORM_FIELDS[model] ?? [])
    if (!String(data[rf] ?? "").trim()) return `${REQUIRED_FIELD_LABELS[rf] ?? rf} is required.`;
  { const fbErr = fillerBufferMissing(model, data, fd); if (fbErr) return fbErr; }
  // Accept "1a"/"1b" insert labels in the slab-number field -> decimal (1.1/1.2).
  if (fd.has("slabNumber")) { const ps = parseSlabInput(fd.get("slabNumber")); if (ps != null) data.slabNumber = ps; }
  stampOperator(model, data, opName);
  stampBatchKey(data);
  stampMixerTotals(model, data);
  stampPumps(model, data);
  await stampIncrements(model, data);

  { const dErr = await dateSanity(model, data); if (dErr) return dErr; }

  // MIS: a single hour can log at most 60 minutes of downtime — block impossible totals.
  if (model === "Mis") {
    const dt = Number(data.processDelayDurationMinutes ?? 0) + Number(data.cleaningDelayDurationMinutes ?? 0)
      + Number(data.breakdownDelayDurationMechanicalOrElectricalMinutes ?? 0) + Number(data.poweroutDelayDurationMinutes ?? 0);
    if (dt > 60) return `\u26a0 Total delay for this hour is ${Math.round(dt)} min \u2014 an hour can have at most 60 minutes of downtime. Reduce the delay entries before saving.`;
  }
  // MIS: the row's DATE must be the IST day of its DATE AND TIME — the old
  // form let them disagree, landing back-filled hours on the wrong day's sheet.
  if (model === "Mis" && data.dateAndTime instanceof Date && !isNaN(data.dateAndTime.getTime())) {
    const istDay = new Date(data.dateAndTime.getTime() + 330 * 60000).toISOString().slice(0, 10);
    data.date = new Date(`${istDay}T00:00:00.000Z`);
  }
  // MIS: one row per hour per day — a double-tap or a second tablet must not
  // create a duplicate (it would double-count slabs and downtime downstream).
  if (model === "Mis" && data.hour && data.date instanceof Date && !isNaN(data.date.getTime())) {
    const d0 = new Date(Date.UTC(data.date.getUTCFullYear(), data.date.getUTCMonth(), data.date.getUTCDate()));
    const d1 = new Date(d0.getTime() + 864e5);
    const dupe = await delegateOf(model).findFirst({ where: { hour: data.hour, OR: [
      { date: { gte: d0, lt: d1 } },
      { AND: [{ date: null }, { dateAndTime: { gte: d0, lt: d1 } }] }, // legacy rows carry only dateAndTime
    ] }, select: { id: true } }).catch(() => null);
    if (dupe) return `\u26a0 Hour ${data.hour} is already logged for this date — open it with the row's edit link instead of saving again.`;
  }
  { const sErr = await misSlabRangeError(model, data, null); if (sErr) return sErr; }

  // Require a slab number on slab stations (manual or smart entry) — no blank rows.
  if (SLAB_REQUIRED.has(model) && !hasSlab(data.slabNumber)) {
    return "⚠ Slab number is required — enter the slab number (manually or via smart entry) before saving.";
  }

  // QC grade defaults to "Not graded yet" when the operator never picked one
  // (dropdown untouched or left at "—") — keeps it out of the blank/"—" bucket.
  if (model === "PolishQc" && !String(data.qualityGrade ?? "").trim()) data.qualityGrade = "Not graded yet";

  // ---- DOUBLE-ENTRY GUARDS (the dedupe tool exists for history; new entries are blocked up front) ----
  try {
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
  try {
    const base: Record<string, unknown> = { airtableId: localId(model.toLowerCase()), ...data, enteredById: me?.id ?? null };
    // FINAL 22021 choke point: buildData's NUL sweep runs BEFORE stampOperator
    // & co., so values stamped after it (submittedBy = login name, ids) must be
    // swept here too — nothing carrying 0x00 may ever reach the INSERT.
    stripNuls(base);
    if (model === "Silo" && rmBag) {
      // Silo fill + RM-bag consumption is ONE atomic unit: if the bag can't be
      // marked consumed (or was consumed by a concurrent dump), nothing saves —
      // otherwise the bag stays "available" and can be dumped twice.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = await (prisma as any).$transaction(async (tx: any) => {
        const fresh = await tx.rm.findUnique({ where: { airtableId: rmBagId }, select: { siloIds: true } });
        if (!fresh) throw new Error("RM bag no longer exists — refresh and pick again.");
        if (Array.isArray(fresh.siloIds) && fresh.siloIds.length > 0) throw new Error("This bag was just dumped into a silo by someone else — refresh and pick another bag.");
        const created = await txDelegate(tx, model).create({ data: base });
        await tx.rm.update({ where: { airtableId: rmBagId }, data: { siloIds: { set: [...(fresh.siloIds ?? []), created.airtableId] } } });
        return created;
      });
      createdId = rec.id;
    } else {
      const rec = await delegateOf(model).create({ data: base });
      createdId = rec.id;
    }
  }
  catch (e) { return `Create failed: ${friendlyDbError(e)}`; }
  await savePhotoFromForm(fd, model, createdId, opName); // optional photo, best-effort
  // JOT defect -> instant Telegram alert with the entry photo (best-effort)
  if (model === "Jot" && String(data.slabDefect ?? "").trim()) {
    try { const { jotDefectAlert } = await import("@/lib/telegramReports"); await jotDefectAlert(createdId, data); } catch { /* never blocks the entry */ }
  }
  // Polish QC: MORE THAN 3 C-grade (reject) slabs for a batch today -> one group alert
  if (model === "PolishQc" && String(data.qualityGrade ?? "") === "C (Reject)") {
    try {
      const dayStartIST = new Date(Math.floor((Date.now() + 330 * 60000) / 86400000) * 86400000 - 330 * 60000);
      const n = await delegateOf(model).count({ where: {
        qualityGrade: "C (Reject)",
        importedAt: { gte: dayStartIST },
        ...(data.batchKey ? { batchKey: data.batchKey as string } : {}),
      } });
      if (n === 4) { // alert once, the moment it crosses "more than 3"
        const { sendTelegram } = await import("@/lib/telegram");
        const { esc } = await import("@/lib/telegram");
        await sendTelegram(`🚨 <b>Quality alert — ${n} C-grade (reject) slabs today</b>${data.batchKey ? ` · Batch <b>${esc(data.batchKey)}</b>` : ""}
Latest: slab ${esc(data.slabNumber ?? "—")} at Polish QC. Please check the line.`);
      }
    } catch { /* never blocks the entry */ }
  }
  revalidatePath(`/tables/${model}`);
  if (model === "PolishQc") {
    // Autolink this QC slab into finished-goods inventory (best-effort).
    try { await autolinkFinishedSlabFromQc(data.slabNumber as number, { by: opName }); } catch { /* inventory autolink is best-effort */ }
  }
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
      res = await (prisma as any).$transaction(async (tx: any) => {
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
        await (prisma as any).$transaction(async (tx: any) => {
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
