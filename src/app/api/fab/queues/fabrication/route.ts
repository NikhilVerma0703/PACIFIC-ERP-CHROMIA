import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // fabrication unlocks when: sink not required OR sink completed
  const pieces = await prisma.fabPiece.findMany({
    where: {
      fabricationRequired: true,
      fabricationCompleted: false,
      status: { not: "PENDING" },
      OR: [
        { hasSink: false },
        { hasSink: true, sinkCompleted: true },
      ],
    },
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
