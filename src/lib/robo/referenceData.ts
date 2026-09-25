/**
 * Reference Sheet — the database half.
 *
 * Given ONE Design Name (any capitalisation), this finds the design's latest
 * production BATCH and returns the summary the Downloads "Reference Sheet"
 * section shows on screen.
 *
 * ── THE FOUR PRODUCTION FIGURES COME FROM REPORTS, NOT FROM HERE ──────────
 * Total Slabs Produced, Total Production Time, Total Delays and Avg Slabs/hour
 * are NOT calculated in this file. They are computeReportSummary() — the very
 * function the Reports summary route runs — called for the batch through
 * Reports' own batch filter (resolveBatchRecipeIds), with no date filter,
 * which is what Reports shows for a batch in its default "All" mode. So the
 * sheet shows exactly the figures Reports shows for that batch and cannot drift
 * from them (owner's requirement, 2026-09-25).
 *
 * ── WHY THE WHOLE BATCH, NOT THE SETUP ROWS THAT MATCH THE NAME ───────────
 * Design name lives on the setup row (RoboBatchRecipe), and one batch is often
 * several setup rows — a new row per shift, per day, per thickness change —
 * each with the design typed afresh. Batch D-1445 has rows typed "calcatta
 * gold" and "CALCATTA GOLD". Counting only the rows whose name matched the
 * search read 322 slabs (or 37, depending on the spelling searched) where the
 * batch holds 359. So the design's name is used for ONE thing only — finding
 * which batch is its latest, case-insensitively — and from there the batch is
 * taken whole, exactly as Reports takes it.
 *
 * ── WHAT STAYS BOUNDED BY THE DESIGN ──────────────────────────────────────
 * The Robo programs. A batch can be mixed — D-1423 carries AUREATE and Roots
 * setups — and the operator reading this is about to set the Robos up for THIS
 * design, so only this design's setups in the batch supply the programs.
 *
 * No wall clock is read anywhere — every value is a deterministic function of
 * the stored rows, so the same batch always yields the same sheet.
 */

import { prisma } from "@/lib/prisma";
import { productionDateOf } from "@/lib/robo/productionDate";
import { machineLabel } from "@/lib/robo/utils";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { computeReportSummary } from "@/lib/robo/reportSummary";
import {
  designMatchKey, latestProduced, compareProduced, robotDelaysByDuration, type RobotDelayRow,
} from "@/lib/robo/referenceSheet";

/** Robo machine order for listing the programs, matching every other Robo export
 *  (Robo1→Robo4 = Roycut-1, Roymix, Roycut-2, Roycut-3). */
const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];

export interface ReferenceProgram {
  robo: string;
  program: string;
}

/** One Robot Delay row: code, description, the Robos responsible, the combined
 *  minutes of every entry of that code and how many times it was logged. */
export type ReferenceRobotDelay = RobotDelayRow;

export interface ReferenceSummary {
  /** The latest setup's own stored design name, for display — the search
   *  matches on the capitalisation- and thickness-free key. */
  designName: string;
  batchNo: string | null;
  /** Production date of the batch's first slab (yyyy-mm-dd), or "" if unknown. */
  productionDate: string;
  thickness: number | null;
  /* ── Reports' own figures for this batch (computeReportSummary) ── */
  totalSlabs: number;
  /** first In → last Out, minutes; null when nothing has completed. */
  productionTimeMinutes: number | null;
  /** SUM of the batch's delay durations, as Reports shows it. */
  totalDelayMins: number;
  /** Total Slabs ÷ production time in hours, delays left in, as Reports shows it. */
  avgSlabsPerHour: number | null;
  /* ── the rest of the sheet ── */
  /** Programs of this design's Robos in the batch, in Robo order. */
  programs: ReferenceProgram[];
  /** The batch's Robot Delays, one row per code, LONGEST TOTAL DURATION FIRST;
   *  empty when none occurred. */
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

  // 1) The design's setups — any capitalisation, thickness ignored. designName
  //    carries no index that would help here and the fold cannot be expressed in
  //    SQL, so the match is done in JS over the (small) set of setup names.
  const recipes = await prisma.roboBatchRecipe.findMany({
    select: { id: true, designName: true, batchNo: true },
  });
  const matchIds = recipes
    .filter((r) => designMatchKey(r.designName) === key)
    .map((r) => r.id);
  if (matchIds.length === 0) return null;

