import "server-only";

// NO_SILO lives in gritAssign, which is import-free: a "use client" screen
// needs the same constant and cannot reach into a server-only module for it.
import { NO_SILO } from "./gritAssign";
export { NO_SILO };

// What one batch actually consumed, read from the mixer records.
//
// Every column here was verified against the Simply White reference batch
// (1403, 747 slabs): resin 41,873.4 kg, filler 125.5425 t, grit per band to
// the kilogram, 514 x 3 cm + 233 x 2 cm. Where the ERP records nothing - the
// four chemicals, resin litres per supplier - the gap is stated, not papered
// over: chemicals are computed from dosing rules, the supplier split is
// proportioned per resin tank and flagged an estimate.
//
// Nothing is stored. A corrected mixer row re-costs the batch on the next
// read; that is the design, not an accident.

import { prisma } from "@/lib/prisma";
import { thicknessBySlab } from "@/lib/slabThickness";

/**
 * Which supplier fills which daily resin tank.
 *
 * The mixer rows record the TANK (m*_r_dtn: I1/I2/I3); litres per supplier
 * are not recorded, and the tank->supplier bridge tables (daily_resin_tank,
 * resin_storage) stopped being filled in mid-2026. This map is the standing
 * assumption, printed on the basis panel of every costing so it can be
 * challenged; the resin lines it feeds are flagged estimates.
 */
export const RESIN_TANK_SUPPLIER: Readonly<Record<string, string>> = {
  I1: "3n Composits",
  I2: "Aypols",
  I3: "Aypols",
};


// bandOf, gritItemKey and GRIT_BAND_LABELS moved to ./gritBand — this module
// imports "server-only" and Prisma, so nothing in it is reachable from
// `node --test`, which is why the size normaliser carried two defects and no
// tests. Re-exported here so every existing import site is untouched.
export { bandOf, gritItemKey, GRIT_BAND_LABELS } from "./gritBand";
// ...and imported for this module's own use: a re-export does not bind locally.
import { bandOf, gritItemKey } from "./gritBand";

export interface BatchListEntry {
  batchKey: string;
  batch: string;
  design: string;
  slabs: number;
  cycles: number;
  firstPress: string | null;
  lastPress: string | null;
}

/** Recent batches with mixer data - the dashboard's picker. */
export async function listCostableBatches(days: number): Promise<BatchListEntry[]> {
  const rows: Array<{
    batch_key: string; batch: string | null; cycles: number;
    design: string | null; slabs: number; first_press: Date | null; last_press: Date | null;
  }> = await prisma.$queryRaw`
    WITH mixes AS (
      SELECT batch_key, max(batch) batch, count(*)::int cycles
      FROM mixer_cycle
      -- ::int IS LOAD-BEARING. Prisma binds a JS number as int8, and
      -- make_interval's named arguments are int4 with no implicit cast between
      -- them, so without it Postgres answers 42883 "function
      -- make_interval(days => bigint) does not exist" and this query throws on
      -- EVERY call. The batch picker was permanently empty because of it.
      WHERE batch_key IS NOT NULL AND imported_at > now() - make_interval(days => ${days}::int)
      GROUP BY batch_key
    ),
    pressed AS (
      SELECT batch_key, mode() WITHIN GROUP (ORDER BY design_name) design,
             count(DISTINCT slab_number)::int slabs,
             min(imported_at) first_press, max(imported_at) last_press
      FROM press WHERE batch_key IS NOT NULL GROUP BY batch_key
    )
    SELECT m.batch_key, m.batch, m.cycles, p.design, COALESCE(p.slabs, 0)::int slabs,
           p.first_press, p.last_press
    FROM mixes m LEFT JOIN pressed p USING (batch_key)
    ORDER BY p.last_press DESC NULLS LAST`;
  return rows.map((r) => ({
    batchKey: r.batch_key,
    batch: r.batch ?? r.batch_key,
    design: r.design ?? "(design not recorded)",
    slabs: r.slabs,
    cycles: r.cycles,
    firstPress: r.first_press?.toISOString().slice(0, 10) ?? null,
    lastPress: r.last_press?.toISOString().slice(0, 10) ?? null,
  }));
}

export interface GritCharge {
  silo: string;
  band: string;
  kg: number;
}

