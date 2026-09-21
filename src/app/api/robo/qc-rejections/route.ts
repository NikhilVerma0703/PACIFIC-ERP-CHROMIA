import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchingBatchRecipeIds } from "@/lib/robo/batchNo";
import { summariseRejections, type QcRow } from "@/lib/robo/qcRejection";
import { normalizeBatch } from "@/lib/normalizeBatch";

// Live, never cached — same reason as reference/summary: QC files verdicts all
// day, and a cached rejection count is how "that number was different an hour
// ago" happens.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/robo/qc-rejections?batch=<Batch Number>
 *
 * What QC did with a Robo batch: how many slabs the line produced, how many QC
 * has inspected, how many it rejected, and the faults it rejected them for.
 *
 * ── THE JOIN, WHICH IS THE ONLY INTERESTING PART ──────────────────────────
 * Two modules number the same batch differently and neither is wrong:
 *
 *   Robo    RoboBatchRecipe.batchNo   "D-1449", "D1448", sometimes "1449"
 *   QC      polish_qc.batch_key       "1449"   (normalizeBatch, series dropped)
 *
 * So the two sides are matched through each module's OWN rule rather than a
 * third one invented here:
 *
 *   · the Robo side by `batchNosMatch` (lib/robo/batchNo.ts), which folds case
 *     and hyphens and lets a bare number match a prefixed one, but keeps
 *     "A-1248" and "D-1248" apart;
 *   · the QC side by `normalizeBatch` (lib/normalizeBatch.ts), which is what
 *     wrote `batch_key` in the first place.
 *
 * Writing a single regex to bridge them would be a third spelling of the rule,
 * and the first time either module changed, this route would quietly disagree
 * with both. Verified against live Neon 2026-09-21: Robo "D-1449" → QC
 * batch_key "1449", 77 inspected, 2 rejected.
 *
 * READ-ONLY. This route touches nothing in the QC module — the brief was
 * explicit that we only fetch from it.
 */
export async function GET(req: NextRequest) {
  const batch = req.nextUrl.searchParams.get("batch")?.trim() || "";
  if (!batch) return NextResponse.json({ found: false });

  // ── the Robo side: how many slabs the line says it produced ───────────────
  const recipes = await prisma.roboBatchRecipe.findMany({ select: { id: true, batchNo: true } });
  const recipeIds = matchingBatchRecipeIds(batch, recipes);
  const produced = recipeIds.length
    ? await prisma.roboProductionRecord.count({ where: { batchRecipeId: { in: recipeIds } } })
    : 0;

  // THE ROBO SIDE MUST KNOW THE BATCH, or we do not look in QC at all.
  //
  // normalizeBatch strips a leading letter run, so a batch number the register
  // has never heard of collapses onto one it has: "ZZZ-999" normalises to "999"
  // and returned another batch's rejections under the number the user typed.
  // Nothing on the screen would have said so. This section analyses Robo-line
  // batches, so an unknown batch is "not found" rather than a lookup that
  // wanders into a neighbour.
  if (!recipeIds.length) return NextResponse.json({ found: false });

  // The batch number as the RECIPE spells it, which is what QC will have been
  // given — the operator may have typed the bare number.
  const recipeBatchNo = recipes.find((r) => r.id === recipeIds[0])?.batchNo ?? batch;

  // ── the QC side ───────────────────────────────────────────────────────────
  // batch_key is what normalizeBatch already stored, so this asks QC its own
  // question in its own terms. batch_number is matched too, for the older rows
  // written before batch_key existed.
  const key = normalizeBatch(recipeBatchNo) || normalizeBatch(batch);
  if (!key) return NextResponse.json({ found: false });

  const qc = await prisma.polishQc.findMany({
    where: { OR: [{ batchKey: key }, { batchNumber: recipeBatchNo }, { batchNumber: batch }] },
    select: { qualityGrade: true, qualityIssue: true },
  });

  // A batch the line produced but QC has not reached yet IS found — with
  // inspected 0 — because "QC has not got to it" and "no such batch" are
  // different answers and the screen says each of them differently.
  const summary = summariseRejections(qc as QcRow[], produced);
  return NextResponse.json({
    found: true,
    batchNo: recipeBatchNo,
    qcBatchKey: key,
    ...summary,
  });
}
