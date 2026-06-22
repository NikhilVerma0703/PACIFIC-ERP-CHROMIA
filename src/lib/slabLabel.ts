// Slab-number display/label helper.
// Slab numbers are stored as Float. Whole numbers are the normal sequence
// (1, 2, 3...). An "insert" slab produced between two numbers is stored as a
// decimal (1.1, 1.2, ...) but shown to operators as a letter suffix: 1.1 -> "1a",
// 1.2 -> "1b", ... 1.9 -> "1i". This keeps the integer sequence (and its
// gap-detection) intact while letting the floor record an extra in-between slab.

const LETTERS = "abcdefghi"; // .1 -> a ... .9 -> i

/** Human label for a stored slab number: 1 -> "1", 1.1 -> "1a", 1.2 -> "1b". */
export function slabLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  const dec = Math.round((n - whole) * 10);
  if (dec >= 1 && dec <= 9) return `${whole}${LETTERS[dec - 1]}`;
  return String(n); // unusual fraction (e.g. 1.25) — show as-is
}

/** Parse operator input into a stored slab number.
 *  "12" -> 12, "1.1" -> 1.1, "1a" -> 1.1, "12c" -> 12.3. Returns null if invalid. */
export function parseSlabInput(raw: unknown): number | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const suffix = s.match(/^(\d+)\s*([a-i])$/); // "1a" / "12 c"
  if (suffix) {
    const whole = parseInt(suffix[1], 10);
    const dec = LETTERS.indexOf(suffix[2]) + 1; // a -> 1
    return Number.isFinite(whole) ? whole + dec / 10 : null;
  }
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); return Number.isFinite(n) ? n : null; }
  return null;
}

/** True for an "insert" slab (a decimal between two whole numbers). */
export function isInsertSlab(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && !Number.isInteger(n);
}
