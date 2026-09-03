// WHEN A SLAB IS CUT DOWN FOR SAMPLES.
//
// The owner: "samples are always in cut pieces — so when a slab is ready it's
// full, it can be sold directly, or cut for fabrication, or cut to samples."
//
// Three destinations for a finished slab, and two of them are CUT:
//
//     FULL_SLAB   whole. Sellable as a full slab.
//     CTS         fabrication took it.   -> markQcSlabCts.ts
//     SAMPLE      sampling took it.      -> here
//
// Until now only the first two were recorded. The sampling intake wrote the
// PIECES — sampling_stock, sampling_intake — and left the SLAB reading exactly
// as it had before: whole, graded A, and dispatchable. A slab cut up for the
// sample shelf could go out on a lorry as a full slab, and nothing in the system
// would have objected.
//
// ─────────────────────────────────── WHAT IT WRITES, AND WHEN ───────────────
//   polish_qc.slab_mark                = 'SAMPLE'   the fact itself (0057).
//                                                   ALWAYS.
//   polish_qc.quality_grade            = 'SAMPLE'   ONLY while dispatch cannot
//                                                   yet read the mark.
//   polish_qc.quality_grade_before_cts = the verdict, kept before it is lost —
//                                        only on that same legacy branch, since
//                                        otherwise nothing is destroying it.
//
// The grade write is the same compromise markQcSlabCts makes, and it is now
// resolved the same way. The owner, 2026-09-03: "grade should be A/B/C like
// normal, and the MARK is CTS or sampling." lib/inventory blocks dispatch on
// the mark OR the grade now (slabBlocksDispatch), but it reads the mark from
// fg_finished_slab.slab_mark, a column that arrives with scripts/0070 — which
// may land before or after this code. So refreshInventoryMirror pushes the mark
// into finished goods, reads the row back, and says whether it is really there;
// only then is the grade left alone. No column, no permission slip, no change:
// a slab cut for samples goes on being refused on exactly the signal it is
// refused on today. See markQcSlabCts.ts for the full argument.
//
// "A · Sample" — the stone was good AND it has been cut up — is what the whole
// change is for. On the new branch it needs no preservation column at all: the
// A is simply never overwritten.
//
// ─────────────────────────────────── ONLY A WHOLE SLAB IS TAKEN ─────────────
// The guard is in the WHERE, not in JavaScript. A slab already CTS keeps its
// CTS: fabrication cut it, and the offcuts reaching the sample shelf afterwards
// are what was left over, not what the slab became. That is the normal case for
// a FAB_OFFCUT intake and it is not an error — setSlabMark refuses the mark for
// the same reason, and this refuses the grade for the same reason.

import { prisma } from "@/lib/prisma";
import { setSlabMark, refreshInventoryMirror } from "@/lib/fab/slabMarkStore";

