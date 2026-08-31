"use server";

// Slab intake actions: look a slab number up, then either add the missing
// finished-goods row (source MANUAL_ENTRY) or correct fields on the existing
// one — one SlabEvent per changed field, written through the same
// writeSlabEvent helper the QC autolink uses. Every action re-checks
// slabIntakeGate() itself: the page showing a form is a UI condition, not an
// authorisation, and a server action is an endpoint whatever rendered it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { slabIntakeGate } from "@/lib/inventory/intakeGate";
import { writeSlabEvent } from "@/lib/inventory/finishedSlab";
import { canonicalGrade } from "@/lib/inventory/grading";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { photosForRecord, requiredPhotoProblem, saveRequiredPhoto } from "@/lib/entryPhoto";
import {
  parseSlabNumber, cleanText, cleanIssues, validateSlabDetails, savedSentence, DEFECT_PHOTOS,
  statusChangeRefusal, normalizeBay, bayRefusal,
  type SlabDetailsInput,
} from "@/lib/inventory/intakeRules";

const db = prisma as any;

// ---------------------------------------------------------------------------
// Shapes the client form reads. Dates travel as ISO strings — server actions
// serialize across the wire.
// ---------------------------------------------------------------------------

/** The latest Polish QC row for the slab, shown grey beside the editable
 *  fields for reference — QC's version of the story, never hidden. */
export interface QcReference {
  at: string | null;
  inspector: string | null;
  design: string | null;
  grade: string | null;
  slabThickness: string | null;
  qualityIssue: string[];
  polishType: string | null;
  rwStatus: string | null;
  repolishStatus: string | null;
  batchNumber: string | null;
  bay: string | null;
}

export interface SlabCurrent extends SlabDetailsInput {
  slabNumber: number;
  source: string;
  reservedForPi: string | null;
  customer: string | null;
  qcInspector: string | null;
  lastQcAt: string | null;
}

export interface PhotoRef { id: string; filename: string }
/** The slab's defect photos as this form stored them — far/near told apart by
 *  the filename prefix saveRequiredPhoto writes. What the form renders as
 *  thumbnails, and what decides which slots an EDIT still requires. */
export interface SlabPhotos { far: PhotoRef[]; near: PhotoRef[] }

export type LookupRes =
  | { ok: false; message: string }
  | { ok: true; exists: true; message: string; slab: SlabCurrent; qc: QcReference | null; photos: SlabPhotos }
  | { ok: true; exists: false; message: string; prefill: SlabDetailsInput; from: Record<string, string>; qc: QcReference | null };

export interface SaveRes { ok: boolean; message: string }

const NOT_YOURS = "This form is for the named slab-intake people and admins only.";

/** An empty number box arrives as null/"" — both mean "not entered". Anything
 *  unparseable becomes NaN, which validateSlabDetails refuses by name. */
const numOrNull = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v);

const qcRefOf = (qc: any): QcReference => ({
  at: qc.createdTime?.toISOString() ?? qc.importedAt?.toISOString() ?? null,
  inspector: qc.inspector ?? null,
  design: qc.design ?? null,
  grade: canonicalGrade(qc.qualityGrade),
  slabThickness: qc.slabThickness ?? null,
  qualityIssue: Array.isArray(qc.qualityIssue) ? qc.qualityIssue : [],
  polishType: qc.polishType ?? null,
  rwStatus: qc.rwStatus ?? null,
  repolishStatus: qc.repolishStatus ?? null,
  batchNumber: qc.batchNumber ?? null,
  bay: qc.bay ?? null,
});

/**
 * Look a slab number up. EXISTS → its current details plus the latest QC row
 * for side-by-side reference. MISSING → a prefill assembled from whatever the
 * production line already recorded for that number (Polish QC first — the
 * richest — then Jot, then Press), each value labelled with where it came
 * from, so the person checks a claim rather than retypes one.
 */
