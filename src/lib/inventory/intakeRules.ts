// Pure rules for the slab intake form (/slab-intake) — parsing, vocabulary and
// validation, with every refusal a sentence that names its reason. No imports
// beyond grading.ts and photoSlots.ts (both import-free), so node --test
// reaches all of it directly (tests/slabIntakeAccess.test.ts).
// Explicit .ts extension, as sampling/actions.ts does: node's strict ESM
// resolution (node --test) needs it, and the bundler is indifferent.
import { TRANSITIONS } from "./grading.ts";

/** The canonical grade vocabulary the form offers. A/A2/B/C/CTS/Printing is the
 *  exclusive set FinishedSlab.grade documents ("Printing" is how a Chromia
 *  printed slab is graded); SAMPLE is included because grading.ts already
 *  treats it as a real grade (SAMPLE_GRADE, CUT_GRADES) — a slab cut down for
 *  samples is a fact this form must be able to record, not invent a spelling
 *  for. */
export const GRADE_OPTIONS = ["A", "A2", "B", "C", "CTS", "SAMPLE", "Printing"] as const;

/** The SlabStatus enum members, in lifecycle order. A hand copy of prisma's
 *  enum because this module must stay import-free for the tests — the drift
 *  guard is the test asserting this list equals the set of statuses TRANSITIONS
 *  (grading.ts) moves between.
 *
 *  THIS LIST VALIDATES; IT NO LONGER POPULATES A PICKER. That split is the whole
 *  point of the pair, and it was one constant doing both jobs until 2026-09-03.
 *  validateSlabDetails checks against THIS list, so every status the database
 *  can hold stays writable — including CTS, which exactly one row carries
 *  (slab 154757, Arva White, grade B, mark CTS — measured on live Neon
 *  2026-09-03; the other counts that day were AVAILABLE 16,585, DISPATCHED
 *  6,742, CHROMIA 62, and RESERVED / PACKED / RETURNED nil). Taking CTS out of
 *  here to stop OFFERING it would have made that one row unsaveable: open it in
 *  the intake form, correct its bay, and the save would be refused for a status
 *  nobody touched. */
export const SLAB_STATUSES = ["AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED", "CTS", "CHROMIA"] as const;

/** The statuses a PICKER may offer from a standing start — SLAB_STATUSES minus
 *  the two that are somebody else's to write.
 *
 *  CHROMIA is the Chromia register's (statusChangeRefusal below refuses a hand
 *  write outright); it was already filtered out at the point of use in
 *  SlabIntakeForm and has simply moved here, so the rule is stated once.
 *
 *  CTS is new here, and it is the owner's call: "look at any status filter in
 *  finished goods. It has CTS which should ideally not be there as we have moved
 *  it to any mark filter right?" He is right — since scripts/0070 the fact that
 *  a slab has been CUT lives in slab_mark, and 63 rows carry slab_mark = 'CTS'
 *  (61 on the floor, measured on live Neon 2026-09-03) against the ONE row that
 *  carries status = 'CTS'. Offering the status as if it answered "what has been
 *  cut" points the reader at 1 slab and away from 61.
 *
 *  NOT OFFERED IS NOT THE SAME AS NOT ALLOWED, and the distinction is the safety
 *  property here: a row that already holds one of these statuses must still be
 *  editable, so the callers re-add the current status as an option (the rule
 *  SlabIntakeForm applies, and the same guard the inventory dashboard's grade
 *  and thickness selects have always used for a value that is set but not
 *  offered). Nothing here narrows what the API accepts — that is SLAB_STATUSES,
 *  above, and it is unchanged. */
export const SLAB_STATUS_OPTIONS = SLAB_STATUSES.filter((s) => s !== "CHROMIA" && s !== "CTS");

/** Every status TRANSITIONS knows — what the drift test compares SLAB_STATUSES against. */
export const statusesFromTransitions = (): string[] =>
  [...new Set(Object.values(TRANSITIONS).flatMap((t) => [...t.from, t.to]))].sort();

/** The fields the form may write, with their plant-language labels — used for
 *  the per-field SlabEvent lines and for the "corrected grade, bay" sentence. */
export const FIELD_LABEL: Record<string, string> = {
  design: "design",
  grade: "grade",
  slabThickness: "thickness",
  qualityIssue: "quality issues",
  polishType: "polish",
  rwStatus: "R/W status",
  repolishStatus: "repolish status",
  batchNumber: "batch",
  lengthIn: "length",
  widthIn: "width",
  bayNumber: "bay",
  frameNumber: "frame",
  status: "status",
  notes: "notes",
};

/** The two defect photos (owner, 2026-08-29: "add 2 photo one far photo and
 *  one near photo of the defect mandatory"). One row each in entry_photo
 *  against the FinishedSlab id; the filename prefix is what keeps the two
 *  slots tellable apart when read back.
 *
 *  The PAIR ITSELF now lives in lib/photoSlots, because the Polish QC form and
 *  the tables editor carry the same two photographs of the same slab (owner,
 *  2026-09-01) and a second copy of the field names would drift. What stays
 *  this form's own is the RULE about them — here they are mandatory — which is
 *  written in actions.ts and SlabIntakeForm.tsx, not in the list. Re-exported
 *  under the old name so this module remains the intake form's one vocabulary,
 *  and with the .ts extension so node --test still resolves the chain. */
