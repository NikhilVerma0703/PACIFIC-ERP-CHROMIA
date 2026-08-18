import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { statusFromFlags } from "@/lib/fab/routing";

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
    // Status recomputed, not pinned: a piece whose fabrication was already done
    // must not fall back from FABRICATED to SINK_CUT because the sink cut
    // finished second. Stations do not always run in route order.
    const piece = await tx.fabPiece.update({
      where: { id: pieceId },
      data: { sinkCompleted: true },
    });
    await tx.fabPiece.update({
      where: { id: pieceId },
      data: { status: statusFromFlags(piece) as never },
    });
  });

  return Response.json({ success: true });
}
