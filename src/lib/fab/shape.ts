// WHAT SHAPE A PIECE IS, AND HOW LONG ITS EDGE IS.
//
// The owner: "regarding the cost, now it's like polish side only for a squares
// or rect, need to include circle, oval as well. default is rect shape fine."
// And on how they are entered: "let the manager or anyone who uploads the PO
// mention the dia, if it's oval enter a, b — long length and long width."
//
// ─────────────────────────────────── THREE SHAPES, ONE QUESTION ─────────────
// Everything here answers one thing: how many inches of finished edge does ONE
// piece have. That number times the count times the rate is the hand edge
// polish charge, and it is the only reason this module exists.
//
//   RECTANGLE  four named edges, chosen individually. front and back run the
//              length, left and right run the width. The common case, and the
//              default for every row that does not say otherwise.
//   CIRCLE     one continuous edge. There is nothing to choose — a circle's
//              edge is polished or it is not — so the four bands are replaced
//              by a single yes.
//   OVAL       the same, from two axes instead of one diameter.
//
// ─────────────────────────────────── WHY RAMANUJAN ──────────────────────────
// An ellipse has no closed-form perimeter. Ramanujan's second approximation is
// accurate to about one part in ten million for the ratios stone is cut at,
// which is four orders of magnitude finer than the 2dp the money is rounded to.
//
// The property that made it the right choice is not the accuracy though: it
// DEGENERATES EXACTLY TO π·d WHEN THE AXES AGREE. A circle is an oval whose
// axes are equal, and a costing model where those two disagree by a rupee is a
// model somebody has to explain to a customer. The test asserts it to nine
// decimals.
//
// PURE — the rule from pricing.ts and slabLoss.ts, so `node --test` reaches it
// and a client component can use it. Its ONE import is ./dimensions.ts, with
// the explicit .ts extension for the same reason pricing.ts imports ./shape.ts
// that way: node's ESM resolver is strict, and tsconfig sets
// allowImportingTsExtensions so the Next build is happy too.
//
// That module is itself importless, so the chain is a line and not a cycle:
//   dimensions.ts <- shape.ts <- pricing.ts <- pieceCharge.ts

import { parseDimUnit, formatDimension } from "./dimensions.ts";

/** The shapes a piece can be cut to. RECTANGLE covers squares — a square is a
 *  rectangle whose sides agree, and giving it its own case would mean two code
 *  paths that must never disagree. */
export const PIECE_SHAPES = ["RECTANGLE", "CIRCLE", "OVAL"] as const;
export type PieceShape = (typeof PIECE_SHAPES)[number];

/** Every row that does not say otherwise. The overwhelming majority of stone. */
export const DEFAULT_SHAPE: PieceShape = "RECTANGLE";

/**
 * SHAPES THE COLUMN ADMITS AND THIS MODULE CANNOT MEASURE.
 *
 * FabShapeType predates every one of these functions and carries three values
 * that have no perimeter formula here: an L is two rectangles minus an overlap
 * and needs the leg dimensions nothing stores; a CURVE has a radius nothing
 * stores; CUSTOM means "ask the fabricator".
 *
 * They used to fall through parseShape's default and be priced AS RECTANGLES,
 * with `unpriced: false` — a confident wrong number on an invoice, which is the
 * one outcome this whole module is written to avoid. An L-shaped top marked on
 * all four edges was charged a rectangle's perimeter and nothing anywhere said
 * the figure was a guess.
 *
 * So they are named, and priceRow returns unpricedReason "SHAPE" for them. The
 * SINK is still charged — a sink cutout is a flat per-piece rate and has nothing
 * to do with the outline it sits in — and the pieces still reach the hand bench,
 * because the work is real. Only the EDGE money is withheld, and it is withheld
 * out loud.
 *
 * NOTHING WRITES THESE TODAY. The PO screen offers rectangle, circle and oval
 * only. This is the door held shut for the row somebody types into psql, and for
 * the rows that may already exist on a database older than the fabrication
 * module.
 *
 * ─────────────────── WHY NAMED, AND NOT "ANYTHING UNRECOGNISED" ─────────────
 * Because NULL, "" and a stale token must all keep meaning RECTANGLE. Every row
 * written before shape_type existed is NULL, and the day this list becomes
 * "everything parseShape does not know" is the day those rows stop being priced.
 * The values are enumerated so the blast radius is exactly three words.
 */
export const UNPRICEABLE_SHAPES = ["L_SHAPE", "CURVE", "CUSTOM"] as const;
export type UnpriceableShape = (typeof UNPRICEABLE_SHAPES)[number];

