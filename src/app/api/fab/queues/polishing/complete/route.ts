import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { pieceId } = await req.json();
  if (!pieceId) return Response.json({ error: "pieceId required" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.fabPieceOperation.updateMany({
      where: { pieceId, operationType: "POLISHING", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    const piece = await tx.fabPiece.update({
      where: { id: pieceId },
      data: { polishingCompleted: true, status: "POLISHED" },
    });
    // Check if ready for packaging
    const ready = (!piece.polishRequired || piece.polishingCompleted)
      && (!piece.hasSink || piece.sinkCompleted)
      && (!piece.fabricationRequired || piece.fabricationCompleted);
    if (ready) {
      await tx.fabPieceOperation.updateMany({
        where: { pieceId, operationType: "PACKAGING", isCompleted: false },
        data: { isCompleted: false }, // keep pending, isReadyForPackaging check handles it
      });
    }
  });

  return Response.json({ success: true });
}