export interface BatchConsumption {
  batchKey: string;
  batch: string;
  design: string;
  /** Total resin kg across all four mixers - matches the sheet exactly. */
  resinKg: number;
  resinCycles: number;
  /** Per daily-resin-tank: the only supplier signal the mixer records carry. */
  resinByTank: Array<{ tank: string; cycles: number; kg: number }>;
  /** Per (silo, band) from the per-charge silo links - the primary attribution. */
  gritCharges: GritCharge[];
  /**
   * What the mixer drew PER SILO - the full weight, including charges whose
   * bags yield no size band and which therefore never reach gritCharges.
   *
   * This is the denominator for anything silo-shaped: how much of silo 204 is
   * still unassigned, and how much of it the sheet has to price. Using the
   * band-keyed totals for that quietly measured against a subset.
   */
  gritSiloKg: Array<{ silo: string; kg: number }>;
  /** Of the above, the weight the mixer recorded against no silo at all - it
   *  appears under the NO_SILO key so it can be sized, supplied and priced. */
  gritNoSiloKg: number;
  /** kg with no resolvable size band, reported rather than dropped. */
  gritUnresolvedKg: number;
  fillerKg: number;
  /** Mixer charges (mixer1..4 flags) - the TiO₂ dosing multiplier. */
  mixerCharges: number;
  /** First-mix-to-last with date-rollover repair; stoppages over 2 h excluded. */
  runHours: number;
  runStoppages: { count: number; hours: number };
  wallClockHours: number;
  /** Press slabs by thickness, each slab's thickness resolved across every
   *  station that stamps one (lib/slabThickness: jot, then distributor/kreos,
   *  then polish) — the same resolver the batch report and the Telegram bot
   *  use. NOT the distributor's own count: four of Arva White's five batches
   *  never went through the distributor and costed as "no slabs" while the
   *  press held 237-441 of them. 1.2 cm slabs are not in either figure; the
   *  sheet has no factor for them yet. */
  slabs3cm: number;
  slabs2cm: number;
  /** Independent thickness counts from JOT - the variance pair. */
  jot3cm: number;
  jot2cm: number;
  pressSlabs: number;
  firstPress: Date | null;
  lastPress: Date | null;
  /**
   * Silo-wise grit assignment, or NULL when nobody has assigned this batch.
   *
   * NULL AND NEVER [], and the distinction is load-bearing rather than
   * stylistic: both fingerprints and report.ts switch on it, and an empty array
   * arriving where null was meant would move every fingerprint in the plant and
   * silently drop grit out of every total. hasGritAssignment() is the one
   * predicate all of them go through so two call sites cannot disagree about
   * what "nothing" looks like.
   */
  gritSilos: GritSiloAssignment[] | null;
}

/** One silo's assignment on one batch, with what the bag records say beside it
 *  so a caller can flag a disagreement without a second query. */
export interface GritSiloAssignment {
  silo: string;
  /** As assigned, verbatim. "" means listed but not yet sized. */
  size: string;
  /** What the silo ran - Premium Supreme G2, Glass, Cristobalite. Verbatim as
   *  typed, same as size. "" means not chosen yet. */
  gritType: string;
  /** Drawn on this batch, summed across the silo's charges. */
  kg: number;
  /** The split. `ratePerT` is rupees per TONNE while `kg` is kilograms - the
   *  conversion happens once, in report.ts. NULL rate means nobody has priced
   *  this line; it must never be read as zero. */
  suppliers: Array<{ seq: number; supplier: string; kg: number; ratePerT: number | null }>;
  /** What the bags in this silo record — REPORTED, never written to. */
  recordedSizes: string[];
  recordedSuppliers: string[];
}

/** The one predicate every consumer goes through. Two guards on one value —
 *  `if (c.gritSilos)` and `if (c.gritSilos?.length)` — disagree on [], and that
 *  disagreement is the only path where a batch's grit leaves the total with no
 *  unpriced line, no blocker and no fingerprint movement. */
export const hasGritAssignment = (
  g: readonly unknown[] | null | undefined,
): boolean => !!g && g.length > 0;

/** The 32 (weight, silo, links) slot triplets, unpivoted in SQL. */

const GRIT_SLOTS = Array.from({ length: 4 }, (_, mi) =>
  Array.from({ length: 8 }, (_, gi) => ({
    w: `m${mi + 1}_w${gi + 1}`, sn: `m${mi + 1}_g${gi + 1}_sn`, ids: `m${mi + 1}_g${gi + 1}`,
  }))).flat();

/**
 * Silo-wise grit for one batch: what was assigned, beside what the bags record.
 *
 * RETURNS NULL, NEVER [], when nobody has assigned this batch. Both fingerprints
 * and report.ts fork on this value, and an empty array where null was meant
 * would move every fingerprint in the plant and drop grit out of every total
 * with no unpriced line to show for it.
 *
 * READS the silo table and never writes to it. The recorded size and supplier
 * come along so a caller can flag a disagreement without a second query — they
 * are REPORTED beside the assignment, and the assignment is what the batch is
 * costed at. tests/gritContainment.test.ts holds that boundary.
 */
