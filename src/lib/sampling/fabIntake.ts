// The fabrication side of sample intake: the two places on the supervisor's
// slab board where stock is added, and the three questions a slab can answer
// for the form before he types anything.
//
// PURE, AND IT IMPORTS NOTHING — same rule as ./size.ts, ./lifecycle.ts and
// ./inventory.ts. It is reachable from tests/, so no aliases and no
// dependencies.
//
// ---------------------------------------------------------------- TWO REASONS ---
// The owner described the fab side twice, and they are NOT one control:
//
//   SPECIAL_CUT  a slab is chosen and cut for samples INSTEAD of having PO
//                pieces put on it. The decision is made at the top of the slab
//                card, when the slab is picked, and source SAMPLE_CUTTING says
//                the pieces were cut on purpose.
//   OFFCUT       a PO slab has been cut and usable pieces are left over. The
//                decision cannot be made before the cut, so it lives at the
//                foot of the card, after step 4, and source FAB_OFFCUT says the
//                pieces are what survived somebody else's job.
//
// THEY SHARE AN ENDPOINT AND NOT A PLACE. Both POST /api/sampling/intake, both
// stamp the slab number into source_ref, and the difference between them is one
// enum value — which is exactly why they must be two controls in two positions:
// the enum is the only record of WHY a piece exists, and a single form with a
// "reason" dropdown would put that choice on the man in a hurry rather than on
// where he is standing. "How much of our stock is offcut rather than
// cut-to-sample" is the question sampling_intake.source exists to answer, and a
// mis-set dropdown answers it wrongly forever.
//
// WHY THE SOURCE VALUES ARE SPELLED OUT HERE. sampling_intake.source is a
// Postgres enum (SamplingIntakeSource) whose two values are SAMPLE_CUTTING and
// FAB_OFFCUT. Prisma's generated union cannot be imported into an import-free
// module, so they are string literals — and the point of naming them once, in a
// file the tests read, is that neither screen may spell them itself.

/** Why these pieces became sample stock. One per control, never a dropdown. */
export type SampleIntakeReason = "SPECIAL_CUT" | "OFFCUT";

/** The sampling_intake_source value each reason writes. */
export const INTAKE_SOURCE: Record<SampleIntakeReason, "SAMPLE_CUTTING" | "FAB_OFFCUT"> = {
  SPECIAL_CUT: "SAMPLE_CUTTING",
  OFFCUT: "FAB_OFFCUT",
};

/** Both values the enum holds, for a route that has to validate one. */
export const INTAKE_SOURCES = ["SAMPLE_CUTTING", "FAB_OFFCUT"] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export function intakeSourceFor(reason: unknown): IntakeSource | null {
  const r = String(reason ?? "") as SampleIntakeReason;
  return INTAKE_SOURCE[r] ?? null;
}

export function isIntakeSource(value: unknown): value is IntakeSource {
  return (INTAKE_SOURCES as readonly string[]).includes(String(value ?? ""));
}

/** How each control names itself, so the two screens cannot label them
 *  differently from what they write. */
export const REASON_LABEL: Record<SampleIntakeReason, string> = {
  SPECIAL_CUT: "Cut for samples",
  OFFCUT: "Offcuts to samples",
};

// ---------------------------------------------------------------------------
// What a slab can fill in
// ---------------------------------------------------------------------------

/** The fields of a fab_slab this form reads. */
export interface SlabHint {
  slabCode?: string | null;
  colour?: string | null;
  /** MILLIMETRES, as fab_slab.thickness stores it — and a Float, so 20.0. */
  thicknessMm?: number | null;
  /**
   * polish_qc.id — the QC record this slab was taken from.
   *
   * fab_slab.slab_code is ALREADY the QC slab number as text: slab-assignment
   * writes `slabCode: String(qc.slabNumber)` when a slab is put on the board.
   * That text is what a person reads, and it is not a link — QC rows can be
   * re-imported and a number can be re-typed, so "which QC slab" and "what did
   * the supervisor call it" are two different questions. This answers the first.
   */
  pacificQcId?: string | null;
  /**
   * fab_slab.id — the slab CARD this control is sitting on.
   *
   * Not the same question as pacificQcId. That one says which stone; this says
   * which slab card, and fabrication's accounting is per fab_slab: allocations,
   * the loss figures and the send-to-cutter capacity check all hang off it. It
   * is what computeSlabLoss sums sampledAreaSqft over, so without it stone that
   * left as samples is reported as scrap and leaves the slab's PO capacity
   * untouched.
   */
  slabId?: string | null;
}

/**
 * WHICH CONTROL IS OFFERED ON THIS SLAB.
 *
 * "Cut this slab for samples" is an alternative to putting PO pieces on it, so
 * it is offered while the slab is still the supervisor's to decide about — that
 * is, until it has gone to the cutter. After that the decision has been made
 * and the pieces are the cutter's instructions.
 *
 * "Send the leftovers" cannot be true before the cut. A slab that has not been
 * sent has no leftovers; it has unused space, which is the loss figure's
 * business and not sampling's.
 *
 * So the two are mutually exclusive on any one slab, and that falls out of the
 * physical fact rather than being imposed: `sent` flips one off as it flips the
 * other on.
 */
export function offersReason(reason: SampleIntakeReason, slab: { sent?: boolean } | null | undefined): boolean {
  const sent = slab?.sent === true;
  return reason === "SPECIAL_CUT" ? !sent : sent;
}

