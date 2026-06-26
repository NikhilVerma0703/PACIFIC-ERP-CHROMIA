import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const pieces = await prisma.fabPiece.findMany({
    where: { polishRequired: true, polishingCompleted: false, status: { not: "PENDING" } },
    include: {
      project: { select: { projectCode: true, customerName: true } },
      drawing: { select: { drawingNumber: true } },
      requirement: { select: { pieceLabel: true, description: true, length: true, width: true } },
      slab: { select: { slabCode: true, colour: true } },
      pieceOperations: { where: { operationType: "CUTTING" } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Only show pieces that have been cut
  const ready = pieces.filter(p =>
    p.pieceOperations.some(op => op.isCompleted)
  );

  return Response.json(ready);
}
