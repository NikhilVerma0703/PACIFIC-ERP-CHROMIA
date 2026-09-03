// Finished-goods slab: the QC autolink + supporting helpers. A FinishedSlab is a
// managed projection of a PolishQc slab (one row per physical slab, keyed by
// slabNumber). QC owns design/grade/thickness/polish/rw/etc; inventory owns
// status/location/PI/notes. See docs/finished-goods-inventory-design.md.
// Uses `prisma as any` (like batchRange.ts / downtimeResponse.ts) so it compiles
// regardless of client regeneration timing.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma, type SlabStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canonicalGrade, slabBlocksDispatch, dispatchCut, SAMPLE_GRADE, CUT_TO_SIZE_GRADE, CUT_GRADES, CUT_MARKS,
  TRANSITIONS, DEFAULT_RESERVATION_DAYS, type StatusAction,
} from "./grading";

export { DEFAULT_RESERVATION_DAYS, type StatusAction } from "./grading";

const db = prisma as any;

/** Append one audit line to fg_slab_event, best-effort (the event log never
 *  blocks the write it describes). Exported for the slab-intake actions, which
 *  log one event per manually corrected field through the same helper the QC
 *  autolink and the lifecycle actions below use — one pattern, not a fork. */
export async function writeSlabEvent(
  slabNumber: number,
  kind: string,
  opts: { field?: string | null; oldValue?: string | null; newValue?: string | null; by?: string | null; source?: string | null } = {}
): Promise<void> {
  try {
    await db.slabEvent.create({
      data: {
        slabNumber,
        kind,
        field: opts.field ?? null,
        oldValue: opts.oldValue ?? null,
        newValue: opts.newValue ?? null,
        changedBy: opts.by ?? null,
        source: opts.source ?? "QC form",
      },
    });
  } catch { /* event log is best-effort */ }
}

/**
 * WHICH STATUSES A QC WRITE MAY RE-PLACE. An ALLOW-list, and it is one because
 * the blacklist it replaces protected nothing at all.
 *
 * That blacklist named RESERVED and PACKED — "committed to a customer or
 * physically loaded" — and both are empty. Counted on live Neon 2026-09-03,
 * fg_finished_slab holds 16,748 AVAILABLE (9,713 with a frame, 10,101 with a
 * bay), 6,536 DISPATCHED (608 framed, 854 bayed), 62 CHROMIA (5 framed) and
 * ZERO rows in RESERVED, PACKED, RETURNED or CTS. So the guard refused nothing
 * on today's data, the 'qc_location_kept' audit event below could never fire,
 * and a grade or bay correction on a DISPATCHED or CHROMIA slab still cleared
 * its frame and wrote the QC row's stale bay back over inventory's — which is
 * the precise failure the guard was added to stop, on the 613 framed slabs it
 * was never going to cover.
 *
 * AVAILABLE — plain stock; QC is what places it, so QC may re-place it.
 * RETURNED  — came back off a lorry; a re-QC there IS the pass that re-places
 *             it, so it stays relocatable (0 rows today, but that is the whole
 *             point of writing the rule from the meaning and not from the counts).
 *
 * Everything else keeps the location inventory is working from: DISPATCHED (it
 * has left), CHROMIA (the printing module holds it), RESERVED/PACKED (committed
 * to a customer), CTS (cutting has it). None of this refuses legitimate work —
 * an EXPLICIT bay passed by the caller (opts.bay) still wins for every status,
 * and the dispatch team's own assignSlabLocation() is untouched by this rule.
 * The only thing withheld is QC's implicit "and put it back where my row says".
 */
const RELOCATABLE_STATUSES = ["AVAILABLE", "RETURNED"] as const;

const barcodeStr = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" ? JSON.stringify(v).slice(0, 200) : null;

/**
 * PRISMA COULD NOT READ OR WRITE fg_finished_slab.slab_mark, AND IT IS THAT —
 * not a database in trouble. Two different failures mean the same thing here
 * and both have to be caught:
 *
 *   * P2022 — the column is not in the database (scripts/0070 unapplied);
 *   * PrismaClientValidationError — the GENERATED CLIENT does not know the
 *     field, i.e. `prisma generate` has not been re-run against the schema that
 *     declares it. searchWhere.ts:61-63 documents that as a real state of a
 *     working copy, not a hypothetical.
 *
 * The message names the field either way, which is why the substring test is
 * here as well as the code test. It is deliberately WIDER than P2022 alone: the
 * client-side failure carries no Prisma code at all.
 *
 * Anything else — a dropped connection, a timeout — is NOT this, and every
 * caller rethrows it, so one bad second cannot quietly latch a process into
 * mark-less behaviour while looking perfectly healthy.
 */
function isMissingMarkColumn(e: any): boolean {
  return e?.code === "P2022" || /slab_mark|slabMark/.test(String(e?.message || ""));
}

