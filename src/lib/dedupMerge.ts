// The polishing dedupe's MERGE DECISION, on its own and import-free.
//
// It lives here rather than inside lib/automations-dedup because that module
// imports prisma and node:fs, and `node --test` cannot resolve either — so the
// rule below could only ever be tested by matching its own source text with a
// regex. That is the weakness an adversarial reviewer named on this very rule's
// sibling: four tests that matched a function's SOURCE would all have passed
// with the logic inside it inverted. A decision worth guarding is worth running.
//
// Same reasoning, and same shape, as lib/photoSlots — which this imports
// relatively, because it is import-free too.

import { REJECT_GRADE_FIELD, isRejectGrade } from "./photoSlots.ts";

/** WHICH OF THE KEPT ROW'S EMPTY FIELDS MAY BE FILLED FROM THE DUPLICATES ABOUT
 *  TO BE DELETED — the merge decision, pure and exported so it can be tested
 *  against real values instead of by matching this file's source text.
 *
 *  A REJECT GRADE IS THE ONE THING IT WILL NOT COPY. Every other empty field is
 *  worth recovering from a row that is about to go. The grade is different, and
 *  only when the value is C (Reject): copying it MANUFACTURES A VERDICT on a row
 *  that had none, and does it with no photographs — the older row's entry_photo
 *  rows are keyed to ITS id, which the same pass deletes, so the evidence does
 *  not come across even where it existed.
 *
 *  After the three human paths were closed (the QC entry form, the tables
 *  editor, and Add & verify) that was the only way left to get a reject into
 *  polish_qc without the two photographs the owner's rule demands (2026-09-04).
 *  This is not a person making a verdict; it is a tidy-up job, and a tidy-up job
 *  must not decide that a slab was rejected. The field stays NULL, which is the
 *  honest answer — nobody graded that row — and a human grades it on the QC form
 *  where the camera is.
 *
 *  THOUGH THIS PLANT RARELY SPELLS UNGRADED AS NULL, and the next reader should
 *  not be surprised by that. The live column says 'Not graded yet' on 3,654 rows
 *  and NULL on 194 (2026-09-04). Since the merge only fills a field that is null
 *  or undefined, a kept row already reading 'Not graded yet' never reaches this
 *  guard at all — it is skipped a step earlier. Measured over all 178 linked
 *  duplicate groups on that date: 0 kept rows with a NULL grade, 44 reading 'Not
 *  graded yet', 9 groups with a reject on an older duplicate, and so the guard
 *  fired ZERO times. It is insurance, not a repair, and that is the honest
 *  description of it.
 *
 *  A REJECT ANYWHERE IN THE CHAIN STOPS THE GRADE MERGING AT ALL, rather than
 *  falling through to an older duplicate that happens to hold an A. The rows are
 *  sorted newest-first, so reaching past a reject to take a kinder verdict from
 *  a staler row would be inventing a grade twice over.
 *
 *  Only the GRADE is guarded. Widening this to skip the whole row would quietly
 *  stop recovering design, thickness and inspector, which is the dedupe's actual
 *  job. */
export function mergeFromOlder(
  keep: Record<string, unknown>,
  older: readonly Record<string, unknown>[],
  writable: readonly string[],
): { data: Record<string, unknown>; rejectGradesRefused: number } {
  const data: Record<string, unknown> = {};
  let rejectGradesRefused = 0;
  for (const f of writable) {
    if (keep[f] !== null && keep[f] !== undefined) continue;
    for (const o of older) {
      if (o[f] === null || o[f] === undefined) continue;
      if (f === REJECT_GRADE_FIELD && isRejectGrade(o[f] as string)) { rejectGradesRefused++; break; }
      data[f] = o[f];
      break;
    }
  }
  return { data, rejectGradesRefused };
}
