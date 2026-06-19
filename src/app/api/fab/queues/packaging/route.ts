import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

function isReadyForPackaging(p: { polishRequired: boolean; polishingCompleted: boolean; hasSink: boolean; sinkCompleted: boolean; fabricationRequired: boolean; fabricationCompleted: boolean }): boolean {
  return (!p.polishRequired || p.polishingCompleted)
    && (!p.hasSink || p.sinkCompleted)
    && (!p.fabricationRequired || p.fabricationCompleted);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const pieces = await prisma.fabPiece.findMany({
    where: { status: { not: "PACKAGED" } },
    include: {
      project: { select: { projectCode: true, customerName: true } },
      drawing: { select: { drawingNumber: true } },
      requirement: { select: { pieceLabel: true, description: true, length: true, width: true } },
      slab: { select: { slabCode: true, colour: true } },
      pieceOperations: { where: { operationType: "CUTTING" } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Must be cut AND pass isReadyForPackaging
  const ready = pieces.filter(p =>
    p.pieceOperations.some(op => op.isCompleted) && isReadyForPackaging(p)
  );

  return Response.json(ready);
}
