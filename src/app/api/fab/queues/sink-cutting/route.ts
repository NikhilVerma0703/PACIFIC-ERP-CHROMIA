import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const pieces = await prisma.fabPiece.findMany({
    where: { hasSink: true, sinkCompleted: false, status: { not: "PENDING" } },
    include: {
      project: { select: { projectCode: true, customerName: true } },
      drawing: { select: { drawingNumber: true } },
      requirement: { select: { pieceLabel: true, description: true, length: true, width: true, sinkModel: true, sinkCuts: true } },
      slab: { select: { slabCode: true, colour: true } },
      pieceOperations: { where: { operationType: "CUTTING" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const ready = pieces.filter(p => p.pieceOperations.some(op => op.isCompleted));
  return Response.json(ready);
}
