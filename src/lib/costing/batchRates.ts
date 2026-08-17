// Per-batch material lines: what a batch's materials actually cost, and where
// each part of a quantity came from.
//
// WHY LINES AND NOT ONE RATE PER MATERIAL
// The mixer weighs one number — "resin, 1,000 kg". What was actually bought is
// often several things: 600 kg from Aypols at ₹161 and 400 kg from 3n Composits
// at ₹145, or one drum from a new supplier at a trial price. A single ₹/kg for
// the batch can only average that, and an average is exactly the figure nobody
// can reconcile against an invoice.
//
// So a material may be SPLIT: several lines, each with its own quantity, its own
// price and a description saying what it was. The quantities do not have to add
// up to the mixer's number — see splitMaterial for what happens when they don't,
// which is the part that has to be right.
//
// FALLBACK, NOT REPLACEMENT. A material with no lines is priced whole, at the
// card rate, exactly as before any of this existed.
//
// PURE and IMPORT-FREE, so `node --test` can exercise it. This decides what a
// batch costs; a rule that can only be checked by opening a costing screen is a
// rule nobody checks.

/** Categories from the rate-card catalogue. Restated rather than imported —
 *  rateCard.ts pulls in Prisma, which this module must not. */
export type OverridableCategory =
  | "RESIN" | "GRIT" | "FILLER" | "PIGMENT" | "CHEMICAL" | "DOSING";

/**
 * What a batch may set for itself.
 *
 * Materials, and the dosing rules that turn resin weight into chemical
 * quantities — the things genuinely bought for THIS run.
 *
 * CONVERSION (manpower, electricity, polishing, packing) and BASIS (slab area,
 * ₹/USD, days per month) are deliberately absent. Conversion figures are
 * whole-plant monthly costs absorbed by run length; there is no such thing as
 * this batch's electricity bill. Basis is worse: slab area and ₹/USD are the
 * denominators every sheet is divided by, so letting a batch pick its own would
 * make two batches' cost-per-sqft incomparable while still looking like the
 * same column.
 */
export const OVERRIDABLE_CATEGORIES: ReadonlySet<string> = new Set<OverridableCategory>([
  "RESIN", "GRIT", "FILLER", "PIGMENT", "CHEMICAL", "DOSING",
]);

export function isOverridable(category: string): boolean {
  return OVERRIDABLE_CATEGORIES.has(category);
}

/**
 * A DOSING item is a factor, not a quantity.
 *
 * "1% of resin weight" cannot be split into two deliveries — there is nothing
 * to split. Those items take a single value and no line ever carries a qty for
 * them, which is why the UI and the split below treat them apart.
 */
export function isSplittable(category: string): boolean {
  return isOverridable(category) && category !== "DOSING";
}

/** One line a human entered against a batch's material. */
export interface BatchMaterialLine {
  item: string;
  /** Stable ordering, and what an upsert is addressed by. */
  seq: number;
  category: string;
  /**
   * How much this line covers, in the item's own unit.
   *
   * Null means "whatever is left of the mixer's quantity" — the common case
   * when someone splits off one known drum and lets the rest fall through.
   */
  qty: number | null;
  rate: number;
  /** Supplier, PO number, "trial drum" — what this part of the quantity was. */
  description: string;
}

export interface SplitLine {
  qty: number;
  rate: number;
  description: string;
  /** False for the remainder line priced from the card. */
  fromBatch: boolean;
}

export interface SplitResult {
  lines: SplitLine[];
  /** Mixer quantity the batch lines did not account for. */
  remainder: number;
  /** Quantity that could not be priced: a remainder with no card rate. */
  unpriced: number;
  /** Things a human needs to see, in the order they should read them. */
  problems: string[];
}

/** Quantities are kilos and tonnes read off scales; anything under this is
 *  rounding, not a real shortfall worth a warning. */
const EPSILON = 0.005;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turn one mixer quantity plus the batch's lines into priced lines.
 *
 * THE RULE, AND WHY IT IS NOT "THEY MUST ADD UP".
 *
 * It is tempting to refuse a split that does not exactly equal what the mixer
 * weighed. That would be wrong here: the mixer figure is not fixed. A corrected
 * mixer row re-costs the batch on the next read — that is the whole design of
 * this module — so a split that balanced when it was typed can stop balancing
 * without anybody touching it. Refusing to price it at that point would blank
 * out a costing because a different screen was corrected.
 *
 * So the split is applied as given and any difference is REPORTED:
 *
 *   under-allocated  the rest is priced at the card rate as its own line, or
 *                    reported as unpriced when the card has no rate for it.
 *   over-allocated   the lines are still priced — the person said what they
 *                    bought — and the excess is flagged, because it means the
 *                    split and the mixer disagree and one of them is wrong.
 *
 * Lines consume the quantity in `seq` order, so a null-qty line placed last
 * takes what is left rather than everything.
 */
