/**
 * Normalize a batch identifier so the two-stream numbering joins exactly.
 * Matches the Airtable "Batch wastage table update" automation's regex, and
 * additionally collapses inner whitespace / thousands separators so that
 * "1 194", "1,194" and "1194" all resolve to the same batch.
 *   uppercase, remove spaces/commas, strip a leading run of letters + optional hyphen.
 *   "C1185" -> "1185", "D1310" -> "1310", "C-9885" -> "9885",
 *   "1 194" -> "1194", "1,194" -> "1194", "1310" -> "1310"
 *
 * Design-switch sub-batches: when production switches design mid-batch, the
 * excursion is recorded as the parent number + a letter suffix. "1350-A",
 * "1350a" and "1350 A" all canonicalise to "1350-A". Plain numeric batches are
 * untouched, and parentBatch("1350-A") === "1350".
 */
export function normalizeBatch(s: unknown): string {
  if (!s) return "";
  const str = String(s).trim().toUpperCase().replace(/[\s,]+/g, "");
  const stripped = str.replace(/^[A-Z]+-?/, "").trim();
  const base = stripped || str;
  // Sub-batch suffix: digits + optional hyphen + trailing letters -> "digits-LETTERS".
  const m = base.match(/^(\d+)-?([A-Z]+)$/);
  return m ? `${m[1]}-${m[2]}` : base;
}

/** The parent batch of a sub-batch ("1350-A" -> "1350"); a plain batch is its own parent. */
export function parentBatch(s: unknown): string {
  const key = normalizeBatch(s);
  const m = key.match(/^(\d+)-[A-Z]+$/);
  return m ? m[1] : key;
}

/** True if this is a design-switch sub-batch (has a letter suffix, e.g. "1350-A"). */
export function isSubBatch(s: unknown): boolean {
  return /^\d+-[A-Z]+$/.test(normalizeBatch(s));
}
