// SHOW THE SIZE THE CUSTOMER WROTE. Calculate in the size the saw needs.
//
// The owner, on the Kerasom order: "show like in the po and calculate the feet
// correctly, that's it." Both halves of that sentence matter, and they pull in
// opposite directions.
//
// ─────────────────────── THE TWO NUMBERS ARE NOT THE SAME NUMBER ────────────
// fab_requirement.length/width are INCHES, always, on every row, and they must
// stay that way. Everything downstream is built on it:
//
//     sqft_per_piece   = length * width / 144      (square INCHES to sq ft)
//     running feet     = perimeter / 12            (INCHES to feet)
//
// and running feet is what edge polish is charged by, at Rs15 (2 cm) or Rs20
// (3 cm) a foot. Put a centimetre in those columns and one row of 500 thresholds
// goes from Rs52,165 to Rs1,32,500 — a 2.54x overcharge that looks completely
// ordinary on screen, because nothing about "17.67 ft" announces itself as wrong.
//
// But PI SAL-ORD/25-26/01200 is a Dutch order and is centimetres from top to
// bottom: "DS - Thresholds (103 x 3)", 2 CM thick, priced per SQMT. The man at
// the saw is holding that piece of paper. If his screen says 40.5512 x 1.1811
// he has to do the conversion in his head, against a document, at speed — and
// that is how the wrong piece gets cut.
//
// So: the inches are stored, the unit is remembered beside them
// (fab_requirement.dim_unit, scripts/0068), and this module is the only thing
// that turns one back into the other. The maths never sees a centimetre; the
// floor never sees an inch it did not ask for.
//
// ─────────────────────── NULL IS INCHES, NOT "UNKNOWN" ──────────────────────
// Every row that existed before 0068 came off a US packing list in inches and
// square feet. If NULL rendered as anything other than exactly what those
// screens printed yesterday, this module would silently restate every
// historical order. So parseDimUnit collapses NULL, empty, junk and "IN" to
// the same answer, and an IN row is formatted by String() — the same coercion
// the template literals were already doing — so its output is byte-identical.
//
// That is what makes 0068 safe to apply before this code ships, and this code
// safe to ship before anybody sets a single row to 'CM'.
//
// ─────────────────────── WHY THE ROUND TRIP IS EXACT ────────────────────────
// 103 cm is stored as 40.5512 in. Multiplied back by 2.54 that is 103.000048,
// not 103 — the conversion is lossy in both directions and floating point makes
// it worse. Printing that raw would put "103.000048 cm" on a screen, which is
// worse than the inches were.
//
// So display rounds to 2 decimals and then drops trailing zeros:
//
//     103.000048 -> 103.00  -> "103"
//       2.999994 ->   3.00  -> "3"
//      11.500104 ->  11.50  -> "11.5"
//      19.500088 ->  19.50  -> "19.5"
//
// Two decimals rather than one, because 11.5 is on this order and a future one
// will have 12.75 on it. Every one of the 36 sizes on PI 1200 is pinned in
// tests/fabDimensions.test.ts and must come back exactly as the PO writes it.
//
// ─────────────────────── PURE, AND IT IMPORTS NOTHING ───────────────────────
// Same rule as shape.ts, pieceNaming.ts and slabLoss.ts: `node --test` resolves
// ESM strictly, so a relative import without a .ts extension fails at runtime
// while adding one fights the Next build. There is nothing here worth importing
// anyway — it is arithmetic and a string.

/** The two spellings fab_requirement.dim_unit accepts. The database enforces
 *  the same pair (fab_requirement_dim_unit_ck, scripts/0068). */
export const DIM_UNITS = ["IN", "CM"] as const;
export type DimUnit = (typeof DIM_UNITS)[number];

/** Exact by definition since 1959, so this is not an approximation. */
export const CM_PER_INCH = 2.54;

/**
 * NULL, "", whitespace, junk and "IN" all mean INCHES.
 *
 * Only a clean, case-insensitive "CM" opts a row into centimetre display. The
 * default has to be inches and has to be unconditional: a row whose unit could
 * not be read is a row from before 0068, and those are inch rows.
 */
export function parseDimUnit(value: unknown): DimUnit {
  return String(value ?? "").trim().toUpperCase() === "CM" ? "CM" : "IN";
}

/** Stored inches to the centimetres the customer ordered in. */
export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

/** Centimetres to the inches that get stored. The intake side of the same
 *  conversion — used when a cm order is loaded, so the two directions live
 *  together and cannot drift apart. */
export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

/**
 * 2 decimals, then trailing zeros removed: 103.000048 -> "103", 11.5 -> "11.5".
 *
 * Number.toFixed already rounds half away from zero and already emits a fixed
 * width, so the only work left is trimming — and the trim is a string operation
 * on a string that is guaranteed to contain a "." because toFixed(2) always
 * emits one. No regex, so there is nothing to get subtly wrong about "100".
 */
function trim2(n: number): string {
  const s = n.toFixed(2);
  let end = s.length;
  while (end > 0 && s[end - 1] === "0") end--;
  if (end > 0 && s[end - 1] === ".") end--;
  return s.slice(0, end);
}

/** A real, finite, displayable number — and not a string that Number() would
 *  happily turn into one. Prisma hands back `number | null` for a Float column,
 *  but a DTO that has been through JSON and back can carry anything. */
function usable(v: unknown): number | null {
  if (typeof v !== "number") return null;
  return Number.isFinite(v) ? v : null;
}

/**
 * ONE dimension, in the unit the row was ordered in. Null when there is nothing
 * to show, so the caller keeps its own placeholder — the screens do not agree
 * on whether that is an em dash or a hyphen, and unifying them is not this
 * module's business.
 *
 * An IN row goes through String(), which is exactly what the template literals
 * in the station screens were already doing to the same value. Byte-identical.
 */
export function formatDimension(value: unknown, unit: unknown): string | null {
  const n = usable(value);
  if (n === null) return null;
  return parseDimUnit(unit) === "CM" ? trim2(inchesToCm(n)) : String(n);
}

/**
 * The whole label AS THE ORDER WRITES IT: "103 × 3 cm", or "40.5512 × 1.1811"
 * for an inch row.
 *
 * Named for the question it answers — what size was ordered — rather than
 * "dimensionLabel", which is one letter from shape.ts's dimensionLabels() and
 * means something else entirely (what to call the two form fields).
 *
 * THE UNIT IS NAMED ON CM ROWS AND NOT ON INCH ROWS, on purpose. A shop that
 * has read inches off this screen for two years does not need to be told what
 * it is looking at, and adding "in" everywhere would be a change to every
 * existing screen for no gain. A centimetre row is the exception on this floor,
 * so it says so.
 *
 * `separator` exists only so each screen keeps the glyph it already used — the
 * queues print "×", the project page prints "x". Changing those would be a
 * cosmetic diff on six files in a change that is supposed to be about money.
 */
export function orderedSizeLabel(
  length: unknown,
  width: unknown,
  unit: unknown,
  separator = "×",
): string | null {
  const l = formatDimension(length, unit);
  const w = formatDimension(width, unit);
  if (l === null || w === null) return null;
  return parseDimUnit(unit) === "CM"
    ? `${l} ${separator} ${w} cm`
    : `${l} ${separator} ${w}`;
}
