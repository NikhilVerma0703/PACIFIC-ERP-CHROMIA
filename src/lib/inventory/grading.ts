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

// ───────────────────────────── AND NOW THE MARK, FROM 2026-09-03 ────────────
//
// The owner, in his developer's words: "grade should be A/B/C like normal, and
// the MARK is CTS or sampling." Today fabrication OVERWRITES quality_grade with
// 'CTS' (lib/fab/markQcSlabCts.ts), which destroys the polishing line's A/B/C
// verdict — its own header says "CTS is not a grade, it's a mark" and that both
// writes happen only "until dispatch reads the mark instead". This is that.
//
// The mark lives in its own column: polish_qc.slab_mark (scripts/0057) and, as
// of the migration that ships with this change, fg_finished_slab.slab_mark —
// FULL_SLAB / CTS / SAMPLE, the three states in src/lib/fab/slabMark.ts.
//
// WHY THE TWO LISTS BELOW SPELL THE SAME TWO WORDS AND ARE STILL SEPARATE:
// CUT_GRADES is what the LEGACY grade column may say; CUT_MARKS is what the NEW
// mark column may say. They are different columns with different writers, and a
// grade that stops being a routing state one day (which is the whole point of
// this change) must not silently stop being a refused MARK on the same edit.
// This is the dispatch-side copy of slabMark.ts's SLAB_MARKS minus FULL_SLAB,
// for the same reason CUT_GRADES is a copy: this module imports nothing, so
// `node --test` can reach it and so can a client component.

/** The marks that mean the slab has been cut. FULL_SLAB is the only other
 *  value, and it is the only one that may leave as a full slab. */
export const CUT_MARKS = ["CTS", "SAMPLE"] as const;
export type CutMark = (typeof CUT_MARKS)[number];

/** A stored mark, normalised to one of the two cut states, or null.
 *
 *  Tolerant the same way slabMark.ts's parseSlabMark is — "cts", " Cts ",
 *  "full slab" and "FULL-SLAB" all read as the person meant them — and strict
 *  about the set: anything outside the three states is NOT guessed at. It is
 *  not a cut mark, so it does not block, and the grade rule below still gets
 *  its say. */
function cutMarkOf(mark: unknown): CutMark | null {
  if (typeof mark !== "string") return null;
  const m = mark.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (CUT_MARKS as readonly string[]).includes(m) ? (m as CutMark) : null;
}

/**
 * Whether a slab's MARK forbids dispatching it as a full slab.
 *
 * The mark is the fact itself: a slab fabrication cut, or sampling cut down, is
 * not whole, whatever anyone later writes in the grade column. Case-insensitive
 * for the same reason gradeBlocksDispatch is — a mark reading "cts" is the same
 * physical slab as one reading "CTS", and an exact comparison would let it onto
 * a lorry.
 *
 * A slab with NO mark — undefined, null, "", or a database that has not had the
 * migration yet — is not blocked BY THIS FUNCTION. That is deliberate and it is
 * safe only because it is never used alone: see slabBlocksDispatch.
 */
export function markBlocksDispatch(mark: unknown): boolean {
  return cutMarkOf(mark) !== null;
}

/**
 * THE DISPATCH RULE. Either signal saying cut is enough to refuse.
 *
 * ══════════ THE OR HAS ONE LEG NOW. READ THIS BEFORE TRUSTING IT ══════════
 *
 * This was written during a changeover in which BOTH signals were live, and it
 * used to say the OR "can only ever refuse MORE", with the grade half going on
 * covering the 62 legacy rows. THAT IS NO LONGER TRUE, and the sentence is kept
 * deleted rather than softened, because a stale justification is how the next
 * person re-opens the hole.
 *
 * What ended the changeover: scripts/0071 and 0072 moved all 63 of those slabs
 * from grade 'CTS' to grade 'B' on the owner's decision, their real verdicts
 * being unrecoverable. Re-measured on live Neon 2026-09-03, after they ran:
 *
 *   * ZERO rows in polish_qc and ZERO in fg_finished_slab carry grade 'CTS' or
 *     'SAMPLE'. gradeBlocksDispatch matches NOTHING against real data.
 *   * 63 rows carry slab_mark = 'CTS' (60 AVAILABLE, 1 status CTS, 2 already
 *     DISPATCHED). All 61 on the floor read grade 'B'.
 *
 * SO THE MARK IS THE ONLY THING BETWEEN 60 ALREADY-CUT SLABS AND A LORRY.
 * Anything that cannot confirm the mark must FAIL CLOSED — refuse, and say why
 * — not fall through to the grade and call that a degraded answer. It is not
 * degraded, it is a confident wrong one. See finishedSlab.ts, which does refuse.
 *
 * The grade half stays anyway, and deliberately. It costs nothing, and it is
 * the one thing that would still refuse a row if a routing state ever found its
 * way back into quality_grade — which scripts/0072's closing note names as the
 * standing regression signal for this whole incident. Keep it; just do not
 * lean on it.
 */
export function slabBlocksDispatch(slab: { grade?: unknown; mark?: unknown }): boolean {
  return markBlocksDispatch(slab.mark) || gradeBlocksDispatch(slab.grade);
}

/**
 * WHICH WAY THE SLAB WAS CUT, or null if it was not.
 *
 * Exists for the refusal MESSAGE, and the message matters: "cut to size" and
 * "cut down for samples" send an inventory user to two different people to ask
 * why, and one wording for both would send half of them to the wrong one.
 *
 * The MARK WINS when both speak, because the mark is the fact and the grade is
 * the legacy shadow of it — a slab marked SAMPLE whose grade still reads CTS
 * from an older fabrication pass went to the sample shelf, and that is where
 * whoever is asking should go looking.
 */
export function dispatchCut(slab: { grade?: unknown; mark?: unknown }): CutMark | null {
  const byMark = cutMarkOf(slab.mark);
  if (byMark) return byMark;
  const g = canonicalGrade(slab.grade);
  if (g == null) return null;
  const upper = g.toUpperCase();
  return (CUT_GRADES as readonly string[]).includes(upper) ? (upper as CutMark) : null;
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