export { PHOTO_SLOTS as DEFECT_PHOTOS } from "../photoSlots.ts";
export type { PhotoSlotName as DefectPhotoSlot } from "../photoSlots.ts";

/** What a save carries. Strings are trimmed-or-null; qualityIssue is the whole
 *  list (chips), replaced as a set. */
export interface SlabDetailsInput {
  design: string | null;
  grade: string | null;
  slabThickness: string | null;
  qualityIssue: string[];
  polishType: string | null;
  rwStatus: string | null;
  repolishStatus: string | null;
  batchNumber: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  bayNumber: string | null;
  frameNumber: string | null;
  status: string;
  notes: string | null;
}

/**
 * Parse what was typed into the slab-number box.
 *
 * NON-INTEGER NUMBERS ARE REFUSED with the same "pending the decimal-slab
 * decision" answer autolinkFinishedSlabFromQc gives: insert slabs like
 * 144338.1 are deliberately not in finished goods yet, and a manual side door
 * for them would pre-empt that decision one keystroke at a time.
 */
export function parseSlabNumber(input: unknown): { ok: true; slab: number } | { ok: false; message: string } {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, message: "Enter a slab number first." };
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return { ok: false, message: `"${raw}" is not a number — the slab number is the figure printed on the slab.` };
  if (!Number.isInteger(n))
    return { ok: false, message: `Slab ${raw} is not a whole number — insert slabs like this are not in finished goods yet, pending the decimal-slab decision.` };
  if (n <= 0) return { ok: false, message: "A slab number is a positive number." };
  if (n > 100_000_000) return { ok: false, message: `Slab ${raw} is too large to be a real slab number — check the figure.` };
  return { ok: true, slab: n };
}

/**
 * CHROMIA is written by the Chromia intake bridge, never by hand: the status
 * means "the Chromia register has this slab", and a hand write would assert
 * that without the register knowing. The way IN is recording the slab in the
 * Chromia register; this form's status box is only the way OUT of a wrong
 * mark. Keeping a slab that is already CHROMIA as CHROMIA is a no-op, not a
 * hand write, and stays allowed — or an edit to any other field would be
 * refused for not also changing the status.
 */
export function statusChangeRefusal(current: string | null, next: string): string | null {
  if (next === "CHROMIA" && current !== "CHROMIA")
    return "CHROMIA is set by the Chromia register, not by hand — record the slab in the Chromia operator register and this sheet will follow.";
  return null;
}

/** The bays the plant has. The vocabulary the bay box is checked against. */
export const BAYS = ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5"] as const;

/** "bay2", "BAY 2", "bay-2", plain "2" — all the same bay, stored one way so
 *  the inventory filter has one value per bay instead of five spellings. A
 *  value that is not a bay at all is returned untouched for validation to name. */
export function normalizeBay(v: string | null): string | null {
  if (v === null) return null;
  const m = /^(?:bay)?[\s-]*([1-5])$/i.exec(v.trim());
  return m ? `Bay ${m[1]}` : v;
}

/** The refusal for a bay being WRITTEN. Deliberately not part of
 *  validateSlabDetails: an existing row may carry a legacy spelling from a
 *  bulk upload, and correcting the slab's GRADE must not be refused over a bay
 *  nobody touched — the rule gates what this form writes, not what it found. */
export function bayRefusal(bay: string | null): string | null {
  if (bay !== null && !(BAYS as readonly string[]).includes(bay))
    return `"${bay}" is not a bay — the bays are ${BAYS[0]} to ${BAYS[BAYS.length - 1]}, or leave it empty.`;
  return null;
}

/** Trim to null, capped — the same shape the admin slab-edit route uses. */
export const cleanText = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s === "" ? null : s;
};

/** The quality-issue chips as stored: trimmed, deduped (case-insensitively —
 *  "Pinhole" and "pinhole" are one issue), empties dropped, capped. */
export function cleanIssues(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Map<string, string>();
  for (const v of list) {
    const s = String(v ?? "").trim().slice(0, 80);
    if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  }
  return [...seen.values()].slice(0, 20);
}

/** One refusal sentence, or null when the details can be saved. Checked again
 *  in the server action — the form saying so first is a courtesy, not the gate. */
export function validateSlabDetails(d: SlabDetailsInput): string | null {
  if (d.grade !== null && !(GRADE_OPTIONS as readonly string[]).includes(d.grade))
    return `"${d.grade}" is not a grade this inventory uses — pick one of ${GRADE_OPTIONS.join(" / ")}, or leave it not graded.`;
  if (!(SLAB_STATUSES as readonly string[]).includes(d.status))
    return `"${d.status}" is not a slab status.`;
  for (const [k, label] of [["lengthIn", "length"], ["widthIn", "width"]] as const) {
    const v = d[k];
    if (v === null) continue;
    if (!Number.isFinite(v) || v <= 0) return `The ${label} must be a positive number of inches.`;
    if (v > 1000) return `${v}" is not a slab ${label} — dimensions are in inches (a full slab is 137" × 79").`;
  }
  return null;
}

/** The save confirmation: every action result is a sentence. */
export function savedSentence(slab: number, created: boolean, changedFields: string[]): string {
  if (created) return `Slab ${slab} added to finished goods.`;
  if (changedFields.length === 0) return `Nothing changed on slab ${slab} — nothing was saved.`;
  const labels = changedFields.map((f) => FIELD_LABEL[f] ?? f);
  return `Slab ${slab}: corrected ${labels.join(", ")}.`;
}