export async function lookupSlab(input: string): Promise<LookupRes> {
  const g = await slabIntakeGate();
  if (!g.ok) return { ok: false, message: NOT_YOURS };
  const parsed = parseSlabNumber(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const slabNumber = parsed.slab;

  const [row, qc] = await Promise.all([
    db.finishedSlab.findUnique({ where: { slabNumber } }),
    db.polishQc.findFirst({ where: { slabNumber }, orderBy: [{ createdTime: "desc" }, { importedAt: "desc" }] }),
  ]);

  if (row) {
    // Which defect photos this form already stored, sorted into their slots by
    // filename prefix. photosForRecord is best-effort ([] on a failed read) —
    // which errs towards REQUIRING photos, the safe direction for a mandatory
    // rule.
    const meta = await photosForRecord("FinishedSlab", row.id);
    const photos: SlabPhotos = { far: [], near: [] };
    for (const p of meta) {
      const name = String(p.filename ?? "");
      if (name.startsWith("far-")) photos.far.push({ id: p.id, filename: name });
      else if (name.startsWith("near-")) photos.near.push({ id: p.id, filename: name });
    }
    return {
      ok: true, exists: true,
      message: `Slab ${slabNumber} is in finished goods — its current details are below. Change what is wrong and save.`,
      slab: {
        slabNumber,
        design: row.design ?? null,
        grade: canonicalGrade(row.grade),
        slabThickness: row.slabThickness ?? null,
        qualityIssue: Array.isArray(row.qualityIssue) ? row.qualityIssue : [],
        polishType: row.polishType ?? null,
        rwStatus: row.rwStatus ?? null,
        repolishStatus: row.repolishStatus ?? null,
        batchNumber: row.batchNumber ?? null,
        lengthIn: row.lengthIn ?? null,
        widthIn: row.widthIn ?? null,
        bayNumber: row.bayNumber ?? null,
        frameNumber: row.frameNumber ?? null,
        status: String(row.status ?? "AVAILABLE"),
        notes: row.notes ?? null,
        source: String(row.source ?? ""),
        reservedForPi: row.reservedForPi ?? null,
        customer: row.customer ?? null,
        qcInspector: row.qcInspector ?? null,
        lastQcAt: row.lastQcAt?.toISOString() ?? null,
      },
      qc: qc ? qcRefOf(qc) : null,
      photos,
    };
  }

  // Missing — build the prefill, remembering where each value came from.
  const prefill: SlabDetailsInput = {
    design: null, grade: null, slabThickness: null, qualityIssue: [],
    polishType: null, rwStatus: null, repolishStatus: null, batchNumber: null,
    lengthIn: null, widthIn: null, bayNumber: null, frameNumber: null,
    status: "AVAILABLE", notes: null,
  };
  const from: Record<string, string> = {};
  const take = (field: keyof SlabDetailsInput, value: unknown, src: string) => {
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return;
    (prefill as any)[field] = value;
    from[field] = src;
  };
  if (qc) {
    take("design", qc.design, "Polish QC");
    take("grade", canonicalGrade(qc.qualityGrade), "Polish QC");
    take("slabThickness", qc.slabThickness, "Polish QC");
    take("qualityIssue", Array.isArray(qc.qualityIssue) ? qc.qualityIssue : [], "Polish QC");
    take("polishType", qc.polishType, "Polish QC");
    take("rwStatus", qc.rwStatus, "Polish QC");
    take("repolishStatus", qc.repolishStatus, "Polish QC");
    take("batchNumber", qc.batchNumber, "Polish QC");
    take("bayNumber", qc.bay, "Polish QC");
  } else {
    // No QC pass — an already-made slab from before the digital line, or one
    // that skipped QC. The press line may still know it.
    const [jot, press] = await Promise.all([
      db.jot.findFirst({ where: { slabNumber }, orderBy: { createdTime: "desc" } }).catch(() => null),
      db.press.findFirst({ where: { slabNumber }, orderBy: { createdTime: "desc" } }).catch(() => null),
    ]);
    if (jot) {
      take("design", jot.designName, "Jot");
      take("slabThickness", jot.thickness, "Jot");
      take("batchNumber", jot.batch, "Jot");
    }
    if (press) {
      take("design", press.designName, "Press");
      take("batchNumber", press.batch, "Press");
    }
  }

  const src = Object.keys(from).length
    ? `Prefilled from ${[...new Set(Object.values(from))].join(" and ")} — check every value before adding it.`
    : "No production record was found for this number — enter the details yourself.";
  return {
    ok: true, exists: false,
    message: `Slab ${slabNumber} is not in finished goods yet. ${src}`,
    prefill, from, qc: qc ? qcRefOf(qc) : null,
  };
}

// The editable field set. reservedForPi / customer / reservation dates are
// deliberately NOT here: holds are the lifecycle's business (reserve/release
// on the inventory screen), and a details form quietly clearing somebody's PI
// hold is the kind of favour nobody asked for.
const TEXT_FIELDS = [
  ["design", 120], ["slabThickness", 30], ["polishType", 30], ["rwStatus", 60],
  ["repolishStatus", 60], ["batchNumber", 60], ["bayNumber", 30], ["frameNumber", 60],
  ["notes", 900],
] as const;

/** Store the provided defect photos against the FinishedSlab row, one SlabEvent
 *  (kind "photo") each so the trail says which slot arrived and when. Validation
 *  already ran before the row was written; a failure here is the INSERT itself,
 *  reported by name — never a silent skip. Not exported: a "use server" file's
 *  exports are all endpoints, and this must only run behind saveSlab's gate. */
async function storeDefectPhotos(
  fd: FormData, recordId: string, slabNumber: number, by: string | null,
  slots: readonly (typeof DEFECT_PHOTOS)[number][],
): Promise<{ saved: string[]; warning: string }> {
  const saved: string[] = [];
  const failures: string[] = [];
  for (const p of slots) {
    const err = await saveRequiredPhoto(fd, p.field, {
      model: "FinishedSlab", recordId, by, prefix: p.prefix, label: p.label,
    });
    if (err) { failures.push(err); continue; }
    const f = fd.get(p.field) as File;
    await writeSlabEvent(slabNumber, "photo", {
      field: p.short, newValue: (p.prefix + (f.name || "photo.jpg")).slice(0, 200), by, source: "Slab intake form",
    });
    saved.push(p.short);
  }
  return { saved, warning: failures.length ? `${failures.join(" ")} Look the slab up and attach it again.` : "" };
}

/**
 * Save: create the missing row (source MANUAL_ENTRY) or update ONLY the fields
 * that actually changed on the existing one — one SlabEvent per changed field
 * (kind "manual_correction", source "Slab intake form", changedBy the session
 * name), so the audit trail reads like what happened.
 *
 * Takes a FormData rather than a plain object because the two defect photos
 * ride in it: files and fields cross a server-action call together only inside
 * one FormData, so the details travel as a JSON "payload" field beside them.
 * THE PHOTO RULE: both photos are mandatory on CREATE; on an EDIT each slot is
 * required only while the slab does not already have it from this form, and a
 * photo in an already-filled slot is added alongside, never demanded.
 */
export async function saveSlab(fd: FormData): Promise<SaveRes> {
  const g = await slabIntakeGate();
  if (!g.ok) return { ok: false, message: NOT_YOURS };
  let input: { slabNumber?: unknown; expectExisting?: unknown; details?: SlabDetailsInput };
  try { input = JSON.parse(String(fd.get("payload") ?? "")); }
  catch { return { ok: false, message: "Could not read the form — reload the page and try again." }; }
  const parsed = parseSlabNumber(input?.slabNumber);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const slabNumber = parsed.slab;
  const expectExisting = Boolean(input?.expectExisting);

  const raw = input?.details ?? ({} as SlabDetailsInput);
  const d: SlabDetailsInput = {
    design: cleanText(raw.design, 120),
    grade: cleanText(raw.grade, 30),
    slabThickness: cleanText(raw.slabThickness, 30),
    qualityIssue: cleanIssues(raw.qualityIssue),
    polishType: cleanText(raw.polishType, 30),
    rwStatus: cleanText(raw.rwStatus, 60),
    repolishStatus: cleanText(raw.repolishStatus, 60),
    batchNumber: cleanText(raw.batchNumber, 60),
    lengthIn: numOrNull(raw.lengthIn),
    widthIn: numOrNull(raw.widthIn),
    bayNumber: normalizeBay(cleanText(raw.bayNumber, 30)),
    frameNumber: cleanText(raw.frameNumber, 60),
    status: String(raw.status ?? "AVAILABLE").trim().toUpperCase(),
    notes: cleanText(raw.notes, 900),
  };
  const bad = validateSlabDetails(d);
  if (bad) return { ok: false, message: bad };

  const by: string | null = (g.user as any)?.name ?? (g.user as any)?.email ?? null;
  const SOURCE = "Slab intake form";

  // Which slots actually arrived — an untouched file input posts nothing.
  const provided = DEFECT_PHOTOS.filter((p) => {
    const f = fd.get(p.field);
    return f instanceof File && f.size > 0;
  });

  try {
    const cur = await db.finishedSlab.findUnique({ where: { slabNumber } });

    if (!cur) {
      if (expectExisting)
        return { ok: false, message: `Slab ${slabNumber} is no longer in finished goods — look it up again before saving.` };
      // A slab entering finished goods by hand gets a hand-checkable status and
      // a real bay — CHROMIA in particular is the Chromia register's to write.
      const refused = statusChangeRefusal(null, d.status) ?? bayRefusal(d.bayNumber);
      if (refused) return { ok: false, message: refused };
      // BOTH PHOTOS, CHECKED BEFORE THE ROW EXISTS: refusing after the create
      // would leave a slab in finished goods that the mandatory rule says
      // cannot be there without its photos.
      for (const p of DEFECT_PHOTOS) {
        const problem = requiredPhotoProblem(fd, p.field, p.label);
        if (problem) return { ok: false, message: problem };
      }
      const created = await db.finishedSlab.create({
        data: {
          slabNumber,
          source: "MANUAL_ENTRY",
          status: d.status,
          design: d.design, grade: d.grade, slabThickness: d.slabThickness,
          qualityIssue: d.qualityIssue, polishType: d.polishType,
          rwStatus: d.rwStatus, repolishStatus: d.repolishStatus,
          batchNumber: d.batchNumber,
          batchKey: d.batchNumber ? normalizeBatch(d.batchNumber) : null,
          lengthIn: d.lengthIn ?? 137, widthIn: d.widthIn ?? 79,
          bayNumber: d.bayNumber, frameNumber: d.frameNumber,
          notes: d.notes,
        },
      });
      await writeSlabEvent(slabNumber, "created", { by, source: SOURCE, newValue: "manual entry" });
      // Validated above, so a failure here is storage itself; the warning sends
      // the person straight back (the re-lookup then shows the slot as still
      // required, so the rule heals rather than silently lapsing).
      const ph = await storeDefectPhotos(fd, created.id, slabNumber, by, DEFECT_PHOTOS);
      revalidatePath("/inventory");
      return { ok: true, message: savedSentence(slabNumber, true, []) + (ph.warning ? ` ${ph.warning}` : "") };
    }

    if (!expectExisting)
      return { ok: false, message: `Slab ${slabNumber} was added by someone else while you were typing — look it up again to see its current details.` };

    // The status box may take a slab OUT of any state, but CHROMIA is not a
    // hand target; and a bay is only checked when it is the thing being
    // written — a legacy spelling nobody touched must not block a correction.
    const refused = statusChangeRefusal(String(cur.status), d.status)
      ?? (d.bayNumber !== ((cur.bayNumber as string | null) ?? null) ? bayRefusal(d.bayNumber) : null);
    if (refused) return { ok: false, message: refused };

    // WHICH PHOTOS THIS SLAB ALREADY HAS from this form: on an EDIT the pair
    // must exist by the time the save lands, whether stored today or last
    // month — so only a missing slot is demanded, and anything that WAS
    // attached is validated (a bad file is refused by name, never skipped).
    // The MANDATE is the manual-entry rule: a slab this form put into finished
    // goods carries its two defect photos. A slab that arrived from QC or a
    // bulk upload was never photographed by this form, and correcting its bay
    // must not demand a photo shoot — photos on those are welcome, not owed.
    const mandated = String(cur.source ?? "") === "MANUAL_ENTRY";
    const have = await photosForRecord("FinishedSlab", cur.id);
    for (const p of DEFECT_PHOTOS) {
      const has = have.some((x) => String(x.filename ?? "").startsWith(p.prefix));
      const wasProvided = provided.some((x) => x.field === p.field);
      if ((mandated && !has) || wasProvided) {
        const problem = requiredPhotoProblem(fd, p.field, p.label);
        if (problem) return { ok: false, message: problem };
      }
    }

    // Changed fields only, one event each — the admin slab-edit route's shape.
    const data: Record<string, unknown> = {};
    const events: { field: string; oldValue: string | null; newValue: string | null }[] = [];
    for (const [f] of TEXT_FIELDS) {
      const nv = d[f]; const ov = (cur[f] as string | null) ?? null;
      if (nv !== ov) { data[f] = nv; events.push({ field: f, oldValue: ov, newValue: nv }); }
    }
    // Grade compares CANONICALLY, the way QC's own writes land ("C (Reject)"
    // on the row and "C" in the box are the same fact, not a correction).
    if (d.grade !== canonicalGrade(cur.grade)) {
      data.grade = d.grade;
      events.push({ field: "grade", oldValue: cur.grade ?? null, newValue: d.grade });
    }
    for (const f of ["lengthIn", "widthIn"] as const) {
      const nv = d[f]; const ov = (cur[f] as number | null) ?? null;
      if (nv !== ov) { data[f] = nv; events.push({ field: f, oldValue: ov == null ? null : `${ov}"`, newValue: nv == null ? null : `${nv}"` }); }
    }
    const curIssues = Array.isArray(cur.qualityIssue) ? (cur.qualityIssue as string[]) : [];
    if (JSON.stringify(d.qualityIssue) !== JSON.stringify(curIssues)) {
      data.qualityIssue = d.qualityIssue;
      events.push({ field: "qualityIssue", oldValue: curIssues.join("; ") || null, newValue: d.qualityIssue.join("; ") || null });
    }
    if (d.status !== String(cur.status)) {
      data.status = d.status;
      events.push({ field: "status", oldValue: String(cur.status), newValue: d.status });
      // Overriding a RESERVED slab back to AVAILABLE must not leave the hold
      // behind: a stale reservedForPi/customer on an AVAILABLE slab reads as a
      // live hold on the sheet. Same clearing changeSlabStatus's release does,
      // and evented so the release is in the trail too.
      if (d.status === "AVAILABLE" && (cur.reservedForPi || cur.customer || cur.reservedAt)) {
        data.reservedForPi = null; data.customer = null;
        data.reservedAt = null; data.reservationExpiresAt = null;
        events.push({ field: "reservation", oldValue: [cur.reservedForPi, cur.customer].filter(Boolean).join(" · ") || "held", newValue: null });
      }
    }
    if ("batchNumber" in data) data.batchKey = d.batchNumber ? normalizeBatch(d.batchNumber) : null;

    // A photo alone IS a change — adding the missing near photo must not be
    // answered with "nothing changed".
    if (!events.length && provided.length === 0) return { ok: true, message: savedSentence(slabNumber, false, []) };

    if (events.length) {
      await db.finishedSlab.update({ where: { slabNumber }, data });
      for (const e of events)
        await writeSlabEvent(slabNumber, "manual_correction", { field: e.field, oldValue: e.oldValue, newValue: e.newValue, by, source: SOURCE });
    }
    const ph = await storeDefectPhotos(fd, cur.id, slabNumber, by, provided);
    revalidatePath("/inventory");
    // A photo-ONLY save where nothing stored is a failure, plainly: no field
    // changed, no photo landed, so nothing on the server moved — a green "ok"
    // here would send the person away believing the photo is on file.
    if (!events.length && provided.length > 0 && ph.saved.length === 0)
      return { ok: false, message: ph.warning || `Could not store the photo for slab ${slabNumber} — nothing was saved.` };
    const parts: string[] = [];
    if (events.length) parts.push(savedSentence(slabNumber, false, events.map((e) => e.field)));
    if (ph.saved.length) parts.push(`${events.length ? "Attached" : `Slab ${slabNumber}: attached`} the ${ph.saved.join(" and the ")}.`);
    // ok when the FIELD write landed even if a photo failed to store: the
    // re-lookup the form runs on ok shows the slot as still required — same
    // self-healing shape as the create path.
    if (ph.warning) parts.push(ph.warning);
    return { ok: true, message: parts.join(" ") };
  } catch (e) {
    // The reason goes to the server log; the person gets a sentence. A Prisma
    // validation dump means nothing to a line manager and can leak column names.
    console.error("[slab-intake] save failed for", slabNumber, e);
    return { ok: false, message: `Could not save slab ${slabNumber} — nothing was changed. Try again, and tell IT if it repeats.` };
  }
}
