import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { pieceId } = await req.json();
  if (!pieceId) return Response.json({ error: "pieceId required" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.fabPieceOperation.updateMany({
      where: { pieceId, operationType: "SINK_CUTTING", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    await tx.fabPiece.update({
      where: { id: pieceId },
      data: { sinkCompleted: true, status: "SINK_CUT" },
    });
  });

  return Response.json({ success: true });
}
