import "server-only";

// One batch, costed: mixer consumption x the rate card in force on the run
// date, through the pure arithmetic of compute.ts. This module is the glue
// and the honesty layer - everything the sheet cannot know for sure
// (supplier split, chemical doses, missing rates) is surfaced as text the
// reader sees, never a silent zero.

import {
  computeSheet, varianceLines, type CostingSheet, type MaterialLine, type VariancePanel,
} from "./compute";
import {
  bandOf, GRIT_BAND_LABELS, gritItemKey, listCostableBatches, loadBatchConsumption,
  RESIN_TANK_SUPPLIER, type BatchConsumption, type BatchListEntry,
} from "./batchData";
import { pricingForBatch, RATE_ITEM_BY_KEY, type BatchPricing } from "./rateCard";
import { splitMaterial } from "./batchRates";
import type { EffectiveRateCard } from "./rateCard";

export type { BatchListEntry };

export interface UnpricedLine {
  item: string;
  qty: number | null;
  unit: string;
  /** Which rate-card entry would price it. */
  needs: string;
}

export interface CostingReport {
  batchKey: string;
  batch: string;
  design: string;
  window: { firstPress: string | null; lastPress: string | null };
  /** The date the rate card was resolved for. */
  rateDate: string;
  /** Null when the conversion/basis side of the card is incomplete. */
  sheet: CostingSheet | null;
  /** Quantities that exist but could not be priced - with what's missing. */
  unpriced: UnpricedLine[];
  /** Rate-card items (conversion/basis) missing, blocking the sheet. */
  blockedBy: string[];
  variance: VariancePanel;
  basis: {
    assumptions: string[];
    /** item -> effective_from actually used. */
    effectiveFrom: Record<string, string>;
    /** Materials priced from lines entered on this batch rather than from the
     *  card. Named rather than counted: "3 materials are different" tells a
     *  reader something changed but not what, and the whole point of showing it
     *  is that they can check the ones that matter. Anything the split and the
     *  mixer disagreed about is spelled out in `assumptions`. */
    batchRates: string[];
  };
  stats: {
    resinCycles: number;
    mixerCharges: number;
    runHours: number;
    wallClockHours: number;
    stoppages: { count: number; hours: number };
    pressSlabs: number;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function listBatches(days: number): Promise<BatchListEntry[]> {
  return listCostableBatches(days);
}

export async function buildCostingReport(batchKey: string): Promise<CostingReport | null> {
  const c = await loadBatchConsumption(batchKey);
  if (!c) return null;

  // June batches price at June's card: the run's start date picks the rates.
  // Then this batch's own material lines take over wherever it has any — see
  // lib/costing/batchRates.ts for why a run needs them and why only materials
  // may be set.
  const rateDate = c.firstPress ?? new Date();
  const pricing = await pricingForBatch(batchKey, rateDate);
  const card = pricing.card;

  const { materials, unpriced, assumptions } = buildMaterialLines(c, card, pricing);

  // Conversion and basis are all-or-nothing: a sheet with electricity
  // silently at zero reads as a cheap batch, not an unconfigured card.
  const NEEDED = [
    "manpower", "electricity", "polishing", "packing",
    "sqft-per-slab", "inr-per-usd", "days-per-month",
  ] as const;
  // NOT JUST `=== undefined`. Three of these are DENOMINATORS — slab area,
  // ₹/USD and days per month — and a zero or a NaN in any of them does not
  // fail loudly, it produces Infinity and prints "₹Infinity per sq ft" on a
  // sheet somebody is about to price a container from. The admin API rejects
  // rate <= 0, so this catches the routes it cannot: a direct database edit, a
  // bad import, a column that arrives null. Treated exactly like a missing
  // rate, because to the reader it is one.
  const blockedBy = NEEDED.filter((k) => {
    const v = card.rates[k];
    return v === undefined || !Number.isFinite(v) || v <= 0;
  });

  let sheet: CostingSheet | null = null;
  if (blockedBy.length === 0) {
    sheet = computeSheet(materials, {
      slabs3cm: c.slabs3cm,
      slabs2cm: c.slabs2cm,
      runHours: r2(c.runHours),
    }, {
      manpowerPerMonth: card.rates["manpower"],
      electricityPerMonth: card.rates["electricity"],
      polishPerSqft: card.rates["polishing"],
      packingPerSqft: card.rates["packing"],
      sqftPerSlab: card.rates["sqft-per-slab"],
      inrPerUsd: card.rates["inr-per-usd"],
      daysPerMonth: card.rates["days-per-month"],
    });
  }

  return {
    batchKey: c.batchKey,
    batch: c.batch,
    design: c.design,
    window: {
      firstPress: c.firstPress?.toISOString().slice(0, 10) ?? null,
      lastPress: c.lastPress?.toISOString().slice(0, 10) ?? null,
    },
    rateDate: rateDate.toISOString().slice(0, 10),
    sheet,
    unpriced,
    blockedBy: blockedBy.map((k) => RATE_ITEM_BY_KEY.get(k)?.label ?? k),
    variance: buildVariance(c, card),
    basis: {
      assumptions: pricing.overridden.length
        ? [`${pricing.overridden.length} material(s) are priced from lines entered on this ` +
           `batch rather than from the ${card.onDate} card: ${pricing.overridden.join(", ")}.`,
           ...assumptions]
        : assumptions,
      effectiveFrom: card.effectiveFrom,
      batchRates: pricing.overridden,
    },
    stats: {
      resinCycles: c.resinCycles,
      mixerCharges: c.mixerCharges,
      runHours: r2(c.runHours),
      wallClockHours: r2(c.wallClockHours),
      stoppages: { count: c.runStoppages.count, hours: r2(c.runStoppages.hours) },
      pressSlabs: c.pressSlabs,
    },
  };
}

function buildMaterialLines(c: BatchConsumption, card: EffectiveRateCard, pricing: BatchPricing): {
  materials: MaterialLine[]; unpriced: UnpricedLine[]; assumptions: string[];
} {
  const materials: MaterialLine[] = [];
  const unpriced: UnpricedLine[] = [];
  const assumptions: string[] = [];

  /**
   * Price one material from the batch's own lines when it has any.
   *
   * Returns false when the batch said nothing about this item, so the caller
   * falls back to whatever it did before — the card rate, the tank inference,
   * the dosing rule. That fallback is why a batch nobody has touched costs
   * exactly as it always did.
   *
   * A split line is NOT an estimate. The tank map and the dosing rules are
   * inferences the sheet flags as such; a quantity and a price somebody typed
   * off an invoice is a stated fact, and marking it "estimate" alongside them
   * would tell the reader the opposite of the truth.
   */
  const fromBatch = (
    item: string, label: string, group: MaterialLine["group"],
    mixerQty: number, unit: "kg" | "t", cardRate: number | null,
  ): boolean => {
    const lines = pricing.byItem.get(item);
    if (!lines?.length) return false;

    const split = splitMaterial(mixerQty, lines, cardRate, label);
    for (const l of split.lines) {
      materials.push({
        group, item: label,
        basis: l.description || (l.fromBatch ? "set on this batch" : "the rest, at the card rate"),
        qty: l.qty, unit, rate: l.rate,
      });
    }
    if (split.unpriced > 0) {
      unpriced.push({
        item: label, qty: r2(split.unpriced), unit,
        needs: "a line covering it on this batch, or a card rate",
      });
    }
    // Every disagreement between the split and the mixer, verbatim. These are
    // the sentences that stop a wrong total looking right.
    assumptions.push(...split.problems);
    return true;
  };

  // -- resin ----------------------------------------------------------------
  // A batch that states how its resin was bought supersedes the tank map
  // entirely: the map is a standing assumption about which supplier fills which
  // tank, and an invoice beats an assumption.
  //
  // No card fallback for the remainder. The card prices resin PER SUPPLIER, so
  // there is no single rate to charge the unsplit part to, and picking one
  // would book it to a supplier nobody named. It is reported unpriced instead.
  if (fromBatch("resin", "Resin", "resin", c.resinKg, "kg", null)) {
    assumptions.push(
      "Resin is priced from the lines entered on this batch, not from the tank map — " +
      "so the supplier split is a stated fact here rather than an inference.",
    );
  } else {
  // -- resin, one line per daily tank ---------------------------------------
  for (const t of c.resinByTank) {
    const supplier = RESIN_TANK_SUPPLIER[t.tank];
    const rate = supplier ? card.resinBySupplier[supplier] : undefined;
    const basis = supplier
      ? `${supplier} (tank ${t.tank}) — ${t.cycles} of ${c.resinCycles} cycles`
      : `tank ${t.tank} — ${t.cycles} cycles, supplier unknown`;
    if (rate === undefined) {
      unpriced.push({
        item: `Resin — ${basis}`, qty: r1(t.kg), unit: "kg",
        needs: supplier ? `resin rate for ${supplier}` : `a supplier for tank ${t.tank}`,
      });
      continue;
    }
    materials.push({
      group: "resin", item: "Resin", basis, qty: t.kg, unit: "kg", rate, estimated: true,
    });
  }
  assumptions.push(
    "Resin per supplier is inferred, not measured: litres per supplier are not recorded, " +
    "so tanks are proportioned by cycle count under the standing tank map " +
    Object.entries(RESIN_TANK_SUPPLIER).map(([t, s]) => `${t} → ${s}`).join(", ") + ".",
  );
  }

  // -- chemicals from dosing rules ------------------------------------------
  const dose = (
    doseKey: string, rateKey: string, item: string,
    qtyOf: (doseRate: number) => number, basisOf: (doseRate: number) => string,
    group: MaterialLine["group"],
  ) => {
    // A batch may redose — a run mixed differently is a real thing — so its own
    // factor wins over the card's.
    const d = pricing.dosing[doseKey] ?? card.rates[doseKey];
    const rate = card.rates[rateKey];
    if (d === undefined) {
      unpriced.push({ item, qty: null, unit: "kg", needs: `dosing rule '${doseKey}'` });
      return;
    }
    const qty = qtyOf(d);
    // The chemical itself may also have been bought in parts — a drum of
    // catalyst from a different supplier prices differently even though the
    // DOSE that produced the quantity is one number.
    if (fromBatch(rateKey, item, group, qty, "kg", rate ?? null)) return;
    if (rate === undefined) {
      unpriced.push({ item, qty: r1(qty), unit: "kg", needs: `rate '${rateKey}'` });
      return;
    }
    materials.push({ group, item, basis: basisOf(d), qty, unit: "kg", rate, estimated: true });
  };
  dose("tio2-kg-per-charge", "tio2", "TiO₂",
    (d) => d * c.mixerCharges, (d) => `${d} kg × ${c.mixerCharges} mixer charges (dosing rule)`,
    "pigment");
  dose("silane-pct-of-resin", "silane", "Silane",
    (d) => (c.resinKg * d) / 100, (d) => `${d}% of resin weight (dosing rule)`, "chemical");
  dose("cobalt-pct-of-resin", "cobalt", "Cobalt",
    (d) => (c.resinKg * d) / 100, (d) => `${d}% of resin weight (dosing rule)`, "chemical");
  dose("catalyst-pct-of-resin", "catalyst", "Catalyst",
    (d) => (c.resinKg * d) / 100, (d) => `${d}% of resin weight (dosing rule)`, "chemical");
  assumptions.push(
    "TiO₂, silane, cobalt and catalyst are computed from the dosing rules on the rate card - " +
    "the mixer weighs resin, grit and filler but not the chemicals.",
  );

  // -- grit per band (per-charge attribution) -------------------------------
  const byBand = new Map<string, { kg: number; silos: Set<string> }>();
  for (const g of c.gritCharges) {
    const e = byBand.get(g.band) ?? { kg: 0, silos: new Set<string>() };
    e.kg += g.kg;
    e.silos.add(g.silo);
    byBand.set(g.band, e);
  }
  for (const [band, e] of [...byBand.entries()].sort()) {
    const label = GRIT_BAND_LABELS[band] ?? `Grit ${band}`;
    const rate = card.rates[gritItemKey(band)];
    const basis = `silo${e.silos.size > 1 ? "s" : ""} ${[...e.silos].sort().join(", ")} — per-charge silo records`;
    // Grit is quoted in tonnes, so the batch's lines are in tonnes too — the
    // unit passed here has to match what the editor showed, or someone types
    // 14,780 against a kilogram and the batch costs a thousand times too much.
    if (fromBatch(gritItemKey(band), label, "grit", e.kg / 1000, "t", rate ?? null)) continue;
    if (rate === undefined) {
      unpriced.push({ item: label, qty: r2(e.kg / 1000), unit: "t", needs: `rate '${gritItemKey(band)}'` });
      continue;
    }
    materials.push({ group: "grit", item: label, basis, qty: e.kg / 1000, unit: "t", rate });
  }
  if (c.gritUnresolvedKg > 0) {
    unpriced.push({
      item: "Grit with no resolvable silo record", qty: r2(c.gritUnresolvedKg / 1000),
      unit: "t", needs: "a silo fill record link on those charges",
    });
  }

  // -- filler ---------------------------------------------------------------
  const fillerRate = card.rates["filler-400"];
  if (!fromBatch("filler-400", "Filler 400#", "filler", c.fillerKg / 1000, "t", fillerRate ?? null)) {
    if (fillerRate === undefined) {
      unpriced.push({ item: "Filler 400#", qty: r2(c.fillerKg / 1000), unit: "t", needs: "rate 'filler-400'" });
    } else {
      materials.push({
        group: "filler", item: "Filler 400# pm", basis: "Filler A · Buffer B",
        qty: c.fillerKg / 1000, unit: "t", rate: fillerRate,
      });
    }
  }

  assumptions.push(
    `Run length ${r2(c.runHours)} h from first mix to last, mixer-clock rollovers repaired; ` +
    `${c.runStoppages.count} stoppage(s) over 2 h totalling ${r2(c.runStoppages.hours)} h excluded ` +
    `(wall clock ${r2(c.wallClockHours)} h).`,
  );
  assumptions.push("No provision for wastage, rejection, depreciation, consumables or overheads beyond manpower and electricity.");

  return { materials, unpriced, assumptions };
}

/**
 * Two ways of measuring, disagreeing - the panel the reference sheet earned
 * its keep on (2.81 t booked to the wrong grit size when silos swapped slots).
 *
 * Grit: per-charge attribution vs whole-silo (each silo counted entirely
 * under the band it MOSTLY held - the shortcut a manual sheet takes). Slabs:
 * the distributor count vs JOT, and vs press.
 */
function buildVariance(c: BatchConsumption, card: EffectiveRateCard): VariancePanel {
  const perBand = new Map<string, number>();
  const perSilo = new Map<string, Map<string, number>>();
  for (const g of c.gritCharges) {
    perBand.set(g.band, (perBand.get(g.band) ?? 0) + g.kg);
    const s = perSilo.get(g.silo) ?? new Map<string, number>();
    s.set(g.band, (s.get(g.band) ?? 0) + g.kg);
    perSilo.set(g.silo, s);
  }
  const wholeSilo = new Map<string, number>();
  for (const bands of perSilo.values()) {
    let major = "", majorKg = -1, total = 0;
    for (const [band, kg] of bands) {
      total += kg;
      if (kg > majorKg) { major = band; majorKg = kg; }
    }
    wholeSilo.set(major, (wholeSilo.get(major) ?? 0) + total);
  }

  const pairs: Array<{ item: string; primaryQty: number; checkQty: number; unit: "kg" | "t" | "slabs"; rate: number }> = [];
  for (const band of new Set([...perBand.keys(), ...wholeSilo.keys()])) {
    pairs.push({
      item: `${GRIT_BAND_LABELS[band] ?? `Grit ${band}`} — per-charge vs whole-silo`,
      primaryQty: (perBand.get(band) ?? 0) / 1000,
      checkQty: (wholeSilo.get(band) ?? 0) / 1000,
      unit: "t",
      rate: card.rates[gritItemKey(bandOf(band))] ?? 0,
    });
  }
  pairs.push(
    { item: "3 cm slabs — distributor vs JOT", primaryQty: c.slabs3cm, checkQty: c.jot3cm, unit: "slabs", rate: 0 },
    { item: "2 cm slabs — distributor vs JOT", primaryQty: c.slabs2cm, checkQty: c.jot2cm, unit: "slabs", rate: 0 },
    { item: "Slabs produced — distributor vs press", primaryQty: c.slabs3cm + c.slabs2cm, checkQty: c.pressSlabs, unit: "slabs", rate: 0 },
  );
  return varianceLines(pairs);
}
