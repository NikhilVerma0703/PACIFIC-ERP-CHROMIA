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
// PURE, AND IT IMPORTS NOTHING — the rule from slabLoss.ts, pieceNaming.ts and
// ceoOverview.ts: `node --test` resolves ESM strictly, so a relative import
// without a .ts extension fails at runtime while adding the extension fights
// the Next build.
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
// ──────────────────────────────── AND ONLY ON THE PIECES THAT GO THERE ──────
// The owner again, correcting an earlier reading of this: "this part is only
// for the sink cut pieces — the fabrication, pieces only which can come to
// fabrication."
//
// EDGE WORK IS FABRICATION WORK, and requirement-derive.ts has said so all
// along: `fabricationRequired = sinkRequired`, because "fabrication here means
// the outsourced hand-polish of the sink cutout, so it never applies to a piece
// without a sink". A plain piece is cut and machine-polished and goes out; it
// never reaches the fabricator, so there is nothing to charge for it.
//
// So the running feet are counted over the SINK PIECES, not the ordered
// quantity. A row of 60 with 30 sinks is 30 pieces' worth of edge:
//
//     RIGHT   101 in × 30 / 12 = 252.5 ft  ->  ₹3,787.50 at 2 cm
//     WRONG   101 in × 60 / 12 = 505 ft    ->  ₹7,575.00, twice the work done
//
// A row with no sinks is not a fabrication row at all: zero feet, zero charge.
// That is NOT the same as `unpriced`, which means the thickness is off the rate
// card. `fabricationPieces` on the result says which of the two a screen is
// looking at, so "no fabrication on this row" never renders as "free".
//
// The four edges are named the way a fabricator points at them, not by axis:
//
//        ┌──── back ────┐        front and back run the LENGTH
//   left │              │ right  left and right run the WIDTH
//        └──── front ───┘
//
// ─────────────────────────────────────────────── UNKNOWN THICKNESS ──────────
// The rate card covers 2 cm and 3 cm because those are the two the shop sells.
// A 12 mm or 8 mm piece is NOT priced at the nearest rate — it returns a null
// rate and the caller shows "not priced" rather than a number nobody agreed to.
// Same rule as sampling/size.ts refusing a unitless thickness: a wrong figure
// that looks right is worse than a gap that asks a question.

/** The four edges of a rectangular piece, as a fabricator names them. */
export const EDGES = ["front", "back", "left", "right"] as const;
export type Edge = (typeof EDGES)[number];

/** Which edges of a row's pieces are finished. All false = no edge work. */
export type EdgeSelection = Partial<Record<Edge, boolean>>;

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
): number {
  const l = positive(lengthIn);
  const w = positive(widthIn);
  const e = edges ?? {};
  let inches = 0;
  if (e.front) inches += l;
  if (e.back) inches += l;
  if (e.left) inches += w;
  if (e.right) inches += w;
  return round2(inches);
}

/**
 * Running FEET for `quantity` pieces: one piece's finished edge × that count.
 *
 * THE CALLER DECIDES THE COUNT, and priceRow passes the FABRICATION pieces —
 * the sink ones — not the ordered quantity. This primitive stays neutral so it
 * can also answer "what would the whole row be", which is what the picker shows
 * beside the live figure.
 */
export function runningFeet(
  lengthIn: number | null | undefined,
  widthIn: number | null | undefined,
  quantity: number | null | undefined,
  edges: EdgeSelection | null | undefined,
): number {
  const perPiece = edgeInchesPerPiece(lengthIn, widthIn, edges);
  const qty = Math.max(0, Math.floor(positive(quantity)));
  return round2((perPiece * qty) / INCHES_PER_FOOT);
}

/** How many edges are selected. Drives the picker's summary line. */
export function edgeCount(edges: EdgeSelection | null | undefined): number {
  const e = edges ?? {};
  return EDGES.reduce((n, k) => n + (e[k] ? 1 : 0), 0);
}

/** All four — the common case, and the picker's default. */
export const ALL_EDGES: EdgeSelection = { front: true, back: true, left: true, right: true };

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
 */
export function serializeEdges(edges: EdgeSelection | null | undefined): string {
  const e = edges ?? {};
  return EDGES.filter((k) => e[k]).join(",");
}

