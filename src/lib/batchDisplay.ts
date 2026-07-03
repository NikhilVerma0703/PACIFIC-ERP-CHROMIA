// Inventory display rule: batches show without letter prefixes or leading
// zeros ("D1371" -> "1371", "A089"/"089" -> "89"). Pure + client-safe; the
// underlying data (QC-owned batch text) is never modified.
export function displayBatch(b: string | null | undefined): string {
  if (b == null || String(b).trim() === "") return "—";
  const t = String(b).trim();
  const s = t.replace(/^[A-Za-z\s.\-]+/, "").replace(/^0+(?=\d)/, "");
  return s || t;
}