/**
 * Upsert the finished-goods record for a slab from its latest QC (PolishQc) row.
 * Call after a PolishQc row is created or edited. QC-owned fields are refreshed;
 * inventory-owned fields (status, PI, customer, notes, reservations) are never
 * touched. Non-integer slab numbers (insert slabs like 144338.1) are flagged,
 * not auto-added — pending the decimal-slab decision.
 *
 * LOCATION (bay + frame) IS NOT AN ORDINARY QC FIELD, and `relocate` is what
 * says so. "Frame clears on each QC pass, dispatch re-assigns it" was written
 * for a real QC pass and is still right for one — but every PolishQc EDIT ran
 * this same function, so fixing a typo in the inspector's name on a months-old
 * QC row cleared the frame of a slab sitting PACKED in F-12 against a proforma
 * invoice and silently wrote the QC row's stale bay back over the bay dispatch
 * had moved it to. The frame clear was at least logged; the bay overwrite was
 * not, so nobody could see why the loading crew could no longer find the slab.
 *
 * So the caller must ASK for the relocation, and only says yes when the QC pass
 * is new or when bay/grade were actually edited (src/app/tables/actions.ts).
 * Callers that pass nothing — the undo restore in actionLog.ts and the fab
 * mirror refresh in fab/slabMarkStore.ts, both of which only want the QC data
 * re-projected — now leave location alone, which is what they always meant.
 * And even when the caller says yes, only a slab whose STATUS still means "QC
 * places this one" is actually moved — see RELOCATABLE_STATUSES below.
 */
