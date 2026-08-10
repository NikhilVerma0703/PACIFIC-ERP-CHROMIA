// The /api/fab/slabs query contract, shared by the route and the three pickers.
//
// Pure and dependency-free on purpose: the route needs it server-side, the
// picker hook needs it client-side, and the tests need it with neither.

/* -- Thickness ------------------------------------------------------------- */

// Slab thickness parsing for the fabrication slab picker.
//
// PolishQc.slabThickness is free text typed by the QC inspector. The values
// actually present in the live table, by frequency, are:
//
//   "3 cm" 23910 · "2 cm" 16900 · "3 cm to 2 cm" 2052 · "12 mm" 475 ·
//   "2cm to 8mm" 133 · "2 cm to 1 cm" 83 · "2cm to 12 mm" 40 · NULL 29 ·
//   "1.2 cm" 5 · "3cm to 8mm" 1
//
// Note the spaces: the "3cm"/"2cm" keys in THICKNESS_MAP match almost nothing,
// and it is the parseFloat fallback that does the real work.

const THICKNESS_MAP: Record<string, number> = {
  "2cm": 20,
  "3cm": 30,
  "1.2cm": 12,
  "1.5cm": 15,
  "2.5cm": 25,
};

export function parseThicknessMm(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalised = raw.trim().toLowerCase();
  if (THICKNESS_MAP[normalised]) return THICKNESS_MAP[normalised];
  // Try to extract a number directly (e.g. "30mm" → 30, "3" → 30 assuming cm)
  const mm = parseFloat(normalised);
  if (!isNaN(mm)) return mm < 10 ? mm * 10 : mm; // treat <10 as cm
  return null;
}

/**
 * SQL prefilter for a thickness. Free text cannot be compared to a number in
 * SQL, so the query narrows on the leading figure and parseThicknessMm makes
 * the exact call afterwards on whatever survives.
 *
 * The contract that matters: these prefixes must ADMIT every string that
 * parseThicknessMm maps to `mm`. Admitting extras is free — they are dropped by
 * the exact check — but missing one hides a real slab from the picker, which is
 * indistinguishable from the stock not existing.
 */
export function thicknessPrefixes(mm: number): string[] {
  if (mm === 12) return ["12", "1.2"];
  if (mm % 10 === 0) return [String(mm / 10), String(mm)];
  return [String(mm)];
}


/* -- Query ----------------------------------------------------------------- */

/** Server-side page size. Kept in step with DEFAULT_LIMIT in the route. */
export const QC_SLAB_PAGE = 200;

/** Pure, so the query a picker sends can be asserted without a DB or a fetch. */
export function qcSlabsUrl(search: string, thicknessMm: number | null): string {
  const p = new URLSearchParams();
  const s = search.trim();
  if (s) p.set("search", s);
  // Only 3cm pieces constrain thickness; 2cm and unknown take any slab.
  if (thicknessMm) p.set("thickness", String(thicknessMm));
  const qs = p.toString();
  return qs ? `/api/fab/slabs?${qs}` : "/api/fab/slabs";
}
