import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { requireProcessSession } from "@/lib/fab/processSessionServer";
import { stampOperationWorker } from "@/lib/fab/stampWorker";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const userId = g.user.id as string;

  const { slabId, pieceIds } = await req.json();
  if (!slabId || !pieceIds?.length) return Response.json({ error: "slabId and pieceIds required" }, { status: 400 });

  const gate = await requireProcessSession("CUTTING");
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  const sess = gate.session;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const pieceId of pieceIds) {
      const op = await tx.fabOperation.create({
        data: {
          pieceId,
          operatorId:    userId,
          machineId:     sess.machineId,
          operationType: "CUTTING",
          status:        "COMPLETED",
          startTime:     now,
          endTime:       now,
        },
      });

      await stampOperationWorker(tx, op.id, sess.workerId, sess.shift);

      // Mark the FabPieceOperation complete, link to FabOperation
      await tx.fabPieceOperation.updateMany({
        where: { pieceId, operationType: "CUTTING", isCompleted: false },
        data:  { isCompleted: true, completedAt: now, operationId: op.id },
      });

      // Update piece status
      await tx.fabPiece.update({
        where: { id: pieceId },
        data:  { status: "CUT" },
      });
    }
  });

  return Response.json({ success: true });
}
