// How much of a slab a set of assigned pieces actually uses, and what is left.
//
// PURE, AND IT IMPORTS NOTHING — same reason as flatSheetParser.ts and
// finance/pipelineRules.ts: `node --test` resolves ESM strictly, so a relative
// import without a .ts extension fails at runtime while adding the extension
// fights the Next build. That is also why INCH_TO_MM is redeclared here instead
// of imported from requirement-derive.ts.
//
// ------------------------------------------------------------------ UNITS ---
// THE LANDMINE THIS FUNCTION EXISTS TO DEFUSE. The two sides of this sum are
// stored in different units and nothing in the schema says so:
//
//   FabRequirement.length / .width   INCHES   (excelParser and the new flat
//                                              sheet both write inches; see
//                                              slab-allocation/route.ts:70,
//                                              which multiplies them by 25.4)
//   FabSlab.length / .width          MILLIMETRES (allocate-requirement/route.ts
//                                              writes length: 3200, width: 1600,
//                                              and thickness as cm x 10)
//
// So every parameter below names its unit in the parameter itself. There is no
// "length" here and there never should be. Multiplying an inch length by a
// millimetre width silently produces a number 25.4x too small, which reads as a
// slab that is 96% wasted — plausible enough that nobody would question it.
//
// Everything is REPORTED in square feet and percent, because that is what
// fab_slab_job stores (used_area_sqft, total_wastage_pct, true_scrap_pct) and
// what the shop floor quotes.

export const INCH_TO_MM = 25.4;
export const SQ_IN_PER_SQ_FT = 144;
/** 25.4 x 25.4 x 144 = 92,903.04 mm² in one square foot. */
export const SQ_MM_PER_SQ_FT = INCH_TO_MM * INCH_TO_MM * SQ_IN_PER_SQ_FT;

/**
 * The standard Pacific slab, 137 x 79 INCHES.
 *
 * The same two numbers are hardcoded in three route files
 * (fab/slab-allocation/route.ts:9-11, fab/assign-qc-slab/route.ts:10-11,
 * fab/ceo/route.ts:24), each converting them to mm on the spot. Nothing here
 * changes those; this is the copy new code should use.
 */
export const STANDARD_SLAB_INCHES = { lengthIn: 137, widthIn: 79 };

/** The same slab expressed the way FabSlab stores it: 3479.8 x 2006.6 mm.
 *  Rounded to 2dp for the same reason inchToMm() rounds — 137 * 25.4 is
 *  3479.7999999999997 in binary floating point, and a stored dimension should
 *  not carry that. */
export const STANDARD_SLAB_MM = {
  lengthMm: Math.round(STANDARD_SLAB_INCHES.lengthIn * INCH_TO_MM * 100) / 100,
  widthMm: Math.round(STANDARD_SLAB_INCHES.widthIn * INCH_TO_MM * 100) / 100,
};

/** Square feet from a square-millimetre area. */
export function sqftFromSqMm(areaSqMm: number): number {
  return areaSqMm / SQ_MM_PER_SQ_FT;
}

/** Square feet from inch dimensions — the SFT the manager's sheet quotes. */
export function sqftFromInches(lengthIn: number, widthIn: number): number {
  return (lengthIn * widthIn) / SQ_IN_PER_SQ_FT;
}

/** One piece type dropped onto a slab. Dimensions are INCHES, as stored on
 *  FabRequirement / FabPiece. */
export interface SlabPieceAssignment {
  lengthIn: number | null | undefined;
  widthIn: number | null | undefined;
  quantity: number | null | undefined;
}

export interface SlabLossInput {
  /** Slab length in MILLIMETRES, as stored on FabSlab.length. */
  slabLengthMm: number | null | undefined;
  /** Slab width in MILLIMETRES, as stored on FabSlab.width. */
  slabWidthMm: number | null | undefined;
  /** Everything assigned to this slab. Dimensions in INCHES. */
  pieces: SlabPieceAssignment[];
  /**
   * Offcut area (SQUARE FEET) kept back as reusable remnant rather than thrown
   * away — fab_residual_bag / fab_residual_piece territory. Defaults to 0,
   * which makes trueScrapPct equal totalWastagePct: with nothing reclaimed,
   * everything not used is scrap.
   */
  reclaimedAreaSqft?: number | null;
}

