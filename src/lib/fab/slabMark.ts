// WHAT HAPPENED TO THE PHYSICAL SLAB — its MARK.
//
// The owner, correcting an earlier reading of this: "CTS is not a grade, it's a
// mark. Marks should be full slab, CTS, sample. That's it. Initially full slab;
// if fabrication happened, CTS; if it's pushed to sample, sample."
//
// So there are TWO facts about a slab and they answer different questions:
//
//   GRADE   A / A2 / B / C     how good the stone is. The polishing line's
//                              verdict, set once at inspection.
//   MARK    FULL_SLAB          what has become of it. Starts full, and moves
//           -> CTS             when fabrication cuts it,
//           -> SAMPLE          or when it is pushed to sampling.
//
// A grade C slab cut to size is grade C AND CTS. Neither replaces the other,
// and a screen that shows one where the other belongs is answering the wrong
// question — which is what "CTS" appearing in a Grade column was doing.
//
// ────────────────────────────────────── WHY THIS IS A NEW COLUMN ────────────
// Today both live in polish_qc.quality_grade, because markQcSlabCts overwrites
// it with 'CTS'. That is not a naming accident that can just be renamed away:
// lib/inventory/grading.ts REFUSES TO DISPATCH a slab whose grade reads CTS,
// and that refusal is load-bearing — it is what stops an already-cut slab
// leaving as a full one. So the grade write stays until the dispatch rule reads
// the mark instead, and the mark gets its own column now.
//
// PURE, AND IT IMPORTS NOTHING — reachable from `node --test` and from a client
// component, same rule as pricing.ts and pieceNaming.ts.

/** The three states a physical slab can be in. There is no fourth. */
export const SLAB_MARKS = ["FULL_SLAB", "CTS", "SAMPLE"] as const;
export type SlabMark = (typeof SLAB_MARKS)[number];

/** Where every slab starts. */
export const DEFAULT_SLAB_MARK: SlabMark = "FULL_SLAB";

export const SLAB_MARK_LABEL: Record<SlabMark, string> = {
  FULL_SLAB: "Full slab",
  CTS: "CTS",
  SAMPLE: "Sample",
};

export const SLAB_MARK_TITLE: Record<SlabMark, string> = {
  FULL_SLAB: "Whole and uncut — can still be dispatched as a full slab.",
  CTS: "Cut to size — fabrication cut this slab, so it can no longer go out whole.",
  SAMPLE: "Pushed to sampling — cut down into sample pieces.",
};

/**
 * Read a stored mark. Tolerant about spelling, strict about the set.
 *
 * "full slab", "FULL-SLAB" and "FullSlab" all mean the same thing to the person
 * who typed them; anything outside the three is NOT quietly mapped to a
 * neighbour — it comes back null and the caller shows it as unknown. Guessing
 * here would file a slab as uncut on the strength of a typo.
 */
export function parseSlabMark(value: unknown): SlabMark | null {
  const t = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (SLAB_MARKS as readonly string[]).includes(t) ? (t as SlabMark) : null;
}

/** The mark to show, given the stored mark and — for rows that predate the
 *  column — the legacy signal in quality_grade.
 *
 *  A database without scripts/0057 has no mark at all, but it does have the old
 *  `quality_grade = 'CTS'` write. Reading that as CTS keeps every existing slab
 *  correct on the screen from the first render, rather than showing a floor
 *  full of "Full slab" that has already been cut. */
export function slabMarkOf(storedMark: unknown, legacyQualityGrade?: unknown): SlabMark {
  const explicit = parseSlabMark(storedMark);
  if (explicit) return explicit;
  const legacy = String(legacyQualityGrade ?? "").trim().toUpperCase();
  if (legacy === "CTS") return "CTS";
  return DEFAULT_SLAB_MARK;
}

/**
 * MAY THIS MARK MOVE TO THAT ONE?
 *
 * FULL_SLAB is the only state anything leaves. Once a slab is cut — for an
 * order or for samples — it is not whole again, and the two cut states are not
 * interchangeable either: stone that went to sampling did not become a
 * customer's countertop.
 *
 *   FULL_SLAB -> CTS       fabrication took it
 *   FULL_SLAB -> SAMPLE    sampling took it
 *   anything  -> itself    idempotent, so a repeated action is not an error
 *
 * Everything else is refused. The refusal says which way round it is, because
 * "invalid transition" tells nobody anything.
 */
export function checkMarkTransition(
  from: unknown,
  to: unknown,
): { ok: true; from: SlabMark; to: SlabMark } | { ok: false; reason: string } {
  const a = slabMarkOf(from);
  const b = parseSlabMark(to);
  if (!b) {
    return { ok: false, reason: `"${String(to)}" is not a slab mark. Use one of ${SLAB_MARKS.join(", ")}.` };
  }
  if (a === b) return { ok: true, from: a, to: b };   // idempotent
  if (a === "FULL_SLAB") return { ok: true, from: a, to: b };
  return {
    ok: false,
    reason:
      `This slab is already marked ${SLAB_MARK_LABEL[a]}, so it cannot become ` +
      `${SLAB_MARK_LABEL[b]}. A slab is cut once — for an order or for samples — ` +
      `and it is not whole again afterwards.`,
  };
}

/** True once the slab has been cut, either way. What dispatch actually cares
 *  about: a slab in this state cannot go out as a full slab. */
export function isCut(mark: unknown): boolean {
  const m = slabMarkOf(mark);
  return m === "CTS" || m === "SAMPLE";
}

export type MarkTone = "whole" | "fabrication" | "sample";

/** Colour by what happened, not by how good the stone is. Deliberately NOT the
 *  red/amber/green of the grade chip: a CTS slab is not a bad slab, and the two
 *  chips sitting side by side must not look like one scale. */
export function markTone(mark: unknown): MarkTone {
  const m = slabMarkOf(mark);
  if (m === "CTS") return "fabrication";
  if (m === "SAMPLE") return "sample";
  return "whole";
}
