// The far/near photo pair, defined ONCE.
//
// Two screens carry it. On the slab-intake form both are REQUIRED before a slab
// may be created; on the Polish QC form (and the tables editor behind it) both
// are optional. Required-or-not is the caller's rule — everything else is the
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
 *  are worth having — optional, unlike the intake form's. The tables editor
 *  reads the same set, so a record's edit screen offers exactly the slots its
 *  entry form did. */
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