export function splitMaterial(
  mixerQty: number,
  lines: readonly BatchMaterialLine[],
  cardRate: number | null,
  label = "this material",
): SplitResult {
  const problems: string[] = [];
  const out: SplitLine[] = [];

  const total = Number.isFinite(mixerQty) && mixerQty > 0 ? mixerQty : 0;

  if (!lines.length) {
    if (cardRate == null) return { lines: [], remainder: total, unpriced: total, problems };
    return {
      lines: total > 0 ? [{ qty: total, rate: cardRate, description: "", fromBatch: false }] : [],
      remainder: 0, unpriced: 0, problems,
    };
  }

  const ordered = [...lines].sort((a, b) => a.seq - b.seq);
  let used = 0;

  for (const l of ordered) {
    const rate = Number(l.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      problems.push(`${label}: "${l.description || "a line"}" has no usable price and was left out.`);
      continue;
    }

    if (l.qty == null) {
      // "the rest". Never negative: an earlier line may already have taken more
      // than the mixer weighed, and a negative quantity would show up as a
      // credit on the sheet.
      const rest = r3(Math.max(0, total - used));
      if (rest <= EPSILON) {
        problems.push(
          `${label}: "${l.description || "the rest"}" covers what is left, but the lines above ` +
          `already account for all ${r3(total)} — it prices nothing.`,
        );
        continue;
      }
      out.push({ qty: rest, rate, description: l.description, fromBatch: true });
      used += rest;
      continue;
    }

    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      problems.push(`${label}: "${l.description || "a line"}" has no usable quantity and was left out.`);
      continue;
    }
    out.push({ qty: r3(qty), rate, description: l.description, fromBatch: true });
    used += qty;
  }

  used = r3(used);
  const diff = r3(total - used);

  if (diff > EPSILON) {
    if (cardRate == null) {
      problems.push(
        `${label}: ${diff} of the ${r3(total)} the mixer recorded is not covered by these lines, ` +
        `and there is no card rate to price it — that quantity is NOT in the total.`,
      );
      return { lines: out, remainder: diff, unpriced: diff, problems };
    }
    out.push({ qty: diff, rate: cardRate, description: "the rest, at the card rate", fromBatch: false });
    return { lines: out, remainder: diff, unpriced: 0, problems };
  }

  if (diff < -EPSILON) {
    problems.push(
      `${label}: the lines add up to ${used}, but the mixer recorded ${r3(total)} — ` +
      `${r3(-diff)} more is being priced than was weighed. Check the split against the mixer.`,
    );
  }

  return { lines: out, remainder: 0, unpriced: 0, problems };
}

/**
 * Dosing factors, which are values rather than quantities.
 *
 * Kept separate from splitMaterial because there is nothing to split: "1% of
 * resin weight" is one number. A batch may still override it — a run dosed
 * differently is a real thing — so the last line for the item wins.
 */
export function dosingOverrides(
  lines: readonly BatchMaterialLine[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of [...lines].sort((a, b) => a.seq - b.seq)) {
    if (l.category !== "DOSING") continue;
    const v = Number(l.rate);
    if (Number.isFinite(v) && v > 0) out[l.item] = v;
  }
  return out;
}

/** Group a batch's lines by the material they belong to. */
export function linesByItem(
  lines: readonly BatchMaterialLine[],
): Map<string, BatchMaterialLine[]> {
  const m = new Map<string, BatchMaterialLine[]>();
  for (const l of lines) {
    const list = m.get(l.item) ?? [];
    list.push(l);
    m.set(l.item, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.seq - b.seq);
  return m;
}

/**
 * What one material's split looks like against the mixer, for the editor.
 *
 * The screen needs to show the shortfall or excess while someone is still
 * typing, because that is the moment it can be fixed — not after a save, and
 * certainly not on the printed sheet.
 */
export interface SplitSummary {
  allocated: number;
  mixerQty: number;
  /** Positive = still to allocate. Negative = more than the mixer weighed. */
  left: number;
  /** True once the lines cover the mixer quantity within rounding. */
  balanced: boolean;
  /** A line is waiting to absorb whatever is left. */
  hasRest: boolean;
}

export function summariseSplit(
  mixerQty: number,
  lines: readonly BatchMaterialLine[],
): SplitSummary {
  let allocated = 0;
  let hasRest = false;
  for (const l of lines) {
    if (l.qty == null) { hasRest = true; continue; }
    const q = Number(l.qty);
    if (Number.isFinite(q) && q > 0) allocated += q;
  }
  allocated = r3(allocated);
  const left = r3(mixerQty - allocated);
  return {
    allocated,
    mixerQty: r3(mixerQty),
    left,
    balanced: hasRest || Math.abs(left) <= EPSILON,
    hasRest,
  };
}
