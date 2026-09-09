import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { attachQueueActivity } from "@/lib/fab/queueActivity";
import { isDroppedFromQueues } from "@/lib/fab/rejectPiece";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const pieces = await prisma.fabPiece.findMany({
    where: { hasSink: true, sinkCompleted: false, status: { not: "PENDING" } },
    include: {
      project: { select: { projectCode: true, customerName: true } },
      drawing: { select: { drawingNumber: true } },
      requirement: { select: { pieceLabel: true, rowLetter: true, po: { select: { poNumber: true } }, description: true, length: true, width: true, dimUnit: true, sinkModel: true, sinkCuts: true } },
      slab: { select: { slabCode: true, colour: true } },
      pieceOperations: { select: { operationType: true, isCompleted: true, completedAt: true } },
    },
  });

  const ready = pieces.filter(p =>
    !isDroppedFromQueues(p.status) &&
    p.pieceOperations.some(op => op.operationType === "CUTTING" && op.isCompleted)
  );
  return Response.json(attachQueueActivity(ready, "SINK_CUTTING"));
}
