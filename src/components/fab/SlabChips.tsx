"use client";

// THE TWO CHIPS THAT SIT BESIDE A SLAB.
//
// They answer two different questions and there is no combination of them that
// is a contradiction:
//
//   GRADE   A / A2 / B / C     how good the stone is. The polishing line's
//                              verdict, set once at inspection.
//   MARK    Full slab / CTS /  what has become of the slab. Starts full; moves
//           Sample             when fabrication cuts it, or when sampling does.
//
// A grade C slab cut to size is "C" and "CTS". Showing one where the other
// belongs is answering the wrong question — which is exactly what a Grade
// column reading "CTS" was doing, coloured red by its first letter, so every
// fabrication slab looked like a reject.
//
// ─────────────────────────────────── THE COLOURS ARE DELIBERATELY UNALIKE ───
// The grade chip is a SCALE: green, amber, red, and the eye finds red without
// reading. The mark chip is a CATEGORY: three inks of the same weight, none of
// them red, because a CTS slab is not a bad slab. If the mark were coloured on
// the same ramp the two would read as one five-point scale and CTS would look
// worse than B.
//
// Both take unknown and never throw — these render straight off an API payload,
// and a slab QC never graded must show "—", not "A".

import {
  gradeLabel, gradeTitle, gradeTone, qualityGradeOf, type GradeTone,
} from "@/lib/fab/qcGrade";
import {
  SLAB_MARK_LABEL, SLAB_MARK_TITLE, markTone, slabMarkOf,
} from "@/lib/fab/slabMark";

const CHIP = "inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap";

const GRADE_SKIN: Record<GradeTone, string> = {
  good:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  fair:    "bg-amber-50 text-amber-700 border-amber-200",
  poor:    "bg-red-50 text-red-600 border-red-200",
  // A routing word still sitting in the grade column on a database that has not
  // had scripts/0057 applied. Neutral — never the red of grade C.
  routing: "bg-slate-100 text-slate-600 border-slate-300",
  unknown: "bg-slate-50 text-slate-500 border-slate-200",
};

/**
 * THE POLISHING LINE'S VERDICT.
 *
 * `beforeCts` is polish_qc.quality_grade_before_cts (scripts/0056): where
 * fabrication overwrote the verdict with 'CTS', the original was kept, and it
 * is the one worth showing — the mark chip beside this one already says the
 * slab was cut. Without it there is nothing to show but the routing word, and
 * "—" would be a lie of a different kind: the grade is not missing, it was
 * destroyed.
 */
export function GradeChip({
  grade,
  beforeCts,
}: {
  grade?: unknown;
  beforeCts?: unknown;
}) {
  // Prefer a real verdict wherever one survives, from either column.
  const verdict = qualityGradeOf(grade) ?? qualityGradeOf(beforeCts);
  const shown = verdict ?? grade;
  const label = verdict ?? gradeLabel(grade);
  if (label === "—") return <span className="text-slate-300" title="QC has not graded this slab">—</span>;
  return (
    <span className={`${CHIP} ${GRADE_SKIN[gradeTone(shown)]}`} title={gradeTitle(shown)}>
      {label}
    </span>
  );
}

const MARK_SKIN = {
  whole:       "bg-white text-slate-500 border-slate-300",
  fabrication: "bg-indigo-50 text-indigo-700 border-indigo-200",
  sample:      "bg-violet-50 text-violet-700 border-violet-200",
} as const;

/**
 * WHAT BECAME OF THE SLAB.
 *
 * `legacyGrade` lets a database without scripts/0057 still read correctly:
 * quality_grade = 'CTS' is the old record of the same fact, so passing it keeps
 * every already-cut slab showing CTS instead of a floor full of "Full slab".
 *
 * `hideWhole` is for dense tables, where a column of identical "Full slab"
 * chips on every uncut row is noise — the interesting marks are the other two.
 */
export function MarkChip({
  mark,
  legacyGrade,
  hideWhole = false,
}: {
  mark?: unknown;
  legacyGrade?: unknown;
  hideWhole?: boolean;
}) {
  const m = slabMarkOf(mark, legacyGrade);
  if (hideWhole && m === "FULL_SLAB") {
    return <span className="text-slate-300" title={SLAB_MARK_TITLE.FULL_SLAB}>—</span>;
  }
  return (
    <span className={`${CHIP} ${MARK_SKIN[markTone(m)]}`} title={SLAB_MARK_TITLE[m]}>
      {SLAB_MARK_LABEL[m]}
    </span>
  );
}

/** Both, in the order they are read: how good it is, then what happened to it. */
export function SlabChips({
  grade,
  beforeCts,
  mark,
  hideWhole = false,
}: {
  grade?: unknown;
  beforeCts?: unknown;
  mark?: unknown;
  hideWhole?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <GradeChip grade={grade} beforeCts={beforeCts} />
      <MarkChip mark={mark} legacyGrade={grade} hideWhole={hideWhole} />
    </span>
  );
}
