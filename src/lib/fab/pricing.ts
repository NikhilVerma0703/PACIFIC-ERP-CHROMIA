// WHAT A PROJECT'S FABRICATION IS WORTH.
//
// Two charges, and they are counted in different units — which is the whole
// reason this file exists rather than a couple of multiplications in a template:
//
//   SINK CUTTING   PER PIECE.        2 cm -> ₹230,  3 cm -> ₹300
//   EDGE WORK      PER RUNNING FOOT. 2 cm -> ₹15,   3 cm -> ₹20
//
// A running foot is a length of finished EDGE, not an area and not a piece. A
// 28 × 22.5 in top with all four edges done is (28 + 28 + 22.5 + 22.5) / 12 =
// 8.42 ft, and sixty of them are 505 ft. Charging that per piece, or per square
// foot, is out by an order of magnitude in either direction.
//
// PURE, AND IT IMPORTS ONE THING — shape.ts, which itself imports nothing. The
// rule from slabLoss.ts and ceoOverview.ts is that `node --test` resolves ESM
// strictly, so the .ts extension is what makes the import work; periodReport.ts
// took the same exception for reportPeriods.ts and ships in production.
//
// ─────────────────────────────────────────── WHICH EDGES ARE CHARGED ────────
// The owner: "same row all have same, so let it be — we show them a graphical
// piece, they choose sides, and feet is calculated and paid."
//
// So the edge selection is PER ORDERED ROW, not per piece. Every piece of row A
// is the same size and gets the same treatment, which is what makes one picker
// per row enough and one picker per piece absurd. It is stored on
// fab_requirement (finished_edges), and this module only does the arithmetic.
//
// ─────────────────────── HAND EDGE POLISH IS ITS OWN DECISION ───────────────
// THIS REVERSES AN EARLIER RULE IN THIS FILE, deliberately, and the old rule is
// left below so the change is legible rather than mysterious.
//
// The rule used to be `fabricationRequired = sinkRequired` — edge work was read
// as the hand-polish that comes WITH a sink cutout, so the feet were counted
// over the sink pieces and a row with no sinks was charged nothing at all.
//
// The owner, on the purchase-order screen: "we choose the sink, there itself we
// need to choose the edge polish, which is NOT the polish of the operator. This
// edge polish is by hand, where we need the running foot length and charge by
// thickness." And on who decides: "any pieces can be assigned the edge hand
// polish or not — this is chosen and done by supervisor, or else the manager
// who uploads the PO."
//
// So there are two hand jobs, and only one of them is implied:
//
//   SINK POLISH   IMPLIED by the sink cut. "Once a piece or group have sink
//                 cut, they will sink cut polish." Nobody chooses it, and it is
//                 inside the per-piece sink rate. It is not a separate line.
//   EDGE POLISH   CHOSEN, independently, on any row — sink or plain. Charged by
//                 the running foot at the thickness rate.
//
// A PLAIN ROW WITH POLISHED EDGES NOW EARNS. That is the whole change, and it
// is money the shop was doing the work for and not billing:
//
//     BEFORE  60 plain pieces, all four edges  ->  ₹0
//     AFTER   60 plain pieces, all four edges  ->  505 ft -> ₹7,575 at 2 cm
//
// ─────────────────────────────── WHY THERE IS NO edge_quantity COLUMN ───────
// The owner settled it: "let them be group itself — because if in a row only a
// few have sink, that's a new group or row, and it should be dynamically
// changeable, and then no issues."
//
// A ROW IS HOMOGENEOUS. If half the pieces need something the other half does
// not, the row is SPLIT into two rows; it is never one row carrying two
// different treatments. So "how many pieces get edge polish" is not a question
// that can be asked of a row — the answer is always all of them or none of
// them, and the edge selection itself already says which. edgePieces is
// therefore derived, not stored, and there is no third count to keep in step.
//
// sinkQuantity survives as a count only because rows written before this rule
// exist and can still be partial. New splits make it 0 or quantity.
//
// The four edges are named the way a fabricator points at them, not by axis:
//
//        ┌──── back ────┐        front and back run the LENGTH
//   left │              │ right  left and right run the WIDTH
//        └──── front ───┘
//
// A round piece has ONE edge and no sides to choose between, so it carries the
// single token `round` in the same column. shape.ts owns that vocabulary and
// the perimeter maths; this file owns the money.
//
// ─────────────────────────────────────────────── UNKNOWN THICKNESS ──────────
// The rate card covers 2 cm and 3 cm because those are the two the shop sells.
// A 12 mm or 8 mm piece is NOT priced at the nearest rate — it returns a null
// rate and the caller shows "not priced" rather than a number nobody agreed to.
// Same rule as sampling/size.ts refusing a unitless thickness: a wrong figure
// that looks right is worse than a gap that asks a question.

import {
  RECT_EDGES, ROUND_EDGE, DEFAULT_SHAPE, DEFAULT_EDGE_FACE,
  parseShape, isRound, hasEdgeWork, edgeDimensionsMissing, isUnpriceableShape,
  edgeVocabularyMismatch,
  POLISH_FACES, faceEdgesFromLegacy, hasAnyFaceWork, faceSideCounts,
  faceEdgeInchesPerPiece, faceEdgeDimensionsMissing, faceEdgeVocabularyMismatch,
  facePairSplit,
  describeFaceEdges, serializeFaceEdges, parseFaceEdges, faceEdgesUnset,
  type FaceEdges, type PolishFace,
  parseEdgeFace, edgeFaceCount, describeEdgeFace,
  edgeInchesPerPiece as shapeEdgeInches,
  type RectEdge, type PieceShape, type EdgeFace,
  type EdgeSelection as ShapeEdgeSelection,
} from "./shape.ts";

export {
  parseEdgeFace, edgeFaceCount, describeEdgeFace, DEFAULT_EDGE_FACE, isUnpriceableShape,
  POLISH_FACES, faceEdgesFromLegacy, hasAnyFaceWork, faceSideCounts,
  faceEdgeInchesPerPiece, describeFaceEdges, serializeFaceEdges, parseFaceEdges,
  faceEdgesUnset,
};
export type { EdgeFace, FaceEdges, PolishFace };

/** The four edges of a rectangular piece, as a fabricator names them.
 *
 *  ALIASED, NOT REDECLARED. shape.ts is the one list; two copies is two places
 *  to add a fifth edge and one of them will be missed. The old name stays
 *  exported because half a dozen call sites import it. */
export const EDGES = RECT_EDGES;
export type Edge = RectEdge;

/** Which edges of a row's pieces are finished. All false = no edge work.
 *  `round` is the whole perimeter of a circle or an oval — see shape.ts. */
export type EdgeSelection = ShapeEdgeSelection;

export const INCHES_PER_FOOT = 12;

/** Nominal slab thicknesses the rate card covers, in MILLIMETRES —
 *  fab_slab.thickness stores mm (20, 30), and a Float, so 20.0. */
export const PRICED_THICKNESS_MM = [20, 30] as const;
export type PricedThicknessMm = (typeof PRICED_THICKNESS_MM)[number];

/** The rate card. Rupees. Change these here and every figure moves together. */
export const RATE_CARD: Record<PricedThicknessMm, { sinkPerPiece: number; edgePerFoot: number }> = {
  20: { sinkPerPiece: 230, edgePerFoot: 15 },   // 2 cm
  30: { sinkPerPiece: 300, edgePerFoot: 20 },   // 3 cm
};

