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
// PURE, AND IT IMPORTS NOTHING — the rule from pricing.ts and slabLoss.ts, so
// `node --test` reaches it and a client component can use it.

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

/** How a size reads on a screen or a piece label. */
export function describeShapeSize(shape: unknown, dims: PieceDims): string {
  const s = parseShape(shape);
  const l = positive(dims.lengthIn);
  const w = positive(dims.widthIn);
  if (s === "CIRCLE") return l > 0 ? `⌀ ${l} in` : "⌀ —";
  if (s === "OVAL") return l > 0 && w > 0 ? `${l} × ${w} in oval` : "oval —";
  return l > 0 && w > 0 ? `${l} × ${w} in` : "—";
}

/** What the dimension fields are called for this shape, so one form can serve
 *  all three without the labels lying. */
export function dimensionLabels(shape: unknown): { length: string; width: string | null } {
  const s = parseShape(shape);
  if (s === "CIRCLE") return { length: "Diameter (in)", width: null };
  if (s === "OVAL") return { length: "Long axis a (in)", width: "Short axis b (in)" };
  return { length: "Length (in)", width: "Width (in)" };
}
