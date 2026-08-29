// Pure rules for the slab intake form (/slab-intake) — parsing, vocabulary and
// validation, with every refusal a sentence that names its reason. No imports
// beyond grading.ts (itself import-free), so node --test reaches all of it
// directly (tests/slabIntakeAccess.test.ts).
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

/** The SlabStatus enum members, in lifecycle order for the select. A hand
 *  copy of prisma's enum because this module must stay import-free for the
 *  tests — the drift guard is the test asserting this list equals the set of
 *  statuses TRANSITIONS (grading.ts) moves between. */
export const SLAB_STATUSES = ["AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED", "CTS"] as const;

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
