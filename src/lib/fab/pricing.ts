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
  parseEdgeFace, edgeFaceCount, describeEdgeFace,
  edgeInchesPerPiece as shapeEdgeInches,
  type RectEdge, type PieceShape, type EdgeFace,
  type EdgeSelection as ShapeEdgeSelection,
} from "./shape.ts";

export { parseEdgeFace, edgeFaceCount, describeEdgeFace, DEFAULT_EDGE_FACE, isUnpriceableShape };
export type { EdgeFace };

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
   *  passes of the same line and doubles the feet. */
  edgeFace?: unknown;
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
export type UnpricedReason = "THICKNESS" | "DIMENSIONS" | "SHAPE" | "EDGES";

export interface RowPricing {
  runningFeet: number;
  edgeCost: number;
  sinkPieces: number;
  /** The pieces carrying HAND EDGE POLISH, and the count the running feet are
   *  measured over.
   *
   *  All of them or none of them — a row is homogeneous, and a row where only
   *  some pieces want edge polish is split into two rows instead. So this is
   *  the ordered quantity whenever any edge is marked, and 0 otherwise. See the
   *  note at the top of the file on why there is no edge_quantity column. */
  edgePieces: number;
  /** The pieces of this row that reach the fabricator's bench at all — the ones
   *  with a sink, plus the ones with hand edge polish.
   *
   *  NO LONGER IDENTICAL TO sinkPieces. It used to be, because edge work was
   *  read as the polish that comes with a sink cutout; the owner separated the
   *  two, so a plain row with polished edges is now a fabrication row.
   *
   *  ZERO MEANS "NOT A FABRICATION ROW", which is a different thing from
   *  `unpriced`. Nothing is owed and nothing is missing. */
  fabricationPieces: number;
  /** TOP / BOTTOM / BOTH, as it was read. BOTH means the running feet above
   *  already include the second pass — do not double them again downstream. */
  edgeFace: EdgeFace;
  sinkCost: number;
  total: number;
  /** The rate card entry used, or null when the thickness is not on the card.
   *  Null means BOTH costs are 0 and the row is reported as unpriced — never
   *  silently charged at a neighbouring rate. */
  rate: { sinkPerPiece: number; edgePerFoot: number; nominalMm: PricedThicknessMm } | null;
  /** True when something stopped this row being priced in full. The screen says
   *  so rather than showing ₹0 as if it were free. */
  unpriced: boolean;
  /** Which of the two holes it was. Null when the row priced cleanly. */
  unpricedReason: UnpricedReason | null;
}

