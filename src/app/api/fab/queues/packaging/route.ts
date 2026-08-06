import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { isReadyForPackaging } from "@/lib/fab/routing";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

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
