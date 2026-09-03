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
import { SLAB_MARKS, SLAB_MARK_LABEL, parseSlabMark, type SlabMark } from "@/lib/fab/slabMark";
import { autolinkFinishedSlabFromQc, slabMarkReadable, noteSlabMarkProven } from "@/lib/inventory/finishedSlab";

export type SlabMarkWrite =
  /** The slab now carries `mark`. `changed` is false when it already did
   *  (idempotent) or when the column does not exist yet (`applied` false). */
  | { ok: true; changed: boolean; applied: boolean }
  /** Refused: the slab is already cut, and a slab is cut once. `current` is
   *  what it actually is, so the caller can say so. */
  | { ok: false; reason: string; current: SlabMark | null };

/** 42703 undefined_column / 42P01 undefined_table — scripts/0057 not applied
 *  (polish_qc.slab_mark), or scripts/0070 not applied (fg_finished_slab
 *  .slab_mark). Any other failure is a real one and is rethrown.
 *
 *  Verified against live Neon on 2026-09-03: a raw SELECT of a column that is
 *  not there comes back as `PrismaClientKnownRequestError ... Raw query failed.
 *  Code: 42703. Message: column "slab_mark" does not exist`, so the message
 *  test below is the one that actually fires — the meta.code test is kept for
 *  the driver shapes that populate it. */
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
 * WHAT THE MIRROR ACTUALLY ENDED UP HOLDING.
 *
 * `markInMirror` is the PERMISSION SLIP for dropping the legacy grade write —
 * see markQcSlabCts.ts. It is true only when fg_finished_slab, the row that
 * lib/inventory/changeSlabStatus reads at dispatch time, demonstrably carries a
 * CUT mark for THIS slab right now. It is READ BACK from the table, never
 * inferred from the fact that the UPDATE above did not throw, because the whole
 * point of it is to be trustworthy in a deploy where the migration has not
 * landed yet.
 */
export type MirrorRefresh = {
  /** fg_finished_slab.slab_mark for this slab reads CTS or SAMPLE, verified by
   *  reading the row back. False for every reason it could fail: no scripts
   *  /0070 column, no finished-goods row, a non-integer slab number, a database
   *  having a bad minute. Callers must treat false as "the mark cannot block
   *  dispatch, so the legacy grade still has to". */
  markInMirror: boolean;
};

/**
 * PUSH THE CHANGE INTO INVENTORY'S MIRROR — the step that was missing.
 *
 * finished_slab is a MIRROR of the latest polish_qc row for a slab number, and
 * inventory's dispatch rule reads finished_slab, not polish_qc. The mirror
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
 * ─────────────────────────────────── AND NOW IT CARRIES THE MARK ────────────
 * autolinkFinishedSlabFromQc projects the QC row's DATA — design, grade, bay,
 * thickness — and it does not know about marks. So the mark is pushed here, in
 * a second statement, right after the autolink: the autolink's upsert may have
 * CREATED the finished-goods row (create: { ... } with no slab_mark, i.e. the
 * column default FULL_SLAB), and a mark written before that would be lost.
 *
 * ONLY EVER TOWARDS "CUT", NEVER BACK. Two guards, both deliberate:
 *
 *   * only CTS and SAMPLE are pushed — a FULL_SLAB mark is never written over
 *     anything, and
 *   * the WHERE requires the mirror to still read FULL_SLAB.
 *
 * Both exist so this function cannot make a slab dispatchable that was refused
 * a moment ago. polish_qc and fg_finished_slab have different writers and can
 * disagree (the /tables editor writes one, the slab-intake form the other); if
 * they do, the mirror keeps the more restrictive of the two. That is the same
 * one-way rule setSlabMark enforces on polish_qc — a slab is cut once.
 *
 * BEST-EFFORT, like every other call site of it. A mirror that is briefly stale
 * is a bad afternoon; a supervisor who cannot pick a slab because inventory is
 * having one is a stopped shop floor. The next QC save refreshes it regardless.
 * Every swallowed failure is LOGGED — see the note on markQcSlabCts's own
 * catch: a silent fallback here is how quality_grade_before_cts stayed NULL on
 * all 48,377 rows for a fortnight without anyone noticing.
 *
 * Reads the slab NUMBER rather than taking one, so callers cannot pass the wrong
 * slab's. Non-integer slab numbers (insert slabs like 144338.1) are refused by
 * autolink itself and report markInMirror:false here — the conservative answer,
 * which keeps the grade write for exactly those slabs.
 */