export async function autolinkFinishedSlabFromQc(
  slabNumber: number | null | undefined,
  opts: { by?: string | null; bay?: string | null; polishType?: string | null; relocate?: boolean } = {}
): Promise<void> {
  if (slabNumber == null || !Number.isFinite(slabNumber)) return;
  if (!Number.isInteger(slabNumber)) {
    // SlabEvent requires a FinishedSlab row (FK), so this event can't be stored — surface it in logs instead.
    console.warn(`[inventory] non-integer slab ${slabNumber} reached QC — not auto-added (pending decimal-slab decision)`);
    return;
  }

  const qc = await db.polishQc.findFirst({
    where: { slabNumber },
    orderBy: [{ createdTime: "desc" }, { importedAt: "desc" }],
  });
  if (!qc) return;

  const qcFields: Record<string, unknown> = {
    design: qc.design ?? null,
    grade: canonicalGrade(qc.qualityGrade),
    slabThickness: qc.slabThickness ?? null,
    qualityIssue: Array.isArray(qc.qualityIssue) ? qc.qualityIssue : [],
    rwStatus: qc.rwStatus ?? null,
    repolishStatus: qc.repolishStatus ?? null,
    batchNumber: qc.batchNumber ?? null,
    batchKey: qc.batchKey ?? null,
    barcode: barcodeStr(qc.barcode),
    qcInspector: qc.inspector ?? null,
    polishType: qc.polishType ?? null,
    bayNumber: qc.bay ?? null,                 // QC assigns the bay
    lastQcAt: qc.createdTime ?? qc.importedAt ?? new Date(),
    frameNumber: null, // location clears on (re-)QC; dispatch re-assigns it
  };
  if (opts.bay !== undefined) qcFields.bayNumber = opts.bay ?? null;         // explicit override wins
  if (opts.polishType !== undefined) qcFields.polishType = opts.polishType ?? null;

  const existing = await db.finishedSlab.findUnique({ where: { slabNumber }, select: { id: true, frameNumber: true, bayNumber: true, status: true } });
  // A slab that is no longer plain stock is never relocated by a QC write,
  // whatever the caller asked for — that is the case the frame clear actually
  // costs money in, so it is refused here rather than trusted upstream.
  const held = !!existing && !(RELOCATABLE_STATUSES as readonly string[]).includes(existing.status);
  const relocating = !existing || (opts.relocate === true && !held);
  if (existing && !relocating) {
    delete qcFields.frameNumber;                       // whoever put it in a frame knows where it is
    if (opts.bay === undefined) delete qcFields.bayNumber; // an EXPLICIT bay from the caller still wins
  }
  // ─────────────────── AND THE MARK, WHICH IS THE FIELD THIS DID NOT CARRY ───
  //
  // qcFields above projects every QC-owned column except slab_mark, so the
  // `create:` branch minted a FULL_SLAB row even when the polish_qc row it was
  // projecting read slab_mark = 'CTS'. The mark was only ever pushed by
  // slabMarkStore.refreshInventoryMirror, and the three callers that reach this
  // function directly — the /tables editor (app/tables/actions.ts:530), the undo
  // restore (lib/actionLog.ts:104) and the QC create path (actions.ts:732) —
  // never go through it.
  //
  // WHY THAT IS NOW A HOLE AND WAS NOT BEFORE. scripts/0071 and 0072 moved all
  // 63 cut slabs from grade 'CTS' to grade 'B' on the owner's decision, and both
  // are applied. Measured on live Neon 2026-09-03: ZERO rows in polish_qc and
  // ZERO in fg_finished_slab carry a cut GRADE, while 63 fg rows carry
  // slab_mark = 'CTS' (60 AVAILABLE, 2 DISPATCHED, 1 at status CTS).
  // gradeBlocksDispatch therefore refuses nothing against real data: the MARK is
  // the only half of slabBlocksDispatch still standing.
  //
  // So editing a PolishQc row's slab number on one of the 63 used to un-block
  // it. autolink(newNumber) CREATED a row — grade 'B', mark defaulting to
  // FULL_SLAB, status AVAILABLE — and relinkFinishedSlabAfterNumberChange
  // (oldNumber) then DELETED the old one; 42 of the 60 in-stock cut slabs match
  // that delete profile exactly (source QC_AUTOLINK, AVAILABLE, no PI). Before
  // 0071/0072 the same edit carried grade 'CTS' across via canonicalGrade and
  // the slab stayed blocked, so this became a regression the day they ran.
  //
  // ONE WAY ONLY, the same shape refreshInventoryMirror uses and for the same
  // reason: only CTS and SAMPLE are ever written, and only over a mirror that
  // still reads FULL_SLAB. This function may never make a slab dispatchable
  // that was refused a moment ago. dispatchCut with no grade normalises the
  // stored mark exactly as the dispatch rule does ("cts", " Cts " and "CTS" are
  // one slab) and answers null for everything that is not a cut mark.
  //
  // AND SAY SO IF THE QC ROW ARRIVED WITHOUT A MARK FIELD AT ALL. The findFirst
  // above takes no `select`, so it returns every field the GENERATED CLIENT
  // knows. A client built before scripts/0057 simply does not ask for
  // slab_mark, no error is raised, and qc.slabMark is undefined — which is
  // indistinguishable here from a genuinely whole slab. That is the same
  // process asymmetry noteSlabMarkProven exists to close, arriving from the QC
  // side, and it would leave a cut slab mirrored as FULL_SLAB with nothing
  // downstream able to tell.
  if (!("slabMark" in qc)) {
    console.error("[inventory] polish_qc row for slab", slabNumber, "carries no slabMark field — the Prisma client predates scripts/0057; the cut mark is NOT being projected");
  }
  const qcMark = dispatchCut({ mark: qc.slabMark });
  const createFields: Record<string, unknown> = { slabNumber, source: "QC_AUTOLINK", status: "AVAILABLE", ...qcFields };
  // In `create:` ITSELF, not in a follow-up statement: a row that exists for
  // even an instant reading AVAILABLE / FULL_SLAB for an already-cut slab is a
  // row dispatch would let onto a lorry.
  if (qcMark) createFields.slabMark = qcMark;
  try {
    await db.finishedSlab.upsert({
      where: { slabNumber },
      update: qcFields, // inventory-owned fields untouched
      create: createFields,
    });
  } catch (e) {
    // No scripts/0070, or a client that has not been regenerated. The QC write
    // must still land — but LOUDLY, because the row it leaves behind is one the
    // mark cannot protect. Dispatch fails closed on exactly that row
    // (changeSlabStatus below), so this costs a phone call, not a lorry.
    if (!qcMark || !isMissingMarkColumn(e)) throw e;
    console.error("[inventory] slab_mark NOT projected for slab", slabNumber, `— fg row written without its ${qcMark} mark`, e);
    delete createFields.slabMark;
    await db.finishedSlab.upsert({
      where: { slabNumber },
      update: qcFields,
      create: createFields,
    });
  }
  // AND THE UPDATE PATH. `update:` above cannot express "only if it still reads
  // FULL_SLAB", so the one-way rule goes in a WHERE clause instead — which also
  // means it cannot lose a race with a concurrent mark write. Never FULL_SLAB
  // over a stored cut mark: polish_qc and fg_finished_slab have different
  // writers and, when they disagree, the mirror keeps the more restrictive of
  // the two.
  if (qcMark) {
    try {
      await db.finishedSlab.updateMany({
        where: { slabNumber, slabMark: "FULL_SLAB" } as any,
        data: { slabMark: qcMark },
      });
    } catch (e) {
      if (!isMissingMarkColumn(e)) throw e;
      console.error("[inventory] slab_mark NOT mirrored for slab", slabNumber, `— fg row does not carry its ${qcMark} mark`, e);
    }
  }
  if (existing) {
    await writeSlabEvent(slabNumber, "qc_update", { by: opts.by });
    if (existing.frameNumber != null && qcFields.frameNumber === null)
      await writeSlabEvent(slabNumber, "location", { field: "frame", oldValue: existing.frameNumber, newValue: null, by: opts.by, source: "QC form (frame clears on re-QC)" });
    // The bay move is LOGGED now. It always happened silently, so a slab that
    // had been moved and then re-QC'd showed inventory one bay and the audit
    // trail nothing at all — the loading crew's search started from a bay no
    // event ever mentioned.
    if ("bayNumber" in qcFields && (qcFields.bayNumber ?? null) !== (existing.bayNumber ?? null))
      await writeSlabEvent(slabNumber, "location", { field: "bay", oldValue: existing.bayNumber ?? null, newValue: (qcFields.bayNumber as string | null) ?? null, by: opts.by, source: "QC form (bay from this QC pass)" });
    if (held && opts.relocate === true)
      await writeSlabEvent(slabNumber, "qc_location_kept", { field: "location", oldValue: `bay ${existing.bayNumber ?? "—"} / frame ${existing.frameNumber ?? "—"}`, newValue: `unchanged — slab is ${existing.status}`, by: opts.by, source: "QC form" });
  } else {
    await writeSlabEvent(slabNumber, "created", { by: opts.by });
  }
}