export async function markQcSlabSample(pacificQcId: string): Promise<void> {
  if (!pacificQcId) return;

  // The mark FIRST — its guard reads quality_grade to decide whether the slab is
  // still whole, so writing the grade first would make every call look like an
  // already-cut slab and the mark would never be set.
  const marked = await setSlabMark(pacificQcId, "SAMPLE");

  // Refused means the slab was already cut the other way. Nothing more to do:
  // it is already blocked from dispatch and its history is already recorded.
  if (!marked.ok) return;

  // AND AN IDEMPOTENT RE-MARK IS ALSO DONE. changed:false with applied:true
  // means the row ALREADY read slab_mark = 'SAMPLE', so this is a repeat of a
  // decision that has already been taken and there is nothing left to write.
  //
  // The same hole markQcSlabCts had, and latent here only because no live row
  // carries a SAMPLE mark yet (measured 2026-09-03: 63 CTS, 48,329 FULL_SLAB, 0
  // SAMPLE). Without this, a re-mark on a database having a bad minute would
  // reach the legacy branch and overwrite a real verdict with 'SAMPLE' — and
  // after scripts/0071 and 0072 the grade test in that statement's WHERE no
  // longer catches it, because a slab that has already been cut now reads 'B'.
  if (marked.applied && !marked.changed) return;

  // AND TELL INVENTORY — fg_finished_slab is what the dispatch rule reads.
  // This runs BEFORE the grade write now: it carries the SAMPLE mark across
  // into fg_finished_slab.slab_mark and reads the row back, and its answer is
  // what decides whether the grade has to be overwritten at all.
  const mirror = await refreshInventoryMirror(pacificQcId);
  if (mirror.markInMirror) return;

  // THE LEGACY BRANCH — no scripts/0070, or no finished-goods row to mark. The
  // mark cannot refuse this slab at dispatch, so the grade still has to.
  try {
    await prisma.$executeRaw`
      UPDATE polish_qc
      SET    quality_grade_before_cts = COALESCE(
               quality_grade_before_cts,
               -- Only a real verdict is worth keeping. Routing states and
               -- "Not graded yet" are not history, they are noise. Folded for
               -- case and whitespace, the way this column is compared
               -- everywhere else — an exact NULLIF chain would have filed a
               -- grade of "cts" or " Sample " away as a quality verdict.
               CASE
                 WHEN upper(btrim(coalesce(quality_grade, ''))) IN ('CTS', 'SAMPLE', 'PRINTING', '') THEN NULL
                 WHEN upper(btrim(coalesce(quality_grade, ''))) LIKE 'NOT GRADED%' THEN NULL
                 ELSE btrim(quality_grade)
               END
             ),
             quality_grade = 'SAMPLE'
      WHERE  id = ${pacificQcId}
        -- Only a slab that has not already been cut. See the header.
        AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
        -- AND THE MARK AGREES IT IS STILL WHOLE. After scripts/0071 and 0072
        -- the grade test above catches nothing: every cut slab reads 'B'. The
        -- mark is what remembers, and it is tested in the statement so a
        -- concurrent pick cannot slip between the read and the write.
        AND  upper(btrim(coalesce(slab_mark, 'FULL_SLAB'))) = 'FULL_SLAB'
    `;
  } catch (err) {
    // scripts/0056 not applied — still record SAMPLE, which is the part that
    // stops the slab being dispatched whole. The verdict is lost, as it has
    // always been on the CTS path.
    //
    // AND SAY SO. The identical catch on the CTS path was a bare `catch {}`,
    // and that silence is exactly why quality_grade_before_cts sat NULL on all
    // 48,377 rows for a fortnight with nobody the wiser.
    console.error("[fab] verdict NOT preserved for qc", pacificQcId, "— falling back to a grade-only SAMPLE write", err);
    try {
      // Still narrowed by the mark: losing the preservation column is no reason
      // to also lose the re-mark guard, which is the one that stops 'SAMPLE'
      // landing on top of a verdict.
      await prisma.$executeRaw`
        UPDATE polish_qc
        SET    quality_grade = 'SAMPLE'
        WHERE  id = ${pacificQcId}
          AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
          AND  upper(btrim(coalesce(slab_mark, 'FULL_SLAB'))) = 'FULL_SLAB'
      `;
    } catch (err2) {
      // No slab_mark column either (scripts/0057 unapplied). No row on such a
      // database can be "already marked", so the narrowing was a no-op there and
      // dropping it changes which rows move not at all — it only lets the
      // statement parse.
      console.error("[fab] mark-narrowed SAMPLE write failed for qc", pacificQcId, "— no slab_mark column; writing the grade unnarrowed", err2);
      await prisma.$executeRaw`
        UPDATE polish_qc
        SET    quality_grade = 'SAMPLE'
        WHERE  id = ${pacificQcId}
          AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
      `;
    }
  }

  // AND MIRROR THE GRADE. The refresh above ran before the grade changed, so
  // finished goods is still holding the pre-SAMPLE grade — and on this branch
  // that grade is the only thing standing between a slab that is now a pile of
  // sample pieces and a lorry.
  await refreshInventoryMirror(pacificQcId);
}