export async function refreshInventoryMirror(pacificQcId: string): Promise<MirrorRefresh> {
  const NO_MARK: MirrorRefresh = { markInMirror: false };
  if (!pacificQcId) return NO_MARK;

  // The QC row's number AND its mark, in one read. Raw rather than
  // prisma.polishQc.findUnique({ select: { slabMark: true } }) because a
  // database without scripts/0057 has no slab_mark column and the select would
  // throw where the fallback below still gets the number.
  let slabNumber: number | null = null;
  let mark: SlabMark | null = null;
  try {
    const rows = await prisma.$queryRaw<Array<{ slab_number: number | null; slab_mark: string | null }>>`
      SELECT slab_number, slab_mark FROM polish_qc WHERE id = ${pacificQcId}
    `;
    const row = rows?.[0];
    if (!row) return NO_MARK;
    slabNumber = row.slab_number ?? null;
    mark = parseSlabMark(row.slab_mark);
  } catch (err) {
    if (!isMissingColumn(err)) {
      console.error("[slabMarkStore] qc row not read for mirror refresh", pacificQcId, err);
      return NO_MARK;
    }
    // No 0057. There is no mark to propagate, but the DATA refresh below is
    // still worth doing — it is the pre-existing behaviour of this function.
    try {
      const qc = await prisma.polishQc.findUnique({ where: { id: pacificQcId }, select: { slabNumber: true } });
      slabNumber = qc?.slabNumber ?? null;
    } catch (e2) {
      console.error("[slabMarkStore] qc row not read for mirror refresh", pacificQcId, e2);
      return NO_MARK;
    }
  }

  if (slabNumber == null || !Number.isInteger(slabNumber)) return NO_MARK;

  try {
    await autolinkFinishedSlabFromQc(slabNumber, { by: "fabrication" });
  } catch (err) {
    console.error("[slabMarkStore] inventory mirror not refreshed for qc", pacificQcId, err);
  }

  if (mark === "CTS" || mark === "SAMPLE") {
    try {
      await prisma.$executeRaw`
        UPDATE fg_finished_slab
        SET    slab_mark = ${mark}
        WHERE  slab_number = ${slabNumber}
          AND  coalesce(slab_mark, 'FULL_SLAB') = 'FULL_SLAB'
      `;
    } catch (err) {
      if (!isMissingColumn(err)) {
        console.error("[slabMarkStore] mark not mirrored to finished goods for slab", slabNumber, err);
      }
      // A missing column is scripts/0070 not applied yet. Not an error, and not
      // a reason to fail the supervisor's action — but it IS the reason the
      // read-back below will say markInMirror:false and the caller will keep
      // writing quality_grade = 'CTS'. That is the whole either-deploy-order
      // property: no column, no permission slip, no behaviour change.
    }
  }

  // READ IT BACK. The caller decides whether to stop blocking dispatch on the
  // grade using this answer, so it must describe the database as it IS, not as
  // the statement above hoped to leave it. A row that was already marked (the
  // idempotent re-pick, or the migration's backfill) answers true here even
  // though the UPDATE changed nothing, which is correct: the mark is there.
  try {
    const rows = await prisma.$queryRaw<Array<{ slab_mark: string | null }>>`
      SELECT slab_mark FROM fg_finished_slab WHERE slab_number = ${slabNumber}
    `;
    // THE QUERY CAME BACK, SO THE COLUMN IS THERE. Tell the one detector, or
    // the dispatch side never learns it from a fabrication-only invocation and
    // the grade write below never stops. See noteSlabMarkProven.
    noteSlabMarkProven();
    const stored = parseSlabMark(rows?.[0]?.slab_mark);
    // AND THE DISPATCH SIDE MUST AGREE IT CAN READ IT.
    //
    // This raw SELECT is re-run on every call, so it flips the moment
    // scripts/0070 is applied. changeSlabStatus's detector is memoised. That
    // asymmetry is fatal in exactly one direction, and it is the direction that
    // puts an already-cut slab on a lorry: a process that started before the
    // migration and has already latched "no mark column" keeps reading
    // grade-only, while this fresh probe would tell markQcSlabCts it may stop
    // writing quality_grade = 'CTS'. The next slab is then grade 'A', marked
    // CTS, and nothing refuses it.
    //
    // So the permission slip is the AND of both: the mark is in the mirror, and
    // the code that enforces the dispatch block has PROVEN it can read it.
    // slabMarkReadable() answers false until a read has actually succeeded, so
    // the pair can never disagree in the unsafe direction — the worst they can
    // do is keep writing the grade for another minute, which is today's
    // behaviour and refuses exactly the slabs it refuses today.
    return { markInMirror: (stored === "CTS" || stored === "SAMPLE") && slabMarkReadable() };
  } catch (err) {
    if (!isMissingColumn(err)) {
      console.error("[slabMarkStore] mirror mark not read back for slab", slabNumber, err);
    }
    return NO_MARK;
  }
}