export async function loadGritSilos(
  batchKey: string,
  /** The mixer per silo, FULL weight - see BatchConsumption.gritSiloKg. */
  siloKg: ReadonlyArray<{ silo: string; kg: number }>,
): Promise<GritSiloAssignment[] | null> {
  const [sizes, suppliers] = await Promise.all([
    prisma.costingBatchGritSilo.findMany({ where: { batchKey } }),
    prisma.costingBatchGritSupplier.findMany({ where: { batchKey }, orderBy: { seq: "asc" } }),
  ]);
  if (!sizes.length && !suppliers.length) return null;

  // Kilograms per silo come from the MIXER, never from the assignment — the
  // split says how the weight divides between suppliers, not how much there was.
  //
  // FULL weight, not the band-resolved part. `charges` is keyed by band and
  // omits every charge whose bags yield none, so summing it here measured each
  // silo against a subset of itself - 41% of batch 1415 was outside it.
  const kgBySilo = new Map<string, number>();
  for (const g of siloKg) kgBySilo.set(g.silo, (kgBySilo.get(g.silo) ?? 0) + g.kg);

  // What the bags in each silo say. One query for the batch's silos, read-only.
  const siloNos = [...new Set([...kgBySilo.keys(), ...sizes.map((r) => r.siloNo)])].filter(Boolean);
  const recorded: Array<{ silo_no: string | null; sizes: string[]; suppliers: string[] }> = siloNos.length
    ? await prisma.$queryRaw`
        SELECT s.silo_no,
               array_remove(array_agg(DISTINCT s.size_from_used_bag->>0), NULL) sizes,
               array_remove(array_agg(DISTINCT s.name_from_supplier_master_from_used_bag->>0), NULL) suppliers
        FROM silo s
        WHERE btrim(s.silo_no) = ANY(${siloNos}::text[])
        GROUP BY s.silo_no`
    : [];
  const recBySilo = new Map(recorded.map((r) => [(r.silo_no ?? "").trim(), r]));

  const bySilo = new Map<string, GritSiloAssignment>();
  const row = (silo: string): GritSiloAssignment => {
    let r = bySilo.get(silo);
    if (!r) {
      const rec = recBySilo.get(silo);
      r = {
        silo, size: "", gritType: "", kg: kgBySilo.get(silo) ?? 0, suppliers: [],
        recordedSizes: rec?.sizes ?? [], recordedSuppliers: rec?.suppliers ?? [],
      };
      bySilo.set(silo, r);
    }
    return r;
  };
  for (const a of sizes) {
    const r = row(a.siloNo);
    r.size = a.size;
    r.gritType = a.gritType;
  }
  for (const p of suppliers) {
    row(p.siloNo).suppliers.push({
      seq: p.seq, supplier: p.supplier, kg: p.kg,
      // `?? null` and never `?? 0`: unpriced is a state, not a price.
      ratePerT: p.ratePerT ?? null,
    });
  }

  return [...bySilo.values()].sort((a, b) => a.silo.localeCompare(b.silo));
}

