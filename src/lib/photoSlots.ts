// The far/near photo pair, defined ONCE.
//
// Two screens carry it. On the slab-intake form both are REQUIRED before a slab
// may be created; on the Polish QC form (and the tables editor behind it) both
// are optional EXCEPT on a reject — see isRejectGrade at the bottom of this
// file. Required-or-not is the caller's rule — everything else is the
// same on both, because they are the same two photographs of the same physical
// slab: the same field names on the wire, the same filename prefixes in the
// store, the same words on screen. A second copy of this list would drift, and
// a field renamed on one screen and not the other is a photo saved under a name
// nothing ever reads back.
//
// Import-free, so `node --test` and client components both reach it directly.

export interface PhotoSlot {
  /** Which of the pair. */
  slot: "far" | "near";
  /** The FormData field on the wire. Prefixed __ like every other non-column field. */
  field: string;
  /** Prepended to the stored filename, so the two slots stay tellable apart
   *  when read back out of entry_photo. */
  prefix: string;
  /** The form label. */
  title: string;
  /** The line under the label — what the photo should actually show. */
  hint: string;
  /** The whole sentence fragment, for refusals ("The far photo (the whole
   *  slab) is required — attach it before saving."). */
  label: string;
  /** Two words, for confirmations and chips. */
  short: string;
}

export const PHOTO_SLOTS: readonly PhotoSlot[] = [
  { slot: "far", field: "__photo_far", prefix: "far-", title: "Far photo", hint: "the whole slab", label: "far photo (the whole slab)", short: "far photo" },
  { slot: "near", field: "__photo_near", prefix: "near-", title: "Near photo", hint: "close on the defect", label: "near photo (close on the defect)", short: "near photo" },
] as const;

export type PhotoSlotName = (typeof PHOTO_SLOTS)[number]["slot"];

/** The single generic photo field every other entry form has always posted. */
export const SINGLE_PHOTO_FIELD = "__photo";

/** Every photo field a form might post, with the prefix each is stored under —
 *  one list for the save path to walk, so a slot added here is stored without
 *  anyone remembering to go and teach entryPhoto about it. */
export const ALL_PHOTO_FIELDS: readonly { field: string; prefix: string }[] = [
  { field: SINGLE_PHOTO_FIELD, prefix: "" },
  ...PHOTO_SLOTS.map((p) => ({ field: p.field, prefix: p.prefix })),
];

// TWO photos share ONE request, and Vercel rejects bodies over ~4.5 MB — so a
// form carrying the pair compresses each tighter than a form carrying one:
// aim 1.6 MB, never post over 2 MB, and the pair stays under the cap with room
// for the fields. Here rather than in either form, because the reason is the
// request budget, which both share.
export const PAIR_TARGET = 1_600_000;
export const PAIR_HARD_MAX = 2_000_000;

/** The entry models whose forms carry the pair instead of the single photo.
 *  Polish QC is where a defect is judged, so it is where the two views of it
 *  are worth having — optional on every grade but a reject (isRejectGrade
 *  below), unlike the intake form's. The tables editor reads the same set, so a
 *  record's edit screen offers exactly the slots its entry form did. */
export const PHOTO_PAIR_MODELS: readonly string[] = ["PolishQc"];

export function hasPhotoPair(model: string): boolean {
  return PHOTO_PAIR_MODELS.includes(model);
}

/** Which slot a stored photo belongs to, read back from its filename prefix.
 *  null for a photo saved before the pair existed, or through the single
 *  generic field — those are neither far nor near, and are shown unlabelled. */
export function slotOfFilename(filename: string | null | undefined): PhotoSlotName | null {
  const n = String(filename ?? "");
  for (const p of PHOTO_SLOTS) if (n.startsWith(p.prefix)) return p.slot;
  return null;
}

