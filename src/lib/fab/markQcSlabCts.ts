// When a physical QC slab is chosen for fabrication, mark it CTS on polish_qc.
// The row stays in stock and in the picker — CTS is a routing grade (cut-to-
// size / fab), not a delete. Shift scoring already treats CTS as "not a
// reject" (shiftScoreMath.ts). Idempotent: setting CTS on a slab that is
// already CTS is a no-op.
//
// ─────────────────────────────────── IT USED TO DESTROY THE VERDICT ─────────
// quality_grade holds both the polishing line's verdict (A/A2/B/C) and the
// routing states (CTS, Printing) in one column. Overwriting it with 'CTS' is
// right for dispatch — the slab genuinely cannot go out whole, and
// lib/inventory/grading.ts refuses it on exactly that grade — but it threw the
// verdict away. Every slab that had ever reached fabrication read CTS, and
// nothing recorded whether it had been grade A stone or a C reject.
//
// So the outgoing value is copied into quality_grade_before_cts first
// (scripts/0056), and ONLY while that column is still empty: a slab marked CTS
// twice must keep its ORIGINAL verdict rather than record 'CTS' as its own
// history. One statement, so there is no window between the two writes.
//
// COALESCE guards the case the column does not exist yet — the whole UPDATE is
// wrapped so a database without 0056 still gets the CTS mark. See the catch.
//
// ─────────────────────────────────── AND IT WRITES THE MARK ─────────────────
// "CTS is not a grade, it's a mark" — so the same event now writes BOTH:
//
//   quality_grade = 'CTS'   kept, and load-bearing: lib/inventory/grading.ts
//                           refuses to dispatch on exactly this value, which is
//                           what stops an already-cut slab leaving whole.
//   slab_mark     = 'CTS'   the fact itself, in its own column (scripts/0057),
//                           where it can sit beside the verdict instead of
//                           destroying it.
//
// Both, until dispatch reads the mark instead. Writing only the new column
// would silently un-block dispatch for every slab fabrication cuts.

import { prisma } from "@/lib/prisma";
import { setSlabMark, refreshInventoryMirror } from "@/lib/fab/slabMarkStore";

export async function markQcSlabCts(pacificQcId: string): Promise<void> {
  if (!pacificQcId) return;
  // The mark FIRST, because its guard is "only a FULL_SLAB moves" and it reads
  // quality_grade to decide. Writing the grade first would make every call look
  // like an already-CTS slab and the mark would never be set on a fresh one.
  //
  // A refusal here is not an error and does not stop the grade write: it means
  // the slab is already marked SAMPLE, and what fabrication does next with the
  // remainder is fabrication's business. The dispatch block still has to land.
  await setSlabMark(pacificQcId, "CTS");
  try {
    await prisma.$executeRaw`
      UPDATE polish_qc
      SET    quality_grade_before_cts = COALESCE(
               quality_grade_before_cts,
               -- Only a real verdict is worth keeping. Routing states and
               -- "Not graded yet" are not history, they are noise.
               NULLIF(NULLIF(NULLIF(quality_grade, 'CTS'), 'Printing'), '')
             ),
             quality_grade = 'CTS'
      WHERE  id = ${pacificQcId}
    `;
  } catch {
    // scripts/0056 not applied — still mark it CTS, which is the part that
    // matters for dispatch. The verdict is lost, as it always was.
    await prisma.$executeRaw`
      UPDATE polish_qc SET quality_grade = 'CTS' WHERE id = ${pacificQcId}
    `;
  }

  // AND TELL INVENTORY. finished_slab is what the dispatch rule actually reads,
  // and nothing on this side was refreshing it — so the CTS block has not been
  // firing at all. See refreshInventoryMirror. Best-effort by design.
  await refreshInventoryMirror(pacificQcId);
}
