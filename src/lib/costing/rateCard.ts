import "server-only";

// The rate card: what the rate rows MEAN, and how a date picks among them.
//
// costing_rate is append-only rows of (item, variant, rate, effective_from).
// This module owns the catalogue of items - their categories, units and
// labels - and the one query that matters: "the rates in force on date D",
// which is the newest row per (item, variant) at or before D. Costing a June
// batch with June's card is the entire point of the date; nothing here ever
// looks at "today".

import { prisma } from "@/lib/prisma";

export type RateCategory =
  | "RESIN" | "GRIT" | "FILLER" | "PIGMENT" | "CHEMICAL" | "DOSING" | "CONVERSION" | "BASIS";

export interface RateItemDef {
  item: string;
  category: RateCategory;
  label: string;
  unit: "kg" | "t" | "sqft" | "month" | "slab" | "usd" | "day" | "pct";
  /** Shown under the input on the admin screen. */
  hint: string;
  /** Items that split across variants (resin per supplier). The admin screen
   *  lets these grow a row per variant; everything else is one row. */
  variants?: boolean;
}

/**
 * The catalogue. Fixed in code rather than admin-editable because every item
 * here is consumed by name in the costing computation - an item nobody
 * computes with would be a rate nobody reads. Grit bands follow the four
 * silo size slots; a fifth band means the computation changes too, so the
 * catalogue changing with it is honest.
 */
export const RATE_ITEMS: readonly RateItemDef[] = [
  { item: "resin", category: "RESIN", label: "Resin", unit: "kg",
    hint: "One rate per supplier — add a row per supplier name.", variants: true },
  { item: "grit-0.1-0.4", category: "GRIT", label: "Grit 0.1 – 0.4", unit: "t",
    hint: "Semi-micron band." },
  { item: "grit-0.3-0.7", category: "GRIT", label: "Grit 0.3 – 0.7", unit: "t",
    hint: "Semi-micron band." },
  { item: "grit-0.6-1.2", category: "GRIT", label: "Grit 0.6 – 1.2", unit: "t",
    hint: "Micron band." },
  { item: "grit-1.2-2.5", category: "GRIT", label: "Grit 1.2 – 2.5", unit: "t",
    hint: "Micron band." },
  { item: "grit-8-16", category: "GRIT", label: "Glass grit # 8-16", unit: "t",
    hint: "Glass, silo-fed like quartz grit. Some batches run tonnes of it." },
  { item: "filler-400", category: "FILLER", label: "Filler 400#", unit: "t",
    hint: "Filler A and Buffer B are priced as one." },
  { item: "tio2", category: "PIGMENT", label: "TiO₂", unit: "kg",
    hint: "Dosed per mixer cycle." },
  { item: "silane", category: "CHEMICAL", label: "Silane", unit: "kg",
    hint: "Dosed on resin." },
  { item: "cobalt", category: "CHEMICAL", label: "Cobalt", unit: "kg",
    hint: "Dosed on resin." },
  { item: "catalyst", category: "CHEMICAL", label: "Catalyst", unit: "kg",
    hint: "Roughly 1% of resin weight." },
  // Dosing rules. The mixer records weigh resin, grit and filler but NOT the
  // chemicals, so their quantities are computed: TiO₂ per mixer charge, the
  // rest as a percentage of resin weight. These factors are rates like any
  // other - revising one re-costs every batch it applies to.
  { item: "tio2-kg-per-charge", category: "DOSING", label: "TiO₂ dose", unit: "kg",
    hint: "Kilograms per mixer charge." },
  { item: "silane-pct-of-resin", category: "DOSING", label: "Silane dose", unit: "pct",
    hint: "Percent of resin weight." },
  { item: "cobalt-pct-of-resin", category: "DOSING", label: "Cobalt dose", unit: "pct",
    hint: "Percent of resin weight." },
  { item: "catalyst-pct-of-resin", category: "DOSING", label: "Catalyst dose", unit: "pct",
    hint: "Percent of resin weight." },
  { item: "manpower", category: "CONVERSION", label: "Manpower", unit: "month",
    hint: "Whole-plant monthly figure, absorbed by run length." },
  { item: "electricity", category: "CONVERSION", label: "Electricity", unit: "month",
    hint: "Whole-plant monthly figure, absorbed by run length." },
  { item: "polishing", category: "CONVERSION", label: "Polishing", unit: "sqft",
    hint: "₹ per square foot of slab." },
  { item: "packing", category: "CONVERSION", label: "Packing", unit: "sqft",
    hint: "₹ per square foot of slab." },
  { item: "sqft-per-slab", category: "BASIS", label: "Slab area", unit: "slab",
    hint: "Square feet per slab. A 137 × 79 inch slab is 75.15." },
  { item: "inr-per-usd", category: "BASIS", label: "₹ per USD", unit: "usd",
    hint: "For the dollar cost-per-sqft line." },
  { item: "days-per-month", category: "BASIS", label: "Days per month", unit: "month",
    hint: "Monthly plant figures are spread over this many days." },
] as const;

export const RATE_ITEM_BY_KEY: ReadonlyMap<string, RateItemDef> =
  new Map(RATE_ITEMS.map((d) => [d.item, d]));

export interface RateRow {
  id: string;
  category: RateCategory;
  item: string;
  variant: string;
  unit: string;
  rate: number;
  effectiveFrom: string; // yyyy-mm-dd
  note: string | null;
  createdBy: string;
}

