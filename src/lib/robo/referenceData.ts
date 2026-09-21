/**
 * Reference Sheet — the database half.
 *
 * Given ONE Design Name, this finds the design's latest production run and returns
 * the one-page summary the Downloads "Reference Sheet" section previews and the
 * Excel export writes. Both callers go through here so the number the operator sees
 * on screen and the number in the file can never be computed two different ways.
 *
 * "Latest run" is a single RoboBatchRecipe — the recipe of the most recently
 * produced slab whose design matches (thickness ignored, designMatchKey). Every
 * figure is then taken over exactly that recipe's slabs, with the SAME helpers the
 * Reports summary uses, so Total Slabs / Total Production Time / Total Delays equal
 * what Reports shows when filtered to that run:
 *
 *   • Total Slabs        — a plain count of the run's slabs (no status filter, as
 *                          Reports does not filter one either).
 *   • Total Production   — productionSpanMinutes: earliest In → latest Out, dated
 *     Time                 per slab so a run past midnight measures a real span.
 *   • Total Delays       — SUM of every delay's stored durationMinutes, matching
 *                          Reports (overlaps counted twice, by design).
 *   • Avg Slabs/hour     — the Reference-Sheet formula, delays SUBTRACTED:
 *                          Total Slabs ÷ (span − actual delay time), where the
 *                          actual delay time is the UNION of the delay intervals
 *                          (mergedDelayMinutes) so overlapping downtime is removed
 *                          once. This is the one figure that intentionally differs
 *                          from the Reports KPI (which leaves delays in).
 *
 * No wall clock is read anywhere — every value is a deterministic function of the
 * stored rows, so the same run always yields the same sheet.
 */

import { prisma } from "@/lib/prisma";
import { productionDateOf, delayProductionDateOf } from "@/lib/robo/productionDate";
import { productionSpanMinutes, stampMinutes } from "@/lib/robo/productionSpan";
import { machineLabel } from "@/lib/robo/utils";
import { designMatchKey, mergedDelayMinutes, avgSlabsPerHourNet, isRobotDelayCode } from "@/lib/robo/referenceSheet";
import { batchNosMatch } from "@/lib/robo/batchNo";

/** Robo machine order for listing the programs, matching every other Robo export
 *  (Robo1→Robo4 = Roycut-1, Roymix, Roycut-2, Roycut-3). */
const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];

/** The trailing number of a delay code ("C13" → 13), so robot delays list in
 *  master-list order (C1, C2, … C20) rather than by duration. */
