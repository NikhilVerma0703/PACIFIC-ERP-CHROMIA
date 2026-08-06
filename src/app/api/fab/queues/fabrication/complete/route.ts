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
      where: { pieceId, operationType: "FABRICATION", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    // Recomputed for the same reason as the other stations, and through the same
    // function, so all four agree on what a piece's status means.
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
