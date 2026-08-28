// WRITING A SLAB'S MARK — the one place polish_qc.slab_mark is set.
//
// The rule it enforces is slabMark.ts's checkMarkTransition, expressed in a
// WHERE clause rather than in JavaScript:
//
//     only a FULL_SLAB moves.
//
// Doing it in SQL matters. A read-then-write would let two tablets — the
// fabrication supervisor picking the slab and the sampling incharge adding
// offcuts off the same stone — both read FULL_SLAB and both write, and the
// second would silently overwrite the first. The guard is in the statement, so
// the loser updates nothing and finds out.
//
// IDEMPOTENT: marking a CTS slab CTS again updates no row and is not an error.
// markQcSlabCts runs every time a supervisor re-picks the same slab.
//
// ─────────────────────────────── A DATABASE WITHOUT scripts/0057 ────────────
// The column is new. Until 0057 is applied every write here fails with 42703,
// and that must NOT take down the action the user was performing — a supervisor
// picking a slab, an incharge adding sample stock. So a missing column comes
// back as { ok: true, changed: false, applied: false } and the caller carries
// on. The screens still read correctly meanwhile: slabMarkOf() falls back to
// the legacy quality_grade = 'CTS' signal.
//
// This module DOES import prisma, so it is not unit-testable and deliberately
// holds no logic worth testing — the rules live in slabMark.ts, which imports
// nothing and is covered by tests/fabSlabMark.test.ts.

import { prisma } from "@/lib/prisma";
import { SLAB_MARKS, SLAB_MARK_LABEL, type SlabMark } from "@/lib/fab/slabMark";
import { autolinkFinishedSlabFromQc } from "@/lib/inventory/finishedSlab";

export type SlabMarkWrite =
  /** The slab now carries `mark`. `changed` is false when it already did
   *  (idempotent) or when the column does not exist yet (`applied` false). */
  | { ok: true; changed: boolean; applied: boolean }
  /** Refused: the slab is already cut, and a slab is cut once. `current` is
   *  what it actually is, so the caller can say so. */
  | { ok: false; reason: string; current: SlabMark | null };

/** 42703 undefined_column / 42P01 undefined_table — scripts/0057 not applied.
 *  Any other failure is a real one and is rethrown. */
function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  const pg = String(e?.meta?.code ?? "");
  if (pg === "42703" || pg === "42P01") return true;
  const msg = String(e?.message ?? err ?? "");
  return /42703|42P01/.test(msg) || /column .*slab_mark.* does not exist/i.test(msg);
}

/**
 * Move a slab to `mark`, if it is allowed to move.
 *
 * Returns ok:false only for a REFUSED transition — a slab already CTS being
 * pushed to sampling, or vice versa. That is a real state of the world, not a
 * failure of the system, and the caller decides whether it is worth telling
 * anybody about (fabrication does not; it is normal for offcuts of an
 * already-cut slab to reach the sample shelf).
 */
export async function setSlabMark(pacificQcId: string, mark: SlabMark): Promise<SlabMarkWrite> {
  if (!pacificQcId) return { ok: true, changed: false, applied: false };
  if (!(SLAB_MARKS as readonly string[]).includes(mark)) {
    return { ok: false, reason: `"${mark}" is not a slab mark.`, current: null };
  }

  let updated = 0;
  try {
    // THE WHOLE RULE, in the WHERE. A row already carrying this mark is not
    // touched — that is the idempotent case, and it is indistinguishable here
    // from a refusal, which is why the 0-row path reads the row back below.
    //
    // The legacy check is not redundant with slab_mark = 'FULL_SLAB': 0057
    // backfills CTS from quality_grade, but a slab marked CTS between the
    // column being added and the backfill running would still read FULL_SLAB.
    updated = await prisma.$executeRaw`
      UPDATE polish_qc
      SET    slab_mark = ${mark}
      WHERE  id = ${pacificQcId}
        AND  coalesce(slab_mark, 'FULL_SLAB') = 'FULL_SLAB'
        AND  upper(btrim(coalesce(quality_grade, ''))) <> 'CTS'
    `;
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    // No column yet. The action that called this still stands.
    return { ok: true, changed: false, applied: false };
  }

  if (updated > 0) return { ok: true, changed: true, applied: true };

  // Nothing moved. Either it was already there (fine) or it is already cut the
  // other way (refused). One read tells us which, and only on this path.
  let current: SlabMark | null = null;
  try {
    const rows = await prisma.$queryRaw<Array<{ slab_mark: string | null; quality_grade: string | null }>>`
      SELECT slab_mark, quality_grade FROM polish_qc WHERE id = ${pacificQcId}
    `;
    const row = rows?.[0];
    if (!row) {
      return { ok: false, reason: "That slab is no longer in QC.", current: null };
    }
    const stored = String(row.slab_mark ?? "").trim().toUpperCase();
    const legacyCts = String(row.quality_grade ?? "").trim().toUpperCase() === "CTS";
    current = (SLAB_MARKS as readonly string[]).includes(stored)
      ? (stored as SlabMark)
      : legacyCts ? "CTS" : "FULL_SLAB";
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    return { ok: true, changed: false, applied: false };
  }

  if (current === mark) return { ok: true, changed: false, applied: true };

  return {
    ok: false,
    current,
    reason:
      `This slab is already marked ${SLAB_MARK_LABEL[current]}, so it cannot become ` +
      `${SLAB_MARK_LABEL[mark]}. A slab is cut once — for an order or for samples — ` +
      `and it is not whole again afterwards.`,
  };
}

/**
 * PUSH THE CHANGE INTO INVENTORY'S MIRROR — the step that was missing.
 *
 * finished_slab is a MIRROR of the latest polish_qc row for a slab number, and
 * inventory's dispatch rule reads finished_slab.grade, not polish_qc. The mirror
 * is only ever refreshed by autolinkFinishedSlabFromQc, which nothing on the
 * fabrication side was calling.
 *
 * So the CTS dispatch block has not actually been firing: a supervisor picking a
 * slab set polish_qc.quality_grade = 'CTS' and inventory carried on showing the
 * old A/B/C, which is the exact failure gradeBlocksDispatch was written to
 * prevent — "which is how already-cut slabs left as full slabs". It only ever
 * worked when QC itself typed CTS, because that path re-saves the QC row and
 * refreshes the mirror on the way.
 *
 * BEST-EFFORT, like every other call site of it. A mirror that is briefly stale
 * is a bad afternoon; a supervisor who cannot pick a slab because inventory is
 * having one is a stopped shop floor. The next QC save refreshes it regardless.
 *
 * Reads the slab NUMBER rather than taking one, so callers cannot pass the wrong
 * slab's. Non-integer slab numbers (insert slabs like 144338.1) are refused by
 * autolink itself and simply do nothing here.
 */
export async function refreshInventoryMirror(pacificQcId: string): Promise<void> {
  if (!pacificQcId) return;
  try {
    const qc = await prisma.polishQc.findUnique({
      where: { id: pacificQcId },
      select: { slabNumber: true },
    });
    if (qc?.slabNumber == null) return;
    await autolinkFinishedSlabFromQc(qc.slabNumber, { by: "fabrication" });
  } catch (err) {
    console.error("[slabMarkStore] inventory mirror not refreshed for qc", pacificQcId, err);
  }
}