/**
 * The slab number, as it goes into sampling_intake.source_ref.
 *
 * source_ref IS THE WHOLE BRIDGE back to fabrication. There is no foreign key
 * to fab_slab or to fab_residual_piece (the model comment on SamplingIntake
 * says why: those tables are unwritten and cannot carry a thickness or a
 * colour), so this text is the only way anyone ever answers "which slab did
 * these come off". An empty one makes the intake untraceable, so it is returned
 * as null rather than as "" and the caller decides whether to refuse.
 */
export function slabSourceRef(slab: SlabHint | null | undefined): string | null {
  const code = String(slab?.slabCode ?? "").trim();
  return code === "" ? null : code;
}

/** polish_qc.id for this slab, or null. Trimmed, and "" is null — a blank id is
 *  not a link, and storing one would make an intake look traceable. */
export function slabQcId(slab: SlabHint | null | undefined): string | null {
  const id = String(slab?.pacificQcId ?? "").trim();
  return id === "" ? null : id;
}

/**
 * THE SLAB A FAB INTAKE CAME OFF — refused rather than defaulted.
 *
 * Both fab controls used to hand `slabSourceRef(slab) ?? ""` to a locked,
 * un-typeable field, and the route accepted a null source_ref without comment.
 * A slab with no code therefore produced sample stock nobody could ever trace
 * back — silently, with no way to notice and no way to repair it afterwards,
 * because the pieces are on the shelf and the slab has gone.
 *
 * The bridge is deliberately two values, not one:
 *
 *   sourceRef  the slab number as the floor says it, which is what appears on
 *              the intake list and in an argument about where a piece came from;
 *   qcId       polish_qc.id, which survives the number being re-typed and is
 *              what "show me every sample cut off this slab" actually joins on.
 *
 * qcId is allowed to be null — a slab can legitimately be on the board without a
 * QC record behind it — but the READABLE reference is not. One of the two must
 * exist or this is not a fab intake at all.
 *
 * Pure and shared so the control and the route cannot disagree about what
 * counts as traceable.
 */
export function requireSlabSource(
  slab: SlabHint | null | undefined,
): { ok: true; sourceRef: string; qcId: string | null; slabId: string | null } | { ok: false; reason: string } {
  const sourceRef = slabSourceRef(slab);
  const qcId = slabQcId(slab);
  const slabId = String(slab?.slabId ?? "").trim() || null;
  if (!sourceRef) {
    return {
      ok: false,
      reason:
        "This slab has no slab number, so the pieces could never be traced back to it. " +
        "Add the slab from QC (which stamps its number) before sending anything to samples.",
    };
  }
  return { ok: true, sourceRef, qcId, slabId };
}

/**
 * The thickness field, pre-filled from the slab.
 *
 * WITH ITS UNIT ATTACHED, and that is the entire point. parseThicknessMm
 * REFUSES a bare number — "2" is 2 cm to the man cutting it and 2 mm to the
 * parser — so a prefill of "20" would hand him a field that looks complete and
 * is then rejected. "20 mm" is what the slab actually said.
 *
 * fab_slab.thickness is a Float in millimetres (20, 30, sometimes 19.8 off a
 * gauge). Rounded to a whole millimetre, which is what sampling_size stores and
 * what parseThicknessMm accepts; a fraction would be refused for being a
 * fraction, which is a true refusal about the wrong thing.
 */
export function thicknessPrefill(mm: number | null | undefined): string {
  const n = Number(mm);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${Math.round(n)} mm`;
}

/**
 * WHICH CATALOGUE COLOUR A SLAB'S COLOUR MEANS — or null, which is an answer.
 *
 * fab_slab.colour is free text carried over from QC ("Arva White", "arva
 * white", "ARVA  WHITE", sometimes a batch note). product_colour.name is unique
 * across every series precisely so a caller who has only a name can resolve it,
 * so this is a name match and nothing cleverer.
 *
 * IT REFUSES RATHER THAN GUESSES, for the reason ./size.ts refuses a unitless
 * thickness: the wrong answer here files a piece of Cappuccino under Arva White
 * permanently, and a blank pick-list costs one tap. Two passes, both exact:
 *
 *   1. case-insensitive, whitespace-collapsed — catches every real spelling
 *      difference between a QC sheet and the chart;
 *   2. ignoring punctuation and spaces entirely — catches "Artemis
 *      Grey/Deepwave" written "Artemis Grey / Deepwave".
 *
 * A pass that matches MORE THAN ONE colour matches none: ambiguity is not a
 * near-miss. There is deliberately no prefix, contains or edit-distance pass —
 * "Cappuccino" would match "Cappuccino Dark", which is a different colour, and
 * lib/catalogue/colours.ts already records that trap.
 */
export function matchColourName(names: readonly string[], slabColour: string | null | undefined): string | null {
  const raw = String(slabColour ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const list = (names ?? []).filter((n) => typeof n === "string" && n.trim() !== "");

  const loose = raw.toLowerCase();
  const exact = list.filter((n) => n.replace(/\s+/g, " ").trim().toLowerCase() === loose);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = squash(raw);
  if (!target) return null;
  const squashed = list.filter((n) => squash(n) === target);
  return squashed.length === 1 ? squashed[0] : null;
}
