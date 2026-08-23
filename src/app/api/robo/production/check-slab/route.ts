import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";

/**
 * GET /api/robo/production/check-slab?slabNumber=140748&excludeId=<id>
 *
 * Tells the entry form whether a slab number is still free, so the operator
 * finds out on blur instead of on save. `excludeId` is the record being
 * edited — without it a slab that keeps its own number would report itself as
 * a clash, which is why this parameter exists at all.
 *
 * A convenience for the UI only: POST /api/robo/production and
 * PATCH /api/robo/production/[id] enforce the same rule regardless, so a
 * form that skips this check still cannot create the duplicate.
 */
export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const slabNumber = req.nextUrl.searchParams.get("slabNumber")?.trim() || "";
  const excludeId = req.nextUrl.searchParams.get("excludeId")?.trim() || "";

  if (!slabNumber) return NextResponse.json({ available: true });

  const clash = await prisma.roboProductionRecord.findFirst({
    where: excludeId ? { slabNumber, NOT: { id: excludeId } } : { slabNumber },
    select: { id: true },
  });

  return NextResponse.json({ available: !clash });
}
