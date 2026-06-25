// POST /api/fab/assign-qc-slab
// Body: { fabSlabId: string, pacificQcId: string | null }
// Links a physical QC slab to a FabSlab (or clears it if null).

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Standard Pacific slab: 137 x 79 inches
const SLAB_L_MM = 137 * 25.4; // 3479.8 mm
const SLAB_W_MM = 79  * 25.4; // 2006.6 mm

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(session?.user as any)?.fabRole)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { fabSlabId, pacificQcId } = await req.json();
  if (!fabSlabId) return Response.json({ error: "fabSlabId required" }, { status: 400 });

  if (!pacificQcId) {
    await prisma.fabSlab.update({
      where: { id: fabSlabId },
      data:  { pacificQcId: null, colour: null },
    });
    return Response.json({ success: true, cleared: true });
  }

  const qc = await prisma.polishQc.findUnique({
    where:  { id: pacificQcId },
    select: { id: true, slabNumber: true, design: true, slabThickness: true, qualityGrade: true },
  });
  if (!qc) return Response.json({ error: "QC slab not found" }, { status: 404 });

  await prisma.fabSlab.update({
    where: { id: fabSlabId },
    data: {
      pacificQcId: qc.id,
      colour:      qc.design ?? null,
      length:      SLAB_L_MM,
      width:       SLAB_W_MM,
      totalArea:   SLAB_L_MM * SLAB_W_MM,
    },
  });

  return Response.json({
    success:      true,
    slabCode:     String(qc.slabNumber),
    colour:       qc.design,
    qualityGrade: qc.qualityGrade,
  });
}