/**
 * Call when a PolishQc edit CHANGED the slab number: re-projects the OLD number
 * from whatever QC data remains for it; if none remains, removes the now-phantom
 * auto-linked row (only when it's plain AVAILABLE stock with no PI/reservation —
 * otherwise it's kept and the audit trail records that QC data is gone).
 */
export async function relinkFinishedSlabAfterNumberChange(
  oldSlabNumber: number | null | undefined,
  by?: string | null
): Promise<void> {
  if (oldSlabNumber == null || !Number.isInteger(oldSlabNumber)) return;
  const qc = await db.polishQc.findFirst({ where: { slabNumber: oldSlabNumber }, select: { id: true } });
  if (qc) { await autolinkFinishedSlabFromQc(oldSlabNumber, { by }); return; }
  const fg = await db.finishedSlab.findUnique({ where: { slabNumber: oldSlabNumber } });
  if (!fg) return;
  if (fg.source === "QC_AUTOLINK" && fg.status === "AVAILABLE" && !fg.reservedForPi) {
    await db.$transaction([
      db.slabEvent.deleteMany({ where: { slabNumber: oldSlabNumber } }),
      db.finishedSlab.delete({ where: { slabNumber: oldSlabNumber } }),
    ]);
  } else {
    await writeSlabEvent(oldSlabNumber, "qc_unlinked", { by, newValue: "QC slab number changed; no QC row remains for this slab" });
  }
}

/** Canonical design for a raw design name, via the DesignAlias merge table. */
export async function canonicalDesign(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  const alias = await db.designAlias.findUnique({ where: { variant: raw } }).catch(() => null);
  return alias?.canonical ?? raw;
}

export interface LocationAssignResult { updated: number; missing: number[]; unchanged: number }

/**
 * Dispatch-team location assignment / move: set bay and/or frame on a list of
 * slabs. `undefined` leaves a field untouched; `null` clears it. Every actual
 * change is logged to SlabEvent (old -> new, who, source) — the audit trail.
 */