/**
 * EVERY VALUE THE FabShapeType ENUM HOLDS, as scripts/0063 leaves it.
 *
 * Here so a test can assert that each one is either priceable or explicitly
 * unpriceable — never silently a rectangle. Add a value to the enum in a
 * migration and tests/fabShape.test.ts fails until it is classified here, which
 * is the whole point of writing the list down twice.
 */
export const FAB_SHAPE_TYPE_VALUES = [
  "RECTANGLE", "L_SHAPE", "CURVE", "ROUND", "CUSTOM", "CIRCLE", "OVAL",
] as const;

/** True when the stored value is a shape this module refuses to price rather
 *  than one it does not recognise. NULL, "" and anything unknown are FALSE —
 *  they mean rectangle, which is what every historical row is. */
export function isUnpriceableShape(value: unknown): boolean {
  const t = String(value ?? "").trim().toUpperCase();
  return (UNPRICEABLE_SHAPES as readonly string[]).includes(t);
}

/**
 * The four edges of a rectangle, in canonical order.
 *
 * Named rather than indexed: [true, false, true, false] is unreadable at a call
 * site and silently wrong the moment anyone reorders it.
 */
export const RECT_EDGES = ["front", "back", "left", "right"] as const;
export type RectEdge = (typeof RECT_EDGES)[number];

/**
 * THE TOKEN FOR A ROUND EDGE.
 *
 * A circle has one edge, so "which edges" is not a question that can be asked
 * of it. Rather than storing all four rectangle names and hoping a reader
 * infers "the whole thing", a round shape stores this single word.
 *
 * It shares the finished_edges column with the rectangle names, and that is
 * deliberate: one column, one question — "what edge work does this row have" —
 * answered in the vocabulary of the shape being asked about. Greppable in psql,
 * and unambiguous to anyone reading a row by eye.
 */
export const ROUND_EDGE = "round";

export type EdgeSelection = Partial<Record<RectEdge, boolean>> & { round?: boolean };

/**
 * WHICH FACE OF THE EDGE IS HAND POLISHED — and the second half of the charge.
 *
 * The owner: "hand edge polish have like not only 4 direction N E S W, also
 * whether this on top or bottom or both as well."
 *
 * An edge is a band of stone with two arrises, and polishing both of them is
 * TWICE THE HAND WORK along the same line. Which edges are done and which faces
 * are done are two independent questions, and the running feet are the product
 * of both:
 *
 *     feet = perimeter of the chosen edges × FACES × quantity ÷ 12
 *
 * Missing this is not a rounding error. A row of 60 pieces at 505 ft polished
 * top AND bottom is 1,010 ft — ₹15,150 at 2 cm against ₹7,575. Half the invoice.
 *
 * PER ROW, like the edge selection itself, and for the same reason: a row is
 * homogeneous. A row where some pieces want both faces and some want one is
 * split into two rows.
 *
 * TOP IS THE DEFAULT because it is the overwhelming case — a countertop's
 * visible edge is the top one, and the underside is never seen.
 */
export const EDGE_FACES = ["TOP", "BOTTOM", "BOTH"] as const;
export type EdgeFace = (typeof EDGE_FACES)[number];
export const DEFAULT_EDGE_FACE: EdgeFace = "TOP";

export function parseEdgeFace(value: unknown): EdgeFace {
  const t = String(value ?? "").trim().toUpperCase();
  return (EDGE_FACES as readonly string[]).includes(t) ? (t as EdgeFace) : DEFAULT_EDGE_FACE;
}

/** How many times the chosen edges are walked. BOTH is two passes of the same
 *  length, which is why it multiplies the feet rather than adding a fee. */
export function edgeFaceCount(face: unknown): 1 | 2 {
  return parseEdgeFace(face) === "BOTH" ? 2 : 1;
}

/** How the face reads on a screen and on a bench docket. */
export function describeEdgeFace(face: unknown): string {
  const f = parseEdgeFace(face);
  return f === "BOTH" ? "top & bottom" : f === "BOTTOM" ? "bottom only" : "top only";
}

export function parseShape(value: unknown): PieceShape {
  const t = String(value ?? "").trim().toUpperCase();
  // ROUND is the legacy FabShapeType spelling for a circle; accept it so a row
  // written before this module existed reads correctly rather than silently
  // becoming a rectangle and being charged on a perimeter it does not have.
  if (t === "ROUND" || t === "CIRCLE") return "CIRCLE";
  if (t === "OVAL" || t === "ELLIPSE") return "OVAL";
  return (PIECE_SHAPES as readonly string[]).includes(t) ? (t as PieceShape) : DEFAULT_SHAPE;
}

/** True when a shape has one continuous edge rather than four choosable ones. */
export function isRound(shape: unknown): boolean {
  const s = parseShape(shape);
  return s === "CIRCLE" || s === "OVAL";
}

