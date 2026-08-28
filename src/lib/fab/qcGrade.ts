// HOW A QC GRADE IS READ ON A SCREEN.
//
// PURE, AND IT IMPORTS NOTHING — the rule from slabLoss.ts and pricing.ts, so
// `node --test` can reach it and a client component can use it without
// dragging anything server-side into the bundle. canonicalGrade's rules are
// restated here for that reason (lib/inventory/grading.ts is the other copy,
// and the two agree by test).
//
// ─────────────────────────────────── A GRADE IS NOT A MARK ──────────────────
// polish_qc.quality_grade currently holds two different facts, because
// markQcSlabCts overwrites it with 'CTS' when fabrication takes a slab:
//
//   GRADE   A / A2 / B / C     how good the stone is — the polishing line's
//                              verdict, set once at inspection
//   MARK    FULL_SLAB / CTS / SAMPLE
//                              what has become of the slab — see slabMark.ts
//
// They answer different questions and neither replaces the other: a grade C
// slab that has been cut to size is grade C AND CTS. This module owns the
// GRADE only. Asked about "CTS" it answers null — not because the value is
// junk, but because "how good is this stone" has no answer in it.
//
// That mattered on the CEO dashboard: every fabrication slab reads CTS in the
// grade column, and a chip colouring by first letter painted it red, identical
// to grade C — so the whole floor looked like it was cutting rejects.

/** The polishing line's verdicts. The only things this module calls a grade. */
export const QUALITY_GRADES = ["A", "A2", "B", "C"] as const;
export type QualityGrade = (typeof QUALITY_GRADES)[number];

/** Values that live in quality_grade but are NOT verdicts — they are marks or
 *  routing, and belong to slabMark.ts. Listed so this module can recognise and
 *  refuse them rather than mistaking one for a grade. */
export const NON_GRADE_VALUES = ["CTS", "Printing", "FULL_SLAB", "SAMPLE"] as const;

/**
 * Normalise what QC actually typed.
 *
 * QC historically writes "C (Reject)" for C, and "Not graded yet" for nothing.
 * Both are handled the same way lib/inventory/grading.ts handles them — the two
 * copies exist because that one imports nothing either and this one has to be
 * reachable from a client component.
 */
export function canonicalGrade(g: unknown): string | null {
  if (typeof g !== "string") return null;
  const t = g.trim();
  if (!t || /^not graded/i.test(t)) return null;
  return t.replace(/\s*\(reject\)\s*$/i, "").trim() || null;
}

/** The polishing line's verdict, or null when what we hold is a routing state
 *  (or nothing). Null is the honest answer to "how good is this stone?" when
 *  the only thing recorded is that it was cut up. */
export function qualityGradeOf(g: unknown): QualityGrade | null {
  const c = canonicalGrade(g);
  if (!c) return null;
  const upper = c.toUpperCase();
  return (QUALITY_GRADES as readonly string[]).includes(upper) ? (upper as QualityGrade) : null;
}

/** True for a value that is a mark or a routing state rather than a verdict. */
export function isRoutingGrade(g: unknown): boolean {
  const c = canonicalGrade(g);
  if (!c) return false;
  const t = c.toUpperCase().replace(/[\s-]+/g, "_");
  return (NON_GRADE_VALUES as readonly string[]).some((r) => r.toUpperCase() === t);
}

export type GradeTone = "good" | "fair" | "poor" | "routing" | "unknown";

/** How to colour it. Routing states get their OWN tone — never the red that
 *  means "the polishing line rejected this stone". */
export function gradeTone(g: unknown): GradeTone {
  const q = qualityGradeOf(g);
  if (q === "A" || q === "A2") return "good";
  if (q === "B") return "fair";
  if (q === "C") return "poor";
  if (isRoutingGrade(g)) return "routing";
  return "unknown";
}

/** What the chip prints. Empty/unknown reads "—": ungraded and grade A are
 *  different facts and must not look the same. */
export function gradeLabel(g: unknown): string {
  const c = canonicalGrade(g);
  if (!c) return "—";
  const q = qualityGradeOf(g);
  if (q) return q;
  // Preserve the word's own casing — "CTS", "Printing".
  const known = (NON_GRADE_VALUES as readonly string[]).find((r) => r.toLowerCase() === c.toLowerCase());
  return known ?? c;
}

/** The sentence a hover shows, because "CTS" means nothing to a reader who has
 *  not been told. */
export function gradeTitle(g: unknown): string {
  const c = canonicalGrade(g);
  if (!c) return "QC has not graded this slab";
  if (/^cts$/i.test(c)) {
    return "Cut to size — this slab was taken for fabrication and can no longer be dispatched whole. " +
      "It is a routing state, not a quality verdict.";
  }
  if (/^printing$/i.test(c)) return "Routed to printing — a routing state, not a quality verdict.";
  const q = qualityGradeOf(g);
  if (q === "A" || q === "A2") return `Grade ${q} — the polishing line passed this slab.`;
  if (q === "B") return "Grade B — passed with reservations.";
  if (q === "C") return "Grade C — the polishing line rejected this slab.";
  return `QC recorded "${c}".`;
}

/**
 * WHAT TO SHOW WHEN THE VERDICT HAS BEEN OVERWRITTEN.
 *
 * markQcSlabCts replaces quality_grade with 'CTS' when a slab is picked for
 * fabrication, so the original A/B/C is gone from that column. Where it has
 * been preserved (scripts/0056 adds quality_grade_before_cts), both are worth
 * showing: "A · CTS" says the stone was good AND has been cut. Without the
 * preserved value there is only "CTS", and no way to know what it was.
 */
export function describeGrade(current: unknown, beforeCts?: unknown): string {
  const now = gradeLabel(current);
  const before = qualityGradeOf(beforeCts);
  if (before && isRoutingGrade(current)) return `${before} · ${now}`;
  return now;
}
