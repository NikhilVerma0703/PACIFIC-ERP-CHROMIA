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
import {
  basisOverrides, dosingOverrides, linesByItem, type BatchMaterialLine,
} from "./batchRates";

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
  // Hint corrected 2026-08-18: it still said "per mixer cycle" from before the
  // dosing switch, but TiO₂ is dosed on resin weight like the other three —
  // the per-charge rule is gone (see the DOSING note below).
  { item: "tio2", category: "PIGMENT", label: "TiO₂", unit: "kg",
    hint: "Dosed on resin weight." },
  { item: "silane", category: "CHEMICAL", label: "Silane", unit: "kg",
    hint: "Dosed on resin." },
  { item: "cobalt", category: "CHEMICAL", label: "Cobalt", unit: "kg",
    hint: "Dosed on resin." },
  { item: "catalyst", category: "CHEMICAL", label: "Catalyst", unit: "kg",
    hint: "Roughly 1% of resin weight." },
  // Dosing rules. The mixer records weigh resin, grit and filler but NOT the
  // chemicals, so their quantities are computed — all four, TiO₂ included, as
  // a percentage of resin weight (the old TiO₂ per-charge rule is gone, see
  // report.ts). These factors are rates like any other - revising one re-costs
  // every batch it applies to.
  { item: "tio2-pct-of-resin", category: "DOSING", label: "TiO₂ dose", unit: "pct",
    hint: "Percent of resin weight, like the other three." },
  // The per-charge TiO₂ rule is GONE. It modelled TiO₂ as kilograms per mixer
  // charge because that is how the Simply White sheet wrote it, and it was kept
  // as a fallback through the switch. The plant doses on resin weight, so the
  // fallback was describing a derivation nobody uses — and it disagreed with
  // the percentage by up to 14% depending on how much resin a charge carried
  // (6.09% of resin on the reference batch, 6.94% on 1414). Two rules that
  // disagree, one of them wrong, is worse than one rule that has to be set.
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
  // Set on the BATCH, not here. The rate a batch is quoted at is the rate on
  // the day it was quoted, and a single plant-wide figure silently re-prices
  // every past batch in dollars the moment somebody revises it. The global row
  // below is only the default a batch inherits when nobody has typed one.
  // ONE label, because this item appears on two screens with opposite meanings:
  // on the admin card it is the plant default, on the batch panel it is that
  // batch's own rate. Baking "(default)" into the label made it read as a
  // default in the one place it is not. The hint carries the distinction on the
  // admin card, and the batch panel says "leave unset to use the plant default"
  // beside its own box.
  { item: "inr-per-usd", category: "BASIS", label: "₹ per USD", unit: "usd",
    hint: "The plant default. Each batch can set its own on the batch panel." },
  // days-per-month is gone: it is derived from the calendar month the run
  // started in (see daysInMonthOf), because "how many days are in August" is
  // not a business decision and a hand-typed 30 quietly overstated the daily
  // rate for seven months of the year.
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
  /**
   * How many revision rows were in force at that date, and the earliest
   * revision the table holds at all.
   *
   * Diagnostics, and they earn their place: a costing screen reported all seven
   * conversion and basis rates missing while the admin card two panels above
   * showed every one of them set and green. "Missing" was the only word
   * available, and it sent the reader to re-enter rates that already existed.
   * With these, a resolution that came back empty says so — and says whether
   * the table is empty, or simply has nothing dated at or before this batch.
   */
  rowsInForce: number;
  earliestRevision: string | null;
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
  const [rows, earliest] = await Promise.all([
    prisma.costingRate.findMany({
      where: { effectiveFrom: { lte: onDate } },
      orderBy: { effectiveFrom: "asc" },
    }),
    // Asked unconditionally so an empty resolution can tell the difference
    // between "no rates exist" and "none are dated early enough for this
    // batch" — two problems with entirely different fixes.
    prisma.costingRate.aggregate({ _min: { effectiveFrom: true } }),
  ]);

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

  return {
    onDate: day(onDate),
    rowsInForce: rows.length,
    earliestRevision: earliest._min.effectiveFrom ? day(earliest._min.effectiveFrom) : null,
    resinBySupplier, rates, effectiveFrom, missing,
  };
}

