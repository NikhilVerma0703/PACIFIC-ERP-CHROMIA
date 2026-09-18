// DEMO SEED — production line (module 30).
//
// Fills the plant tables the dashboard, /live, Batch Lookup and the Detailed
// Production Report read: rm -> silo -> mixer_cycle -> distributor|kreos ->
// press -> oven -> jot, plus resin storage / daily tanks, the silo emptying
// log, the flat production_report rows and the mixer-cycle summary.
//
// Everything here is INVENTED. No Pacific design, supplier, silo contents or
// price appears. `db` is the already-connected demo client handed in by run.ts
// — nothing in this file imports "@/lib/prisma", and nothing but a type is
// imported at all.
//
// The numbers are made to AGREE with each other, because the report does
// arithmetic across tables: a batch's mixer input is derived from its press
// slab weights so wastage lands inside the bands the app's own rollup calls
// low / normal / high (8% and 12% are the cuts), grit slot weights are
// charged to silos that actually hold bags, and those bags are backed by rm
// rows. Seed the tables with unrelated random numbers and the report reads
// "-340% wastage", which is the one thing a demo must not do.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ctx } from "./run.ts";

// ── rules copied from the app (importing them would pull in the prod client) ──

/** Verbatim src/lib/normalizeBatch.ts. The stored batch_key MUST be whatever
 *  the app itself would compute from the batch text, or Batch Lookup misses. */
function normalizeBatch(s: unknown): string {
  if (!s) return "";
  const str = String(s).trim().toUpperCase().replace(/[\s,]+/g, "");
  const stripped = str.replace(/^[A-Z]+-?/, "").trim();
  const base = stripped || str;
  const m = base.match(/^(\d+)-?([A-Z]+)$/);
  return m ? `${m[1]}-${m[2]}` : base;
}

/** src/lib/silo.ts — 16 grit silos and 4 filler buffer towers. */
const GRIT_SILOS = [
  "101", "102", "103", "104", "105", "106", "107", "108",
  "201", "202", "203", "204", "205", "206", "207", "208",
];
const FILLER_SILOS = ["Filler A Buffer A", "Filler A Buffer B", "Filler B Buffer A", "Filler B Buffer B"];

/** src/lib/thickness.ts canonical spellings. */
const THICKNESS = ["2 cm", "3 cm", "1.2 cm", "2 cm", "2 cm", "3 cm"];
const KG_PER_SLAB: Record<string, number> = { "1.2 cm": 152, "2 cm": 248, "3 cm": 372, "7 mm": 92 };

// ── invented masters ────────────────────────────────────────────────────────
const SUPPLIERS = [
  "Kestrel Minerals Pvt Ltd",
  "Northvale Silica Works",
  "Ambergate Quartz Company",
  "Rockfern Industries",
  "Palewater Minerals LLP",
];
const RESIN_SUPPLIERS = ["Thalmine Polymers Ltd", "Corvane Resins Pvt Ltd"];
const GRIT_SIZES = ["0.1-0.3 mm", "0.3-0.8 mm", "0.8-1.2 mm", "1.2-2.5 mm"];
const FILLER_SIZES = ["325#", "400#"];
const GRADES = ["Premium", "Standard"];
const GRIT_SHADES = ["Bright", "Off-white", "Warm", "Neutral"];
const FALLBACK_OPERATORS = [
  "Devan Rathi", "Meera Kulkarni", "Anil Fernandes", "Sujata Bose",
  "Harish Nambiar", "Farida Qureshi", "Vikram Sethi", "Lalita Menon",
];
const VEINS = ["Fine drift", "Broad drift", "Twin ribbon", "Cloud"];

// ── tiny deterministic helpers ──────────────────────────────────────────────
let _seed = 20260918;
/** Deterministic LCG: the same demo database every run, which matters when a
 *  screenshot in a slide deck has to match the live demo. */
