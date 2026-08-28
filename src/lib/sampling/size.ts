// Sample sizes: length x width x thickness, typed once and reused forever.
//
// PURE, AND IT IMPORTS NOTHING — see the note at the top of
// lib/catalogue/colours.ts for why every unit-tested module in this repo is
// self-contained.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. There are no standard sample sizes:
// a size is typed the first time it is used, saved, and from then on it is a
// pick-list option. Nobody curates the list. So every typo, every stray space
// and every second spelling of a size that already exists becomes a permanent
// second entry with its own stock count — and two half-counts of the same
// physical pile is the failure mode this module has to prevent. Everything
// below is either "fold two spellings onto one size" or "refuse rather than
// guess", and the refusals are the important half.
//
// ------------------------------------------------------------------ UNITS ---
// LENGTH AND WIDTH ARE INCHES. THICKNESS IS MILLIMETRES. Every name says so,
// because lib/fab/slabLoss.ts is the standing warning about what happens when
// they do not: fab_requirement stores inches, fab_slab stores millimetres,
// nothing in the schema said which, and multiplying one by the other produces
// a number 25.4x too small that reads as a plausible answer.
//
// The split is not arbitrary — it is what the rest of the business already
// does with these two measurements:
//   * Piece dimensions are quoted and stored in INCHES (FabRequirement.length
//     /.width, FabPiece, and the owner's own "4 x 4"). Fabrication offcuts
//     become sample stock, and a fab_residual_piece is measured in inches, so
//     inches means an offcut maps onto a sample size with no conversion and no
//     rounding drift.
//   * Thickness is quoted in centimetres ("2 cm", "3 cm") but stored in
//     MILLIMETRES everywhere it is stored as a number — fab writes cm x 10,
//     chromia_base_material.default_thickness_mm says so in its name. Whole
//     millimetres also cover the thin material (8 mm, 12 mm) that centimetres
//     would push into decimals.
//
// Converting a millimetre length into inches would defeat the whole module:
// 100 mm becomes 3.94 in, which sits next to 4 in in the pick-list forever and
// splits the stock. So mm/cm on length or width is REFUSED, not converted.

// ---------------------------------------------------------------------------
// The size itself
// ---------------------------------------------------------------------------

export interface SampleSize {
  /** Longer edge, INCHES, 2dp. */
  lengthIn: number;
  /** Shorter edge, INCHES, 2dp. */
  widthIn: number;
  /** MILLIMETRES, whole. 20 for 2 cm, 30 for 3 cm, 12 for 12 mm. */
  thicknessMm: number;
}

export interface SampleSizeInput {
  length: string | number | null | undefined;
  width: string | number | null | undefined;
  thickness: string | number | null | undefined;
}

export type SampleSizeResult =
  | { ok: true; size: SampleSize }
  | { ok: false; reason: string };

/** One measurement, or the reason it was refused. */
export type MeasureResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/** An absolute per-edge ceiling, for catching a unit slip on ONE number. The
 *  real rule is the PAIR — see SLAB_*_IN below — because an edge is only ever
 *  too big in company with the other one. */
const MAX_EDGE_IN = 200;

/**
 * A STANDARD SLAB, IN INCHES. The same figures as STANDARD_SLAB_INCHES in
 * lib/fab/slabLoss.ts, redeclared rather than imported because this module
 * imports nothing — see the header.
 *
 * A sample is cut OFF a slab, so it cannot be bigger than one, and the check
 * has to be on the PAIR rather than on each edge alone. 99 in is a legal
 * length. 99 in is a legal width. 99 x 99 is a piece no slab on the premises
 * can produce — and it passed every per-edge test, saved itself as a permanent
 * pick-list size, and went onto the supervisor's board to sit in the
 * outstanding list until somebody tried to fit it and could not.
 */
const SLAB_LONG_IN = 137;
const SLAB_SHORT_IN = 79;
/** Thinner than 1 mm is not a piece; thicker than 100 mm is not quartz. */
const MIN_THICKNESS_MM = 1;
const MAX_THICKNESS_MM = 100;

/** 2dp, the precision of the sampling_size columns (NUMERIC(10,2)) — so the
 *  value that is compared here is the value the database stores. Same
 *  epsilon-nudge as slabLoss.round2, for the same binary-fraction reason. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Trim, collapse whitespace, and normalise the unicode quote/dash characters
 *  a phone keyboard produces. */
