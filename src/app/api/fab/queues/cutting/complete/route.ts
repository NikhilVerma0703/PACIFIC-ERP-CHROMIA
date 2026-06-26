import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const userId = g.user.id as string;

  const { slabId, pieceIds } = await req.json();
  if (!slabId || !pieceIds?.length) return Response.json({ error: "slabId and pieceIds required" }, { status: 400 });

  // Get current user's active machine session for machineId
  const machineSession = await prisma.fabMachineSession.findFirst({
    where: { userId, isActive: true },
    select: { machineId: true },
  });
  const machineId = machineSession?.machineId ?? null;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const pieceId of pieceIds) {
      // Create FabOperation so we can track operator + machine
      const op = await tx.fabOperation.create({
        data: {
          pieceId,
          operatorId:    userId,
          machineId:     machineId ?? undefined,
          operationType: "CUTTING",
          status:        "COMPLETED",
          startTime:     now,
          endTime:       now,
        },
      });

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
