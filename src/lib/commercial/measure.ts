// Slab measurements — PURE. Finished goods stores inches (137 × 79 default on
// 17,436 of 17,438 available slabs, i.e. nominal not measured); the export
// measurement list prints centimetres and square metres (347 × 201 → 6.9747
// sqm → 75.0757 sqft on the CIOT list). One set of conversions, used by the
// packing list, the measurement list and the workbook, so the three agree.

// 10.764, the factor the company's own sheets use (CIOT measurement list:
// 6.9747 sqm → 75.0756708 sqft; the challan's scratch cells: cm² / 10000 ×
// 10.764). Not the exact 10.7639104 — matching the documents matters more
// than the fourth decimal, and the two differ by a thousandth of a sqft per slab.
export const SQFT_PER_SQM = 10.764;
export const CM_PER_IN = 2.54;

const round = (n: number, dp: number): number => { const f = 10 ** dp; return Math.round(n * f) / f; };

/** Inches → whole centimetres. 137 in → 348 cm; 79 in → 201 cm. */
export function inToCm(inches: number): number {
  return Math.round(inches * CM_PER_IN);
}

/** Square metres from centimetre sides, 4 dp. 347 × 201 → 6.9747. */
export function sqmFromCm(lengthCm: number, widthCm: number): number {
  return round(lengthCm * widthCm / 10000, 4);
}

/** Square feet from square metres, 3 dp. 6.9747 → 75.076. */
export function sqftFromSqm(sqm: number): number {
  return round(sqm * SQFT_PER_SQM, 3);
}

/** Square feet from inch sides, 2 dp — the inventory module's own formula
 *  (lengthIn × widthIn / 144), kept identical so a slab reads the same sqft on
 *  the Finished Goods page and on a hold. 137 × 79 → 75.16. */
export function sqftFromIn(lengthIn: number, widthIn: number): number {
  return round(lengthIn * widthIn / 144, 2);
}

/** Everything the measurement list prints for one slab, from the inventory
 *  row's inches. Measured centimetres, when the floor has them, override. */
export function slabMeasure(lengthIn: number | null | undefined, widthIn: number | null | undefined, measured?: { lengthCm?: number | null; widthCm?: number | null }): { lengthCm: number; widthCm: number; sqm: number; sqft: number } {
  const lengthCm = measured?.lengthCm ?? inToCm(lengthIn ?? 137);
  const widthCm = measured?.widthCm ?? inToCm(widthIn ?? 79);
  const sqm = sqmFromCm(lengthCm, widthCm);
  return { lengthCm, widthCm, sqm, sqft: sqftFromSqm(sqm) };
}

/** Sum a column to a given dp without drift from float addition. */
export function sumTo(values: number[], dp: number): number {
  return round(values.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0), dp);
}