/** The rates in force on one date, keyed for the computation. */
export interface EffectiveRateCard {
  /** The date the card was resolved FOR (the batch's run date). */
  onDate: string;
  /** supplier -> ₹/kg. */
  resinBySupplier: Record<string, number>;
  /** item key -> rate, for every non-variant item present. */
  rates: Record<string, number>;
  /** item key -> the effective_from that supplied it - the audit line. */
  effectiveFrom: Record<string, string>;
  /** Catalogue items with no row at or before the date. A costing computed
   *  against a card with gaps must say which rates are missing, not guess. */
  missing: string[];
}

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Every rate row, newest first - the admin screen's list. */
export async function listRateRows(): Promise<RateRow[]> {
  const rows = await prisma.costingRate.findMany({
    orderBy: [{ item: "asc" }, { variant: "asc" }, { effectiveFrom: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category as RateCategory,
    item: r.item,
    variant: r.variant,
    unit: r.unit,
    rate: r.rate,
    effectiveFrom: day(r.effectiveFrom),
    note: r.note,
    createdBy: r.createdBy,
  }));
}

/**
 * Resolve the card in force on `onDate`.
 *
 * One query, resolved in memory: rows are few (a handful of items times a
 * handful of revisions), and the picking rule - newest effective_from at or
 * before the date, per (item, variant) - is clearer as a fold than as a
 * DISTINCT ON the next reader has to decode.
 */
export async function effectiveRateCard(onDate: Date): Promise<EffectiveRateCard> {
  const rows = await prisma.costingRate.findMany({
    where: { effectiveFrom: { lte: onDate } },
    orderBy: { effectiveFrom: "asc" },
  });

  const resinBySupplier: Record<string, number> = {};
  const rates: Record<string, number> = {};
  const effectiveFrom: Record<string, string> = {};

  // Ascending order means the last write per key wins = newest wins.
  for (const r of rows) {
    if (r.item === "resin" && r.variant) {
      resinBySupplier[r.variant] = r.rate;
      effectiveFrom[`resin · ${r.variant}`] = day(r.effectiveFrom);
    } else {
      rates[r.item] = r.rate;
      effectiveFrom[r.item] = day(r.effectiveFrom);
    }
  }

  const missing = RATE_ITEMS
    .filter((d) => (d.variants
      ? Object.keys(resinBySupplier).length === 0
      : rates[d.item] === undefined))
    .map((d) => d.item);

  return { onDate: day(onDate), resinBySupplier, rates, effectiveFrom, missing };
}

/**
 * The reference sheet's rates, offered as a one-click starting card so the
 * admin screen is not seventeen empty boxes on day one. August 2026 rates
 * from the Simply White costing (747 slabs); the effective date is the 1st of
 * that month so the run itself prices under this card.
 */
export const STARTER_RATES: ReadonlyArray<{
  item: string; variant?: string; rate: number; note: string;
}> = [
  { item: "resin", variant: "Aypols", rate: 161, note: "Simply White sheet, Aug 2026" },
  { item: "resin", variant: "3n Composits", rate: 145, note: "Simply White sheet, Aug 2026" },
  { item: "grit-0.1-0.4", rate: 10955, note: "Simply White sheet; silo 202 ran ₹10,380" },
  { item: "grit-0.3-0.7", rate: 10980, note: "Simply White sheet, Aug 2026" },
  { item: "grit-0.6-1.2", rate: 14780, note: "Simply White sheet, Aug 2026" },
  { item: "grit-1.2-2.5", rate: 14755, note: "Simply White sheet, Aug 2026" },
  { item: "filler-400", rate: 12499, note: "Simply White sheet, Aug 2026" },
  { item: "tio2", rate: 310, note: "Simply White sheet, Aug 2026" },
  { item: "silane", rate: 420, note: "Simply White sheet, Aug 2026" },
  { item: "cobalt", rate: 365, note: "Simply White sheet, Aug 2026" },
  { item: "catalyst", rate: 535, note: "Simply White sheet, Aug 2026" },
  { item: "tio2-kg-per-charge", rate: 9.14, note: "Simply White sheet: 9.14 kg × mixer charges" },
  { item: "silane-pct-of-resin", rate: 1.2143, note: "Back-derived: 508.46 kg on 41,873 kg resin" },
  { item: "cobalt-pct-of-resin", rate: 0.0857, note: "Back-derived: 35.89 kg on 41,873 kg resin" },
  { item: "catalyst-pct-of-resin", rate: 1, note: "Simply White sheet: 1% of resin weight" },
  { item: "manpower", rate: 9_000_000, note: "₹90 lakh/month, Simply White sheet" },
  { item: "electricity", rate: 6_000_000, note: "₹60 lakh/month, Simply White sheet" },
  { item: "polishing", rate: 10, note: "₹10/sqft, Simply White sheet" },
  { item: "packing", rate: 25, note: "₹25/sqft, Simply White sheet" },
  { item: "sqft-per-slab", rate: 75, note: "137 × 79 inch slab is 75.15 sqft" },
  { item: "inr-per-usd", rate: 95, note: "Simply White sheet, Aug 2026" },
  { item: "days-per-month", rate: 30, note: "Monthly figures spread evenly" },
] as const;
