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

/**
 * THE NOMINAL SLAB: 347 × 201 cm — 6.9747 sqm, 75.076 sqft, the CIOT
 * measurement list's own figures and what the packing list, the challan and the
 * workbook have always printed.
 *
 * Finished goods STORES that slab as 137 × 79 INCHES on 27,097 of 27,099 rows —
 * nominal, not measured. Those inches are a ROUNDED DISPLAY of the centimetres:
 * 347 cm is 136.61 in and 201 cm is 79.13 in. Squaring the rounded pair gives
 * 75.16, which is 0.11% high, and it is why the same slab read 75.16 on the
 * Finished Goods page and 75.076 on the packing list of the same shipment.
 * The centimetres are the measurement; the inches are how we show it.
 */
export const NOMINAL_SLAB_LENGTH_IN = 137;
export const NOMINAL_SLAB_WIDTH_IN = 79;
export const NOMINAL_SLAB_SQM = 6.9747;
export const NOMINAL_SLAB_SQFT = 75.076;

/**
 * Square feet from inch sides — one formula, so a slab reads the same area on
 * the Finished Goods page, on a hold, on a packing list and in Salesforce.
 *
 * THE NOMINAL PAIR IS ANSWERED FROM THE CENTIMETRES, not by multiplying the
 * inches, for the reason above: 137 × 79 does not mean "a slab measured at 137
 * by 79", it means "a slab nobody measured", and the nominal slab's area is a
 * known figure rather than something to re-derive from its own rounding. Any
 * other pair IS a real measurement — a cut-down, an offcut, a piece — and is
 * multiplied out as before.
 */
export function sqftFromIn(lengthIn: number, widthIn: number): number {
  if (lengthIn === NOMINAL_SLAB_LENGTH_IN && widthIn === NOMINAL_SLAB_WIDTH_IN) return NOMINAL_SLAB_SQFT;
  return round(lengthIn * widthIn / 144, 2);
}

/** Square metres for the same pair, on the same rule. */
export function sqmFromIn(lengthIn: number, widthIn: number): number {
  if (lengthIn === NOMINAL_SLAB_LENGTH_IN && widthIn === NOMINAL_SLAB_WIDTH_IN) return NOMINAL_SLAB_SQM;
  return sqmFromCm(inToCm(lengthIn), inToCm(widthIn));
}

/** Everything the measurement list prints for one slab, from the inventory
 *  row's inches. Measured centimetres, when the floor has them, override. */
export function slabMeasure(lengthIn: number | null | undefined, widthIn: number | null | undefined, measured?: { lengthCm?: number | null; widthCm?: number | null }): { lengthCm: number; widthCm: number; sqm: number; sqft: number } {
  const lengthCm = measured?.lengthCm ?? inToCm(lengthIn ?? NOMINAL_SLAB_LENGTH_IN);
  const widthCm = measured?.widthCm ?? inToCm(widthIn ?? NOMINAL_SLAB_WIDTH_IN);
  // inToCm ROUNDS to whole centimetres, so the nominal pair arrives here as
  // 348 × 201 rather than the sheet's 347 × 201 and would read 75.29. When the
  // floor has not measured the slab, answer with the nominal figures.
  const nominal = !measured?.lengthCm && !measured?.widthCm
    && (lengthIn ?? NOMINAL_SLAB_LENGTH_IN) === NOMINAL_SLAB_LENGTH_IN
    && (widthIn ?? NOMINAL_SLAB_WIDTH_IN) === NOMINAL_SLAB_WIDTH_IN;
  if (nominal) return { lengthCm: 347, widthCm: 201, sqm: NOMINAL_SLAB_SQM, sqft: NOMINAL_SLAB_SQFT };
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