export function parseEdges(stored: string | null | undefined): EdgeSelection {
  const parts = String(stored ?? "").split(",").map((p) => p.trim().toLowerCase());
  const out: EdgeSelection = {};
  for (const edge of EDGES) if (parts.includes(edge)) out[edge] = true;
  return out;
}

/** How a selection reads on screen: "All four", "Front + left", "None". */
export function describeEdges(edges: EdgeSelection | null | undefined): string {
  const on = EDGES.filter((k) => (edges ?? {})[k]);
  if (on.length === 0) return "None";
  if (on.length === EDGES.length) return "All four";
  const nice = on.map((e) => e.charAt(0).toUpperCase() + e.slice(1));
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
}

export interface RowPricing {
  runningFeet: number;
  edgeCost: number;
  sinkPieces: number;
  /** The pieces of this row that reach fabrication, and therefore the count the
   *  running feet are measured over. Identical to sinkPieces — fabrication IS
   *  the sink pieces (requirement-derive.ts: fabricationRequired = sinkRequired)
   *  — and named separately because the two facts are read for different
   *  reasons and one of them could change without the other.
   *
   *  ZERO MEANS "NOT A FABRICATION ROW", which is a different thing from
   *  `unpriced`. Nothing is owed and nothing is missing. */
  fabricationPieces: number;
  sinkCost: number;
  total: number;
  /** The rate card entry used, or null when the thickness is not on the card.
   *  Null means BOTH costs are 0 and the row is reported as unpriced — never
   *  silently charged at a neighbouring rate. */
  rate: { sinkPerPiece: number; edgePerFoot: number; nominalMm: PricedThicknessMm } | null;
  /** True when a thickness this card does not cover stopped the row being
   *  priced. The screen says so rather than showing ₹0 as if it were free. */
  unpriced: boolean;
}

/** One ordered row's charge. */
export function priceRow(input: RowPricingInput): RowPricing {
  const rate = rateFor(input.thicknessMm);
  const qty = Math.max(0, Math.floor(positive(input.quantity)));
  // A sink count larger than the order cannot charge for pieces that do not
  // exist — the same clamp planSlabRelease applies to a stale sink_quantity.
  const sinkPieces = Math.min(qty, Math.max(0, Math.floor(positive(input.sinkQuantity))));

  // THE FEET ARE MEASURED OVER THE FABRICATION PIECES, NOT THE ORDER.
  // fabricationRequired = sinkRequired (requirement-derive.ts), so a plain piece
  // never reaches the fabricator and its edges are not fabrication work. Passing
  // `qty` here — which this function used to do — billed the whole row for work
  // done on part of it. See the note at the top of the file.
  const fabricationPieces = sinkPieces;
  const feet = runningFeet(input.lengthIn, input.widthIn, fabricationPieces, input.edges);

  if (!rate) {
    return {
      runningFeet: feet, edgeCost: 0, sinkPieces, fabricationPieces,
      sinkCost: 0, total: 0, rate: null, unpriced: true,
    };
  }
  const edgeCost = money(feet * rate.edgePerFoot);
  const sinkCost = money(sinkPieces * rate.sinkPerPiece);
  return {
    runningFeet: feet,
    edgeCost,
    sinkPieces,
    fabricationPieces,
    sinkCost,
    total: money(edgeCost + sinkCost),
    rate,
    unpriced: false,
  };
}

export interface PricingTotals {
  runningFeet: number;
  edgeCost: number;
  sinkPieces: number;
  sinkCost: number;
  total: number;
  /** Rows the card could not price. Surfaced, not swallowed: a project total
   *  that quietly omits four rows is worse than one that says it did. */
  unpricedRows: number;
}

/** Sum a set of priced rows. Money is added at 2dp and rounded once at the
 *  end, so the total equals the sum of the column on screen. */
export function sumPricing(rows: RowPricing[]): PricingTotals {
  const list = rows ?? [];
  return {
    runningFeet: round2(list.reduce((n, r) => n + r.runningFeet, 0)),
    edgeCost: money(list.reduce((n, r) => n + r.edgeCost, 0)),
    sinkPieces: list.reduce((n, r) => n + r.sinkPieces, 0),
    sinkCost: money(list.reduce((n, r) => n + r.sinkCost, 0)),
    total: money(list.reduce((n, r) => n + r.total, 0)),
    unpricedRows: list.filter((r) => r.unpriced).length,
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
