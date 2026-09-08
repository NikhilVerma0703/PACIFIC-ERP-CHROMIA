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

// ───────────────────────── the list's own unit (answer 17) ───────────────────
// A packing list is stored in centimetres whatever it prints in: the owner
// wants a switch between "347 × 201" and "137 × 79" on the same list, and a
// store that changed with the switch would turn every area on the sheet into a
// different number each time somebody toggled it. So the switch converts at the
// edge — display and typed input — and the row underneath never moves.

export type MeasurementUnit = "cm" | "in";
export const MEASUREMENT_UNITS: readonly MeasurementUnit[] = ["cm", "in"];
export const UNIT_LABEL: Record<MeasurementUnit, string> = { cm: "cm", in: "in" };

/** "cm" / "in" from whatever the body or the settings row carries; null for
 *  anything else, so a typo never becomes a third unit. */
export function parseMeasurementUnit(v: unknown): MeasurementUnit | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "cm" || s === "in" ? s : null;
}

/** Centimetres → inches to 1 dp. 348 → 137.0; 347 → 136.6. */
export function cmToIn(cm: number): number {
  return round(cm / CM_PER_IN, 1);
}

/** Typed inches → centimetres to 1 dp (the column's own precision), NOT the
 *  whole-centimetre rounding inToCm applies to the inventory's nominal sizes:
 *  a clerk who types 136.6 in has measured to the tenth and gets 347.0 back,
 *  not 347 rounded from 346.96 and then re-read as 136.6 by luck. */
export function cmFromIn(inches: number): number {
  return round(inches * CM_PER_IN, 1);
}

/** A figure off a form field or a Decimal column as a number, or null when
 *  there is none. An EMPTY STRING IS NULL, not zero: Number("") is 0, and an
 *  emptied size cell that stored 0 cm would print a slab of no area. */
function figure(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A stored centimetre figure as the list's unit shows it. Null stays null. */
export function sizeInUnit(cm: number | null | undefined, unit: MeasurementUnit): number | null {
  const n = figure(cm);
  if (n === null) return null;
  return unit === "in" ? cmToIn(n) : round(n, 1);
}

/** A figure typed in the list's unit, as the centimetres the row stores. */
export function sizeToCm(value: number | null | undefined, unit: MeasurementUnit): number | null {
  const n = figure(value);
  if (n === null) return null;
  return unit === "in" ? cmFromIn(n) : round(n, 1);
}
