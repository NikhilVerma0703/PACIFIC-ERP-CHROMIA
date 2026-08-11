// Batch costing - the arithmetic, and nothing else.
//
// Everything here is a pure function of two inputs: what the batch consumed
// (quantities, from mixer records) and what things cost (rates, from the rate
// card). No Prisma, no dates-of-now, no config reads - the caller assembles
// both sides, which is what makes the sheet re-computable: correct a mixer row
// or backdate a rate and the next read prices the batch again from scratch.
// Nothing is stored.
//
// The shape mirrors the Simply White costing sheet (747 slabs, Aug 2026) that
// this module was built to reproduce; tests/costing.test.ts holds that sheet's
// printed numbers as the fixture.

/** One priced consumption line: quantity x rate, with its provenance. */
export interface MaterialLine {
  /** Which sub-total and share bucket the line lands in. */
  group: "resin" | "grit" | "filler" | "pigment" | "chemical";
  /** "Resin", "Grit 0.6 - 1.2", "TiO2"... - what the row is called on screen. */
  item: string;
  /** Supplier, silo list, dosing rule - the "where this number comes from" column. */
  basis: string;
  /** In `unit`s. Quantities are actual consumption; estimates are flagged. */
  qty: number;
  unit: "kg" | "t";
  /** Rupees per `unit`. */
  rate: number;
  /** True where the quantity is inferred rather than measured - the resin
   *  split by supplier is proportioned on cycle count because litres per
   *  supplier are not recorded. The UI must say so. */
  estimated?: boolean;
}

export interface PricedLine extends MaterialLine {
  amount: number;
}

/** Conversion rates + the basis assumptions, from the rate card. */
export interface ConversionBasis {
  /** Whole-plant figures, spread over the month and absorbed by run length. */
  manpowerPerMonth: number;
  electricityPerMonth: number;
  /** Charged per square foot of slab. */
  polishPerSqft: number;
  packingPerSqft: number;
  /** 75 on the reference sheet (a 137x79 inch slab is 75.15). */
  sqftPerSlab: number;
  /** 95 on the reference sheet. */
  inrPerUsd: number;
  /** Days in the month the monthly figures are spread over. */
  daysPerMonth: number;
}

export interface OutputSplit {
  slabs3cm: number;
  slabs2cm: number;
  /** First mix to last mix, from the mixer records - NOT an assumption. */
  runHours: number;
}

export interface GroupShare {
  group: MaterialLine["group"];
  label: string;
  amount: number;
  /** Of material cost, 0-100. */
  pct: number;
}

export interface ConversionHead {
  head: string;
  basis: string;
  perSlab: number;
}