function rand(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}
const jitter = (n: number, pct: number) => n * (1 + (rand() * 2 - 1) * pct);
const r1 = (n: number) => Math.round(n * 10) / 10;
function pick<T>(a: readonly T[], i: number): T {
  return a[((i % a.length) + a.length) % a.length];
}
const hhmm = (h: number, m: number) => h * 3600 + m * 60;
const shiftOf = (h: number) => (h >= 6 && h < 14 ? "A" : h >= 14 && h < 22 ? "B" : "C");
function atTime(day: Date, h: number, m: number): Date {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

const SLABS_PER_BATCH = 4;
const CYCLES_PER_BATCH = 2;
const FIRST_SLAB = 14_200;

interface SlabRow { n: number; kg: number; ts: Date; hour: number; }
interface BatchPlan {
  idx: number;
  batch: string;
  key: string;
  design: string;
  thickness: string;
  day: Date;
  latest: boolean;
  lineHead: "distributor" | "kreos";
  operator: string;
  mixerOperator: string;
  enteredById: string | null;
  slabs: SlabRow[];
  outputKg: number;
  inputKg: number;
  wastagePct: number;
  gritSilos: [string, string, string];
  fillerSilo: string;
  tankNo: string;
}

export async function seed(db: any, ctx: Ctx): Promise<void> {
  const skip = (table: string, e: unknown) =>
    console.warn(`  [production] ${table} skipped:`, (e as Error).message);

  // Operators: prefer the demo's own people so the line, the scoreboard and the
  // user list name the same humans. Fall back to invented names if 10-users
  // failed, so this module still produces a coherent plant on its own.
  const people = ctx.users.filter((u) => u.name);
  const opNames = people.length >= 4 ? people.map((u) => u.name) : FALLBACK_OPERATORS;
  const opIds = people.length >= 4 ? people.map((u) => u.id) : [];

  // ── the plan: one coherent story per batch, built before anything is written ──
  const plans: BatchPlan[] = ctx.batches.map((batch, idx) => {
    const last = idx === ctx.batches.length - 1;
    const dayOffset = Math.round(88 - (idx * 88) / Math.max(1, ctx.batches.length - 1));
    const day = ctx.daysAgo(dayOffset);
    const thickness = pick(THICKNESS, idx);
    const startHour = 6 + ((idx * 5) % 12);

    const slabs: SlabRow[] = [];
    for (let s = 0; s < SLABS_PER_BATCH; s++) {
      const n = FIRST_SLAB + idx * 12 + s;
      const kg = Math.round(jitter(KG_PER_SLAB[thickness] ?? 250, 0.025));
      // The newest batch is happening NOW, so /live lights up green instead of
      // showing seven idle stations with a 3-day-old slab on them.
      const ts = last
        ? new Date(ctx.now.getTime() - ((SLABS_PER_BATCH - 1 - s) * 26 + 5) * 60_000)
        : atTime(day, startHour + Math.floor((s * 40) / 60), (s * 40) % 60);
      slabs.push({ n, kg, ts, hour: ts.getHours() });
    }

    const outputKg = slabs.reduce((a, s) => a + s.kg, 0);
    // The plant's OWN definition of a good batch, not ours: runBatchWastageRollup
    // in src/lib/automations.ts bands wastage as low (< 8 %), normal (8-12 %) and
    // high (> 12 %). Seeding 3.5-8 % made every batch "low", i.e. a plant running
    // better than its own "normal" on all 18 batches — so the band that the
    // Review/high colour exists for never appears. Spread across all three.
    const wastagePct = idx % 7 === 4 ? 12.3 + rand() * 1.8 : 7.4 + rand() * 4.4;
    const inputKg = Math.round(outputKg / (1 - wastagePct / 100));

    return {
      idx, batch, key: normalizeBatch(batch),
      design: pick(ctx.designs.length ? ctx.designs : ["Aurora Mist"], idx),
      thickness, day, latest: last,
      // Exactly one of Distributor / Kreos runs per batch — the batch audit
      // (lib/erp.ts) raises a structural note when both or neither have rows.
      lineHead: idx % 6 === 3 ? "kreos" : "distributor",
      operator: pick(opNames, idx),
      mixerOperator: pick(opNames, idx + 3),
      enteredById: opIds.length ? pick(opIds, idx) : null,
      slabs, outputKg, inputKg, wastagePct,
      gritSilos: [pick(GRIT_SILOS, idx * 3), pick(GRIT_SILOS, idx * 3 + 1), pick(GRIT_SILOS, idx * 3 + 2)],
      fillerSilo: pick(FILLER_SILOS, idx),
      tankNo: `DT-${(idx % 4) + 1}`,
    };
  });

  const stamp = (p: BatchPlan, s: SlabRow, offsetMin: number) =>
    new Date(s.ts.getTime() - offsetMin * 60_000);

  // ══ RM — raw-material bags ════════════════════════════════════════════════
  // Two populations: bags already dumped into a silo (silo[] non-empty), and
  // free stock, which is what /live's RM Stock panel counts (it selects
  // cardinality(silo) = 0 AND status is null-or-'Accepted').
  interface BagSpec {
    rmAid: string; siloAid: string | null; siloNo: string;
    type: string; size: string; grade: string; supplier: string;
    invNo: string; bagNo: number; kg: number; date: Date; increment: number;
  }
  const dumped: BagSpec[] = [];
  const bagsBySilo = new Map<string, string[]>();   // siloNo -> silo-row airtableIds

  const allSilos = [...GRIT_SILOS, ...FILLER_SILOS];
  allSilos.forEach((siloNo, si) => {
    const filler = FILLER_SILOS.includes(siloNo);
    const BAGS_PER_SILO = 2;
    for (let b = 0; b < BAGS_PER_SILO; b++) {
      const j = si * BAGS_PER_SILO + b;
      dumped.push({
        rmAid: `recDEMPRDRM${String(j).padStart(4, "0")}`,
        siloAid: `recDEMPRDSL${String(j).padStart(4, "0")}`,
        siloNo,
        type: filler ? "Filler" : "Grit",
        size: filler ? pick(FILLER_SIZES, si) : pick(GRIT_SIZES, si),
        grade: pick(GRADES, si + b),
        supplier: pick(SUPPLIERS, si + b),
        invNo: `DM/${2026}/${String(1040 + ((si + b) % 24)).padStart(4, "0")}`,
        bagNo: 100 + j,
        kg: filler ? 1000 : 1250,
        date: ctx.daysAgo(86 - Math.round((j * 84) / (allSilos.length * 2))),
        increment: b + 1,
      });
    }
  });
  for (const d of dumped) {
    if (!d.siloAid) continue;
    const arr = bagsBySilo.get(d.siloNo) ?? [];
    arr.push(d.siloAid);
    bagsBySilo.set(d.siloNo, arr);
  }

  const freeStock: BagSpec[] = [];
  for (let j = 0; j < 32; j++) {
    const filler = j % 4 === 3;
    freeStock.push({
      rmAid: `recDEMPRDRMF${String(j).padStart(3, "0")}`,
      siloAid: null,
      siloNo: "",
      type: filler ? "Filler" : "Grit",
      size: filler ? pick(FILLER_SIZES, j) : pick(GRIT_SIZES, j),
      grade: pick(GRADES, j),
      supplier: pick(SUPPLIERS, j),
      invNo: `DM/${2026}/${String(1064 + (j % 10)).padStart(4, "0")}`,
      bagNo: 200 + j,
      kg: filler ? 1000 : 1250,
      date: ctx.daysAgo(Math.round(40 - (j * 38) / 32)),
      increment: 0,
    });
  }

  try {
    await db.rm.createMany({
      skipDuplicates: true,
      data: [...dumped, ...freeStock].map((b, i) => ({
        airtableId: b.rmAid,
        rmId: `RM-${b.bagNo}`,
        date: b.date,
        testedBy: pick(opNames, i + 1),
        status: "Accepted",
        bagWeight: b.kg,
        nameFromSupplierMaster: [b.supplier],
        type: b.type,
        size: b.size,
        grade: b.grade,
        invNo: b.invNo,
        bagNo: b.bagNo,
        colourL: r1(88 + rand() * 6),
        colourA: r1(-0.6 + rand() * 1.2),
        colourB: r1(1.2 + rand() * 2.4),
        contamination: rand() < 0.9 ? "Nil" : "Trace",
        gritShade: b.type === "Grit" ? pick(GRIT_SHADES, i) : null,
        fillerShade: b.type === "Filler" ? pick(GRIT_SHADES, i + 2) : null,
        availability: b.siloAid ? "Consumed" : "In stock",
        siloIds: b.siloAid ? [b.siloAid] : [],
        importedAt: b.date,
      })),
    });
  } catch (e) { skip("rm", e); }

  // ══ SILO — one row per bag dumped, FIFO by siloIncrement ══════════════════
  // The material lookups are denormalised onto the silo row exactly as the
  // Airtable mirror does (arrays), because lib/silo.ts and the detailed report
  // read them straight off the silo row without joining rm.
  try {
    await db.silo.createMany({
      skipDuplicates: true,
      data: dumped.map((b, i) => {
        const consumedFrac = 0.35 + rand() * 0.55;
        const owner = plans[i % plans.length];
        return {
          airtableId: b.siloAid!,
          siloId: `${b.siloNo}/${b.increment}`,
          siloIncrement: b.increment,
          date: b.date,
          batch: owner.batch,
          batchKey: owner.key,
          assignee: pick(opNames, i),
          sku: owner.design,
          weight: b.kg,
          remainingWeight: Math.round(b.kg * (1 - consumedFrac)),
          siloNo: b.siloNo,
          rmNotFound: false,
          // Exactly the string consumeRm() builds in src/lib/siloCorrection.ts —
          // this column is parsed back by eye on the silo-correction screen, so a
          // second format beside the app's own reads as two kinds of bag.
          invNoBagNo: `${b.invNo} ; Bag: ${b.bagNo}`,
          rmIds: [b.rmAid],
          usedBagIds: [b.rmAid],
          sizeFromUsedBag: [b.size],
          gradeFromUsedBag: [b.grade],
          typeFromUsedBag: [b.type],
          nameFromSupplierMasterFromUsedBag: [b.supplier],
          invNoFromUsedBag: [b.invNo],
          bagNoFromUsedBag: [b.bagNo],
          importedAt: b.date,
        };
      }),
    });
  } catch (e) { skip("silo", e); }

  // ══ SILO EMPTYING LOG ════════════════════════════════════════════════════
  try {
    await db.siloEmptyingLog.createMany({
      skipDuplicates: true,
      data: dumped.slice(0, 24).map((b, i) => ({
        airtableId: `recDEMPRDSE${String(i).padStart(4, "0")}`,
        emptyId: `EMP-${String(1200 + i)}`,
        dateTime: new Date(b.date.getTime() + 7 * 3_600_000),
        incrementNumber: b.increment,
        siloNo: b.siloNo,
        bagWeight: b.kg,
        importedAt: new Date(b.date.getTime() + 7 * 3_600_000),
      })),
    });
  } catch (e) { skip("silo_emptying_log", e); }

  // ══ RESIN STORAGE + DAILY RESIN TANKS ════════════════════════════════════
  // The detailed report prices Silane and Cobalt off the daily tanks' dosing
  // ratios, so those two numbers have to be dosing fractions, not kilos.
  try {
    await db.resinStorage.createMany({
      skipDuplicates: true,
      data: Array.from({ length: 6 }, (_, i) => {
        const qty = 24_000;
        return {
          airtableId: `recDEMPRDRS${String(i).padStart(4, "0")}`,
          resinId: 4100 + i,
          date: ctx.daysAgo(84 - i * 14),
          supplier: pick(RESIN_SUPPLIERS, i),
          invoiceNo: `TR/26/${String(880 + i)}`,
          tankNo: `RT-${(i % 3) + 1}`,
          quantity: qty,
          quantityRemaining: Math.round(qty * (0.15 + rand() * 0.6)),
          testAssignee: pick(opNames, i + 2),
          testStatus: "Passed",
          testDate: ctx.daysAgo(84 - i * 14),
          vehicleNumberAllCapsNoSpace: `TN${20 + i}CX${4100 + i}`,
          importedAt: ctx.daysAgo(84 - i * 14),
        };
      }),
    });
  } catch (e) { skip("resin_storage", e); }

  try {
    await db.dailyResinTank.createMany({
      skipDuplicates: true,
      data: Array.from({ length: 20 }, (_, i) => {
        const day = ctx.daysAgo(Math.round(86 - (i * 86) / 19));
        const qty = 2000;
        return {
          airtableId: `recDEMPRDDT${String(i).padStart(4, "0")}`,
          dailyResinId: 7300 + i,
          date: atTime(day, 5, 30),
          dailyTankNo: `DT-${(i % 4) + 1}`,
          quantity: qty,
          remainingWeight: Math.round(qty * (0.1 + rand() * 0.7)),
          silane: 0.006,
          cobalt: 0.0025,
          preparationDurationMins: 40 + Math.round(rand() * 25),
          incharge: pick(opNames, i),
          usageStatus: i % 4 === 0 ? "In use" : "Prepared",
          processed: "Yes",
          importedAt: atTime(day, 5, 30),
        };
      }),
    });
  } catch (e) { skip("daily_resin_tank", e); }

  // ══ MIXER CYCLE ══════════════════════════════════════════════════════════
  // Weights are derived from the batch's own slab output so the report's
  // wastage line is the number we planned, not an accident.
  const mixerRows: any[] = [];
  const cycleWeightByBatch = new Map<string, number[]>();   // key -> [m1..m4] totals

  for (const p of plans) {
    const perCycle = p.inputKg / CYCLES_PER_BATCH;
    const perMixer = perCycle / 2;                           // mixers 1 and 2 run
    const totals: number[] = [0, 0, 0, 0];

    for (let c = 1; c <= CYCLES_PER_BATCH; c++) {
      const base = p.slabs[Math.min(c - 1, p.slabs.length - 1)].ts;
      // The mixer feeds the line continuously, so on the batch that is running
      // NOW its latest cycle has to land inside /live's 30-minute active window
      // — otherwise the demo shows a line pressing slabs with a dead mixer.
      const start = p.latest
        ? new Date(ctx.now.getTime() - (26 + (CYCLES_PER_BATCH - c) * 50) * 60_000)
        : new Date(base.getTime() - (80 - c * 10) * 60_000);
      const end = new Date(start.getTime() + 24 * 60_000);
      const row: any = {
        airtableId: `recDEMPRDMX${String(p.idx).padStart(3, "0")}${c}`,
        mixerId: `MX-${p.key || p.batch}-${c}`,
        batch: p.batch,
        batchKey: p.key,
        loc: 1,
        operator: p.mixerOperator,
        cycle: c,
        createTime: start,
        mixerStartTime: start,
        mixerEndTime: end,
        mixer1: true, mixer2: true, mixer3: false, mixer4: false,
        fillerSiloBuffer: p.fillerSilo,
        fillerSiloIdIds: bagsBySilo.get(p.fillerSilo) ?? [],
        fillerBags: (bagsBySilo.get(p.fillerSilo) ?? []).length,
        remarks: null,
        enteredById: p.enteredById,
        importedAt: start,
      };

      for (let m = 1; m <= 2; m++) {
        const resin = r1(perMixer * 0.09);
        const filler = r1(perMixer * 0.20);
        const gritTotal = perMixer - resin - filler;
        const split = [0.4, 0.35, 0.25];
        row[`m${m}RW`] = resin;
        row[`m${m}FW`] = filler;
        row[`m${m}RDtn`] = p.tankNo;
        row[`m${m}RIdIds`] = [];
        for (let g = 1; g <= 3; g++) {
          const siloNo = p.gritSilos[g - 1];
          const w = r1(gritTotal * split[g - 1]);
          row[`m${m}W${g}`] = w;
          row[`m${m}G${g}Sn`] = siloNo;
          row[`m${m}G${g}Ids`] = bagsBySilo.get(siloNo) ?? [];
          row[`m${m}G${g}Bags`] = (bagsBySilo.get(siloNo) ?? []).length;
        }
        totals[m - 1] += perMixer;
      }
      row.totalCycleWeight = Math.round(perCycle);
      row.totalMixer1Weight = Math.round(perMixer);
      mixerRows.push(row);
    }
    cycleWeightByBatch.set(p.key, totals.map((t) => Math.round(t)));
  }

  try {
    await db.mixerCycle.createMany({ skipDuplicates: true, data: mixerRows });
  } catch (e) { skip("mixer_cycle", e); }

  // ══ MIXER CYCLE SUMMARY — the "latest state" strip ═══════════════════════
  try {
    const last = plans[plans.length - 1];
    const lastSiloAid = bagsBySilo.get(last.gritSilos[0])?.slice(-1) ?? [];
    await db.mixerCycleSummary.createMany({
      skipDuplicates: true,
      data: [{
        airtableId: "recDEMPRDMCS0001",
        name: "Latest mixer state",
        lastMixerCycleIds: [`recDEMPRDMX${String(last.idx).padStart(3, "0")}${CYCLES_PER_BATCH}`],
        mixerBatch: [last.batch],
        lastRmIds: [dumped[0].rmAid],
        rmGrade: [dumped[0].grade],
        lastSiloIds: lastSiloAid,
        siloRemaining: [Math.round(dumped[0].kg * 0.4)],
        lastResinTankIds: [],
        resinStatus: ["In use"],
        updateTime: [ctx.now.toISOString()],
        importedAt: ctx.now,
      }],
    });
  } catch (e) { skip("mixer_cycle_summary", e); }

  // ══ DISTRIBUTOR (line head on 15 of the 18 batches) ══════════════════════
  try {
    const rows: any[] = [];
    for (const p of plans.filter((x) => x.lineHead === "distributor")) {
      p.slabs.forEach((s, si) => {
        const ts = stamp(p, s, 18);
        rows.push({
          airtableId: `recDEMPRDDS${String(p.idx).padStart(3, "0")}${si}`,
          batch: p.batch,
          batchKey: p.key,
          designName: p.design,
          operator: p.operator,
          slabNumber: s.n,
          createdTime: ts,
          date: ts,
          slabThickness: p.thickness,
          mouldInTime: hhmm(ts.getHours(), ts.getMinutes()),
          mouldOutTime: hhmm(ts.getHours(), ts.getMinutes()) + 480,
          loadingMaterialP1W: r1(s.kg * 0.52),
          loadingMaterialP2W: r1(s.kg * 0.48),
          totalWeightAtDistributor: s.kg,
          veinDropped: 2,
          veinRemaining: 1,
          crusherEnableDisable: "Enable",
          crusherLoadingBeltLoadingSpeed: 12,
          crusherLoadingBeltUnloadingSpeed: 15,
          roller1Rpm: 28 + (p.idx % 3),
          roller2Rpm: 24 + (p.idx % 3),
          lumpCrusherGap: 6,
          s1: 120, e1: 980, s2: 140, e2: 1010,
          veinDesignName: `${p.design} vein`,
          distributorVein1: pick(VEINS, p.idx),
          distributorVein1GevSlot: ["9mm"],
          distributorVein1BatcherRpm: 18,
          distributorVein2: pick(VEINS, p.idx + 1),
          distributorVein2GevSlot: ["7mm"],
          distributorVein2BatcherRpm: 14,
          distributorLoadingBeltLoadingSpeed: 11,
          distributorLoadingBeltUnloadingSpeed: 13,
          distributorMaterialUnloadingSpeed: 9,
          distributorFractionatorSpeed: 320,
          distributorFractionatorType: p.idx % 2 ? "Type B" : "Type A",
          distributorHopperGap: 34,
          distributorHopperWeight: r1(s.kg * 1.02),
          distributorManualRollerHeight: 21,
          shuttleSpeedP1: 16,
          shuttleSpeedP2: 18,
          lastSlab: si === p.slabs.length - 1,
          remarks: null,
          mixerCycleIds: [`recDEMPRDMX${String(p.idx).padStart(3, "0")}1`],
          cycleFromMixerCycle: [1],
          enteredById: p.enteredById,
          importedAt: ts,
        });
      });
    }
    await db.distributor.createMany({ skipDuplicates: true, data: rows });
  } catch (e) { skip("distributor", e); }

  // ══ KREOS (the other line head — never on the same batch as Distributor) ══
  try {
    const rows: any[] = [];
    for (const p of plans.filter((x) => x.lineHead === "kreos")) {
      p.slabs.forEach((s, si) => {
        const ts = stamp(p, s, 18);
        rows.push({
          airtableId: `recDEMPRDKR${String(p.idx).padStart(3, "0")}${si}`,
          batch: p.batch,
          batchKey: p.key,
          designName: p.design,
          operator: p.operator,
          slabNumber: s.n,
          createdTime: ts,
          date: ts,
          slabThickness: p.thickness,
          mouldInTime: hhmm(ts.getHours(), ts.getMinutes()),
          slabWeight: s.kg,
          pass1Breakage: false, pass2Breakage: false, pass3Breakage: false,
          loadOnMobileRollerRxSideKg: 1450,
          loadOnMobileRollerLxSideKg: 1440,
          crusherLoadingBeltSpeedInMMin: 12,
          crusherUnloadingBeltSpeedInMMinCopy: 14,
          roller1Rpm: 27, roller2Rpm: 23, lumpCrusherGap: 6,
          gevDesignName: `${p.design} GEV`,
          gev1: "GEV 1", gev1SlotSize: 9, gev1Rpm: 17,
          gev2: "GEV 2", gev2SlotSize: 7, gev2Rpm: 15,
          gev3: "GEV 3", gev3SlotSize: 11, gev3Rpm: 12,
          kreosWorkingPositionInMm: 42,
          slabSetWeight: s.kg,
          numberOfLaminations: "3",
          laminationSpeed: 8,
          beltRotationK1: 30, fixedRollerRotationK2: 26, mobileRollerRotationK3: 22,
          distributorLoadingBeltLoadingSpeed: 11,
          distributorLoadingBeltUnloadingSpeed: 13,
          lastSlab: si === p.slabs.length - 1,
          chessboardBodyPercentage: 82,
          mixerCycleIds: [`recDEMPRDMX${String(p.idx).padStart(3, "0")}1`],
          cycleFromMixerCycle: [1],
          remarks: null,
          enteredById: p.enteredById,
          importedAt: ts,
        });
      });
    }
    await db.kreos.createMany({ skipDuplicates: true, data: rows });
  } catch (e) { skip("kreos", e); }

  // ══ PRESS — the authoritative slab list ══════════════════════════════════
  try {
    const rows: any[] = [];
    for (const p of plans) {
      p.slabs.forEach((s, si) => {
        const ts = stamp(p, s, 14);
        rows.push({
          airtableId: `recDEMPRDPR${String(p.idx).padStart(3, "0")}${si}`,
          batch: p.batch,
          batchKey: p.key,
          operator: p.operator,
          designName: p.design,
          slabNumber: s.n,
          createdTime: ts,
          date: ts,
          inTime: hhmm(ts.getHours(), ts.getMinutes()),
          slabWeight: s.kg,
          temperatureInDegreeCelsiusNoteOnlyAt1500And300: r1(31 + rand() * 5),
          noOfVacuumPumps: 3,
          vacuumPumps: "1,2,4",
          noOfStages: 5,
          vacuumDelayInSeconds: 20,
          loweChamberVacuumInMbar: 12,
          pinholeCycle: "Yes",
          pinholeCyclePhase: "Phase 3",
          pinholeCycleDelay: 4,
          phase1Rev: 6, phase2Rev: 9, phase3Rev: 12, phase4Rev: 9, phase5Rev: 5,
          phase1PressingTime: 8, phase2PressingTime: 14, phase3PressingTime: 22, phase4PressingTime: 14, phase5PressingTime: 8,
          phase1AccelerationTime: 2, phase2AccelerationTime: 3, phase3AccelerationTime: 3, phase4AccelerationTime: 2, phase5AccelerationTime: 2,
          phase1Pressure: 40, phase2Pressure: 65, phase3Pressure: 92, phase4Pressure: 70, phase5Pressure: 45,
          cycleTimeSec: 210 + Math.round(rand() * 40),
          remarks: null,
          enteredById: p.enteredById,
          importedAt: ts,
        });
      });
    }
    await db.press.createMany({ skipDuplicates: true, data: rows });
  } catch (e) { skip("press", e); }

  // ══ OVEN ═════════════════════════════════════════════════════════════════
  // Batch 6 is deliberately one oven row short: a demo where every audit is
  // spotless never shows what Batch Lookup's slab audit is FOR.
  try {
    const rows: any[] = [];
    for (const p of plans) {
      p.slabs.forEach((s, si) => {
        if (p.idx === 6 && si === 2) return;
        const ts = stamp(p, s, 9);
        const inSec = hhmm(ts.getHours(), ts.getMinutes());
        const cook = 38 + Math.round(rand() * 6);
        rows.push({
          airtableId: `recDEMPRDOV${String(p.idx).padStart(3, "0")}${si}`,
          batch: p.batch,
          batchKey: p.key,
          operator: pick(opNames, p.idx + 1),
          designName: p.design,
          slabNumber: s.n,
          upperTemp: 92 + (p.idx % 4),
          lowerTemp: 88 + (p.idx % 4),
          setCookingTime: 40,
          date: ts,
          inTime: inSec,
          outTime: inSec + cook * 60,
          cookingTime: cook,
          floorNumber: (si % 6) + 1,
          slabDefect: [],
          remarks: null,
          enteredById: p.enteredById,
          importedAt: ts,
        });
      });
    }
    await db.oven.createMany({ skipDuplicates: true, data: rows });
  } catch (e) { skip("oven", e); }

  // ══ JOT — the measured thickness reading (priority 1 in slabThickness.ts) ══
  try {
    const rows: any[] = [];
    for (const p of plans) {
      const nominal = parseFloat(p.thickness) * (p.thickness.includes("mm") ? 1 : 10);
      p.slabs.forEach((s, si) => {
        const ts = stamp(p, s, 4);
        const pts: Record<string, number> = {};
        for (let k = 1; k <= 8; k++) pts[`thicknessAt${k}`] = r1(nominal + (rand() * 0.6 - 0.3));
        rows.push({
          airtableId: `recDEMPRDJT${String(p.idx).padStart(3, "0")}${si}`,
          batch: p.batch,
          batchKey: p.key,
          designName: p.design,
          operator: pick(opNames, p.idx + 2),
          slabNumber: s.n,
          date: ts,
          createdTime: ts,
          shift: shiftOf(ts.getHours()),
          slabWeight: s.kg,
          thickness: p.thickness,
          ...pts,
          bendMm: r1(rand() * 1.4),
          slabDefect: rand() < 0.12 ? "Edge chip" : null,
          remarks: null,
          enteredById: p.enteredById,
          importedAt: ts,
        });
      });
    }
    await db.jot.createMany({ skipDuplicates: true, data: rows });
  } catch (e) { skip("jot", e); }

  // ══ PRODUCTION REPORT — the flat per-batch summary rows ══════════════════
  try {
    await db.productionReport.createMany({
      skipDuplicates: true,
      data: plans.map((p, i) => {
        const w = cycleWeightByBatch.get(p.key) ?? [0, 0, 0, 0];
        const nums = p.slabs.map((s) => s.n);
        return {
          airtableId: `recDEMPRDPRP${String(i).padStart(4, "0")}`,
          slNo: String(i + 1),
          opening: p.slabs[0].ts,
          closing: p.slabs[p.slabs.length - 1].ts,
          design: p.design,
          batchNum: p.batch,
          batchKey: p.key,
          noOfCycles: String(CYCLES_PER_BATCH),
          m1Weight: String(w[0]),
          m2Weight: String(w[1]),
          m3Weight: "0",
          m4Weight: "0",
          totalSlabs: String(p.slabs.length),
          totalSlabWeight: String(p.outputKg),
          wastage: `${Math.round(p.wastagePct * 10) / 10}%`,
          missingSlabs: p.idx === 6 ? "1 (oven)" : "0",
          slabNumbers: `${nums[0]}–${nums[nums.length - 1]}`,
          importedAt: p.slabs[p.slabs.length - 1].ts,
        };
      }),
    });
  } catch (e) { skip("production_report", e); }

  // ══ BATCH WASTAGE — the per-batch reconciliation the report links to ═════
  try {
    await db.batchWastage.createMany({
      skipDuplicates: true,
      data: plans.map((p) => ({
        // The app writes this table itself (runBatchWastageRollup in
        // src/lib/automations.ts) and upserts on airtable_id = `wst_<batchKey>`.
        // Under an invented key, the first rollup anyone runs during the demo
        // inserts a SECOND row for every batch instead of updating ours; under
        // the app's key it updates in place and nothing moves on screen.
        airtableId: `wst_${p.key}`,
        batch: p.batch,
        batchKey: p.key,
        totalCycleWeightMixerCycle: p.inputKg,
        totalSlabWeightPress: p.outputKg,
        wastage: Math.round(p.wastagePct * 10) / 10,
        notes: null,
        // Same vocabulary and thresholds as that rollup. "Review"/"Normal" are
        // words the ERP never writes, so they would sort and filter as a fourth
        // and fifth status nothing else in the app produces.
        status: p.wastagePct > 12 ? "high" : p.wastagePct >= 8 ? "normal" : "low",
        mixerCycleIds: Array.from({ length: CYCLES_PER_BATCH }, (_, c) =>
          `recDEMPRDMX${String(p.idx).padStart(3, "0")}${c + 1}`),
        pressIds: p.slabs.map((_, si) => `recDEMPRDPR${String(p.idx).padStart(3, "0")}${si}`),
        importedAt: p.slabs[p.slabs.length - 1].ts,
      })),
    });
  } catch (e) { skip("batch_wastage", e); }

  // ── what later modules need from us ───────────────────────────────────────
  // Slab numbers are the join between the plant and everything downstream
  // (polish, QC, finished goods, fabrication), so hand them over rather than
  // letting 40-inventory invent a second, disagreeing set.
  (ctx as any).slabs = plans.flatMap((p) =>
    p.slabs.map((s) => ({
      slabNumber: s.n,
      batch: p.batch,
      batchKey: p.key,
      design: p.design,
      thickness: p.thickness,
      weightKg: s.kg,
      pressedAt: s.ts,
    })),
  );
  (ctx as any).batchKeys = Object.fromEntries(plans.map((p) => [p.batch, p.key]));
  (ctx as any).batchDesign = Object.fromEntries(plans.map((p) => [p.batch, p.design]));
  (ctx as any).operators = opNames;
}