export async function assignSlabLocation(
  slabNumbers: number[],
  opts: { bay?: string | null; frame?: string | null; by?: string | null; source?: string | null }
): Promise<LocationAssignResult> {
  const res: LocationAssignResult = { updated: 0, missing: [], unchanged: 0 };
  const setBay = opts.bay !== undefined;
  const setFrame = opts.frame !== undefined;
  if (!setBay && !setFrame) return res;
  const src = opts.source ?? "Dispatch";
  for (const sn of slabNumbers) {
    if (!Number.isInteger(sn)) { res.missing.push(sn); continue; }
    const slab = await db.finishedSlab.findUnique({
      where: { slabNumber: sn },
      select: { bayNumber: true, frameNumber: true },
    });
    if (!slab) { res.missing.push(sn); continue; }
    const data: Record<string, unknown> = {};
    if (setBay && (opts.bay ?? null) !== (slab.bayNumber ?? null)) data.bayNumber = opts.bay ?? null;
    if (setFrame && (opts.frame ?? null) !== (slab.frameNumber ?? null)) data.frameNumber = opts.frame ?? null;
    if (Object.keys(data).length === 0) { res.unchanged++; continue; }
    await db.finishedSlab.update({ where: { slabNumber: sn }, data });
    if ("bayNumber" in data)
      await writeSlabEvent(sn, "location", { field: "bay", oldValue: slab.bayNumber ?? null, newValue: opts.bay ?? null, by: opts.by, source: src });
    if ("frameNumber" in data)
      await writeSlabEvent(sn, "location", { field: "frame", oldValue: slab.frameNumber ?? null, newValue: opts.frame ?? null, by: opts.by, source: src });
    res.updated++;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Status lifecycle: AVAILABLE -> RESERVED (PI hold, 7-day expiry) -> PACKED ->
// DISPATCHED -> RETURNED (un-dispatch) -> back to AVAILABLE via release.
// ---------------------------------------------------------------------------

export interface StatusChangeResult {
  updated: number;
  missing: number[];
  skipped: { slab: number; reason: string }[];
}

/**
 * IS fg_finished_slab.slab_mark THERE YET? ONE DETECTOR, AND IT MUST BE PROVEN.
 *
 * The migration that adds the column (scripts/0070) and this code may land in
 * either order, so every read of the mark has to survive its absence.
 *
 * ─────────────────────────── WHY THIS IS A TRI-STATE AND NOT A BOOLEAN ──────
 * It was a boolean latch that started at "not missing" and only ever moved to
 * "missing". Three independent reviewers found the same hole in it, and it is
 * the exact failure this whole change exists to prevent — an already-cut slab
 * leaving on a lorry as a full slab.
 *
 * THE HOLE. There were TWO detectors for one fact. This one was memoised for
 * the life of the process; the fab side (slabMarkStore.refreshInventoryMirror)
 * re-probes with raw SQL on EVERY call. That asymmetry is fatal in one
 * direction: a process that starts before the migration, dispatches once and
 * latches "missing", then sees 0070 applied. The fab side's fresh probe now
 * says the mark is in the mirror, so markQcSlabCts STOPS writing
 * quality_grade = 'CTS' — while this side is still latched to grade-only reads.
 * The next slab is grade 'A', marked CTS, and nothing refuses it.
 *
 * The optimistic START was the second half of the same bug: "not missing" is
 * not the same as "readable", so a permission slip derived from it would be
 * granted before anything had ever proved the column exists.
 *
 * So: READABLE means a read has SUCCEEDED with the column. Nothing else grants
 * it. slabMarkReadable() is what the fab side must ask before it stops writing
 * the grade, and it answers false until proven otherwise.
 *
 * ─────────────────────────── AND IT RECOVERS ────────────────────────────────
 * "missing" is a fact about a moment, not for ever: the migration lands while
 * processes are running. So a missing verdict expires and is re-probed. The
 * memo still does its job — a 500-slab dispatch on an unmigrated database pays
 * one failed query, not 500 — while a long-lived process still picks the column
 * up within RECHECK_MS instead of needing a restart.
 */
type MarkColumnState = "unknown" | "readable" | "missing";
let slabMarkColumn: MarkColumnState = "unknown";
/** When a "missing" verdict stops being trusted. 0 while it is trusted. */
let slabMarkRecheckAt = 0;
const RECHECK_MS = 60_000;

/** Whether a read has PROVEN this database can serve fg_finished_slab.slab_mark.
 *  False while unknown or missing — the safe answer, because the only caller
 *  uses it to decide whether the CTS grade write may stop. */
export function slabMarkReadable(): boolean {
  return slabMarkColumn === "readable";
}

/**
 * PROOF FROM THE OTHER PATH, and without it this whole change does nothing.
 *
 * "readable" could only ever be earned by readSlabForStatusChange — a DISPATCH
 * read. But the process that needs the answer is the FABRICATION one: markQcSlab
 * Cts asks slabMarkReadable() to decide whether it may stop overwriting
 * quality_grade. A serverless invocation that marks a slab cut and never
 * dispatches anything would therefore always be told "not readable", fall to the
 * legacy branch, and destroy the verdict again — exactly the bug this was
 * written to end, surviving its own fix.
 *
 * refreshInventoryMirror is the call that needs the answer, so it is the call
 * that asks for the proof. The two paths then share one state, which is the
 * property the reviewers insisted on: they can never disagree, because there is
 * only one answer.
 *
 * POSITIVE PROOF ONLY. A failure over there is not evidence of absence (a
 * dropped connection looks the same), and the dispatch side's own catch plus the
 * recheck timer already handle a genuinely missing column.
 *
 * ─────────── AND IT PROVES IT THROUGH THE PATH THAT HAS TO DO THE READING ───
 * This used to be granted by the caller's RAW `SELECT slab_mark FROM
 * fg_finished_slab` succeeding. That proves the DATABASE has the column. It is
 * not the fact being granted: "readable" gates whether the GENERATED PRISMA
 * CLIENT can `select: { slabMark: true }` in readSlabForStatusChange and put a
 * slabMark filter in the updateMany guard. Two different facts, and the whole
 * point of the tri-state is that the fab side and the dispatch side can never
 * disagree about one.
 *
 * They could disagree exactly here. A client generated before the column
 * existed — searchWhere.ts:61-63 documents that as the real state of a working
 * copy — makes the raw probe succeed and grant "readable", so markQcSlabCts
 * skips the legacy grade write and the new slab is left grade A / mark CTS. The
 * very next dispatch read then throws PrismaClientValidationError, matches the
 * mark test, latches "missing" — and, before this change, read grade-only and
 * let the slab go. The raw-SQL proof reopened the process asymmetry from the
 * other side.
 *
 * So the proof is taken through the client path itself, with the same select
 * the dispatch side uses. It costs one cheap findFirst on the first call and
 * nothing afterwards.
 */
export async function noteSlabMarkProven(): Promise<void> {
  if (slabMarkColumn === "readable") return;
  try {
    // The same select shape readSlabForStatusChange needs. A table with no rows
    // still proves both halves: Prisma validates the field against the client's
    // own model before sending anything, and Postgres parses the column list
    // whether or not a row comes back.
    await db.finishedSlab.findFirst({ select: { slabMark: true } });
    slabMarkColumn = "readable";
  } catch (e) {
    // NOT latched to "missing": a dropped connection looks the same from here,
    // and the dispatch side's own read is what has standing to record absence.
    // Logged, because a silent "no" here means markQcSlabCts keeps writing
    // quality_grade = 'CTS' over the owner's decided B for as long as it lasts.
    console.error("[inventory] slab_mark not provable through the Prisma client — fabrication will keep the legacy grade write", e);
  }
}

/** The row the lifecycle rules need, with the mark when the database has one. */
async function readSlabForStatusChange(sn: number) {
  const base = { status: true, reservedForPi: true, grade: true } as const;
  const missingIsStale = slabMarkColumn === "missing" && Date.now() >= slabMarkRecheckAt;
  if (slabMarkColumn !== "missing" || missingIsStale) {
    try {
      const row = await db.finishedSlab.findUnique({
        where: { slabNumber: sn },
        select: { ...base, slabMark: true },
      });
      // PROOF, and the only thing that grants it. A missing row proves nothing
      // about the column, so it leaves the state alone.
      if (row) slabMarkColumn = "readable";
      return row;
    } catch (e: any) {
      // THE MARK CANNOT BE READ. Either the column is not in the database
      // (P2022, scripts/0070 unapplied) or the generated client does not know
      // the field (PrismaClientValidationError, no `prisma generate`) — see
      // isMissingMarkColumn. The substring test is what actually fires for the
      // second, which carries no Prisma code at all, so this catch is WIDER
      // than P2022 by design.
      //
      // IT USED TO SAY THIS WAS NOT WORTH FAILING A DISPATCH OVER, BECAUSE
      // "the grade rule below is untouched and still refuses every slab it
      // refuses today". THAT SENTENCE IS FALSE as of scripts/0071 and 0072,
      // which are applied. Measured on live Neon 2026-09-03: 0 rows in
      // polish_qc and 0 in fg_finished_slab carry grade CTS or SAMPLE, so
      // gradeBlocksDispatch refuses NOTHING. Falling back to grade-only reads
      // no longer degrades gracefully — it degrades to nothing, and the 60
      // AVAILABLE slabs that read grade B / mark CTS would all become
      // dispatchable for RECHECK_MS, silently, every 60s for as long as the
      // condition lasted.
      //
      // The fallback therefore still happens — reserve, release, pack and
      // return have no business failing because of a mark column — but
      // changeSlabStatus REFUSES a dispatch it cannot confirm the mark for, and
      // this is logged rather than swallowed. A silent fallback is how this
      // stayed invisible.
      //
      // A dropped connection or a timeout is a DIFFERENT thing and is rethrown.
      // Swallowing it here would put this process into mark-less reads on the
      // strength of one bad second — quietly, since the retry below would then
      // succeed.
      if (!isMissingMarkColumn(e)) throw e;
      console.error("[inventory] fg_finished_slab.slab_mark NOT readable — dispatch will be REFUSED for the next", RECHECK_MS / 1000, "s (slab", sn, ")", e);
      slabMarkColumn = "missing";
      slabMarkRecheckAt = Date.now() + RECHECK_MS;
    }
  }
  return db.finishedSlab.findUnique({ where: { slabNumber: sn }, select: base });
}

/**
 * Apply a lifecycle action to a list of slabs. Invalid transitions are skipped
 * (reported, never forced). Reserve sets PI/customer + expiry (default 7 days;
 * caller enforces that only Admin overrides). Release clears the hold. Every
 * change writes a SlabEvent (old -> new, who, source).
 */
export async function changeSlabStatus(
  slabNumbers: number[],
  action: StatusAction,
  opts: { pi?: string | null; customer?: string | null; expiryDays?: number; by?: string | null; source?: string | null; onlyFrom?: string[] } = {}
): Promise<StatusChangeResult> {
  const res: StatusChangeResult = { updated: 0, missing: [], skipped: [] };
  const t = TRANSITIONS[action];
  if (!t) return res;
  // A caller with its OWN narrower rule than the transition table (the fab CTS
  // hook acts only from AVAILABLE, though the dashboard's cts moves RESERVED
  // and PACKED too) narrows the ALLOWED set — both this validation and the
  // guarded write below — so a status change landing between its read and this
  // write is skipped and reported, never silently consumed. Narrow-only: a
  // status outside t.from stays refused whatever onlyFrom says.
  const from = opts.onlyFrom ? t.from.filter((s) => opts.onlyFrom!.includes(s)) : t.from;
  const src = opts.source ?? "Inventory";
  const days = Number.isFinite(opts.expiryDays) && (opts.expiryDays as number) > 0 ? (opts.expiryDays as number) : DEFAULT_RESERVATION_DAYS;

  for (const sn of slabNumbers) {
    const slab = await readSlabForStatusChange(sn);
    if (!slab) { res.missing.push(sn); continue; }
    if (!from.includes(slab.status)) { res.skipped.push({ slab: sn, reason: `${slab.status} → ${t.to} not allowed` }); continue; }
    // A slab that has been cut is not shipping as a full slab, whatever its
    // status says. Checked here rather than in TRANSITIONS because that table is
    // keyed by status alone; this is the second, independent signal.
    //
    // ─────────────── NO MARK, NO DISPATCH. THE OR HAS ONE LEG LEFT ──────────
    // slabBlocksDispatch ORs the mark and the grade, and the OR was written that
    // way so that during the changeover BOTH signals were live and the rule
    // could only ever refuse MORE. The GRADE leg is now gone. scripts/0071 and
    // 0072 moved all 63 cut slabs from grade 'CTS' to grade 'B' on the owner's
    // decision and both are applied; measured on live Neon 2026-09-03, ZERO rows
    // in polish_qc and ZERO in fg_finished_slab carry grade CTS or SAMPLE, so
    // gradeBlocksDispatch is dead code against real data. What refuses the 60
    // AVAILABLE cut slabs in stock — 42 QC_AUTOLINK + 18 BULK_UPLOAD, every one
    // of them grade 'B', mark 'CTS' — is the MARK, and nothing else.
    //
    // So a read that could not confirm the mark is not "degraded", it is BLIND,
    // and a blind dispatch is the failure this whole change exists to prevent.
    // `slab.slabMark` is a string on every row of a database that has the column
    // (NOT NULL DEFAULT 'FULL_SLAB', scripts/0070) and is absent exactly when
    // readSlabForStatusChange fell back to the mark-less select. That is
    // per-slab evidence rather than a global flag, so a concurrent caller
    // flipping the detector cannot open a window here.
    //
    // FAIL CLOSED. Refusing a dispatch that should have been allowed costs
    // somebody a phone call; allowing one that should have been refused puts
    // already-cut stone on a customer's lorry and the customer finds out. Every
    // other action — reserve, release, pack, return — carries on untouched,
    // which is why this is inside `action === "dispatch"`.
    if (action === "dispatch" && typeof (slab as { slabMark?: unknown }).slabMark !== "string") {
      res.skipped.push({
        slab: sn,
        reason: "cannot verify slab mark — dispatch refused until fg_finished_slab.slab_mark can be read",
      });
      continue;
    }
    // BOTH SIGNALS, OR'd (slabBlocksDispatch). The MARK is the real one — the
    // owner: "grade should be A/B/C like normal, and the MARK is CTS or
    // sampling" — and after 0071/0072 it is the only one with anything left to
    // refuse. The GRADE half is kept because it costs nothing and it is what
    // would still refuse a row if a routing state ever found its way back into
    // quality_grade — which scripts/0072's closing note names as the standing
    // regression signal for this incident.
    if (action === "dispatch" && slabBlocksDispatch({ grade: slab.grade, mark: slab.slabMark })) {
      // WHICH WAY IT WAS CUT, in the message. "Cut to size" and "cut down for
      // samples" send an inventory user to two different people to ask why, and
      // a single wording would send half of them to the wrong one.
      const cutAs = dispatchCut({ grade: slab.grade, mark: slab.slabMark });
      res.skipped.push({
        slab: sn,
        reason: cutAs === SAMPLE_GRADE
          ? `cut down for samples — not dispatchable as a full slab`
          : `marked ${CUT_TO_SIZE_GRADE} — cut to size, not dispatchable as a full slab`,
      });
      continue;
    }

    const data: Record<string, unknown> = { status: t.to };
    if (action === "reserve") {
      data.reservedForPi = opts.pi ?? null;
      data.customer = opts.customer ?? null;
      data.reservedAt = new Date();
      data.reservationExpiresAt = new Date(Date.now() + days * 86400000);
    }
    if (action === "release") {
      data.reservedForPi = null; data.customer = null;
      data.reservedAt = null; data.reservationExpiresAt = null;
    }
    if (action === "dispatch" && opts.pi !== undefined && opts.pi !== null) data.reservedForPi = opts.pi;
    if (action === "dispatch" && opts.customer !== undefined && opts.customer !== null) data.customer = opts.customer;
    if (action === "dispatch") { data.reservationExpiresAt = null; }

    // guarded write: only flips if the status is still one we validated against
    // (a concurrent action loses the race and is reported as skipped).
    // Guarded write: only flips if the status is STILL one we validated against, and
    // — for a dispatch — the grade has not become CTS since the read. The OR spells the
    // null case out rather than relying on `not`, which compares as NULL in SQL and
    // would silently refuse every ungraded slab.
    // Typed as the real Prisma input, NOT Record<string, unknown>: the compiler is
    // the only thing that checks this filter's shape, and a where-clause that is
    // merely plausible fails at runtime on every dispatch rather than at build.
    // The cast is the one honest looseness here: TRANSITIONS lives in grading.ts,
    // which imports nothing so `node --test` can reach it, and therefore cannot name
    // the Prisma SlabStatus enum. Its `from` values ARE that enum's members. Casting
    // just that array keeps the compiler checking the REST of the clause — which it
    // was not doing at all while this was Record<string, unknown>.
    const guard: Prisma.FinishedSlabWhereInput = {
      slabNumber: sn,
      status: { in: from as SlabStatus[] },
    };
    if (action === "dispatch") {
      // BOTH cut states, or the race this guard exists to lose stays open for
      // one of them: a slab pushed to sampling between the read above and this
      // write would still go out whole.
      guard.OR = [
        { grade: null },
        { AND: CUT_GRADES.map(g => ({ NOT: { grade: { equals: g, mode: "insensitive" as const } } })) },
      ];
      // AND THE MARK, once the database has one. The race this guard loses is
      // the same one, moved: after fabrication stops writing quality_grade =
      // 'CTS', a slab cut between the read above and this write changes ONLY
      // its mark, and the grade clause would not notice it.
      //
      // UNCONDITIONAL NOW, and that is the fix. It used to be gated on
      // slabMarkReadable(), a PROCESS-WIDE flag that another caller's failed
      // read could flip to "missing" between the read above and this write —
      // and the clause simply vanished from the guard when it did. That was
      // safe only while the grade clause above covered the same slabs, which
      // scripts/0071 and 0072 ended: with every cut slab regraded to 'B', a
      // guard without this clause guards nothing.
      //
      // We only reach this line for a dispatch after proving, ON THIS SLAB,
      // that the mark came back as a string — so the column and the client both
      // have it. If it disappears in the microseconds between, the updateMany
      // raises P2022 and the dispatch FAILS rather than silently succeeding,
      // which is the direction this incident says to fail in.
      //
      // `as any` on this one clause: the generated client in node_modules may
      // predate the schema edit that declares slabMark, and this must typecheck
      // without a `prisma generate` having been run first. The rest of the
      // clause stays typed, which is the point of Prisma.FinishedSlabWhereInput
      // being named above at all.
      //
      // No `{ slabMark: null }` branch, unlike the grade clause above: the
      // column is NOT NULL DEFAULT 'FULL_SLAB' (scripts/0070), so there is no
      // NULL for `NOT` to compare against and swallow.
      guard.AND = CUT_MARKS.map(m => ({ NOT: { slabMark: { equals: m, mode: "insensitive" as const } } })) as any;
    }
    const n = await db.finishedSlab.updateMany({ where: guard, data });
    if (n.count === 0) { res.skipped.push({ slab: sn, reason: "changed concurrently — retry" }); continue; }
    const effectivePi = opts.pi ?? slab.reservedForPi;
    const detail =
      action === "reserve" ? [opts.pi ? `PI ${opts.pi}` : null, opts.customer, `${days}d hold`].filter(Boolean).join(" · ")
      : action === "dispatch" ? ([effectivePi ? `PI ${effectivePi}` : null, opts.customer].filter(Boolean).join(" · ") || null)
      : null;
    await writeSlabEvent(sn, action, { field: "status", oldValue: slab.status, newValue: t.to + (detail ? ` (${detail})` : ""), by: opts.by, source: src });
    res.updated++;
  }
  return res;
}

/**
 * Lazy reservation-expiry sweep: any RESERVED slab whose hold has lapsed goes
 * back to AVAILABLE (hold cleared, event logged). Called best-effort from the
 * inventory read APIs, so expired holds never show as reserved.
 *
 * SINGLE-FLIGHT: the dashboard fires the kpi and list APIs together on every
 * mount, and each called this WRITE independently — two sweeps per load
 * (measured 2026-08-14). When both land on the same instance the second call
 * now awaits the first's promise instead of re-running the scan. Semantics are
 * unchanged: every read still waits for a completed sweep before reporting, and
 * the per-row guards below already made concurrent sweeps safe — this only
 * stops paying twice for the same pass.
 */
let _sweepInFlight: Promise<number> | null = null;
export function sweepExpiredReservations(): Promise<number> {
  if (_sweepInFlight) return _sweepInFlight;
  _sweepInFlight = _sweep().finally(() => { _sweepInFlight = null; });
  return _sweepInFlight;
}
async function _sweep(): Promise<number> {
  try {
    const now = new Date();
    const lapsed: { slabNumber: number; reservedForPi: string | null }[] = await db.finishedSlab.findMany({
      where: { status: "RESERVED", reservationExpiresAt: { lt: now } },
      select: { slabNumber: true, reservedForPi: true },
      take: 500,
    });
    if (lapsed.length === 0) return 0;
    let released = 0;
    for (const l of lapsed) {
      // guarded per-row: re-checks status AND expiry, so a re-reserved slab
      // (fresh hold) is untouched and concurrent sweeps can't double-log.
      const n = await db.finishedSlab.updateMany({
        where: { slabNumber: l.slabNumber, status: "RESERVED", reservationExpiresAt: { lt: now } },
        data: { status: "AVAILABLE", reservedForPi: null, customer: null, reservedAt: null, reservationExpiresAt: null },
      });
      if (n.count === 1) {
        released++;
        await writeSlabEvent(l.slabNumber, "reservation_expired", {
          field: "status", oldValue: "RESERVED",
          newValue: `AVAILABLE (hold${l.reservedForPi ? ` PI ${l.reservedForPi}` : ""} lapsed)`,
          source: "Auto-expiry",
        });
      }
    }
    return released;
  } catch { return 0; }
}
