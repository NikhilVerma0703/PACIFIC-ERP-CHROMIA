import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { latestNumericSlab, nextSerialNumber, nextSlabNumber } from "@/lib/robo/nextNumbers";

export const dynamic = "force-dynamic";

/**
 * GET /api/robo/production/next-number
 *
 * What the entry form should offer for the next slab: `{ serialNumber, slabNumber }`.
 *
 * Both are counted across the WHOLE register, not the active shift. The form
 * used to work them out in the browser from the active shift's records, and a
 * shift row is created silently once per day — so the S.No. restarted at 1 every
 * morning and the slab number went blank. Neither is a per-day count.
 *
 * `serialNumber` uses an aggregate max rather than `orderBy: { serialNumber:
 * "desc" }`: the column is nullable, Postgres sorts DESC with NULLS FIRST, and
 * one NULL would otherwise make the answer 1 for good.
 *
 * `slabNumber` counts from the most recent numeric slab number and then skips
 * anything already taken, so the suggestion can never be a number the save would
 * reject as a duplicate. It returns "" when there is nothing to count from —
 * the form leaves the field for the operator rather than inventing a first one.
 *
 * Read-only, and gated by middleware's /api/robo rule like every other route here.
 */
export async function GET() {
  const [agg, recent] = await Promise.all([
    prisma.roboProductionRecord.aggregate({ _max: { serialNumber: true } }),
    prisma.roboProductionRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { slabNumber: true },
    }),
  ]);

  const serialNumber = nextSerialNumber(agg._max.serialNumber);
  const latest = latestNumericSlab(recent.map((r) => r.slabNumber));

  // The candidates a suggestion could land on, so nextSlabNumber can skip the
  // ones that exist. Bounded by the same limit the helper walks.
  let slabNumber = "";
  if (latest) {
    const width = latest.length;
    const start = BigInt(latest) + 1n;
    const window = Array.from({ length: 25 }, (_, i) => String(start + BigInt(i)).padStart(width, "0"));
    const clashes = await prisma.roboProductionRecord.findMany({
      where: { slabNumber: { in: window } },
      select: { slabNumber: true },
    });
    slabNumber = nextSlabNumber(latest, new Set(clashes.map((c) => c.slabNumber)));
  }

  return NextResponse.json({ serialNumber, slabNumber });
}