function tidy(v: string | number | null | undefined): string {
  return String(v ?? "")
    .replace(/[′″“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_WITH_UNIT = /^(\d+(?:\.\d+)?)\s*(in|ins|inch|inches|"|mm|cm)?$/i;

/**
 * One edge, in inches.
 *
 * A bare number is inches — that is what the owner types and what fabrication
 * stores. An explicit `in` / `"` is accepted. `mm` and `cm` are REFUSED rather
 * than converted; see the units note above.
 */
export function parseEdgeInches(raw: string | number | null | undefined): MeasureResult {
  const text = tidy(raw);
  if (!text) return { ok: false, reason: "missing" };
  const m = NUMBER_WITH_UNIT.exec(text);
  if (!m) return { ok: false, reason: `"${text}" is not a measurement` };
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "mm" || unit === "cm") {
    return {
      ok: false,
      reason: `length and width are inches — "${text}" would convert to a near-duplicate size`,
    };
  }
  const value = round2(Number(m[1]));
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: `"${text}" is not a positive length` };
  if (value > MAX_EDGE_IN) return { ok: false, reason: `${value} in is larger than a slab — check the units` };
  return { ok: true, value };
}

/**
 * Thickness, in whole millimetres.
 *
 * THE UNIT IS COMPULSORY. "2" is 2 cm to the man cutting it and 2 mm to the
 * parser, and there is no honest way to tell them apart: 2 mm and 20 mm are
 * both numbers this field could legitimately hold. Refusing costs a UI a unit
 * selector; guessing costs a permanent wrong entry in a list nobody curates.
 *
 * A fractional millimetre is refused for the same reason — no quartz is cut to
 * half a millimetre, so it means a typo or the wrong unit.
 */
export function parseThicknessMm(raw: string | number | null | undefined): MeasureResult {
  const text = tidy(raw);
  if (!text) return { ok: false, reason: "missing" };
  const m = NUMBER_WITH_UNIT.exec(text);
  if (!m) return { ok: false, reason: `"${text}" is not a measurement` };
  const unit = (m[2] ?? "").toLowerCase();
  if (!unit) return { ok: false, reason: `thickness needs a unit — "${text} mm" or "${text} cm"` };
  if (unit !== "mm" && unit !== "cm") return { ok: false, reason: `thickness is mm or cm, not "${unit}"` };
  const n = Number(m[1]);
  // x10 in binary floating point turns 1.2 into 12.000000000000002, which is
  // not an integer and would be refused for the wrong reason.
  const mm = Math.round((unit === "cm" ? n * 10 : n) * 1000) / 1000;
  if (!Number.isFinite(mm) || mm <= 0) return { ok: false, reason: `"${text}" is not a positive thickness` };
  if (!Number.isInteger(mm)) return { ok: false, reason: `${mm} mm is not a whole millimetre` };
  if (mm < MIN_THICKNESS_MM || mm > MAX_THICKNESS_MM) {
    return { ok: false, reason: `${mm} mm is outside 1-100 mm — check the units` };
  }
  return { ok: true, value: mm };
}

/**
 * Normalise a typed size.
 *
 * Accepts either three fields or one string ("4 x 6 x 2cm", "4X6X20MM",
 * "4 by 6 by 2 cm").
 *
 * IS 4x6 THE SAME SIZE AS 6x4? YES — the longer edge is stored as the length,
 * so both fold onto one size and one stock count. A sample piece is a loose
 * rectangle in a box; it has no fixed orientation, no left or right, and the
 * man pulling stock turns it round without thinking. Keeping them apart would
 * mean two pick-list entries and two half-counts for one pile, which is
 * exactly the failure an uncurated list cannot survive. The cost is real but
 * small: a piece cut across the vein is not identical to one cut along it, and
 * this cannot express that. Countertops can — FabRequirement keeps length and
 * width as given, because an installed top has an orientation. A sample handed
 * over to show a colour does not.
 */
export function parseSampleSize(input: SampleSizeInput | string): SampleSizeResult {
  let parts: SampleSizeInput;
  if (typeof input === "string") {
    const bits = tidy(input)
      .split(/\s*(?:x|×|\*|by)\s*/i)
      .filter((b) => b.length > 0);
    if (bits.length !== 3) {
      return {
        ok: false,
        reason: `a size is length x width x thickness — "${tidy(input)}" has ${bits.length} part(s)`,
      };
    }
    parts = { length: bits[0], width: bits[1], thickness: bits[2] };
  } else {
    parts = input ?? { length: null, width: null, thickness: null };
  }

  const a = parseEdgeInches(parts.length);
  if (!a.ok) return { ok: false, reason: `length: ${a.reason}` };
  const b = parseEdgeInches(parts.width);
  if (!b.ok) return { ok: false, reason: `width: ${b.reason}` };
  const t = parseThicknessMm(parts.thickness);
  if (!t.ok) return { ok: false, reason: `thickness: ${t.reason}` };

  const lengthIn = Math.max(a.value, b.value);
  const widthIn = Math.min(a.value, b.value);

  // DOES IT COME OFF A SLAB? Checked after the sort, so it is one comparison
  // rather than four: the longer edge against the slab's longer edge, the
  // shorter against the shorter. A piece that fails this cannot be cut at all,
  // and letting it through saves a size nobody can ever use.
  if (lengthIn > SLAB_LONG_IN || widthIn > SLAB_SHORT_IN) {
    return {
      ok: false,
      reason:
        `${lengthIn} x ${widthIn} in does not come off a slab — a slab is ` +
        `${SLAB_LONG_IN} x ${SLAB_SHORT_IN} in`,
    };
  }

  return { ok: true, size: { lengthIn, widthIn, thicknessMm: t.value } };
}

/** The identity of a size — what the unique index on sampling_size enforces.
 *  "6x4x20". Two typings of the same size produce the same key. */
export function sampleSizeKey(size: SampleSize): string {
  return `${size.lengthIn}x${size.widthIn}x${size.thicknessMm}`;
}

/** How a size reads in a pick-list: `6 × 4 in · 20 mm`. Derived, never stored
 *  — a stored label drifts from the numbers it describes. */
export function sampleSizeLabel(size: SampleSize): string {
  return `${size.lengthIn} × ${size.widthIn} in · ${size.thicknessMm} mm`;
}

/** Did these two typings mean the same size? Unparseable input is never equal
 *  to anything, including itself — "I could not read either" is not a match. */
export function sameSampleSize(a: SampleSizeInput | string, b: SampleSizeInput | string): boolean {
  const x = parseSampleSize(a);
  const y = parseSampleSize(b);
  if (!x.ok || !y.ok) return false;
  return sampleSizeKey(x.size) === sampleSizeKey(y.size);
}