export interface CostingSheet {
  material: {
    resinAndChemicals: PricedLine[];
    gritAndFiller: PricedLine[];
    resinAndChemicalsTotal: number;
    gritAndFillerTotal: number;
    /** Tonnes across the grit-and-filler block, the sheet's sub-total column. */
    gritAndFillerTonnes: number;
    total: number;
    shares: GroupShare[];
  };
  output: {
    slabs3cm: number;
    slabs2cm: number;
    totalSlabs: number;
    /** 2 cm counts as 2/3 of a 3 cm slab's material. */
    equivalent3cm: number;
    materialPerEquivalent: number;
    materialPer2cm: number;
    allocatedTo3cm: number;
    allocatedTo2cm: number;
    /** allocated(3cm) + allocated(2cm) - material total. Rounding noise only;
     *  anything above a rupee means the arithmetic is wrong, so it is printed
     *  rather than trusted. */
    allocationGap: number;
  };
  conversion: {
    heads: ConversionHead[];
    perSlab: number;
    runHours: number;
    runDays: number;
  };
  final: {
    perSlab3cm: number;
    perSlab2cm: number;
    perSqft3cm: number;
    perSqft2cm: number;
    perSqftUsd3cm: number;
    perSqftUsd2cm: number;
    materialTotal: number;
    conversionTotal: number;
    batchTotal: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Group labels as the sheet prints them in the share table. */
const GROUP_LABELS: Record<MaterialLine["group"], string> = {
  resin: "Resin (both suppliers)",
  grit: "Grit (four sizes)",
  filler: "Filler 400#",
  pigment: "TiO2 (pigment)",
  chemical: "Catalyst, silane, cobalt",
};

export function priceLines(lines: readonly MaterialLine[]): PricedLine[] {
  return lines.map((l) => ({ ...l, amount: round2(l.qty * l.rate) }));
}

/**
 * The whole sheet from quantities, rates and output.
 *
 * Ordering rule: material lines keep their input order within each block, so
 * the caller controls presentation (resin first, then pigment, then dosed
 * chemicals - the reading order of the reference sheet).
 */
export function computeSheet(
  materials: readonly MaterialLine[],
  output: OutputSplit,
  basis: ConversionBasis,
): CostingSheet {
  const priced = priceLines(materials);
  const resinAndChemicals = priced.filter((l) =>
    l.group === "resin" || l.group === "pigment" || l.group === "chemical");
  const gritAndFiller = priced.filter((l) => l.group === "grit" || l.group === "filler");

  const sum = (ls: readonly PricedLine[]) => round2(ls.reduce((s, l) => s + l.amount, 0));
  const resinAndChemicalsTotal = sum(resinAndChemicals);
  const gritAndFillerTotal = sum(gritAndFiller);
  const total = round2(resinAndChemicalsTotal + gritAndFillerTotal);

  const toTonnes = (l: PricedLine) => (l.unit === "t" ? l.qty : l.qty / 1000);
  const gritAndFillerTonnes = round2(gritAndFiller.reduce((s, l) => s + toTonnes(l), 0));

  const shareOrder: MaterialLine["group"][] = ["resin", "grit", "filler", "pigment", "chemical"];
  const shares: GroupShare[] = shareOrder.map((g) => {
    const amount = sum(priced.filter((l) => l.group === g));
    return {
      group: g,
      label: GROUP_LABELS[g],
      amount,
      pct: total > 0 ? round2((amount / total) * 100) : 0,
    };
  }).filter((s) => s.amount > 0);

  // -- output & allocation -------------------------------------------------
  const totalSlabs = output.slabs3cm + output.slabs2cm;
  const equivalent3cm = output.slabs3cm + (output.slabs2cm * 2) / 3;
  const materialPerEquivalent = equivalent3cm > 0 ? total / equivalent3cm : 0;
  const materialPer2cm = (materialPerEquivalent * 2) / 3;
  const allocatedTo3cm = materialPerEquivalent * output.slabs3cm;
  const allocatedTo2cm = materialPer2cm * output.slabs2cm;
  const allocationGap = round2(allocatedTo3cm + allocatedTo2cm - total);

  // -- conversion ----------------------------------------------------------
  const runDays = output.runHours / 24;
  const perDay = (monthly: number) => monthly / basis.daysPerMonth;
  const absorb = (monthly: number) =>
    totalSlabs > 0 ? (perDay(monthly) * runDays) / totalSlabs : 0;

  const polish = basis.sqftPerSlab * basis.polishPerSqft;
  const packing = basis.sqftPerSlab * basis.packingPerSqft;
  const manpower = absorb(basis.manpowerPerMonth);
  const electricity = absorb(basis.electricityPerMonth);

  const lakh = (n: number) => `₹${round2(n / 100000)} lakh`;
  const heads: ConversionHead[] = [
    {
      head: "Polishing",
      basis: `${basis.sqftPerSlab} sq ft × ₹${basis.polishPerSqft} per sq ft`,
      perSlab: round2(polish),
    },
    {
      head: "Packing",
      basis: `${basis.sqftPerSlab} sq ft × ₹${basis.packingPerSqft} per sq ft`,
      perSlab: round2(packing),
    },
    {
      head: "Manpower",
      basis: `${lakh(basis.manpowerPerMonth)}/month ÷ ${basis.daysPerMonth} × ` +
        `${round2(runDays)} days ÷ ${totalSlabs} slabs`,
      perSlab: round2(manpower),
    },
    {
      head: "Electricity",
      basis: `${lakh(basis.electricityPerMonth)}/month ÷ ${basis.daysPerMonth} × ` +
        `${round2(runDays)} days ÷ ${totalSlabs} slabs`,
      perSlab: round2(electricity),
    },
  ];
  const conversionPerSlab = round2(polish + packing + manpower + electricity);

  // -- final ---------------------------------------------------------------
  const perSlab3cm = round2(materialPerEquivalent + conversionPerSlab);
  const perSlab2cm = round2(materialPer2cm + conversionPerSlab);
  const conversionTotal = round2(conversionPerSlab * totalSlabs);

  return {
    material: {
      resinAndChemicals,
      gritAndFiller,
      resinAndChemicalsTotal,
      gritAndFillerTotal,
      gritAndFillerTonnes,
      total,
      shares,
    },
    output: {
      slabs3cm: output.slabs3cm,
      slabs2cm: output.slabs2cm,
      totalSlabs,
      equivalent3cm: round2(equivalent3cm),
      materialPerEquivalent: round2(materialPerEquivalent),
      materialPer2cm: round2(materialPer2cm),
      allocatedTo3cm: round2(allocatedTo3cm),
      allocatedTo2cm: round2(allocatedTo2cm),
      allocationGap,
    },
    conversion: {
      heads,
      perSlab: conversionPerSlab,
      runHours: round2(output.runHours),
      runDays: round2(runDays),
    },
    final: {
      perSlab3cm,
      perSlab2cm,
      perSqft3cm: round2(perSlab3cm / basis.sqftPerSlab),
      perSqft2cm: round2(perSlab2cm / basis.sqftPerSlab),
      // Four decimals: a slab sells by the container, and the third decimal
      // of a $/sqft price is real money at that volume.
      perSqftUsd3cm: Math.round((perSlab3cm / basis.sqftPerSlab / basis.inrPerUsd) * 10000) / 10000,
      perSqftUsd2cm: Math.round((perSlab2cm / basis.sqftPerSlab / basis.inrPerUsd) * 10000) / 10000,
      materialTotal: total,
      conversionTotal,
      batchTotal: round2(total + conversionTotal),
    },
  };
}

// ---------------------------------------------------------------------------
// Variance - two ways of measuring the same quantity, disagreeing.
//
// The reference sheet earned its keep here: it caught 2.81 t booked to the
// wrong grit size because silos 103 and 102 swapped grit slots mid-run. Total
// grit was unaffected, so a total-only check would have said "fine"; the sheet
// compared PER-SIZE quantities and the swap fell out. This models exactly
// that: line-level deltas plus the cost effect at each line's rate.
// ---------------------------------------------------------------------------

export interface VarianceLine {
  item: string;
  /** What the primary attribution says (e.g. silo-slot mapping). */
  primaryQty: number;
  /** What the independent record says (e.g. per-silo weights re-mapped). */
  checkQty: number;
  unit: "kg" | "t" | "slabs";
  /** checkQty - primaryQty. */
  delta: number;
  /** delta x rate: what the disagreement is worth in rupees. */
  costEffect: number;
  rate: number;
}

export interface VariancePanel {
  lines: VarianceLine[];
  /** Sum of |costEffect| - the size of the disagreement, not its direction. */
  totalAbsEffect: number;
  /** Net of the deltas in tonnes-equivalent - near zero when quantity merely
   *  moved between lines (the silo-swap signature) rather than went missing. */
  netDeltaTonnes: number;
}

export function varianceLines(
  pairs: ReadonlyArray<{ item: string; primaryQty: number; checkQty: number; unit: "kg" | "t" | "slabs"; rate: number }>,
  /** Deltas below this many tonnes are rounding, not findings. */
  thresholdTonnes = 0.05,
): VariancePanel {
  const lines: VarianceLine[] = [];
  let netDeltaTonnes = 0;
  for (const p of pairs) {
    const delta = round2(p.checkQty - p.primaryQty);
    if (p.unit === "slabs") {
      // Counts, not weights: any whole-slab disagreement is a finding, and
      // slabs never join the tonnes netting.
      if (Math.abs(delta) < 0.5) continue;
      lines.push({
        item: p.item,
        primaryQty: round2(p.primaryQty),
        checkQty: round2(p.checkQty),
        unit: p.unit,
        delta,
        rate: p.rate,
        costEffect: round2(delta * p.rate),
      });
      continue;
    }
    const deltaTonnes = p.unit === "t" ? delta : delta / 1000;
    netDeltaTonnes += deltaTonnes;
    if (Math.abs(deltaTonnes) < thresholdTonnes) continue;
    lines.push({
      item: p.item,
      primaryQty: round2(p.primaryQty),
      checkQty: round2(p.checkQty),
      unit: p.unit,
      delta,
      rate: p.rate,
      costEffect: round2(delta * p.rate),
    });
  }
  return {
    lines,
    totalAbsEffect: round2(lines.reduce((s, l) => s + Math.abs(l.costEffect), 0)),
    netDeltaTonnes: round2(netDeltaTonnes),
  };
}
