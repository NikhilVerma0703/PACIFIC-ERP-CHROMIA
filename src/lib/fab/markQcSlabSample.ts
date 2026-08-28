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
// ─────────────────────────────────── IT WRITES THREE THINGS, DELIBERATELY ───
//   polish_qc.slab_mark                = 'SAMPLE'   the fact itself (0057)
//   polish_qc.quality_grade            = 'SAMPLE'   what dispatch reads today
//   polish_qc.quality_grade_before_cts = the verdict, kept before it is lost
//
// The grade write is the same compromise markQcSlabCts makes: lib/inventory
// blocks dispatch on the GRADE, so until that rule reads the mark instead, the
// grade is the load-bearing signal and writing only the new column would leave
// the slab dispatchable. The verdict is preserved first (scripts/0056) so "A ·
// Sample" can still be shown — the stone was good AND it has been cut up.
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

  try {
    await prisma.$executeRaw`
      UPDATE polish_qc
      SET    quality_grade_before_cts = COALESCE(
               quality_grade_before_cts,
               -- Only a real verdict is worth keeping. Routing states and
               -- "Not graded yet" are not history, they are noise.
               NULLIF(NULLIF(NULLIF(NULLIF(quality_grade, 'CTS'), 'SAMPLE'), 'Printing'), '')
             ),
             quality_grade = 'SAMPLE'
      WHERE  id = ${pacificQcId}
        -- Only a slab that has not already been cut. See the header.
        AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
    `;
  } catch {
    // scripts/0056 not applied — still record SAMPLE, which is the part that
    // stops the slab being dispatched whole. The verdict is lost, as it has
    // always been on the CTS path.
    await prisma.$executeRaw`
      UPDATE polish_qc
      SET    quality_grade = 'SAMPLE'
      WHERE  id = ${pacificQcId}
        AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
    `;
  }

  // AND TELL INVENTORY — finished_slab.grade is what the dispatch rule reads.
  await refreshInventoryMirror(pacificQcId);
}