  // 2) Its latest production: the most recently produced slab of any of those
  //    setups — by production date, then In time, then the order it was
  //    entered, the precedence the register sorts by. That slab's batch is the
  //    design's latest production batch.
  const designSlabs = await prisma.roboProductionRecord.findMany({
    where: { batchRecipeId: { in: matchIds } },
    select: {
      batchRecipeId: true,
      productionDate: true,
      inTime: true,
      thickness: true,
      createdAt: true,
      batchRecipe: { select: { productionDate: true } },
      shift: { select: { date: true } },
    },
  });
  const latest = latestProduced(
    designSlabs.map((s) => ({
      slab: s,
      productionDate: productionDateOf(s),
      inTime: s.inTime,
      createdAtMs: s.createdAt.getTime(),
    })),
  );
  const runId = latest?.slab.batchRecipeId;
  if (!runId) return null;

  // 3) The batch, taken WHOLE through Reports' own batch filter — every setup
  //    row carrying that batch number, however each typed the design. A setup
  //    with no batch number cannot be grouped by one, so it is its own run.
  const latestRecipe = recipes.find((r) => r.id === runId);
  const runBatchNo = (latestRecipe?.batchNo ?? "").trim();
  const resolved = runBatchNo ? await resolveBatchRecipeIds(runBatchNo) : null;
  const batchIds = resolved && resolved.length ? resolved : [runId];
  const batchIdSet = new Set(batchIds);

  // 4) THE FOUR FIGURES: Reports' calculation for this batch, unaltered.
  const report = await computeReportSummary({ batchIds });

  // 5) The batch's first slab → the production date shown. The same slab set
  //    the figures count, so the date is the start of the production they
  //    measure. A slab whose date cannot be resolved does not set it.
  const batchSlabs = await prisma.roboProductionRecord.findMany({
    where: { batchRecipeId: { in: batchIds } },
    select: {
      productionDate: true,
      inTime: true,
      createdAt: true,
      batchRecipe: { select: { productionDate: true } },
      shift: { select: { date: true } },
    },
  });
  const dated = batchSlabs
    .map((s) => ({ productionDate: productionDateOf(s), inTime: s.inTime, createdAtMs: s.createdAt.getTime() }))
    .filter((s) => s.productionDate)
    .sort(compareProduced);
  const productionDate = dated[0]?.productionDate ?? "";

  // 6) Programs — THIS design's setups within the batch, newest first, so a
  //    mixed batch never lends another design's programs.
  const designRunIds = matchIds.filter((id) => batchIdSet.has(id));
  const runRecipes = await prisma.roboBatchRecipe.findMany({
    where: { id: { in: designRunIds } },
    include: { shift: true, entries: { include: { machine: true } } },
    orderBy: { createdAt: "desc" },
  });
  const recipe = runRecipes.find((r) => r.id === runId) ?? runRecipes[0];
  if (!recipe) return null;
  const runSlabs = designSlabs.filter((s) => s.batchRecipeId && batchIdSet.has(s.batchRecipeId));

  // Programs of the Robos actually used = setup entries that carry a program name,
  // in Robo order. A configured machine with no program set was not really run.
  // Across every setup of the design in the batch, de-duplicated on Robo+program.
  // A batch run over two shifts is set up twice, usually identically — listing it
  // twice would read as two runs. When a Robo genuinely ran two different programs
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

  // 7) Robot Delays — every delay of the batch (the SAME rows Reports' Total
  //    Delays sums for it), robot codes only (C1…C20, "G — Robot Delays"), one
  //    row per code with its minutes summed and its Robos unioned, LONGEST TOTAL
  //    DURATION FIRST. machineName can be several Robos comma-joined.
  const delays = await prisma.roboDelayLog.findMany({
    where: { productionRecord: { batchRecipeId: { in: batchIds } } },
    select: {
      durationMinutes: true,
      machineName: true,
      delayCode: { select: { code: true, description: true, category: true } },
    },
  });
  const robotDelays = robotDelaysByDuration(
    delays.map((d) => ({
      code: d.delayCode.code,
      description: d.delayCode.description,
      category: d.delayCode.category,
      minutes: d.durationMinutes,
      robos: (d.machineName ?? "").split(",").map((raw) => machineLabel(raw.trim())).filter(Boolean),
    })),
  );

  return {
    designName: recipe.designName || designInput.trim(),
    batchNo: recipe.batchNo,
    productionDate,
    thickness,
    totalSlabs: report.totalSlabs,
    productionTimeMinutes: report.productionTimeMinutes,
    totalDelayMins: report.totalDelayMins,
    avgSlabsPerHour: report.avgSlabsPerHour,
    programs,
    robotDelays,
  };
}
