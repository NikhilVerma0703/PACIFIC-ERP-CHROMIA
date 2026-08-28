import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { attachQueueActivity } from "@/lib/fab/queueActivity";
import { isDroppedFromQueues } from "@/lib/fab/rejectPiece";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

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
      requirement: { select: { pieceLabel: true, rowLetter: true, po: { select: { poNumber: true } }, description: true, length: true, width: true, sinkModel: true } },
      slab: { select: { slabCode: true, colour: true } },
      pieceOperations: { select: { operationType: true, isCompleted: true, completedAt: true } },
    },
  });

  return Response.json(attachQueueActivity(
    pieces.filter(p => !isDroppedFromQueues(p.status)),
    "FABRICATION",
  ));
}
