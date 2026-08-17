// Per-batch rates: what one batch's materials actually cost, layered over the
// standing rate card.
//
// WHY A BATCH NEEDS ITS OWN RATES
// The card answers "what did resin cost in August". That is right for a plant
// average and wrong for a specific run: the resin in batch 1403 came off a
// particular purchase order at a particular price, and costing it at the
// month's card gives a number nobody can reconcile against the invoice. So a
// batch may carry its own ₹/unit for any material, and those win.
//
// FALLBACK, NOT REPLACEMENT. Only the items someone actually set are
// overridden; everything else still resolves from the card by date, exactly as
// before. That is what keeps this from becoming twenty-two boxes to fill in per
// batch — and it means every costing that exists today prices identically until
// somebody deliberately changes one.
//
// PURE and IMPORT-FREE, so `node --test` can exercise it: the layering decides
// what a batch costs, and a rule that can only be checked by opening a costing
// screen is a rule nobody checks.

/** Categories from the rate-card catalogue. Restated rather than imported —
 *  rateCard.ts pulls in Prisma, which this module must not. */
export type OverridableCategory =
  | "RESIN" | "GRIT" | "FILLER" | "PIGMENT" | "CHEMICAL" | "DOSING";

/**
 * What a batch may set for itself.
 *
 * Materials and the dosing rules that turn resin weight into chemical
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

export interface BatchRateRow {
  item: string;
  /** Supplier for resin; "" for everything else. */
  variant: string;
  category: string;
  rate: number;
  note?: string | null;
}

/** The card as rateCard.ts resolves it — the shape this layers onto. */
export interface RateCardLike {
  onDate: string;
  resinBySupplier: Record<string, number>;
  rates: Record<string, number>;
  effectiveFrom: Record<string, string>;
  missing: string[];
}

/** Where each rate in the layered card came from. The sheet prints this, so a
 *  reader can tell a batch price from a card price without opening the admin
 *  screen. */
export type RateSource = "batch" | "card";

export interface LayeredCard extends RateCardLike {
  /** key ("resin · Aypols" or the item key) -> where it came from. */
  source: Record<string, RateSource>;
  /** Keys this batch set for itself, for the "N rates set on this batch" line. */
  overridden: string[];
  /** Rows that were rejected, with the reason. Reported rather than dropped:
   *  an override that silently did nothing is worse than one refused. */
  rejected: Array<{ item: string; variant: string; reason: string }>;
}

/** The key a rate is filed under — resin splits by supplier, nothing else does. */
export function rateKey(item: string, variant: string): string {
  return item === "resin" && variant ? `resin · ${variant}` : item;
}

/**
 * Lay a batch's own rates over the card in force on its run date.
 *
 * The card is not mutated: the caller may hold it for several batches, and a
 * layering that edited it in place would leak one batch's resin price into the
 * next. Returns a new card every time.
 *
 * A row is refused rather than applied when it names a category that is not
 * overridable, or carries a rate that is not a positive finite number. The
 * second is not paranoia — a zero rate does not fail loudly, it prices a
 * material at nothing and quietly makes the batch look cheap.
 */
export function applyBatchRates(
  card: RateCardLike,
  rows: readonly BatchRateRow[],
): LayeredCard {
  const resinBySupplier = { ...card.resinBySupplier };
  const rates = { ...card.rates };
  const effectiveFrom = { ...card.effectiveFrom };
  const source: Record<string, RateSource> = {};
  const overridden: string[] = [];
  const rejected: Array<{ item: string; variant: string; reason: string }> = [];

  for (const k of Object.keys(rates)) source[k] = "card";
  for (const s of Object.keys(resinBySupplier)) source[`resin · ${s}`] = "card";

  for (const row of rows) {
    const item = (row.item ?? "").trim();
    const variant = (row.variant ?? "").trim();
    if (!item) {
      rejected.push({ item, variant, reason: "no item" });
      continue;
    }
    if (!isOverridable(row.category)) {
      rejected.push({
        item, variant,
        reason: `${row.category} rates are plant-wide and cannot be set per batch`,
      });
      continue;
    }
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      rejected.push({ item, variant, reason: "rate must be above zero" });
      continue;
    }

    const key = rateKey(item, variant);
    if (item === "resin" && variant) {
      resinBySupplier[variant] = rate;
    } else {
      rates[item] = rate;
    }
    source[key] = "batch";
    // The card's effective_from no longer explains this number, so it is
    // replaced rather than left pointing at a revision that is not in force.
    effectiveFrom[key] = "set on this batch";
    if (!overridden.includes(key)) overridden.push(key);
  }

  // An override supplies a rate the card was missing, so the gap closes.
  const missing = card.missing.filter((item) => {
    if (item === "resin") return Object.keys(resinBySupplier).length === 0;
    return rates[item] === undefined;
  });

  return {
    onDate: card.onDate,
    resinBySupplier,
    rates,
    effectiveFrom,
    missing,
    source,
    overridden: overridden.sort(),
    rejected,
  };
}

/**
 * What a batch's own rates differ from, for the screen that sets them.
 *
 * Shows the card price beside the batch price so the person typing can see they
 * are about to cost resin 12% above the month's card — which is usually a
 * correction and occasionally a typo, and the only way to tell is to see both.
 */
export interface RateComparison {
  key: string;
  item: string;
  variant: string;
  batchRate: number;
  cardRate: number | null;
  /** Positive means the batch is dearer than the card. Null when the card has
   *  no rate to compare against. */
  deltaPct: number | null;
}

export function compareToCard(
  card: RateCardLike,
  rows: readonly BatchRateRow[],
): RateComparison[] {
  return rows.map((row) => {
    const item = (row.item ?? "").trim();
    const variant = (row.variant ?? "").trim();
    const cardRate = item === "resin" && variant
      ? card.resinBySupplier[variant]
      : card.rates[item];
    const batchRate = Number(row.rate);
    const comparable = Number.isFinite(cardRate) && cardRate > 0 && Number.isFinite(batchRate);
    return {
      key: rateKey(item, variant),
      item,
      variant,
      batchRate,
      cardRate: Number.isFinite(cardRate) ? cardRate : null,
      deltaPct: comparable
        ? Math.round(((batchRate - cardRate) / cardRate) * 1000) / 10
        : null,
    };
  });
}