/**
 * The rate card entry for a thickness, or null.
 *
 * TOLERANT ABOUT THE READING, STRICT ABOUT THE VALUE. A gauge reports 19.8 or
 * 30.2 for stone sold as 2 cm and 3 cm, so anything within 1 mm of a nominal
 * thickness is that thickness. Outside that, null — a 12 mm piece is not 2 cm
 * stone priced slightly wrong, it is a product this card does not cover.
 */
export function rateFor(thicknessMm: number | null | undefined): { sinkPerPiece: number; edgePerFoot: number; nominalMm: PricedThicknessMm } | null {
  const t = Number(thicknessMm);
  if (!Number.isFinite(t) || t <= 0) return null;
  for (const nominal of PRICED_THICKNESS_MM) {
    if (Math.abs(t - nominal) <= 1) return { ...RATE_CARD[nominal], nominalMm: nominal };
  }
  return null;
}

/** "2 cm" / "3 cm" for a screen, or the raw millimetres when unpriced. */
export function thicknessLabel(thicknessMm: number | null | undefined): string {
  const r = rateFor(thicknessMm);
  if (r) return `${r.nominalMm / 10} cm`;
  const t = Number(thicknessMm);
  return Number.isFinite(t) && t > 0 ? `${Math.round(t)} mm` : "—";
}

