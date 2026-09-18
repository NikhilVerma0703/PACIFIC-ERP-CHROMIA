// COSTING, FOR ONE BATCH DONE PROPERLY.
//
// The costing sheet is the screen that most obviously breaks on thin data: it
// joins the mixer's recorded quantities to a rate card, splits grit by silo and
// by supplier, and refuses to print a total when a line is unpriced. Scattering
// half-priced rows across eighteen batches would give eighteen broken sheets.
//
// So ONE batch — 2101 — is costed end to end and is the one to open in a
// demo. The rate card itself is seeded for everything, because rates are global
// and a populated rate card is what makes the admin screen look real.
//
// NULL IS NOT ZERO, and the schema says so at length: an unpriced grit line
// must be NULL, because 0 would mean the grit was free and would print a
// complete-looking sheet with the grit silently missing. Every line here is
// priced on purpose.
import type { Ctx } from "./run.ts";

/** The batch a demo should open. Named here so the seed and the notes agree. */
export const COSTED_BATCH = "2101";

const RATES: [string, string, string, number][] = [
  // category, item, unit, rate
  ["RESIN", "resin-unsaturated", "kg", 148],
  ["RESIN", "resin-clear", "kg", 162],
  ["GRIT", "grit-0.1-0.4", "t", 4200],
  ["GRIT", "grit-0.3-0.7", "t", 4450],
  ["GRIT", "grit-0.6-1.2", "t", 4600],
  ["GRIT", "grit-1.2-2.5", "t", 4750],
  ["GRIT", "grit-8-16", "t", 5100],
  ["FILLER", "filler-400", "t", 2350],
  ["PIGMENT", "pigment-black", "kg", 310],
  ["PIGMENT", "pigment-white", "kg", 245],
  ["CHEMICAL", "chemical-hardener", "kg", 395],
  ["CHEMICAL", "chemical-coupling", "kg", 420],
  ["CONVERSION", "conversion-polishing", "sqft", 18],
  ["CONVERSION", "conversion-cutting", "sqft", 6.5],
  ["BASIS", "basis-slab-sqft", "sqft", 75.076],
];

export async function seed(db: any, ctx: Ctx): Promise<void> {
  const from = new Date(Date.UTC(2026, 0, 1));

  // ── the rate card ────────────────────────────────────────────────────────
  try {
    await db.costingRate.createMany({
      data: RATES.map(([category, item, unit, rate]) => ({
        category, item, unit, rate, variant: "", effectiveFrom: from,
        note: "Demo rate card — invented figures", createdBy: "demo-seed",
      })),
      skipDuplicates: true,
    });
  } catch (e) { console.warn("  [costing] rates skipped:", (e as Error).message); }

  // ── the materials of the one costed batch ────────────────────────────────
  // Quantities are plausible for a single mixer load: ~1,150 kg of grit and
  // filler against ~95 kg of resin, which is roughly the 12:1 the plant runs.
  const materials: { category: string; item: string; seq: number; qty: number | null; unit: string; rate: number; description: string }[] = [
    { category: "RESIN",    item: "resin-unsaturated",   seq: 0, qty: 78,   unit: "kg", rate: 148,  description: "Base resin" },
    { category: "RESIN",    item: "resin-clear",         seq: 1, qty: 17,   unit: "kg", rate: 162,  description: "Clear top" },
    { category: "GRIT",     item: "grit-0.6-1.2",        seq: 0, qty: 520,  unit: "kg", rate: 4600, description: "Main body" },
    { category: "GRIT",     item: "grit-0.3-0.7",        seq: 1, qty: 240,  unit: "kg", rate: 4450, description: "Fines" },
    { category: "GRIT",     item: "grit-1.2-2.5",        seq: 2, qty: 110,  unit: "kg", rate: 4750, description: "Coarse vein" },
    { category: "FILLER",   item: "filler-400",          seq: 0, qty: 280,  unit: "kg", rate: 2350, description: "Filler 400 mesh" },
    { category: "PIGMENT",  item: "pigment-white",       seq: 0, qty: 6.4,  unit: "kg", rate: 245,  description: "Base tint" },
    { category: "PIGMENT",  item: "pigment-black",       seq: 1, qty: 1.1,  unit: "kg", rate: 310,  description: "Vein tint" },
    { category: "CHEMICAL", item: "chemical-hardener",   seq: 0, qty: 1.5,  unit: "kg", rate: 395,  description: "Hardener" },
    { category: "CHEMICAL", item: "chemical-coupling",   seq: 1, qty: 0.9,  unit: "kg", rate: 420,  description: "Coupling agent" },
  ];
  try {
    await db.costingBatchMaterial.createMany({
      data: materials.map((m) => ({ ...m, batchKey: COSTED_BATCH, note: null, createdBy: "demo-seed" })),
      skipDuplicates: true,
    });
  } catch (e) { console.warn("  [costing] materials skipped:", (e as Error).message); }

  // ── grit by silo, and each silo split across suppliers ───────────────────
  const silos: { siloNo: string; size: string; suppliers: { supplier: string; kg: number; ratePerT: number }[] }[] = [
    { siloNo: "1", size: "0.6-1.2", suppliers: [
      { supplier: "Deccan Minerals", kg: 320, ratePerT: 4600 },
      { supplier: "Coastal Quartz Co", kg: 200, ratePerT: 4525 },
    ] },
    { siloNo: "2", size: "0.3-0.7", suppliers: [
      { supplier: "Deccan Minerals", kg: 240, ratePerT: 4450 },
    ] },
    { siloNo: "3", size: "1.2-2.5", suppliers: [
      { supplier: "Ravi Aggregates", kg: 110, ratePerT: 4750 },
    ] },
  ];
  try {
    await db.costingBatchGritSilo.createMany({
      data: silos.map((s) => ({
        batchKey: COSTED_BATCH, siloNo: s.siloNo, size: s.size,
        gritType: "Quartz", assignedBy: "demo-seed",
      })),
      skipDuplicates: true,
    });
  } catch (e) { console.warn("  [costing] grit silos skipped:", (e as Error).message); }

  try {
    const rows = silos.flatMap((s) =>
      s.suppliers.map((sup, i) => ({
        batchKey: COSTED_BATCH, siloNo: s.siloNo, seq: i,
        supplier: sup.supplier, kg: sup.kg,
        // PRICED, not null — an unpriced line is what stops the sheet printing.
        ratePerT: sup.ratePerT, rateBy: "demo-seed", rateAt: ctx.daysAgo(30),
        assignedBy: "demo-seed",
      })),
    );
    await db.costingBatchGritSupplier.createMany({ data: rows, skipDuplicates: true });
  } catch (e) { console.warn("  [costing] grit suppliers skipped:", (e as Error).message); }

  // ── both sign-offs, so the sheet reads as settled ────────────────────────
  try {
    await db.costingBatchVerification.createMany({
      data: [
        { batchKey: COSTED_BATCH, side: "materials", fingerprint: "demo-materials-v1", verifiedBy: "Satyadev (demo)", verifiedAt: ctx.daysAgo(12) },
        { batchKey: COSTED_BATCH, side: "weights",   fingerprint: "demo-weights-v1",   verifiedBy: "Satyadev (demo)", verifiedAt: ctx.daysAgo(12) },
      ],
      skipDuplicates: true,
    });
  } catch (e) { console.warn("  [costing] verification skipped:", (e as Error).message); }

  console.log(`\n     costing is complete for batch ${COSTED_BATCH} — open that one in a demo`);
}
