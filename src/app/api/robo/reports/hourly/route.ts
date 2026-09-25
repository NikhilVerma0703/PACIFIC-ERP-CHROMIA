import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { productionDateOf } from "@/lib/robo/productionDate";
import { absToDateTime, hourlyProduction, runBounds, type RunEnds } from "@/lib/robo/hourlyProduction";

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
 * Returns the hourly `series` and the `run` it covers — the first slab's In and
 * the last slab's Out as a date and a time each, which the chart's subtitle
 * names ("31/08/2026 (11:20) → 31/08/2026 (22:31)"). Both come from the one
 * placement (placeSlabs) the Total Production Time KPI also uses, so the
 * subtitle, the chart and the KPI name the same two instants.
 *
 * A blank batch is no chart: without a batch there is no single run whose start
 * and end define a timeline, so the series is empty and the screen says so.
 */
export async function GET(req: NextRequest) {
  const batchIds = await resolveBatchRecipeIds(req.nextUrl.searchParams.get("batch"));
  // null = no batch typed; [] = a batch typed that matches nothing. Either way
  // there is no run to chart.
  if (batchIds === null || batchIds.length === 0) {
    return NextResponse.json({ series: [], run: null });
  }

  const slabs = await prisma.roboProductionRecord.findMany({
    where: { batchRecipeId: { in: batchIds } },
    // Row order does not matter: placeSlabs orders the batch itself, by the
    // plant's physical slab number (then entry time, then id) — never by
    // serialNumber, which is mistyped on real runs (see slabSequence.ts).
    select: {
      id: true,
      slabNumber: true,
      createdAt: true,
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

  // One batch, one run: every setup of the batch is placed together, the same
  // set Reports' batch filter counts.
  const rows = slabs.map((s) => ({
    productionDate: productionDateOf(s),
    inTime: s.inTime,
    outTime: s.outTime,
    slabNumber: s.slabNumber,
    createdAtMs: s.createdAt.getTime(),
    id: s.id,
  }));

  const series = hourlyProduction(rows);
  const { firstIn, lastOut } = runBounds(rows);
  const run: RunEnds = {
    start: firstIn !== null ? absToDateTime(firstIn) : null,
    end: lastOut !== null ? absToDateTime(lastOut) : null,
  };

  return NextResponse.json({ series, run });
}