export interface SlabLossResult {
  /** Slab face area, square feet. 75.16 for the standard 137 x 79 slab. */
  slabAreaSqft: number;
  /** Sum of lengthIn x widthIn x quantity / 144 over the pieces, square feet. */
  usedAreaSqft: number;
  /**
   * slabAreaSqft - usedAreaSqft, square feet. SIGNED: negative means more has
   * been assigned to this slab than it physically holds.
   */
  remainingAreaSqft: number;
  /** Of remainingAreaSqft, the part kept as a reusable remnant. Square feet. */
  reclaimedAreaSqft: number;
  /**
   * 100 x remainingAreaSqft / slabAreaSqft. Null when the slab has no usable
   * dimensions, because "0% wasted" and "we do not know" are different facts and
   * the column is nullable so it can hold the difference.
   */
  totalWastagePct: number | null;
  /**
   * The part of the wastage that is genuinely gone:
   * 100 x (remainingAreaSqft - reclaimedAreaSqft) / slabAreaSqft.
   * Equals totalWastagePct when nothing was reclaimed. Null on the same terms.
   */
  trueScrapPct: number | null;
  /**
   * True when the pieces do not fit. The caller must NOT persist an
   * over-committed result — remainingAreaSqft and both percentages go negative,
   * and a negative wastage in fab_slab_job is a lie that outlives the mistake.
   * It means the allocation is wrong, not that the maths is.
   */
  overCommitted: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function positive(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Used area, remaining area and wastage for one slab.
 *
 * Slab dimensions in MILLIMETRES, piece dimensions in INCHES, every result in
 * SQUARE FEET and PERCENT, rounded to 2dp.
 *
 * This is a pure area sum, not a nesting solver: it answers "how much material
 * did these pieces consume" and cannot answer "do they fit in this shape".
 * Kerf is not modelled either — fab_slab_job.kerf_mm exists and defaults to 3,
 * but blade loss depends on the cut layout, which lives in the CLO plan, not
 * here. Both mean the real wastage is a little higher than this reports; it is
 * an upper bound on yield, and the shop uses it that way already
 * (slab-allocation/route.ts computes exactly this sum inline).
 *
 * Persisting it to FabSlabJob:
 *   usedAreaSqft    -> used_area_sqft
 *   totalWastagePct -> total_wastage_pct
 *   trueScrapPct    -> true_scrap_pct
 * all three nullable Floats, and all three currently written by nothing.
 */
export function computeSlabLoss(input: SlabLossInput): SlabLossResult {
  const slabLengthMm = positive(input.slabLengthMm);
  const slabWidthMm = positive(input.slabWidthMm);
  const slabAreaSqft = round2(sqftFromSqMm(slabLengthMm * slabWidthMm));

  const usedRaw = (input.pieces ?? []).reduce((sum, p) => {
    const l = positive(p.lengthIn);
    const w = positive(p.widthIn);
    const q = positive(p.quantity);
    return sum + sqftFromInches(l, w) * q;
  }, 0);
  const usedAreaSqft = round2(usedRaw);

  const reclaimedAreaSqft = round2(positive(input.reclaimedAreaSqft));
  const remainingAreaSqft = round2(slabAreaSqft - usedAreaSqft);

  // No slab dimensions means no denominator. Say so with null rather than
  // inventing a 100% or a 0%.
  const known = slabAreaSqft > 0;
  const totalWastagePct = known ? round2((remainingAreaSqft / slabAreaSqft) * 100) : null;
  const trueScrapPct = known
    ? round2(((remainingAreaSqft - reclaimedAreaSqft) / slabAreaSqft) * 100)
    : null;

  return {
    slabAreaSqft,
    usedAreaSqft,
    remainingAreaSqft,
    reclaimedAreaSqft,
    totalWastagePct,
    trueScrapPct,
    overCommitted: known && usedAreaSqft > slabAreaSqft,
  };
}
