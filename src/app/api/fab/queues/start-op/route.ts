import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { isFabProcessType } from "@/lib/fab/processSession";
import { requireProcessSession } from "@/lib/fab/processSessionServer";
import { stampOperationWorker } from "@/lib/fab/stampWorker";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const userId = g.user.id as string;

  const { pieceId, operationType } = await req.json();
  if (!pieceId || !operationType)
    return Response.json({ error: "pieceId and operationType required" }, { status: 400 });
  if (!isFabProcessType(operationType)) {
    return Response.json({ error: "Invalid operationType" }, { status: 400 });
  }

  const gate = await requireProcessSession(operationType);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  const sess = gate.session;

  const pieceOp = await prisma.fabPieceOperation.findFirst({
    where: { pieceId, operationType, isCompleted: false },
    select: { id: true, operationId: true },
  });
  if (!pieceOp) return Response.json({ success: true, noop: true });

  const now = new Date();

  if (pieceOp.operationId) {
    await prisma.fabOperation.update({
      where: { id: pieceOp.operationId },
      data: { startTime: now, status: "IN_PROGRESS", machineId: sess.machineId },
    });
    await stampOperationWorker(prisma, pieceOp.operationId, sess.workerId, sess.shift);
    await prisma.fabPieceOperation.update({
      where: { id: pieceOp.id },
      data: { startedAt: now },
    });
  } else {
    const fabOp = await prisma.fabOperation.create({
      data: {
        pieceId,
        operatorId: userId,
        operationType,
        startTime: now,
        status: "IN_PROGRESS",
        machineId: sess.machineId,
      },
    });
    await stampOperationWorker(prisma, fabOp.id, sess.workerId, sess.shift);
    await prisma.fabPieceOperation.update({
      where: { id: pieceOp.id },
      data: { startedAt: now, operationId: fabOp.id },
    });
  }

  return Response.json({ success: true });
}
