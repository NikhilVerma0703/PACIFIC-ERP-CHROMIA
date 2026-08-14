import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { entryCreateData, setupScalarData, type SetupEntryInput } from "@/lib/robo/setupMasters";
import { registerTypedMasters, resolveDesignId } from "@/lib/robo/setupMastersDb";

export async function GET(req: NextRequest) {
  const shiftId = req.nextUrl.searchParams.get("shiftId");
  const where = shiftId ? { shiftId } : {};
  const data = await prisma.roboBatchRecipe.findMany({
    where,
    include: {
      design: true,
      program: true,
      entries: { include: { machine: true } },
      _count: { select: { productionRecords: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(data);
}

/**
 * Creates a production setup for a shift.
 *
 * The design lookup, the master-list registration and the per-machine row
 * shaping all moved into the shared setup helper so the in-place edit in
 * [id]/route.ts does them identically — see src/lib/robo/setupMasters.ts.
 * Behaviour is unchanged apart from the master registration, which the ERP had
 * never carried and which the design presets make necessary (the reason is
 * spelled out on registerTypedMasters).
 *
 * No role gate here beyond middleware's /api/robo cap: creating a setup is the
 * tablet's core job. The EDIT is the one that needed a decision, and it makes
 * it in canEditRoboSetup().
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const entries: SetupEntryInput[] = body.entries || [];

    const designId = await resolveDesignId(body.designName);
    await registerTypedMasters(entries, designId);

    const recipe = await prisma.roboBatchRecipe.create({
      data: {
        shiftId:     body.shiftId,
        designId:    designId,
        programName: "", // no longer global — stored per machine entry
        ...setupScalarData(body),
        entries:     { create: entryCreateData(entries) },
      },
      include: { entries: { include: { machine: true } } },
    });
    return NextResponse.json(recipe, { status: 201 });
  } catch (err) {
    console.error("RoboBatchRecipe POST error:", err);
    return NextResponse.json({ error: "Failed to create batch recipe" }, { status: 500 });
  }
}
