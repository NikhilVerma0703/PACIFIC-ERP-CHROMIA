// POST /api/fab/queues/start-op
// Body: { pieceId: string, operationType: string }
// Marks the piece operation as started AND creates a FabOperation linked
// to the operator's active machine so the CEO idle-detection has a direct
// machineId — not just session-time-overlap (which breaks with multiple
// operators on the same machine type).

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const { pieceId, operationType } = await req.json();
  if (!pieceId || !operationType)
    return Response.json({ error: "pieceId and operationType required" }, { status: 400 });

  // Look up the operator's current machine
  const machineSession = await prisma.fabMachineSession.findFirst({
    where: { userId, isActive: true },
    select: { machineId: true },
  });

  const pieceOp = await prisma.fabPieceOperation.findFirst({
    where: { pieceId, operationType, isCompleted: false },
    select: { id: true, operationId: true },
  });
  if (!pieceOp) return Response.json({ success: true, noop: true }); // no pending op found — client timer still runs but nothing recorded

  const now = new Date();

  // Create (or reuse) a FabOperation so machineId is recorded directly —
  // the CEO route uses op.operation?.machineId for per-machine idle tracking.
  if (pieceOp.operationId) {
    // Already linked — just refresh the start time
    await prisma.fabOperation.update({
      where: { id: pieceOp.operationId },
      data:  { startTime: now, status: "IN_PROGRESS",
                machineId: machineSession?.machineId ?? undefined },
    });
    await prisma.fabPieceOperation.update({
      where: { id: pieceOp.id },
      data:  { startedAt: now },
    });
  } else {
    // First start — create a FabOperation and link it
    const fabOp = await prisma.fabOperation.create({
      data: {
        pieceId,
        operatorId:    userId,
        machineId:     machineSession?.machineId ?? undefined,
        operationType: operationType as any,
        startTime:     now,
        status:        "IN_PROGRESS",
      },
    });
    await prisma.fabPieceOperation.update({
      where: { id: pieceOp.id },
      data:  { startedAt: now, operationId: fabOp.id },
    });
  }

  return Response.json({ success: true });
}
