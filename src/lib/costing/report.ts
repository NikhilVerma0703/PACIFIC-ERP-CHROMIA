import "server-only";

// One batch, costed: mixer consumption x the rate card in force on the run
// date, through the pure arithmetic of compute.ts. This module is the glue
// and the honesty layer - everything the sheet cannot know for sure
// (supplier split, chemical doses, missing rates) is surfaced as text the
// reader sees, never a silent zero.

import { prisma } from "@/lib/prisma";
import {
  computeSheet, varianceLines, type CostingSheet, type MaterialLine, type VariancePanel,
} from "./compute";
import { gritFlagSentences, gritSiloLabel, priceGritSilo, gritCostFacts } from "./gritAssign";
import {
  bandOf, GRIT_BAND_LABELS, gritItemKey, hasGritAssignment, listCostableBatches, loadBatchConsumption,
  RESIN_TANK_SUPPLIER, type BatchConsumption, type BatchListEntry,
} from "./batchData";
import {
  listBatchMaterials, pricingForBatch, RATE_ITEM_BY_KEY, type BatchPricing,
} from "./rateCard";
import { daysInMonthOf, splitMaterial } from "./batchRates";
import type { EffectiveRateCard } from "./rateCard";
import {
  costsFingerprint, verifyMarks, weightsFingerprint,
  type VerificationRow, type VerifyMark, type VerifySide,
} from "./verification";

/**
 * A catalogue key in the words the screens already use for it.
 *
 * The unpriced list is read by whoever has to go and fix it, and it was
 * answering in database keys: "needs dosing rule 'tio2-pct-of-resin'", "needs
 * rate 'grit-0.6-1.2'". Those name a column, not the row somebody has to open.
 * The catalogue already carries a label for every one of them, so say that.
 */
