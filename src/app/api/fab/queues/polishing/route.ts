import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { attachQueueActivity } from "@/lib/fab/queueActivity";
import { isDroppedFromQueues } from "@/lib/fab/rejectPiece";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const pieces = await prisma.fabPiece.findMany({
    where: { polishRequired: true, polishingCompleted: false, status: { not: "PENDING" } },
    include: {
      project: { select: { projectCode: true, customerName: true } },
      drawing: { select: { drawingNumber: true } },
      // SHAPE, THICKNESS AND THE ROW'S EDGE DECISION travel with the piece for
      // one reason: scripts/0067 lets the operator push a piece to the hand
      // bench when this machine cannot do it, and the dialog that asks what
      // that costs needs the outline to draw, the stone to rate it at, and the
      // edges the row already has so it opens on that rather than on a blank
      // piece.
      //
      // requirementId is NOT listed — this is an `include`, not a `select`, so
      // every scalar column of fab_piece is already on the row. Naming it here
      // is a type error, which is how this comment came to exist.
      requirement: {
        select: {
          pieceLabel: true, rowLetter: true, po: { select: { poNumber: true } },
          description: true, length: true, width: true, dimUnit: true,
          shapeType: true, finishedEdges: true, edgeFaces: true,
        },
      },
      slab: { select: { slabCode: true, colour: true, thickness: true } },
      pieceOperations: { select: { operationType: true, isCompleted: true, completedAt: true } },
    },
  });

  const ready = pieces.filter(p =>
    !isDroppedFromQueues(p.status) &&
    p.pieceOperations.some(op => op.operationType === "CUTTING" && op.isCompleted)
  );

  return Response.json(attachQueueActivity(ready, "POLISHING"));
}