/** One ordered row's charge. */
export function priceRow(input: RowPricingInput): RowPricing {
  const rate = rateFor(input.thicknessMm);
  const shape = parseShape(input.shape);
  const qty = Math.max(0, Math.floor(positive(input.quantity)));
  // A sink count larger than the order cannot charge for pieces that do not
  // exist — the same clamp planSlabRelease applies to a stale sink_quantity.
  const sinkPieces = Math.min(qty, Math.max(0, Math.floor(positive(input.sinkQuantity))));

  // THE FEET ARE MEASURED OVER THE EDGE PIECES — WHICH IS THE WHOLE ROW.
  //
  // This used to be `fabricationPieces = sinkPieces`, on the rule that edge work
  // was the hand-polish accompanying a sink. The owner separated them: hand edge
  // polish is chosen independently, on sink rows and plain rows alike. So a row
  // of 60 with 30 sinks and all four edges marked is 60 pieces of edge work and
  // 30 of sink — two counts, two answers, and neither gates the other.
  //
  // The group rule is what makes this a derivation rather than a stored number:
  // a row where only some pieces want edge polish is SPLIT, so any row that has
  // edge work has it on every piece.
  const edgePieces = hasEdgeWork(shape, input.edges) ? qty : 0;
  // AND THE FACES. Polishing top and bottom is the same line walked twice, so
  // it doubles the feet rather than adding a fee — see shape.ts. A row charged
  // for one face when the bench did two is half an invoice.
  const edgeFace = parseEdgeFace(input.edgeFace);
  const feet = runningFeet(input.lengthIn, input.widthIn, edgePieces, input.edges, shape, edgeFace);
  const fabricationPieces = Math.max(sinkPieces, edgePieces);

  // AN OUTLINE THIS MODULE CANNOT MEASURE — L_SHAPE, CURVE, CUSTOM.
  //
  // FIRST, before the dimensions and before the rate, because it is the most
  // fundamental of the three holes: there is no point asking whether the width
  // is filled in when nothing here knows which edges the width belongs to.
  //
  // These three fell through parseShape's default and were PRICED AS RECTANGLES
  // with `unpriced: false`. An L-shaped top marked on all four edges was
  // charged a rectangle's perimeter and every screen showed the figure in
  // black, indistinguishable from one that had been measured. See
  // UNPRICEABLE_SHAPES in shape.ts.
  //
  // THE SINK IS STILL OWED, exactly as in the DIMENSIONS branch below. A sink
  // cutout is a flat ₹230 or ₹300 per piece and has nothing whatever to do with
  // the outline it sits in; withholding it would turn one unknown into two.
  //
  // AND THE PIECES STILL REACH THE BENCH. edgePieces and fabricationPieces are
  // reported unchanged, so an L-shaped row with edges marked still queues for
  // hand polish — the work is real and somebody has to do it. What is withheld
  // is the money, and only until somebody agrees a figure.
  if (isUnpriceableShape(input.shape)) {
    const sinkOnly = rate ? money(sinkPieces * rate.sinkPerPiece) : 0;
    return {
      // ZERO FEET, not the rectangle's answer. A running-foot figure on a row
      // that cannot be measured is the wrong number wearing the right units,
      // and it would be summed into the project total by sumPricing.
      runningFeet: 0, edgeCost: 0, sinkPieces, edgePieces, fabricationPieces,
      edgeFace, sinkCost: sinkOnly, total: sinkOnly, rate,
      unpriced: true, unpricedReason: "SHAPE",
    };
  }

  // THE ROW NAMES EDGES THIS SHAPE DOES NOT HAVE.
  //
  // A circle carrying "front,back,left,right", or a rectangle carrying "round".
  // hasEdgeWork answers each shape in its own vocabulary and says FALSE to both,
  // so edgePieces came out 0 and the row priced at ₹0 with `unpriced: false` —
  // four edges marked on the order, nothing charged, and no flag anywhere. The
  // row plainly asked for edge work; what it did not do is say which edges of
  // the shape it claims to be. See edgeVocabularyMismatch in shape.ts.
  //
  // The sink is still owed, and the feet are zero, for the same reasons as the
  // branch above.
  if (edgeVocabularyMismatch(shape, input.edges)) {
    const sinkOnly = rate ? money(sinkPieces * rate.sinkPerPiece) : 0;
    return {
      runningFeet: 0, edgeCost: 0, sinkPieces, edgePieces, fabricationPieces,
      edgeFace, sinkCost: sinkOnly, total: sinkOnly, rate,
      unpriced: true, unpricedReason: "EDGES",
    };
  }

  // EDGES MARKED, BUT NOTHING TO MEASURE THEM ALONG.
  //
  // A row with `left` polished and a NULL width returned 0 ft, ₹0 and
  // `unpriced: false` — indistinguishable on every screen from a customer who
  // asked for raw edges. One is an answer, the other is a hole in the order, and
  // the invoice was short either way. Now it says which.
  //
  // Checked BEFORE the rate, because a row can have both problems and the
  // missing dimension is the one somebody can actually go and fix.
  if (edgeDimensionsMissing(shape, { lengthIn: input.lengthIn, widthIn: input.widthIn }, input.edges)) {
    // THE SINK IS STILL OWED, and zeroing it here was a bug that cost real
    // money. A sink is charged PER PIECE at a flat rate — Rs230 or Rs300 — and
    // has nothing whatever to do with the row's length or width. A row with 30
    // sinks and a blank width used to report a total of Rs0 rather than Rs6,900,
    // and perPieceCharge then gave those 30 packed pieces a Rs0 share forever.
    //
    // Only the EDGE half is unknown, so only the edge half is withheld. The row
    // is still flagged unpriced so nobody reads the total as complete.
    const sinkOnly = rate ? money(sinkPieces * rate.sinkPerPiece) : 0;
    return {
      // ZERO FEET, like the SHAPE branch above — and this line used to report
      // `feet`, the partial measurement taken along whichever dimension the row
      // DOES have. It read as a real figure and sumPricing added it to the
      // project total: a 60-piece row with a blank width contributed 280 ft to
      // a column whose money said 505 ft, so the CEO's "run ft" tile and its
      // revenue tile stopped reconciling by 55% with nothing on screen to say
      // why. A measurement that is not charged for is not a measurement.
      runningFeet: 0, edgeCost: 0, sinkPieces, edgePieces, fabricationPieces,
      edgeFace, sinkCost: sinkOnly, total: sinkOnly, rate,
      unpriced: true, unpricedReason: "DIMENSIONS",
    };
  }

  if (!rate) {
    return {
      runningFeet: feet, edgeCost: 0, sinkPieces, edgePieces, fabricationPieces,
      edgeFace, sinkCost: 0, total: 0, rate: null, unpriced: true, unpricedReason: "THICKNESS",
    };
  }
  const edgeCost = money(feet * rate.edgePerFoot);
  const sinkCost = money(sinkPieces * rate.sinkPerPiece);
  return {
    runningFeet: feet,
    edgeCost,
    sinkPieces,
    edgePieces,
    fabricationPieces,
    edgeFace,
    sinkCost,
    total: money(edgeCost + sinkCost),
    rate,
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