function codeNum(code: string): number {
  const m = /(\d+)\s*$/.exec(code);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export interface ReferenceProgram {
  robo: string;
  program: string;
}

export interface ReferenceRobotDelay {
  code: string;
  description: string;
  /** All Robos responsible across every entry of this code, e.g. ["Robo1","Robo4"]. */
  robos: string[];
  /** Combined duration of every entry of this code, in minutes. */
  minutes: number;
  events: number;
}

export interface ReferenceSummary {
  /** The matched run's own stored design name (e.g. "Costa 2 cm"), for display
   *  and the file name — the search matches on the thickness-stripped base. */
  designName: string;
  batchNo: string | null;
  /** Production date of the first/starting slab (yyyy-mm-dd), or "" if unknown. */
  productionDate: string;
  thickness: number | null;
  totalSlabs: number;
  /** first In → last Out, minutes; null when nothing has completed. */
  productionTimeMinutes: number | null;
  /** Reports figure: SUM of delay durations (overlaps counted twice). */
  totalDelayMins: number;
  /** UNION of delay intervals — the actual downtime taken off the Avg denominator. */
  actualDelayMins: number;
  /** Total Slabs ÷ (span − actualDelayMins); null when there is no net run time. */
  avgSlabsPerHour: number | null;
  /** Programs of the Robos actually set up for the run, in Robo order. */
  programs: ReferenceProgram[];
  /** Robot-category (G) delays that occurred in the run; empty when none did. */
  robotDelays: ReferenceRobotDelay[];
}

/**
 * Build the Reference Sheet summary for a design, or null when the design has no
 * production on record (unknown design, or known but never run) — the caller turns
 * null into "No previous production record found".
 */
export async function buildReferenceSummary(designInput: string): Promise<ReferenceSummary | null> {
  const key = designMatchKey(designInput);
  if (!key) return null;

  // 1) Every recipe whose design matches, thickness ignored. designName carries no
  //    index that would help here and the strip cannot be expressed in SQL, so the
  //    match is done in JS over the (small) set of recipe names.
  const recipes = await prisma.roboBatchRecipe.findMany({
    select: { id: true, designName: true, batchNo: true },
  });
  const matchIds = recipes
    .filter((r) => designMatchKey(r.designName) === key)
    .map((r) => r.id);
  if (matchIds.length === 0) return null;

  // 2) The latest slab across those recipes decides the run: its recipe is "the
  //    latest production run". Latest by production date, then In time, then the
  //    insertion order — the same precedence the register sorts by.
  const slabs = await prisma.roboProductionRecord.findMany({
    where: { batchRecipeId: { in: matchIds } },
    select: {
      batchRecipeId: true,
      productionDate: true,
      inTime: true,
      outTime: true,
      thickness: true,
      createdAt: true,
      batchRecipe: { select: { productionDate: true } },
      shift: { select: { date: true } },
    },
  });
  if (slabs.length === 0) return null;

  const sortKey = (s: (typeof slabs)[number]) =>
    [productionDateOf(s), s.inTime ?? "", s.createdAt.getTime()] as const;
  let latest = slabs[0];
  let latestKey = sortKey(latest);
  for (const s of slabs) {
    const k = sortKey(s);
    if (k[0] > latestKey[0] || (k[0] === latestKey[0] && (k[1] > latestKey[1] || (k[1] === latestKey[1] && k[2] > latestKey[2])))) {
      latest = s;
      latestKey = k;
    }
  }
  const runId = latest.batchRecipeId;
  if (!runId) return null;

  // 3) THE RUN IS THE BATCH, NOT ONE SETUP ROW.
  //
  // This counted a single batchRecipeId, and that is why the sheet was wrong in
  // two places at once. `RoboBatchRecipe` is one SETUP: a batch that runs across
  // two shifts or past midnight is entered twice and gets two rows with the same
  // batchNo. Measured on live Neon 2026-09-21: D-1449 has 2 setup rows over 344
  // slabs, D-1445 2 over 322, D-1425 3 over 235. Scoping to one row therefore
  // under-reported Total Slabs AND silently dropped every Robot Delay logged
  // against the other rows' slabs — the two separate complaints in the brief are
  // one bug, and fixing it here fixes both.
  //
  // batchNosMatch is the register's own rule (lib/robo/batchNo.ts): case and
  // hyphens fold, "1449" matches "D-1449", but "A-1248" and "D-1248" stay two
  // batches. A setup with NO batch number cannot be grouped by one, so it falls
  // back to being its own run — which is exactly the old behaviour, kept for the
  // rows that genuinely have nothing to group on.
  // AND THE DESIGN STILL BOUNDS IT. Grouping on batchNo alone was wrong and the
  // live data said so immediately: batch D-1423 carries setups for AUREATE and
  // for Roots, so "AUREATE's latest run" listed Roots_T4_NEW among its programs
  // and would have counted Roots' delays as AUREATE's. A batch can be mixed —
  // the register has a split-a-mixed-batch flow for exactly that — so the run
  // is (this batch AND this design), never the batch alone.
  const matchIdSet = new Set(matchIds);
  const latestRecipe = recipes.find((r) => r.id === runId);
  const runBatchNo = (latestRecipe?.batchNo ?? "").trim();
  const runIds = runBatchNo
    ? recipes.filter((r) => matchIdSet.has(r.id) && batchNosMatch(runBatchNo, r.batchNo)).map((r) => r.id)
    : [runId];
  const runIdSet = new Set(runIds);

  const runSlabs = slabs.filter((s) => s.batchRecipeId && runIdSet.has(s.batchRecipeId));

  // EVERY setup of the run, newest last, so the programs below cover the whole
  // batch and not just whichever shift happened to be entered last.
  const runRecipes = await prisma.roboBatchRecipe.findMany({
    where: { id: { in: runIds } },
    include: { shift: true, entries: { include: { machine: true } } },
    orderBy: { createdAt: "desc" },
  });
  const recipe = runRecipes.find((r) => r.id === runId) ?? runRecipes[0];
  if (!recipe) return null;

  const delays = await prisma.roboDelayLog.findMany({
    // Every setup row of the batch, for the reason above — a delay logged on the
    // second shift's slabs belongs to this run as much as the first shift's.
    where: { productionRecord: { batchRecipeId: { in: runIds } } },
    select: {
      durationMinutes: true,
      startTime: true,
      machineName: true,
      delayCode: { select: { code: true, description: true, category: true } },
      productionRecord: {
        select: { productionDate: true, batchRecipe: { select: { productionDate: true } } },
      },
      shift: { select: { date: true } },
    },
  });

  // ── The figures ──────────────────────────────────────────────────────────
  const totalSlabs = runSlabs.length;

  const productionTimeMinutes = productionSpanMinutes(
    runSlabs.map((s) => ({ productionDate: productionDateOf(s), inTime: s.inTime, outTime: s.outTime })),
  );

  // First/starting slab's production date: earliest by (date, In time).
  const firstSlab = [...runSlabs].sort((a, b) => {
    const da = productionDateOf(a);
    const db = productionDateOf(b);
    if (da !== db) return da < db ? -1 : 1;
    return (a.inTime ?? "").localeCompare(b.inTime ?? "");
  })[0];
  const productionDate = firstSlab ? productionDateOf(firstSlab) : "";

  const totalDelayMins = delays.reduce((sum, d) => sum + (Number.isFinite(d.durationMinutes) ? d.durationMinutes : 0), 0);

  // Actual downtime = union of delay intervals, each delay's clock start paired
  // with its own production date so overlaps and midnight are handled right.
  const actualDelayMins = mergedDelayMinutes(
    delays.map((d) => ({
      startAbs: stampMinutes(delayProductionDateOf(d), d.startTime),
      minutes: d.durationMinutes,
    })),
  );

  const avgSlabsPerHour = avgSlabsPerHourNet(totalSlabs, productionTimeMinutes, actualDelayMins);

  // Programs of the Robos actually used = setup entries that carry a program name,
  // in Robo order. A configured machine with no program set was not really run.
  // Across every setup of the batch, de-duplicated on Robo+program. A batch run
  // over two shifts is set up twice, usually identically — listing it twice
  // would read as two runs. When a Robo genuinely ran two different programs
  // across the shifts, BOTH are listed, because that is a real fact about the
  // run and hiding it would misdescribe what produced these slabs.
  // De-duplicated on a FOLDED key, because the register types one program many
  // ways: "Calcatta gold zz6", "Calcatta _gold_zz6" and "CALACATTA GOLD ZZ6"
  // are one program and listing three reads as three. Same fold the batch
  // numbers use (case and non-alphanumerics), and the FIRST spelling seen wins
  // — the setups are read newest-first below, so that is the most recent one.
  const programKey = (robo: string, program: string) =>
    `${robo}|${program.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  // A SETUP THAT PRODUCED NOTHING WAS NOT A RUN, and the heaviest one leads.
  // Batch D-1423 has three AUREATE setups: one with 0 slabs, one with 1, and
  // one with 300. Listing all three equally put a setup nobody produced from
  // beside the one that made the batch, and newest-first led with neither. The
  // operator reading this is about to set the Robos up again, so the programs
  // that actually made 300 slabs must come first. Empty setups drop out.
  const slabsPerRecipe = new Map<string, number>();
  for (const sl of runSlabs) {
    if (sl.batchRecipeId) slabsPerRecipe.set(sl.batchRecipeId, (slabsPerRecipe.get(sl.batchRecipeId) ?? 0) + 1);
  }
  const productiveRecipes = runRecipes
    .filter((r) => (slabsPerRecipe.get(r.id) ?? 0) > 0)
    .sort((a, b) => (slabsPerRecipe.get(b.id) ?? 0) - (slabsPerRecipe.get(a.id) ?? 0));
  // ...unless NONE of them recorded a slab against a setup, in which case fall
  // back to every setup rather than showing an empty table.
  const programSources = productiveRecipes.length ? productiveRecipes : runRecipes;

  const seenProgram = new Set<string>();
  const programs: ReferenceProgram[] = programSources
    .flatMap((r) => r.entries)
    .filter((e) => (e.programName ?? "").trim())
    .sort((a, b) => MACHINE_ORDER.indexOf(a.machine.name) - MACHINE_ORDER.indexOf(b.machine.name))
    .map((e) => ({ robo: machineLabel(e.machine.name), program: (e.programName as string).trim() }))
    .filter((p) => {
      const k = programKey(p.robo, p.program);
      if (seenProgram.has(k)) return false;
      seenProgram.add(k);
      return true;
    });

  // Thickness: the run's setup value, falling back to the first slab that carries
  // its own (a batch that changed thickness mid-run records it per slab).
  const thickness =
    recipe.thickness ?? runSlabs.map((s) => s.thickness).find((t) => t !== null && t !== undefined) ?? null;

  // Robot delays = every delay whose CODE is a robot code (C1…C20, the "G — Robot
  // Delays" master section) — identified by the code, not the stored category,
  // which was blank/inconsistent on old rows and left this row empty. Grouped by
  // code so a code that occurred on several slabs is ONE row: its durations summed,
  // the Robos responsible across all of them unioned (machineName can be several
  // Robos comma-joined), ordered C1…C20.
  const roboNum = (label: string) => {
    const m = /(\d+)/.exec(label);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const robotByCode = new Map<
    string,
    { code: string; description: string; minutes: number; events: number; robos: Set<string> }
  >();
  for (const d of delays) {
    const code = d.delayCode.code;
    if (!isRobotDelayCode(code) && d.delayCode.category !== "ROBOT") continue;
    let row = robotByCode.get(code);
    if (!row) {
      row = { code, description: d.delayCode.description, minutes: 0, events: 0, robos: new Set<string>() };
      robotByCode.set(code, row);
    }
    row.minutes += Number.isFinite(d.durationMinutes) ? d.durationMinutes : 0;
    row.events += 1;
    for (const raw of (d.machineName ?? "").split(",")) {
      const lbl = machineLabel(raw.trim());
      if (lbl) row.robos.add(lbl);
    }
  }
  const robotDelays: ReferenceRobotDelay[] = [...robotByCode.values()]
    .map((r) => ({
      code: r.code,
      description: r.description,
      robos: [...r.robos].sort((a, b) => roboNum(a) - roboNum(b)),
      minutes: r.minutes,
      events: r.events,
    }))
    .sort((a, b) => codeNum(a.code) - codeNum(b.code));

  return {
    designName: recipe.designName || designInput.trim(),
    batchNo: recipe.batchNo,
    productionDate,
    thickness,
    totalSlabs,
    productionTimeMinutes,
    totalDelayMins,
    actualDelayMins,
    avgSlabsPerHour,
    programs,
    robotDelays,
  };
}
