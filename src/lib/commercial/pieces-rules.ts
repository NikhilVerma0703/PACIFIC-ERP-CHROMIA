// Cut-to-size packing lines — the PURE rules (round three, answer 5).
//
// A packing list packs slabs today; the three cut-to-size workbooks he sent
// pack PIECES, and their columns are not a slab's:
//
//   CRATE NO. | DRAWING NO | PIECE NO. | MATERIAL NAME | SIZE L × W | THICK (MM)
//             | SQFT | QTY (PCS) | BUILDING | WEIGHT
//
// with a TOTAL row per crate and per sheet. Everything a route, a PDF or the
// editor has to DECIDE about such a line lives here, so tests/commercialPieces
// .test.ts can run the decisions with plain values and the routes only move
// rows around:
//
//   what a typed line is, and what refuses it (parsePiece, piecePatch)
//   the area of one piece from its millimetres (sqftFromMm)
//   the per-crate and whole-list totals his TOTAL rows carry (pieceTotals)
//   the rows and subtotals the two sheets print (pieceSheet)
//   which crate on the list a typed crate number means (matchCrate)
//   millimetres as the list's own unit shows them (sizeFromMm, sizeToMm)
//
// SIZES ARE STORED IN MILLIMETRES (answer 5). His sheets are millimetres under
// headings reading "SIZE(Inches)" and "SIZE(IN CM)" — on the same file — so the
// stored unit is fixed and explicit, and only the PRINTED unit follows the
// list's measurementUnit (answer 17 of round one). A heading can then never
// disagree with the numbers under it the way his own workbooks do.
//
// Imports only measure.ts, by relative path with the extension, exactly as
// packing-rules.ts does — node --test loads this without Next or Prisma.
import { sumTo, sqmFromCm, sqftFromSqm, type MeasurementUnit } from "./measure.ts";

/** Inches, for the printed size when the list is set to inches (answer 17). */
export const MM_PER_IN = 25.4;

const round = (n: number, dp: number): number => { const f = 10 ** dp; return Math.round(n * f) / f; };

/** A figure off a form field or a Decimal column, or null when there is none.
 *  AN EMPTY STRING IS NULL, not zero — the same rule measure.ts applies, and for
 *  the same reason: Number("") is 0, and a blanked size cell that stored 0 mm
 *  would print a piece of no area. */
