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

export type StatusAction = "reserve" | "release" | "pack" | "dispatch" | "return";

/** Slab lifecycle: which statuses each action may move FROM, and where it lands. */
export const TRANSITIONS: Record<StatusAction, { from: string[]; to: string }> = {
  reserve:  { from: ["AVAILABLE", "RETURNED"],              to: "RESERVED" },
  release:  { from: ["RESERVED", "PACKED", "RETURNED"],     to: "AVAILABLE" },
  pack:     { from: ["AVAILABLE", "RESERVED", "RETURNED"],  to: "PACKED" },
  dispatch: { from: ["AVAILABLE", "RESERVED", "PACKED"],    to: "DISPATCHED" },
  return:   { from: ["DISPATCHED"],                         to: "RETURNED" },
};

export const DEFAULT_RESERVATION_DAYS = 7;
