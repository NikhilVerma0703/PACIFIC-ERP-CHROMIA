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
  canonicalGrade, gradeBlocksDispatch, CUT_TO_SIZE_GRADE, SAMPLE_GRADE, CUT_GRADES, TRANSITIONS,
  DEFAULT_RESERVATION_DAYS, type StatusAction,
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

const barcodeStr = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" ? JSON.stringify(v).slice(0, 200) : null;

/**
 * Upsert the finished-goods record for a slab from its latest QC (PolishQc) row.
 * Call after a PolishQc row is created or edited. QC-owned fields are refreshed;
 * inventory-owned fields (status, PI, customer, notes, reservations) are never
 * touched. Frame clears on each QC pass (dispatch re-assigns it). Non-integer
 * slab numbers (insert slabs like 144338.1) are flagged, not auto-added — pending
 * the decimal-slab decision.
 */
export async function autolinkFinishedSlabFromQc(
  slabNumber: number | null | undefined,
  opts: { by?: string | null; bay?: string | null; polishType?: string | null } = {}
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

  const existing = await db.finishedSlab.findUnique({ where: { slabNumber }, select: { id: true, frameNumber: true } });
  await db.finishedSlab.upsert({
    where: { slabNumber },
    update: qcFields, // inventory-owned fields untouched
    create: { slabNumber, source: "QC_AUTOLINK", status: "AVAILABLE", ...qcFields },
  });
  if (existing) {
    await writeSlabEvent(slabNumber, "qc_update", { by: opts.by });
    if (existing.frameNumber != null && qcFields.frameNumber === null)
      await writeSlabEvent(slabNumber, "location", { field: "frame", oldValue: existing.frameNumber, newValue: null, by: opts.by, source: "QC form (frame clears on re-QC)" });
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
    const slab = await db.finishedSlab.findUnique({
      where: { slabNumber: sn },
      select: { status: true, reservedForPi: true, grade: true },
    });
    if (!slab) { res.missing.push(sn); continue; }
    if (!from.includes(slab.status)) { res.skipped.push({ slab: sn, reason: `${slab.status} → ${t.to} not allowed` }); continue; }
    // A slab QC graded cut-to-size is not shipping as a full slab, whatever its
    // status says. Checked here rather than in TRANSITIONS because that table is
    // keyed by status alone; this is the second, independent signal.
    if (action === "dispatch" && gradeBlocksDispatch(slab.grade)) {
      // WHICH WAY IT WAS CUT, in the message. "Cut to size" and "cut down for
      // samples" send an inventory user to two different people to ask why, and
      // a single wording would send half of them to the wrong one.
      const cutAs = String(canonicalGrade(slab.grade) ?? "").toUpperCase();
      res.skipped.push({
        slab: sn,
        reason: cutAs === SAMPLE_GRADE
          ? `cut down for samples — not dispatchable as a full slab`
          : `graded ${CUT_TO_SIZE_GRADE} — cut to size, not dispatchable as a full slab`,
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
