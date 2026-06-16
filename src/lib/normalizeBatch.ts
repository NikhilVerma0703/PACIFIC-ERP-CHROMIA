/**
 * Normalize a batch identifier so the two-stream numbering joins exactly.
 * Matches the Airtable "Batch wastage table update" automation's regex, and
 * additionally collapses inner whitespace / thousands separators so that
 * "1 194", "1,194" and "1194" all resolve to the same batch.
 *   uppercase, remove spaces/commas, strip a leading run of letters + optional hyphen.
 *   "C1185" -> "1185", "D1310" -> "1310", "C-9885" -> "9885",
 *   "1 194" -> "1194", "1,194" -> "1194", "1310" -> "1310"
 */
export function normalizeBatch(s: unknown): string {
  if (!s) return "";
  const str = String(s).trim().toUpperCase().replace(/[\s,]+/g, "");
  const normalized = str.replace(/^[A-Z]+-?/, "").trim();
  return normalized || str;
}
