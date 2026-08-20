import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { statusFromFlags } from "@/lib/fab/routing";
import { requireProcessSession } from "@/lib/fab/processSessionServer";
import { stampOperationWorker } from "@/lib/fab/stampWorker";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { pieceId } = await req.json();
  if (!pieceId) return Response.json({ error: "pieceId required" }, { status: 400 });

  const gate = await requireProcessSession("FABRICATION");
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  const sess = gate.session;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const op = await tx.fabOperation.create({
      data: {
        pieceId,
        operatorId: g.user.id as string,
        machineId: sess.machineId,
        operationType: "FABRICATION",
        status: "COMPLETED",
        startTime: now,
        endTime: now,
      },
    });
    await stampOperationWorker(tx, op.id, sess.workerId, sess.shift);
    await tx.fabPieceOperation.updateMany({
      where: { pieceId, operationType: "FABRICATION", isCompleted: false },
      data: { isCompleted: true, completedAt: now, operationId: op.id },
    });
    const piece = await tx.fabPiece.update({
      where: { id: pieceId },
      data: { fabricationCompleted: true },
    });
    await tx.fabPiece.update({
      where: { id: pieceId },
      data: { status: statusFromFlags(piece) as never },
    });
  });

  return Response.json({ success: true });
}
