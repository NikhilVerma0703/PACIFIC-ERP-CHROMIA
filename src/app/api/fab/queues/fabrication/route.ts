import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // fabrication unlocks when sinkCompleted=true
  const pieces = await prisma.fabPiece.findMany({
    where: { fabricationRequired: true, sinkCompleted: true, fabricationCompleted: false },
    include: {
      project: { select: { projectCode: true, customerName: true } },
      drawing: { select: { drawingNumber: true } },
      requirement: { select: { pieceLabel: true, description: true, length: true, width: true, sinkModel: true } },
      slab: { select: { slabCode: true, colour: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(pieces);
}
