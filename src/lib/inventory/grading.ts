// Pure finished-goods domain rules — no server imports, safe anywhere and
// covered by unit tests (tests/grading.test.ts).

/** Normalize QC grade to the canonical exclusive set (A/A2/B/C/CTS/Printing).
 *  QC historically uses "C (Reject)" for C; "Not graded yet" means no grade. */
export const canonicalGrade = (g: unknown): string | null => {
  if (typeof g !== "string") return null;
  const t = g.trim();
  if (!t || /^not graded/i.test(t)) return null;
  return t.replace(/\s*\(reject\)\s*$/i, "");
};

/** The QC grade that means "cut to size" — the same word as the CTS *status*,
 *  deliberately, because they mean the same thing about the physical slab. */
export const CUT_TO_SIZE_GRADE = "CTS";

/**
 * Whether a slab's GRADE forbids dispatching it as a full slab.
 *
 * The CTS status has never been dispatchable — it is not in TRANSITIONS.dispatch.from.
 * The GRADE was a different story: QC writes it on every pass (canonicalGrade, called
 * from recordQc), nothing ever read it at dispatch time, and the status is a separate
 * manual action somebody has to remember. So a slab the floor graded cut-to-size stayed
 * dispatchable until an inventory user thought to also apply the status, and the two
 * signals were free to disagree — which is how already-cut slabs left as full slabs.
 *
 * QC's grade is the floor's statement about the slab; the status is bookkeeping on top
 * of it. Either one saying cut-to-size is enough to refuse dispatch.
 *
 * Runs canonicalGrade first so historical spellings normalise the same way QC's own
 * writes do, then compares CASE-INSENSITIVELY. canonicalGrade deliberately preserves
 * case — its own tests assert canonicalGrade("c (reject)") === "c" — so an exact
 * comparison would let a slab graded "cts" or "Cts" dispatch as a full slab, which is
 * the precise failure this function exists to prevent.
 */
export function gradeBlocksDispatch(grade: unknown): boolean {
  const g = canonicalGrade(grade);
  return g != null && g.toUpperCase() === CUT_TO_SIZE_GRADE;
}

export type StatusAction = "reserve" | "release" | "pack" | "dispatch" | "return" | "cts" | "uncts";

/** Slab lifecycle: which statuses each action may move FROM, and where it lands. */
export const TRANSITIONS: Record<StatusAction, { from: string[]; to: string }> = {
  reserve:  { from: ["AVAILABLE", "RETURNED"],                    to: "RESERVED" },
  release:  { from: ["RESERVED", "PACKED", "RETURNED", "CTS"],    to: "AVAILABLE" },
  pack:     { from: ["AVAILABLE", "RESERVED", "RETURNED"],        to: "PACKED" },
  dispatch: { from: ["AVAILABLE", "RESERVED", "PACKED"],          to: "DISPATCHED" },
  return:   { from: ["DISPATCHED"],                               to: "RETURNED" },
  // Cut to size: the slab is committed to cutting rather than sale as a full slab. It is
  // still physically in the bay, so every "stock on hand" query (status <> 'DISPATCHED')
  // keeps counting it - deliberate.
  //
  // CTS IS A DEAD END BY DESIGN: it is deliberately NOT in dispatch.from, because a slab
  // being cut is not shipping as a full slab. That makes the way OUT load-bearing --
  // `uncts` exists so the role that can enter this state can also leave it. Commercial can
  // apply cts, so Commercial must be able to apply uncts; `release` is NOT enough, because
  // Commercial is refused it (it would also let them undo other people's PI holds).
  // Without uncts, one mis-click on 500 packed slabs would need Finance to unpick.
  //
  // NOTE: distinct from the CTS *grade* (canonicalGrade above). A slab can carry either,
  // both or neither; the summary endpoint's "cts" tile counts the GRADE, not this.
  cts:      { from: ["AVAILABLE", "RESERVED", "PACKED"],          to: "CTS" },
  uncts:    { from: ["CTS"],                                      to: "AVAILABLE" },
};

export const DEFAULT_RESERVATION_DAYS = 7;