// ---------------------------------------------------------------------------
// THE REJECT RULE (owner, 2026-09-03: "if any user tried to submit any c grade
// slab he will have to attach as mandatory the two photos ... the fill slab and
// the close").
//
// This NARROWS the 2026-09-01 decision that made the QC pair optional; it does
// not reverse it. That reasoning — QC entry runs slab after slab and must never
// be stopped by a camera — still holds for A, A2 and B, which is 43,360 of the
// 44,449 graded slabs on live Neon (2026-09-04). A reject is the one verdict
// worth stopping for, because it is the one whose evidence somebody will want
// to look at again: a customer claim, a re-grade argument, a press investigation.
//
// One predicate, here, for the client AND the server — because a rule the form
// draws and the action does not enforce is decoration (client `required` can be
// bypassed), and two spellings of "is this a reject" is how they come apart.
// ---------------------------------------------------------------------------

/** The QC column the rule keys off. Named here beside the rule, so the form
 *  that watches it and the action that enforces it cannot drift onto two
 *  different fields. */
export const REJECT_GRADE_FIELD = "qualityGrade";

/** The one sentence that says WHY, shared by every refusal and every banner. */
export const REJECT_PHOTOS_RULE = "A C (Reject) slab must carry both photos.";

/** Is this grade the reject verdict?
 *
 *  'C (Reject)' is the live spelling — all 1,253 reject rows on Neon carry it
 *  and not one carries a bare 'C' (2026-09-04) — but the inventory's own grade
 *  list (inventory/intakeRules GRADE_OPTIONS) still offers plain 'C', so both
 *  have to count, and so does anything a typed-in "+ Add new…" value might look
 *  like around them ("c", " C ", "C - reject").
 *
 *  'CTS' MUST NOT MATCH, and that is the whole reason this is a function rather
 *  than `grade.startsWith("C")` at two call sites. "CTS".startsWith("C") is
 *  true, and shiftScoreMath's gradeCredit carries the scar: cut-to-size slabs
 *  scored as rejects, 37 of them live, each costing its shift 9 points. CTS,
 *  SAMPLE and Printing are ROUTINGS — where the slab goes next — not verdicts
 *  on it, and a routing must never be made to produce defect photographs of a
 *  defect nobody found.
 *
 *  So the test is the leading WORD, not the leading letter: "C (REJECT)" and
 *  "C-REJECT" lead with C; "CTS" leads with CTS and is left alone.
 *
 *  AND THE LEADING WORD HAS TO BE FOUND FIRST. The original took the head as
 *  `.trim().toUpperCase().split(/[^A-Z0-9]/)[0]`, which yields "" — not "C" —
 *  the moment the first character is not an ASCII letter or digit, because the
 *  split then produces an empty first element. A reviewer got three spellings
 *  past the whole rule that way on 2026-09-04: a zero-width space before the C
 *  (U+200B survives .trim()), a fullwidth Ｃ (U+FF23), and a leading separator
 *  such as "(C) Reject". Each demanded no photograph on create OR on edit, and
 *  was then invisible to every count that keys on this same predicate.
 *
 *  NFKC folds the fullwidth and compatibility forms to plain ASCII; the two
 *  strips remove zero-width characters and any leading punctuation before the
 *  split looks for the word. NONE OF IT LOOSENS THE CTS PROTECTION — the head
 *  is still a whole word compared with "C", so "CTS" still leads with "CTS".
 *
 *  A CYRILLIC С (U+0421) IS STILL NOT CAUGHT, deliberately. It is a different
 *  character that merely looks the same, NFKC does not fold homoglyphs, and
 *  catching it needs a confusables table. The QC dropdown cannot produce one —
 *  qualityGrade is a singleSelect and is not in CURATED_TEXT_FIELDS, so there is
 *  no free-text escape — and the live column holds six distinct values and no
 *  seventh (measured 2026-09-04). It would have to be posted by hand. Noted
 *  rather than fixed, so the next reader knows it was considered. */
export function isRejectGrade(grade: string | null | undefined): boolean {
  const head = String(grade ?? "")
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "")
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z0-9]+/, "")
    .split(/[^A-Z0-9]/)[0];
  return head === "C";
}

