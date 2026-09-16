import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { productionDateOf } from "@/lib/robo/productionDate";
import { hourlyProduction } from "@/lib/robo/hourlyProduction";

// Live aggregation, never cached — a stale hourly series is how the same batch's
// chart would read differently at different times. Always computed fresh.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/robo/reports/hourly?batch=<batch number>
 *
 * The "Production Rate per Hour" line chart: slabs completed each hour across
 * the SELECTED BATCH's own run. Driven by the batch alone, NOT the date filter —
 * the timeline is the batch's actual duration (see hourlyProduction.ts), which a
 * date filter would cut short for a batch that ran past midnight.
 *
 * A blank batch is no chart: without a batch there is no single run whose start
 * and end define a timeline, so the series is empty and the screen says so.
 */
export async function GET(req: NextRequest) {
  const batchIds = await resolveBatchRecipeIds(req.nextUrl.searchParams.get("batch"));
  // null = no batch typed; [] = a batch typed that matches nothing. Either way
  // there is no run to chart.
  if (batchIds === null || batchIds.length === 0) {
    return NextResponse.json({ series: [] });
  }

  const slabs = await prisma.roboProductionRecord.findMany({
    where: { batchRecipeId: { in: batchIds } },
    // Order does not matter: hourlyProduction places each slab on its OWN stored
    // production date, so the series is the same however the rows arrive. (It no
    // longer reconstructs a day from serialNumber order — that heuristic drifted
    // batches onto the wrong dates; see hourlyProduction.ts.)
    select: {
      inTime: true,
      outTime: true,
      // Everything productionDateOf needs to resolve the slab's effective day —
      // its own per-slab date first (a batch past midnight), else the setup's,
      // else the shift's.
      productionDate: true,
      batchRecipe: { select: { productionDate: true } },
      shift: { select: { date: true } },
    },
  });

  const series = hourlyProduction(
    slabs.map((s) => ({
      productionDate: productionDateOf(s),
      inTime: s.inTime,
      outTime: s.outTime,
    })),
  );

  return NextResponse.json({ series });
}