function positive(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * HOW THE TWO DIMENSION COLUMNS ARE READ, per shape.
 *
 * No new columns. fab_requirement already has length and width, and shape_type
 * says how to read them:
 *
 *   RECTANGLE  length × width, as always
 *   CIRCLE     length is the DIAMETER. width is written equal to it, so the
 *              bounding box — which is what the slab actually loses — falls out
 *              of the existing maths with no special case anywhere else.
 *   OVAL       length is a (the long axis), width is b (the short one).
 */
export interface PieceDims {
  lengthIn: number | null | undefined;
  widthIn: number | null | undefined;
}

/**
 * Ellipse perimeter, Ramanujan II, from the FULL axes (not the semi-axes).
 *
 *   h = ((a − b) / (a + b))²
 *   P = π · (a + b)/2 · [ 1 + 3h / (10 + √(4 − 3h)) ]
 *
 * At a = b this is π·(2a)/2 = π·a exactly — the circle, with no special case.
 */
export function ovalPerimeterInches(aIn: number | null | undefined, bIn: number | null | undefined): number {
  const a = positive(aIn);
  const b = positive(bIn);
  if (a <= 0 || b <= 0) return 0;
  const h = ((a - b) / (a + b)) ** 2;
  return (Math.PI * (a + b) / 2) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Circumference of a circle of this diameter. */
export function circlePerimeterInches(diameterIn: number | null | undefined): number {
  return Math.PI * positive(diameterIn);
}

/**
 * FINISHED EDGE OF ONE PIECE, IN INCHES — the number the whole charge rests on.
 *
 * A rectangle sums only the edges chosen. A round shape has one edge, so it is
 * the whole perimeter or nothing.
 */
export function edgeInchesPerPiece(
  shape: unknown,
  dims: PieceDims,
  edges: EdgeSelection | null | undefined,
): number {
  // AN L, A CURVE OR A CUSTOM OUTLINE HAS NO PERIMETER HERE — see
  // UNPRICEABLE_SHAPES. Returning the rectangle's answer is what made these
  // rows quote a number nobody had measured, so the answer is zero and priceRow
  // says why. Checked before parseShape, which would flatten them to RECTANGLE.
  if (isUnpriceableShape(shape)) return 0;

  const s = parseShape(shape);
  const e = edges ?? {};

  if (s === "CIRCLE") {
    return e.round ? round2(circlePerimeterInches(dims.lengthIn)) : 0;
  }
  if (s === "OVAL") {
    return e.round ? round2(ovalPerimeterInches(dims.lengthIn, dims.widthIn)) : 0;
  }

  const l = positive(dims.lengthIn);
  const w = positive(dims.widthIn);
  let inches = 0;
  if (e.front) inches += l;
  if (e.back) inches += l;
  if (e.left) inches += w;
  if (e.right) inches += w;
  return round2(inches);
}

/** Is ANY edge work selected on this row? The group either has hand edge polish
 *  or it does not — see the note in pricing.ts about why that is a row-level
 *  fact rather than a count. */
export function hasEdgeWork(shape: unknown, edges: EdgeSelection | null | undefined): boolean {
  const e = edges ?? {};
  if (isRound(shape)) return !!e.round;
  return RECT_EDGES.some((k) => !!e[k]);
}

/**
 * THE ROW NAMES EDGES THIS SHAPE DOES NOT HAVE.
 *
 * A CIRCLE carrying "front,back,left,right", or a RECTANGLE carrying "round".
 * hasEdgeWork answers each shape in its own vocabulary and returns FALSE for
 * both — which is the right answer to "is there edge work here" and the wrong
 * thing to charge on, because the row plainly says somebody asked for edge work.
 * The result was ₹0 with `unpriced: false`: four marked edges, no charge, and
 * nothing anywhere saying a word about it.
 *
 * DISTINCT FROM "NO EDGES CHOSEN", which is the ordinary case and must stay
 * silent. The test is that the stored selection holds SOMETHING and none of it
 * applies to this shape.
 *
 * The route already prevents it — finished-edges validates the vocabulary
 * against the row's shape and clears the selection whenever the shape crosses
 * between round and cornered — so this is the second door, on the arithmetic
 * itself, for the row somebody edits by hand in psql. Same reason
 * UNPRICEABLE_SHAPES exists.
 */
export function edgeVocabularyMismatch(
  shape: unknown,
  edges: EdgeSelection | null | undefined,
): boolean {
  const e = edges ?? {};
  const anyChosen = !!e.round || RECT_EDGES.some((k) => !!e[k]);
  return anyChosen && !hasEdgeWork(shape, e);
}

/**
 * EDGE WORK IS ASKED FOR, BUT A DIMENSION IT IS MEASURED ALONG IS MISSING.
 *
 * The silent-loss case, and the reason this returns a fact rather than a zero.
 * A row with `left` polished and a NULL width measures 0 in, prices at ₹0, and
 * reads on every screen as "no edge charge" — which is indistinguishable from a
 * customer who asked for raw edges. One is an answer and the other is a hole in
 * the order, and the invoice is short either way.
 *
 * PER EDGE, not per row: front and back run the LENGTH, left and right the
 * WIDTH, so a rectangle with only front polished and no width is perfectly
 * priceable. Only the dimensions the chosen edges actually need are required.
 */
export function edgeDimensionsMissing(
  shape: unknown,
  dims: PieceDims,
  edges: EdgeSelection | null | undefined,
): boolean {
  // NOT A DIMENSION PROBLEM. An L-shaped row can have a perfectly good length
  // and width and still be unpriceable, and reporting "no size" would send the
  // manager to fill in fields that are already filled. priceRow checks the
  // shape first and reports SHAPE; this stays quiet so the two reasons cannot
  // both fire and race for the same amber box.
  if (isUnpriceableShape(shape)) return false;

  const s = parseShape(shape);
  const e = edges ?? {};
  const l = positive(dims.lengthIn);
  const w = positive(dims.widthIn);

  if (s === "CIRCLE") return !!e.round && l <= 0;              // needs the diameter
  if (s === "OVAL") return !!e.round && (l <= 0 || w <= 0);    // needs both axes

  if ((e.front || e.back) && l <= 0) return true;
  if ((e.left || e.right) && w <= 0) return true;
  return false;
}

/**
 * THE AREA THE SLAB ACTUALLY LOSES — the bounding box, always.
 *
 * A 24 in circle is cut from a 24 × 24 square and the corners are dust. Using
 * the true area here would make every round job look like it left 21.5% more
 * room on the slab than it did, and would weaken the over-commitment check that
 * stops a supervisor filling a slab past its capacity.
 */
export function boundingSqInPerPiece(shape: unknown, dims: PieceDims): number {
  const s = parseShape(shape);
  const l = positive(dims.lengthIn);
  // A circle stores its diameter in length; width is written equal to it, but
  // fall back to the diameter so an old row with a null width still squares.
  const w = s === "CIRCLE" ? (positive(dims.widthIn) || l) : positive(dims.widthIn);
  return round2(l * w);
}

/**
 * THE AREA THE CUSTOMER RECEIVES — the true area of the shape.
 *
 * Different from the bounding box for every round piece, and the difference is
 * real stone genuinely lost in the corners. Quoting the bounding box would bill
 * for material that went in the bin.
 */
export function trueSqInPerPiece(shape: unknown, dims: PieceDims): number {
  const s = parseShape(shape);
  const l = positive(dims.lengthIn);
  if (s === "CIRCLE") return round2(Math.PI * (l / 2) ** 2);
  if (s === "OVAL") return round2(Math.PI * (l / 2) * (positive(dims.widthIn) / 2));
  return round2(l * positive(dims.widthIn));
}

/**
 * How a size reads on a screen or a piece label.
 *
 * `unit` IS OPTIONAL AND DEFAULTS TO INCHES — which is what every caller
 * written before scripts/0068 passes (nothing), and what every row written
 * before 0068 is. Omitting it returns exactly the string this function has
 * always returned; the tests that pin "28 × 22.5 in" still pin it.
 *
 * Pass a row's fab_requirement.dim_unit and a centimetre order reads back the
 * way the customer wrote it — "103 × 3 cm", not "40.5512 × 1.1811 in". The
 * stored numbers are inches either way. lib/fab/dimensions.ts explains why
 * converting for DISPLAY is safe when converting for STORAGE would put a 2.54x
 * error straight onto an invoice.
 */
export function describeShapeSize(shape: unknown, dims: PieceDims, unit?: unknown): string {
  const s = parseShape(shape);
  const suffix = parseDimUnit(unit) === "CM" ? "cm" : "in";
  // positive() first, so "no dimension" still reaches the dash branches below
  // rather than being formatted into a confident "0 cm".
  const l = positive(dims.lengthIn);
  const w = positive(dims.widthIn);
  const ls = l > 0 ? formatDimension(l, unit) : null;
  const ws = w > 0 ? formatDimension(w, unit) : null;
  if (s === "CIRCLE") return ls !== null ? `⌀ ${ls} ${suffix}` : "⌀ —";
  if (s === "OVAL") return ls !== null && ws !== null ? `${ls} × ${ws} ${suffix} oval` : "oval —";
  return ls !== null && ws !== null ? `${ls} × ${ws} ${suffix}` : "—";
}

/** What the dimension fields are called for this shape, so one form can serve
 *  all three without the labels lying. */
export function dimensionLabels(shape: unknown): { length: string; width: string | null } {
  const s = parseShape(shape);
  if (s === "CIRCLE") return { length: "Diameter (in)", width: null };
  if (s === "OVAL") return { length: "Long axis a (in)", width: "Short axis b (in)" };
  return { length: "Length (in)", width: "Width (in)" };
}

// ═══════════════════════════════════════════════════════════════════════════
//  THREE FACES, AND EACH ONE PICKS ITS OWN SIDES
// ═══════════════════════════════════════════════════════════════════════════
//
// The owner, on a piece pulled off the machine and given to the hand bench:
// "it need to ask the cost on how much per feet, which all the side — top or
// bottom or side or any combo — and choose the number of side for top, no of
// side for bottom, and number of side for side."
//
// THAT IS A DIFFERENT SHAPE OF QUESTION THAN edge_faces ANSWERED. EDGE_FACES
// applied ONE answer to ALL the chosen edges: "these four sides, both faces."
// It cannot say "top on four sides, bottom on two". The counts are independent,
// so the selections have to be independent too — three edge sets, not one set
// and a multiplier.
//
// ─────────────────────── WHY SIDES AND NOT A COUNT ──────────────────────────
// He asked for a COUNT: "number of side for top". The count is what he thinks
// in and it is what the screen shows him. It is not what is stored, because a
// count cannot be priced by the foot.
//
// A 103 x 19.5 cm piece. "Two sides" is either 206 cm or 39 cm — FIVE TIMES
// APART — and a running-foot charge computed from the count alone would be
// wrong on every piece that is not square, silently, with a plausible number on
// the screen. So the picker takes the sides and DISPLAYS the count; both halves
// of what he asked for survive and the arithmetic is real.
//
// ─────────────────────── WHAT "THE SIDE" IS ─────────────────────────────────
// Not a fourth direction. TOP and BOTTOM are the two arrises of an edge — the
// lines where the face meets the band. SIDE is the band itself, the vertical
// thickness face, which is normally machine polished and is sometimes done by
// hand instead. Fully hand polished is all three on all four sides, which is
// three passes along the whole perimeter.
//
// ─────────────────────── NOTHING EXISTING MOVES ─────────────────────────────
// faceEdgesFromLegacy is the whole compatibility story: a row that has never
// been touched by the new screens keeps finished_edges + edge_faces and is read
// through that function into exactly the answer it gives today. NULL is still
// TOP. BOTH is still top+bottom and still doubles. The new columns take over
// only on a row that actually has them - the same "new wins, else fall back"
// rule the charge freeze uses in production.

/** The three things that can be polished along an edge. */
export const POLISH_FACES = ["top", "bottom", "side"] as const;
export type PolishFace = (typeof POLISH_FACES)[number];

/**
 * WHICH SIDES EACH FACE IS POLISHED ON — the whole hand-polish specification.
 *
 * Every value is an ordinary EdgeSelection, so a round piece says `{round:true}`
 * on any face and the same vocabulary serves both shapes, exactly as
 * finished_edges already does.
 */
export type FaceEdges = Partial<Record<PolishFace, EdgeSelection>>;

/** No polish at all. */
export const NO_FACE_EDGES: FaceEdges = {};

/**
 * READ THE OLD TWO-COLUMN FORM AS THE NEW THREE-FACE ONE.
 *
 * This is the function that keeps every quote you have already sent intact:
 *
 *   finished_edges | edge_faces | becomes
 *   ---------------|------------|-------------------------------------------
 *   'front,back'   | NULL       | top: front,back                (NULL = TOP)
 *   'front,back'   | 'TOP'      | top: front,back
 *   'front,back'   | 'BOTTOM'   | bottom: front,back
 *   'front,back'   | 'BOTH'     | top: front,back + bottom: front,back
 *   'round'        | 'BOTH'     | top: round + bottom: round
 *   '' or NULL     | anything   | nothing
 *
 * SIDE IS NEVER PRODUCED HERE, and that is the point: no row written before
 * this existed ever asked for the band to be hand polished, so none of them
 * gains a third pass and no historical figure moves.
 */
export function faceEdgesFromLegacy(
  finishedEdges: EdgeSelection | null | undefined,
  edgeFaces: unknown,
): FaceEdges {
  const e = finishedEdges ?? {};
  const any = !!e.round || RECT_EDGES.some((k) => !!e[k]);
  if (!any) return {};
  const face = parseEdgeFace(edgeFaces);          // NULL / junk -> TOP
  const copy = (): EdgeSelection => ({ ...e });
  if (face === "BOTH") return { top: copy(), bottom: copy() };
  if (face === "BOTTOM") return { bottom: copy() };
  return { top: copy() };
}

/** Is anything selected on any face? */
export function hasAnyFaceWork(shape: unknown, faces: FaceEdges | null | undefined): boolean {
  const f = faces ?? {};
  return POLISH_FACES.some((k) => hasEdgeWork(shape, f[k]));
}

/**
 * HOW MANY SIDES EACH FACE IS POLISHED ON — the number the owner asked for, and
 * the one the picker prints beside each row of the grid.
 *
 * A round piece has exactly one edge, so this is 1 or 0 for it and never 4.
 */
export function faceSideCounts(
  shape: unknown,
  faces: FaceEdges | null | undefined,
): Record<PolishFace, number> {
  const f = faces ?? {};
  const one = (sel: EdgeSelection | undefined) => {
    const s = sel ?? {};
    if (isRound(shape)) return s.round ? 1 : 0;
    return RECT_EDGES.reduce((n, k) => n + (s[k] ? 1 : 0), 0);
  };
  return { top: one(f.top), bottom: one(f.bottom), side: one(f.side) };
}

/**
 * FINISHED EDGE OF ONE PIECE ACROSS ALL THREE FACES, IN INCHES.
 *
 * Summed, not multiplied — that is the whole difference from edge_faces. Top on
 * four sides and bottom on two is (perimeter) + (those two sides), not
 * (something) x 2.
 *
 * An unpriceable outline still returns 0 here, exactly as the single-face
 * function does, so an L or a curve cannot pick up a perimeter it does not have
 * by coming through the new door.
 */
export function faceEdgeInchesPerPiece(
  shape: unknown,
  dims: PieceDims,
  faces: FaceEdges | null | undefined,
): number {
  if (isUnpriceableShape(shape)) return 0;
  const f = faces ?? {};
  let inches = 0;
  for (const k of POLISH_FACES) inches += edgeInchesPerPiece(shape, dims, f[k]);
  return round2(inches);
}

/**
 * THE SIDES DONE ON BOTH FACES, AND THE SIDES DONE ON ONLY ONE.
 *
 * The owner: "sometime when choosen top and bottom both they get a price — if
 * per feet 10 rs then doing top + bottom we will give them 15 not 20."
 *
 * Doing both faces of the same edge is ONE trip along that edge with the piece
 * flipped, not two jobs. So it is discounted, and the discount belongs to the
 * SIDES THAT ACTUALLY SHARE BOTH FACES — asked and answered:
 *
 *   "top on all 4, bottom on only front and back"
 *   -> front and back are paired; left and right are top-only and are not.
 *
 * That rule reduces to the simple case exactly. All four on both faces means
 * the whole perimeter is paired and nothing is single, which is the Rs15-over-
 * 505-ft answer he described. It also degrades correctly: no bottom at all
 * means nothing pairs, and every existing row in the database is that.
 *
 * ─────────────────────── WHAT NEVER PAIRS ───────────────────────────────────
 * THE SIDE BAND. It is the vertical thickness face — a different surface, done
 * in a different pass, and there is no second face for it to share a trip with.
 * Its inches always come back as single.
 *
 * ─────────────────────── A CIRCLE PAIRS ALL OR NOTHING ──────────────────────
 * A round piece has one continuous edge and no sides to compare. Top and bottom
 * both ringed is one flip and pairs completely; either alone is single. There
 * is no partial case to get wrong.
 */
export function facePairSplit(
  shape: unknown,
  dims: PieceDims,
  faces: FaceEdges | null | undefined,
): {
  /** Sides polished on BOTH faces, counted ONCE — what the pair rate multiplies. */
  pairedInches: number;
  /** Everything else: top-only + bottom-only + the band. Kept because the pair
   *  arithmetic was written against it first, and because a screen showing
   *  "paired / not paired" wants exactly this. */
  singleInches: number;
  /** Sides polished on the TOP only, at the top rate. */
  topOnlyInches: number;
  /** Sides polished on the BOTTOM only, at the bottom rate. */
  bottomOnlyInches: number;
  /** The vertical band. Never pairs, never shares a rate with a flat face. */
  sideInches: number;
} {
  if (isUnpriceableShape(shape)) {
    return { pairedInches: 0, singleInches: 0, topOnlyInches: 0, bottomOnlyInches: 0, sideInches: 0 };
  }

  const f = faces ?? {};
  const top = f.top ?? {};
  const bottom = f.bottom ?? {};
  // The band, always single. Summed in whole and never compared.
  const side = edgeInchesPerPiece(shape, dims, f.side);

  const s = parseShape(shape);

  if (s === "CIRCLE" || s === "OVAL") {
    const ring = edgeInchesPerPiece(shape, dims, { round: true });
    const t = !!top.round;
    const b = !!bottom.round;
    if (t && b) {
      return {
        pairedInches: round2(ring), singleInches: round2(side),
        topOnlyInches: 0, bottomOnlyInches: 0, sideInches: round2(side),
      };
    }
    return {
      pairedInches: 0,
      singleInches: round2((t ? ring : 0) + (b ? ring : 0) + side),
      topOnlyInches: round2(t ? ring : 0),
      bottomOnlyInches: round2(b ? ring : 0),
      sideInches: round2(side),
    };
  }

  const l = positive(dims.lengthIn);
  const w = positive(dims.widthIn);
  // front and back run the LENGTH; left and right run the WIDTH. Same mapping
  // edgeInchesPerPiece uses, and it must stay the same mapping.
  const runs: Array<[RectEdge, number]> = [["front", l], ["back", l], ["left", w], ["right", w]];

  let paired = 0;
  let topOnly = 0;
  let bottomOnly = 0;
  for (const [edge, run] of runs) {
    const t = !!top[edge];
    const b = !!bottom[edge];
    // ONE TRIP, FLIPPED — priced as the pair.
    if (t && b) paired += run;
    // ONE FACE ONLY, and WHICH face decides the rate. The owner: "bottom edge
    // have diff price sometime, top have diff price sometime, and side have
    // different price sometime." Lumping these together is what made all three
    // faces share one figure.
    else if (t) topOnly += run;
    else if (b) bottomOnly += run;
  }
  return {
    pairedInches: round2(paired),
    singleInches: round2(topOnly + bottomOnly + side),
    topOnlyInches: round2(topOnly),
    bottomOnlyInches: round2(bottomOnly),
    sideInches: round2(side),
  };
}

/**
 * ANY FACE ASKS FOR A DIMENSION THE ROW DOES NOT HAVE.
 *
 * Per face, and then per edge inside it — the same rule the single-face version
 * applies, asked three times. A row whose TOP is fine and whose BOTTOM needs a
 * missing width is a row that cannot be priced, and it says so.
 */
export function faceEdgeDimensionsMissing(
  shape: unknown,
  dims: PieceDims,
  faces: FaceEdges | null | undefined,
): boolean {
  const f = faces ?? {};
  return POLISH_FACES.some((k) => edgeDimensionsMissing(shape, dims, f[k]));
}

/** Any face names sides this shape does not have — see edgeVocabularyMismatch. */
export function faceEdgeVocabularyMismatch(
  shape: unknown,
  faces: FaceEdges | null | undefined,
): boolean {
  const f = faces ?? {};
  return POLISH_FACES.some((k) => edgeVocabularyMismatch(shape, f[k]));
}

/**
 * How the specification reads on a docket: "top all four - bottom front + back".
 * Faces with nothing on them are left out rather than printed as "none", so a
 * top-only row reads as one short phrase and not three.
 */
export function describeFaceEdges(
  shape: unknown,
  faces: FaceEdges | null | undefined,
): string {
  const f = faces ?? {};
  const parts: string[] = [];
  for (const k of POLISH_FACES) {
    if (!hasEdgeWork(shape, f[k])) continue;
    parts.push(`${k} ${describeOneFace(shape, f[k])}`);
  }
  return parts.length ? parts.join(" · ") : "None";
}

/** The stored form: one CSV per face, in the SAME vocabulary finished_edges
 *  already uses, so a row stays readable in psql without a JSON parser. */
export function serializeFaceEdges(faces: FaceEdges | null | undefined): Record<PolishFace, string> {
  const f = faces ?? {};
  return {
    top: serializeEdgeSelection(f.top),
    bottom: serializeEdgeSelection(f.bottom),
    side: serializeEdgeSelection(f.side),
  };
}

/** Read three stored CSVs back. An all-empty read returns {} so a caller can
 *  tell "this row has no new-style spec" from "this row was asked and said no",
 *  which is what decides whether the legacy columns are consulted. */
export function parseFaceEdges(stored: {
  top?: string | null; bottom?: string | null; side?: string | null;
} | null | undefined): FaceEdges {
  const s = stored ?? {};
  const out: FaceEdges = {};
  for (const k of POLISH_FACES) {
    const raw = s[k];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    out[k] = parseEdgeSelection(raw);
  }
  return out;
}

/** True when NOTHING was stored on any face — the signal to fall back to the
 *  legacy finished_edges + edge_faces pair. An empty string on a face is a real
 *  answer ("this face, none") and is NOT this. */
export function faceEdgesUnset(stored: {
  top?: string | null; bottom?: string | null; side?: string | null;
} | null | undefined): boolean {
  const s = stored ?? {};
  return POLISH_FACES.every((k) => s[k] === null || s[k] === undefined);
}

/**
 * WHICH FACES A STORED ROW ACTUALLY HAS — the ONE place that decides.
 *
 * A requirement carries two generations of the same answer:
 *
 *   finished_edges + edge_faces   the pre-0067 pair. One selection, one face
 *                                 multiplier.
 *   edges_top/bottom/side         the three-face specification, written by the
 *                                 polish controls since 0067.
 *
 * The new columns win when the row has them; otherwise the old pair is read
 * through faceEdgesFromLegacy. priceRow has done exactly this since 0067.
 *
 * ─────────────────── WHY THIS IS A FUNCTION AND NOT A HABIT ─────────────────
 * It was a habit, copied into four places, and three of them were never
 * updated past `finished_edges`:
 *
 *   supervisor/release-project   decides fabricationRequired -> whether the
 *                                pieces ever reach the hand bench
 *   approve-slab                 the same decision, on the other release path
 *   queues/fabrication           the label telling the fabricator WHAT to polish
 *
 * Every row specified with the new controls leaves finished_edges NULL, so all
 * three answered "no edge work" on rows that had just been priced for it. The
 * work was invoiced and never scheduled, and the bench was told "not marked".
 *
 * One function, so the question cannot be asked two ways again.
 */
export interface StoredRowEdges {
  /** fab_requirement.shape_type. Null is a rectangle. */
  shapeType?: unknown;
  /** fab_requirement.finished_edges — the legacy selection. */
  finishedEdges?: string | null;
  /** fab_requirement.edge_faces — TOP / BOTTOM / BOTH. Legacy. */
  edgeFaces?: string | null;
  /** scripts/0067 — the three faces. All NULL on a row that has no new spec. */
  edgesTop?: string | null;
  edgesBottom?: string | null;
  edgesSide?: string | null;
}

/** The row's three-face specification, whichever generation it is stored in. */
export function rowFaceEdges(row: StoredRowEdges | null | undefined): FaceEdges {
  const r = row ?? {};
  const stored = {
    top: r.edgesTop ?? null,
    bottom: r.edgesBottom ?? null,
    side: r.edgesSide ?? null,
  };
  return faceEdgesUnset(stored)
    ? faceEdgesFromLegacy(parseEdgeSelection(r.finishedEdges), r.edgeFaces)
    : parseFaceEdges(stored);
}

/**
 * DOES THIS ROW GO TO THE HAND BENCH?
 *
 * The question release and approve-slab ask to set fabricationRequired, and the
 * fabrication queue asks to decide whether to show the work. TRUE when any face
 * has any side marked — on either generation of the columns.
 *
 * NOT the same as "is it charged". A per-piece or lump-sum row can be worth
 * money with no side ticked at all (a piece hand-fabricated whole); that is
 * priceRow's business, and chargePieces there is deliberately not edgePieces.
 * This answers only "is there edge work on it".
 */
export function rowHasHandPolish(row: StoredRowEdges | null | undefined): boolean {
  return hasAnyFaceWork(row?.shapeType ?? null, rowFaceEdges(row));
}

/* -- the primitives the functions above share ------------------------------ *
 *
 * RESTATED HERE, NOT IMPORTED. shape.ts imports NOTHING — that is the rule at
 * the head of the file, and it is what lets `node --test` reach this module and
 * a client component use it. describeEdges and serializeEdges live in
 * pricing.ts, which imports THIS file; reaching back would be a cycle.
 */

/** "All four" / "Front + back" / "All round" / "None", for one face. */
function describeOneFace(shape: unknown, sel: EdgeSelection | null | undefined): string {
  const e = sel ?? {};
  if (isRound(shape) || e.round) return e.round ? "all round" : "none";
  const on = RECT_EDGES.filter((k) => e[k]);
  if (on.length === 0) return "none";
  if (on.length === RECT_EDGES.length) return "all four";
  return on.join(" + ");
}


/** Serialize one face's selection. Canonical order, round wins outright — the
 *  same rules serializeEdges applies in pricing.ts, restated here because
 *  shape.ts may not import from its own dependent. */
function serializeEdgeSelection(sel: EdgeSelection | null | undefined): string {
  const e = sel ?? {};
  if (e.round) return ROUND_EDGE;
  return RECT_EDGES.filter((k) => e[k]).join(",");
}

function parseEdgeSelection(stored: string | null | undefined): EdgeSelection {
  const parts = String(stored ?? "").split(",").map((p) => p.trim().toLowerCase());
  const out: EdgeSelection = {};
  if (parts.includes(ROUND_EDGE)) { out.round = true; return out; }
  for (const edge of RECT_EDGES) if (parts.includes(edge)) out[edge] = true;
  return out;
}