function positive(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
/** Money. Rupees to 2dp — the paise are what make a project total reconcile. */
function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Finished edge length of ONE piece, in INCHES.
 *
 * front and back run the length; left and right run the width. Naming them
 * rather than passing an array of four booleans is the point: [true, false,
 * true, false] is unreadable at the call site and silently wrong if anyone
 * reorders it.
 */
export function edgeInchesPerPiece(
  lengthIn: number | null | undefined,
  widthIn: number | null | undefined,
  edges: EdgeSelection | null | undefined,
  shape: unknown = DEFAULT_SHAPE,
): number {
  // shape LAST and defaulted, so every existing call site — all of which are
  // rectangles — keeps working unchanged and the new argument is opt-in.
  return shapeEdgeInches(shape, { lengthIn, widthIn }, edges);
}

/**
 * Running FEET for `quantity` pieces: one piece's finished edge × that count.
 *
 * THE CALLER DECIDES THE COUNT, and priceRow now passes the EDGE pieces — the
 * ones that were marked for hand polish — which under the group rule is the
 * whole row or none of it. This primitive stays neutral so it can also answer
 * "what would the whole row be at all four", which is what the picker shows
 * beside the live figure.
 */
export function runningFeet(
  lengthIn: number | null | undefined,
  widthIn: number | null | undefined,
  quantity: number | null | undefined,
  edges: EdgeSelection | null | undefined,
  shape: unknown = DEFAULT_SHAPE,
  /** TOP / BOTTOM / BOTH. BOTH walks the same line twice, so it DOUBLES the
   *  feet — see the note in shape.ts. Last and defaulted, so every existing
   *  call site keeps the single-face answer it already had. */
  face: unknown = DEFAULT_EDGE_FACE,
): number {
  const perPiece = edgeInchesPerPiece(lengthIn, widthIn, edges, shape);
  const qty = Math.max(0, Math.floor(positive(quantity)));
  return round2((perPiece * qty * edgeFaceCount(face)) / INCHES_PER_FOOT);
}

/** How many edges are selected. Drives the picker's summary line.
 *  A round piece has exactly one edge, so this is 1 or 0 for it — never 4. */
export function edgeCount(edges: EdgeSelection | null | undefined, shape: unknown = DEFAULT_SHAPE): number {
  const e = edges ?? {};
  if (isRound(shape)) return e.round ? 1 : 0;
  return EDGES.reduce((n, k) => n + (e[k] ? 1 : 0), 0);
}

/** How many edges this shape HAS — the denominator of "2 of 4". */
export function edgeCapacity(shape: unknown = DEFAULT_SHAPE): number {
  return isRound(shape) ? 1 : EDGES.length;
}

/** All four — the common case, and the picker's default. */
export const ALL_EDGES: EdgeSelection = { front: true, back: true, left: true, right: true };

/** The whole perimeter of a round piece — its only possible selection. */
export const ROUND_ALL: EdgeSelection = { round: true };

/** Every edge this shape has. What the picker's "all" button sends. */
export function allEdgesFor(shape: unknown = DEFAULT_SHAPE): EdgeSelection {
  return isRound(shape) ? { ...ROUND_ALL } : { ...ALL_EDGES };
}

/**
 * The stored form of an edge selection: a comma-separated list of edge names,
 * canonically ordered — "front,back,left,right".
 *
 * TEXT rather than four booleans or a JSON blob. Four columns is four
 * migrations the day a fifth edge treatment appears; JSON needs parsing before
 * a human can read a row. This is greppable in psql, sorts, and the canonical
 * order means two identical selections are always the same string, so a
 * value can be compared without being parsed.
 *
 * An unknown word is DROPPED, not kept — a typo must not become a charge.
 *
 * A ROUND PIECE STORES THE SINGLE WORD `round` and nothing else. It has one
 * edge, so "round,front" is not a richer selection, it is a contradiction —
 * and one written by a screen that has the wrong shape for the row. Round wins
 * and the side names are discarded, so the stored value always describes a
 * shape that exists.
 */
export function serializeEdges(edges: EdgeSelection | null | undefined): string {
  const e = edges ?? {};
  if (e.round) return ROUND_EDGE;
  return EDGES.filter((k) => e[k]).join(",");
}

export function parseEdges(stored: string | null | undefined): EdgeSelection {
  const parts = String(stored ?? "").split(",").map((p) => p.trim().toLowerCase());
  const out: EdgeSelection = {};
  if (parts.includes(ROUND_EDGE)) {
    out.round = true;
    return out;
  }
  for (const edge of EDGES) if (parts.includes(edge)) out[edge] = true;
  return out;
}

/** How a selection reads on screen: "All four", "Front + left", "None". */
export function describeEdges(edges: EdgeSelection | null | undefined, shape: unknown = DEFAULT_SHAPE): string {
  const e = edges ?? {};
  if (isRound(shape) || e.round) return e.round ? "All round" : "None";
  const on = EDGES.filter((k) => e[k]);
  if (on.length === 0) return "None";
  if (on.length === EDGES.length) return "All four";
  const nice = on.map((k) => k.charAt(0).toUpperCase() + k.slice(1));
  return nice.join(" + ");
}

/**
 * HOW A ROW'S HAND POLISH IS CHARGED.
 *
 * The owner, on why one card cannot serve: "pricing differs and changeable and
 * vary for each project." Some rows are quoted by the foot, some at a flat
 * figure per piece, and some are one number agreed on a phone call.
 *
 *   RUNNING_FOOT  feet x rate. The default, and what every row already written
 *                 is charged at. NULL means this.
 *   PER_PIECE     quantity x rate. "some will be priced on number of piece —
 *                 one piece this is the price."
 *   LUMP_SUM      one figure for the whole row, entered as the rate.
 *
 * SINK CUTTING IS NOT ON THIS LIST and never will be: it is fixed at Rs230 for
 * 2 cm and Rs300 for 3 cm, per piece, and the owner has said so twice. Only the
 * hand polish is variable.
 */
export const PRICING_MODES = ["RUNNING_FOOT", "PER_PIECE", "LUMP_SUM"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];
export const DEFAULT_PRICING_MODE: PricingMode = "RUNNING_FOOT";

export function parsePricingMode(value: unknown): PricingMode {
  const t = String(value ?? "").trim().toUpperCase();
  return (PRICING_MODES as readonly string[]).includes(t)
    ? (t as PricingMode)
    : DEFAULT_PRICING_MODE;
}

/** How the mode reads on a screen, and what the rate box means under it. */
export function describePricingMode(mode: unknown): { label: string; rateLabel: string } {
  switch (parsePricingMode(mode)) {
    case "PER_PIECE": return { label: "Per piece", rateLabel: "Rs per piece" };
    case "LUMP_SUM":  return { label: "Lump sum",  rateLabel: "Rs for the whole row" };
    default:          return { label: "Per running foot", rateLabel: "Rs per foot" };
  }
}

/**
 * A rate that is a real, usable number, or null.
 *
 * ZERO IS ALLOWED — a row can genuinely be quoted at nothing, and a customer
 * who is not being charged for edge work is a real customer.
 *
 * ─────────────────── AND THAT IS WHY THE EMPTY CHECK COMES FIRST ────────────
 * `Number(null)` is 0. `Number("")` is 0. `Number(false)` is 0. So a naive
 * `Number.isFinite(Number(v))` reads EVERY ABSENT VALUE as a rate of zero — and
 * every one of these fields is NULL on every row in the database, because that
 * is what "nobody typed a rate" looks like coming out of Postgres.
 *
 * The first draft of this function did exactly that. It turned `rate: null`
 * into a rate of Rs0 and `edgeTotalOverride: null` into an agreed total of Rs0,
 * so a row of 60 pieces with all four edges marked priced its hand polish at
 * NOTHING — silently, with unpriced:false, on every row the moment 0067 landed.
 * It was caught by running the module, not by reading it.
 */
function usableRate(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface RowPricingInput {
  lengthIn: number | null | undefined;
  widthIn: number | null | undefined;
  /** Pieces ordered on this row. */
  quantity: number | null | undefined;
  /** fab_requirement.sink_quantity — how many of them get a sink. NULL means
   *  the supervisor has not decided yet, which is not the same as zero, but
   *  costs the same until he does. */
  sinkQuantity?: number | null;
  /** fab_slab.thickness in MILLIMETRES for the stone this row is cut from. */
  thicknessMm: number | null | undefined;
  edges?: EdgeSelection | null;
  /** fab_requirement.shape_type. Absent or unrecognised means RECTANGLE, which
   *  is what every row written before shapes existed is. */
  shape?: unknown;
  /** fab_requirement.edge_faces — TOP / BOTTOM / BOTH. Absent means TOP, which
   *  is what every row written before faces existed was charged as. BOTH is two
   *  passes of the same line and doubles the feet.
   *
   *  SUPERSEDED BY faceEdges below, and kept because every row already written
   *  holds it. Read only when faceEdges is absent. */
  edgeFace?: unknown;

  /**
   * THE THREE-FACE SPECIFICATION — top, bottom and side, each with its own
   * sides. scripts/0067.
   *
   * WINS OVER edges + edgeFace WHEN PRESENT, and is ignored when absent, which
   * is the whole compatibility story: a row nobody has touched with the new
   * screens is read through faceEdgesFromLegacy and prices to the same rupee it
   * always did.
   *
   * Summed across faces, never multiplied — "top on four sides and bottom on
   * two" is a perimeter plus two sides, not a perimeter times something.
   */
  faceEdges?: FaceEdges | null;

  /**
   * THE ROW'S OWN RATE. Rupees per foot, per piece or for the row, depending on
   * pricingMode. NULL falls back to the rate card by thickness — which is what
   * every existing row does and what an ordinary row should keep doing, so
   * nobody types a rate unless the job is unusual.
   */
  rate?: number | null;

  /** RUNNING_FOOT / PER_PIECE / LUMP_SUM. Absent means RUNNING_FOOT. */
  pricingMode?: unknown;

  /**
   * scripts/0069 — RUPEES PER FOOT FOR A SIDE DONE ON BOTH TOP AND BOTTOM.
   *
   * The owner: "if per feet 10 rs then doing top + bottom we will give them 15
   * not 20." Both faces of one edge is a single trip with the piece flipped,
   * not two jobs, so it is quoted as one number rather than charged twice.
   *
   * NULL MEANS NO DISCOUNT: the two faces are summed at `rate`, which is what
   * every row written before 0069 does — so nothing already quoted moves. Zero
   * is a real pair rate (the second face thrown in) and is honoured; NULL is
   * not zero.
   *
   * RUNNING_FOOT ONLY. A rate per foot means nothing under PER_PIECE or
   * LUMP_SUM, which price the piece or the row and have no per-face arithmetic
   * to discount.
   */
  pairRate?: number | null;

  /**
   * scripts/0070 — A RATE PER FACE. The owner: "bottom edge have diff price
   * sometime, top have diff price sometime and side have different price
   * sometime."
   *
   * NULL FALLS BACK TO `rate`, which falls back to the card. So with all three
   * empty every face takes the same figure and the arithmetic below collapses
   * to the single multiplication it was before 0070 — identical to the paisa on
   * every row already written.
   *
   * The SIDE BAND is a different surface, done in its own pass, and never
   * shares a rate with a flat face except by falling back to the same default.
   */
  rateTop?: number | null;
  rateBottom?: number | null;
  rateSide?: number | null;

  /**
   * THE PHONE-CALL NUMBER. Replaces this row's HAND POLISH charge outright.
   *
   * The owner: "always have a custom free field for total so when system feels
   * heavy they call and enter the amount." So it also RESCUES a row this module
   * refuses to price — an L-shaped outline, a blank width, an off-card
   * thickness — because a figure a human agreed is better than a gap, and the
   * gap is exactly when somebody picks up the phone.
   *
   * It does NOT touch the sink, which is fixed and needs no rescuing.
   *
   * The calculated figure is returned beside it as calculatedEdgeCost, never
   * discarded: an override that quietly replaces a number nobody can see again
   * is how a wrong rate card survives for a year.
   */
  edgeTotalOverride?: number | null;
}

/** WHY A ROW COULD NOT BE PRICED. Null when it was priced fine.
 *
 *  THREE different holes, and a screen that shows the same amber box for all
 *  three sends the reader to fix the wrong thing. Each is fixed by a different
 *  person, which is the whole reason they are separate values:
 *    THICKNESS   the stone is not 2 cm or 3 cm — a rate has to be agreed
 *    DIMENSIONS  edges are marked but the length or width they run along is
 *                missing, so there are no feet to charge for. The manager can
 *                go and type it in.
 *    SHAPE       the row is an L, a curve or a custom outline. Nothing is
 *                missing and nothing is typeable: this module has no perimeter
 *                for that outline, and the price is a human decision. Until
 *                SHAPE existed these rows were charged AS RECTANGLES with
 *                `unpriced: false` — a number nobody had measured, presented as
 *                if it were measured.
 *    EDGES       the row names edges the shape does not have — a circle marked
 *                front/back/left/right, or a rectangle marked `round`. The two
 *                halves of the row contradict each other and one of them is
 *                wrong; which one is not for this module to guess.
 */
export type UnpricedReason = "THICKNESS" | "DIMENSIONS" | "SHAPE" | "EDGES" | "RATE";

/**
 * ONE BUCKET OF THE EDGE CHARGE — scripts/0071.
 *
 * WHICH bucket, not which face, and the difference is the whole point. A side
 * polished on BOTH faces is one bucket ("PAIR") priced once, because it is one
 * trip with the piece flipped; a side polished on the top alone is a different
 * bucket at a different rate. Reporting this per FACE would have to charge the
 * shared sides to one of the two faces or to both, and either is a figure the
 * arithmetic never used.
 */
export interface EdgeLine {
  /** PAIR   sides done on top AND bottom, counted once
   *  TOP    sides done on the top only
   *  BOTTOM sides done on the bottom only
   *  SIDE   the vertical band
   *  PIECES a per-piece rate over the row's pieces
   *  LUMP   one agreed figure for the row */
  key: "PAIR" | "TOP" | "BOTTOM" | "SIDE" | "PIECES" | "LUMP";
  /** Said in words, for a screen that has no room to explain the key. */
  label: string;
  /** Feet in this bucket. Zero under PER_PIECE and LUMP_SUM, which have none. */
  feet: number;
  /** The rate this bucket was charged at, in the unit its mode implies. */
  rate: number | null;
  /** What the bucket is worth. The lines sum to edgeCost exactly. */
  cost: number;
  /** WHICH FACES THIS BUCKET BELONGS TO, so a screen showing one face's panel
   *  knows which lines to put in it. PAIR belongs to both. */
  faces: PolishFace[];
}

export interface RowPricing {
  runningFeet: number;
  edgeCost: number;
  sinkPieces: number;
  /** The pieces carrying HAND EDGE POLISH, and the count the running feet are
   *  measured over. All of them or none of them — a row is homogeneous. */
  edgePieces: number;
  /**
   * THE PIECES THE EDGE MONEY IS CHARGED OVER, which is NOT always edgePieces.
   *
   * Under RUNNING_FOOT the two are the same: no ticked edges means no feet
   * means no charge. Under PER_PIECE and LUMP_SUM they part company, because
   * those rates are about the PIECE and not its edges —
   *
   *   "some pieces will be priced on number of piece, one piece this is the
   *    price"  ... "some peices we give to the hand fabricated fully"
   *
   * A piece that goes to the bench whole has no edges to tick. It still has a
   * price. Charging it through edgePieces returned a confident Rs0.
   *
   * THIS IS ALSO THE DIVISOR for the per-piece share (pieceCharge.rowShares).
   * Dividing a real row cost by edgePieces=0 gives every piece a share of zero,
   * and packaging then freezes that zero permanently.
   *
   * AND AN AGREED TOTAL FALLS BACK TO THE ORDERED QUANTITY, for that same
   * reason: the override is typed on exactly the rows nothing could be ticked
   * on — an L outline, a blank width — so under RUNNING_FOOT it would otherwise
   * be spread over zero pieces and Rs0 frozen onto every one of them.
   */
  chargePieces: number;
  /**
   * scripts/0069 — THE FEET OF EDGE DONE ON BOTH FACES, COUNTED ONCE.
   *
   * This is the length the pair rate multiplies, not the distance walked. A
   * side polished top and bottom is ONE side of stone and TWO passes over it,
   * and those are different numbers:
   *
   *     runningFeet  = pairedFeet × 2 + singleFeet     <- passes, the physical work
   *     edgeCost     = pairedFeet × pairRate + singleFeet × edgeRate
   *
   * Row A of PO 10026 done on both faces: runningFeet 1,010, pairedFeet 505.
   * Both are true and they answer different questions — how much walking, and
   * how much stone. Do NOT assume they sum.
   *
   * Zero on every row without a pair rate, which is every row until somebody
   * types one.
   */
  pairedFeet: number;
  /** The feet charged at the ordinary rate — sides done on ONE face only, plus
   *  the side band, which never pairs. With no pair rate this is the whole of
   *  runningFeet and pairedFeet is zero, which is the pre-0069 behaviour. */
  singleFeet: number;
  /** The pair rate actually used, or null when the row has none — in which
   *  case a shared side is charged rateTop + rateBottom. */
  pairRate: number | null;
  /** scripts/0070 — the rate each face was actually charged at, after the
   *  fallback chain (own rate -> row rate -> card). A screen shows these rather
   *  than what was typed, because what was typed is often nothing. */
  rateTop: number | null;
  rateBottom: number | null;
  rateSide: number | null;
  /** What a side polished on BOTH faces cost per foot: the pair rate when one
   *  is set, otherwise rateTop + rateBottom. Null when neither face has a rate. */
  pairEffectiveRate: number | null;
  /** Feet on sides polished on the TOP only, at rateTop. */
  topOnlyFeet: number;
  /** Feet on sides polished on the BOTTOM only, at rateBottom. */
  bottomOnlyFeet: number;
  /** Feet of the vertical band, at rateSide. */
  sideBandFeet: number;
  /** The pieces of this row that reach the fabricator's bench at all — the ones
   *  with a sink, plus the ones with hand edge polish. ZERO MEANS "not a
   *  fabrication row", which is a different thing from `unpriced`. */
  fabricationPieces: number;
  /** TOP / BOTTOM / BOTH, as it was read. LEGACY: meaningful only when the row
   *  had no three-face specification. Read faceEdges/faceCounts instead. */
  edgeFace: EdgeFace;
  /** The three-face specification actually priced — either the row's own, or the
   *  legacy pair read through faceEdgesFromLegacy. */
  faceEdges: FaceEdges;
  /** How many sides each face is polished on: the numbers the owner asked for
   *  and the picker prints. { top: 4, bottom: 2, side: 4 }. */
  faceCounts: Record<PolishFace, number>;
  sinkCost: number;
  total: number;
  rate: { sinkPerPiece: number; edgePerFoot: number; nominalMm: PricedThicknessMm } | null;

  /** RUNNING_FOOT / PER_PIECE / LUMP_SUM — how the edge charge was worked out. */
  pricingMode: PricingMode;
  /** The rate actually applied, in the unit the mode implies, or null when none
   *  was available. */
  edgeRate: number | null;
  /** Where that rate came from. "ROW" is a figure somebody agreed for this row;
   *  "CARD" is the standing 2 cm / 3 cm card. Null when the row could not be
   *  rated at all. Worth showing: a project quoted at Rs22/ft looks identical to
   *  one on the card until you can see which is which. */
  rateSource: "ROW" | "CARD" | null;

  /** True when a human typed the edge total and it replaced the calculation. */
  edgeOverridden: boolean;
  /** WHAT THE CALCULATION SAID, kept beside the override rather than discarded.
   *  Equal to edgeCost when nothing was overridden. */
  calculatedEdgeCost: number;

  /**
   * scripts/0071 — THE MONEY, BUCKET BY BUCKET.
   *
   * The owner, on the supervisor's card: "now it's like showing the full
   * quantity price at below when doing this — no, I need the price only for
   * that particular quantity, because sometimes price differs, we may enter
   * different prices."
   *
   * A row total is the wrong feedback while somebody is typing a rate for ONE
   * face. He types Rs1 against the bottom and the only number that moves is a
   * figure covering three faces and a hundred and fifty pieces, so he cannot
   * tell whether the Rs1 landed where he meant it to.
   *
   * So the charge is returned already split into the buckets it was computed
   * from — the shared sides, top only, bottom only, the band — each with the
   * feet, the rate and the money that bucket is worth. A screen shows the
   * bucket beside the box that priced it.
   *
   * THEY SUM TO calculatedEdgeCost EXACTLY — which is edgeCost on every row
   * nobody has overridden. The last paise of rounding is put on the biggest
   * line rather than left over, because a breakdown that does not add up to
   * the total above it is an afternoon somebody spends on nothing. On an
   * overridden row they still describe the CALCULATION, beside the agreed
   * figure that beat it, for the same reason calculatedEdgeCost is kept.
   *
   * Empty on a row that could not be priced, and on a row with no edge work.
   * Under PER_PIECE and LUMP_SUM there are no feet to bucket, so it is the one
   * line those modes charge.
   */
  edgeLines: EdgeLine[];
  /** The hand-polish charge divided by the pieces it was charged over — what
   *  one piece of this row earns the bench. Zero when nothing is charged. */
  edgeCostPerPiece: number;
  /** Edge plus sink, per ordered piece. Zero on a row with no quantity. */
  totalPerPiece: number;

  /** True when something stopped this row being priced in full. */
  unpriced: boolean;
  /** Which of the holes it was. Null when the row priced cleanly. */
  unpricedReason: UnpricedReason | null;
}

/** One ordered row's charge. */
export function priceRow(input: RowPricingInput): RowPricing {
  const card = rateFor(input.thicknessMm);
  const shape = parseShape(input.shape);
  const qty = Math.max(0, Math.floor(positive(input.quantity)));
  // A sink count larger than the order cannot charge for pieces that do not
  // exist — the same clamp planSlabRelease applies to a stale sink_quantity.
  const sinkPieces = Math.min(qty, Math.max(0, Math.floor(positive(input.sinkQuantity))));
  const mode = parsePricingMode(input.pricingMode);
  const edgeFace = parseEdgeFace(input.edgeFace);

  // ── WHICH SPECIFICATION IS THIS ROW USING? ───────────────────────────────
  //
  // The row's own three faces when it has them; otherwise the legacy pair read
  // through faceEdgesFromLegacy, which returns EXACTLY what edges + edgeFace
  // charged before scripts/0067. That single line is the whole compatibility
  // story, and it is why no quote already sent moves by a paisa.
  const faceEdges: FaceEdges =
    input.faceEdges && Object.keys(input.faceEdges).length > 0
      ? input.faceEdges
      : faceEdgesFromLegacy(input.edges, input.edgeFace);

  // THE RAW VALUE, NOT `shape`, GOES TO EVERY HELPER BELOW — and getting this
  // wrong cost a real figure. parseShape FLATTENS L_SHAPE, CURVE and CUSTOM to
  // RECTANGLE (deliberately: "what shape is this" and "can this be charged" are
  // two questions), so handing the parsed value on loses the one bit that says
  // the outline is unmeasurable. An L-shaped row with an agreed override then
  // reported 505 running feet it does not have — the refusal path forces feet to
  // zero, so it only surfaced on the path that does not refuse.
  //
  // Every helper parses for itself, so the raw value is safe everywhere.
  const faceCounts = faceSideCounts(input.shape, faceEdges);
  const dims = { lengthIn: input.lengthIn, widthIn: input.widthIn };

  // Summed across the three faces, never multiplied — top on four sides and
  // bottom on two is a perimeter plus two sides.
  const edgePieces = hasAnyFaceWork(input.shape, faceEdges) ? qty : 0;
  const inchesPerPiece = faceEdgeInchesPerPiece(input.shape, dims, faceEdges);
  const feet = round2((inchesPerPiece * edgePieces) / INCHES_PER_FOOT);
  const fabricationPieces = Math.max(sinkPieces, edgePieces);

  // ── THE RATE ─────────────────────────────────────────────────────────────
  //
  // The row's own figure wins; the card is the fallback. LUMP_SUM has no rate
  // card equivalent — a lump sum is by definition a number somebody typed — so
  // it is never filled in from the card.
  const rowRate = usableRate(input.rate);
  // THE CARD IS QUOTED PER FOOT — Rs15 at 2 cm, Rs20 at 3 cm — so it is the
  // fallback for RUNNING_FOOT and for nothing else. Letting PER_PIECE fall back
  // to it charged Rs15 A PIECE on a row nobody had quoted, which reads as a
  // plausible small number and is not a rate anyone agreed. A lump sum is by
  // definition a figure somebody typed; so, now, is a per-piece rate.
  const perFoot = mode === "RUNNING_FOOT";
  const cardRate = perFoot && card ? card.edgePerFoot : null;
  const edgeRate = rowRate !== null ? rowRate : cardRate;
  const rateSource: "ROW" | "CARD" | null =
    rowRate !== null ? "ROW" : (cardRate !== null ? "CARD" : null);

  // FACES DECIDE THE FEET. THEY DO NOT DECIDE WHETHER A PRICE APPLIES.
  //
  // Under RUNNING_FOOT they are the same question — no edges, no feet, nothing
  // to charge. Under the other two they are not, and conflating them is what
  // made "35 pieces, fully by hand, Rs150 each" come out as Rs0 with
  // `unpriced: false` — a silent zero on an invoice, which is the one failure
  // this module exists to prevent.
  const chargePieces = perFoot ? edgePieces : (rowRate !== null ? qty : 0);

  // ── ONE TRIP, FLIPPED — scripts/0069 ─────────────────────────────────────
  //
  // "If per feet 10 rs then doing top + bottom we will give them 15 not 20."
  //
  // A side polished on both faces is ONE pass with the piece turned over, so it
  // is quoted as one number instead of being charged twice. The discount lands
  // on THE SIDES THAT ACTUALLY SHARE BOTH FACES and nowhere else: top on four
  // with bottom on two pairs the two and charges the other two at the ordinary
  // rate. facePairSplit owns that rule.
  //
  // A pair rate is a rate PER FOOT, so it applies under RUNNING_FOOT only —
  // per piece and lump sum have no per-face arithmetic to discount.
  //
  // NULL PAIR RATE MEANS THE OLD BEHAVIOUR EXACTLY. `split` is still computed,
  // because the screens show the breakdown, but the money falls through to
  // feet × rate — the same single multiplication as before 0069, over the same
  // feet, which is why no row already quoted moves by a paisa.
  const usePair = perFoot ? usableRate(input.pairRate) : null;
  const split = facePairSplit(input.shape, dims, faceEdges);
  const pairedFeet = round2((split.pairedInches * edgePieces) / INCHES_PER_FOOT);
  const singleFeet = round2((split.singleInches * edgePieces) / INCHES_PER_FOOT);
  // RAW AND ROUNDED ARE BOTH KEPT ON PURPOSE. The rounded ones are what a
  // screen prints; the raw ones are what the per-face money is computed from,
  // because rounding four buckets and then adding them is not the same number
  // as adding them and rounding once.
  const pairedRawFeet = (split.pairedInches * edgePieces) / INCHES_PER_FOOT;
  const topOnlyRawFeet = (split.topOnlyInches * edgePieces) / INCHES_PER_FOOT;
  const bottomOnlyRawFeet = (split.bottomOnlyInches * edgePieces) / INCHES_PER_FOOT;
  const sideBandRawFeet = (split.sideInches * edgePieces) / INCHES_PER_FOOT;
  const topOnlyFeet = round2(topOnlyRawFeet);
  const bottomOnlyFeet = round2(bottomOnlyRawFeet);
  const sideBandFeet = round2(sideBandRawFeet);

  // ── A RATE PER FACE — scripts/0070 ───────────────────────────────────────
  //
  // "Top have their rate, bottom have their rate. If pair rate is empty use the
  //  sum, if something is written use this new rate, that's it. Side is diff."
  //
  // Each face falls back to the row's rate, which falls back to the card. With
  // every box empty all three are the same number and this whole block reduces
  // to `feet x edgeRate` — the single multiplication that priced every row
  // before 0070, giving the identical answer. That equivalence is asserted in
  // tests/fabHandPolish.test.ts, not just claimed here.
  const rateTop    = perFoot ? (usableRate(input.rateTop)    ?? edgeRate) : null;
  const rateBottom = perFoot ? (usableRate(input.rateBottom) ?? edgeRate) : null;
  const rateSide   = perFoot ? (usableRate(input.rateSide)   ?? edgeRate) : null;

  // A SHARED SIDE IS ONE TRIP WITH THE PIECE FLIPPED. An explicit pair rate is
  // the quoted figure for that trip; with none, it costs what the two faces
  // cost — which is precisely the old "sum the faces" behaviour, arrived at
  // from the other direction.
  const pairEffectiveRate =
    usePair !== null ? usePair
    : (rateTop === null && rateBottom === null) ? null
    : (rateTop ?? 0) + (rateBottom ?? 0);

  // "Nobody has used the new feature on this row" — no pair rate, and all three
  // faces on the same figure, which is what NULL/NULL/NULL falling back to the
  // row rate or the card always produces.
  const uniformRate =
    usePair === null && rateTop === rateBottom && rateBottom === rateSide;

  // IS THERE A RATE FOR THIS ROW ANYWHERE? — and scripts/0070 left this behind
  // too, in the same way the refusal below did.
  //
  // The guard used to read `edgeRate === null`, which is the ROW's rate falling
  // back to the CARD. A row priced entirely PER FACE has neither, so the whole
  // calculation short-circuited to zero before any of the per-face arithmetic
  // underneath it ran — and because the money was already 0, fixing the refusal
  // alone changed nothing. Under RUNNING_FOOT a face's own rate counts.
  //
  // Per piece and lump sum are unchanged: they have no per-face arithmetic, so
  // for them the only rate that exists is still edgeRate.
  const rateAvailable = perFoot
    ? (edgeRate !== null || rateTop !== null || rateBottom !== null || rateSide !== null)
    : edgeRate !== null;

  const calculatedEdgeCost =
    !rateAvailable || chargePieces === 0
      ? 0
      // THESE TWO STILL NEED edgeRate ITSELF, and now they have to say so.
      // The old outer guard was `edgeRate === null`, which narrowed it for
      // every branch below; `rateAvailable` is a broader question (it counts
      // per-face rates) and cannot narrow it. Unreachable at null in practice —
      // rateAvailable is exactly `edgeRate !== null` under these two modes —
      // but written out rather than asserted, because a `!` here would be a
      // crash on any future path that widens the guard again.
      : mode === "PER_PIECE" ? (edgeRate === null ? 0 : money(chargePieces * edgeRate))
      : mode === "LUMP_SUM"  ? (edgeRate === null ? 0 : money(edgeRate))
      // ── ONE RATE FOR EVERYTHING TAKES THE OLD LINE, UNCHANGED ──────────
      //
      // Not an optimisation — a GUARANTEE. Splitting the feet into four buckets
      // and rounding each before multiplying is not the same arithmetic as
      // rounding the total once and multiplying that, and the difference is
      // real money: a 10-piece circle done on both faces came to Rs1,885.05 the
      // old way (125.67 ft x Rs15) and Rs1,884.90 the new one (62.83 ft x Rs30).
      // Fifteen paise, on a row nobody had touched.
      //
      // EVERY ROW IN THE DATABASE IS THIS CASE — all three face rates NULL and
      // no pair rate, so all three fall back to the same figure. Those rows go
      // down the identical code path they always did, and cannot move. Only a
      // row that actually uses the new feature takes the branch below.
      //
      // AND IT MULTIPLIES BY rateTop, NOT edgeRate, WHICH IS THE WHOLE POINT.
      // "All three faces agree" is ALSO true when a supervisor types the SAME
      // agreed figure into all three boxes — top, bottom and side at Rs12 — and
      // this line then charged edgeRate: the row rate falling back to the CARD.
      // Row A of PO 10026 quoted at Rs12 a foot on every face billed 505 ft x
      // Rs15 = Rs7,575 instead of Rs6,060, and the breakdown underneath it
      // printed the customer's Rs12 beside the card's money. The agreed figure
      // was collected, shown, and thrown away at the one line that charges.
      //
      // On every row already in the database this changes NOTHING: with all
      // three boxes empty rateTop IS edgeRate (each face falls back to it), so
      // the multiplication is byte-identical and no quote already sent moves.
      //
      // `rateTop !== null` GUARDS THE MULTIPLICATION, not just the branch.
      // uniformRate is true when no pair rate is set and the three faces agree
      // — which they also do at NULL/NULL/NULL on a row with no card. Taking
      // this branch then computed `feet * null` and returned NaN, so a row
      // priced per face at one uniform figure would have reported garbage
      // instead of the zero it used to. It falls through to the per-face path,
      // which multiplies each bucket by its own rate and needs no fallback.
      : uniformRate && rateTop !== null
        ? money(feet * rateTop)
        // The per-face path multiplies UNROUNDED feet and rounds once at the
        // end, which is the most accurate thing to do when the buckets really
        // are priced differently and there is no historical figure to match.
        : money(
            pairedRawFeet     * (pairEffectiveRate ?? 0) +
            topOnlyRawFeet    * (rateTop    ?? 0) +
            bottomOnlyRawFeet * (rateBottom ?? 0) +
            sideBandRawFeet   * (rateSide   ?? 0)
          );

  // ── THE MONEY, BUCKET BY BUCKET — scripts/0071 ───────────────────────────
  //
  // "I need the price only for that particular quantity, because sometimes
  // price differs, we may enter different prices."
  //
  // The same arithmetic as calculatedEdgeCost above, kept as its parts instead
  // of collapsed into one figure, so the screen that asked for a rate can show
  // what that rate bought. NOT A SECOND CALCULATION: the buckets, the feet and
  // the rates are the ones the charge was computed from, and the total is
  // reconciled back onto them below.
  //
  // BUCKETS, NOT FACES. A side polished top and bottom is ONE bucket priced
  // once — one trip with the piece flipped — so it cannot be charged to "top"
  // or to "bottom" without inventing a figure the arithmetic never used. It
  // carries both faces in `faces` and a screen showing either face's panel
  // shows it.
  const facesWithWork = POLISH_FACES.filter((f) => faceCounts[f] > 0);
  const edgeLines: EdgeLine[] = (() => {
    // THE SAME QUESTION THE CHARGE ASKS — `rateAvailable`, not `edgeRate`.
    //
    // This guard used to read `edgeRate === null`, which is the ROW's rate
    // falling back to the CARD, and that is the one thing a per-face row does
    // not have: a row off the card (35 mm stone, or simply not on a slab yet)
    // priced at Rs18 on the top charges Rs9,090 through the per-face path and
    // returned NO buckets at all — empty on exactly the rows the breakdown was
    // built for, with the panel beside the Rs18 box the supervisor had just
    // typed showing nothing. It also broke the documented invariant above:
    // the lines sum to calculatedEdgeCost EXACTLY, and 0 is not Rs9,090.
    //
    // PER_PIECE and LUMP_SUM below still need edgeRate itself for their `rate:`
    // field, so they say so explicitly rather than leaning on this line — the
    // same reason calculatedEdgeCost writes those two checks out.
    if (!rateAvailable || chargePieces === 0) return [];
    if (mode === "PER_PIECE") {
      if (edgeRate === null) return [];
      return [{
        key: "PIECES" as const,
        label: `${chargePieces} piece${chargePieces === 1 ? "" : "s"} by hand`,
        feet: 0, rate: edgeRate, cost: calculatedEdgeCost, faces: facesWithWork,
      }];
    }
    if (mode === "LUMP_SUM") {
      if (edgeRate === null) return [];
      return [{
        key: "LUMP" as const, label: "one figure for the whole row",
        feet: 0, rate: edgeRate, cost: calculatedEdgeCost, faces: facesWithWork,
      }];
    }
    const buckets = [
      { key: "PAIR" as const,   label: "sides done top and bottom",
        feet: pairedFeet,     raw: pairedRawFeet,     rate: pairEffectiveRate,
        faces: ["top", "bottom"] as PolishFace[] },
      { key: "TOP" as const,    label: "sides done on the top only",
        feet: topOnlyFeet,    raw: topOnlyRawFeet,    rate: rateTop,
        faces: ["top"] as PolishFace[] },
      { key: "BOTTOM" as const, label: "sides done on the bottom only",
        feet: bottomOnlyFeet, raw: bottomOnlyRawFeet, rate: rateBottom,
        faces: ["bottom"] as PolishFace[] },
      { key: "SIDE" as const,   label: "the vertical side band",
        feet: sideBandFeet,   raw: sideBandRawFeet,   rate: rateSide,
        faces: ["side"] as PolishFace[] },
    ].filter((b) => b.raw > 0);

    const out: EdgeLine[] = buckets.map((b) => ({
      key: b.key, label: b.label, feet: b.feet, rate: b.rate,
      cost: money(b.raw * (b.rate ?? 0)), faces: b.faces,
    }));

    // ONE RATE FOR EVERYTHING took the single-multiplication branch above, and
    // four rounded buckets do not always add up to it — fifteen paise on a
    // 10-piece circle, which is the very drift that branch exists to avoid.
    // The remainder goes on the DEAREST line, where it is proportionally
    // smallest, so the breakdown reconciles with the charge to the paisa.
    if (out.length) {
      const drift = money(calculatedEdgeCost - out.reduce((t, l) => t + l.cost, 0));
      if (drift !== 0) {
        let biggest = 0;
        for (let i = 1; i < out.length; i += 1) if (out[i].cost > out[biggest].cost) biggest = i;
        out[biggest] = { ...out[biggest], cost: money(out[biggest].cost + drift) };
      }
    }
    return out;
  })();

  // ── AND WHAT ONE PIECE OF IT IS WORTH — scripts/0071 ─────────────────────
  //
  // Divided by the pieces the money was actually charged over, which is
  // chargePieces for the edge and the ORDERED quantity for the row: a row with
  // sinks on some pieces and edge work on all of them has two divisors, and
  // using one for both would misreport whichever it was not.
  //
  // Derived here rather than on a screen so the card, the PO page and the CEO
  // board cannot arrive at three answers, which is the rule this whole module
  // exists to hold.
  const shares = (edgeCost: number, total: number, over: number = chargePieces) => ({
    edgeCostPerPiece: over > 0 ? money(edgeCost / over) : 0,
    totalPerPiece: qty > 0 ? money(total / qty) : 0,
  });

  // The sink is FIXED and comes only from the card. It is never rated by the
  // row, never by the mode, and the owner has said so twice.
  const sinkCost = card ? money(sinkPieces * card.sinkPerPiece) : 0;

  const base = {
    sinkPieces, edgePieces, chargePieces, fabricationPieces, edgeFace, faceEdges, faceCounts,
    // ALWAYS REPORTED NOW, not only when a pair rate is set: the split is what
    // the arithmetic actually uses, so hiding it would leave a screen unable to
    // explain a figure it is showing.
    pairedFeet, singleFeet, topOnlyFeet, bottomOnlyFeet, sideBandFeet,
    pairRate: usePair,
    rateTop, rateBottom, rateSide, pairEffectiveRate,
    sinkCost, rate: card, pricingMode: mode, edgeRate, rateSource,
    // scripts/0071 — the parts the charge was computed from. refuse() blanks
    // them for the same reason it blanks the feet.
    edgeLines,
  };

  // ── THE PHONE-CALL NUMBER WINS, AND IT WINS FIRST ────────────────────────
  //
  // "Always have a custom free field for total so when system feels heavy they
  // call and enter the amount." Checked before every refusal below, because the
  // refusals are exactly when somebody picks up the phone: an L-shaped outline,
  // a blank width, a thickness nobody has a rate for. A figure a human agreed
  // beats a gap.
  //
  // The SINK is untouched by it — fixed, per piece, and needing no rescue.
  const override = usableRate(input.edgeTotalOverride);
  if (override !== null) {
    // AN AGREED TOTAL ALWAYS HAS PIECES TO SPREAD OVER — the ORDERED ones.
    //
    // chargePieces is edgePieces under RUNNING_FOOT, and that is ZERO on the
    // rows the override exists for: the L-shaped 60-piece row nobody ticked a
    // side on, priced at Rs50,000 over the phone. The row then reported
    // Rs50,000 with `unpriced: false` and a per-piece share of NOTHING, so
    // rowShares handed every piece 0 with rowHasEdgeWork false while mayFreeze
    // said yes — and packing froze Rs0 onto all sixty pieces permanently,
    // because charged_at is written once and never rewritten. The period report
    // then pays Rs0 on a row somebody agreed Rs50,000 for.
    //
    // The overridden figure covers THE ROW, so its divisor is the row's
    // quantity whenever no narrower count applies. chargePieces is reported as
    // the corrected count too, because it is what the money was spread over and
    // pieceCharge/slabCosting divide by exactly that field.
    const agreedOver = chargePieces > 0 ? chargePieces : qty;
    return {
      ...base,
      chargePieces: agreedOver,
      runningFeet: feet, edgeCost: override, total: money(override + sinkCost),
      ...shares(override, money(override + sinkCost), agreedOver),
      edgeOverridden: true, calculatedEdgeCost,
      unpriced: false, unpricedReason: null,
    };
  }

  // ── AND OTHERWISE, THE FOUR WAYS A ROW CANNOT BE PRICED ──────────────────
  //
  // Each returns ZERO FEET, because a measurement that is not charged for is
  // not a measurement — it would be summed into the project total by sumPricing
  // and the feet column would stop reconciling with the money beside it.
  //
  // THE SINK IS OWED IN EVERY ONE OF THEM. It is a flat per-piece rate with
  // nothing to do with the outline, the size or the edge rate; withholding it
  // turns one unknown into two, which is a bug this file has already had once.
  const refuse = (reason: UnpricedReason): RowPricing => ({
    ...base,
    // pairedFeet and singleFeet go to zero WITH runningFeet, for the same
    // reason: a measurement that is not charged for is not a measurement, and
    // a breakdown that still shows 280 ft beside a charge of nothing is a
    // reconciliation somebody will waste an afternoon on.
    runningFeet: 0, pairedFeet: 0, singleFeet: 0,
    topOnlyFeet: 0, bottomOnlyFeet: 0, sideBandFeet: 0,
    edgeCost: 0, total: sinkCost,
    // The breakdown goes with the feet. A row showing "280 ft of top at Rs15"
    // beside a charge of nothing is the same reconciliation trap, itemised.
    edgeLines: [],
    ...shares(0, sinkCost),
    edgeOverridden: false, calculatedEdgeCost: 0,
    unpriced: true, unpricedReason: reason,
  });

  // An L, a curve or a custom outline. FIRST, because there is no point asking
  // whether the width is filled in when nothing here knows which edges it
  // belongs to.
  if (isUnpriceableShape(input.shape)) return refuse("SHAPE");

  // A face names sides the shape does not have — a circle marked front/back, a
  // rectangle marked round. The two halves of the row contradict each other.
  if (faceEdgeVocabularyMismatch(input.shape, faceEdges)) return refuse("EDGES");

  // Edges marked, and the dimension they run along is missing.
  if (faceEdgeDimensionsMissing(input.shape, dims, faceEdges)) return refuse("DIMENSIONS");

  // NO RATE AT ALL, and this is the one that changed shape in scripts/0067.
  //
  // It used to be "the thickness is not on the card", full stop. Now a row can
  // carry its OWN rate, so an off-card thickness with an agreed figure prices
  // perfectly well and only the sink is affected. The refusal is therefore
  // about the RATE being missing, not the thickness being odd — and it fires
  // only when the row actually has edge work to charge for.
  //
  // ── AND scripts/0070 LEFT THIS CHECK BEHIND ──────────────────────────────
  //
  // It asked `edgeRate === null`, which is the ROW's rate falling back to the
  // card. 0070 then gave every FACE its own rate — and this line never learned
  // about them. So a row priced entirely per face, with no row-level figure and
  // no card to fall back on, was refused outright even though every face it
  // uses carries a number somebody typed.
  //
  // "No card to fall back on" is not an edge case: a row is off the card
  // whenever it is NOT ON A SLAB YET, because the thickness comes from the
  // stone. Found on PO 1612104578, where the owner's spec prices ten rows per
  // face — Rs10 top, Rs10 bottom, Rs25 side band. On a 2 cm slab they came to
  // Rs3,58,497.92. Off stone, every one reported ZERO and "not priced", so
  // Rs2,78,497.92 of agreed hand polish vanished from the board until somebody
  // happened to allocate the row.
  //
  // So the question is asked per face: is there a rate for the work this row
  // actually has? All of them missing is still a refusal — which is exactly
  // today's behaviour for a row nobody has priced, so nothing already quoted
  // moves. SOME missing pays what is known and says so, below.
  const faceHasWork: Record<PolishFace, boolean> = {
    top: faceCounts.top > 0, bottom: faceCounts.bottom > 0, side: faceCounts.side > 0,
  };
  const faceRateUsed: Record<PolishFace, number | null> = {
    top: rateTop, bottom: rateBottom, side: rateSide,
  };
  const facesSelected = POLISH_FACES.filter((f) => faceHasWork[f]);
  const facesRated = facesSelected.filter((f) => faceRateUsed[f] !== null);

  if (perFoot && edgePieces > 0 && facesRated.length === 0) return refuse("THICKNESS");

  // PER PIECE OR LUMP SUM WITH NO RATE TYPED.
  //
  // Neither can fall back to the card, so an untyped rate leaves nothing to
  // charge with. It REFUSES rather than returning zero: somebody deliberately
  // chose a mode here, which is a half-finished answer, and a half-finished
  // answer must look different from "this row is free".
  if (!perFoot && rowRate === null) return refuse("RATE");

  // A ROW WITH SINKS ON STONE THE CARD DOES NOT COVER.
  //
  // The sink cannot be priced — it is a card rate and there is no card. But the
  // EDGE can, if the row carries its own figure, and withholding it would repeat
  // the mistake the DIMENSIONS branch had to be fixed for: turning one unknown
  // into two, and taking money off the invoice that nobody was unsure about.
  //
  // So this pays the edge, zeroes the sink, and says THICKNESS out loud.
  if (sinkPieces > 0 && !card) {
    return {
      ...base,
      runningFeet: feet, edgeCost: calculatedEdgeCost,
      total: calculatedEdgeCost,           // sinkCost is 0 with no card
      ...shares(calculatedEdgeCost, calculatedEdgeCost),
      edgeOverridden: false, calculatedEdgeCost,
      unpriced: true, unpricedReason: "THICKNESS",
    };
  }

  // SOME FACES RATED AND SOME NOT — pay what is known, flag the rest.
  //
  // The same shape as the sink branch above and for the same reason: turning
  // one unknown into two takes money off the invoice that nobody was unsure
  // about. A row with Rs10 on the top and nothing on the side band is worth the
  // top; the band contributes zero and the screen must say why rather than
  // presenting the short figure as final.
  //
  // Only reachable with NO CARD (an unknown or off-card thickness), because a
  // card rate is the fallback for every face — so on any row whose stone is
  // known this cannot fire, and nothing already quoted moves.
  if (perFoot && edgePieces > 0 && facesRated.length < facesSelected.length) {
    return {
      ...base,
      runningFeet: feet,
      edgeCost: calculatedEdgeCost,
      total: money(calculatedEdgeCost + sinkCost),
      ...shares(calculatedEdgeCost, money(calculatedEdgeCost + sinkCost)),
      edgeOverridden: false,
      calculatedEdgeCost,
      unpriced: true,
      unpricedReason: "THICKNESS",
    };
  }

  return {
    ...base,
    runningFeet: feet,
    edgeCost: calculatedEdgeCost,
    total: money(calculatedEdgeCost + sinkCost),
    ...shares(calculatedEdgeCost, money(calculatedEdgeCost + sinkCost)),
    edgeOverridden: false,
    calculatedEdgeCost,
    unpriced: false,
    unpricedReason: null,
  };
}

export interface PricingTotals {
  runningFeet: number;
  edgeCost: number;
  sinkPieces: number;
  /** Pieces carrying hand edge polish across all rows. Beside sinkPieces rather
   *  than folded into it: they are two jobs at two rates and a total that shows
   *  one number cannot be checked against either bench's day. */
  edgePieces: number;
  sinkCost: number;
  total: number;
  /** Rows the card could not price. Surfaced, not swallowed: a project total
   *  that quietly omits four rows is worse than one that says it did. */
  unpricedRows: number;
  /** …and split by cause, because they are fixed by different people: a missing
   *  width is the manager's to enter, an off-card thickness is a rate to agree,
   *  and an L or a curve is a quote somebody has to work out by hand. */
  unpricedThickness: number;
  unpricedDimensions: number;
  unpricedShape: number;
  unpricedEdges: number;
  /** Rows whose hand-polish charge is a figure somebody typed rather than one
   *  this module worked out. Surfaced so a project total that is half manual
   *  says so on the screen instead of looking fully calculated. */
  overriddenRows: number;
}

/** Sum a set of priced rows. Money is added at 2dp and rounded once at the
 *  end, so the total equals the sum of the column on screen. */
export function sumPricing(rows: RowPricing[]): PricingTotals {
  const list = rows ?? [];
  return {
    runningFeet: round2(list.reduce((n, r) => n + r.runningFeet, 0)),
    edgeCost: money(list.reduce((n, r) => n + r.edgeCost, 0)),
    sinkPieces: list.reduce((n, r) => n + r.sinkPieces, 0),
    edgePieces: list.reduce((n, r) => n + (r.edgePieces ?? 0), 0),
    sinkCost: money(list.reduce((n, r) => n + r.sinkCost, 0)),
    total: money(list.reduce((n, r) => n + r.total, 0)),
    unpricedRows: list.filter((r) => r.unpriced).length,
    unpricedThickness: list.filter((r) => r.unpricedReason === "THICKNESS").length,
    unpricedDimensions: list.filter((r) => r.unpricedReason === "DIMENSIONS").length,
    unpricedShape: list.filter((r) => r.unpricedReason === "SHAPE").length,
    unpricedEdges: list.filter((r) => r.unpricedReason === "EDGES").length,
    overriddenRows: list.filter((r) => r.edgeOverridden).length,
  };
}

/** Rupees, grouped the Indian way — ₹1,20,500.00, not ₹120,500.00. */
export function formatRupees(n: number): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  const neg = v < 0;
  const [whole, frac] = Math.abs(v).toFixed(2).split(".");
  // Last three digits, then pairs: 1 20 500 -> "1,20,500".
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}₹${grouped}.${frac}`;
}