function figure(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Was this cell TYPED at all? Absent, null and an empty string are "not typed";
 *  anything else was typed and must therefore parse. figure() alone cannot tell
 *  the two apart — it answers null for both — and that is how a clerk's `1030 mm`
 *  in the Length column became a line with no length instead of a refusal. */
function typed(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  return !(typeof v === "string" && v.trim() === "");
}

/** What the refusal quotes back, so the clerk can see their own typo. */
function seen(v: unknown): string {
  const s = String(v).trim();
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// ───────────────────────────── the area of a piece ──────────────────────────

/**
 * ONE piece's area in square feet, from its millimetres. Routed through
 * measure.ts's own centimetre conversions rather than a factor of its own, so a
 * 1030 × 110 threshold and a 3470 × 2010 slab are measured by the same 10.764
 * the company's sheets use — two lines of the same shipment may not be computed
 * two ways. A missing or non-positive side is no area at all, not zero-by-luck.
 */
export function sqftFromMm(lengthMm: number | null | undefined, widthMm: number | null | undefined): number {
  const l = figure(lengthMm), w = figure(widthMm);
  if (l === null || w === null || l <= 0 || w <= 0) return 0;
  return sqftFromSqm(sqmFromCm(l / 10, w / 10));
}

/**
 * THE LINE's area in square feet: the size times the quantity, SCALED BEFORE
 * THE ROUNDING. Multiplying one rounded piece by the quantity is the "round the
 * parts, then add" that pieceTotals' own note blames for two sheets of one
 * envelope disagreeing — 360 thresholds of 1030 × 110 come to 439.042 sqft, and
 * 1.22 × 360 says 439.2, a fifth of a foot invented on a customs sheet.
 * No size, no quantity, no area — nought, never a guess.
 */
export function sqftForLine(
  lengthMm: number | null | undefined,
  widthMm: number | null | undefined,
  quantity: number | null | undefined,
): number {
  const l = figure(lengthMm), w = figure(widthMm), q = figure(quantity);
  if (l === null || w === null || q === null || l <= 0 || w <= 0 || q <= 0) return 0;
  return sqftFromSqm(sqmFromCm(l / 10, w / 10) * q);
}

/** A stored millimetre figure as the list's unit prints it. Inches carry two
 *  decimals, not the one a slab's sides carry: an 11 mm threshold edge is
 *  0.43 in, and a single decimal would print it as 0.4. */
export function sizeFromMm(mm: number | null | undefined, unit: MeasurementUnit): number | null {
  const n = figure(mm);
  if (n === null) return null;
  return unit === "in" ? round(n / MM_PER_IN, 2) : round(n / 10, 1);
}

/** A size typed in the list's unit, as the millimetres the row stores. */
export function sizeToMm(value: unknown, unit: MeasurementUnit): number | null {
  const n = figure(value);
  if (n === null) return null;
  return round(unit === "in" ? n * MM_PER_IN : n * 10, 2);
}

/** "L × W × T" as the sheets and the screen say it, in the printed unit. */
export function pieceSize(
  p: { lengthMm: number | null; widthMm: number | null; thicknessMm: number | null },
  unit: MeasurementUnit,
): string {
  const parts = [sizeFromMm(p.lengthMm, unit), sizeFromMm(p.widthMm, unit), sizeFromMm(p.thicknessMm, unit)]
    .filter((n): n is number => n !== null)
    .map((n) => String(n));
  return parts.join(" × ");
}

// ───────────────────────────── a typed line ─────────────────────────────────

export interface PieceInput {
  /** As printed on his sheet — "1", "1A" — not always a number, so a string. */
  crateNo: string | null;
  drawingNo: string | null;
  pieceNo: string | null;
  design: string;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  /** THE LINE'S AREA, quantity included — see parsePiece. */
  sqft: number | null;
  quantity: number;
  /** BUILDING / AREA on his sheets: "KITCHEN", "BATH ROOM VANITY". */
  room: string | null;
  /** The line's weight, quantity included — the sheet's TOTAL adds this column. */
  weightKg: number | null;
  notes: string | null;
}

export type PieceParse = { ok: true; value: PieceInput } | { ok: false; reason: string };

/** The most pieces one line may carry. A line is a design at a size in a crate;
 *  a five-digit quantity is a typed decimal point gone missing, and it would go
 *  onto a customs total unnoticed. */
export const MAX_PIECE_QUANTITY = 10000;

/**
 * One cut-to-size line from what the screen or a paste typed.
 *
 * THE DESIGN IS THE ONLY REQUIRED FIELD (answer 5: "MATERIAL NAME"). A crate
 * number, a drawing and a piece number are how HIS sheets are laid out and not
 * every sheet carries all three; a size may still be being measured. But a line
 * with no material on it names nothing that can be packed, so it is refused.
 *
 * SQFT IS THE LINE'S AREA, NOT ONE PIECE'S. His TOTAL row adds the SQFT column
 * against the QTY column, and a per-piece figure in a column totalled that way
 * would understate a line of 360 thresholds by a factor of 360. So a blank sqft
 * is derived as the size scaled by the quantity (sqftForLine — scaled BEFORE the
 * rounding, not one rounded piece multiplied out), and a TYPED one is kept
 * exactly as typed — the sheet in his hand is the source of truth for a figure
 * he has already worked out, and a clerk copying one in must not have it
 * silently rewritten.
 *
 * A NUMERIC CELL THAT DOES NOT PARSE IS REFUSED, not read as blank: see `typed`.
 */
export function parsePiece(raw: Record<string, unknown>): PieceParse {
  const design = text(raw.design);
  if (!design) return { ok: false, reason: "Name the design — a line with no material names nothing that can be packed" };

  const qtyRaw = raw.quantity === undefined || raw.quantity === null || raw.quantity === "" ? 1 : figure(raw.quantity);
  if (qtyRaw === null) return { ok: false, reason: "Quantity must be a number of pieces" };
  if (!Number.isInteger(qtyRaw)) return { ok: false, reason: "Quantity is a whole number of pieces" };
  if (qtyRaw <= 0) return { ok: false, reason: "Quantity must be at least one piece" };
  if (qtyRaw > MAX_PIECE_QUANTITY) return { ok: false, reason: `Quantity looks wrong — ${qtyRaw} pieces on one line. Split it, or check the decimal point.` };
  const quantity = qtyRaw;

  const sides: Array<["lengthMm" | "widthMm" | "thicknessMm", string]> = [
    ["lengthMm", "Length"], ["widthMm", "Width"], ["thicknessMm", "Thickness"],
  ];
  const size: { lengthMm: number | null; widthMm: number | null; thicknessMm: number | null } = { lengthMm: null, widthMm: null, thicknessMm: null };
  for (const [key, label] of sides) {
    const n = figure(raw[key]);
    if (n === null) {
      // A CELL THAT WAS TYPED AND DOES NOT PARSE IS A REFUSAL, NOT A BLANK.
      // "1030 mm", "10,30", an O for a nought: silently storing null there
      // wrote a sizeless line that printed with an empty Length and an empty
      // Sqft, and understated the sheet's TOTAL by that line's whole area —
      // money and stone, on a customs document, with nothing in the route's
      // `refused` list to say so.
      if (typed(raw[key])) return { ok: false, reason: `${label} must be a number of millimetres — "${seen(raw[key])}" is not` };
      size[key] = null; continue;
    }
    if (n <= 0) return { ok: false, reason: `${label} must be a positive number of millimetres` };
    size[key] = round(n, 2);
  }

  const typedSqft = figure(raw.sqft);
  if (typedSqft === null && typed(raw.sqft)) return { ok: false, reason: `Sqft must be a number — "${seen(raw.sqft)}" is not` };
  if (typedSqft !== null && typedSqft < 0) return { ok: false, reason: "Sqft cannot be negative" };
  const derived = sqftForLine(size.lengthMm, size.widthMm, quantity);
  const sqft = typedSqft !== null ? round(typedSqft, 4) : (derived > 0 ? derived : null);

  const weightKg = figure(raw.weightKg);
  if (weightKg === null && typed(raw.weightKg)) return { ok: false, reason: `Weight must be a number of kilograms — "${seen(raw.weightKg)}" is not` };
  if (weightKg !== null && weightKg < 0) return { ok: false, reason: "Weight cannot be negative" };

  return {
    ok: true,
    value: {
      crateNo: text(raw.crateNo),
      drawingNo: text(raw.drawingNo),
      pieceNo: text(raw.pieceNo),
      design,
      lengthMm: size.lengthMm,
      widthMm: size.widthMm,
      thicknessMm: size.thicknessMm,
      sqft,
      quantity,
      room: text(raw.room),
      weightKg: weightKg === null ? null : round(weightKg, 3),
      notes: text(raw.notes),
    },
  };
}

export const PIECE_FIELDS: ReadonlyArray<keyof PieceInput> = [
  "crateNo", "drawingNo", "pieceNo", "design", "lengthMm", "widthMm", "thicknessMm", "sqft", "quantity", "room", "weightKg", "notes",
];

export type PiecePatch =
  | { ok: true; value: PieceInput; fields: Array<keyof PieceInput> }
  | { ok: false; reason: string };

/**
 * An edit to one line: whatever the body carries, merged onto the row as it
 * stands and re-validated whole, so a patch cannot leave a line the create
 * route would have refused.
 *
 * ONE RULE WORTH SAYING OUT LOUD. When a side or the quantity is edited and the
 * body does NOT carry sqft, the stored sqft is dropped before re-validation so
 * it is derived again. Keeping it would leave the area of the old size printed
 * against the new one — the line that reads 2000 × 300 while its sqft is still
 * the 1030 × 110 figure is exactly the disagreement his workbooks already have.
 * A body that DOES carry sqft still wins: a clerk correcting the area by hand
 * has the sheet in front of them.
 */
export function piecePatch(current: PieceInput, raw: Record<string, unknown>): PiecePatch {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
  const merged: Record<string, unknown> = { ...current };
  for (const k of PIECE_FIELDS) if (has(k)) merged[k] = raw[k];
  const resizes = has("lengthMm") || has("widthMm") || has("quantity");
  if (resizes && !has("sqft")) delete merged.sqft;

  const parsed = parsePiece(merged);
  if (!parsed.ok) return parsed;

  const fields = PIECE_FIELDS.filter((k) => parsed.value[k] !== current[k]);
  return { ok: true, value: parsed.value, fields };
}

/** "Crate 1 · piece 12 · CQBE" — what the log and an error call the line. */
export function pieceLabel(p: { crateNo?: string | null; pieceNo?: string | null; design?: string | null }): string {
  const bits = [
    p.crateNo ? `crate ${p.crateNo}` : "",
    p.pieceNo ? `piece ${p.pieceNo}` : "",
    (p.design ?? "").trim(),
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "piece line";
}

// ───────────────────────────── crates and ordering ──────────────────────────

export interface PieceLike {
  id?: string;
  crateId?: string | null;
  crateNo: string | null;
  drawingNo?: string | null;
  pieceNo?: string | null;
  design: string;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  sqft: number | null;
  quantity: number;
  room?: string | null;
  weightKg: number | null;
  notes?: string | null;
}

/** The crate a line says it is in, trimmed. "" means no crate. */
export function crateKey(p: { crateNo?: string | null }): string {
  return (p.crateNo ?? "").trim();
}

/** Crate numbers in the order the sheet prints them: numerically when they are
 *  numbers ("2" before "10"), alphabetically when they are not ("1A"), and the
 *  pieces in no crate last — where the measurement list already puts a slab
 *  that is in no crate. */
export function compareCrateNo(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  const byText = a.localeCompare(b, "en", { numeric: true });
  if (byText !== 0) return byText;
  // TWO SPELLINGS OF THE SAME NUMBER — "01" and "1" — are equal under BOTH
  // comparisons, and a tie leaves them wherever they were typed. The sheet then
  // reads 01, 1, 01, which is two blocks of crate 01 and its subtotal printed
  // twice: subtotals that add to more than the TOTAL under them. The ordering
  // must be total, so distinct keys always sort together.
  return a < b ? -1 : 1;
}

/** Lines as the sheet reads them: crate by crate, then by piece number, then by
 *  design, so two prints of one list are never in two different orders. */
export function orderedPieces<T extends PieceLike>(pieces: ReadonlyArray<T>): T[] {
  return [...pieces].sort((a, b) =>
    compareCrateNo(crateKey(a), crateKey(b))
    || String(a.pieceNo ?? "").localeCompare(String(b.pieceNo ?? ""), "en", { numeric: true })
    || a.design.localeCompare(b.design, "en"));
}

/**
 * WHICH CRATE ON THE LIST does a typed crate number mean? A piece row carries
 * the number as printed (his sheets number crates that are not rows of ours)
 * AND an optional link to a crate of this list, so the crate's own weight and
 * kind follow the pieces in it. The link is made when the typed number matches
 * a crate's, and dropped when it does not — a stale link to crate 3 under a
 * line that now reads crate 4 is a weight apportioned to the wrong crate.
 */
export function matchCrate(crateNo: string | null | undefined, crates: ReadonlyArray<{ id: string; crateNo: number }>): string | null {
  const key = (crateNo ?? "").trim();
  if (!key) return null;
  const n = Number(key);
  if (!Number.isFinite(n)) return null;
  return crates.find((c) => Number(c.crateNo) === n)?.id ?? null;
}

// ───────────────────────────── the TOTAL rows ───────────────────────────────

export interface PieceCrateTotal {
  /** null for the lines in no crate. */
  crateNo: string | null;
  /** Rows on the line, as against the pieces they carry. */
  lines: number;
  pieces: number;
  sqft: number;
  /**
   * Null when ANY line in the group has no weight typed. A total that counts an
   * unweighed line as zero kilograms is a customs figure that understates the
   * shipment — the same reason crateGroups refuses to guess a crate's net kg.
   */
  weightKg: number | null;
}

export interface PieceTotals {
  crates: PieceCrateTotal[];
  total: PieceCrateTotal;
}

/** The per-crate and whole-list totals his sheets carry as a TOTAL row: square
 *  feet, pieces and weight (answer 5). */
export function pieceTotals(pieces: ReadonlyArray<PieceLike>): PieceTotals {
  const groups = new Map<string, { sqft: number[]; kg: number[]; missingKg: boolean; lines: number; pieces: number }>();
  for (const p of pieces) {
    const key = crateKey(p);
    let g = groups.get(key);
    if (!g) { g = { sqft: [], kg: [], missingKg: false, lines: 0, pieces: 0 }; groups.set(key, g); }
    g.lines++;
    g.pieces += Number(p.quantity) || 0;
    g.sqft.push(Number(p.sqft) || 0);
    const kg = figure(p.weightKg);
    if (kg === null) g.missingKg = true; else g.kg.push(kg);
  }
  const crates: PieceCrateTotal[] = Array.from(groups.entries())
    .sort((a, b) => compareCrateNo(a[0], b[0]))
    .map(([key, g]) => ({
      crateNo: key || null,
      lines: g.lines,
      pieces: g.pieces,
      sqft: sumTo(g.sqft, 3),
      weightKg: g.missingKg ? null : sumTo(g.kg, 3),
    }));

  const allKg = pieces.map((p) => figure(p.weightKg));
  return {
    crates,
    total: {
      crateNo: null,
      lines: pieces.length,
      pieces: pieces.reduce((a, p) => a + (Number(p.quantity) || 0), 0),
      // Added from every LINE, not from the crate subtotals: rounding the parts
      // and then adding them is what made two sheets of one envelope disagree in
      // the third decimal (plTotals' own note).
      sqft: sumTo(pieces.map((p) => Number(p.sqft) || 0), 3),
      weightKg: allKg.every((k): k is number => k !== null) && allKg.length ? sumTo(allKg, 3) : null,
    },
  };
}

// ───────────────────────────── the printed sheet ────────────────────────────

export type PieceSheetRow =
  | {
      kind: "piece";
      sl: number;
      id: string;
      crateNo: string | null;
      drawingNo: string;
      pieceNo: string;
      design: string;
      lengthMm: number | null;
      widthMm: number | null;
      thicknessMm: number | null;
      sqft: number | null;
      quantity: number;
      room: string;
      weightKg: number | null;
    }
  | { kind: "subtotal"; crateNo: string | null; lines: number; pieces: number; sqft: number; weightKg: number | null };

export interface PieceSheet {
  rows: PieceSheetRow[];
  totals: PieceCrateTotal;
  /** So a sheet with no drawing numbers at all does not print an empty column —
   *  the same courtesy the measurement list pays the customer's slab numbers. */
  hasDrawings: boolean;
  hasRooms: boolean;
  hasWeights: boolean;
}

/** The piece table both sheets print: lines in crate order with a subtotal
 *  after each crate, and the sheet's own TOTAL (answer 5). */
export function pieceSheet(pieces: ReadonlyArray<PieceLike>): PieceSheet {
  const totals = pieceTotals(pieces);
  // THE BLOCKS ARE THE TOTALS' OWN GROUPS, and the lines are bucketed into them
  // rather than the sheet trusting the sort to keep one crate contiguous. Each
  // crate therefore appears exactly once with exactly its own subtotal, so the
  // subtotal rows always add up to the TOTAL row beneath them — the sheet cannot
  // print a figure it then contradicts, whatever the crate numbers are spelt
  // like. (compareCrateNo is total now too; this makes it not matter.)
  const buckets = new Map<string, PieceLike[]>();
  for (const p of orderedPieces(pieces)) {
    const k = crateKey(p);
    const b = buckets.get(k);
    if (b) b.push(p); else buckets.set(k, [p]);
  }

  const rows: PieceSheetRow[] = [];
  let sl = 0;
  for (const sub of totals.crates) {
    for (const p of buckets.get(sub.crateNo ?? "") ?? []) {
      sl++;
      rows.push({
        kind: "piece",
        sl,
        id: p.id ?? "",
        crateNo: crateKey(p) || null,
        drawingNo: (p.drawingNo ?? "").trim(),
        pieceNo: (p.pieceNo ?? "").trim(),
        design: p.design,
        lengthMm: p.lengthMm, widthMm: p.widthMm, thicknessMm: p.thicknessMm,
        sqft: p.sqft,
        quantity: Number(p.quantity) || 0,
        room: (p.room ?? "").trim(),
        weightKg: p.weightKg,
      });
    }
    rows.push({ kind: "subtotal", crateNo: sub.crateNo, lines: sub.lines, pieces: sub.pieces, sqft: sub.sqft, weightKg: sub.weightKg });
  }
  return {
    rows,
    totals: totals.total,
    hasDrawings: pieces.some((p) => (p.drawingNo ?? "").trim() !== ""),
    hasRooms: pieces.some((p) => (p.room ?? "").trim() !== ""),
    hasWeights: pieces.some((p) => figure(p.weightKg) !== null),
  };
}

/** The heading a size column carries, so it can never disagree with the figure
 *  under it (answer 5, and answer 17 of round one). */
export function sizeHeading(label: string, unit: MeasurementUnit): string {
  return `${label}\n(${unit})`;
}
