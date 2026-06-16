// Canonical slab-thickness handling. Nominal thickness is one of three values;
// data has historically been entered inconsistently ("2cm", "2 cm", "20mm",
// "2"), so we canonicalise to a single spaced form everywhere.
// Pure module — no server imports, safe in client bundles.

export const THICKNESS_FIELDS = new Set(["slabThickness", "thickness"]);
export const THICKNESS_OPTS = ["1.2 cm", "2 cm", "3 cm", "7 mm"];

/** Map any thickness spelling to one of the canonical options; unknown values pass through. */
export function canonThickness(v: unknown): string {
  if (v == null || v === "") return "";
  const raw = String(v).trim();
  const s = raw.toLowerCase().replace(/\s+/g, "");
  let n = NaN;
  const cm = s.match(/^(\d+(?:\.\d+)?)cm$/);
  const mm = s.match(/^(\d+(?:\.\d+)?)mm$/);
  const plain = s.match(/^(\d+(?:\.\d+)?)$/);
  if (cm) n = parseFloat(cm[1]);
  else if (mm) n = parseFloat(mm[1]) / 10;
  else if (plain) { const p = parseFloat(plain[1]); n = p >= 10 ? p / 10 : p; } // 12/20/30 => mm
  if (Number.isFinite(n)) {
    if (Math.abs(n - 0.7) < 0.05) return "7 mm";
    if (Math.abs(n - 1.2) < 0.05) return "1.2 cm";
    if (Math.abs(n - 2) < 0.05) return "2 cm";
    if (Math.abs(n - 3) < 0.05) return "3 cm";
  }
  return raw;
}
