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
import {
  parseSlabNumber, cleanText, cleanIssues, validateSlabDetails, savedSentence,
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

export type LookupRes =
  | { ok: false; message: string }
  | { ok: true; exists: true; message: string; slab: SlabCurrent; qc: QcReference | null }
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

/**
 * Save: create the missing row (source MANUAL_ENTRY) or update ONLY the fields
 * that actually changed on the existing one — one SlabEvent per changed field
 * (kind "manual_correction", source "Slab intake form", changedBy the session
 * name), so the audit trail reads like what happened.
 */
export async function saveSlab(input: {
  slabNumber: string;
  expectExisting: boolean;
  details: SlabDetailsInput;
}): Promise<SaveRes> {
  const g = await slabIntakeGate();
  if (!g.ok) return { ok: false, message: NOT_YOURS };
  const parsed = parseSlabNumber(input?.slabNumber);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const slabNumber = parsed.slab;

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
    bayNumber: cleanText(raw.bayNumber, 30),
    frameNumber: cleanText(raw.frameNumber, 60),
    status: String(raw.status ?? "AVAILABLE").trim().toUpperCase(),
    notes: cleanText(raw.notes, 900),
  };
  const bad = validateSlabDetails(d);
  if (bad) return { ok: false, message: bad };

  const by: string | null = (g.user as any)?.name ?? (g.user as any)?.email ?? null;
  const SOURCE = "Slab intake form";

  try {
    const cur = await db.finishedSlab.findUnique({ where: { slabNumber } });

    if (!cur) {
      if (input.expectExisting)
        return { ok: false, message: `Slab ${slabNumber} is no longer in finished goods — look it up again before saving.` };
      await db.finishedSlab.create({
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
      revalidatePath("/inventory");
      return { ok: true, message: savedSentence(slabNumber, true, []) };
    }

    if (!input.expectExisting)
      return { ok: false, message: `Slab ${slabNumber} was added by someone else while you were typing — look it up again to see its current details.` };

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

    if (!events.length) return { ok: true, message: savedSentence(slabNumber, false, []) };

    await db.finishedSlab.update({ where: { slabNumber }, data });
    for (const e of events)
      await writeSlabEvent(slabNumber, "manual_correction", { field: e.field, oldValue: e.oldValue, newValue: e.newValue, by, source: SOURCE });
    revalidatePath("/inventory");
    return { ok: true, message: savedSentence(slabNumber, false, events.map((e) => e.field)) };
  } catch (e) {
    // The reason goes to the server log; the person gets a sentence. A Prisma
    // validation dump means nothing to a line manager and can leak column names.
    console.error("[slab-intake] save failed for", slabNumber, e);
    return { ok: false, message: `Could not save slab ${slabNumber} — nothing was changed. Try again, and tell IT if it repeats.` };
  }
}
