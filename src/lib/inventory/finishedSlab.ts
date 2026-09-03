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
  await db.finishedSlab.upsert({
    where: { slabNumber },
    update: qcFields, // inventory-owned fields untouched
    create: { slabNumber, source: "QC_AUTOLINK", status: "AVAILABLE", ...qcFields },
  });
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
 * refreshInventoryMirror already SELECTs slab_mark straight out of
 * fg_finished_slab. If that returns at all, the column exists — the same fact,
 * proven by a different query. So it reports it here and the two paths share one
 * state, which is the property the reviewers insisted on: they can never
 * disagree, because there is only one answer.
 *
 * POSITIVE PROOF ONLY. A failure over there is not evidence of absence (a
 * dropped connection looks the same), and the dispatch side's own catch plus the
 * recheck timer already handle a genuinely missing column.
 */
export function noteSlabMarkProven(): void {
  slabMarkColumn = "readable";
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
      // ONLY a missing column, and nothing else. Prisma raises P2022 for one
      // ("The column `X` does not exist in the current database"), and that is
      // not an error worth failing a dispatch over: the grade rule below is
      // untouched and still refuses every slab it refuses today.
      //
      // A dropped connection or a timeout is a DIFFERENT thing and is rethrown.
      // Swallowing it here would put this process into grade-only reads on the
      // strength of one bad second — quietly, since the retry below would then
      // succeed.
      const msg = String(e?.message || "");
      if (e?.code !== "P2022" && !/slab_mark|slabMark/.test(msg)) throw e;
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
    // BOTH SIGNALS, OR'd (slabBlocksDispatch). The MARK is the real one — the
    // owner: "grade should be A/B/C like normal, and the MARK is CTS or
    // sampling" — but the GRADE stays read for as long as anything writes it:
    //   * the 62 rows measured on live Neon on 2026-09-03 that read grade CTS
    //     (60 in stock, 2 already dispatched) are every slab this block refuses
    //     at all, and the owner is still collecting their real A/B/C verdicts by
    //     hand, so their grade is left exactly as it is;
    //   * `slab.slabMark` is undefined on a database that has not had
    //     scripts/0070 yet (see readSlabForStatusChange), and on that database
    //     the grade half is the ONLY thing between an already-cut slab and a
    //     lorry.
    // Dropping the grade half before the mark is everywhere would silently
    // un-block dispatch for every slab fabrication cuts. The OR can only ever
    // refuse more, never less, which is the only safe direction here.
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
      // ONLY when the column is known to be there. A filter on a column that
      // does not exist is not a refusal — it is a P2022 that fails the whole
      // updateMany, so an unmigrated database would stop dispatching anything
      // at all. readSlabForStatusChange has already run for this slab, so the
      // flag is settled by the time we get here.
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
      if (slabMarkReadable()) {
        guard.AND = CUT_MARKS.map(m => ({ NOT: { slabMark: { equals: m, mode: "insensitive" as const } } })) as any;
      }
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