const labelOf = (key: string): string => RATE_ITEM_BY_KEY.get(key)?.label ?? key;

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
  /**
   * Materials this run consumed that have no rate entered ON THIS BATCH, and
   * would otherwise have been priced from the standing card.
   *
   * The card is the last rate anybody typed, for the whole plant. Charging this
   * run at it produces a total that looks like this batch's cost and is in fact
   * some earlier batch's — the reader cannot tell the two apart, and the number
   * is what a container gets priced from. So the sheet is withheld until
   * somebody states what this run actually paid, exactly as it is withheld for
   * a missing conversion figure.
   */
  needsBatchRates: string[];
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
    /** How the card resolved: revisions in force at the batch's date, and the
     *  earliest the table holds. Lets the screen tell "nothing is set" apart
     *  from "nothing is dated early enough for this batch", which look
     *  identical as a list of missing rates and have different fixes. */
    rowsInForce: number;
    earliestRevision: string | null;
    /** Days the monthly figures were divided by — off the calendar. */
    daysPerMonth: number;
  };
  stats: {
    resinCycles: number;
    mixerCharges: number;
    runHours: number;
    wallClockHours: number;
    stoppages: { count: number; hours: number };
    pressSlabs: number;
  };
  /**
   * The "View batch data & edit history" drawer, in one payload.
   *
   * ADMIN-ONLY like everything else on this route, so shipping the raw
   * consumption and the provenance of every price is not a leak — it is the
   * same data the sheet above is computed from, plus who touched it and when.
   */
  detail: {
    /** What the mixer recorded, verbatim — the drawer's consumption table. */
    consumption: {
      resinKg: number;
      resinByTank: Array<{ tank: string; cycles: number; kg: number }>;
      gritCharges: Array<{ silo: string; band: string; label: string; kg: number }>;
      gritUnresolvedKg: number;
      fillerKg: number;
      slabs3cm: number;
      slabs2cm: number;
    };
    /** Prices entered on this batch — each line with who saved it and when. */
    batchLines: Array<{
      item: string; label: string; seq: number; qty: number | null; unit: string;
      rate: number; description: string; savedBy: string; savedAt: string;
    }>;
    /** Every verification mark standing, per side, name + time + staleness. */
    marks: { WEIGHTS: VerifyMark[]; COSTS: VerifyMark[] };
    /** The append-only change log — who set/cleared which price, who marked
     *  what correct, newest first. Read from action_log, which nothing
     *  deletes from; the tables above only remember their current state. */
    changes: Array<{ at: string; actor: string | null; summary: string }>;
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
  // The drawer's reads ride alongside the pricing: the saved lines carry the
  // who/when the sheet itself does not need, the verification rows are the two
  // people's marks, and action_log is the append-only trail of every price set,
  // clear and mark — the tables themselves only remember their current state.
  const [pricing, savedLines, verifRows, logRows] = await Promise.all([
    pricingForBatch(batchKey, rateDate),
    listBatchMaterials(batchKey),
    prisma.costingBatchVerification.findMany({ where: { batchKey } }),
    prisma.actionLog.findMany({
      where: { batchKey, kind: { in: ["costing-batch-rate", "costing-verify"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { createdAt: true, actor: true, summary: true },
    }),
  ]);
  const card = pricing.card;

  // Marks lapse by fingerprint, exactly as the verify screen judges them — the
  // drawer must not call "verified" what /office/batch-verify calls stale.
  const fp: Record<VerifySide, string> = {
    WEIGHTS: weightsFingerprint(c),
    COSTS: costsFingerprint({
      lines: savedLines.map((l) => ({ item: l.item, seq: l.seq, qty: l.qty, rate: l.rate })),
      cardRates: card.rates,
      resinBySupplier: card.resinBySupplier,
      // Size, type and every per-line rate. Derived in gritAssign so the
      // three call sites cannot drift apart again - which is how gritSizes
      // came to be passed by none of them.
      ...gritCostFacts(c?.gritSilos),
    }),
  };
  const markRows: VerificationRow[] = verifRows.map((r) => ({
    side: r.side as VerifySide, fingerprint: r.fingerprint,
    verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt.toISOString(),
  }));

  const { materials, unpriced, assumptions, fromCard } = buildMaterialLines(c, card, pricing);

  // Conversion and basis are all-or-nothing: a sheet with electricity
  // silently at zero reads as a cheap batch, not an unconfigured card.
  // days-per-month is NOT here any more: it comes off the calendar. Nor is
  // inr-per-usd required from the card — a batch supplies its own, and the card
  // row is only the default.
  const NEEDED = [
    "manpower", "electricity", "polishing", "packing", "sqft-per-slab",
  ] as const;
  // NOT JUST `=== undefined`. Three of these are DENOMINATORS — slab area,
  // ₹/USD and days per month — and a zero or a NaN in any of them does not
  // fail loudly, it produces Infinity and prints "₹Infinity per sq ft" on a
  // sheet somebody is about to price a container from. The admin API rejects
  // rate <= 0, so this catches the routes it cannot: a direct database edit, a
  // bad import, a column that arrives null. Treated exactly like a missing
  // rate, because to the reader it is one.
  const usable = (v: number | undefined) =>
    v !== undefined && Number.isFinite(v) && v > 0;

  // Labels, not keys, because this list is read by a person who then has to go
  // and fix it — and the two are fixed in different places now.
  const blockedBy: string[] = NEEDED
    .filter((k) => !usable(card.rates[k]))
    .map((k) => RATE_ITEM_BY_KEY.get(k)?.label ?? k);

  // The batch's own rate beats the card's default; the card's default beats
  // nothing. Zero would turn the dollar line into infinity, so it is treated as
  // absent rather than accepted.
  const inrPerUsdRaw = pricing.basis["inr-per-usd"] ?? card.rates["inr-per-usd"];
  const inrPerUsd = usable(inrPerUsdRaw) ? inrPerUsdRaw : null;
  if (inrPerUsd == null) {
    // Named as a batch field, because that is where it is now set. Sending the
    // reader to the plant-wide card for it would be sending them to the one
    // place that no longer decides it.
    blockedBy.push("₹ per USD (set it on this batch, below)");
  }

  // Off the calendar, not off the card.
  const daysPerMonth = daysInMonthOf(rateDate);

  // EVERY MATERIAL MUST BE STATED FOR THIS RUN. The card's rate is the last one
  // anybody typed for the whole plant; charging this batch at it yields a total
  // that reads as this batch's cost and is really some earlier batch's, which is
  // indistinguishable to the reader and is the figure a container gets priced
  // from. Conversion is exempt because nothing can set it per batch — see
  // OVERRIDABLE_CATEGORIES in batchRates.ts — so requiring it would withhold
  // every sheet forever.
  const needsBatchRates = fromCard;

  let sheet: CostingSheet | null = null;
  if (blockedBy.length === 0 && needsBatchRates.length === 0) {
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
      inrPerUsd: inrPerUsd!,
      daysPerMonth,
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
    blockedBy,
    needsBatchRates,
    variance: buildVariance(c, card),
    basis: {
      assumptions: pricing.overridden.length
        ? [`${pricing.overridden.length} material(s) are priced from lines entered on this ` +
           `batch rather than from the ${card.onDate} card: ${pricing.overridden.join(", ")}.`,
           ...assumptions]
        : assumptions,
      effectiveFrom: card.effectiveFrom,
      batchRates: pricing.overridden,
      rowsInForce: card.rowsInForce,
      earliestRevision: card.earliestRevision,
      daysPerMonth,
    },
    stats: {
      resinCycles: c.resinCycles,
      mixerCharges: c.mixerCharges,
      runHours: r2(c.runHours),
      wallClockHours: r2(c.wallClockHours),
      stoppages: { count: c.runStoppages.count, hours: r2(c.runStoppages.hours) },
      pressSlabs: c.pressSlabs,
    },
    detail: {
      consumption: {
        resinKg: r2(c.resinKg),
        resinByTank: c.resinByTank.map((t) => ({ tank: t.tank, cycles: t.cycles, kg: r2(t.kg) })),
        gritCharges: c.gritCharges.map((g) => ({
          silo: g.silo, band: g.band,
          label: GRIT_BAND_LABELS[g.band] ?? `Grit ${g.band}`, kg: r2(g.kg),
        })),
        gritUnresolvedKg: r2(c.gritUnresolvedKg),
        fillerKg: r2(c.fillerKg),
        slabs3cm: c.slabs3cm,
        slabs2cm: c.slabs2cm,
      },
      batchLines: savedLines.map((l) => ({
        item: l.item,
        label: RATE_ITEM_BY_KEY.get(l.item)?.label ?? l.item,
        seq: l.seq, qty: l.qty, unit: l.unit, rate: l.rate,
        description: l.description, savedBy: l.savedBy, savedAt: l.savedAt,
      })),
      marks: {
        WEIGHTS: verifyMarks(markRows, "WEIGHTS", fp.WEIGHTS),
        COSTS: verifyMarks(markRows, "COSTS", fp.COSTS),
      },
      changes: logRows.map((r) => ({
        at: r.createdAt.toISOString(), actor: r.actor, summary: r.summary,
      })),
    },
  };
}

function buildMaterialLines(c: BatchConsumption, card: EffectiveRateCard, pricing: BatchPricing): {
  materials: MaterialLine[]; unpriced: UnpricedLine[]; assumptions: string[]; fromCard: string[];
} {
  const materials: MaterialLine[] = [];
  const unpriced: UnpricedLine[] = [];
  const assumptions: string[] = [];
  /** Consumed, priced, but priced from the card rather than from this batch.
   *  A Set because grit reaches the fallback once per band and resin once per
   *  tank, and the reader wants the material named once. */
  const fromCard = new Set<string>();

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
    // Called with the quantity the split did NOT cover. Only the silo-wise grit
    // path passes it, and only to withhold the sheet — see the fork below.
    onShortfall?: (short: number) => void,
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
    onShortfall?.(split.unpriced);
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
  // The tank map prices resin from the card's per-supplier rates. Whatever else
  // it is, it is not what this run was invoiced.
  if (c.resinKg > 0) fromCard.add("Resin");
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
        needs: supplier ? `a price for ${supplier} resin` : `a supplier for tank ${t.tank}`,
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
      unpriced.push({ item, qty: null, unit: "kg", needs: `the ${labelOf(doseKey)} to be set` });
      return;
    }
    const qty = qtyOf(d);
    // The chemical itself may also have been bought in parts — a drum of
    // catalyst from a different supplier prices differently even though the
    // DOSE that produced the quantity is one number.
    if (fromBatch(rateKey, item, group, qty, "kg", rate ?? null)) return;
    if (rate === undefined) {
      unpriced.push({ item, qty: r1(qty), unit: "kg", needs: `a price for ${labelOf(rateKey)}` });
      return;
    }
    if (qty > 0) fromCard.add(item);
    materials.push({ group, item, basis: basisOf(d), qty, unit: "kg", rate, estimated: true });
  };
  // TiO₂ is dosed on resin weight, like the other three. There is no fallback:
  // the per-charge rule is gone, so a card without tio2-pct-of-resin reports
  // TiO₂ unpriced and says which rate it needs, exactly as it would for any
  // other material nobody has set a rate for.
  dose("tio2-pct-of-resin", "tio2", "TiO₂",
    (d) => (c.resinKg * d) / 100, (d) => `${d}% of resin weight (dosing rule)`, "pigment");
  dose("silane-pct-of-resin", "silane", "Silane",
    (d) => (c.resinKg * d) / 100, (d) => `${d}% of resin weight (dosing rule)`, "chemical");
  dose("cobalt-pct-of-resin", "cobalt", "Cobalt",
    (d) => (c.resinKg * d) / 100, (d) => `${d}% of resin weight (dosing rule)`, "chemical");
  dose("catalyst-pct-of-resin", "catalyst", "Catalyst",
    (d) => (c.resinKg * d) / 100, (d) => `${d}% of resin weight (dosing rule)`, "chemical");
  assumptions.push(
    "TiO₂, silane, cobalt and catalyst are all dosed on resin weight and computed from the " +
    "dosing rules — the mixer weighs resin, grit and filler but not these four.",
  );

  // -- grit -----------------------------------------------------------------
  //
  // TWO SHAPES, ONE GATE. A batch somebody has assigned prices SILO BY SILO, at
  // a rupee-per-tonne typed on the line. A batch nobody has assigned prices per
  // band at the card, exactly as it did before this existed — and that path is
  // not legacy to be tolerated, it is what every batch costed before this
  // feature is STILL costed by. Deleting it would silently re-price them.
  //
  // The switch is per batch and flips the first time a silo is assigned.
  if (hasGritAssignment(c.gritSilos)) {
    // THE ROW LIST COMES FROM THE MIXER, NOT FROM THE ASSIGNMENT TABLE.
    //
    // c.gritSilos holds only silos somebody has assigned, and hasGritAssignment
    // flips true on the FIRST one. The screen saves one silo per request, so a
    // batch is routinely on this path with most of its silos still unassigned.
    // Iterating the assignment array alone silently dropped every one of them:
    // no price, no unpriced line, nothing in fromCard - so the sheet computed,
    // complete and confident, missing three quarters of the batch grit.
    //
    // Seeding rows in loadGritSilos would fix the arithmetic and break something
    // worse: it would move the assign= segment of weightsFingerprint on every
    // already-assigned batch and lapse every standing mark in the plant.
    const assignedBySilo = new Map((c.gritSilos ?? []).map((s) => [s.silo, s]));
    // gritSiloKg, not gritCharges: the latter is keyed by band and drops every
    // charge whose bags yield none, so it undercounts the silos it does list
    // and omits the ones it cannot band at all.
    const mixerKg = new Map<string, number>();
    for (const g of c.gritSiloKg) mixerKg.set(g.silo, (mixerKg.get(g.silo) ?? 0) + g.kg);

    for (const [silo, kg] of mixerKg) {
      if (kg <= 0) continue;
      const sil = assignedBySilo.get(silo);

      // Drawn from, never assigned. Withhold - this is grit nobody has even
      // said what it is, let alone what it cost.
      if (!sil) {
        const label = gritSiloLabel(silo, "");
        fromCard.add(label);
        unpriced.push({
          item: label, qty: r2(kg / 1000), unit: "t",
          needs: `a size, a supplier and a price per tonne - silo ${silo} drew ${r2(kg / 1000)} t and nobody has assigned it`,
        });
        continue;
      }

      const label = gritSiloLabel(sil.silo, sil.size);
      // The arithmetic lives in gritAssign.priceGritSilo - pure, and therefore
      // actually tested, which this file cannot be because it is server-only.
      //
      // It used to read a costing_batch_material line keyed grit-silo-<n>. That
      // line could never exist: the only route that writes that table validates
      // the item against a fixed 44-entry catalogue and a silo number is data,
      // not a catalogue entry, so it answered 400 every time. Every assigned
      // batch therefore withheld its whole sheet - batch 1415 sat like that in
      // production with six assigned silos and no way out.
      const priced = priceGritSilo(sil);

      for (const l of priced.lines) {
        materials.push({
          group: "grit", item: label,
          basis: l.supplier ? `${l.supplier}, set on this batch` : "set on this batch",
          qty: l.tonnes, unit: "t", rate: l.ratePerT,
        });
      }
      for (const m of priced.missing) {
        unpriced.push({ item: label, qty: r2(m.tonnes), unit: "t", needs: m.needs });
      }
      // fromCard IS needsBatchRates, and needsBatchRates is the ONLY thing that
      // withholds the sheet - the unpriced array has never gated it. Dropping
      // this line prints a complete-looking total with the grit missing.
      if (priced.withhold) fromCard.add(label);
    }
    assumptions.push(...gritFlagSentences(c.gritSilos!));
    // Unresolved tonnage is NOT reported separately on this path, and now that
    // is actually true. The rows above are built from gritSiloKg, which counts
    // every charge the mixer recorded whether its bags yield a band or not, so
    // the unresolved kilograms really are inside them. While these rows came
    // from gritCharges the same comment was simply wrong: 39,784 kg of batch
    // 1415 was in no row, in no unpriced line, and in no total.
  } else {

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
      unpriced.push({ item: label, qty: r2(e.kg / 1000), unit: "t", needs: `a price for ${labelOf(gritItemKey(band))}` });
      continue;
    }
    if (e.kg > 0) fromCard.add(label);
    materials.push({ group: "grit", item: label, basis, qty: e.kg / 1000, unit: "t", rate });
  }
  if (c.gritUnresolvedKg > 0) {
    unpriced.push({
      // BAND PATH ONLY, and the wording matters. gritUnresolvedKg counts grit
      // whose bags yield no SIZE BAND - not grit with no silo - and on this
      // path a band is exactly what it needs to be priced. On the silo path
      // the same kilograms sit inside the silo rows and are not reported here
      // at all, which is why this lives in the else branch.
      item: "Grit with no size band on its bag records", qty: r2(c.gritUnresolvedKg / 1000),
      unit: "t", needs: "a size band on the silo fill records for those charges",
    });
  }
  }   // end of the per-band path

  // -- filler ---------------------------------------------------------------
  const fillerRate = card.rates["filler-400"];
  if (!fromBatch("filler-400", "Filler 400#", "filler", c.fillerKg / 1000, "t", fillerRate ?? null)) {
    if (fillerRate === undefined) {
      unpriced.push({ item: "Filler 400#", qty: r2(c.fillerKg / 1000), unit: "t", needs: `a price for ${labelOf("filler-400")}` });
    } else {
      if (c.fillerKg > 0) fromCard.add("Filler 400#");
      materials.push({
        group: "filler", item: "Filler 400# pm", basis: "Filler A · Buffer B",
        qty: c.fillerKg / 1000, unit: "t", rate: fillerRate,
      });
    }
  }

  assumptions.push(
    `Monthly plant figures are spread over ${daysInMonthOf(c.firstPress ?? new Date())} days — ` +
    "the length of the calendar month the run started in, not a typed figure.",
  );
  assumptions.push(
    `Run length ${r2(c.runHours)} h from first mix to last, mixer-clock rollovers repaired; ` +
    `${c.runStoppages.count} stoppage(s) over 2 h totalling ${r2(c.runStoppages.hours)} h excluded ` +
    `(wall clock ${r2(c.wallClockHours)} h).`,
  );
  assumptions.push("No provision for wastage, rejection, depreciation, consumables or overheads beyond manpower and electricity.");

  return { materials, unpriced, assumptions, fromCard: [...fromCard] };
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