/** Provenance the editor shows so a hand-typed figure is never presented with
 *  the same authority as the published card. */
export interface SavedMaterialLine extends BatchMaterialLine {
  id: string;
  unit: string;
  note: string | null;
  savedBy: string;
  savedAt: string;
}

/** How one batch's materials were bought. Empty for almost every batch — the
 *  card is the normal answer and these are the exceptions. */
export async function listBatchMaterials(batchKey: string): Promise<SavedMaterialLine[]> {
  const rows = await prisma.costingBatchMaterial.findMany({
    where: { batchKey },
    orderBy: [{ item: "asc" }, { seq: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    item: r.item,
    seq: r.seq,
    category: r.category,
    qty: r.qty,
    rate: r.rate,
    description: r.description ?? "",
    unit: r.unit,
    note: r.note,
    savedBy: r.createdBy,
    savedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Everything the report needs to price a batch: the card in force on its run
 * date, plus how this batch's materials were actually bought.
 *
 * One function so there is one place that decides what a batch costs. Reading
 * the plain card anywhere in the costing path would price a batch at the plant
 * average while the screen showed its own splits, the two disagreeing silently.
 */
export interface BatchPricing {
  card: EffectiveRateCard;
  /** item -> its lines, in seq order. */
  byItem: Map<string, BatchMaterialLine[]>;
  /** Dosing factors this batch overrode. */
  dosing: Record<string, number>;
  /** Single-value basis items this batch set — currently ₹ per USD. */
  basis: Record<string, number>;
  /** Items the batch has lines for — what the sheet reports as "set on this
   *  batch" rather than taken from the card. */
  overridden: string[];
}

export async function pricingForBatch(
  batchKey: string,
  onDate: Date,
): Promise<BatchPricing> {
  const [card, lines] = await Promise.all([
    effectiveRateCard(onDate),
    listBatchMaterials(batchKey),
  ]);
  return {
    card,
    byItem: linesByItem(lines),
    dosing: dosingOverrides(lines),
    basis: basisOverrides(lines),
    overridden: [...new Set(lines.map((l) => l.item))].sort(),
  };
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
  // Back-derived from the reference sheet's own figures: 9.14 kg × 279 charges
  // = 2,549 kg against 41,873.4 kg of resin. Same quantity as the sheet, stated
  // the way the line actually doses it. Worth confirming against a delivery
  // note before it prices a container — every other dosing rate here was
  // back-derived the same way and carries the same caveat.
  { item: "tio2-pct-of-resin", rate: 6.0874, note: "Back-derived: 2,549 kg on 41,873.4 kg resin" },
  { item: "silane-pct-of-resin", rate: 1.2143, note: "Back-derived: 508.46 kg on 41,873 kg resin" },
  { item: "cobalt-pct-of-resin", rate: 0.0857, note: "Back-derived: 35.89 kg on 41,873 kg resin" },
  { item: "catalyst-pct-of-resin", rate: 1, note: "Simply White sheet: 1% of resin weight" },
  { item: "manpower", rate: 9_000_000, note: "₹90 lakh/month, Simply White sheet" },
  { item: "electricity", rate: 6_000_000, note: "₹60 lakh/month, Simply White sheet" },
  { item: "polishing", rate: 10, note: "₹10/sqft, Simply White sheet" },
  { item: "packing", rate: 25, note: "₹25/sqft, Simply White sheet" },
  { item: "sqft-per-slab", rate: 75, note: "137 × 79 inch slab is 75.15 sqft" },
  { item: "inr-per-usd", rate: 95, note: "Default only — batches set their own" },
] as const;