export async function loadBatchConsumption(batchKey: string): Promise<BatchConsumption | null> {
  const head: Array<{ batch: string | null; cycles: number; resin_kg: number | null; filler_kg: number | null; charges: number | null }> =
    await prisma.$queryRaw`
      SELECT max(batch) batch, count(*)::int cycles,
             sum(COALESCE(m1_r_w,0)+COALESCE(m2_r_w,0)+COALESCE(m3_r_w,0)+COALESCE(m4_r_w,0)) resin_kg,
             sum(COALESCE(m1_f_w,0)+COALESCE(m2_f_w,0)+COALESCE(m3_f_w,0)+COALESCE(m4_f_w,0)) filler_kg,
             sum((mixer1)::int+(mixer2)::int+(mixer3)::int+(mixer4)::int)::int charges
      FROM mixer_cycle WHERE batch_key = ${batchKey}`;
  if (!head[0] || head[0].cycles === 0) return null;

  const tanks: Array<{ tank: string | null; cycles: number; kg: number | null }> = await prisma.$queryRaw`
    SELECT COALESCE(m1_r_dtn, m2_r_dtn, m3_r_dtn, m4_r_dtn) tank, count(*)::int cycles,
           sum(COALESCE(m1_r_w,0)+COALESCE(m2_r_w,0)+COALESCE(m3_r_w,0)+COALESCE(m4_r_w,0)) kg
    FROM mixer_cycle WHERE batch_key = ${batchKey}
    GROUP BY 1 ORDER BY 2 DESC`;

  // Grit: unpivot the 32 slots, resolve each charge's silo fill-records to a
  // size band. The per-charge link is authoritative - silos swap bands
  // mid-run, and the whole-silo shortcut is exactly the mistake the variance
  // panel exists to catch.
  const arms = GRIT_SLOTS.map((s) =>
    `SELECT ${s.sn} silo_no, ${s.w} kg, ${s.ids} ids FROM mixer_cycle WHERE batch_key = $1 AND COALESCE(${s.w}, 0) > 0`,
  ).join(" UNION ALL ");
  const charges: Array<{ silo_no: string | null; band: string | null; kg: number | null }> =
    await prisma.$queryRawUnsafe(
      // THE TYPED SILO NUMBER ONLY. The bag link is NOT used to infer it.
      //
      // It was, briefly, and the evidence took it back out. Falling back to the
      // linked silo record recovered 11,424.7 kg of blank entries - but on the
      // charges where the operator DID type a silo, that same link disagrees
      // with them 1,200 times over 467,842 kg. A signal that contradicts the
      // person at the mixer that often is not one to trust where the person
      // said nothing at all; a bag record plausibly says where a bag was
      // STORED, not which silo the mixer drew from.
      //
      // Guessing wrong here is silent and permanent: the tonnage lands on some
      // other silo's row and is priced as that silo's grit, and nothing ever
      // says so. Left unattributed it appears as its own priceable row, which
      // is visible, correctable, and honest about what is not known.
      `SELECT NULLIF(btrim(s.silo_no), '') silo_no,
              (SELECT MIN(x.size_from_used_bag->>0) FROM silo x
                WHERE x."airtableId" = ANY(s.ids) AND x.size_from_used_bag IS NOT NULL) band,
              SUM(s.kg) kg
       FROM (${arms}) s
       GROUP BY 1, 2`,
      batchKey,
    );

  const gritMap = new Map<string, number>();
  // WHAT THE MIXER DREW PER SILO, band or no band.
  //
  // gritCharges below is keyed by (silo, BAND) and a charge whose bags yield no
  // band is diverted into gritUnresolvedKg and never appears in it. That is
  // right for the per-band costing path, which has nothing to price such a
  // charge with - and wrong for anything asking "how much came out of silo
  // 204", which is the question the silo screen and the silo costing path both
  // ask. On batch 1415 the difference was 39,784 kg: silo 203 drew 11,534.5 kg
  // and did not appear on the screen at all, and silo 204 showed 12,998.6 of
  // the 26,258.6 kg it actually ran.
  const siloKg = new Map<string, number>();
  let gritUnresolvedKg = 0;
  // Grit the mixer weighed against NO SILO at all. Distinct from unbanded grit,
  // which has a silo and therefore a row; this has neither, and before it was
  // given the row below it was simply announced as untraceable and left
  // unpriceable - 21,557.7 kg of it across ten batches.
  let noSiloKg = 0;
  for (const c of charges) {
    const band = bandOf(c.band);
    const kg = Number(c.kg ?? 0);
    if (!kg) continue;
    const silo = (c.silo_no ?? "").trim();
    if (silo) siloKg.set(silo, (siloKg.get(silo) ?? 0) + kg);
    else noSiloKg += kg;
    if (!band) {
      gritUnresolvedKg += kg;
      continue;
    }
    const key = `${c.silo_no ?? "?"}|${band}`;
    gritMap.set(key, (gritMap.get(key) ?? 0) + kg);
  }
  const gritCharges: GritCharge[] = [...gritMap.entries()]
    .map(([k, kg]) => {
      const [silo, band] = k.split("|");
      return { silo, band, kg };
    })
    .sort((a, b) => a.band.localeCompare(b.band) || a.silo.localeCompare(b.silo));

  /** Every silo the mixer drew from, with its FULL weight. Heaviest first,
   *  which is the order the job is worked in. */
  const gritSiloKg: Array<{ silo: string; kg: number }> = [...siloKg.entries()]
    .map(([silo, kg]) => ({ silo, kg: Math.round(kg * 1000) / 1000 }))
    .sort((a, b) => b.kg - a.kg);

  // Grit with no silo gets a ROW OF ITS OWN rather than a footnote. It was
  // announced as "could not be traced to a silo... nothing here prices it",
  // which was accurate and useless: the tonnage sat in the batch weight with no
  // way to give it a size, a supplier or a price. As a row it takes all four
  // like any other, and the costing path and the sign-off gate pick it up
  // without either of them learning a special case.
  if (noSiloKg > 0.005) {
    gritSiloKg.push({ silo: NO_SILO, kg: Math.round(noSiloKg * 1000) / 1000 });
    gritSiloKg.sort((a, b) => b.kg - a.kg);
  }

  // Run length. mixer_start_time is an Airtable time-of-day with an
  // unreliable date part, so the walk repairs rollovers (a start earlier than
  // its predecessor gains 24 h) and then drops gaps over two hours - those
  // are stoppages, and absorbing overhead across a day the line stood still
  // would flatter the batch.
  const times: Array<{ cycle: number; t: Date | null }> = await prisma.$queryRaw`
    SELECT cycle::float cycle, mixer_start_time t FROM mixer_cycle
    WHERE batch_key = ${batchKey} AND mixer_start_time IS NOT NULL
    ORDER BY cycle`;
  let runMs = 0, stopMs = 0, stops = 0, wallMs = 0;
  if (times.length > 1) {
    const DAY = 86_400_000, GAP = 2 * 3_600_000;
    // Per-row repair, NOT a carried offset: most rows have a correct date and
    // only some are a day short, so a cumulative shift would push every
    // correct time after a bad one into a fake gap. Bump only the row that
    // went backwards, until it is monotonic again.
    let prev = times[0].t!.getTime();
    for (let i = 1; i < times.length; i++) {
      let t = times[i].t!.getTime();
      while (t < prev) t += DAY;
      const gap = t - prev;
      if (gap > GAP) {
        stopMs += gap;
        stops += 1;
      } else {
        runMs += gap;
      }
      wallMs += gap;
      prev = t;
    }
  }

  const thick: Array<{ src: string; t: string | null; n: number }> = await prisma.$queryRaw`
    SELECT 'jot' src, thickness t, count(DISTINCT slab_number)::int n
    FROM jot WHERE batch_key = ${batchKey} GROUP BY 2`;
  const pick = (src: string, cm: string) =>
    thick.filter((r) => r.src === src && (r.t ?? "").replace(/\s/g, "").startsWith(cm))
      .reduce((s, r) => s + r.n, 0);

  // THE SLABS THE SHEET DIVIDES BY: every distinct slab the press recorded,
  // each given the thickness the shared resolver finds for it wherever it was
  // stamped. Counting per distinct PRESS slab is what stops a station with
  // partial coverage (or none — see the type comment) from deciding the count.
  const pressSlabNos: Array<{ s: number }> = await prisma.$queryRaw`
    SELECT DISTINCT slab_number::float8 s FROM press
    WHERE batch_key = ${batchKey} AND slab_number IS NOT NULL`;
  const thicknessOf = await thicknessBySlab({ keys: [batchKey] });
  let slabs3cm = 0, slabs2cm = 0;
  for (const { s: n } of pressSlabNos) {
    const t = thicknessOf.get(Number(n));
    if (t === "3 cm") slabs3cm++;
    else if (t === "2 cm") slabs2cm++;
  }

  const press: Array<{ slabs: number; design: string | null; first: Date | null; last: Date | null }> =
    await prisma.$queryRaw`
      SELECT count(DISTINCT slab_number)::int slabs,
             mode() WITHIN GROUP (ORDER BY design_name) design,
             min(imported_at) first, max(imported_at) last
      FROM press WHERE batch_key = ${batchKey}`;

  const gritSilos = await loadGritSilos(batchKey, gritSiloKg);

  return {
    batchKey,
    batch: head[0].batch ?? batchKey,
    design: press[0]?.design ?? "(design not recorded)",
    resinKg: Number(head[0].resin_kg ?? 0),
    resinCycles: head[0].cycles,
    resinByTank: tanks.map((t) => ({
      tank: t.tank ?? "(no tank recorded)", cycles: t.cycles, kg: Number(t.kg ?? 0),
    })),
    gritCharges,
    gritSiloKg,
    gritNoSiloKg: Math.round(noSiloKg * 1000) / 1000,
    gritSilos,
    gritUnresolvedKg,
    fillerKg: Number(head[0].filler_kg ?? 0),
    mixerCharges: Number(head[0].charges ?? 0),
    runHours: runMs / 3_600_000,
    runStoppages: { count: stops, hours: stopMs / 3_600_000 },
    wallClockHours: wallMs / 3_600_000,
    slabs3cm,
    slabs2cm,
    jot3cm: pick("jot", "3cm"),
    jot2cm: pick("jot", "2cm"),
    pressSlabs: press[0]?.slabs ?? 0,
    firstPress: press[0]?.first ?? null,
    lastPress: press[0]?.last ?? null,
  };
}