/** THE LIMITS A PHOTO HAS TO CLEAR, AND THEY LIVE HERE SO BOTH SIDES ASK THE
 *  SAME QUESTION.
 *
 *  The server has always enforced three conditions — present and non-empty, at
 *  most 8 MB, an image and not an SVG (script risk). The two QC screens' own
 *  submit guards checked only the FIRST of the three, so a file could pass on
 *  screen and be refused by the server, and the operator would be refused for a
 *  photo they HAD attached with nothing on screen explaining why. On a live line
 *  that is not a cosmetic mismatch: the way out of a form that will not save is
 *  to type a different grade, which is the corruption this whole rule exists to
 *  prevent.
 *
 *  It bites because PhotoField hands a file under 500 KB straight through
 *  untouched, never inspecting its type, and puts the ORIGINAL back when
 *  compression fails. So a small file with an empty or non-image MIME reaches
 *  the form marked "ready".
 *
 *  This module is import-free, which is the point: entryPhoto.ts imports prisma
 *  and so can never be pulled into a client component. The rule is spelled once,
 *  here, and entryPhoto's requiredPhotoProblem is a thin wrapper over it. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export function photoProblem(f: unknown, label: string): string | null {
  if (!(f instanceof File) || f.size === 0) return `The ${label} is required — attach it before saving.`;
  if (f.size > PHOTO_MAX_BYTES) return `The ${label} is too large (max 8 MB) — retake or pick a smaller one.`;
  if (!f.type.startsWith("image/") || f.type.startsWith("image/svg")) return `The ${label} must be a photo (image file; SVG is not accepted).`;
  return null;
}

/** Does this save have to carry the pair? Only on the models that offer the
 *  pair at all, and only for a reject — every other grade is unchanged. */
export function rejectPhotosRequired(model: string, grade: string | null | undefined): boolean {
  return hasPhotoPair(model) && isRejectGrade(grade);
}

// ---------------------------------------------------------------------------
// THE DECISION, as a pure function.
//
// rejectPhotosRequired above answers "does this grade need the pair". THIS
// answers the whole question the server actually asks — which is four rules
// deep, and until 2026-09-04 lived only inside tables/actions.ts as branches
// no test could reach. Its four server-side tests matched the SOURCE TEXT with
// regexes, so every one of them still passed with the branches inverted, with
// the already-on-file skip widened to both slots, or with the loop returning
// "allowed" on the first satisfied slot. The predicate was covered; the
// decision was not. It is import-free like the rest of this file, so
// `node --test` unit-tests it directly.
//
// The caller does the I/O — read the stored row, validate the FormData — and
// hands the four facts in. Nothing here reads a database or a file.
// ---------------------------------------------------------------------------

/** Why a save was allowed through, or which slot it is refused for. The `why`
 *  is not decoration: a test that only checked `refuse` would pass on a
 *  decision that allowed the save for entirely the wrong reason. */
export type RejectPhotoDecision =
  | { refuse: false; why: "not-a-reject" | "pair-supplied" | "already-a-reject" | "on-file" }
  | { refuse: true; slot: PhotoSlotName };

