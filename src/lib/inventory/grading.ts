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

/** The one that means "cut down for samples". A separate word because it is a
 *  separate history — that stone went to the sample shelf, not to a customer's
 *  countertop — and the CEO board shows which. */
export const SAMPLE_GRADE = "SAMPLE";

/**
 * EVERY WAY A SLAB CAN HAVE BEEN CUT.
 *
 * The owner's model, in his words: "a slab when it's ready is full — it can be
 * sold directly, or cut for fabrication, or cut to samples." Three states, and
 * the last two are both CUT:
 *
 *     FULL_SLAB   whole. Sellable as a full slab.
 *     CTS         fabrication took it.
 *     SAMPLE      sampling took it. "Samples are always in cut pieces."
 *
 * Dispatch cares about exactly one thing — is it still whole — so both cut
 * states belong here. src/lib/fab/slabMark.ts holds the same three values as a
 * proper mark column; this list is the DISPATCH-SIDE copy, because that module
 * imports nothing and neither does this one.
 */
export const CUT_GRADES = [CUT_TO_SIZE_GRADE, SAMPLE_GRADE] as const;

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
 *
 * ─────────────────────────────────────────── AND SAMPLE, FROM 2026-08-25 ────
 * The owner: "samples are always in cut pieces — so when a slab is ready it's
 * full, it can be sold directly, or cut for fabrication, or cut to samples."
 *
 * A slab cut down for samples is no more dispatchable whole than one cut to
 * size, and until now nothing stopped it: the sampling intake recorded the
 * PIECES and left the slab reading exactly as it had before. This change is
 * purely ADDITIVE — it can only ever refuse more, never allow something that
 * was refused before — which is the only safe direction for a rule that is the
 * last thing between an already-cut slab and a lorry.
 */
export function gradeBlocksDispatch(grade: unknown): boolean {
  const g = canonicalGrade(grade);
  if (g == null) return false;
  const upper = g.toUpperCase();
  return (CUT_GRADES as readonly string[]).includes(upper);
}

export type StatusAction = "reserve" | "release" | "pack" | "dispatch" | "return" | "cts" | "uncts" | "chromia" | "unchromia";

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
  // Taken into the Chromia printing module (owner, 2026-08-29: "whatever is
  // taken into the chromia module is marked in inventory as chromia"). Applied
  // ONLY by the module's own intake — the operator register and the historical
  // import — never offered as a hand action; it is deliberately absent from
  // /api/inventory/status's action enum for that reason.
  //
  // WHY only AVAILABLE and RETURNED: a RESERVED slab is somebody's PI hold, a
  // PACKED one is on a pallet and a DISPATCHED one is gone — chromia's intake
  // does not quietly pull any of those out from under the person holding them.
  // A refused slab is left alone and a "chromia_conflict" SlabEvent records the
  // disagreement so the sheet can surface it (see lib/chromia/inventory-bridge).
  // The way OUT is the slab-intake form's status override — the same people who
  // reconcile chromia stock with the yard can undo a wrong mark.
  chromia:  { from: ["AVAILABLE", "RETURNED"],                    to: "CHROMIA" },
  // The bridge's own inverse, for the Chromia module's CORRECTION flows: a
  // slab-number typo fixed, a record deleted, a mistaken import removed. The
  // mark follows the record it was made for — without this, correcting the
  // register stranded the wrong slab in CHROMIA (unreachable by any action)
  // while the right one stayed quietly sellable. Machine-only like chromia
  // itself: absent from /api/inventory/status's zod enum, so it is not a hand
  // action; the hand path for a person stays the slab-intake status override.
  unchromia:{ from: ["CHROMIA"],                                  to: "AVAILABLE" },
};

export const DEFAULT_RESERVATION_DAYS = 7;