export function rejectPhotoDecision(input: {
  /** The entry model being written. Only PHOTO_PAIR_MODELS can be asked. */
  model: string;
  /** The grade this save will STORE (after any "Not graded yet" default). */
  grade: string | null | undefined;
  /** The grade already on the row. null on a CREATE — there is no row yet, and
   *  a create must never be let through by a previous grade it does not have. */
  prevGrade?: string | null | undefined;
  /** Slots with a photo ALREADY in entry_photo. Empty on a create. */
  storedSlots?: readonly PhotoSlotName[];
  /** Slots THIS request did not carry a usable photo for — the caller has
   *  already applied the store's own size/type limits, so a 9 MB file that the
   *  save would silently drop counts as missing here. */
  missingSlots: readonly PhotoSlotName[];
}): RejectPhotoDecision {
  const { model, grade, prevGrade = null, storedSlots = [], missingSlots } = input;
  if (!rejectPhotosRequired(model, grade)) return { refuse: false, why: "not-a-reject" };
  if (missingSlots.length === 0) return { refuse: false, why: "pair-supplied" };
  // ALREADY a reject before this save: not re-judged. Measured on live Neon
  // 2026-09-04: 1,254 'C (Reject)' rows, of which exactly ONE carries both
  // photos (6 have only a far, 8 only a near, 1,239 neither) — because the pair
  // was optional here until 2026-09-03. Re-judging every edit would make the
  // other 1,253 uncorrectable forever, for slabs nobody can photograph now.
  // The owner confirmed this shape on 2026-09-04.
  //
  // THAT COUNT MOVES with the line — it read 1,253 earlier the same day, and
  // rises every time QC rejects a slab. Re-measure it, don't trust it. What
  // does not move is the shape: the rule bites on a grade being CHANGED to a
  // reject, never on an edit to a row that was already one.
  if (isRejectGrade(prevGrade)) return { refuse: false, why: "already-a-reject" };
  const stored = new Set(storedSlots);
  const missing = new Set(missingSlots);
  // PHOTO_SLOTS order, not the caller's — the refusal names far before near
  // however the caller assembled its list.
  for (const p of PHOTO_SLOTS) {
    if (!missing.has(p.slot)) continue;
    if (stored.has(p.slot)) continue;   // on file already — never demand it twice
    return { refuse: true, slot: p.slot };
  }
  return { refuse: false, why: "on-file" };
}

// ---------------------------------------------------------------------------
// THE FORMS THAT CANNOT TAKE A REJECT AT ALL
//
// Owner, 2026-09-04, on the batch "Add & verify slab" screen: "Dont let it add
// c grade slabs. Instead prompt the user saying you can only add non-c grade
// slabs; if you really want to add c grade slabs either do it from tables or
// from the qc form."
//
// That screen exists to fill a GAP in a batch — it copies a neighbouring slab's
// values and posts them, and it renders no photo input of any kind. Bolting the
// pair onto it would put a camera on a form built for a different job; refusing
// the grade and naming the two screens that DO take a reject is the honest
// shape. Naming them is the point: an operator standing at the batch screen
// needs to know where to go, not merely that they cannot proceed here.
// ---------------------------------------------------------------------------

/** Where a reject CAN be recorded, in the plant's own words. One sentence, so
 *  the form banner and the server refusal cannot describe two different routes. */
export const REJECT_GRADE_ROUTE =
  "Add it as “Not graded yet” here, then grade it C (Reject) where the photos can be attached: " +
  "the Polish QC entry form (Entry → Polish QC), or the slab’s row in Tables → Polish QC.";

/** The refusal for a form that posts no photos. Built from PHOTO_SLOTS so the
 *  two views are named the same here as on every other screen. */
export const REJECT_GRADE_NOT_HERE_MESSAGE =
  `⚠ Only non-C-grade slabs can be added here. ${REJECT_PHOTOS_RULE} ` +
  `— the ${PHOTO_SLOTS.map((p) => p.label).join(" and the ")} — ` +
  `and this screen has no photo fields. ${REJECT_GRADE_ROUTE}`;

/** One refusal sentence for a photoless form, or null. Same predicate as the
 *  guard on the QC paths, so "is this a reject" is still spelled once. */
export function rejectGradeNotHere(model: string, grade: string | null | undefined): string | null {
  return rejectPhotosRequired(model, grade) ? REJECT_GRADE_NOT_HERE_MESSAGE : null;
}

/** Leading text of a message that means THE ROW LANDED AND A SIDE EFFECT DID
 *  NOT — here, the reject's photo. Already this repo's spelling for that class
 *  of answer (tables/actions.ts says the same about a silo deduction that
 *  failed); named here so the server can build it and the two QC screens can
 *  recognise it without matching on prose.
 *
 *  It is NEITHER of the two things a screen usually paints. Green would be the
 *  lie the slab-intake form documents — "a green line and a form that clears
 *  itself is how an operator walked away from a slab whose photo was never
 *  stored". Red is the opposite lie: it reads as "nothing saved", and the way
 *  an operator answers that is to enter the slab again. */
export const PHOTO_WARN_PREFIX = "⚠ Saved";
